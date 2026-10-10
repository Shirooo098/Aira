import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, recordDelivery, getStockLevel } from '../src/actions/inventory-actions.ts';
import { completeCashSale } from '../src/actions/sales-actions.ts';
import {
  createDraftRestockChecklist,
  getRestockChecklist,
  getLatestRestockChecklist,
  updateChecklistItem,
  addChecklistItem,
  removeChecklistItem,
  approveRestockChecklist,
  discardRestockChecklist,
} from '../src/actions/restock-actions.ts';
import { RestockValidationError } from '../src/domain/restock.ts';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

async function createMemoryStore(t: test.TestContext) {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);
  return { syncDb, db };
}

test('creates a draft restock checklist grounded in SQLite catalog and sales history', async (t) => {
  const { syncDb, db } = await createMemoryStore(t);

  const coke = await saveProduct(db, {
    name: 'Coca-Cola',
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
  const kape = await saveProduct(db, {
    name: 'Nescafe',
    variant: 'Classic 50g',
    unit: 'sachet',
    priceCentavos: 1200,
  });

  // Set initial stock: Coke = 10, Sprite = 1, Nescafe = 0
  await setStockCount(db, { productId: coke.id, newQuantity: 10 });
  await setStockCount(db, { productId: sprite.id, newQuantity: 1 });
  await setStockCount(db, { productId: kape.id, newQuantity: 0 });

  // Sell 8 Cokes
  await completeCashSale(db, {
    items: [{ productId: coke.id, quantity: 8 }],
    tenderCentavos: 60000,
  });

  // Now Coke has 2 remaining, 8 sold
  const checklist = await createDraftRestockChecklist(db, { periodKey: 'today' });

  assert.equal(checklist.status, 'draft');
  assert.equal(checklist.periodKey, 'today');
  assert.ok(checklist.items.length >= 2);

  // Coke should be low stock (2 left, 8 sold)
  const cokeItem = checklist.items.find((i) => i.productId === coke.id);
  assert.ok(cokeItem);
  assert.equal(cokeItem.reason, 'low_stock');
  assert.equal(cokeItem.currentStock, 2);
  assert.equal(cokeItem.unitsSold, 8);
  assert.equal(cokeItem.hasSufficientHistory, true);
  assert.equal(cokeItem.suggestedQuantity, 8);
  assert.equal(cokeItem.requestedQuantity, 8);
  assert.equal(cokeItem.isIncluded, true);

  // Nescafe was 0 stock, 0 sold in period -> insufficient history explained
  const kapeItem = checklist.items.find((i) => i.productId === kape.id);
  assert.ok(kapeItem);
  assert.equal(kapeItem.reason, 'out_of_stock');
  assert.equal(kapeItem.currentStock, 0);
  assert.equal(kapeItem.unitsSold, 0);
  assert.equal(kapeItem.hasSufficientHistory, false);
  assert.equal(kapeItem.suggestedQuantity, null); // NO invented quantity
  assert.equal(kapeItem.requestedQuantity, 1);
  assert.match(kapeItem.historyExplanation, /Kulang ang kasaysayan/i);
});

test('allows owner to edit, include, exclude, add, and remove items in the checklist', async (t) => {
  const { db } = await createMemoryStore(t);

  const prod1 = await saveProduct(db, {
    name: 'Sardinas',
    variant: '155g',
    unit: 'lata',
    priceCentavos: 2500,
  });
  const prod2 = await saveProduct(db, {
    name: 'Toyo',
    variant: '350ml',
    unit: 'bote',
    priceCentavos: 2000,
  });
  await setStockCount(db, { productId: prod1.id, newQuantity: 0 });
  await setStockCount(db, { productId: prod2.id, newQuantity: 100 }); // Plentiful stock

  const checklist = await createDraftRestockChecklist(db, { periodKey: 'today' });
  const item1 = checklist.items.find((i) => i.productId === prod1.id);
  assert.ok(item1);

  // 1. Owner changes requested quantity
  const updated1 = await updateChecklistItem(db, {
    itemId: item1.id,
    requestedQuantity: 24,
  });
  assert.equal(updated1.requestedQuantity, 24);

  // 2. Owner excludes item
  const updated2 = await updateChecklistItem(db, {
    itemId: item1.id,
    isIncluded: false,
  });
  assert.equal(updated2.isIncluded, false);

  // 3. Owner manually adds Toyo to the checklist
  const manualItem = await addChecklistItem(db, {
    checklistId: checklist.id,
    productId: prod2.id,
    requestedQuantity: 12,
  });
  assert.equal(manualItem.productId, prod2.id);
  assert.equal(manualItem.reason, 'manual');
  assert.equal(manualItem.requestedQuantity, 12);
  assert.equal(manualItem.isIncluded, true);

  // Verify fetch
  const fetched = await getRestockChecklist(db, checklist.id);
  assert.equal(fetched.items.length, 2);

  // 4. Owner removes item
  await removeChecklistItem(db, manualItem.id);
  const afterRemove = await getRestockChecklist(db, checklist.id);
  assert.equal(afterRemove.items.length, 1);
  assert.equal(afterRemove.items[0]?.productId, prod1.id);
});

test('CRITICAL: approving a restock checklist does NOT alter inventory or execute purchases', async (t) => {
  const { syncDb, db } = await createMemoryStore(t);

  const biscuit = await saveProduct(db, {
    name: 'Fita',
    variant: 'Pack 30g',
    unit: 'pack',
    priceCentavos: 1000,
  });
  await setStockCount(db, { productId: biscuit.id, newQuantity: 0 });

  const checklist = await createDraftRestockChecklist(db, { periodKey: 'today' });
  const item = checklist.items[0];
  assert.ok(item);

  // Update requested quantity to 50
  await updateChecklistItem(db, { itemId: item.id, requestedQuantity: 50 });

  // Record stock level and movement count BEFORE approval
  const stockBefore = await getStockLevel(db, biscuit.id);
  assert.equal(stockBefore?.quantity, 0);

  const movementsBefore = (syncDb.prepare('SELECT count(*) as count FROM inventory_movements').get() as { count: number }).count;
  const salesBefore = (syncDb.prepare('SELECT count(*) as count FROM sales').get() as { count: number }).count;

  // Approve the checklist
  const approved = await approveRestockChecklist(db, {
    checklistId: checklist.id,
    notes: 'Approved during morning inventory review',
  });

  assert.equal(approved.status, 'approved');
  assert.ok(approved.approvedAt);
  assert.equal(approved.notes, 'Approved during morning inventory review');

  // Verify stock is STILL 0 - NOT modified!
  const stockAfter = await getStockLevel(db, biscuit.id);
  assert.equal(stockAfter?.quantity, 0);

  // Verify NO inventory movements were created
  const movementsAfter = (syncDb.prepare('SELECT count(*) as count FROM inventory_movements').get() as { count: number }).count;
  assert.equal(movementsAfter, movementsBefore);

  // Verify NO sales or expenses created
  const salesAfter = (syncDb.prepare('SELECT count(*) as count FROM sales').get() as { count: number }).count;
  assert.equal(salesAfter, salesBefore);

  // Inventory changes ONLY when owner explicitly logs physical intake via recordDelivery or setStockCount
  await recordDelivery(db, {
    productId: biscuit.id,
    deliveryQuantity: 50,
    note: `Delivery mula sa naaprubahang checklist ${checklist.id.slice(0, 8)}`,
  });

  const stockAfterDelivery = await getStockLevel(db, biscuit.id);
  assert.equal(stockAfterDelivery?.quantity, 50);

  const movementsFinal = (syncDb.prepare('SELECT count(*) as count FROM inventory_movements').get() as { count: number }).count;
  assert.equal(movementsFinal, movementsBefore + 1);
});

test('discarding a checklist marks it discarded without touching stock', async (t) => {
  const { syncDb, db } = await createMemoryStore(t);

  const soap = await saveProduct(db, {
    name: 'Perla',
    variant: 'Puti 100g',
    unit: 'bar',
    priceCentavos: 2000,
  });
  await setStockCount(db, { productId: soap.id, newQuantity: 2 });

  const checklist = await createDraftRestockChecklist(db, { periodKey: 'today' });
  const discarded = await discardRestockChecklist(db, { checklistId: checklist.id });

  assert.equal(discarded.status, 'discarded');
  assert.ok(discarded.discardedAt);

  const stock = await getStockLevel(db, soap.id);
  assert.equal(stock?.quantity, 2);

  const movementsCount = (syncDb.prepare('SELECT count(*) as count FROM inventory_movements').get() as { count: number }).count;
  assert.equal(movementsCount, 1); // Only the initial setStockCount
});

test('persists restock checklist and item state across SQLite database restart on real file', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aira-restock-test-'));
  const dbFile = path.join(tempDir, 'restock.db');
  let syncDb1: DatabaseSync | undefined;
  let syncDb2: DatabaseSync | undefined;

  try {
    // Session 1: Create, edit, and approve checklist
    syncDb1 = new DatabaseSync(dbFile);
    const db1 = new NodeSqliteAdapter(syncDb1);
    await runMigrations(db1);

    const noodles = await saveProduct(db1, {
      name: 'Nissin Cup Noodles',
      variant: 'Seafood 40g',
      unit: 'cup',
      priceCentavos: 3000,
    });
    await setStockCount(db1, { productId: noodles.id, newQuantity: 0 });

    const draft = await createDraftRestockChecklist(db1, { periodKey: 'today' });
    const checklistId = draft.id;

    const item = draft.items[0];
    assert.ok(item);
    await updateChecklistItem(db1, {
      itemId: item.id,
      requestedQuantity: 36,
    });

    await approveRestockChecklist(db1, {
      checklistId: draft.id,
      notes: 'Bibili sa palengke mamaya',
    });

    syncDb1.close();
    syncDb1 = undefined;

    // Session 2: Reopen SQLite file and verify persistence
    syncDb2 = new DatabaseSync(dbFile);
    const db2 = new NodeSqliteAdapter(syncDb2);
    await runMigrations(db2);

    const reloaded = await getRestockChecklist(db2, checklistId);
    assert.equal(reloaded.id, checklistId);
    assert.equal(reloaded.status, 'approved');
    assert.equal(reloaded.notes, 'Bibili sa palengke mamaya');
    assert.equal(reloaded.items.length, 1);
    assert.equal(reloaded.items[0]?.productName, 'Nissin Cup Noodles');
    assert.equal(reloaded.items[0]?.requestedQuantity, 36);
    assert.equal(reloaded.items[0]?.currentStock, 0);

    const latest = await getLatestRestockChecklist(db2);
    assert.equal(latest?.id, checklistId);
  } finally {
    try { syncDb1?.close(); } catch { /* ignore */ }
    try { syncDb2?.close(); } catch { /* ignore */ }
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
