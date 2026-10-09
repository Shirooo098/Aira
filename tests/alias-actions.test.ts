import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import {
  getAllProducts,
  lookupProduct,
  saveProduct,
  updateProductPrice,
} from '../src/actions/catalog-actions.ts';
import { getRecentSales, completeCashSale } from '../src/actions/sales-actions.ts';
import { getStockLevel, setStockCount } from '../src/actions/inventory-actions.ts';
import { AliasValidationError, normalizeAlias, validateAlias } from '../src/domain/aliases.ts';
import {
  confirmAlias,
  getProductAliases,
  prepareAlias,
} from '../src/actions/alias-actions.ts';
import type { DatabaseSession } from '../src/db/database.ts';

async function createDatabase(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  return { sqlite, db };
}

async function businessDataSnapshot(db: DatabaseSession) {
  const tables = ['products', 'stock_levels', 'inventory_movements', 'sales', 'sale_items'];
  const snapshot: Record<string, unknown[]> = {};
  for (const table of tables) {
    snapshot[table] = await db.getAll(`SELECT * FROM ${table} ORDER BY rowid;`);
  }
  return snapshot;
}

test('normalizes aliases with NFC, trimmed edges, lowercase, and collapsed whitespace', () => {
  assert.equal(normalizeAlias('  Cafe\u0301\t\tLemon  '), 'café lemon');
  assert.equal(normalizeAlias('  TUBIG\nSA BOTIKA  '), 'tubig sa botika');
});

test('prepares a validated alias proposal without writing it', async (t) => {
  const { db } = await createDatabase(t);
  const product = await saveProduct(db, {
    name: 'Café Lemon Drink',
    variant: '250 ml',
    unit: 'bote',
    priceCentavos: 1800,
  });

  const proposal = await prepareAlias(db, product.id, '  Cafe\u0301\t Lemon  ');
  assert.equal(proposal.aliasText, 'Café Lemon');
  assert.equal(proposal.aliasNormalized, 'café lemon');
  assert.equal(proposal.product.id, product.id);
  assert.deepEqual(proposal.conflicts, []);
  assert.deepEqual(await getProductAliases(db, product.id), []);
  assert.equal(
    await db.getFirst<{ count: number }>('SELECT COUNT(*) AS count FROM product_aliases;').then((row) => row?.count),
    0,
  );

  await assert.rejects(
    prepareAlias(db, product.id, ' \t '),
    (error: unknown) => error instanceof AliasValidationError,
  );
  await assert.rejects(
    prepareAlias(db, product.id, 'a'.repeat(121)),
    (error: unknown) => error instanceof AliasValidationError,
  );
  assert.throws(() => validateAlias('  '), AliasValidationError);
  assert.throws(() => validateAlias('a'.repeat(121)), AliasValidationError);
  assert.deepEqual(await getProductAliases(db, product.id), []);
});

test('confirmation stores a normalized alias idempotently and lookup uses the current product price', async (t) => {
  const { db } = await createDatabase(t);
  const product = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: '250 ml',
    unit: 'bote',
    priceCentavos: 1800,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 12, note: 'Initial count' });
  await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 1 }],
    tenderCentavos: 2000,
    idempotencyKey: 'alias-side-effect-baseline',
  });

  const before = await businessDataSnapshot(db);
  const proposal = await prepareAlias(db, product.id, '  Koka-Kola  ');
  assert.deepEqual(await getProductAliases(db, product.id), []);

  await confirmAlias(db, proposal);
  const firstSave = await getProductAliases(db, product.id);
  assert.equal(firstSave.length, 1);
  assert.equal(firstSave[0]?.aliasText, 'Koka-Kola');
  assert.equal(firstSave[0]?.aliasNormalized, 'koka-kola');
  assert.equal(firstSave[0]?.productId, product.id);
  assert.ok(firstSave[0]?.createdAt);

  const equivalentProposal = await prepareAlias(db, product.id, '  KOKA-KOLA ');
  assert.deepEqual(equivalentProposal.conflicts, []);
  await confirmAlias(db, equivalentProposal);
  await confirmAlias(db, proposal);
  assert.deepEqual(await getProductAliases(db, product.id), firstSave);
  assert.deepEqual(await businessDataSnapshot(db), before);

  const firstLookup = await lookupProduct(db, '  KOKA-KOLA ');
  assert.equal(firstLookup.kind, 'exact');
  if (firstLookup.kind === 'exact') {
    assert.equal(firstLookup.product.id, product.id);
    assert.equal(firstLookup.product.priceCentavos, 1800);
  }

  await updateProductPrice(db, product.id, 1950);
  const lookupAfterPriceEdit = await lookupProduct(db, 'Koka-Kola');
  assert.equal(lookupAfterPriceEdit.kind, 'exact');
  if (lookupAfterPriceEdit.kind === 'exact') {
    assert.equal(lookupAfterPriceEdit.product.id, product.id);
    assert.equal(lookupAfterPriceEdit.product.priceCentavos, 1950);
  }

  assert.equal((await getStockLevel(db, product.id))?.quantity, 11);
  assert.equal((await getRecentSales(db)).length, 1);
  assert.equal((await getAllProducts(db)).find((item) => item.id === product.id)?.priceCentavos, 1950);
});

test('surfaces canonical-name and alias collisions for review, then lookup returns choices', async (t) => {
  const { db } = await createDatabase(t);
  const canonical = await saveProduct(db, {
    name: 'Sunlight Soap',
    variant: 'Bar',
    unit: 'piraso',
    priceCentavos: 2500,
  });
  const target = await saveProduct(db, {
    name: 'Safeguard',
    variant: 'White 60g',
    unit: 'bar',
    priceCentavos: 2800,
  });
  const anotherTarget = await saveProduct(db, {
    name: 'Dove',
    variant: 'Beauty Bar',
    unit: 'bar',
    priceCentavos: 3500,
  });

  const ownCanonicalAlias = await prepareAlias(db, canonical.id, 'Sunlight Soap');
  assert.deepEqual(ownCanonicalAlias.conflicts, []);
  await confirmAlias(db, ownCanonicalAlias);
  const deduplicatedLookup = await lookupProduct(db, 'Sunlight Soap');
  assert.equal(deduplicatedLookup.kind, 'exact');
  if (deduplicatedLookup.kind === 'exact') {
    assert.equal(deduplicatedLookup.product.id, canonical.id);
  }

  const canonicalCollision = await prepareAlias(db, target.id, 'Sunlight Soap');
  assert.deepEqual(canonicalCollision.conflicts.map((item) => item.id), [canonical.id]);
  await confirmAlias(db, canonicalCollision);
  const canonicalLookup = await lookupProduct(db, 'Sunlight Soap');
  assert.equal(canonicalLookup.kind, 'ambiguous');
  if (canonicalLookup.kind === 'ambiguous') {
    assert.deepEqual(new Set(canonicalLookup.products.map((item) => item.id)), new Set([canonical.id, target.id]));
  }

  await confirmAlias(db, await prepareAlias(db, target.id, 'Safi'));
  const aliasCollision = await prepareAlias(db, anotherTarget.id, '  SAFI  ');
  assert.deepEqual(aliasCollision.conflicts.map((item) => item.id), [target.id]);
  await confirmAlias(db, aliasCollision);
  const aliasLookup = await lookupProduct(db, 'SAFI');
  assert.equal(aliasLookup.kind, 'ambiguous');
  if (aliasLookup.kind === 'ambiguous') {
    assert.deepEqual(new Set(aliasLookup.products.map((item) => item.id)), new Set([target.id, anotherTarget.id]));
  }
});

test('rejects proposals when their product is missing or changed after preparation', async (t) => {
  const { db } = await createDatabase(t);
  const changedProduct = await saveProduct(db, {
    name: 'Bear Brand',
    variant: '33g',
    unit: 'sachet',
    priceCentavos: 1600,
  });
  const staleProposal = await prepareAlias(db, changedProduct.id, 'Bear Milk');
  await db.run(
    'UPDATE products SET name = ?, name_normalized = ?, updated_at = ? WHERE id = ?;',
    ['Bear Milk Family', 'bear milk family', new Date().toISOString(), changedProduct.id],
  );
  await assert.rejects(
    confirmAlias(db, staleProposal),
    (error: unknown) => error instanceof AliasValidationError,
  );
  assert.deepEqual(await getProductAliases(db, changedProduct.id), []);

  const deletedProduct = await saveProduct(db, {
    name: 'Nescafé',
    variant: 'Original 25g',
    unit: 'sachet',
    priceCentavos: 1200,
  });
  const deletedProposal = await prepareAlias(db, deletedProduct.id, 'Kape');
  await db.run('DELETE FROM products WHERE id = ?;', [deletedProduct.id]);
  await assert.rejects(
    confirmAlias(db, deletedProposal),
    (error: unknown) => error instanceof AliasValidationError,
  );
  await assert.rejects(
    prepareAlias(db, 'missing-product-id', 'Hindi Kilala'),
    (error: unknown) => error instanceof AliasValidationError,
  );
});

test('surfaces a failed alias INSERT without partial persistence and allows retry', async (t) => {
  const { db } = await createDatabase(t);
  const product = await saveProduct(db, {
    name: 'Argentina Corned Beef',
    variant: '150g',
    unit: 'lata',
    priceCentavos: 4500,
  });
  const proposal = await prepareAlias(db, product.id, 'Argentine Beef');
  await db.exec(`
    CREATE TRIGGER fail_product_alias_insert
    BEFORE INSERT ON product_aliases
    BEGIN SELECT RAISE(ABORT, 'simulated alias insert failure'); END;
  `);

  await assert.rejects(confirmAlias(db, proposal), /simulated alias insert failure/);
  assert.deepEqual(await getProductAliases(db, product.id), []);

  await db.exec('DROP TRIGGER fail_product_alias_insert;');
  await confirmAlias(db, proposal);
  assert.equal((await getProductAliases(db, product.id)).length, 1);
});
