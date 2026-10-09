import type { DatabaseSession } from './database.ts';

interface Migration {
  version: number;
  up(db: DatabaseSession): Promise<void>;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE products (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          variant TEXT NOT NULL,
          unit TEXT NOT NULL,
          price_centavos INTEGER NOT NULL CHECK (
            typeof(price_centavos) = 'integer' AND price_centavos BETWEEN 0 AND 9007199254740991
          ),
          name_normalized TEXT NOT NULL,
          variant_normalized TEXT NOT NULL,
          unit_normalized TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          CONSTRAINT uq_product_identity UNIQUE (name_normalized, variant_normalized, unit_normalized)
        );

        CREATE INDEX idx_products_name_norm ON products (name_normalized);
      `);
    },
  },
  {
    version: 2,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE stock_levels (
          product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity >= 0),
          updated_at TEXT NOT NULL
        );

        CREATE TABLE inventory_movements (
          id TEXT PRIMARY KEY NOT NULL,
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          movement_type TEXT NOT NULL CHECK (movement_type IN ('set_count', 'add_delivery', 'sale_deduction', 'sale_cancellation')),
          quantity_delta INTEGER NOT NULL CHECK (typeof(quantity_delta) = 'integer'),
          previous_quantity INTEGER CHECK (previous_quantity IS NULL OR (typeof(previous_quantity) = 'integer' AND previous_quantity >= 0)),
          new_quantity INTEGER NOT NULL CHECK (typeof(new_quantity) = 'integer' AND new_quantity >= 0),
          note TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_inventory_movements_product_id ON inventory_movements (product_id, created_at DESC);
      `);
    },
  },
  {
    version: 3,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE sales (
          id TEXT PRIMARY KEY NOT NULL,
          payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash')),
          total_centavos INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer' AND total_centavos >= 0),
          tender_centavos INTEGER NOT NULL CHECK (typeof(tender_centavos) = 'integer' AND tender_centavos >= 0),
          change_centavos INTEGER NOT NULL CHECK (typeof(change_centavos) = 'integer' AND change_centavos >= 0),
          idempotency_key TEXT UNIQUE,
          created_at TEXT NOT NULL
        );

        CREATE TABLE sale_items (
          id TEXT PRIMARY KEY NOT NULL,
          sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL REFERENCES products(id),
          product_name TEXT NOT NULL,
          product_variant TEXT NOT NULL,
          product_unit TEXT NOT NULL,
          unit_price_centavos INTEGER NOT NULL CHECK (typeof(unit_price_centavos) = 'integer' AND unit_price_centavos >= 0),
          quantity INTEGER NOT NULL CHECK (typeof(quantity) = 'integer' AND quantity > 0),
          subtotal_centavos INTEGER NOT NULL CHECK (typeof(subtotal_centavos) = 'integer' AND subtotal_centavos >= 0)
        );

        CREATE INDEX idx_sale_items_sale_id ON sale_items (sale_id);
        CREATE INDEX idx_sales_created_at ON sales (created_at DESC);
      `);
    },
  },
];

export async function runMigrations(db: DatabaseSession): Promise<void> {
  // Startup gates all consumers, so no application writes can join this transaction.
  await db.exec('BEGIN IMMEDIATE');
  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const appliedRows = await db.getAll<{ version: number }>(
      'SELECT version FROM schema_migrations;'
    );
    if (appliedRows.some((row) => !MIGRATIONS.some((migration) => migration.version === row.version))) {
      throw new Error('Database has a newer or unsupported schema version');
    }
    const appliedSet = new Set(appliedRows.map((r) => r.version));
    for (const migration of MIGRATIONS) {
      if (!appliedSet.has(migration.version)) {
        await migration.up(db);
        await db.run(
          'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?);',
          [migration.version, new Date().toISOString()]
        );
      }
    }
    await db.exec('COMMIT');
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'Migration and rollback failed');
    }
    throw error;
  }
}
