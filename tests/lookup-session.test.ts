import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { createLookupSession, type LookupState } from '../src/actions/lookup-session.ts';

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
