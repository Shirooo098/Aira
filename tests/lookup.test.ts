import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct, lookupProduct } from '../src/actions/catalog-actions.ts';

test('typed lookup handles exact match, unknown product, and ambiguity correctly', async () => {
  const syncDb = new DatabaseSync(':memory:');
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // Seed catalog: multiple variants of Coke, single Safeguard
  const cokeSmall = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: 'Maliit 250ml',
    unit: 'bottle',
    priceCentavos: 1800,
  });

  const cokeLarge = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: '1.5L',
    unit: 'bottle',
    priceCentavos: 7500,
  });

  const safeguard = await saveProduct(db, {
    name: 'Safeguard White',
    variant: '60g',
    unit: 'bar',
    priceCentavos: 2800,
  });

  // 1. Empty lookup query
  const emptyRes = await lookupProduct(db, '   ');
  assert.equal(emptyRes.kind, 'empty');

  // 2. Exact unique lookup (Safeguard)
  const safeguardRes = await lookupProduct(db, 'Safeguard White');
  assert.equal(safeguardRes.kind, 'exact');
  if (safeguardRes.kind === 'exact') {
    assert.equal(safeguardRes.product.id, safeguard.id);
    assert.equal(safeguardRes.product.priceCentavos, 2800);
  }

  // 3. Ambiguous lookup (Coke has two variants)
  const ambiguousRes = await lookupProduct(db, 'Coca-Cola');
  assert.equal(ambiguousRes.kind, 'ambiguous');
  if (ambiguousRes.kind === 'ambiguous') {
    assert.equal(ambiguousRes.products.length, 2);
    const ids = ambiguousRes.products.map((p) => p.id);
    assert.ok(ids.includes(cokeSmall.id));
    assert.ok(ids.includes(cokeLarge.id));
  }

  // 4. Exact combo match for specific variant
  const specificRes = await lookupProduct(db, 'Coca-Cola 1.5L');
  assert.equal(specificRes.kind, 'exact');
  if (specificRes.kind === 'exact') {
    assert.equal(specificRes.product.id, cokeLarge.id);
    assert.equal(specificRes.product.priceCentavos, 7500);
  }

  // 5. Unknown product lookup NEVER invents a price
  const unknownRes = await lookupProduct(db, 'Chippy Green 110g');
  assert.equal(unknownRes.kind, 'unknown');
  if (unknownRes.kind === 'unknown') {
    assert.equal(unknownRes.query, 'Chippy Green 110g');
    assert.equal('price' in unknownRes, false);
    assert.equal('priceCentavos' in unknownRes, false);
  }
});

test('an unknown variant never inherits the price of a known product name', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await saveProduct(db, { name: 'Coke', variant: '250 ml', unit: 'bottle', priceCentavos: 1550 });
  assert.deepEqual(await lookupProduct(db, 'Coke 999 ml'), {
    kind: 'unknown', query: 'Coke 999 ml',
  });
});
