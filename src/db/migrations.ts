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
