import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { getAllProducts } from '../src/actions/catalog-actions.ts';
import { getStockLevel } from '../src/actions/inventory-actions.ts';
import { prepareCatalogChange, confirmCatalogChange } from '../src/actions/catalog-draft-actions.ts';
import { emptyCatalogChangeFields } from '../src/domain/catalog-dictation.ts';
import { createCatalogDraftSession, isSpokenCatalogConfirmation, selectCatalogProduct } from '../src/domain/catalog-draft-session.ts';

async function fixture(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  const fields = { ...emptyCatalogChangeFields(), name: 'Lucky Me', variant: 'chicken', unit: 'piraso', priceInput: '15', quantityInput: '10' };
  const actions = { prepare: (input: typeof fields) => prepareCatalogChange(db, input), save: (proposal: Parameters<typeof confirmCatalogChange>[1]) => confirmCatalogChange(db, proposal) };
  return { db, fields, actions };
}

test('spoken confirmation requires a reviewed draft and never parses embedded save instructions', async (t) => {
  const { db, fields, actions } = await fixture(t);
  const session = createCatalogDraftSession(actions);
  assert.equal(await session.confirm('spoken', 'kumpirmahin'), null);
  await session.review(fields);
  assert.deepEqual(await getAllProducts(db), []);
  assert.equal(await session.confirm('spoken', 'kumpirmahin at dagdag delivery ng sampu'), null);
  assert.equal(await session.confirm('spoken', 'huwag i-save'), null);
  assert.equal(await session.confirm('spoken', 'oo'), null);
  const saved = await session.confirm('spoken', 'Kumpirmahin!');
  assert.ok(saved);
  assert.equal((await getStockLevel(db, saved.id))?.quantity, 10);
  assert.equal(await session.confirm('spoken', 'kumpirmahin'), null);
  assert.equal((await getAllProducts(db)).length, 1);
});

test('editing, cancellation and mode-change disposal invalidate reviewed drafts', async (t) => {
  const { db, fields, actions } = await fixture(t);
  const session = createCatalogDraftSession(actions);
  await session.review(fields);
  session.edit();
  assert.equal(await session.confirm('button'), null);
  await session.review(fields);
  session.close();
  assert.equal(await session.confirm('spoken', 'save'), null);
  await session.review(fields);
  assert.equal(session.getState().status, 'closed');
  assert.deepEqual(await getAllProducts(db), []);
});

test('a late preparation cannot restore review after editing or closing the view', async (t) => {
  const { db, fields, actions } = await fixture(t);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const session = createCatalogDraftSession({ ...actions, prepare: async (input) => {
    const result = await actions.prepare(input);
    await gate;
    return result;
  } });
  const pending = session.review(fields);
  session.edit();
  release();
  await pending;
  assert.equal(session.getState().status, 'editing');
  assert.equal(await session.confirm('button'), null);
  const another = session.review(fields);
  session.close();
  await another;
  assert.equal(session.getState().status, 'closed');
  assert.deepEqual(await getAllProducts(db), []);
});

test('duplicate confirmation shares one authorized save and closing suppresses stale results', async (t) => {
  const { db, fields, actions } = await fixture(t);
  let release = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  const session = createCatalogDraftSession({ ...actions, save: async (proposal) => {
    calls++;
    await gate;
    return actions.save(proposal);
  } });
  await session.review(fields);
  const first = session.confirm('button');
  const second = session.confirm('spoken', 'confirm');
  assert.equal(first, second);
  session.close();
  release();
  assert.ok(await first);
  assert.equal(calls, 1);
  assert.equal(session.getState().status, 'closed');
  assert.equal((await getAllProducts(db)).length, 1);
});

test('save errors remain visible and a fresh field review is required before retry', async (t) => {
  const { fields, actions } = await fixture(t);
  let calls = 0;
  const session = createCatalogDraftSession({ ...actions, save: async (proposal) => {
    if (++calls === 1) throw new Error('simulated save failure');
    return actions.save(proposal);
  } });
  await session.review(fields);
  assert.equal(await session.confirm('button'), null);
  assert.match(session.getState().error ?? '', /simulated save failure/);
  assert.equal(await session.confirm('spoken', 'save'), null);
  await session.review(fields);
  assert.ok(await session.confirm('button'));
});

test('only standalone confirmation phrases are accepted', () => {
  assert.equal(isSpokenCatalogConfirmation('  Kumpirmahin. '), true);
  assert.equal(isSpokenCatalogConfirmation('i-save'), true);
  assert.equal(isSpokenCatalogConfirmation('Lucky Me, 15 pesos, save'), false);
  assert.equal(isSpokenCatalogConfirmation('cancel'), false);
});

test('the UI catalog-selection mapping prepares each existing-product intent', async (t) => {
  const { db, fields, actions } = await fixture(t);
  const product = await actions.save(await actions.prepare(fields));
  for (const kind of ['price_update', 'set_count', 'add_delivery'] as const) {
    const selected = selectCatalogProduct({
      ...emptyCatalogChangeFields(kind),
      productQuery: 'store nickname',
      priceInput: kind === 'price_update' ? '18.50' : '',
      quantityInput: kind === 'price_update' ? '' : '5',
    }, product);
    assert.equal(selected.name, '');
    const proposal = await prepareCatalogChange(db, selected);
    assert.equal(proposal.kind, kind);
    assert.ok('id' in proposal.product);
    assert.equal(proposal.product.id, product.id);
  }
});
