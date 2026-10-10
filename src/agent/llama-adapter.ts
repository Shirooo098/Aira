import { Platform } from 'react-native';
import type { AgentRuntime } from './agent-session.ts';
import type { AgentPrompt } from './agent-contract.ts';

const MODEL_ASSET_PATH = 'models/aira-qwen.gguf';
const MODEL_FILE_NAME = 'aira-qwen-9465e63a22add5354d9bb4b99e90117043c7124007664907259bd16d043bb031.gguf';
const MODEL_BYTES = 639_446_688;
const MAX_GENERATION_TOKENS = 128;
const MODEL_CONTEXT_TOKENS = 1024;
const MODEL_CPU_THREADS = 4;

type LlamaContext = Awaited<ReturnType<(typeof import('llama.rn'))['initLlama']>>;
type CompletionResult = Awaited<ReturnType<LlamaContext['completion']>>;

let activeModelLease: symbol | null = null;

const toolRequestSchema: Record<string, unknown> = {
  type: 'object',
  anyOf: [
    {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['catalog_lookup'] },
        query: { type: 'string', minLength: 1, maxLength: 120 },
      },
      required: ['tool', 'query'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['propose_cart_item'] },
        query: { type: 'string', minLength: 1, maxLength: 120 },
        quantity: { type: 'integer', minimum: 1 },
      },
      required: ['tool', 'query', 'quantity'],
      additionalProperties: false,
    },
  ],
};

async function ensurePrivateModelCopy(): Promise<string> {
  const fileSystem = await import('expo-file-system/legacy');
  if (!fileSystem.bundleDirectory || !fileSystem.documentDirectory) {
    throw new Error('Hindi available ang naka-bundle na local model storage sa Android app. Gumamit ng Aira development o release build.');
  }

  const directory = (value: string) => value.endsWith('/') ? value : `${value}/`;
  const destination = `${directory(fileSystem.documentDirectory)}${MODEL_FILE_NAME}`;
  const temporary = `${destination}.partial`;
  const existing = await fileSystem.getInfoAsync(destination);
  if (existing.exists && existing.size === MODEL_BYTES) return destination;

  await fileSystem.deleteAsync(destination, { idempotent: true });
  await fileSystem.deleteAsync(temporary, { idempotent: true });

  try {
    await fileSystem.copyAsync({
      from: `${directory(fileSystem.bundleDirectory)}${MODEL_ASSET_PATH}`,
      to: temporary,
    });
    const copied = await fileSystem.getInfoAsync(temporary);
    if (!copied.exists || copied.size !== MODEL_BYTES) {
      throw new Error(`Expected ${MODEL_BYTES} bytes but the bundled model copy was ${copied.exists ? copied.size : 'missing'}.`);
    }
    await fileSystem.moveAsync({ from: temporary, to: destination });
  } catch (error) {
    await fileSystem.deleteAsync(temporary, { idempotent: true }).catch(() => undefined);
    throw new Error('Hindi makopya ang naka-bundle na Qwen model sa app storage. Tiyaking kasama ang model sa Android build at may sapat na free storage.', { cause: error });
  }

  return destination;
}

function canceledError(): Error {
  return new Error('Kinansela ang lokal na model generation.');
}

/** Local-only llama.rn adapter. It never accepts a model path or network endpoint from callers. */
export function createLlamaAgentAdapter(): AgentRuntime {
  const modelLeaseToken = Symbol('aira-local-agent-model-session');
  let context: LlamaContext | null = null;
  let initializing: Promise<void> | null = null;
  let activeCompletion: { context: LlamaContext; promise: Promise<CompletionResult> } | null = null;
  let stopPromise: Promise<void> | null = null;
  let cancelRevision = 0;
  let disposed = false;
  let disposePromise: Promise<void> | null = null;

  async function stopActiveCompletion(modelContext: LlamaContext): Promise<void> {
    const active = activeCompletion;
    if (!active || active.context !== modelContext) return;

    if (!stopPromise) {
      stopPromise = modelContext.stopCompletion().finally(() => {
        stopPromise = null;
      });
    }

    let stopError: unknown;
    try {
      await stopPromise;
    } catch (error) {
      stopError = error;
    }
    await active.promise.catch(() => undefined);
    if (stopError) throw stopError;
  }

  async function initializeNativeContext(): Promise<void> {
    if (disposed) throw new Error('Sarado na ang lokal na agent runtime.');
    if (Platform.OS !== 'android') {
      throw new Error('Kailangan ng Android development o release build para magamit ang naka-bundle na local Qwen model.');
    }
    if (activeModelLease && activeModelLease !== modelLeaseToken) {
      throw new Error('May kasalukuyang local model session. Isara muna ito bago magsimula ng panibagong session.');
    }

    activeModelLease = modelLeaseToken;
    try {
      const llama = await import('llama.rn');
      if (disposed) throw new Error('Sarado na ang lokal na agent runtime.');
      const model = await ensurePrivateModelCopy();
      if (disposed) throw new Error('Sarado na ang lokal na agent runtime.');

      const loaded = await llama.initLlama({
        model,
        is_model_asset: false,
        n_ctx: MODEL_CONTEXT_TOKENS,
        n_threads: MODEL_CPU_THREADS,
        use_mmap: true,
      });
      context = loaded;
      if (disposed) throw new Error('Sarado na ang lokal na agent runtime.');
    } catch (error) {
      if (!context && activeModelLease === modelLeaseToken) activeModelLease = null;
      throw error;
    }
  }

  function initialize(): Promise<void> {
    if (disposed) return Promise.reject(new Error('Sarado na ang lokal na agent runtime.'));
    if (context) return Promise.resolve();
    if (initializing) return initializing;

    let pending: Promise<void>;
    pending = initializeNativeContext().finally(() => {
      if (initializing === pending) initializing = null;
    });
    initializing = pending;
    return pending;
  }

  async function generate(prompt: AgentPrompt, options: { maxTokens: number }): Promise<string> {
    if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1 || options.maxTokens > MAX_GENERATION_TOKENS) {
      throw new Error(`Nililimitahan ang agent output sa ${MAX_GENERATION_TOKENS} tokens bawat request.`);
    }
    const revision = cancelRevision;
    await initialize();
    if (disposed || revision !== cancelRevision) throw canceledError();

    const modelContext = context;
    if (!modelContext) throw new Error('Hindi handa ang local model context.');
    if (activeCompletion) throw new Error('May tumatakbong local model request na.');

    const completion = (async () => {
      // Format the model's chat prompt without installing a template-generated
      // tool-call grammar/parser. Completion receives only the plain prompt and
      // our JSON schema, so the schema constrains the entire generated answer.
      const formatted = await modelContext.getFormattedChat(
        prompt.messages.map((message) => ({ ...message })),
        undefined,
        { jinja: false, enable_thinking: false },
      );
      if (disposed || revision !== cancelRevision) throw canceledError();
      return modelContext.completion({
        prompt: formatted.prompt,
        n_predict: options.maxTokens,
        temperature: 0,
        grammar_lazy: false,
        response_format: {
          type: 'json_schema',
          json_schema: { schema: toolRequestSchema, strict: true },
        },
      });
    })();
    const active = { context: modelContext, promise: completion };
    activeCompletion = active;
    try {
      const result = await completion;
      if (disposed || revision !== cancelRevision) throw canceledError();
      // No chat-output parser is installed: the whole generated text must be JSON.
      return result.text;
    } finally {
      if (activeCompletion === active) activeCompletion = null;
    }
  }

  async function cancel(): Promise<void> {
    cancelRevision += 1;
    const modelContext = context;
    if (modelContext) await stopActiveCompletion(modelContext);
  }

  function dispose(): Promise<void> {
    if (disposePromise) return disposePromise;
    disposed = true;
    cancelRevision += 1;

    disposePromise = (async () => {
      if (initializing) await initializing.catch(() => undefined);
      const modelContext = context;
      context = null;
      let failure: unknown;
      let released = false;
      if (modelContext) {
        try {
          await stopActiveCompletion(modelContext);
        } catch (error) {
          failure = error;
        }
        try {
          await modelContext.release();
          released = true;
        } catch (error) {
          failure ??= error;
        }
      }
      if ((!modelContext || released) && activeModelLease === modelLeaseToken) activeModelLease = null;
      if (failure) throw failure;
    })();
    return disposePromise;
  }

  return { initialize, generate, cancel, dispose };
}
