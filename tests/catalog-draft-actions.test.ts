import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import type { CatalogChangeFields, CatalogChangeKind } from '../src/domain/catalog-dictation.ts';
import {
  CatalogChangeValidationError,
  confirmCatalogChange,
  prepareCatalogChange,
} from '../src/actions/catalog-draft-actions.ts';
import { getAllProducts, getProductById, saveProduct, updateProductPrice } from '../src/actions/catalog-actions.ts';
import {
  getInventoryHistory,
  getStockLevel,
  setStockCount,
} from '../src/actions/inventory-actions.ts';
import { confirmAlias, prepareAlias } from '../src/actions/alias-actions.ts';

function changeFields(
  kind: CatalogChangeKind,
  overrides: Partial<CatalogChangeFields> = {}
): CatalogChangeFields {
  const isNewProduct = kind === 'new_product';
  const hasPrice = kind === 'new_product' || kind === 'price_update';
  const hasQuantity = kind === 'new_product' || kind === 'set_count' || kind === 'add_delivery';
  return {
    kind,
    name: isNewProduct ? 'Lucky Me' : '',
    variant: isNewProduct ? 'Chicken 60g' : '',
    unit: isNewProduct ? 'pack' : '',
    priceInput: hasPrice ? '15.90' : '',
    quantityInput: hasQuantity ? '10' : '',
    productQuery: isNewProduct ? '' : 'Lucky Me',
    productId: null,
    ...overrides,
  };
}

async function createTestDatabase(t: test.TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  return { db, sqlite };
}

async function rowCount(db: NodeSqliteAdapter, table: string): Promise<number> {
  const row = await db.getFirst<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table};`);
  return row?.count ?? 0;
}

test('preparation is read-only and explicit confirmation saves a new product with initial count atomically', async (t) => {
  const { db } = await createTestDatabase(t);
  const proposal = await prepareCatalogChange(db, changeFields('new_product'));

  assert.equal(proposal.kind, 'new_product');
  assert.equal(proposal.priceCentavos, 1590);
  assert.equal(proposal.quantity, 10);
  assert.equal(proposal.previousQuantity, null);
  assert.deepEqual(await getAllProducts(db), [], 'preparing a proposal must not save it');
  assert.equal(await rowCount(db, 'stock_levels'), 0);
  assert.equal(await rowCount(db, 'inventory_movements'), 0);

  const saved = await confirmCatalogChange(db, proposal);
  assert.equal(saved.name, 'Lucky Me');
  assert.equal(saved.variant, 'Chicken 60g');
  assert.equal(saved.unit, 'pack');
  assert.equal(saved.priceCentavos, 1590);

  const products = await getAllProducts(db);
  assert.equal(products.length, 1);
  assert.equal(products[0]?.id, saved.id);
  assert.equal((await getStockLevel(db, saved.id))?.quantity, 10);
  const history = await getInventoryHistory(db, saved.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.movementType, 'set_count');
  assert.equal(history[0]?.previousQuantity, null);
  assert.equal(history[0]?.newQuantity, 10);
});

test('new-product preparation rejects every missing required field without writing', async (t) => {
  const { db } = await createTestDatabase(t);
  const missingFields: Array<keyof CatalogChangeFields> = [
    'name', 'variant', 'unit', 'priceInput', 'quantityInput',
  ];

  for (const field of missingFields) {
    await assert.rejects(
      prepareCatalogChange(db, changeFields('new_product', { [field]: ' ' })),
      CatalogChangeValidationError,
      `expected missing ${field} to require clarification`
    );
  }

  assert.deepEqual(await getAllProducts(db), []);
  assert.equal(await rowCount(db, 'stock_levels'), 0);
  assert.equal(await rowCount(db, 'inventory_movements'), 0);
});

test('duplicate new-product identity is rejected and never treated as a price update', async (t) => {
  const { db } = await createTestDatabase(t);
  const existing = await saveProduct(db, {
    name: 'Lucky Me', variant: 'Chicken 60g', unit: 'pack', priceCentavos: 1400,
  });
  await setStockCount(db, { productId: existing.id, newQuantity: 4 });

  await assert.rejects(
    prepareCatalogChange(db, changeFields('new_product', { priceInput: '18.00' })),
    /mayroon nang ganitong produkto/i
  );

  const products = await getAllProducts(db);
  assert.equal(products.length, 1);
  assert.equal(products[0]?.priceCentavos, 1400);
  assert.equal((await getStockLevel(db, existing.id))?.quantity, 4);
  assert.equal((await getInventoryHistory(db, existing.id)).length, 1);
});

test('unknown and ambiguous product queries require an explicit product choice; aliases resolve to their confirmed product', async (t) => {
  const { db } = await createTestDatabase(t);
  const small = await saveProduct(db, {
    name: 'Coke', variant: '250 ml', unit: 'bote', priceCentavos: 1500,
  });
  const large = await saveProduct(db, {
    name: 'Coke', variant: '1.5 L', unit: 'bote', priceCentavos: 7000,
  });

  await assert.rejects(
    prepareCatalogChange(db, changeFields('price_update', {
      productQuery: 'Walang ganito', priceInput: '16.00',
    })),
    CatalogChangeValidationError
  );
  await assert.rejects(
    prepareCatalogChange(db, changeFields('price_update', {
      productQuery: 'Coke', priceInput: '16.00',
    })),
    /maraming katugmang produkto|pumili ng isa/i
  );

  const chosen = await prepareCatalogChange(db, changeFields('price_update', {
    productQuery: 'Coke', productId: large.id, priceInput: '72.50',
  }));
  assert.equal(chosen.kind, 'price_update');
  assert.equal(chosen.product.id, large.id, 'an explicit reviewed choice selects one ambiguous result');

  const aliasDraft = await prepareAlias(db, small.id, 'pulang bote');
  await confirmAlias(db, aliasDraft);
  const aliasProposal = await prepareCatalogChange(db, changeFields('price_update', {
    productQuery: 'pulang bote', priceInput: '16.25',
  }));
  assert.equal(aliasProposal.kind, 'price_update');
  assert.equal(aliasProposal.product.id, small.id);
});

test('price-only confirmation preserves stock, inventory history, sales, and utang records', async (t) => {
  const { db } = await createTestDatabase(t);
  const product = await saveProduct(db, {
    name: 'Bear Brand', variant: '33g', unit: 'sachet', priceCentavos: 1600,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 30, note: 'Unang bilang' });

  await db.run(
    `INSERT INTO sales (id, payment_method, total_centavos, tender_centavos, change_centavos, created_at, paid_centavos, credit_centavos)
     VALUES (?, 'cash', 1600, 2000, 400, ?, 1600, 0);`,
    ['sale_keep', '2026-10-10T00:00:00.000Z']
  );
  await db.run(
    `INSERT INTO sale_items (id, sale_id, product_id, product_name, product_variant, product_unit, unit_price_centavos, quantity, subtotal_centavos)
     VALUES (?, ?, ?, ?, ?, ?, 1600, 1, 1600);`,
    ['item_keep', 'sale_keep', product.id, product.name, product.variant, product.unit]
  );
  await db.run(
    `INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, ?, ?, ?);`,
    ['customer_keep', 'Aling Nena', '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z']
  );
  await db.run(
    `INSERT INTO credit_entries (id, customer_id, entry_type, original_amount_centavos, remaining_amount_centavos, description, created_at, updated_at)
     VALUES (?, ?, 'opening_balance', 5000, 5000, 'Uutang dati', ?, ?);`,
    ['credit_keep', 'customer_keep', '2026-10-10T00:00:00.000Z', '2026-10-10T00:00:00.000Z']
  );

  const before = {
    stock: await getStockLevel(db, product.id),
    movements: await getInventoryHistory(db, product.id),
    sales: await db.getAll('SELECT * FROM sales ORDER BY id;'),
    saleItems: await db.getAll('SELECT * FROM sale_items ORDER BY id;'),
    credits: await db.getAll('SELECT * FROM credit_entries ORDER BY id;'),
    repayments: await db.getAll('SELECT * FROM credit_repayments ORDER BY id;'),
  };
  const proposal = await prepareCatalogChange(db, changeFields('price_update', {
    productQuery: 'Bear Brand', priceInput: '18.25', quantityInput: '',
  }));
  const updated = await confirmCatalogChange(db, proposal);

  assert.equal(updated.priceCentavos, 1825);
  assert.deepEqual(await getStockLevel(db, product.id), before.stock);
  assert.deepEqual(await getInventoryHistory(db, product.id), before.movements);
  assert.deepEqual(await db.getAll('SELECT * FROM sales ORDER BY id;'), before.sales);
  assert.deepEqual(await db.getAll('SELECT * FROM sale_items ORDER BY id;'), before.saleItems);
  assert.deepEqual(await db.getAll('SELECT * FROM credit_entries ORDER BY id;'), before.credits);
  assert.deepEqual(await db.getAll('SELECT * FROM credit_repayments ORDER BY id;'), before.repayments);
});

test('set-count replaces stock while delivery adds stock and records distinct movement types', async (t) => {
  const { db } = await createTestDatabase(t);
  const product = await saveProduct(db, {
    name: 'Nestea', variant: '25g', unit: 'sachet', priceCentavos: 2000,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 12, note: 'Unang bilang' });

  const countProposal = await prepareCatalogChange(db, changeFields('set_count', {
    productQuery: 'Nestea', quantityInput: '8', priceInput: '',
  }));
  assert.equal(countProposal.kind, 'set_count');
  assert.equal(countProposal.quantity, 8);
  assert.equal(countProposal.previousQuantity, 12);
  await confirmCatalogChange(db, countProposal);
  assert.equal((await getStockLevel(db, product.id))?.quantity, 8);

  const deliveryProposal = await prepareCatalogChange(db, changeFields('add_delivery', {
    productQuery: 'Nestea', quantityInput: '5', priceInput: '',
  }));
  assert.equal(deliveryProposal.kind, 'add_delivery');
  assert.equal(deliveryProposal.quantity, 5);
  assert.equal(deliveryProposal.previousQuantity, 8);
  await confirmCatalogChange(db, deliveryProposal);
  assert.equal((await getStockLevel(db, product.id))?.quantity, 13);

  const history = await getInventoryHistory(db, product.id);
  assert.equal(history.length, 3);
  assert.equal(history[0]?.movementType, 'add_delivery');
  assert.equal(history[0]?.previousQuantity, 8);
  assert.equal(history[0]?.newQuantity, 13);
  assert.equal(history[1]?.movementType, 'set_count');
  assert.equal(history[1]?.previousQuantity, 12);
  assert.equal(history[1]?.newQuantity, 8);
});

test('invalid money and quantity values fail before they can be confirmed', async (t) => {
  const { db } = await createTestDatabase(t);
  const product = await saveProduct(db, {
    name: 'Sprite', variant: '1.5L', unit: 'bote', priceCentavos: 7000,
  });

  for (const priceInput of ['-1', '15.123', '90071992547409.92']) {
    await assert.rejects(
      prepareCatalogChange(db, changeFields('price_update', {
        productQuery: 'Sprite', priceInput,
      })),
      CatalogChangeValidationError,
      `expected invalid price ${priceInput} to be rejected`
    );
  }

  for (const quantityInput of ['-1', '1.5', '9007199254740992']) {
    await assert.rejects(
      prepareCatalogChange(db, changeFields('set_count', {
        productQuery: 'Sprite', priceInput: '', quantityInput,
      })),
      CatalogChangeValidationError,
      `expected invalid count ${quantityInput} to be rejected`
    );
  }
  await assert.rejects(
    prepareCatalogChange(db, changeFields('add_delivery', {
      productQuery: 'Sprite', priceInput: '', quantityInput: '0',
    })),
    CatalogChangeValidationError,
    'delivery quantity must be positive'
  );

  assert.equal((await getProductById(db, product.id))?.priceCentavos, 7000);
  assert.equal(await getStockLevel(db, product.id), null);
});

test('confirmation rejects stale price and stock proposals', async (t) => {
  const { db } = await createTestDatabase(t);
  const product = await saveProduct(db, {
    name: 'Coca-Cola', variant: '250 ml', unit: 'bote', priceCentavos: 1500,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  const priceProposal = await prepareCatalogChange(db, changeFields('price_update', {
    productQuery: 'Coca-Cola', priceInput: '16.00',
  }));
  await updateProductPrice(db, product.id, 1700);
  await assert.rejects(confirmCatalogChange(db, priceProposal), /nagbago na ang presyo/i);
  assert.equal((await getAllProducts(db))[0]?.priceCentavos, 1700);

  const countProposal = await prepareCatalogChange(db, changeFields('set_count', {
    productQuery: 'Coca-Cola', priceInput: '', quantityInput: '9',
  }));
  await setStockCount(db, { productId: product.id, newQuantity: 11 });
  await assert.rejects(confirmCatalogChange(db, countProposal), /nagbago na ang stock/i);
  assert.equal((await getStockLevel(db, product.id))?.quantity, 11);
});

test('new-product confirmation rolls back product and initial stock when its movement insert fails', async (t) => {
  const { db, sqlite } = await createTestDatabase(t);
  const proposal = await prepareCatalogChange(db, changeFields('new_product'));
  sqlite.exec(`
    CREATE TRIGGER fail_catalog_initial_movement BEFORE INSERT ON inventory_movements
    BEGIN SELECT RAISE(ABORT, 'simulated inventory write failure'); END;
  `);

  await assert.rejects(confirmCatalogChange(db, proposal), /simulated inventory write failure/);
  assert.deepEqual(await getAllProducts(db), []);
  assert.equal(await rowCount(db, 'stock_levels'), 0);
  assert.equal(await rowCount(db, 'inventory_movements'), 0);
});

test('existing stock and price writes roll back when a confirmation write fails', async (t) => {
  const { db, sqlite } = await createTestDatabase(t);
  const product = await saveProduct(db, {
    name: 'Magic Sarap', variant: '8g', unit: 'sachet', priceCentavos: 500,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 20 });

  const countProposal = await prepareCatalogChange(db, changeFields('set_count', {
    productQuery: 'Magic Sarap', priceInput: '', quantityInput: '25',
  }));
  sqlite.exec(`
    CREATE TRIGGER fail_existing_movement BEFORE INSERT ON inventory_movements
    BEGIN SELECT RAISE(ABORT, 'simulated inventory write failure'); END;
  `);
  await assert.rejects(confirmCatalogChange(db, countProposal), /simulated inventory write failure/);
  assert.equal((await getStockLevel(db, product.id))?.quantity, 20);
  assert.equal((await getInventoryHistory(db, product.id)).length, 1);

  sqlite.exec('DROP TRIGGER fail_existing_movement;');
  const priceProposal = await prepareCatalogChange(db, changeFields('price_update', {
    productQuery: 'Magic Sarap', priceInput: '6.00',
  }));
  sqlite.exec(`
    CREATE TRIGGER fail_price_change BEFORE UPDATE OF price_centavos ON products
    BEGIN SELECT RAISE(ABORT, 'simulated product write failure'); END;
  `);
  await assert.rejects(confirmCatalogChange(db, priceProposal), /simulated product write failure/);
  assert.equal((await getAllProducts(db))[0]?.priceCentavos, 500);
  assert.equal((await getStockLevel(db, product.id))?.quantity, 20);
});

