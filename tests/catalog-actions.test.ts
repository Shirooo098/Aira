import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct, getProductById, getAllProducts } from '../src/actions/catalog-actions.ts';

test('saves a reviewed product draft and retrieves it by ID', async () => {
  const syncDb = new DatabaseSync(':memory:');
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const draft = {
    name: 'Coca-Cola',
    variant: '1.5L',
    unit: 'bottle',
    priceCentavos: 7500,
  };

  const saved = await saveProduct(db, draft);
  assert.ok(saved.id, 'Product should have a stable ID');
  assert.equal(saved.name, 'Coca-Cola');
  assert.equal(saved.variant, '1.5L');
  assert.equal(saved.unit, 'bottle');
  assert.equal(saved.priceCentavos, 7500);

  const fetched = await getProductById(db, saved.id);
  assert.notEqual(fetched, null);
  assert.equal(fetched?.id, saved.id);
  assert.equal(fetched?.name, 'Coca-Cola');
  assert.equal(fetched?.variant, '1.5L');
  assert.equal(fetched?.unit, 'bottle');
  assert.equal(fetched?.priceCentavos, 7500);
});

test('missing variant is left for owner clarification and never saved as Regular', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  await assert.rejects(saveProduct(db, {
    name: 'Coke', variant: ' ', unit: 'bottle', priceCentavos: 1550,
  }), /variant|sukat/i);
  assert.deepEqual(await getAllProducts(db), []);
});

test('rejects invalid product draft input and duplicate identity', async () => {
  const syncDb = new DatabaseSync(':memory:');
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // Rejects empty name
  await assert.rejects(
    async () => {
      await saveProduct(db, {
        name: '   ',
        variant: '1.5L',
        unit: 'bottle',
        priceCentavos: 1000,
      });
    },
    /Kailangan ang pangalan ng produkto/
  );

  // Rejects empty unit
  await assert.rejects(
    async () => {
      await saveProduct(db, {
        name: 'Sprite',
        variant: '1.5L',
        unit: '   ',
        priceCentavos: 1000,
      });
    },
    /Kailangan ang unit ng produkto/
  );

  // Rejects negative price
  await assert.rejects(
    async () => {
      await saveProduct(db, {
        name: 'Sprite',
        variant: '1.5L',
        unit: 'bottle',
        priceCentavos: -50,
      });
    },
    /Maling halaga ng presyo sa centavos/
  );

  // Saves product first time
  await saveProduct(db, {
    name: 'Sprite',
    variant: '1.5L',
    unit: 'bottle',
    priceCentavos: 7000,
  });

  // Rejects duplicate identity (case-insensitive)
  await assert.rejects(
    async () => {
      await saveProduct(db, {
        name: '  sprite  ',
        variant: '1.5L',
        unit: 'bottle',
        priceCentavos: 7200,
      });
    },
    /Mayroon nang nakatalang produkto/
  );
});

