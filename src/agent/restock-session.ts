import type { DatabaseSession } from '../db/database.ts';
import type { AgentRuntime } from './agent-session.ts';
import type { ReportPeriodKey } from '../domain/reports.ts';
import {
  buildRestockPrompt,
  parseRestockPriorityFocus,
  type RestockChecklist,
} from '../domain/restock.ts';
import {
  createDraftRestockChecklist,
  getRestockChecklist,
  updateChecklistItem,
} from '../actions/restock-actions.ts';

export const DEFAULT_RESTOCK_TIMEOUT_MS = 60_000;
export const MAX_RESTOCK_TIMEOUT_MS = 120_000;

export type RestockSessionStatus =
  | 'idle'
  | 'initializing'
  | 'generating'
  | 'complete'
  | 'error'
  | 'disposed';

export interface RestockSessionState {
  status: RestockSessionStatus;
  checklist: RestockChecklist | null;
  rawOutput: string;
  error: string | null;
  initializationMs: number | null;
  inferenceMs: number | null;
  prioritizedCount: number;
}

export interface RestockSession {
  getState(): RestockSessionState;
  subscribe(listener: (state: RestockSessionState) => void): () => void;
  run(): Promise<void>;
  cancel(): Promise<void>;
  dispose(): Promise<void>;
}

class RestockTimeoutError extends Error {
  constructor(timeoutMs: number) {
    const seconds = Math.max(1, Math.ceil(timeoutMs / 1000));
    super(`Lumampas sa ${seconds} segundo ang restock AI analysis. Kinansela ang request; subukan muli.`);
    this.name = 'RestockTimeoutError';
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function createRestockSession(options: {
  db: DatabaseSession;
  runtime?: AgentRuntime;
  periodKey: ReportPeriodKey;
  evaluationDate?: Date | string;
  timeoutMs?: number;
  now?: () => number;
}): RestockSession {
  const timeoutMs = options.timeoutMs ?? DEFAULT_RESTOCK_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_RESTOCK_TIMEOUT_MS) {
    throw new RangeError(`timeoutMs must be between 1 and ${MAX_RESTOCK_TIMEOUT_MS}`);
  }

  const now = options.now ?? Date.now;
  let state: RestockSessionState = {
    status: 'idle',
    checklist: null,
    rawOutput: '',
    error: null,
    initializationMs: null,
    inferenceMs: null,
    prioritizedCount: 0,
  };

  let revision = 0;
  let initializationTask: Promise<void> | null = null;
  let generationTask: Promise<string> | null = null;
  let cancellationTask: Promise<void> | null = null;
  let runTask: Promise<void> | null = null;
  let disposeTask: Promise<void> | null = null;
  const listeners = new Set<(value: RestockSessionState) => void>();

  function snapshot(): RestockSessionState {
    return {
      ...state,
      checklist: state.checklist
        ? {
            ...state.checklist,
            items: state.checklist.items.map((i) => ({ ...i })),
          }
        : null,
    };
  }

  function publish(next: RestockSessionState): void {
    state = next;
    for (const listener of listeners) {
      try {
        listener(snapshot());
      } catch {
        /* UI listener error cannot break session */
      }
    }
  }

  function isCurrent(attempt: number): boolean {
    return attempt === revision && state.status !== 'disposed';
  }

  function cancelAndDrain(): Promise<void> {
    if (cancellationTask) return cancellationTask;
    const pendingInit = initializationTask;
    const pendingGen = generationTask;
    if (!pendingInit && !pendingGen) return Promise.resolve();

    const cancelCall = Promise.resolve()
      .then(() => options.runtime?.cancel())
      .catch(() => undefined);

    cancellationTask = Promise.allSettled([
      pendingInit ?? Promise.resolve(),
      pendingGen ?? Promise.resolve(),
      cancelCall,
    ]).then(() => {
      cancellationTask = null;
    });

    return cancellationTask;
  }

  async function executeRun(attempt: number): Promise<void> {
    const draft = await createDraftRestockChecklist(options.db, {
      periodKey: options.periodKey,
      evaluationDate: options.evaluationDate,
    });

    if (!isCurrent(attempt)) return;

    publish({
      ...state,
      checklist: draft,
    });

    if (draft.items.length === 0 || !options.runtime) {
      publish({
        ...state,
        status: 'complete',
        checklist: draft,
      });
      return;
    }

    const runtime = options.runtime;

    // Phase 1: Initialize runtime
    publish({ ...state, status: 'initializing', error: null });
    const initStart = now();
    const initPromise = runtime.initialize();
    initializationTask = initPromise;
    try {
      await initPromise;
    } finally {
      if (initializationTask === initPromise) initializationTask = null;
    }

    if (!isCurrent(attempt)) return;
    const initMs = Math.max(0, now() - initStart);

    // Phase 2: Generate priority focus
    publish({
      ...state,
      status: 'generating',
      initializationMs: initMs,
    });

    const prompt = buildRestockPrompt(draft.items, draft.periodLabel);
    const genStart = now();
    const genPromise = runtime.generate(prompt, { maxTokens: 128 });
    generationTask = genPromise;
    let rawOutput = '';
    try {
      rawOutput = await genPromise;
    } finally {
      if (generationTask === genPromise) generationTask = null;
    }

    if (!isCurrent(attempt)) return;
    const inferMs = Math.max(0, now() - genStart);

    // Phase 3: Parse and apply priority product IDs
    const candidateIdSet = new Set(draft.items.map((i) => i.productId));
    const priorityIds = parseRestockPriorityFocus(rawOutput, candidateIdSet);

    if (priorityIds.length > 0) {
      const prioritySet = new Set(priorityIds);
      for (const item of draft.items) {
        if (prioritySet.has(item.productId)) {
          await updateChecklistItem(options.db, {
            itemId: item.id,
            isPriority: true,
          });
        }
      }
    }

    const reloaded = await getRestockChecklist(options.db, draft.id);

    if (!isCurrent(attempt)) return;

    publish({
      ...state,
      status: 'complete',
      checklist: reloaded,
      rawOutput,
      initializationMs: initMs,
      inferenceMs: inferMs,
      prioritizedCount: priorityIds.length,
      error: null,
    });
  }

  return {
    getState(): RestockSessionState {
      return snapshot();
    },

    subscribe(listener: (state: RestockSessionState) => void): () => void {
      listeners.add(listener);
      listener(snapshot());
      return () => {
        listeners.delete(listener);
      };
    },

    async run(): Promise<void> {
      if (state.status === 'disposed') {
        throw new Error('Sarado na ang restock session.');
      }
      if (runTask) return runTask;

      const attempt = ++revision;
      let timer: NodeJS.Timeout | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new RestockTimeoutError(timeoutMs));
        }, timeoutMs);
      });

      const runner = (async () => {
        try {
          await Promise.race([executeRun(attempt), timeoutPromise]);
        } catch (error) {
          if (!isCurrent(attempt)) return;
          const message = safeErrorMessage(
            error,
            'Nagkaroon ng aberya sa pagsusuri ng restock suggestions.'
          );
          publish({
            ...state,
            status: 'error',
            error: message,
          });
        } finally {
          clearTimeout(timer);
          runTask = null;
        }
      })();

      runTask = runner;
      return runner;
    },

    async cancel(): Promise<void> {
      if (state.status === 'disposed') return;
      revision += 1;
      await cancelAndDrain();
      if (state.status !== 'complete') {
        publish({
          ...state,
          status: 'idle',
        });
      }
    },

    async dispose(): Promise<void> {
      if (disposeTask) return disposeTask;
      revision += 1;
      const disposing = (async () => {
        await cancelAndDrain();
        try {
          await options.runtime?.dispose();
        } catch {
          /* ignore */
        }
        publish({
          ...state,
          status: 'disposed',
        });
      })();
      disposeTask = disposing;
      return disposing;
    },
  };
}
