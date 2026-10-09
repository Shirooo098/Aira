import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct, lookupProduct } from '../src/actions/catalog-actions.ts';

test('persists saved product across app restart on real SQLite file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aira-persistence-'));
  const dbPath = path.join(tempDir, 'aira.db');

  try {
    // 1. Initial launch: open DB and save product
    const syncDb1 = new DatabaseSync(dbPath);
    const db1 = new NodeSqliteAdapter(syncDb1);
    await runMigrations(db1);

    const saved = await saveProduct(db1, {
      name: 'Bear Brand',
      variant: 'Powder 33g',
      unit: 'sachet',
      priceCentavos: 1600,
    });
    assert.equal(saved.priceCentavos, 1600);
    syncDb1.close();

    // 2. Restart app: new connection to the same SQLite file
    const syncDb2 = new DatabaseSync(dbPath);
    const db2 = new NodeSqliteAdapter(syncDb2);
    await runMigrations(db2);

    const lookup = await lookupProduct(db2, 'Bear Brand');
    assert.equal(lookup.kind, 'exact');
    if (lookup.kind === 'exact') {
      assert.equal(lookup.product.id, saved.id);
      assert.equal(lookup.product.name, 'Bear Brand');
      assert.equal(lookup.product.variant, 'Powder 33g');
      assert.equal(lookup.product.unit, 'sachet');
      assert.equal(lookup.product.priceCentavos, 1600);
    }
    syncDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
