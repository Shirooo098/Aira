import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { prepareAgentTool } from '../src/actions/agent-tools.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import type { DatabaseSession } from '../src/db/database.ts';
import {
  createAgentSession,
  type AgentRuntime,
} from '../src/agent/agent-session.ts';
import type { AgentPrompt } from '../src/agent/agent-contract.ts';

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
  initializeError: Error | null = null;
  nextOutput = '{"tool":"catalog_lookup","query":"Coke 250 ml"}';
  generation: Promise<string> | null = null;
  rejectGeneration: ((error: Error) => void) | null = null;

  async initialize(): Promise<void> {
    this.initializeCalls++;
    if (this.initializeError) throw this.initializeError;
  }

  generate(prompt: AgentPrompt, options: { maxTokens: number }): Promise<string> {
    this.generateCalls++;
    this.lastPrompt = prompt;
    this.lastMaxTokens = options.maxTokens;
    if (this.generation) return this.generation;
    return Promise.resolve(this.nextOutput);
  }

  async cancel(): Promise<void> {
    this.cancelCalls++;
    this.rejectGeneration?.(new Error('cancelled'));
  }

  async dispose(): Promise<void> { this.disposeCalls++; }
}

async function createDatabase(t: TestContext): Promise<{ db: DatabaseSession; sqlite: DatabaseSync }> {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await saveProduct(db, { name: 'Coke', variant: '250 ml', unit: 'bote', priceCentavos: 1550 });
  return { db, sqlite };
}

async function snapshotBusinessTables(db: DatabaseSession): Promise<Record<string, unknown[]>> {
  const tables = ['products', 'product_aliases', 'stock_levels', 'inventory_movements', 'sales', 'sale_items', 'pending_gcash_drafts'];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) result[table] = await db.getAll(`SELECT * FROM ${table} ORDER BY rowid;`);
  return result;
}

function createSession(runtime: AgentRuntime, db: DatabaseSession, timeoutMs = 30_000) {
  return createAgentSession({
    runtime,
    timeoutMs,
    execute: (request) => prepareAgentTool(db, request),
  });
}

test('one bounded local generation produces a real read-only catalog result and preserves output/timings', async (t) => {
  const { db } = await createDatabase(t);
  const before = await snapshotBusinessTables(db);
  const runtime = new FakeRuntime();
  const session = createSession(runtime, db);
  await session.initialize();
  await session.run('Magkano ang Coke 250 ml?', { source: 'typed input' });

  const state = session.getState();
  assert.equal(state.status, 'proposal');
  assert.equal(state.rawOutput, runtime.nextOutput);
  assert.equal(state.result?.kind, 'catalog_lookup');
  assert.equal(state.inferenceMs !== null, true);
  assert.equal(state.elapsedMs !== null, true);
  assert.equal(runtime.initializeCalls, 1);
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.lastMaxTokens, 128);
  assert.equal(runtime.lastPrompt?.messages[0]?.role, 'system');
  assert.deepEqual(await snapshotBusinessTables(db), before);
  await session.close();
});

test('a cart proposal requires explicit owner review and never saves a sale', async (t) => {
  const { db } = await createDatabase(t);
  const before = await snapshotBusinessTables(db);
  const runtime = new FakeRuntime();
  runtime.nextOutput = '{"tool":"propose_cart_item","query":"Coke 250 ml","quantity":2}';
  const session = createSession(runtime, db);
  await session.initialize();
  await session.run('Pabili ng dalawang Coke');
  assert.equal(session.getState().status, 'proposal');
  assert.equal(session.getState().result?.kind, 'cart_item_proposal');

  const reviewed = session.reviewCart();
  assert.equal(reviewed?.quantity, 2);
  assert.equal(reviewed?.product.name, 'Coke');
  assert.equal(session.getState().status, 'reviewed');
  assert.deepEqual(await snapshotBusinessTables(db), before);
  await session.close();
});

test('malformed model output is shown with a useful error and never falls back to a template result', async (t) => {
  const { db } = await createDatabase(t);
  const runtime = new FakeRuntime();
  runtime.nextOutput = 'I think you want one Coke';
  let executionCount = 0;
  const session = createAgentSession({
    runtime,
    execute: async (request) => { executionCount++; return prepareAgentTool(db, request); },
  });
  await session.initialize();
  await session.run('Pabili ng Coke');
  const state = session.getState();
  assert.equal(state.status, 'error');
  assert.equal(state.rawOutput, runtime.nextOutput);
  assert.match(state.error ?? '', /JSON/u);
  assert.equal(state.result, null);
  assert.equal(executionCount, 0);
  await session.close();
});

test('editing invalidates a pending response and prevents a second overlapping generation', async (t) => {
  const { db } = await createDatabase(t);
  const runtime = new FakeRuntime();
  const gate = deferred<string>();
  runtime.generation = gate.promise;
  runtime.rejectGeneration = gate.reject;
  const session = createSession(runtime, db);
  await session.initialize();
  const oldRun = session.run('first request');
  await Promise.resolve();
  session.edit();
  const attemptedOverlap = session.run('second request');
  assert.equal(runtime.generateCalls, 1);
  gate.resolve('{"tool":"catalog_lookup","query":"Coke 250 ml"}');
  await Promise.all([oldRun, attemptedOverlap]);
  assert.equal(session.getState().status, 'ready');
  assert.equal(session.getState().result, null);
  assert.equal(runtime.generateCalls, 1);
  await session.close();
});

test('background cancellation drains active generation before the session can run again', async (t) => {
  const { db } = await createDatabase(t);
  const runtime = new FakeRuntime();
  const gate = deferred<string>();
  runtime.generation = gate.promise;
  runtime.rejectGeneration = gate.reject;
  const session = createSession(runtime, db);
  await session.initialize();
  const pending = session.run('first request');
  await Promise.resolve();
  const background = session.background();
  assert.equal(session.getState().result, null);
  gate.resolve('{"tool":"catalog_lookup","query":"Coke 250 ml"}');
  await Promise.all([pending, background]);
  assert.equal(session.getState().status, 'ready');
  assert.equal(runtime.generateCalls, 1);
  await session.close();
});

test('timeout cancels and drains one generation, then publishes an explicit failure', async (t) => {
  const { db } = await createDatabase(t);
  const runtime = new FakeRuntime();
  runtime.generation = new Promise<string>((_resolve, reject) => { runtime.rejectGeneration = reject; });
  const session = createSession(runtime, db, 5);
  await session.initialize();
  await session.run('slow request');
  assert.equal(runtime.generateCalls, 1);
  assert.equal(runtime.cancelCalls, 1);
  assert.equal(session.getState().status, 'error');
  assert.match(session.getState().error ?? '', /Lumampas/u);
  assert.equal(session.getState().inferenceMs, 5);
  await session.close();
});

test('initialize failure is explicit and does not generate fallback content', async (t) => {
  const { db } = await createDatabase(t);
  const runtime = new FakeRuntime();
  runtime.initializeError = new Error('bundled model unavailable');
  const session = createSession(runtime, db);
  await session.initialize();
  assert.equal(session.getState().status, 'error');
  assert.match(session.getState().error ?? '', /bundled model unavailable/u);
  assert.equal(runtime.generateCalls, 0);
  await session.close();
});

test('close cancels and drains generation before disposing the runtime', async (t) => {
  const { db } = await createDatabase(t);
  const runtime = new FakeRuntime();
  const gate = deferred<string>();
  runtime.generation = gate.promise;
  runtime.rejectGeneration = gate.reject;
  const session = createSession(runtime, db);
  await session.initialize();
  const pending = session.run('request');
  await Promise.resolve();
  await session.close();
  await pending;
  assert.equal(session.getState().status, 'disposed');
  assert.equal(runtime.cancelCalls, 1);
  assert.equal(runtime.disposeCalls, 1);
});
