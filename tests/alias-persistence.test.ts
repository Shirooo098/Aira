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

test('migration v7 preserves existing v6 product, inventory, and sale history', async (t) => {
  const { db } = await openMigratedMemoryDatabase(t);
  const versions = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version;',
  );
  assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

  // Build a v6 fixture from the latest schema, removing ticket #3 and later table/version.
  await db.exec('DROP TABLE IF EXISTS restock_checklist_items; DROP TABLE IF EXISTS restock_checklists; DROP TABLE product_aliases; DROP TABLE IF EXISTS receipt_attachments; DELETE FROM schema_migrations WHERE version >= 7;');
  const product = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Original 80g',
    unit: 'piraso',
    priceCentavos: 1600,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 20, note: 'v6 initial count' });
  await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 3 }],
    tenderCentavos: 5000,
    idempotencyKey: 'alias-migration-v6-fixture',
  });

  const beforeUpgrade = await businessDataSnapshot(db);
  const v6Versions = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version;',
  );
  assert.deepEqual(v6Versions.map((row) => row.version), [1, 2, 3, 4, 5, 6]);

  await runMigrations(db);

  assert.deepEqual(await businessDataSnapshot(db), beforeUpgrade);
  const upgradedVersions = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations ORDER BY version;',
  );
  assert.deepEqual(upgradedVersions.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(await getProductAliases(db, product.id), []);
  const aliasTable = await db.getFirst<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_aliases';",
  );
  assert.equal(aliasTable?.name, 'product_aliases');
});

async function createLegacyAliasFixture(t: TestContext) {
  const { db } = await openMigratedMemoryDatabase(t);
  const product = await saveProduct(db, {
    name: 'Coke', variant: '200 mL', unit: 'bote', priceCentavos: 1500,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 10 });
  await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 2 }],
    tenderCentavos: 5000, idempotencyKey: 'legacy-alias-sale',
  });
  await confirmAlias(db, await prepareAlias(db, product.id, 'maliit na coke'));
  // Reconstruct the previously shipped feature-branch schema: migrations 1–3
  // plus aliases at version 4, without any main-branch GCash/credit schema.
  await db.exec(`
    DROP TABLE IF EXISTS restock_checklist_items;
    DROP TABLE IF EXISTS restock_checklists;
    DROP TABLE IF EXISTS receipt_attachments;
    DROP TABLE repayment_allocations;
    DROP TABLE credit_repayments;
    DROP TABLE credit_entries;
    ALTER TABLE sales DROP COLUMN customer_id;
    ALTER TABLE sales DROP COLUMN paid_centavos;
    ALTER TABLE sales DROP COLUMN credit_centavos;
    ALTER TABLE sales DROP COLUMN reference_number;
    ALTER TABLE sales DROP COLUMN status;
    ALTER TABLE sales DROP COLUMN cancelled_at;
    ALTER TABLE sales DROP COLUMN cancellation_reason;
    DROP TABLE customers;
    DROP TABLE pending_gcash_drafts;
    DELETE FROM schema_migrations WHERE version >= 5;
  `);
  return { db, product };
}

test('upgrades the legacy alias-v4 build without losing aliases, stock, or cash sales', async (t) => {
  const { db, product } = await createLegacyAliasFixture(t);
  const before = await businessDataSnapshot(db);
  const aliases = await getProductAliases(db, product.id);
  const history = await db.getAll('SELECT * FROM schema_migrations ORDER BY version;');
  await runMigrations(db);
  await runMigrations(db);
  const after = await businessDataSnapshot(db);
  for (const table of ['products', 'stock_levels', 'inventory_movements', 'sale_items']) {
    assert.deepEqual(after[table], before[table]);
  }
  const sales = await db.getAll(`SELECT id, payment_method, total_centavos, tender_centavos,
    change_centavos, idempotency_key, created_at FROM sales ORDER BY rowid;`);
  assert.deepEqual(sales, before.sales);
  assert.deepEqual(await getProductAliases(db, product.id), aliases);
  assert.deepEqual(await db.getAll('SELECT * FROM schema_migrations WHERE version <= 4 ORDER BY version;'), history);
  const versions = await db.getAll<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version;');
  assert.deepEqual(versions.map((row) => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal((await lookupProduct(db, 'maliit na coke')).kind, 'exact');
  assert.deepEqual(await db.getAll('SELECT * FROM pending_gcash_drafts;'), []);
  assert.deepEqual(await db.getAll('SELECT * FROM customers;'), []);
});

test('a failed legacy upgrade rolls back the bridge and preserves aliases for retry', async (t) => {
  const { db, product } = await createLegacyAliasFixture(t);
  const before = await businessDataSnapshot(db);
  const aliases = await getProductAliases(db, product.id);
  await db.exec(`CREATE TRIGGER fail_alias_upgrade BEFORE INSERT ON schema_migrations
    WHEN NEW.version = 7 BEGIN SELECT RAISE(ABORT, 'upgrade blocked'); END;`);
  await assert.rejects(runMigrations(db), /upgrade blocked/);
  assert.deepEqual(await businessDataSnapshot(db), before);
  assert.deepEqual(await getProductAliases(db, product.id), aliases);
  assert.equal(await db.getFirst("SELECT name FROM sqlite_master WHERE name = 'pending_gcash_drafts';"), null);
  await db.exec('DROP TRIGGER fail_alias_upgrade;');
  await runMigrations(db);
  assert.equal((await lookupProduct(db, 'maliit na coke')).kind, 'exact');
});
