import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import type { DatabaseSession } from '../src/db/database.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { createLookupSession, type LookupState } from '../src/actions/lookup-session.ts';

function deferFirstProductRead(db: DatabaseSession) {
  let resolveRead!: () => void;
  let rejectRead!: (error: Error) => void;
  let productReads = 0;
  const firstRead = new Promise<void>((resolve, reject) => {
    resolveRead = resolve;
    rejectRead = reject;
  });

  const delayedDb: DatabaseSession = {
    exec: (sql) => db.exec(sql),
    run: (sql, params) => db.run(sql, params),
    async getAll<T>(sql: string, params?: unknown[]): Promise<T[]> {
      if (sql === 'SELECT * FROM products;' && productReads++ === 0) {
        await firstRead;
      }
      return db.getAll<T>(sql, params);
    },
    getFirst: <T>(sql: string, params?: unknown[]) => db.getFirst<T>(sql, params),
  };

  return {
    db: delayedDb,
    release: resolveRead,
    fail: rejectRead,
  };
}

test('a failed new lookup clears the last price and publishes a safe error', async () => {
  const sqlite = new DatabaseSync(':memory:');
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await saveProduct(db, { name: 'Coke', variant: '250 ml', unit: 'bottle', priceCentavos: 1550 });
  const states: LookupState[] = [];
  const lookup = createLookupSession(db, (state) => states.push(state));
  await lookup.search('Coke');
  assert.equal(states.at(-1)?.result.kind, 'exact');
  sqlite.close();
  await lookup.search('Sprite');
  assert.deepEqual(states.at(-1), {
    result: { kind: 'empty' }, loading: false,
    error: 'Hindi makuha ang presyo. Subukan muli.',
  });
});

test('clearing a query invalidates a pending SQLite lookup', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await saveProduct(db, { name: 'Coke', variant: '250 ml', unit: 'bottle', priceCentavos: 1550 });
  const states: LookupState[] = [];
  const lookup = createLookupSession(db, (state) => states.push(state));
  const pending = lookup.search('Coke');
  await lookup.search('');
  await pending;
  assert.deepEqual(states.at(-1), { result: { kind: 'empty' }, loading: false, error: null });
});

test('a newer completed query suppresses an older delayed result', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await saveProduct(db, { name: 'Coke', variant: '250 ml', unit: 'bottle', priceCentavos: 1550 });
  const sprite = await saveProduct(db, { name: 'Sprite', variant: '250 ml', unit: 'bottle', priceCentavos: 1600 });
  const delayed = deferFirstProductRead(db);
  const states: LookupState[] = [];
  const lookup = createLookupSession(delayed.db, (state) => states.push(state));

  const oldSearch = lookup.search('Coke');
  await lookup.search('Sprite');
  const currentState = states.at(-1);
  assert.equal(currentState?.result.kind, 'exact');
  if (currentState?.result.kind === 'exact') assert.equal(currentState.result.product.id, sprite.id);
  const publishedCount = states.length;

  delayed.release();
  await oldSearch;
  assert.equal(states.length, publishedCount);
  const finalState = states.at(-1);
  assert.equal(finalState?.result.kind, 'exact');
  if (finalState?.result.kind === 'exact') assert.equal(finalState.result.product.id, sprite.id);
});

test('a newer completed query suppresses an older delayed lookup error', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await saveProduct(db, { name: 'Coke', variant: '250 ml', unit: 'bottle', priceCentavos: 1550 });
  const sprite = await saveProduct(db, { name: 'Sprite', variant: '250 ml', unit: 'bottle', priceCentavos: 1600 });
  const delayed = deferFirstProductRead(db);
  const states: LookupState[] = [];
  const lookup = createLookupSession(delayed.db, (state) => states.push(state));

  const oldSearch = lookup.search('Coke');
  await lookup.search('Sprite');
  const currentState = states.at(-1);
  assert.equal(currentState?.result.kind, 'exact');
  if (currentState?.result.kind === 'exact') assert.equal(currentState.result.product.id, sprite.id);
  const publishedCount = states.length;

  delayed.fail(new Error('older SQLite read failed'));
  await oldSearch;
  assert.equal(states.length, publishedCount);
  assert.equal(states.at(-1)?.error, null);
  const finalState = states.at(-1);
  assert.equal(finalState?.result.kind, 'exact');
  if (finalState?.result.kind === 'exact') assert.equal(finalState.result.product.id, sprite.id);
});
