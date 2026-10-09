import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel, getInventoryHistory } from '../src/actions/inventory-actions.ts';
import {
  buildSalePreview,
  completeCashSale,
  getSaleById,
  getRecentSales,
} from '../src/actions/sales-actions.ts';
import {
  SaleValidationError,
  InsufficientStockError,
} from '../src/domain/sales.ts';

test('buildSalePreview computes line items, subtotal, total, and flags stock availability', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const coke = await saveProduct(db, {
    name: 'Coca Cola',
    variant: '1.5 L',
    unit: 'bote',
    priceCentavos: 7500,
  });

  const bearBrand = await saveProduct(db, {
    name: 'Bear Brand',
    variant: '33g',
    unit: 'sachet',
    priceCentavos: 1550,
  });

  await setStockCount(db, { productId: coke.id, newQuantity: 5 });
  // bearBrand has uncounted stock (null)

  const preview = await buildSalePreview(db, {
    items: [
      { productId: coke.id, quantity: 2 },
      { productId: bearBrand.id, quantity: 1 },
    ],
    tenderCentavos: 20000,
  });

  assert.equal(preview.items.length, 2);
  assert.equal(preview.items[0]?.subtotalCentavos, 15000);
  assert.equal(preview.items[0]?.availableStock, 5);
  assert.equal(preview.items[0]?.hasSufficientStock, true);

  assert.equal(preview.items[1]?.subtotalCentavos, 1550);
  assert.equal(preview.items[1]?.availableStock, null);
  assert.equal(preview.items[1]?.hasSufficientStock, false);

  assert.equal(preview.totalCentavos, 16550);
  assert.equal(preview.tenderCentavos, 20000);
  assert.equal(preview.changeCentavos, 3450);
  assert.equal(preview.canComplete, false);
  assert.deepEqual(preview.insufficientStockItems, ['Bear Brand']);
});

test('cash sale completes atomically, deducts inventory, and records sale_deduction movement', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Original 80g',
    unit: 'piraso',
    priceCentavos: 1600,
  });

  await setStockCount(db, { productId: product.id, newQuantity: 20, note: 'Initial count' });

  const sale = await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 3 }],
    tenderCentavos: 5000,
  });

  assert.equal(sale.totalCentavos, 4800);
  assert.equal(sale.tenderCentavos, 5000);
  assert.equal(sale.changeCentavos, 200);
  assert.equal(sale.paymentMethod, 'cash');
  assert.equal(sale.items.length, 1);
  assert.equal(sale.items[0]?.quantity, 3);
  assert.equal(sale.items[0]?.unitPriceCentavos, 1600);
  assert.equal(sale.items[0]?.subtotalCentavos, 4800);

  // Check inventory deduction
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 17);

  // Check inventory movements
  const movements = await getInventoryHistory(db, product.id);
  assert.equal(movements.length, 2);
  const deductionMov = movements[0];
  assert.equal(deductionMov?.movementType, 'sale_deduction');
  assert.equal(deductionMov?.quantityDelta, -3);
  assert.equal(deductionMov?.previousQuantity, 20);
  assert.equal(deductionMov?.newQuantity, 17);
  assert.equal(deductionMov?.note, `Benta: ${sale.id}`);

  // Check retrieval by ID
  const retrieved = await getSaleById(db, sale.id);
  assert.notEqual(retrieved, null);
  assert.equal(retrieved?.id, sale.id);
  assert.equal(retrieved?.totalCentavos, 4800);
  assert.equal(retrieved?.items.length, 1);

  // Check recent sales
  const recent = await getRecentSales(db);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]?.id, sale.id);
});

test('insufficient stock throws InsufficientStockError and aborts without deductions', async (t) => {
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

  await setStockCount(db, { productId: product.id, newQuantity: 2 });

  await assert.rejects(
    async () => {
      await completeCashSale(db, {
        items: [{ productId: product.id, quantity: 5 }],
        tenderCentavos: 20000,
      });
    },
    (err: unknown) => {
      assert(err instanceof InsufficientStockError);
      assert.match(err.message, /Kulang o hindi pa nabibilang/);
      assert.equal(err.insufficientItems.length, 1);
      assert.equal(err.insufficientItems[0]?.productId, product.id);
      assert.equal(err.insufficientItems[0]?.requestedQuantity, 5);
      assert.equal(err.insufficientItems[0]?.availableStock, 2);
      return true;
    }
  );

  // Inventory should be untouched
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 2);

  const sales = await getRecentSales(db);
  assert.equal(sales.length, 0);
});

test('uncounted stock (null) requires count and cannot silently sell', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Kopiko Blanca',
    variant: 'Twin Pack 52g',
    unit: 'sachet',
    priceCentavos: 1400,
  });

  // product stock is null (uncounted)
  await assert.rejects(
    async () => {
      await completeCashSale(db, {
        items: [{ productId: product.id, quantity: 1 }],
        tenderCentavos: 2000,
      });
    },
    (err: unknown) => {
      assert(err instanceof InsufficientStockError);
      assert.equal(err.insufficientItems[0]?.availableStock, null);
      return true;
    }
  );

  const stock = await getStockLevel(db, product.id);
  assert.equal(stock, null);
});

test('tender less than total throws SaleValidationError and aborts', async (t) => {
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

  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  await assert.rejects(
    async () => {
      await completeCashSale(db, {
        items: [{ productId: product.id, quantity: 2 }],
        tenderCentavos: 10000, // total is 11000
      });
    },
    (err: unknown) => {
      assert(err instanceof SaleValidationError);
      assert.match(err.message, /Kulang ang bayad/);
      return true;
    }
  );

  // Stock remains 10
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 10);
});

test('repeated confirmation with same idempotencyKey does not duplicate deductions or sales', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Nescafe Classic',
    variant: '50g',
    unit: 'pakete',
    priceCentavos: 4500,
  });

  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  const sale1 = await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 2 }],
    tenderCentavos: 10000,
    idempotencyKey: 'idem-sale-123',
  });

  assert.equal(sale1.totalCentavos, 9000);
  assert.equal(sale1.changeCentavos, 1000);

  // Confirm again with identical idempotencyKey
  const sale2 = await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 2 }],
    tenderCentavos: 10000,
    idempotencyKey: 'idem-sale-123',
  });

  assert.equal(sale2.id, sale1.id);
  assert.equal(sale2.totalCentavos, 9000);

  // Stock deduction should have happened ONCE (10 - 2 = 8, not 6)
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 8);

  const movements = await getInventoryHistory(db, product.id);
  assert.equal(movements.filter((m) => m.movementType === 'sale_deduction').length, 1);

  const allSales = await getRecentSales(db);
  assert.equal(allSales.length, 1);
});

test('product price edit after sale does NOT rewrite past sales or snapshot prices', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Marlboro Red',
    variant: 'Pack',
    unit: 'kahon',
    priceCentavos: 15000,
  });

  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  const sale = await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 1 }],
    tenderCentavos: 20000,
  });

  assert.equal(sale.totalCentavos, 15000);
  assert.equal(sale.items[0]?.unitPriceCentavos, 15000);

  // Update product price in catalog
  await db.run('UPDATE products SET price_centavos = ? WHERE id = ?;', [20000, product.id]);

  // Historic sale must retain original snapshot price and subtotal
  const fetchedSale = await getSaleById(db, sale.id);
  assert.notEqual(fetchedSale, null);
  assert.equal(fetchedSale?.totalCentavos, 15000);
  assert.equal(fetchedSale?.items[0]?.unitPriceCentavos, 15000);
  assert.equal(fetchedSale?.items[0]?.subtotalCentavos, 15000);
});

test('transaction rollback on failure preserves existing stock and writes no sale', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const p1 = await saveProduct(db, {
    name: 'Item A',
    variant: 'V1',
    unit: 'pc',
    priceCentavos: 1000,
  });
  const p2 = await saveProduct(db, {
    name: 'Item B',
    variant: 'V2',
    unit: 'pc',
    priceCentavos: 2000,
  });

  await setStockCount(db, { productId: p1.id, newQuantity: 10 });
  await setStockCount(db, { productId: p2.id, newQuantity: 2 }); // only 2 available

  // Attempt to sell 5 of p1 and 5 of p2 -> p2 will fail
  await assert.rejects(
    async () => {
      await completeCashSale(db, {
        items: [
          { productId: p1.id, quantity: 5 },
          { productId: p2.id, quantity: 5 },
        ],
        tenderCentavos: 20000,
      });
    },
    InsufficientStockError
  );

  // Check p1 stock was NOT deducted
  const stock1 = await getStockLevel(db, p1.id);
  assert.equal(stock1?.quantity, 10);

  const stock2 = await getStockLevel(db, p2.id);
  assert.equal(stock2?.quantity, 2);

  const sales = await getRecentSales(db);
  assert.equal(sales.length, 0);
});
