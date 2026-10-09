import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSpeechSessionController,
  type SpeechAdapter,
  type SpeechCapture,
  type SpeechSessionState,
} from '../src/speech/speech-session.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function waitFor(assertion: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!assertion()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${message}`);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

function captureWith(text: string): SpeechCapture {
  return { stop: async () => text, cancel: async () => undefined };
}

function adapterWith(start: SpeechAdapter['start']): SpeechAdapter {
  return { prepare: async () => undefined, start, dispose: async () => undefined };
}

test('prepares once, keeps recognition separate from edits, and returns only explicit review', async () => {
  let prepareCalls = 0;
  let partial: ((transcript: string) => void) | undefined;
  const controller = createSpeechSessionController({
    async prepare() { prepareCalls++; },
    async start(onPartial) {
      partial = onPartial;
      return captureWith('Pabili po ng dalawang Coke');
    },
    async dispose() {},
  });
  const seen: SpeechSessionState[] = [];
  const unsubscribe = controller.subscribe((state) => seen.push(state));

  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().prepared, false);
  await Promise.all([controller.initialize(), controller.initialize()]);
  assert.equal(prepareCalls, 1);
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().prepared, true);

  await controller.start();
  assert.equal(controller.getState().status, 'recording');
  partial?.('Pabili po ng dalawang');
  assert.equal(controller.getState().recognizedTranscript, 'Pabili po ng dalawang');
  assert.equal(controller.getState().draft, '');
  assert.equal(controller.review(), null);

  await controller.stop();
  assert.equal(controller.getState().status, 'review');
  assert.equal(controller.getState().recognizedTranscript, 'Pabili po ng dalawang Coke');
  assert.equal(controller.getState().draft, 'Pabili po ng dalawang Coke');
  controller.edit('Pabili po ng isang Coke');
  assert.equal(controller.getState().recognizedTranscript, 'Pabili po ng dalawang Coke');
  assert.equal(controller.review(), 'Pabili po ng isang Coke');
  controller.edit('   ');
  assert.equal(controller.review(), null);
  assert.ok(seen.some((state) => state.status === 'transcribing'));
  unsubscribe();
  await controller.dispose();
});

test('review callback receives only the exact current nonblank draft after explicit review', async () => {
  const reviewed: string[] = [];
  const partials: Array<((transcript: string) => void) | undefined> = [];
  let starts = 0;
  const controller = createSpeechSessionController({
    async prepare() {},
    async start(onPartial) {
      starts++;
      partials.push(onPartial);
      return captureWith(starts === 1 ? 'recognized draft' : 'retry draft');
    },
    async dispose() {},
  }, { onReviewedTranscript: (text) => reviewed.push(text) });

  assert.equal(controller.review(), null);
  await controller.start();
  partials[0]?.('partial recognition');
  assert.deepEqual(reviewed, []);
  await controller.stop();
  assert.deepEqual(reviewed, []);

  assert.equal(controller.review(), 'recognized draft');
  assert.deepEqual(reviewed, ['recognized draft']);
  controller.edit('   ');
  assert.equal(controller.review(), null);
  assert.deepEqual(reviewed, ['recognized draft']);
  controller.edit('  corrected draft  ');
  assert.deepEqual(reviewed, ['recognized draft'], 'editing alone cannot dispatch a reviewed transcript');
  assert.equal(controller.review(), '  corrected draft  ');
  assert.deepEqual(reviewed, ['recognized draft', '  corrected draft  ']);

  await controller.retry();
  partials[1]?.('retry partial');
  assert.deepEqual(reviewed, ['recognized draft', '  corrected draft  ']);
  await controller.cancel();
  assert.deepEqual(reviewed, ['recognized draft', '  corrected draft  ']);

  await controller.start();
  partials[2]?.('background partial');
  await controller.cancelForBackground();
  assert.deepEqual(reviewed, ['recognized draft', '  corrected draft  ']);
  await controller.dispose();
});

test('surfaces coded microphone denial and recovers through retry; empty final text remains recoverable', async () => {
  let starts = 0;
  const controller = createSpeechSessionController(adapterWith(async () => {
    starts++;
    if (starts === 1) {
      throw Object.assign(new Error('native permission error'), { code: 'E_MICROPHONE_PERMISSION_DENIED' });
    }
    return captureWith('   ');
  }));

  await controller.start();
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error?.code, 'E_MICROPHONE_PERMISSION_DENIED');
  assert.match(controller.getState().error?.message ?? '', /pahintulot sa mikropono/i);

  await controller.retry();
  assert.equal(starts, 2);
  assert.equal(controller.getState().status, 'recording');
  await controller.stop();
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error?.code, 'empty_transcript');
  assert.match(controller.getState().error?.message ?? '', /subukan muli/i);
  await controller.dispose();
});

test('maps native speech failures to distinct Filipino recovery guidance', async () => {
  const cases = [
    ['native_unavailable', /development build/i],
    ['unsupported_audio', /audio format/i],
    ['empty_audio', /walang narinig/i],
    ['not_ready', /speech model/i],
    ['busy', /hintaying matapos/i],
  ] as const;

  for (const [code, expectedMessage] of cases) {
    const controller = createSpeechSessionController(adapterWith(async () => {
      throw Object.assign(new Error('native detail'), { code });
    }));
    await controller.start();
    assert.equal(controller.getState().status, 'error');
    assert.equal(controller.getState().error?.code, code);
    assert.match(controller.getState().error?.message ?? '', expectedMessage);
    await controller.dispose();
  }
});

test('cancelling a pending native start releases its late capture before a new start', async () => {
  const firstCapture = deferred<SpeechCapture>();
  let starts = 0;
  let firstCancelCalls = 0;
  const adapter = adapterWith(async () => {
    starts++;
    if (starts === 1) return firstCapture.promise;
    return captureWith('bagong session');
  });
  const controller = createSpeechSessionController(adapter);
  await controller.initialize();

  const firstStart = controller.start();
  await waitFor(() => starts === 1, 'first native start');
  const cancellation = controller.cancel();
  const nextStart = controller.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(starts, 1, 'a second capture must wait for the unresolved first start');

  firstCapture.resolve({
    stop: async () => 'stale text',
    cancel: async () => { firstCancelCalls++; },
  });
  await Promise.all([firstStart, cancellation, nextStart]);
  assert.equal(firstCancelCalls, 1);
  assert.equal(starts, 2);
  assert.equal(controller.getState().status, 'recording');
  assert.equal(controller.getState().recognizedTranscript, '');
  await controller.dispose();
});

test('cancel during preparation suppresses the old start while a fresh start reuses preparation', async () => {
  const pendingPreparation = deferred<void>();
  let prepareCalls = 0;
  let startCalls = 0;
  const controller = createSpeechSessionController({
    prepare: async () => { prepareCalls++; await pendingPreparation.promise; },
    start: async () => { startCalls++; return captureWith('fresh capture'); },
    dispose: async () => undefined,
  });

  const firstStart = controller.start();
  await waitFor(() => prepareCalls === 1, 'model preparation');
  const cancellation = controller.cancel();
  const freshStart = controller.start();
  pendingPreparation.resolve();
  await Promise.all([firstStart, cancellation, freshStart]);

  assert.equal(prepareCalls, 1);
  assert.equal(startCalls, 1);
  assert.equal(controller.getState().status, 'recording');
  await controller.dispose();
});

test('duplicate starts reuse one capture and callbacks from a discarded session stay stale', async () => {
  let starts = 0;
  let cancelCalls = 0;
  const partials: Array<((transcript: string) => void) | undefined> = [];
  const controller = createSpeechSessionController({
    prepare: async () => undefined,
    async start(onPartial) {
      starts++;
      partials.push(onPartial);
      return {
        stop: async () => '',
        cancel: async () => { cancelCalls++; },
      };
    },
    dispose: async () => undefined,
  });

  await controller.start();
  await controller.start();
  assert.equal(starts, 1);
  partials[0]?.('unang capture');
  await controller.cancel();
  await controller.start();
  assert.equal(starts, 2);
  partials[0]?.('lumang callback');
  partials[1]?.('bagong capture');
  assert.equal(cancelCalls, 1);
  assert.equal(controller.getState().recognizedTranscript, 'bagong capture');
  await controller.dispose();
});

test('background cancellation suppresses a late transcription result', async () => {
  const stopResult = deferred<string>();
  let cancelCalls = 0;
  const controller = createSpeechSessionController(adapterWith(async () => ({
    stop: () => stopResult.promise,
    cancel: async () => { cancelCalls++; stopResult.resolve('late stale transcript'); },
  })));
  await controller.start();
  const stopping = controller.stop();
  await waitFor(() => controller.getState().status === 'transcribing', 'transcription to start');

  await controller.cancelForBackground();
  await stopping;
  assert.equal(cancelCalls, 1);
  assert.equal(controller.getState().status, 'ready');
  assert.equal(controller.getState().recognizedTranscript, '');
  assert.equal(controller.getState().draft, '');
  await controller.dispose();
});

test('keeps a cancellation cleanup error visible after the session is discarded', async () => {
  const controller = createSpeechSessionController(adapterWith(async () => ({
    stop: async () => '',
    cancel: async () => { throw new Error('Hindi maisara ang mikropono.'); },
  })));
  await controller.start();

  await controller.cancel();
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().error?.code, 'speech_cancel_failed');
  assert.equal(controller.getState().error?.message, 'Hindi maisara ang mikropono.');
});

test('dispose resolves after adapter teardown failure and retains a disposed error state', async () => {
  const controller = createSpeechSessionController({
    prepare: async () => undefined,
    start: async () => captureWith(''),
    dispose: async () => { throw Object.assign(new Error('Hindi maisara ang speech engine.'), { code: 'dispose_failed' }); },
  });
  await controller.initialize();

  await assert.doesNotReject(controller.dispose());
  assert.equal(controller.getState().status, 'disposed');
  assert.equal(controller.getState().error?.code, 'dispose_failed');
  assert.equal(controller.getState().error?.message, 'Hindi maisara ang speech engine.');
});

test('automatically stops after the configured push-to-talk limit', async () => {
  let stopCalls = 0;
  const controller = createSpeechSessionController(adapterWith(async () => ({
    stop: async () => { stopCalls++; return 'hanggang dito'; },
    cancel: async () => undefined,
  })), { maxDurationMs: 12, inferenceTimeoutMs: 500 });

  await controller.start();
  await waitFor(() => controller.getState().status === 'review', 'automatic final transcript');
  assert.equal(stopCalls, 1);
  assert.equal(controller.getState().draft, 'hanggang dito');
  await controller.dispose();
});

test('times out inference, cancels it, and waits for stale native work before retry capture', async () => {
  const pendingStop = deferred<string>();
  let starts = 0;
  let cancelCalls = 0;
  const controller = createSpeechSessionController(adapterWith(async () => {
    starts++;
    if (starts > 1) return captureWith('retry transcript');
    return {
      stop: () => pendingStop.promise,
      cancel: async () => { cancelCalls++; },
    };
  }), { maxDurationMs: 500, inferenceTimeoutMs: 12 });

  await controller.start();
  const stopping = controller.stop();
  await waitFor(() => controller.getState().status === 'error', 'transcription timeout');
  assert.equal(controller.getState().error?.code, 'transcription_timeout');
  assert.equal(cancelCalls, 1);

  const retry = controller.retry();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(starts, 1, 'retry cannot overlap the outstanding native stop');
  pendingStop.resolve('stale transcript');
  await Promise.all([stopping, retry]);
  assert.equal(starts, 2);
  assert.equal(controller.getState().status, 'recording');
  assert.equal(controller.getState().recognizedTranscript, '');
  await controller.dispose();
});

test('dispose waits for a pending start and its capture release before adapter disposal', async () => {
  const pendingCapture = deferred<SpeechCapture>();
  const order: string[] = [];
  let startCalls = 0;
  const controller = createSpeechSessionController({
    prepare: async () => undefined,
    start: async () => { startCalls++; return pendingCapture.promise; },
    dispose: async () => { order.push('dispose'); },
  });
  await controller.initialize();
  const starting = controller.start();
  await waitFor(() => startCalls === 1, 'native start');
  const disposing = controller.dispose();
  pendingCapture.resolve({
    stop: async () => '',
    cancel: async () => { order.push('cancel'); },
  });
  await Promise.all([starting, disposing]);
  assert.deepEqual(order, ['cancel', 'dispose']);
  assert.equal(controller.getState().status, 'disposed');
  await controller.start();
  assert.deepEqual(order, ['cancel', 'dispose']);
});
