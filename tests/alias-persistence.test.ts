import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct, lookupProduct } from '../src/actions/catalog-actions.ts';
import { completeCashSale } from '../src/actions/sales-actions.ts';
import { setStockCount } from '../src/actions/inventory-actions.ts';
import {
  confirmAlias,
  getProductAliases,
  prepareAlias,
} from '../src/actions/alias-actions.ts';
import type { DatabaseSession } from '../src/db/database.ts';

async function businessDataSnapshot(db: DatabaseSession) {
  const tables = ['products', 'stock_levels', 'inventory_movements', 'sales', 'sale_items'];
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tables) {
    snapshot[table] = await db.getAll(`SELECT * FROM ${table} ORDER BY rowid;`);
  }
  return snapshot;
}

function createTempDirectory() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const tempDirectory = fs.mkdtempSync(path.join(tempRoot, 'aira-alias-persistence-'));
  return { tempRoot, tempDirectory };
}

function removeTempDirectory(tempRoot: string, tempDirectory: string) {
  const resolvedRoot = fs.realpathSync(tempRoot);
  const resolvedTarget = fs.realpathSync(tempDirectory);
  const relativeTarget = path.relative(resolvedRoot, resolvedTarget);
  assert.ok(
    relativeTarget !== '' &&
      relativeTarget !== '.' &&
      relativeTarget !== '..' &&
      !relativeTarget.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeTarget),
    `Refusing to recursively remove a temp directory outside ${resolvedRoot}`,
  );
  assert.ok(
    path.basename(resolvedTarget).startsWith('aira-alias-persistence-'),
    `Refusing to recursively remove an unexpected temp directory: ${resolvedTarget}`,
  );
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

async function openMigratedMemoryDatabase(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  return { sqlite, db };
}

test('persists an approved alias through a real SQLite file restart', async () => {
  const { tempRoot, tempDirectory } = createTempDirectory();
  const databasePath = path.join(tempDirectory, 'aira.db');
  let sqlite: DatabaseSync | undefined;

  try {
    sqlite = new DatabaseSync(databasePath);
    const firstDb = new NodeSqliteAdapter(sqlite);
    await runMigrations(firstDb);
    const product = await saveProduct(firstDb, {
      name: 'Datu Puti Vinegar',
      variant: '350 ml',
      unit: 'bote',
      priceCentavos: 1750,
    });
    const proposal = await prepareAlias(firstDb, product.id, 'Suka Datu');
    await confirmAlias(firstDb, proposal);
    const savedAliases = await getProductAliases(firstDb, product.id);
    assert.equal(savedAliases.length, 1);

    sqlite.close();
    sqlite = undefined;

    sqlite = new DatabaseSync(databasePath);
    const reopenedDb = new NodeSqliteAdapter(sqlite);
    await runMigrations(reopenedDb);
    assert.deepEqual(await getProductAliases(reopenedDb, product.id), savedAliases);

    const lookup = await lookupProduct(reopenedDb, 'Suka Datu');
    assert.equal(lookup.kind, 'exact');
    if (lookup.kind === 'exact') {
      assert.equal(lookup.product.id, product.id);
      assert.equal(lookup.product.priceCentavos, 1750);
    }
  } finally {
    try {
      sqlite?.close();
    } finally {
      removeTempDirectory(tempRoot, tempDirectory);
    }
  }
});

test('migration v4 preserves existing v3 product, inventory, and sale history', async (t) => {
  const { db } = await openMigratedMemoryDatabase(t);
  const versions = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version;',
  );
  assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4]);

  // Build a v3 fixture from the latest schema, removing only ticket #3's table/version.
  await db.exec('DROP TABLE product_aliases; DELETE FROM schema_migrations WHERE version = 4;');
  const product = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Original 80g',
    unit: 'piraso',
    priceCentavos: 1600,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 20, note: 'v3 initial count' });
  await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 3 }],
    tenderCentavos: 5000,
    idempotencyKey: 'alias-migration-v3-fixture',
  });

  const beforeUpgrade = await businessDataSnapshot(db);
  const v3Versions = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version;',
  );
  assert.deepEqual(v3Versions.map((row) => row.version), [1, 2, 3]);

  await runMigrations(db);

  assert.deepEqual(await businessDataSnapshot(db), beforeUpgrade);
  const upgradedVersions = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version;',
  );
  assert.deepEqual(upgradedVersions.map((row) => row.version), [1, 2, 3, 4]);
  assert.deepEqual(await getProductAliases(db, product.id), []);
  const aliasTable = await db.getFirst<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_aliases';",
  );
  assert.equal(aliasTable?.name, 'product_aliases');
});
