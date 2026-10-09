import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel, getInventoryHistory } from '../src/actions/inventory-actions.ts';
import {
  createPendingGcashDraft,
  getPendingGcashDrafts,
  getPendingGcashDraftById,
  cancelPendingGcashDraft,
  confirmGcashSale,
  getSaleById,
  getRecentSales,
} from '../src/actions/sales-actions.ts';
import {
  SaleValidationError,
  InsufficientStockError,
} from '../src/domain/sales.ts';

test('pending GCash draft does NOT deduct stock and does NOT appear in completed sales', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'San Miguel Pale Pilsen',
    variant: '330 ml',
    unit: 'bote',
    priceCentavos: 5500,
  });

  await setStockCount(db, { productId: product.id, newQuantity: 12 });

  const draft = await createPendingGcashDraft(db, {
    items: [{ productId: product.id, quantity: 2 }],
    referenceNumber: 'GCASH-REF-001',
    customerNote: 'Buyer Juan via QR',
  });

  assert.equal(draft.totalCentavos, 11000);
  assert.equal(draft.status, 'pending');
  assert.equal(draft.referenceNumber, 'GCASH-REF-001');
  assert.equal(draft.customerNote, 'Buyer Juan via QR');
  assert.equal(draft.items.length, 1);
  assert.equal(draft.items[0]?.productId, product.id);
  assert.equal(draft.items[0]?.quantity, 2);

  // Stock must remain unaffected (12, not 10)
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 12);

  // No inventory movements created
  const movements = await getInventoryHistory(db, product.id);
  assert.equal(movements.length, 1); // only the initial setStockCount
  assert.equal(movements[0]?.movementType, 'set_count');

  // Must not appear in completed sales
  const recentSales = await getRecentSales(db);
  assert.equal(recentSales.length, 0);

  const saleAttempt = await getSaleById(db, draft.id);
  assert.equal(saleAttempt, null);

  // Must appear in pending drafts list and by ID
  const pendingList = await getPendingGcashDrafts(db);
  assert.equal(pendingList.length, 1);
  assert.equal(pendingList[0]?.id, draft.id);

  const retrievedDraft = await getPendingGcashDraftById(db, draft.id);
  assert.notEqual(retrievedDraft, null);
  assert.equal(retrievedDraft?.id, draft.id);
  assert.equal(retrievedDraft?.status, 'pending');
});

test('owner confirmation commits sale, deducts stock atomically, and records sale_deduction', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const p1 = await saveProduct(db, {
    name: 'Bear Brand',
    variant: '33g',
    unit: 'sachet',
    priceCentavos: 1600,
  });

  const p2 = await saveProduct(db, {
    name: 'Nescafe Classic',
    variant: '50g',
    unit: 'pakete',
    priceCentavos: 4500,
  });

  await setStockCount(db, { productId: p1.id, newQuantity: 10 });
  await setStockCount(db, { productId: p2.id, newQuantity: 5 });

  const draft = await createPendingGcashDraft(db, {
    items: [
      { productId: p1.id, quantity: 2 },
      { productId: p2.id, quantity: 1 },
    ],
    referenceNumber: 'GCASH-REF-777',
    customerNote: 'Customer Maria confirmed via SMS',
  });

  // Explicit owner confirmation
  const sale = await confirmGcashSale(db, {
    draftId: draft.id,
  });

  assert.equal(sale.totalCentavos, 7700);
  assert.equal(sale.paymentMethod, 'gcash');
  assert.equal(sale.tenderCentavos, 7700);
  assert.equal(sale.changeCentavos, 0);
  assert.equal(sale.referenceNumber, 'GCASH-REF-777');
  assert.equal(sale.items.length, 2);

  // Draft should now be marked confirmed and omitted from pending list
  const pendingList = await getPendingGcashDrafts(db);
  assert.equal(pendingList.length, 0);

  const updatedDraft = await getPendingGcashDraftById(db, draft.id);
  assert.equal(updatedDraft?.status, 'confirmed');

  // Stock must be deducted atomically
  const stock1 = await getStockLevel(db, p1.id);
  assert.equal(stock1?.quantity, 8); // 10 - 2

  const stock2 = await getStockLevel(db, p2.id);
  assert.equal(stock2?.quantity, 4); // 5 - 1

  // Inventory movement history recorded
  const movementsP1 = await getInventoryHistory(db, p1.id);
  assert.equal(movementsP1.length, 2);
  assert.equal(movementsP1[0]?.movementType, 'sale_deduction');
  assert.equal(movementsP1[0]?.quantityDelta, -2);
  assert.equal(movementsP1[0]?.previousQuantity, 10);
  assert.equal(movementsP1[0]?.newQuantity, 8);
  assert.equal(movementsP1[0]?.note, `Benta: ${sale.id}`);

  // Shows up in recent sales
  const recent = await getRecentSales(db);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.id, sale.id);
  assert.equal(recent[0]?.paymentMethod, 'gcash');
  assert.equal(recent[0]?.referenceNumber, 'GCASH-REF-777');
});

test('cancellation of pending draft leaves stock untouched', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Chilimansi 80g',
    unit: 'piraso',
    priceCentavos: 1600,
  });

  await setStockCount(db, { productId: product.id, newQuantity: 20 });

  const draft = await createPendingGcashDraft(db, {
    items: [{ productId: product.id, quantity: 5 }],
    referenceNumber: 'FAILED-GCASH',
  });

  // Owner cancels unconfirmed draft
  await cancelPendingGcashDraft(db, draft.id);

  const updatedDraft = await getPendingGcashDraftById(db, draft.id);
  assert.equal(updatedDraft?.status, 'cancelled');

  // Draft removed from pending list
  const pendingList = await getPendingGcashDrafts(db);
  assert.equal(pendingList.length, 0);

  // Stock remains 20
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 20);

  // Attempting to confirm a cancelled draft throws SaleValidationError
  await assert.rejects(
    async () => {
      await confirmGcashSale(db, { draftId: draft.id });
    },
    (err: unknown) => {
      assert(err instanceof SaleValidationError);
      assert.match(err.message, /Kanselado/);
      return true;
    }
  );
});

test('insufficient or uncounted stock at confirmation time throws InsufficientStockError and rolls back', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Sardinas 555',
    variant: 'Tomato 155g',
    unit: 'lata',
    priceCentavos: 2500,
  });

  // Stock initially set to 5
  await setStockCount(db, { productId: product.id, newQuantity: 5 });

  const draft = await createPendingGcashDraft(db, {
    items: [{ productId: product.id, quantity: 5 }],
    referenceNumber: 'GCASH-STOCK-TEST',
  });

  // Another transaction reduces stock to 2 in the meantime
  await setStockCount(db, { productId: product.id, newQuantity: 2 });

  // Confirmation must check current stock and reject
  await assert.rejects(
    async () => {
      await confirmGcashSale(db, { draftId: draft.id });
    },
    (err: unknown) => {
      assert(err instanceof InsufficientStockError);
      assert.equal(err.insufficientItems.length, 1);
      assert.equal(err.insufficientItems[0]?.productId, product.id);
      assert.equal(err.insufficientItems[0]?.availableStock, 2);
      assert.equal(err.insufficientItems[0]?.requestedQuantity, 5);
      return true;
    }
  );

  // Draft status remains pending because transaction rolled back
  const draftAfter = await getPendingGcashDraftById(db, draft.id);
  assert.equal(draftAfter?.status, 'pending');

  // Stock remains 2
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 2);

  // No sales created
  const sales = await getRecentSales(db);
  assert.equal(sales.length, 0);
});

test('repeated confirmation does not double-deduct inventory (idempotency)', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Silver Swan Toyo',
    variant: '350 ml',
    unit: 'bote',
    priceCentavos: 2000,
  });

  await setStockCount(db, { productId: product.id, newQuantity: 15 });

  const draft = await createPendingGcashDraft(db, {
    items: [{ productId: product.id, quantity: 3 }],
    referenceNumber: 'GCASH-IDEM-999',
  });

  const sale1 = await confirmGcashSale(db, {
    draftId: draft.id,
    idempotencyKey: 'idem-key-gcash-1',
  });

  assert.equal(sale1.totalCentavos, 6000);
  assert.equal(sale1.paymentMethod, 'gcash');
  assert.equal(sale1.referenceNumber, 'GCASH-IDEM-999');

  // Confirming again with same idempotencyKey returns existing sale without duplicate deduction
  const sale2 = await confirmGcashSale(db, {
    draftId: draft.id,
    idempotencyKey: 'idem-key-gcash-1',
  });

  assert.equal(sale2.id, sale1.id);

  // Stock deducted once (15 - 3 = 12, not 9)
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 12);

  const movements = await getInventoryHistory(db, product.id);
  const deductionMovements = movements.filter((m) => m.movementType === 'sale_deduction');
  assert.equal(deductionMovements.length, 1);

  const allSales = await getRecentSales(db);
  assert.equal(allSales.length, 1);
});

test('persists pending drafts and confirmed GCash sales across app restart on real SQLite', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aira-gcash-persistence-'));
  const dbPath = path.join(tempDir, 'aira.db');

  try {
    // 1. Initial launch
    const syncDb1 = new DatabaseSync(dbPath);
    const db1 = new NodeSqliteAdapter(syncDb1);
    await runMigrations(db1);

    const product = await saveProduct(db1, {
      name: 'Coca Cola',
      variant: '1.5 L',
      unit: 'bote',
      priceCentavos: 7500,
    });

    await setStockCount(db1, { productId: product.id, newQuantity: 10 });

    // Create a draft that stays pending
    const pendingDraft = await createPendingGcashDraft(db1, {
      items: [{ productId: product.id, quantity: 1 }],
      referenceNumber: 'PENDING-GCASH-1',
      customerNote: 'Customer waiting at counter',
    });

    // Create and confirm a second draft
    const confirmedDraft = await createPendingGcashDraft(db1, {
      items: [{ productId: product.id, quantity: 2 }],
      referenceNumber: 'CONFIRMED-GCASH-2',
      customerNote: 'Paid and verified',
    });

    const confirmedSale = await confirmGcashSale(db1, {
      draftId: confirmedDraft.id,
      idempotencyKey: 'persist-gcash-sale-key',
    });

    syncDb1.close();

    // 2. Restart app: reconnect to SQLite file on disk
    const syncDb2 = new DatabaseSync(dbPath);
    const db2 = new NodeSqliteAdapter(syncDb2);
    await runMigrations(db2);

    // Verify pending draft persisted
    const pendingList = await getPendingGcashDrafts(db2);
    assert.equal(pendingList.length, 1);
    assert.equal(pendingList[0]?.id, pendingDraft.id);
    assert.equal(pendingList[0]?.referenceNumber, 'PENDING-GCASH-1');
    assert.equal(pendingList[0]?.customerNote, 'Customer waiting at counter');
    assert.equal(pendingList[0]?.totalCentavos, 7500);

    // Verify confirmed sale persisted
    const loadedSale = await getSaleById(db2, confirmedSale.id);
    assert.notEqual(loadedSale, null);
    assert.equal(loadedSale?.id, confirmedSale.id);
    assert.equal(loadedSale?.paymentMethod, 'gcash');
    assert.equal(loadedSale?.referenceNumber, 'CONFIRMED-GCASH-2');
    assert.equal(loadedSale?.totalCentavos, 15000);
    assert.equal(loadedSale?.items.length, 1);
    assert.equal(loadedSale?.items[0]?.quantity, 2);

    // Verify recent sales has the GCash sale
    const recentSales = await getRecentSales(db2);
    assert.equal(recentSales.length, 1);
    assert.equal(recentSales[0]?.id, confirmedSale.id);
    assert.equal(recentSales[0]?.paymentMethod, 'gcash');

    // Verify stock remains correctly deducted only for confirmed sale (10 - 2 = 8)
    const stockAfter = await getStockLevel(db2, product.id);
    assert.equal(stockAfter?.quantity, 8);

    // Verify confirmed draft status
    const loadedConfirmedDraft = await getPendingGcashDraftById(db2, confirmedDraft.id);
    assert.equal(loadedConfirmedDraft?.status, 'confirmed');

    syncDb2.close();
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
