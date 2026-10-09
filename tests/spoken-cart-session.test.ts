import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { getAllProductsWithStock, setStockCount } from '../src/actions/inventory-actions.ts';
import { prepareSpokenOrder, applySpokenOrderProposal } from '../src/actions/spoken-order-actions.ts';
import { createSpokenCartSession } from '../src/domain/spoken-cart-session.ts';

async function fixture(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  const saved = await saveProduct(db, { name: 'Coke', variant: 'maliit', unit: 'bote', priceCentavos: 1500 });
  await setStockCount(db, { productId: saved.id, newQuantity: 20 });
  const product = (await getAllProductsWithStock(db)).find((row) => row.id === saved.id);
  assert.ok(product);
  const cart = [{ product, quantity: 3 }];
  const actions = { prepare: (text: string, currentCart: typeof cart) => prepareSpokenOrder(db, text, currentCart), apply: applySpokenOrderProposal };
  return { db, cart, actions };
}

test('review and applying a correction change only a copy of the cart, never the database', async (t) => {
  const { db, cart, actions } = await fixture(t);
  const before = await db.getAll('SELECT * FROM stock_levels;');
  const session = createSpokenCartSession(actions, cart);
  assert.equal(session.apply(), null);
  await session.prepare('isa lang pala');
  assert.equal(session.getState().status, 'review');
  assert.equal(session.getState().cart[0]?.quantity, 3);
  const applied = session.apply();
  assert.equal(applied?.[0]?.quantity, 1);
  assert.equal(cart[0]?.quantity, 3);
  assert.equal(session.apply(), null, 'rapid repeated apply cannot duplicate the cart change');
  assert.deepEqual(await db.getAll('SELECT * FROM stock_levels;'), before);
  assert.deepEqual(await db.getAll('SELECT * FROM sales;'), []);
});

test('editing or background cancellation invalidates review and preserves the existing cart', async (t) => {
  const { cart, actions } = await fixture(t);
  const session = createSpokenCartSession(actions, cart);
  await session.prepare('isa lang pala');
  session.invalidate();
  assert.equal(session.apply(), null);
  assert.equal(session.getState().cart[0]?.quantity, 3);
  await session.prepare('dalawa na lang');
  assert.equal(session.apply()?.[0]?.quantity, 2);
});

test('closing or changing mode blocks an outstanding preparation and future apply', async (t) => {
  const { cart, actions } = await fixture(t);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session = createSpokenCartSession({ ...actions, prepare: async (text, currentCart) => {
    const proposal = await actions.prepare(text, currentCart);
    await gate;
    return proposal;
  } }, cart);
  const pending = session.prepare('isa lang pala');
  session.close();
  release();
  await pending;
  assert.equal(session.getState().status, 'closed');
  assert.equal(session.apply(), null);
  await session.prepare('dalawa na lang');
  assert.equal(session.getState().status, 'closed');
  assert.equal(cart[0]?.quantity, 3);
});

test('an older lookup cannot replace the latest reviewed command', async (t) => {
  const { cart, actions } = await fixture(t);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session = createSpokenCartSession({ ...actions, prepare: async (text, currentCart) => {
    const proposal = await actions.prepare(text, currentCart);
    if (text === 'isa lang pala') await gate;
    return proposal;
  } }, cart);
  const first = session.prepare('isa lang pala');
  await session.prepare('dalawa na lang');
  release();
  await first;
  assert.equal(session.apply()?.[0]?.quantity, 2);
});

test('audio checkout and save commands never authorize a sale', async (t) => {
  const { db, cart, actions } = await fixture(t);
  const session = createSpokenCartSession(actions, cart);
  for (const text of ['kumpirmahin', 'save', 'checkout', 'bayad na']) {
    await session.prepare(text);
    assert.equal(session.apply(), null);
    assert.deepEqual(await db.getAll('SELECT * FROM sales;'), []);
    assert.equal(session.getState().cart[0]?.quantity, 3);
  }
});
