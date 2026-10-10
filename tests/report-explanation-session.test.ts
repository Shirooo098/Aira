import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createReportExplanationSession,
  type ReportExplanationSessionState,
} from '../src/agent/report-explanation-session.ts';
import type { AgentRuntime } from '../src/agent/agent-session.ts';
import type { AgentPrompt } from '../src/agent/agent-contract.ts';
import type { StoreReport } from '../src/domain/reports.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class FakeRuntime implements AgentRuntime {
  initializeCalls = 0;
  generateCalls = 0;
  cancelCalls = 0;
  disposeCalls = 0;
  lastPrompt: AgentPrompt | null = null;
  lastMaxTokens: number | null = null;
  output: unknown = '{"focus":["sales"]}';
  initialization: Promise<void> | null = null;
  generation: Promise<string> | null = null;
  generationForCall: ((callNumber: number) => Promise<string>) | null = null;
  onCancel: (() => void) | null = null;

  initialize(): Promise<void> {
    this.initializeCalls++;
    return this.initialization ?? Promise.resolve();
  }

  generate(prompt: AgentPrompt, options: { maxTokens: number }): Promise<string> {
    this.generateCalls++;
    this.lastPrompt = prompt;
    this.lastMaxTokens = options.maxTokens;
    if (this.generationForCall) return this.generationForCall(this.generateCalls);
    return this.generation ?? Promise.resolve(this.output as string);
  }

  async cancel(): Promise<void> {
    this.cancelCalls++;
    this.onCancel?.();
  }

  async dispose(): Promise<void> { this.disposeCalls++; }
}

type ReportOverrides = Omit<Partial<StoreReport>, 'period' | 'collectionBreakdown'> & {
  period?: Partial<StoreReport['period']>;
  collectionBreakdown?: Partial<StoreReport['collectionBreakdown']>;
};

function makeReport(overrides: ReportOverrides = {}): StoreReport {
  const base: StoreReport = {
    period: {
      periodKey: 'today',
      labelFilipino: 'Ngayong Araw (Today)',
      startUtcIso: '2026-10-09T16:00:00.000Z',
      endUtcIso: '2026-10-10T06:00:00.000Z',
      startManilaDate: '2026-10-10',
      endManilaDate: '2026-10-10',
    },
    asOfUtcIso: '2026-10-10T06:00:00.000Z',
    netSalesCentavos: 0,
    grossSalesCentavos: 0,
    cancelledSalesCentavos: 0,
    salesCount: 0,
    cancelledSalesCount: 0,
    collectionBreakdown: {
      cashSalesCentavos: 0,
      cashRepaymentsCentavos: 0,
      gcashSalesCentavos: 0,
      gcashRepaymentsCentavos: 0,
    },
    cashCollectionsCentavos: 0,
    gcashCollectionsCentavos: 0,
    totalCollectionsCentavos: 0,
    newCreditCentavos: 0,
    currentOutstandingCreditCentavos: 0,
    stockNowUnits: 0,
    topProducts: [],
  };
  return {
    ...base,
    ...overrides,
    period: { ...base.period, ...overrides.period },
    collectionBreakdown: { ...base.collectionBreakdown, ...overrides.collectionBreakdown },
    topProducts: overrides.topProducts?.map((product) => ({ ...product })) ?? base.topProducts,
  };
}

function activeReport(): StoreReport {
  return makeReport({
    netSalesCentavos: 1550,
    grossSalesCentavos: 1550,
    salesCount: 1,
    collectionBreakdown: { cashSalesCentavos: 1550 },
    cashCollectionsCentavos: 1550,
    totalCollectionsCentavos: 1550,
    topProducts: [{
      productId: 'private-product-id',
      productName: 'Secret product label',
      variant: 'secret variant',
      unit: 'piraso',
      unitsSold: 1,
      revenueCentavos: 1550,
    }],
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20 && !predicate(); attempt++) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.equal(predicate(), true, 'expected fake runtime operation to start');
}

test('an empty period completes with every deterministic fact and skips the native runtime', async () => {
  const runtime = new FakeRuntime();
  const session = createReportExplanationSession({ report: makeReport(), runtime });

  await session.run();

  const state = session.getState();
  assert.equal(state.status, 'complete');
  assert.equal(state.evidence.hasPeriodActivity, false);
  assert.deepEqual(state.points, state.evidence.facts);
  assert.equal(runtime.initializeCalls, 0);
  assert.equal(runtime.generateCalls, 0);
  assert.equal(state.initializationMs, null);
  assert.equal(state.inferenceMs, null);
  await session.dispose();
});

test('generation uses the immutable aggregate snapshot and renders grounded facts', async () => {
  const report = activeReport();
  const runtime = new FakeRuntime();
  const session = createReportExplanationSession({ report, runtime });

  report.netSalesCentavos = 999999;
  report.topProducts[0]!.productName = 'Mutated name';
  await session.run();

  const state = session.getState();
  assert.equal(state.status, 'complete');
  assert.equal(state.evidence.report.netSalesCentavos, 1550);
  assert.equal(state.points.length, 8);
  assert.equal(state.points[0]?.id, 'sales');
  assert.equal(runtime.initializeCalls, 1);
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.lastMaxTokens, 128);
  const promptText = runtime.lastPrompt?.messages.map((message) => message.content).join('\n') ?? '';
  assert.doesNotMatch(promptText, /private-product-id|Secret product label|secret variant|Mutated name/u);

  state.evidence.report.netSalesCentavos = 1;
  assert.equal(session.getState().evidence.report.netSalesCentavos, 1550);
  await session.dispose();
});

test('invalid JSON and duplicate focus IDs fail closed with no explanation points', async (t) => {
  for (const [name, output, expected] of [
    ['invalid JSON', 'not JSON', /JSON/u],
    ['duplicate IDs', '{"focus":["sales","sales"]}', /dobleng fact ID/u],
  ] as const) {
    await t.test(name, async () => {
      const runtime = new FakeRuntime();
      runtime.output = output;
      const session = createReportExplanationSession({ report: activeReport(), runtime });

      await session.run();

      assert.equal(session.getState().status, 'error');
      assert.match(session.getState().error ?? '', expected);
      assert.equal(session.getState().rawOutput, output);
      assert.deepEqual(session.getState().points, []);
      await session.dispose();
    });
  }
});

test('oversized model output is rejected before it can enter session state', async () => {
  const runtime = new FakeRuntime();
  runtime.output = 'x'.repeat(2049);
  const session = createReportExplanationSession({ report: activeReport(), runtime });

  await session.run();

  assert.equal(session.getState().status, 'error');
  assert.match(session.getState().error ?? '', /Masyadong mahaba/u);
  assert.equal(session.getState().rawOutput.length, 0);
  await session.dispose();
});

test('cancel during initialization drains the operation and prevents generation', async () => {
  const runtime = new FakeRuntime();
  const initialization = deferred<void>();
  runtime.initialization = initialization.promise;
  const session = createReportExplanationSession({ report: activeReport(), runtime });
  const running = session.run();
  await waitFor(() => runtime.initializeCalls === 1);

  const cancelling = session.cancel();
  initialization.resolve();
  await Promise.all([running, cancelling]);

  assert.equal(runtime.cancelCalls, 1);
  assert.equal(runtime.generateCalls, 0);
  assert.equal(session.getState().status, 'idle');
  assert.deepEqual(session.getState().points, []);
  await session.dispose();
});

test('cancel during generation drains the response and prevents late publication', async () => {
  const runtime = new FakeRuntime();
  const generation = deferred<string>();
  runtime.generation = generation.promise;
  const session = createReportExplanationSession({ report: activeReport(), runtime });
  const running = session.run();
  await waitFor(() => runtime.generateCalls === 1);

  const cancelling = session.cancel();
  generation.resolve('{"focus":["sales"]}');
  await Promise.all([running, cancelling]);

  assert.equal(runtime.cancelCalls, 1);
  assert.equal(session.getState().status, 'idle');
  assert.deepEqual(session.getState().points, []);
  await session.dispose();
});

test('a rerun waits for cancellation and drains the previous generation first', async () => {
  const runtime = new FakeRuntime();
  const firstGeneration = deferred<string>();
  const secondGeneration = deferred<string>();
  runtime.generationForCall = (callNumber) => callNumber === 1
    ? firstGeneration.promise
    : secondGeneration.promise;
  const session = createReportExplanationSession({ report: activeReport(), runtime });
  const firstRun = session.run();
  await waitFor(() => runtime.generateCalls === 1);

  const secondRun = session.run();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(runtime.generateCalls, 1);
  firstGeneration.resolve('{"focus":["sales"]}');
  await waitFor(() => runtime.generateCalls === 2);
  secondGeneration.resolve('{"focus":["cash"]}');
  await Promise.all([firstRun, secondRun]);

  assert.equal(runtime.cancelCalls, 1);
  assert.equal(session.getState().status, 'complete');
  assert.equal(session.getState().points[0]?.id, 'cash');
  await session.dispose();
});

test('the overall timeout includes initialization and reports an explicit failure', async () => {
  const runtime = new FakeRuntime();
  const initialization = deferred<void>();
  runtime.initialization = initialization.promise;
  runtime.onCancel = () => initialization.reject(new Error('cancelled'));
  const session = createReportExplanationSession({ report: activeReport(), runtime, timeoutMs: 10 });

  await session.run();

  assert.equal(runtime.initializeCalls, 1);
  assert.equal(runtime.generateCalls, 0);
  assert.equal(runtime.cancelCalls, 1);
  assert.equal(session.getState().status, 'error');
  assert.match(session.getState().error ?? '', /Lumampas/u);
  assert.equal(session.getState().initializationMs !== null, true);
  await session.dispose();
});

test('timeout becomes visible while an unresponsive initialization is still draining', async () => {
  const runtime = new FakeRuntime();
  const initialization = deferred<void>();
  runtime.initialization = initialization.promise;
  const session = createReportExplanationSession({ report: activeReport(), runtime, timeoutMs: 10 });
  const running = session.run();

  await waitFor(() => session.getState().status === 'error');
  assert.match(session.getState().error ?? '', /Lumampas/u);
  assert.equal(runtime.generateCalls, 0);
  assert.equal(runtime.disposeCalls, 0);

  const disposing = session.dispose();
  initialization.resolve();
  await Promise.all([running, disposing]);
  assert.equal(runtime.disposeCalls, 1);
  assert.equal(session.getState().status, 'disposed');
});

test('the overall timeout cancels and drains a hung generation', async () => {
  const runtime = new FakeRuntime();
  const generation = deferred<string>();
  runtime.generation = generation.promise;
  runtime.onCancel = () => generation.reject(new Error('cancelled'));
  const session = createReportExplanationSession({ report: activeReport(), runtime, timeoutMs: 10 });

  await session.run();

  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.cancelCalls, 1);
  assert.equal(session.getState().status, 'error');
  assert.match(session.getState().error ?? '', /Lumampas/u);
  assert.deepEqual(session.getState().points, []);
  await session.dispose();
});

test('dispose waits for late generation and keeps the disposed state terminal', async () => {
  const runtime = new FakeRuntime();
  const generation = deferred<string>();
  runtime.generation = generation.promise;
  const session = createReportExplanationSession({ report: activeReport(), runtime });
  const observed: ReportExplanationSessionState['status'][] = [];
  session.subscribe((state) => observed.push(state.status));
  const running = session.run();
  await waitFor(() => runtime.generateCalls === 1);

  const disposing = session.dispose();
  const eventCountAfterDispose = observed.length;
  assert.equal(session.getState().status, 'disposed');
  generation.resolve('{"focus":["sales"]}');
  await Promise.all([running, disposing]);

  assert.equal(runtime.cancelCalls, 1);
  assert.equal(runtime.disposeCalls, 1);
  assert.equal(session.getState().status, 'disposed');
  assert.equal(observed.length, eventCountAfterDispose);
});
