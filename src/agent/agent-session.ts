import {
  AgentRequestValidationError,
  MAX_AGENT_OUTPUT_CHARS,
  buildAgentPrompt,
  parseAgentToolRequest,
  type AgentPrompt,
  type AgentToolRequest,
} from './agent-contract.ts';
import {
  reviewAgentCartProposal,
  type AgentToolResult,
  type ReviewedAgentCartItem,
} from '../actions/agent-tools.ts';

export interface AgentRuntime {
  /** Load bundled on-device model resources. Must never download a model. */
  initialize(): Promise<void>;
  /** Make exactly one bounded local generation call. */
  generate(prompt: AgentPrompt, options: { maxTokens: number }): Promise<string>;
  /** Interrupt the current local initialization or generation, when present. */
  cancel(): Promise<void>;
  /** Release local model resources. */
  dispose(): Promise<void>;
}

export type AgentSessionStatus =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'running'
  | 'proposal'
  | 'reviewed'
  | 'error'
  | 'disposed';

export interface AgentSessionState {
  status: AgentSessionStatus;
  input: string;
  rawOutput: string;
  result: AgentToolResult | null;
  reviewedItem: ReviewedAgentCartItem | null;
  /** Time spent inside the local runtime generation call only. */
  inferenceMs: number | null;
  /** Total wall time for local generation, validation, and the read-only host tool. */
  elapsedMs: number | null;
  error: string | null;
}

export interface AgentSession {
  getState(): AgentSessionState;
  subscribe(listener: (state: AgentSessionState) => void): () => void;
  initialize(): Promise<void>;
  run(userInput: string, context?: unknown): Promise<void>;
  /** Invalidate a proposal when the user edits the request; never writes. */
  edit(): void;
  /** Cancel and drain work when the app enters the background. */
  background(): Promise<void>;
  /** Explicit owner review creates only a temporary draft item. */
  reviewCart(candidateProductId?: string): ReviewedAgentCartItem | null;
  /** Invalidate work and release runtime resources. */
  close(): Promise<void>;
}

export const DEFAULT_AGENT_GENERATION_TIMEOUT_MS = 30_000;
export const AGENT_MAX_GENERATION_TOKENS = 128;

class AgentGenerationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    super(`Lumampas sa ${seconds} segundo ang local model. Kinansela ang request; subukan muli.`);
    this.name = 'AgentGenerationTimeoutError';
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function cloneResult(result: AgentToolResult | null): AgentToolResult | null {
  if (!result) return null;
  if (result.kind === 'catalog_lookup') {
    const lookup = result.lookup.kind === 'exact'
      ? { ...result.lookup, product: { ...result.lookup.product } }
      : result.lookup.kind === 'ambiguous'
        ? { ...result.lookup, products: result.lookup.products.map((product) => ({ ...product })) }
        : { ...result.lookup };
    return { ...result, lookup };
  }
  return {
    ...result,
    product: result.product ? { ...result.product } : null,
    candidates: result.candidates.map((product) => ({ ...product })),
  };
}

export function createAgentSession(
  options: {
    runtime: AgentRuntime;
    execute: (request: AgentToolRequest) => Promise<AgentToolResult>;
    timeoutMs?: number;
    now?: () => number;
  },
): AgentSession {
  const timeoutMs = options.timeoutMs ?? DEFAULT_AGENT_GENERATION_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_AGENT_GENERATION_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be between 1 and ${DEFAULT_AGENT_GENERATION_TIMEOUT_MS}`);
  }
  const now = options.now ?? Date.now;
  let state: AgentSessionState = {
    status: 'idle', input: '', rawOutput: '', result: null,
    reviewedItem: null, inferenceMs: null, elapsedMs: null, error: null,
  };
  let revision = 0;
  let initialized = false;
  let initializeTask: Promise<void> | null = null;
  let runTask: Promise<void> | null = null;
  let generationTask: Promise<string> | null = null;
  let cancellationTask: Promise<void> | null = null;
  let closeTask: Promise<void> | null = null;
  const listeners = new Set<(value: AgentSessionState) => void>();

  function publish(next: AgentSessionState): void {
    state = next;
    for (const listener of listeners) {
      try { listener(snapshot()); } catch { /* View listeners cannot break model cleanup. */ }
    }
  }

  function snapshot(): AgentSessionState {
    return {
      ...state,
      result: cloneResult(state.result),
      reviewedItem: state.reviewedItem
        ? { product: { ...state.reviewedItem.product }, quantity: state.reviewedItem.quantity }
        : null,
    };
  }

  function isCurrent(attempt: number): boolean {
    return attempt === revision && state.status !== 'disposed';
  }

  function emptyState(status: AgentSessionStatus, input = ''): AgentSessionState {
    return {
      status, input, rawOutput: '', result: null,
      reviewedItem: null, inferenceMs: null, elapsedMs: null, error: null,
    };
  }

  function cancelAndDrain(): Promise<void> {
    if (cancellationTask) return cancellationTask;
    const pendingGeneration = generationTask;
    const pendingInitialization = initializeTask;
    if (!pendingGeneration && !pendingInitialization) return Promise.resolve();

    const cancelCall = Promise.resolve().then(() => options.runtime.cancel()).catch(() => undefined);
    const drain = Promise.all([
      pendingGeneration?.then(() => undefined, () => undefined) ?? Promise.resolve(),
      pendingInitialization?.then(() => undefined, () => undefined) ?? Promise.resolve(),
    ]).then(() => undefined);
    cancellationTask = Promise.all([cancelCall, drain])
      .then(() => undefined)
      .finally(() => {
        cancellationTask = null;
        if (state.status === 'running' && !runTask) {
          publish(emptyState(initialized ? 'ready' : 'idle', state.input));
        } else if (state.status === 'initializing' && !initializeTask) {
          publish(emptyState(initialized ? 'ready' : 'idle', state.input));
        }
      });
    return cancellationTask;
  }

  function finishStaleWork(attempt: number): void {
    if (attempt === revision || state.status === 'disposed') return;
    if (state.status === 'running' && runTask === null && !cancellationTask) {
      publish(emptyState(initialized ? 'ready' : 'idle', state.input));
    }
    if (state.status === 'initializing' && initializeTask === null && !cancellationTask) {
      publish(emptyState('idle', state.input));
    }
  }

  async function initialize(): Promise<void> {
    if (state.status === 'disposed' || initialized || initializeTask || runTask || cancellationTask) {
      return initializeTask ?? runTask ?? cancellationTask ?? Promise.resolve();
    }
    const attempt = ++revision;
    const task = Promise.resolve().then(() => options.runtime.initialize()).then(() => {
      if (!isCurrent(attempt)) return;
      initialized = true;
      publish(emptyState('ready', state.input));
    }).catch((error: unknown) => {
      if (!isCurrent(attempt)) return;
      initialized = false;
      publish({ ...emptyState('error', state.input), error: safeErrorMessage(error, 'Hindi maihanda ang local model. Suriin ang bundled model at subukan muli.') });
    }).finally(() => {
      if (initializeTask === task) initializeTask = null;
      finishStaleWork(attempt);
    });
    initializeTask = task;
    publish(emptyState('initializing', state.input));
    return task;
  }

  async function performRun(attempt: number, userInput: string, context: unknown): Promise<void> {
    let rawOutput = '';
    let inferenceMs: number | null = null;
    const startedAt = now();
    try {
      if (!isCurrent(attempt)) return;
      const prompt = buildAgentPrompt(userInput, context);
      const inferenceStartedAt = now();
      const generated = options.runtime.generate(prompt, { maxTokens: AGENT_MAX_GENERATION_TOKENS });
      generationTask = generated;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;
      let timedOut = false;
      const timeout = new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          reject(new AgentGenerationTimeoutError(timeoutMs));
        }, timeoutMs);
      });
      let generatedOutput: unknown;
      try {
        generatedOutput = await Promise.race([generated, timeout]);
        inferenceMs = Math.max(0, Math.round(now() - inferenceStartedAt));
      } catch (error) {
        inferenceMs = timedOut ? timeoutMs : Math.max(0, Math.round(now() - inferenceStartedAt));
        if (timedOut) await cancelAndDrain();
        throw error;
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
        if (generationTask === generated) generationTask = null;
      }
      if (typeof generatedOutput !== 'string') {
        throw new AgentRequestValidationError('Local model did not return text. Suriin ang runtime at subukan muli.');
      }
      rawOutput = generatedOutput;
      if (!isCurrent(attempt)) return;
      if (rawOutput.length > MAX_AGENT_OUTPUT_CHARS) {
        throw new AgentRequestValidationError('Masyadong mahaba ang sagot ng local model. Suriin ang model output limit.');
      }
      const request = parseAgentToolRequest(rawOutput);
      const result = await options.execute(request);
      if (!isCurrent(attempt)) return;
      publish({
        status: 'proposal', input: userInput, rawOutput, result,
        reviewedItem: null, inferenceMs,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)), error: null,
      });
    } catch (error) {
      if (!isCurrent(attempt)) return;
      publish({
        status: 'error', input: userInput, rawOutput,
        result: null, reviewedItem: null, inferenceMs,
        elapsedMs: Math.max(0, Math.round(now() - startedAt)),
        error: safeErrorMessage(error, 'Hindi natapos ang local agent request. Subukan muli.'),
      });
    }
  }

  function run(userInput: string, context?: unknown): Promise<void> {
    if (state.status === 'disposed' || !initialized || cancellationTask || (state.status !== 'ready' && state.status !== 'error')) {
      return Promise.resolve();
    }
    if (runTask) return runTask;
    const attempt = ++revision;
    publish(emptyState('running', typeof userInput === 'string' ? userInput : ''));
    const task = Promise.resolve().then(() => performRun(attempt, userInput, context)).finally(() => {
      if (runTask === task) runTask = null;
      finishStaleWork(attempt);
    });
    runTask = task;
    return task;
  }

  function edit(): void {
    if (state.status === 'disposed') return;
    revision++;
    const nextStatus: AgentSessionStatus = runTask
      ? 'running'
      : initializeTask
        ? 'initializing'
        : initialized ? 'ready' : 'idle';
    publish(emptyState(nextStatus));
    if (runTask || initializeTask) void cancelAndDrain();
  }

  async function background(): Promise<void> {
    if (state.status === 'disposed') return;
    const attempt = ++revision;
    const hadWork = Boolean(runTask || initializeTask);
    publish(emptyState(hadWork ? (runTask ? 'running' : 'initializing') : initialized ? 'ready' : 'idle'));
    await cancelAndDrain();
    if (isCurrent(attempt) && !runTask && !initializeTask) {
      publish(emptyState(initialized ? 'ready' : 'idle'));
    }
  }

  function reviewCart(candidateProductId?: string): ReviewedAgentCartItem | null {
    if (state.status !== 'proposal' || state.result?.kind !== 'cart_item_proposal') return null;
    try {
      const reviewedItem = reviewAgentCartProposal(state.result, candidateProductId);
      publish({ ...state, status: 'reviewed', reviewedItem, error: null });
      return { product: { ...reviewedItem.product }, quantity: reviewedItem.quantity };
    } catch (error) {
      publish({ ...state, error: safeErrorMessage(error, 'Hindi marepaso ang cart proposal.') });
      return null;
    }
  }

  async function close(): Promise<void> {
    if (closeTask) return closeTask;
    if (state.status === 'disposed') return;
    revision++;
    publish(emptyState('disposed'));
    listeners.clear();
    closeTask = (async () => {
      await cancelAndDrain();
      try { await options.runtime.dispose(); } catch { /* Close is terminal; disposal errors cannot revive the session. */ }
    })();
    return closeTask;
  }

  return {
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => { listeners.delete(listener); };
    },
    initialize,
    run,
    edit,
    background,
    reviewCart,
    close,
  };
}
