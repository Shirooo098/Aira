import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel } from '../src/actions/inventory-actions.ts';
import {
  parseNotebookLine,
  parseNotebookText,
} from '../src/domain/notebook.ts';
import {
  proposeNotebookCatalogUpdates,
  applyNotebookCatalogUpdates,
  NotebookValidationError,
} from '../src/actions/notebook-actions.ts';

test('parseNotebookLine extracts name, variant, unit, and integer centavos', () => {
  const line1 = parseNotebookLine('Coke 250ml bote - 16.50');
  assert.equal(line1.name, 'Coke');
  assert.equal(line1.variant, '250ml');
  assert.equal(line1.unit, 'bote');
  assert.equal(line1.priceCentavos, 1650);
  assert.equal(line1.warnings.length, 0);

  const line2 = parseNotebookLine('Lucky Me Pancit Canton (Kalamansi) 17.00');
  assert.equal(line2.name, 'Lucky Me Pancit Canton');
  assert.equal(line2.variant, 'Kalamansi');
  assert.equal(line2.priceCentavos, 1700);

  const line3 = parseNotebookLine('Bear Brand 33g sachet 12');
  assert.equal(line3.name, 'Bear Brand');
  assert.equal(line3.variant, '33g');
  assert.equal(line3.unit, 'sachet');
  assert.equal(line3.priceCentavos, 1200);

  // Missing price
  const missingPrice = parseNotebookLine('Safeguard White');
  assert.equal(missingPrice.priceCentavos, null);
  assert.ok(missingPrice.warnings.some((w) => w.includes('presyo')));

  // Empty line
  const empty = parseNotebookLine('   ');
  assert.ok(empty.warnings.length > 0);
});

test('proposeNotebookCatalogUpdates identifies price updates on existing products and preserves stock', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // 1. Existing product with stock: Coke 250ml @ ₱15.00 with 40 units in stock
  const existingProduct = await saveProduct(db, {
    name: 'Coke',
    variant: '250ml',
    unit: 'bote',
    priceCentavos: 1500,
  });
  await setStockCount(db, { productId: existingProduct.id, newQuantity: 40 });

  // 2. Notebook OCR text proposing price increase for Coke to ₱17.00, and a new product
  const rawOcr = `Coke 250ml bote 17.00
Skyflakes 10s pack 45.00`;

  const proposals = await proposeNotebookCatalogUpdates(db, rawOcr);
  assert.equal(proposals.length, 2);

  // Row 1: Existing Coke
  const cokeProp = proposals[0]!;
  assert.equal(cokeProp.action, 'update_price');
  assert.equal(cokeProp.matchedProductId, existingProduct.id);
  assert.equal(cokeProp.existingPriceCentavos, 1500);
  assert.equal(cokeProp.priceCentavos, 1700);
  assert.equal(cokeProp.existingStock, 40);
  assert.equal(cokeProp.status, 'ready');

  // Row 2: New Skyflakes
  const skyProp = proposals[1]!;
  assert.equal(skyProp.action, 'create_product');
  assert.equal(skyProp.matchedProductId, undefined);
  assert.equal(skyProp.existingPriceCentavos, undefined);
  assert.equal(skyProp.priceCentavos, 4500);
  assert.equal(skyProp.status, 'ready');

  // 3. Apply reviewed updates
  const result = await applyNotebookCatalogUpdates(db, proposals);
  assert.equal(result.updatedCount, 1);
  assert.equal(result.createdCount, 1);

  // 4. Verify Coke price is updated to ₱17.00, but stock remains exactly 40 units!
  const updatedCoke = await db.getFirst<{ price_centavos: number }>(
    'SELECT price_centavos FROM products WHERE id = ?;',
    [existingProduct.id]
  );
  assert.equal(updatedCoke?.price_centavos, 1700);

  const stockCheck = await getStockLevel(db, existingProduct.id);
  assert.equal(stockCheck?.quantity, 40);

  // 5. Verify Skyflakes was created
  const skyCheck = await db.getFirst<{ name: string; price_centavos: number }>(
    "SELECT name, price_centavos FROM products WHERE name = 'Skyflakes';"
  );
  assert.equal(skyCheck?.name, 'Skyflakes');
  assert.equal(skyCheck?.price_centavos, 4500);
});

test('rescanning the same notebook does not duplicate products or alter stock', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const rawOcr = 'Milo 24g sachet 14.00';

  // First scan
  const prop1 = await proposeNotebookCatalogUpdates(db, rawOcr);
  assert.equal(prop1[0]!.action, 'create_product');
  await applyNotebookCatalogUpdates(db, prop1);

  const allProducts1 = await db.getAll('SELECT * FROM products;');
  assert.equal(allProducts1.length, 1);

  // Set stock count
  const miloId = (allProducts1[0] as { id: string }).id;
  await setStockCount(db, { productId: miloId, newQuantity: 25 });

  // Rescan with same text
  const prop2 = await proposeNotebookCatalogUpdates(db, rawOcr);
  assert.equal(prop2[0]!.action, 'update_price');
  assert.equal(prop2[0]!.existingStock, 25);

  await applyNotebookCatalogUpdates(db, prop2);

  // Count remains exactly 1 product, stock remains exactly 25
  const allProducts2 = await db.getAll('SELECT * FROM products;');
  assert.equal(allProducts2.length, 1);

  const stockCheck = await getStockLevel(db, miloId);
  assert.equal(stockCheck?.quantity, 25);
});

test('rejects applying rows that need clarification or have invalid price', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const rawOcr = 'Noodles Walang Presyo';
  const proposals = await proposeNotebookCatalogUpdates(db, rawOcr);
  assert.equal(proposals[0]!.status, 'needs_clarification');

  await assert.rejects(
    applyNotebookCatalogUpdates(db, proposals),
    NotebookValidationError
  );
});

test('persists notebook updates across database restart on real file', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aira-notebook-test-'));
  const dbPath = join(tempDir, 'notebook-test.sqlite');
  t.after(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // Session 1: Apply notebook proposals to file
  {
    const fileDb = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(fileDb);
    await runMigrations(db);

    const proposals = await proposeNotebookCatalogUpdates(
      db,
      'Tang Orange 25g sachet 22.00\nSprite 250ml bote 16.00'
    );
    await applyNotebookCatalogUpdates(db, proposals);
    fileDb.close();
  }

  // Session 2: Reopen file and verify catalog items survive
  {
    const fileDb = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(fileDb);
    await runMigrations(db);

    const products = await db.getAll<{ name: string; price_centavos: number }>(
      'SELECT name, price_centavos FROM products ORDER BY name ASC;'
    );
    assert.equal(products.length, 2);
    assert.equal(products[0]?.name, 'Sprite');
    assert.equal(products[0]?.price_centavos, 1600);
    assert.equal(products[1]?.name, 'Tang Orange');
    assert.equal(products[1]?.price_centavos, 2200);
    fileDb.close();
  }
});
