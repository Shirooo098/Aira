import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';

test('runMigrations creates schema_migrations, products, stock_levels, inventory_movements, customers, and credit_entries tables', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);

  await runMigrations(db);

  // Table schema_migrations exists and has versions 1, 2, 3, 4, and 5
  const migrationRows = await db.getAll<{ version: number; applied_at: string }>(
    'SELECT version, applied_at FROM schema_migrations ORDER BY version ASC;'
  );
  assert.equal(migrationRows.length, 5);
  assert.equal(migrationRows[0]?.version, 1);
  assert.equal(migrationRows[1]?.version, 2);
  assert.equal(migrationRows[2]?.version, 3);
  assert.equal(migrationRows[3]?.version, 4);
  assert.equal(migrationRows[4]?.version, 5);

  // Tables exist and can be queried
  const productRows = await db.getAll('SELECT * FROM products;');
  assert.equal(productRows.length, 0);

  const stockRows = await db.getAll('SELECT * FROM stock_levels;');
  assert.equal(stockRows.length, 0);

  const movementRows = await db.getAll('SELECT * FROM inventory_movements;');
  assert.equal(movementRows.length, 0);

  const salesRows = await db.getAll('SELECT * FROM sales;');
  assert.equal(salesRows.length, 0);

  const saleItemRows = await db.getAll('SELECT * FROM sale_items;');
  assert.equal(saleItemRows.length, 0);

  const pendingGcashRows = await db.getAll('SELECT * FROM pending_gcash_drafts;');
  assert.equal(pendingGcashRows.length, 0);

  const customerRows = await db.getAll('SELECT * FROM customers;');
  assert.equal(customerRows.length, 0);

  const creditRows = await db.getAll('SELECT * FROM credit_entries;');
  assert.equal(creditRows.length, 0);

  // Re-running migrations is idempotent
  await runMigrations(db);
  const secondRunRows = await db.getAll<{ version: number }>(
    'SELECT version FROM schema_migrations;'
  );
  assert.equal(secondRunRows.length, 5);
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

test('the schema rejects invalid sales and sale_items values', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);

  sqlite.exec(`INSERT INTO products VALUES
    ('p1', 'Coke', '250 ml', 'bote', 1500, 'coke', '250 ml', 'bote', 'now', 'now')`);

  const insertSale = sqlite.prepare(`INSERT INTO sales (
    id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'now')`);

  // Invalid payment_method
  assert.throws(
    () => insertSale.run('s1', 'card', 1500, 2000, 500, null, null),
    /CHECK constraint/
  );

  // Negative or non-integer total_centavos
  for (const invalid of [-1, 15.5, 'abc']) {
    assert.throws(
      () => insertSale.run('s2', 'cash', invalid, 2000, 500, null, null),
      /CHECK constraint/
    );
  }

  // Insert valid sale for sale_items test
  insertSale.run('s1', 'cash', 1500, 2000, 500, 'REF-123', 'key-1');

  // Idempotency key duplicate
  assert.throws(
    () => insertSale.run('s2', 'cash', 1500, 2000, 500, 'REF-456', 'key-1'),
    /UNIQUE constraint/
  );

  const insertItem = sqlite.prepare(`INSERT INTO sale_items VALUES
    (?, 's1', 'p1', 'Coke', '250 ml', 'bote', ?, ?, ?)`);

  // Quantity must be > 0 and integer
  for (const invalid of [0, -1, 1.5, 'abc']) {
    assert.throws(
      () => insertItem.run('item-1', 1500, invalid, 1500),
      /CHECK constraint/
    );
  }

  // Unit price must be >= 0 and integer
  for (const invalid of [-1, 1.5, 'abc']) {
    assert.throws(
      () => insertItem.run('item-2', invalid, 1, 1500),
      /CHECK constraint/
    );
  }

  // Subtotal must be >= 0 and integer
  for (const invalid of [-1, 1.5, 'abc']) {
    assert.throws(
      () => insertItem.run('item-3', 1500, 1, invalid),
      /CHECK constraint/
    );
  }

  // Test pending_gcash_drafts constraints
  const insertDraft = sqlite.prepare(`INSERT INTO pending_gcash_drafts VALUES
    (?, ?, ?, ?, ?, ?, 'now', 'now')`);

  // Invalid status
  assert.throws(
    () => insertDraft.run('d1', 1500, 'REF1', 'note', '[]', 'invalid_status'),
    /CHECK constraint/
  );

  // Invalid total_centavos (negative or non-integer)
  for (const invalid of [-1, 15.5, 'abc']) {
    assert.throws(
      () => insertDraft.run('d2', invalid, 'REF1', 'note', '[]', 'pending'),
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
  assert.equal((await db.getAll('SELECT * FROM schema_migrations')).length, 6);
});

test('Migration 5 constraints validate customers, credit_entries, and sales columns', async (t) => {
  const sqlite = new DatabaseSync(':memory:');
  t.after(() => sqlite.close());
  const db = new NodeSqliteAdapter(sqlite);
  await runMigrations(db);

  // Customers table constraints
  const insertCustomer = sqlite.prepare(`
    INSERT INTO customers (id, name, nickname, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'now', 'now');
  `);
  insertCustomer.run('c1', 'Mang Jose', 'Jose', 'tapat ng tindahan');

  // Sales columns: paid_centavos and credit_centavos CHECK constraints
  const insertSale = sqlite.prepare(`
    INSERT INTO sales (
      id, customer_id, payment_method, total_centavos, tender_centavos,
      change_centavos, paid_centavos, credit_centavos, reference_number, idempotency_key, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'now');
  `);

  // Valid sale linked to customer
  insertSale.run('s1', 'c1', 'cash', 1000, 500, 0, 500, 500);

  // Invalid paid_centavos (negative or non-integer)
  for (const invalid of [-1, 10.5, 'abc']) {
    assert.throws(
      () => insertSale.run('s2', 'c1', 'cash', 1000, 0, 0, invalid, 1000),
      /CHECK constraint/
    );
  }

  // Invalid credit_centavos (negative or non-integer)
  for (const invalid of [-1, 10.5, 'abc']) {
    assert.throws(
      () => insertSale.run('s3', 'c1', 'cash', 1000, 1000, 0, 1000, invalid),
      /CHECK constraint/
    );
  }

  // Credit entries table constraints
  const insertCredit = sqlite.prepare(`
    INSERT INTO credit_entries (
      id, customer_id, entry_type, sale_id, original_amount_centavos,
      remaining_amount_centavos, description, original_date, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'now', 'now');
  `);

  // Valid credit entries
  insertCredit.run('ce1', 'c1', 'sale_credit', 's1', 500, 500, 'Kulang na bayad', null);
  insertCredit.run('ce2', 'c1', 'opening_balance', null, 2500, 2500, 'Utang bago mag-Aira', null);

  // Invalid entry_type
  assert.throws(
    () => insertCredit.run('ce3', 'c1', 'invalid_type', null, 500, 500, null, null),
    /CHECK constraint/
  );

  // Invalid original_amount_centavos (<= 0 or non-integer)
  for (const invalid of [0, -100, 15.5, 'abc']) {
    assert.throws(
      () => insertCredit.run('ce4', 'c1', 'opening_balance', null, invalid, invalid, null, null),
      /CHECK constraint/
    );
  }

  // Invalid remaining_amount_centavos (negative, float, or > original_amount_centavos)
  for (const invalid of [-1, 10.5, 600]) {
    assert.throws(
      () => insertCredit.run('ce5', 'c1', 'opening_balance', null, 500, invalid, null, null),
      /CHECK constraint/
    );
  }
});
