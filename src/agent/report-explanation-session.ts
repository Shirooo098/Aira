import type { AgentRuntime } from './agent-session.ts';
import {
  buildReportExplanationEvidence,
  buildReportExplanationPrompt,
  parseReportExplanationFocus,
  renderReportExplanation,
  type ReportExplanationEvidence,
  type ReportExplanationFact,
} from '../domain/report-explanation.ts';
import type { StoreReport } from '../domain/reports.ts';

export const DEFAULT_REPORT_EXPLANATION_TIMEOUT_MS = 60_000;
export const MAX_REPORT_EXPLANATION_TIMEOUT_MS = 120_000;
export const REPORT_EXPLANATION_MAX_TOKENS = 128;
export const MAX_REPORT_EXPLANATION_OUTPUT_CHARS = 2048;

export type ReportExplanationSessionStatus =
  | 'idle'
  | 'initializing'
  | 'generating'
  | 'complete'
  | 'error'
  | 'disposed';

export interface ReportExplanationSessionState {
  status: ReportExplanationSessionStatus;
  evidence: ReportExplanationEvidence;
  points: ReportExplanationFact[];
  rawOutput: string;
  error: string | null;
  initializationMs: number | null;
  inferenceMs: number | null;
}

export interface ReportExplanationSession {
  getState(): ReportExplanationSessionState;
  subscribe(listener: (state: ReportExplanationSessionState) => void): () => void;
  run(): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

class ReportExplanationTimeoutError extends Error {
  constructor(timeoutMs: number) {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    super(`Lumampas sa ${seconds} segundo ang lokal na paliwanag. Kinansela ang request; subukan muli.`);
    this.name = 'ReportExplanationTimeoutError';
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => deepCopy(item)) as T;
  if (typeof value !== 'object' || value === null) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) copy[key] = deepCopy(child);
  return copy as T;
}

function emptyState(
  status: ReportExplanationSessionStatus,
  evidence: ReportExplanationEvidence,
): ReportExplanationSessionState {
  return {
    status,
    evidence,
    points: [],
    rawOutput: '',
    error: null,
    initializationMs: null,
    inferenceMs: null,
  };
}

export function createReportExplanationSession(options: {
  report: StoreReport;
  runtime: AgentRuntime;
  timeoutMs?: number;
  now?: () => number;
}): ReportExplanationSession {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REPORT_EXPLANATION_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_REPORT_EXPLANATION_TIMEOUT_MS
  ) {
    throw new RangeError(`timeoutMs must be between 1 and ${MAX_REPORT_EXPLANATION_TIMEOUT_MS}`);
  }

  // Evidence construction validates and detaches the report exactly once. The runtime
  // receives only the aggregate prompt built from this fixed snapshot.
  const evidence = buildReportExplanationEvidence(deepCopy(options.report));
  const now = options.now ?? Date.now;
  let state = emptyState('idle', evidence);
  let revision = 0;
  let initialized = false;
  let initializationTask: Promise<void> | null = null;
  let generationTask: Promise<string> | null = null;
  let cancellationTask: Promise<void> | null = null;
  let runTask: Promise<void> | null = null;
  let disposeTask: Promise<void> | null = null;
  const listeners = new Set<(value: ReportExplanationSessionState) => void>();

  function cloneEvidence(value: ReportExplanationEvidence): ReportExplanationEvidence {
    return {
      ...value,
      report: deepCopy(value.report),
      facts: value.facts.map((fact) => ({ ...fact })),
    };
  }

  function snapshot(): ReportExplanationSessionState {
    return {
      ...state,
      evidence: cloneEvidence(state.evidence),
      points: state.points.map((point) => ({ ...point })),
    };
  }

  function publish(next: ReportExplanationSessionState): void {
    state = next;
    for (const listener of listeners) {
      try { listener(snapshot()); } catch { /* UI listeners cannot interrupt runtime cleanup. */ }
    }
  }

  function isCurrent(attempt: number): boolean {
    return attempt === revision && state.status !== 'disposed';
  }

  function cancelAndDrain(): Promise<void> {
    if (cancellationTask) return cancellationTask;
    const pendingInitialization = initializationTask;
    const pendingGeneration = generationTask;
    if (!pendingInitialization && !pendingGeneration) return Promise.resolve();

    const cancelCall = Promise.resolve()
      .then(() => options.runtime.cancel())
      .catch(() => undefined);
    const drain = Promise.all([
      pendingInitialization?.then(() => undefined, () => undefined) ?? Promise.resolve(),
      pendingGeneration?.then(() => undefined, () => undefined) ?? Promise.resolve(),
    ]).then(() => undefined);
    const task = Promise.all([cancelCall, drain])
      .then(() => undefined)
      .finally(() => {
        if (cancellationTask === task) cancellationTask = null;
      });
    cancellationTask = task;
    return task;
  }

  async function performRun(attempt: number): Promise<void> {
    let rawOutput = '';
    let initializationMs: number | null = null;
    let inferenceMs: number | null = null;
    let initializationStartedAt: number | null = null;
    let generationStartedAt: number | null = null;

    if (!evidence.hasPeriodActivity) {
      if (isCurrent(attempt)) {
        publish({
          ...emptyState('complete', evidence),
          points: renderReportExplanation(evidence, []),
        });
      }
      return;
    }

    const initialStatus = initialized ? 'generating' : 'initializing';
    publish(emptyState(initialStatus, evidence));

    const work = (async () => {
      if (!initialized) {
        initializationStartedAt = now();
        let task: Promise<void>;
        try {
          task = Promise.resolve(options.runtime.initialize());
        } catch (error) {
          task = Promise.reject(error);
        }
        initializationTask = task;
        try {
          await task;
          if (isCurrent(attempt)) initialized = true;
        } finally {
          initializationMs = Math.max(0, Math.round(now() - initializationStartedAt));
          if (initializationTask === task) initializationTask = null;
        }
      }

      if (!isCurrent(attempt)) return;
      const prompt = buildReportExplanationPrompt(evidence);
      publish({
        ...emptyState('generating', evidence),
        initializationMs,
      });

      generationStartedAt = now();
      let task: Promise<string>;
      try {
        task = Promise.resolve(options.runtime.generate(prompt, { maxTokens: REPORT_EXPLANATION_MAX_TOKENS }));
      } catch (error) {
        task = Promise.reject(error);
      }
      generationTask = task;
      let output: unknown;
      try {
        output = await task;
      } finally {
        inferenceMs = Math.max(0, Math.round(now() - generationStartedAt));
        if (generationTask === task) generationTask = null;
      }

      if (!isCurrent(attempt)) return;
      if (typeof output !== 'string') {
        throw new Error('Hindi nagbalik ng text ang lokal na modelo. Suriin ang runtime at subukan muli.');
      }
      if (output.length > MAX_REPORT_EXPLANATION_OUTPUT_CHARS) {
        throw new Error('Masyadong mahaba ang sagot ng lokal na modelo. Subukan muli.');
      }
      rawOutput = output;
      const focus = parseReportExplanationFocus(output, evidence);
      const points = renderReportExplanation(evidence, focus);
      if (!isCurrent(attempt)) return;
      publish({
        ...emptyState('complete', evidence),
        points,
        rawOutput,
        initializationMs,
        inferenceMs,
      });
    })();

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;
    const timeout = new Promise<never>((_resolve, reject) => {
      timeoutId = setTimeout(() => {
        timedOut = true;
        reject(new ReportExplanationTimeoutError(timeoutMs));
      }, timeoutMs);
    });

    try {
      await Promise.race([work, timeout]);
    } catch (error) {
      if (error instanceof ReportExplanationTimeoutError || timedOut) {
        // Invalidate the native continuation before cancellation. A late result must
        // never replace the timeout state, and the owner can see the failure while
        // native cancellation is still draining.
        const timeoutAttempt = isCurrent(attempt) ? ++revision : attempt;
        if (initializationStartedAt !== null && initializationMs === null) {
          initializationMs = Math.max(0, Math.round(now() - initializationStartedAt));
        }
        if (generationStartedAt !== null && inferenceMs === null) {
          inferenceMs = Math.max(0, Math.round(now() - generationStartedAt));
        }
        if (isCurrent(timeoutAttempt)) {
          publish({
            ...emptyState('error', evidence),
            rawOutput,
            error: error instanceof Error ? error.message : safeErrorMessage(error, 'Lumampas ang oras ng lokal na paliwanag.'),
            initializationMs,
            inferenceMs,
          });
        }
        await cancelAndDrain();
        await work.then(() => undefined, () => undefined);
        // The work's finally blocks have now recorded each phase's actual end.
        // Do not extend initialization timing by time spent generating/draining.
        if (isCurrent(timeoutAttempt)) {
          publish({
            ...state,
            initializationMs,
            inferenceMs,
          });
        }
      } else if (isCurrent(attempt)) {
        publish({
          ...emptyState('error', evidence),
          rawOutput,
          error: safeErrorMessage(error, 'Hindi natapos ang lokal na paliwanag. Subukan muli.'),
          initializationMs,
          inferenceMs,
        });
      }
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
    }
  }

  function beginRun(): Promise<void> {
    const attempt = ++revision;
    const task = performRun(attempt);
    runTask = task;
    void task.then(
      () => { if (runTask === task) runTask = null; },
      () => { if (runTask === task) runTask = null; },
    );
    return task;
  }

  async function runAfterDrain(): Promise<void> {
    const previousRun = runTask;
    const attempt = ++revision;
    publish(emptyState('idle', evidence));
    await cancelAndDrain();
    if (previousRun) await previousRun;
    if (!isCurrent(attempt)) return;
    if (cancellationTask) await cancellationTask;
    if (isCurrent(attempt)) await beginRun();
  }

  function run(): Promise<void> {
    if (state.status === 'disposed') return Promise.resolve();
    if (runTask) return runAfterDrain();
    if (cancellationTask) {
      const attempt = revision;
      return cancellationTask.then(() => {
        if (isCurrent(attempt) && !runTask) return beginRun();
      });
    }
    return beginRun();
  }

  async function cancel(): Promise<void> {
    if (state.status === 'disposed') return;
    const attempt = ++revision;
    const activeRun = runTask;
    publish(emptyState('idle', evidence));
    await cancelAndDrain();
    if (activeRun) await activeRun;
    if (isCurrent(attempt) && !runTask) publish(emptyState('idle', evidence));
  }

  function dispose(): Promise<void> {
    if (disposeTask) return disposeTask;
    if (state.status === 'disposed') return Promise.resolve();
    revision++;
    const activeRun = runTask;
    publish(emptyState('disposed', evidence));
    listeners.clear();
    disposeTask = (async () => {
      await cancelAndDrain();
      if (activeRun) await activeRun;
      try { await options.runtime.dispose(); } catch { /* Disposal is terminal. */ }
    })();
    return disposeTask;
  }

  return {
    getState: snapshot,
    subscribe(listener) {
      if (state.status !== 'disposed') listeners.add(listener);
      try { listener(snapshot()); } catch { /* Listeners cannot break a session. */ }
      return () => { listeners.delete(listener); };
    },
    run,
    cancel,
    dispose,
  };
}
