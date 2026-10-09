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

test('persists stock counts, deliveries, and movement history across app restart on real SQLite file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aira-stock-persistence-'));
  const dbPath = path.join(tempDir, 'aira.db');

  try {
    // 1. Initial launch: save product, set count, and record delivery
    const syncDb1 = new DatabaseSync(dbPath);
    const db1 = new NodeSqliteAdapter(syncDb1);
    await runMigrations(db1);

    const { setStockCount, recordDelivery, getStockLevel, getInventoryHistory } = await import(
      '../src/actions/inventory-actions.ts'
    );

    const product = await saveProduct(db1, {
      name: 'Silver Swan Suka',
      variant: '350 ml',
      unit: 'bote',
      priceCentavos: 1800,
    });

    // Count correction: set count to 15
    await setStockCount(db1, {
      productId: product.id,
      newQuantity: 15,
      note: 'Unang imbentaryo',
    });

    // Add delivery: add 10 more
    await recordDelivery(db1, {
      productId: product.id,
      deliveryQuantity: 10,
      note: 'Delivery mula sa tindahan',
    });

    const stockBeforeClose = await getStockLevel(db1, product.id);
    assert.equal(stockBeforeClose?.quantity, 25);
    syncDb1.close();

    // 2. Restart app: reconnect to SQLite file on disk
    const syncDb2 = new DatabaseSync(dbPath);
    const db2 = new NodeSqliteAdapter(syncDb2);
    await runMigrations(db2);

    const stockAfterRestart = await getStockLevel(db2, product.id);
    assert.notEqual(stockAfterRestart, null);
    assert.equal(stockAfterRestart?.quantity, 25);

    const history = await getInventoryHistory(db2, product.id);
    assert.equal(history.length, 2);
    assert.equal(history[0]?.movementType, 'add_delivery');
    assert.equal(history[0]?.previousQuantity, 15);
    assert.equal(history[0]?.newQuantity, 25);
    assert.equal(history[0]?.quantityDelta, 10);
    assert.equal(history[0]?.note, 'Delivery mula sa tindahan');

    assert.equal(history[1]?.movementType, 'set_count');
    assert.equal(history[1]?.previousQuantity, null);
    assert.equal(history[1]?.newQuantity, 15);
    assert.equal(history[1]?.quantityDelta, 15);
    assert.equal(history[1]?.note, 'Unang imbentaryo');

    syncDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

