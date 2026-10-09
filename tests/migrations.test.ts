import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';

test('runMigrations creates schema_migrations, products, stock_levels, and inventory_movements tables', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);

  await runMigrations(db);

  // Table schema_migrations exists and has versions 1 and 2
  const migrationRows = await db.getAll<{ version: number; applied_at: string }>(
    'SELECT version, applied_at FROM schema_migrations ORDER BY version ASC;'
  );
  assert.equal(migrationRows.length, 2);
  assert.equal(migrationRows[0]?.version, 1);
  assert.equal(migrationRows[1]?.version, 2);

  // Tables exist and can be queried
  const productRows = await db.getAll('SELECT * FROM products;');
  assert.equal(productRows.length, 0);

  const stockRows = await db.getAll('SELECT * FROM stock_levels;');
  assert.equal(stockRows.length, 0);

  const movementRows = await db.getAll('SELECT * FROM inventory_movements;');
  assert.equal(movementRows.length, 0);

  // Re-running migrations is idempotent
  await runMigrations(db);
  const secondRunRows = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations;'
  );
  assert.equal(secondRunRows.length, 2);
});

test('the schema rejects fractional and unsafe monetary values', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  const insert = sqlite.prepare(`INSERT INTO products VALUES
    ('p1', 'Coke', '250 ml', 'bottle', ?, 'coke', '250 ml', 'bottle', 'now', 'now')`);
  for (const invalid of [-1, 15.5, Number.MAX_SAFE_INTEGER + 1, 'oops']) {
    assert.throws(() => insert.run(invalid), /CHECK constraint/);
  }
});

test('the schema rejects negative or non-integer stock levels and invalid inventory movements', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);

  sqlite.exec(`INSERT INTO products VALUES
    ('p1', 'Coke', '250 ml', 'bote', 1500, 'coke', '250 ml', 'bote', 'now', 'now')`);

  // Test stock_levels constraints
  const insertStock = sqlite.prepare('INSERT INTO stock_levels VALUES (?, ?, ?)');
  for (const invalid of [-1, 10.5, 'not_integer']) {
    assert.throws(() => insertStock.run('p1', invalid, 'now'), /CHECK constraint/);
  }

  // Test inventory_movements constraints
  const insertMovement = sqlite.prepare(`INSERT INTO inventory_movements VALUES
    (?, 'p1', ?, ?, ?, ?, NULL, 'now')`);

  // Invalid movement type
  assert.throws(
    () => insertMovement.run('m1', 'invalid_movement', 10, null, 10),
    /CHECK constraint/
  );

  // Non-integer delta
  assert.throws(
    () => insertMovement.run('m2', 'set_count', 10.5, null, 10),
    /CHECK constraint/
  );

  // Negative or non-integer previous_quantity
  for (const invalid of [-1, 5.5, 'abc']) {
    assert.throws(
      () => insertMovement.run('m3', 'set_count', 5, invalid, 10),
      /CHECK constraint/
    );
  }

  // Negative or non-integer new_quantity
  for (const invalid of [-1, 5.5, 'abc']) {
    assert.throws(
      () => insertMovement.run('m4', 'set_count', 5, null, invalid),
      /CHECK constraint/
    );
  }
});

test('failed migration rolls back schema changes and remains retryable', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  sqlite.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    CREATE TRIGGER block_version BEFORE INSERT ON schema_migrations
    BEGIN SELECT RAISE(ABORT, 'simulated version write failure'); END;
  `);
  await assert.rejects(runMigrations(db), /simulated version write failure/);
  assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'products'").get(), undefined);
  sqlite.exec('DROP TRIGGER block_version');
  await runMigrations(db);
  assert.equal((await db.getAll('SELECT * FROM products')).length, 0);
});

test('a newer database is refused without changing its migration history', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);
  sqlite.exec("INSERT INTO schema_migrations VALUES (99, 'future')");
  await assert.rejects(runMigrations(db), /newer|unsupported/i);
  assert.equal((await db.getAll('SELECT * FROM schema_migrations')).length, 3);
});
