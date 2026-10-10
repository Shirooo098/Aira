import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount } from '../src/actions/inventory-actions.ts';
import { completeCashSale } from '../src/actions/sales-actions.ts';
import {
  createRestockSession,
  type RestockSessionState,
} from '../src/agent/restock-session.ts';
import type { AgentRuntime } from '../src/agent/agent-session.ts';
import type { AgentPrompt } from '../src/agent/agent-contract.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

class FakeRestockRuntime implements AgentRuntime {
  initializeCalls = 0;
  generateCalls = 0;
  cancelCalls = 0;
  disposeCalls = 0;
  lastPrompt: AgentPrompt | null = null;
  lastMaxTokens: number | null = null;
  output = '{"priorityProductIds":["prod_coke"]}';
  initialization: Promise<void> | null = null;
  generation: Promise<string> | null = null;
  onCancel: (() => void) | null = null;

  initialize(): Promise<void> {
    this.initializeCalls++;
    return this.initialization ?? Promise.resolve();
  }

  generate(prompt: AgentPrompt, options: { maxTokens: number }): Promise<string> {
    this.generateCalls++;
    this.lastPrompt = prompt;
    this.lastMaxTokens = options.maxTokens;
    return this.generation ?? Promise.resolve(this.output);
  }

  async cancel(): Promise<void> {
    this.cancelCalls++;
    this.onCancel?.();
  }

  async dispose(): Promise<void> {
    this.disposeCalls++;
  }
}

async function createPopulatedDb(t: test.TestContext) {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const coke = await saveProduct(db, {
    name: 'Coke',
    variant: '1.5L',
    unit: 'bote',
    priceCentavos: 7500,
  });
  const sprite = await saveProduct(db, {
    name: 'Sprite',
    variant: '1.5L',
    unit: 'bote',
    priceCentavos: 7500,
  });

  await setStockCount(db, { productId: coke.id, newQuantity: 11 });
  await setStockCount(db, { productId: sprite.id, newQuantity: 0 });

  await completeCashSale(db, {
    items: [{ productId: coke.id, quantity: 10 }],
    tenderCentavos: 75000,
  });

  return { syncDb, db, coke, sprite };
}

test('runs restock session and prioritizes model-selected candidate items', async (t) => {
  const { db, coke } = await createPopulatedDb(t);
  const runtime = new FakeRestockRuntime();
  runtime.output = JSON.stringify({ priorityProductIds: [coke.id] });

  const states: RestockSessionState[] = [];
  const session = createRestockSession({
    db,
    runtime,
    periodKey: 'today',
  });
  session.subscribe((s) => states.push(s));

  await session.run();

  const finalState = session.getState();
  assert.equal(finalState.status, 'complete');
  assert.ok(finalState.checklist);
  assert.equal(finalState.prioritizedCount, 1);
  assert.equal(finalState.checklist.items[0]?.productId, coke.id);
  assert.equal(finalState.checklist.items[0]?.isPriority, true);
  assert.equal(runtime.initializeCalls, 1);
  assert.equal(runtime.generateCalls, 1);

  // States transitioned through initializing and generating
  const statuses = states.map((s) => s.status);
  assert.ok(statuses.includes('initializing'));
  assert.ok(statuses.includes('generating'));
  assert.ok(statuses.includes('complete'));
});

test('completes immediately without calling model if no restock candidates exist', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // No products exist in db
  const runtime = new FakeRestockRuntime();
  const session = createRestockSession({ db, runtime, periodKey: 'today' });

  await session.run();

  const finalState = session.getState();
  assert.equal(finalState.status, 'complete');
  assert.equal(finalState.checklist?.items.length, 0);
  assert.equal(runtime.initializeCalls, 0);
  assert.equal(runtime.generateCalls, 0);
});

test('handles cancel gracefully during model generation', async (t) => {
  const { db, coke } = await createPopulatedDb(t);
  const runtime = new FakeRestockRuntime();
  const genDeferred = deferred<string>();
  runtime.generation = genDeferred.promise;

  const session = createRestockSession({ db, runtime, periodKey: 'today' });

  runtime.onCancel = () => {
    genDeferred.resolve(JSON.stringify({ priorityProductIds: [coke.id] }));
  };

  const runPromise = session.run();
  // Wait a tick for run to start
  await new Promise((r) => setTimeout(r, 10));

  await session.cancel();
  await runPromise.catch(() => undefined);

  assert.equal(runtime.cancelCalls, 1);
  assert.ok(['idle', 'error', 'complete'].includes(session.getState().status));
});

test('recovers from model generation failure by preserving draft checklist', async (t) => {
  const { db } = await createPopulatedDb(t);
  const runtime = new FakeRestockRuntime();
  runtime.generation = Promise.reject(new Error('Inference failure'));

  const session = createRestockSession({ db, runtime, periodKey: 'today' });
  await session.run();

  const finalState = session.getState();
  assert.equal(finalState.status, 'error');
  assert.match(finalState.error ?? '', /Inference failure/);
  // Draft checklist is STILL preserved!
  assert.ok(finalState.checklist);
  assert.ok(finalState.checklist.items.length >= 1);
});
