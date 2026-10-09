import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct, lookupProduct, getAllProducts } from '../src/actions/catalog-actions.ts';

test('lookup and catalog listing preserve saved business records', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // Initial seed
  const initialProduct = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Kalamansi 80g',
    unit: 'pack',
    priceCentavos: 1500,
  });

  const snapshotBefore = await getAllProducts(db);
  assert.equal(snapshotBefore.length, 1);

  await lookupProduct(db, 'Lucky Me');
  await lookupProduct(db, 'Unknown Sachet');
  await getAllProducts(db);

  // Navigation itself is checked through the phone workflow, not simulated variable assignment.
  const snapshotAfter = await getAllProducts(db);
  assert.equal(snapshotAfter.length, 1);
  assert.deepEqual(snapshotAfter[0], initialProduct);

});
