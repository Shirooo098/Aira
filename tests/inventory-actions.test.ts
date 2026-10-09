import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct, updateProductPrice } from '../src/actions/catalog-actions.ts';
import {
  getStockLevel,
  calculateStockPreview,
  setStockCount,
  recordDelivery,
  getInventoryHistory,
  getAllProductsWithStock,
} from '../src/actions/inventory-actions.ts';
import {
  validateStockQuantity,
  validateDeliveryQuantity,
  StockValidationError,
} from '../src/domain/inventory.ts';
import { CatalogValidationError } from '../src/domain/catalog.ts';

test('uncounted product returns null quantity (never silent 0)', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Sprite',
    variant: '1.5L',
    unit: 'bote',
    priceCentavos: 7000,
  });

  // Direct stock level query for uncounted product returns null
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock, null);

  // Products with stock listing returns null quantity and null stockUpdatedAt
  const list = await getAllProductsWithStock(db);
  assert.equal(list.length, 1);
  assert.equal(list[0]?.id, product.id);
  assert.equal(list[0]?.quantity, null);
  assert.notEqual(list[0]?.quantity, 0, 'Uncounted product must never default to zero');
  assert.equal(list[0]?.stockUpdatedAt, null);
});

test('setStockCount replaces count and stores movement with before/after', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: '250 ml',
    unit: 'bote',
    priceCentavos: 1500,
  });

  // 1. Initial count on uncounted product
  const initialMovement = await setStockCount(db, {
    productId: product.id,
    newQuantity: 20,
    note: 'Unang bilang',
  });

  assert.equal(initialMovement.productId, product.id);
  assert.equal(initialMovement.movementType, 'set_count');
  assert.equal(initialMovement.previousQuantity, null);
  assert.equal(initialMovement.newQuantity, 20);
  assert.equal(initialMovement.quantityDelta, 20);
  assert.equal(initialMovement.note, 'Unang bilang');
  assert.ok(initialMovement.createdAt);

  const stock1 = await getStockLevel(db, product.id);
  assert.notEqual(stock1, null);
  assert.equal(stock1?.quantity, 20);

  // 2. Correction / audit replaces count
  const auditedMovement = await setStockCount(db, {
    productId: product.id,
    newQuantity: 14,
    note: 'Inayos matapos bilangin',
  });

  assert.equal(auditedMovement.movementType, 'set_count');
  assert.equal(auditedMovement.previousQuantity, 20);
  assert.equal(auditedMovement.newQuantity, 14);
  assert.equal(auditedMovement.quantityDelta, -6);
  assert.equal(auditedMovement.note, 'Inayos matapos bilangin');

  const stock2 = await getStockLevel(db, product.id);
  assert.equal(stock2?.quantity, 14);

  // 3. Setting count to 0 is valid
  const zeroMovement = await setStockCount(db, {
    productId: product.id,
    newQuantity: 0,
    note: 'Ubos na',
  });
  assert.equal(zeroMovement.previousQuantity, 14);
  assert.equal(zeroMovement.newQuantity, 0);
  assert.equal(zeroMovement.quantityDelta, -14);

  const stock3 = await getStockLevel(db, product.id);
  assert.equal(stock3?.quantity, 0);
});

test('recordDelivery increments count and stores movement with before/after', async (t) => {
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

  // 1. Delivery on previously uncounted product initializes stock to delivery quantity
  const deliv1 = await recordDelivery(db, {
    productId: product.id,
    deliveryQuantity: 24,
    note: 'Kahon galing sa distributor',
  });

  assert.equal(deliv1.movementType, 'add_delivery');
  assert.equal(deliv1.previousQuantity, null);
  assert.equal(deliv1.newQuantity, 24);
  assert.equal(deliv1.quantityDelta, 24);
  assert.equal(deliv1.note, 'Kahon galing sa distributor');

  const stock1 = await getStockLevel(db, product.id);
  assert.equal(stock1?.quantity, 24);

  // 2. Subsequent delivery increments existing count
  const deliv2 = await recordDelivery(db, {
    productId: product.id,
    deliveryQuantity: 12,
    note: 'Dagdag 12 piraso',
  });

  assert.equal(deliv2.movementType, 'add_delivery');
  assert.equal(deliv2.previousQuantity, 24);
  assert.equal(deliv2.newQuantity, 36);
  assert.equal(deliv2.quantityDelta, 12);

  const stock2 = await getStockLevel(db, product.id);
  assert.equal(stock2?.quantity, 36);
});

test('calculateStockPreview computes preview values without persisting', () => {
  // Preview set_count on uncounted product
  const p1 = calculateStockPreview({
    productId: 'prod_1',
    movementType: 'set_count',
    inputQuantity: 10,
    currentQuantity: null,
    unit: 'bote',
  });
  assert.equal(p1.productId, 'prod_1');
  assert.equal(p1.movementType, 'set_count');
  assert.equal(p1.previousQuantity, null);
  assert.equal(p1.inputQuantity, 10);
  assert.equal(p1.newQuantity, 10);
  assert.equal(p1.quantityDelta, null);
  assert.equal(p1.unit, 'bote');

  // Preview set_count on counted product
  const p2 = calculateStockPreview({
    productId: 'prod_1',
    movementType: 'set_count',
    inputQuantity: 8,
    currentQuantity: 12,
    unit: 'bote',
  });
  assert.equal(p2.previousQuantity, 12);
  assert.equal(p2.inputQuantity, 8);
  assert.equal(p2.newQuantity, 8);
  assert.equal(p2.quantityDelta, -4);

  // Preview add_delivery on uncounted product
  const p3 = calculateStockPreview({
    productId: 'prod_1',
    movementType: 'add_delivery',
    inputQuantity: 24,
    currentQuantity: null,
    unit: 'kahon',
  });
  assert.equal(p3.previousQuantity, null);
  assert.equal(p3.inputQuantity, 24);
  assert.equal(p3.newQuantity, 24);
  assert.equal(p3.quantityDelta, 24);

  // Preview add_delivery on counted product
  const p4 = calculateStockPreview({
    productId: 'prod_1',
    movementType: 'add_delivery',
    inputQuantity: 6,
    currentQuantity: 10,
    unit: 'piraso',
  });
  assert.equal(p4.previousQuantity, 10);
  assert.equal(p4.inputQuantity, 6);
  assert.equal(p4.newQuantity, 16);
  assert.equal(p4.quantityDelta, 6);
});

test('price update leaves stock and movement history untouched', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Bear Brand',
    variant: '33g',
    unit: 'sachet',
    priceCentavos: 1600,
  });

  await setStockCount(db, {
    productId: product.id,
    newQuantity: 30,
    note: 'Panimulang bilang',
  });

  const movementsBefore = await getInventoryHistory(db, product.id);
  assert.equal(movementsBefore.length, 1);

  // Update price only
  const updatedProduct = await updateProductPrice(db, product.id, 1800);
  assert.equal(updatedProduct.priceCentavos, 1800);

  // Stock level is unchanged
  const stockAfter = await getStockLevel(db, product.id);
  assert.equal(stockAfter?.quantity, 30);

  // Movement history is untouched
  const movementsAfter = await getInventoryHistory(db, product.id);
  assert.equal(movementsAfter.length, 1);
  assert.equal(movementsAfter[0]?.id, movementsBefore[0]?.id);

  // Price update validates centavos
  await assert.rejects(
    updateProductPrice(db, product.id, -100),
    CatalogValidationError
  );
  await assert.rejects(
    updateProductPrice(db, product.id, 15.5),
    CatalogValidationError
  );
});

test('validation errors on invalid quantities (negative, float, NaN, non-integer)', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Nestea',
    variant: '25g',
    unit: 'sachet',
    priceCentavos: 2000,
  });

  // Domain validateStockQuantity checks
  assert.throws(() => validateStockQuantity(null), StockValidationError);
  assert.throws(() => validateStockQuantity(undefined), StockValidationError);
  assert.throws(() => validateStockQuantity(''), StockValidationError);
  assert.throws(() => validateStockQuantity('   '), StockValidationError);
  assert.throws(() => validateStockQuantity('abc'), StockValidationError);
  assert.throws(() => validateStockQuantity(-1), StockValidationError);
  assert.throws(() => validateStockQuantity('-5'), StockValidationError);
  assert.throws(() => validateStockQuantity(1.5), StockValidationError);
  assert.throws(() => validateStockQuantity('1.5'), StockValidationError);
  assert.throws(() => validateStockQuantity(NaN), StockValidationError);
  assert.throws(() => validateStockQuantity(Infinity), StockValidationError);
  assert.equal(validateStockQuantity(0), 0);
  assert.equal(validateStockQuantity('0'), 0);
  assert.equal(validateStockQuantity(10), 10);
  assert.equal(validateStockQuantity('10'), 10);

  // Domain validateDeliveryQuantity checks
  assert.throws(() => validateDeliveryQuantity(null), StockValidationError);
  assert.throws(() => validateDeliveryQuantity(0), StockValidationError);
  assert.throws(() => validateDeliveryQuantity('0'), StockValidationError);
  assert.throws(() => validateDeliveryQuantity(-5), StockValidationError);
  assert.throws(() => validateDeliveryQuantity(2.5), StockValidationError);
  assert.throws(() => validateDeliveryQuantity(NaN), StockValidationError);
  assert.equal(validateDeliveryQuantity(1), 1);
  assert.equal(validateDeliveryQuantity('1'), 1);
  assert.equal(validateDeliveryQuantity(15), 15);

  // Action level rejects invalid inputs
  await assert.rejects(
    setStockCount(db, { productId: product.id, newQuantity: -1 }),
    StockValidationError
  );
  await assert.rejects(
    setStockCount(db, { productId: product.id, newQuantity: 5.5 }),
    StockValidationError
  );
  await assert.rejects(
    recordDelivery(db, { productId: product.id, deliveryQuantity: 0 }),
    StockValidationError
  );
  await assert.rejects(
    recordDelivery(db, { productId: product.id, deliveryQuantity: -3 }),
    StockValidationError
  );
  await assert.rejects(
    recordDelivery(db, { productId: product.id, deliveryQuantity: 1.5 }),
    StockValidationError
  );

  // Nonexistent product rejects
  await assert.rejects(
    setStockCount(db, { productId: 'nonexistent_prod', newQuantity: 10 }),
    StockValidationError
  );
  await assert.rejects(
    recordDelivery(db, { productId: 'nonexistent_prod', deliveryQuantity: 10 }),
    StockValidationError
  );
});

test('transaction rollback on failure preserves existing stock', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Original 80g',
    unit: 'pack',
    priceCentavos: 1500,
  });

  // Set initial stock to 10
  await setStockCount(db, {
    productId: product.id,
    newQuantity: 10,
    note: 'Initial',
  });

  // Inject failure trigger on inventory_movements table
  syncDb.exec(`
    CREATE TRIGGER fail_inventory_mov BEFORE INSERT ON inventory_movements
    BEGIN SELECT RAISE(ABORT, 'simulated inventory write failure'); END;
  `);

  // Attempt to set stock count to 99; must fail and roll back
  await assert.rejects(
    setStockCount(db, {
      productId: product.id,
      newQuantity: 99,
      note: 'Should fail',
    }),
    /simulated inventory write failure/
  );

  // Stock level must still be 10, NOT 99!
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 10);

  // Remove failure trigger and verify normal operation succeeds
  syncDb.exec('DROP TRIGGER fail_inventory_mov;');
  await setStockCount(db, {
    productId: product.id,
    newQuantity: 25,
    note: 'Success after trigger drop',
  });
  const updatedStock = await getStockLevel(db, product.id);
  assert.equal(updatedStock?.quantity, 25);
});

test('inventory history retrieval ordered by created_at descending', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Magic Sarap',
    variant: '8g',
    unit: 'sachet',
    priceCentavos: 500,
  });

  // Execute sequence of movements
  const m1 = await setStockCount(db, {
    productId: product.id,
    newQuantity: 20,
    note: 'M1: Unang bilang',
  });
  const m2 = await recordDelivery(db, {
    productId: product.id,
    deliveryQuantity: 10,
    note: 'M2: Delivery',
  });
  const m3 = await setStockCount(db, {
    productId: product.id,
    newQuantity: 28,
    note: 'M3: Count audit',
  });

  const history = await getInventoryHistory(db, product.id);
  assert.equal(history.length, 3);
  // Verify descending order
  assert.equal(history[0]?.id, m3.id);
  assert.equal(history[0]?.movementType, 'set_count');
  assert.equal(history[0]?.newQuantity, 28);
  assert.equal(history[0]?.previousQuantity, 30);
  assert.equal(history[0]?.quantityDelta, -2);

  assert.equal(history[1]?.id, m2.id);
  assert.equal(history[1]?.movementType, 'add_delivery');
  assert.equal(history[1]?.newQuantity, 30);
  assert.equal(history[1]?.previousQuantity, 20);
  assert.equal(history[1]?.quantityDelta, 10);

  assert.equal(history[2]?.id, m1.id);
  assert.equal(history[2]?.movementType, 'set_count');
  assert.equal(history[2]?.newQuantity, 20);
  assert.equal(history[2]?.previousQuantity, null);
  assert.equal(history[2]?.quantityDelta, 20);
});
