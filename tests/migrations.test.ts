import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';

test('runMigrations creates schema_migrations and products table', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);

  await runMigrations(db);

  // Table schema_migrations exists and has version 1
  const migrationRows = await db.getAll<{ version: number; applied_at: string }>(
    'SELECT version, applied_at FROM schema_migrations ORDER BY version ASC;'
  );
  assert.equal(migrationRows.length, 1);
  assert.equal(migrationRows[0]?.version, 1);

  // Products table exists and can be queried
  const productRows = await db.getAll('SELECT * FROM products;');
  assert.equal(productRows.length, 0);

  // Re-running migrations is idempotent
  await runMigrations(db);
  const secondRunRows = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations;'
  );
  assert.equal(secondRunRows.length, 1);
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
  assert.equal((await db.getAll('SELECT * FROM schema_migrations')).length, 2);
});
