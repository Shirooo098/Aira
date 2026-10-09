export interface SpeechCapture {
  /** Stops capture and returns the final on-device transcript. */
  stop(): Promise<string>;
  /** Interrupts capture or an in-progress transcription. Safe to call once. */
  cancel(): Promise<void>;
}

export interface SpeechAdapter {
  /** Loads or checks bundled speech resources. This must not download a model. */
  prepare(): Promise<void>;
  /** Requests microphone access and starts one capture. */
  start(onPartial?: (transcript: string) => void): Promise<SpeechCapture>;
  /** Releases adapter-wide resources after the controller is disposed. */
  dispose(): Promise<void>;
}

export type SpeechStatus =
  | 'preparing'
  | 'ready'
  | 'starting'
  | 'recording'
  | 'transcribing'
  | 'review'
  | 'error'
  | 'disposed';

export interface SpeechSessionError {
  readonly code: string;
  readonly message: string;
}

export interface SpeechSessionState {
  readonly status: SpeechStatus;
  /** Latest text reported by recognition, including partial text while recording. */
  readonly recognizedTranscript: string;
  /** Editable copy of the final transcript. Editing never changes recognition output. */
  readonly draft: string;
  /** False until adapter.prepare() succeeds; useful before the first initialize(). */
  readonly prepared: boolean;
  readonly error: SpeechSessionError | null;
}

export interface SpeechSessionOptions {
  /** Maximum push-to-talk duration. Defaults to 15 seconds. */
  readonly maxDurationMs?: number;
  /** Maximum wait for final transcription after stopping. Defaults to 30 seconds. */
  readonly inferenceTimeoutMs?: number;
}

export interface SpeechSessionController {
  getState(): SpeechSessionState;
  subscribe(listener: (state: SpeechSessionState) => void): () => void;
  initialize(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  cancel(): Promise<void>;
  /** Call from the app-state handler when the app enters the background. */
  cancelForBackground(): Promise<void>;
  edit(draft: string): void;
  /** Explicitly hands the current nonblank draft to the caller; it performs no writes. */
  review(): string | null;
  /** Discards any current capture/draft and starts a fresh session. */
  retry(): Promise<void>;
  dispose(): Promise<void>;
}

interface ActiveSession {
  readonly id: number;
  cancelled: boolean;
  capture: SpeechCapture | null;
  captureCancelPromise: Promise<void> | null;
  startTask: Promise<void> | null;
  stopTask: Promise<void> | null;
  cancelTask: Promise<void> | null;
  maxDurationTimer: ReturnType<typeof setTimeout> | null;
}

const DEFAULT_MAX_DURATION_MS = 15_000;
const DEFAULT_INFERENCE_TIMEOUT_MS = 30_000;

const INITIAL_STATE: SpeechSessionState = {
  status: 'ready',
  recognizedTranscript: '',
  draft: '',
  prepared: false,
  error: null,
};

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !('code' in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.length > 0 ? code : null;
}

function permissionError(code: string | null): boolean {
  const normalized = code?.toLowerCase() ?? '';
  return normalized.includes('permission') || normalized.includes('denied');
}

function adapterError(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): SpeechSessionError {
  const code = errorCode(error);
  const normalizedCode = code?.toLowerCase() ?? '';
  const knownMessages: ReadonlyArray<readonly [string, string]> = [
    ['native_unavailable', 'Hindi available ang on-device speech sa build na ito. Gumamit ng development build.'],
    ['unsupported_audio', 'Hindi suportado ang audio format ng mikropono. Suriin ang audio setup at subukan muli.'],
    ['empty_audio', 'Walang narinig na audio. Magsalita nang mas malapit sa mikropono at subukan muli.'],
    ['not_ready', 'Hindi pa handa ang speech model. Ihanda ito at subukan muli.'],
    ['busy', 'May kasalukuyang pag-record o pagproseso. Hintaying matapos at subukan muli.'],
  ];
  if (permissionError(code)) {
    return { code: code ?? fallbackCode, message: 'Kailangan ang pahintulot sa mikropono. Payagan ito at subukan muli.' };
  }
  const knownMessage = knownMessages.find(([knownCode]) => normalizedCode.includes(knownCode))?.[1];
  if (knownMessage) return { code: code ?? fallbackCode, message: knownMessage };
  if (error instanceof Error && error.message.trim()) {
    return { code: code ?? fallbackCode, message: error.message };
  }
  return { code: code ?? fallbackCode, message: fallbackMessage };
}

function timeoutError(): SpeechSessionError {
  return {
    code: 'transcription_timeout',
    message: 'Matagal ang pagproseso ng boses. Subukan muli.',
  };
}

export function createSpeechSessionController(
  adapter: SpeechAdapter,
  options: SpeechSessionOptions = {},
): SpeechSessionController {
  const maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
  const inferenceTimeoutMs = options.inferenceTimeoutMs ?? DEFAULT_INFERENCE_TIMEOUT_MS;
  const listeners = new Set<(state: SpeechSessionState) => void>();

  let state: SpeechSessionState = { ...INITIAL_STATE };
  let initialized = false;
  let disposed = false;
  let generation = 0;
  let currentSession: ActiveSession | null = null;
  let preparePromise: Promise<boolean> | null = null;
  let disposePromise: Promise<void> | null = null;
  let resourceTail: Promise<void> = Promise.resolve();

  function publish(patch: Partial<SpeechSessionState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) {
      try {
        listener(state);
      } catch {
        // A view subscriber must not interrupt capture cleanup or state publication.
      }
    }
  }

  function enqueueResource<T>(operation: () => Promise<T>): Promise<T> {
    const next = resourceTail.then(operation, operation);
    resourceTail = next.then(() => undefined, () => undefined);
    return next;
  }

  function isCurrent(session: ActiveSession): boolean {
    return !disposed && !session.cancelled && currentSession === session && session.id === generation;
  }

  function clearMaxDurationTimer(session: ActiveSession): void {
    if (session.maxDurationTimer !== null) {
      clearTimeout(session.maxDurationTimer);
      session.maxDurationTimer = null;
    }
  }

  function cancelCaptureOnce(session: ActiveSession): Promise<void> {
    const capture = session.capture;
    if (!capture) return Promise.resolve();
    if (!session.captureCancelPromise) {
      session.captureCancelPromise = Promise.resolve()
        .then(() => capture.cancel())
        .finally(() => {
          if (session.capture === capture) session.capture = null;
        });
    }
    return session.captureCancelPromise;
  }

  function ensurePrepared(): Promise<boolean> {
    if (disposed) return Promise.resolve(false);
    if (initialized) return Promise.resolve(true);
    if (preparePromise) return preparePromise;

    publish({ status: 'preparing', prepared: false, error: null });
    const task = (async () => {
      try {
        await adapter.prepare();
        initialized = true;
        if (!disposed) {
          publish({ prepared: true, error: null });
          if (!currentSession || currentSession.cancelled) publish({ status: 'ready' });
        }
        return true;
      } catch (error) {
        initialized = false;
        if (!disposed) {
          publish({
            status: 'error',
            prepared: false,
            error: adapterError(
              error,
              'speech_prepare_failed',
              'Hindi maihanda ang speech recognition. Subukan muli.',
            ),
          });
        }
        return false;
      } finally {
        preparePromise = null;
      }
    })();
    preparePromise = task;
    return task;
  }

  async function stopSession(session: ActiveSession): Promise<void> {
    if (session.stopTask) return session.stopTask;
    if (!isCurrent(session) || state.status !== 'recording' || !session.capture) return;

    clearMaxDurationTimer(session);
    publish({ status: 'transcribing', error: null });

    const capture = session.capture;
    const nativeStop = enqueueResource(() => capture.stop());
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    const timeout = new Promise<{ kind: 'timeout' }>((resolve) => {
      timeoutTimer = setTimeout(() => resolve({ kind: 'timeout' }), inferenceTimeoutMs);
    });

    session.stopTask = (async () => {
      const result = await Promise.race([
        nativeStop.then(
          (transcript) => ({ kind: 'success' as const, transcript }),
          (error: unknown) => ({ kind: 'failure' as const, error }),
        ),
        timeout,
      ]);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);

      if (result.kind === 'timeout') {
        if (isCurrent(session)) {
          publish({ status: 'error', error: timeoutError() });
        }
        const cancellation = cancelCaptureOnce(session);
        void enqueueResource(async () => cancellation).catch(() => undefined);
        return;
      }

      if (result.kind === 'failure') {
        if (isCurrent(session)) {
          publish({
            status: 'error',
            error: adapterError(
              result.error,
              'transcription_failed',
              'Hindi makuha ang transcript. Subukan muli.',
            ),
          });
        }
        const cancellation = cancelCaptureOnce(session);
        void enqueueResource(async () => cancellation).catch(() => undefined);
        return;
      }

      if (!isCurrent(session)) return;
      session.capture = null;
      const transcript = result.transcript;
      if (!transcript.trim()) {
        publish({
          status: 'error',
          recognizedTranscript: '',
          draft: '',
          error: {
            code: 'empty_transcript',
            message: 'Walang malinaw na narinig. Subukan muli.',
          },
        });
        return;
      }

      publish({
        status: 'review',
        recognizedTranscript: transcript,
        draft: transcript,
        error: null,
      });
    })();

    await session.stopTask;
  }

  async function startSession(session: ActiveSession): Promise<void> {
    const ready = await ensurePrepared();
    if (!ready || !isCurrent(session)) return;

    publish({ status: 'starting', prepared: true, error: null });
    try {
      await enqueueResource(async () => {
        if (!isCurrent(session)) return;
        const capture = await adapter.start((transcript) => {
          if (!isCurrent(session) || (state.status !== 'starting' && state.status !== 'recording')) return;
          publish({ recognizedTranscript: transcript });
        });
        session.capture = capture;
        if (!isCurrent(session)) {
          await cancelCaptureOnce(session);
          return;
        }

        publish({ status: 'recording', error: null });
        session.maxDurationTimer = setTimeout(() => {
          void stopSession(session);
        }, maxDurationMs);
      });
    } catch (error) {
      if (isCurrent(session)) {
        publish({
          status: 'error',
          error: adapterError(
            error,
            'speech_start_failed',
            'Hindi masimulan ang pag-record. Subukan muli.',
          ),
        });
      }
    }
  }

  function cancelSession(session: ActiveSession): Promise<void> {
    if (session.cancelled && session.cancelTask) return session.cancelTask;
    session.cancelled = true;
    generation++;
    clearMaxDurationTimer(session);

    // Begin interruption promptly. The resource queue below prevents a replacement capture
    // from starting until this cleanup and any in-flight start/stop operation have settled.
    const immediateCancellation = cancelCaptureOnce(session);
    const queuedCleanup = enqueueResource(async () => {
      await immediateCancellation;
      await cancelCaptureOnce(session);
    });

    session.cancelTask = (async () => {
      let cleanupFailed = false;
      let cleanupFailure: unknown;
      await Promise.all([
        session.startTask?.catch(() => undefined) ?? Promise.resolve(),
        queuedCleanup.catch((error) => {
          cleanupFailed = true;
          cleanupFailure = error;
        }),
      ]);

      if (!disposed && currentSession === session) {
        currentSession = null;
        const error = cleanupFailed
          ? adapterError(cleanupFailure, 'speech_cancel_failed', 'Hindi maisara ang pag-record. Subukan muli.')
          : null;
        publish({
          status: error ? 'error' : 'ready',
          recognizedTranscript: '',
          draft: '',
          prepared: initialized,
          error,
        });
      }
    })();
    return session.cancelTask;
  }

  function cancelCurrent(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (currentSession) return cancelSession(currentSession);
    return preparePromise?.then(() => undefined) ?? Promise.resolve();
  }

  function startCurrent(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (
      currentSession &&
      !currentSession.cancelled &&
      (state.status === 'preparing' || state.status === 'starting' || state.status === 'recording' || state.status === 'transcribing')
    ) {
      return currentSession.startTask ?? Promise.resolve();
    }

    const session: ActiveSession = {
      id: ++generation,
      cancelled: false,
      capture: null,
      captureCancelPromise: null,
      startTask: null,
      stopTask: null,
      cancelTask: null,
      maxDurationTimer: null,
    };
    currentSession = session;
    publish({
      status: initialized ? 'starting' : 'preparing',
      recognizedTranscript: '',
      draft: '',
      prepared: initialized,
      error: null,
    });
    session.startTask = startSession(session);
    return session.startTask;
  }

  return {
    getState() {
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      try {
        listener(state);
      } catch {
        // Isolate subscriber failures from controller behavior.
      }
      return () => listeners.delete(listener);
    },

    async initialize() {
      await ensurePrepared();
    },

    start() {
      return startCurrent();
    },

    stop() {
      if (!currentSession) return Promise.resolve();
      return stopSession(currentSession);
    },

    cancel() {
      return cancelCurrent();
    },

    cancelForBackground() {
      return cancelCurrent();
    },

    edit(draft) {
      if (state.status !== 'review') return;
      publish({ draft });
    },

    review() {
      if (state.status !== 'review' || !state.draft.trim()) return null;
      return state.draft;
    },

    async retry() {
      if (disposed) return;
      await cancelCurrent();
      if (disposed) return;
      await startCurrent();
    },

    dispose() {
      if (disposePromise) return disposePromise;
      disposed = true;
      generation++;
      const session = currentSession;
      if (session) {
        session.cancelled = true;
        clearMaxDurationTimer(session);
      }
      const immediateCancellation = session ? cancelCaptureOnce(session) : Promise.resolve();
      const pendingPreparation = preparePromise;

      publish({ status: 'disposed', prepared: false, error: null });
      disposePromise = (async () => {
        await Promise.all([
          pendingPreparation?.then(() => undefined) ?? Promise.resolve(),
          session?.startTask?.catch(() => undefined) ?? Promise.resolve(),
        ]);
        await enqueueResource(async () => {
          let cleanupFailure: unknown;
          let cleanupFailed = false;
          try {
            await immediateCancellation;
            if (session) await cancelCaptureOnce(session);
          } catch (error) {
            cleanupFailed = true;
            cleanupFailure = error;
          }
          try {
            await adapter.dispose();
          } catch (error) {
            if (!cleanupFailed) {
              cleanupFailed = true;
              cleanupFailure = error;
            }
          }
          if (cleanupFailed) {
            publish({
              status: 'disposed',
              prepared: false,
              error: adapterError(cleanupFailure, 'speech_dispose_failed', 'Hindi maisara ang speech recognition.'),
            });
          }
        });
        initialized = false;
      })();
      return disposePromise;
    },
  };
}
