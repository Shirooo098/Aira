import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { confirmAlias, prepareAlias } from '../src/actions/alias-actions.ts';
import { lookupProduct, saveProduct, updateProductPrice } from '../src/actions/catalog-actions.ts';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { parsePriceCommand } from '../src/domain/price-command.ts';
import type { LookupResult } from '../src/types.ts';

async function openMemoryDatabase(t: TestContext) {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  return db;
}

async function lookupQuestion(db: NodeSqliteAdapter, question: string): Promise<LookupResult> {
  const phrase = parsePriceCommand(question);
  if (phrase === null) throw new Error(`Expected a supported price question: ${question}`);
  return lookupProduct(db, phrase);
}

function assertExact(result: LookupResult, productId: string, priceCentavos: number) {
  assert.equal(result.kind, 'exact');
  if (result.kind === 'exact') {
    assert.equal(result.product.id, productId);
    assert.equal(result.product.priceCentavos, priceCentavos);
  }
}

function assertAmbiguousIds(result: LookupResult, productIds: string[]) {
  assert.equal(result.kind, 'ambiguous');
  if (result.kind === 'ambiguous') {
    assert.deepEqual(new Set(result.products.map((product) => product.id)), new Set(productIds));
    assert.equal('product' in result, false);
  }
}

function createTempDirectory() {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const tempDirectory = fs.mkdtempSync(path.join(tempRoot, 'aira-voice-price-'));
  return { tempRoot, tempDirectory };
}

function removeTempDirectory(tempRoot: string, tempDirectory: string) {
  const resolvedRoot = fs.realpathSync(tempRoot);
  const resolvedTarget = fs.realpathSync(tempDirectory);
  const relativeTarget = path.relative(resolvedRoot, resolvedTarget);
  assert.ok(
    relativeTarget !== '' &&
      relativeTarget !== '.' &&
      relativeTarget !== '..' &&
      !relativeTarget.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeTarget),
    `Refusing to recursively remove a temp directory outside ${resolvedRoot}`,
  );
  assert.ok(
    path.basename(resolvedTarget).startsWith('aira-voice-price-'),
    `Refusing to recursively remove an unexpected temp directory: ${resolvedTarget}`,
  );
  fs.rmSync(resolvedTarget, { recursive: true, force: true });
}

test('reviewed price questions resolve canonical names and exact name-plus-variant phrases', async (t) => {
  const db = await openMemoryDatabase(t);
  const ketchup = await saveProduct(db, {
    name: 'Ang Ketchup', variant: 'Original 320g', unit: 'pouch', priceCentavos: 3200,
  });
  const gata = await saveProduct(db, {
    name: 'Gata ng Niyog', variant: '250 ml', unit: 'pack', priceCentavos: 2700,
  });

  const ketchupQuestion = 'Magkano po ba ang Ang Ketchup?';
  assert.equal(parsePriceCommand(ketchupQuestion), 'ang ketchup');
  assertExact(await lookupQuestion(db, ketchupQuestion), ketchup.id, 3200);

  const variantQuestion = 'Ano ang presyo ng Gata ng Niyog 250 ml?';
  assert.equal(parsePriceCommand(variantQuestion), 'gata ng niyog 250 ml');
  assertExact(await lookupQuestion(db, variantQuestion), gata.id, 2700);
});

test('a confirmed voice alias survives a file restart and returns the current catalog price', async () => {
  const { tempRoot, tempDirectory } = createTempDirectory();
  const databasePath = path.join(tempDirectory, 'aira.db');
  let sqlite: DatabaseSync | undefined;

  try {
    sqlite = new DatabaseSync(databasePath);
    const firstDb = new NodeSqliteAdapter(sqlite);
    await runMigrations(firstDb);
    const vinegar = await saveProduct(firstDb, {
      name: 'Datu Puti Vinegar', variant: '350 ml', unit: 'bote', priceCentavos: 1750,
    });
    await confirmAlias(firstDb, await prepareAlias(firstDb, vinegar.id, 'Suka Datu'));
    await updateProductPrice(firstDb, vinegar.id, 1900);

    sqlite.close();
    sqlite = undefined;

    sqlite = new DatabaseSync(databasePath);
    const reopenedDb = new NodeSqliteAdapter(sqlite);
    await runMigrations(reopenedDb);
    const question = 'Magkano ba ang Suka Datu?';
    assert.equal(parsePriceCommand(question), 'suka datu');
    assertExact(await lookupQuestion(reopenedDb, question), vinegar.id, 1900);
  } finally {
    try {
      sqlite?.close();
    } finally {
      removeTempDirectory(tempRoot, tempDirectory);
    }
  }
});

test('unknown products and variants stay price-free after command parsing', async (t) => {
  const db = await openMemoryDatabase(t);
  await saveProduct(db, {
    name: 'Coke', variant: '250 ml', unit: 'bote', priceCentavos: 1550,
  });

  const unknownProduct = await lookupQuestion(db, 'Magkano ang Hindi Naitala?');
  assert.deepEqual(unknownProduct, { kind: 'unknown', query: 'hindi naitala' });
  assert.equal('priceCentavos' in unknownProduct, false);

  const unknownVariant = await lookupQuestion(db, 'Magkano ang Coke 999 ml?');
  assert.deepEqual(unknownVariant, { kind: 'unknown', query: 'coke 999 ml' });
  assert.equal('priceCentavos' in unknownVariant, false);

  assert.equal(parsePriceCommand('Presyo nito magkano?'), null);
});

test('voice lookup keeps variant, alias, and canonical-alias collisions ambiguous', async (t) => {
  const db = await openMemoryDatabase(t);
  const sunlight = await saveProduct(db, {
    name: 'Sunlight Soap', variant: 'Bar', unit: 'piraso', priceCentavos: 2500,
  });
  const safeguard = await saveProduct(db, {
    name: 'Safeguard', variant: 'White 60g', unit: 'bar', priceCentavos: 2800,
  });
  const dove = await saveProduct(db, {
    name: 'Dove', variant: 'Beauty Bar', unit: 'bar', priceCentavos: 3500,
  });
  const cokeSmall = await saveProduct(db, {
    name: 'Coca-Cola', variant: '250 ml', unit: 'bote', priceCentavos: 1800,
  });
  const cokeLarge = await saveProduct(db, {
    name: 'Coca-Cola', variant: '1.5 L', unit: 'bote', priceCentavos: 7500,
  });

  // An alias equal to its own canonical name must collapse to one product.
  await confirmAlias(db, await prepareAlias(db, sunlight.id, 'Sunlight Soap'));
  assertExact(await lookupQuestion(db, 'Magkano ang Sunlight Soap?'), sunlight.id, 2500);

  // A confirmed alias that collides with another product's canonical name keeps both identities.
  await confirmAlias(db, await prepareAlias(db, safeguard.id, 'Sunlight Soap'));
  assertAmbiguousIds(
    await lookupQuestion(db, 'Magkano ang Sunlight Soap?'),
    [sunlight.id, safeguard.id],
  );

  // The same approved alias on two distinct products also remains ambiguous.
  await confirmAlias(db, await prepareAlias(db, safeguard.id, 'Safi'));
  await confirmAlias(db, await prepareAlias(db, dove.id, 'Safi'));
  assertAmbiguousIds(await lookupQuestion(db, 'Magkano ang Safi?'), [safeguard.id, dove.id]);

  // A shared canonical name with different variants requires the owner to choose.
  assertAmbiguousIds(
    await lookupQuestion(db, 'Magkano ang Coca-Cola?'),
    [cokeSmall.id, cokeLarge.id],
  );
});

test('a single partial voice match never becomes a selected-price result', async (t) => {
  const db = await openMemoryDatabase(t);
  const product = await saveProduct(db, {
    name: 'Safeguard White', variant: '60g', unit: 'bar', priceCentavos: 2800,
  });

  const result = await lookupQuestion(db, 'Magkano ang Safegu?');
  assertAmbiguousIds(result, [product.id]);
  assert.equal('priceCentavos' in result, false);
});
