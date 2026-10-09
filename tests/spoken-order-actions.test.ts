import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import {
  getAllProductsWithStock,
  getInventoryHistory,
  getStockLevel,
  setStockCount,
} from '../src/actions/inventory-actions.ts';
import { confirmAlias, prepareAlias } from '../src/actions/alias-actions.ts';
import { completeCashSale, getRecentSales } from '../src/actions/sales-actions.ts';
import {
  applySpokenOrderProposal,
  prepareSpokenOrder,
} from '../src/actions/spoken-order-actions.ts';
import type { DatabaseSession } from '../src/db/database.ts';

async function createDatabase(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  return db;
}

async function seedCatalog(db: DatabaseSession) {
  const cokeSmall = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: 'Maliit 250ml',
    unit: 'bote',
    priceCentavos: 1800,
  });
  const cokeLarge = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: '1.5L',
    unit: 'bote',
    priceCentavos: 7500,
  });
  const luckyMe = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Chicken 60g',
    unit: 'piraso',
    priceCentavos: 1600,
  });
  const pepsi = await saveProduct(db, {
    name: 'Pepsi Cola',
    variant: '355ml',
    unit: 'bote',
    priceCentavos: 2000,
  });
  const milo = await saveProduct(db, {
    name: 'Milo',
    variant: '22g',
    unit: 'sachet',
    priceCentavos: 1200,
  });

  for (const [productId, alias] of [
    [cokeSmall.id, 'Coke maliit'],
    [luckyMe.id, 'Lucky Me chicken'],
    [cokeSmall.id, 'softdrink'],
    [pepsi.id, 'softdrink'],
  ] as const) {
    await confirmAlias(db, await prepareAlias(db, productId, alias));
  }

  return { cokeSmall, cokeLarge, luckyMe, pepsi, milo };
}

async function businessDataSnapshot(db: DatabaseSession) {
  const tables = [
    'products',
    'product_aliases',
    'stock_levels',
    'inventory_movements',
    'sales',
    'sale_items',
    'pending_gcash_drafts',
    'customers',
    'credit_entries',
    'credit_repayments',
    'repayment_allocations',
  ];
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tables) {
    snapshot[table] = await db.getAll(`SELECT * FROM ${table} ORDER BY rowid;`);
  }
  return snapshot;
}

test('prepares alias-resolved multi-item orders and leaves business data unchanged through apply', async (t) => {
  const db = await createDatabase(t);
  const { cokeSmall, luckyMe } = await seedCatalog(db);
  await setStockCount(db, { productId: cokeSmall.id, newQuantity: 12 });
  await setStockCount(db, { productId: luckyMe.id, newQuantity: 10 });
  const before = await businessDataSnapshot(db);

  const proposal = await prepareSpokenOrder(
    db,
    'Pabili ng dalawang Coke maliit at tatlong Lucky Me chicken',
    [],
  );
  assert.equal(proposal.kind, 'add');
  if (proposal.kind !== 'add') return;
  assert.deepEqual(
    proposal.items.map((item) => ({ query: item.query.toLocaleLowerCase(), quantity: item.quantity, productId: item.product?.id })),
    [
      { query: 'coke maliit', quantity: 2, productId: cokeSmall.id },
      { query: 'lucky me chicken', quantity: 3, productId: luckyMe.id },
    ],
  );

  const omittedSecondQuantity = await prepareSpokenOrder(
    db,
    'Pabili ng dalawang Lucky Me chicken at Coke maliit',
    [],
  );
  assert.equal(omittedSecondQuantity.kind, 'add');
  if (omittedSecondQuantity.kind === 'add') {
    assert.deepEqual(
      omittedSecondQuantity.items.map((item) => ({
        query: item.query.toLocaleLowerCase(),
        quantity: item.quantity,
        productId: item.product?.id,
      })),
      [
        { query: 'lucky me chicken', quantity: 2, productId: luckyMe.id },
        { query: 'coke maliit', quantity: null, productId: cokeSmall.id },
      ],
    );
  }

  const cart = applySpokenOrderProposal([], proposal);
  assert.deepEqual(
    cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    [
      { productId: cokeSmall.id, quantity: 2 },
      { productId: luckyMe.id, quantity: 3 },
    ],
  );
  assert.deepEqual(await businessDataSnapshot(db), before);
});

test('keeps ambiguous aliases, singleton partial matches, and unknown products unresolved for explicit choice', async (t) => {
  const db = await createDatabase(t);
  const products = await seedCatalog(db);
  const allProductIds = (await getAllProductsWithStock(db)).map((product) => product.id).sort();

  const aliasCollision = await prepareSpokenOrder(db, 'pabili ng dalawang softdrink', []);
  assert.equal(aliasCollision.kind, 'add');
  if (aliasCollision.kind !== 'add') return;
  const collision = aliasCollision.items[0];
  assert.ok(collision);
  assert.equal(collision.product, null);
  assert.deepEqual(
    collision.candidates.map((product) => product.id).sort(),
    [products.cokeSmall.id, products.pepsi.id].sort(),
  );
  assert.throws(() => applySpokenOrderProposal([], aliasCollision));

  const unresolvedVariant = await prepareSpokenOrder(db, 'pabili ng dalawang Coca-Cola', []);
  assert.equal(unresolvedVariant.kind, 'add');
  if (unresolvedVariant.kind !== 'add') return;
  const variantChoice = unresolvedVariant.items[0];
  assert.ok(variantChoice);
  assert.equal(variantChoice.product, null);
  assert.deepEqual(
    variantChoice.candidates.map((product) => product.id).sort(),
    [products.cokeSmall.id, products.cokeLarge.id].sort(),
  );
  assert.throws(() => applySpokenOrderProposal([], unresolvedVariant));

  const singletonPartial = await prepareSpokenOrder(db, 'pabili ng dalawang Mil', []);
  assert.equal(singletonPartial.kind, 'add');
  if (singletonPartial.kind !== 'add') return;
  const partial = singletonPartial.items[0];
  assert.ok(partial);
  assert.equal(partial.product, null);
  assert.deepEqual(partial.candidates.map((product) => product.id), [products.milo.id]);
  assert.throws(() => applySpokenOrderProposal([], singletonPartial));

  const unknown = await prepareSpokenOrder(db, 'pabili ng Chippy Green', []);
  assert.equal(unknown.kind, 'add');
  if (unknown.kind !== 'add') return;
  const unknownItem = unknown.items[0];
  assert.ok(unknownItem);
  assert.equal(unknownItem.product, null);
  assert.equal(unknownItem.quantity, null);
  assert.deepEqual(unknownItem.candidates.map((product) => product.id).sort(), allProductIds);
  assert.throws(() =>
    applySpokenOrderProposal([], unknown, {
      items: [{ productId: 'invented-product-id', quantity: 1 }],
    }),
  );
});

test('requires context selection for multi-line corrections and removes only the chosen cart item', async (t) => {
  const db = await createDatabase(t);
  const { cokeSmall, cokeLarge, luckyMe } = await seedCatalog(db);
  const products = await getAllProductsWithStock(db);
  const byId = new Map(products.map((product) => [product.id, product]));
  const cart = [
    { product: byId.get(cokeSmall.id)!, quantity: 4 },
    { product: byId.get(cokeLarge.id)!, quantity: 2 },
    { product: byId.get(luckyMe.id)!, quantity: 5 },
  ];

  const correction = await prepareSpokenOrder(db, 'isa lang pala', cart);
  assert.equal(correction.kind, 'set_quantity');
  if (correction.kind !== 'set_quantity') return;
  assert.equal(correction.targetProductId, null);
  assert.deepEqual(
    correction.candidates.map((line) => line.product.id).sort(),
    [cokeSmall.id, cokeLarge.id, luckyMe.id].sort(),
  );
  assert.throws(() => applySpokenOrderProposal(cart, correction));

  const corrected = applySpokenOrderProposal(cart, correction, { targetProductId: cokeLarge.id });
  assert.deepEqual(
    corrected.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    [
      { productId: cokeSmall.id, quantity: 4 },
      { productId: cokeLarge.id, quantity: 1 },
      { productId: luckyMe.id, quantity: 5 },
    ],
  );
  assert.throws(() =>
    applySpokenOrderProposal(cart, correction, { targetProductId: 'invented-product-id' }),
  );
  assert.deepEqual(cart.map((line) => line.quantity), [4, 2, 5]);

  const removal = await prepareSpokenOrder(db, 'tanggalin ang Lucky Me chicken', cart);
  assert.equal(removal.kind, 'remove');
  if (removal.kind !== 'remove') return;
  const afterRemoval = applySpokenOrderProposal(cart, removal);
  assert.deepEqual(afterRemoval.map((line) => line.product.id), [cokeSmall.id, cokeLarge.id]);
});

test('requires a safe explicit quantity and rejects an invalid addition without changing the cart', async (t) => {
  const db = await createDatabase(t);
  const { cokeSmall, luckyMe } = await seedCatalog(db);
  const product = (await getAllProductsWithStock(db)).find((item) => item.id === cokeSmall.id);
  assert.ok(product);
  const cart = [{ product, quantity: 2 }];
  const proposal = await prepareSpokenOrder(db, 'pabili ng Coke maliit', cart);
  assert.equal(proposal.kind, 'add');
  if (proposal.kind !== 'add') return;
  assert.equal(proposal.items[0]?.product?.id, cokeSmall.id);
  assert.equal(proposal.items[0]?.quantity, null);
  assert.throws(() => applySpokenOrderProposal(cart, proposal));
  const withReviewedQuantity = applySpokenOrderProposal(cart, proposal, {
    items: [{ productId: cokeSmall.id, quantity: 1 }],
  });
  assert.equal(withReviewedQuantity[0]?.quantity, 3);

  assert.throws(() =>
    applySpokenOrderProposal(cart, proposal, {
      items: [{ productId: cokeSmall.id, quantity: Number.MAX_SAFE_INTEGER + 1 }],
    }),
  );
  assert.throws(() =>
    applySpokenOrderProposal(cart, proposal, {
      items: [{ productId: 'invented-product-id', quantity: 1 }],
    }),
  );

  const multiItemProposal = await prepareSpokenOrder(
    db,
    'pabili ng dalawang Lucky Me chicken at Chippy Green',
    cart,
  );
  assert.equal(multiItemProposal.kind, 'add');
  if (multiItemProposal.kind === 'add') {
    assert.deepEqual(
      multiItemProposal.items.map((item) => ({
        query: item.query.toLocaleLowerCase(),
        quantity: item.quantity,
        productId: item.product?.id,
      })),
      [
        { query: 'lucky me chicken', quantity: 2, productId: luckyMe.id },
        { query: 'chippy green', quantity: null, productId: undefined },
      ],
    );
    assert.deepEqual(
      multiItemProposal.items[1]?.candidates.map((candidate) => candidate.id).sort(),
      (await getAllProductsWithStock(db)).map((candidate) => candidate.id).sort(),
    );
  }
  assert.throws(() =>
    applySpokenOrderProposal(cart, multiItemProposal, {
      items: [
        { productId: luckyMe.id, quantity: 2 },
        { productId: 'invented-product-id', quantity: 1 },
      ],
    }),
  );
  assert.deepEqual(cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })), [
    { productId: cokeSmall.id, quantity: 2 },
  ]);
});

test('applies a spoken correction before cash sale and idempotent confirmation deducts stock once', async (t) => {
  const db = await createDatabase(t);
  const { cokeSmall, luckyMe } = await seedCatalog(db);
  await setStockCount(db, { productId: cokeSmall.id, newQuantity: 12 });
  await setStockCount(db, { productId: luckyMe.id, newQuantity: 10 });
  const beforeDraft = await businessDataSnapshot(db);

  const order = await prepareSpokenOrder(
    db,
    'Pabili ng dalawang Coke maliit at tatlong Lucky Me chicken',
    [],
  );
  const draftCart = applySpokenOrderProposal([], order);
  const correction = await prepareSpokenOrder(db, 'gawing isa ang Coke maliit', draftCart);
  const correctedCart = applySpokenOrderProposal(draftCart, correction);

  assert.deepEqual(
    correctedCart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    [
      { productId: cokeSmall.id, quantity: 1 },
      { productId: luckyMe.id, quantity: 3 },
    ],
  );
  assert.deepEqual(await businessDataSnapshot(db), beforeDraft);

  const saleItems = correctedCart.map((line) => ({ productId: line.product.id, quantity: line.quantity }));
  const sale = await completeCashSale(db, {
    items: saleItems,
    tenderCentavos: 10000,
    idempotencyKey: 'spoken-order-corrected-cash-sale',
  });
  const retry = await completeCashSale(db, {
    items: saleItems,
    tenderCentavos: 10000,
    idempotencyKey: 'spoken-order-corrected-cash-sale',
  });

  assert.equal(sale.id, retry.id);
  assert.equal(sale.totalCentavos, 6600);
  assert.equal(sale.items.length, 2);
  assert.equal((await getStockLevel(db, cokeSmall.id))?.quantity, 11);
  assert.equal((await getStockLevel(db, luckyMe.id))?.quantity, 7);
  assert.equal((await getRecentSales(db)).length, 1);
  assert.equal((await getInventoryHistory(db, cokeSmall.id)).filter((movement) => movement.movementType === 'sale_deduction').length, 1);
  assert.equal((await getInventoryHistory(db, luckyMe.id)).filter((movement) => movement.movementType === 'sale_deduction').length, 1);
});
