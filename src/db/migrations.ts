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
  {
    version: 4,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        ALTER TABLE sales ADD COLUMN reference_number TEXT;

        CREATE TABLE pending_gcash_drafts (
          id TEXT PRIMARY KEY NOT NULL,
          total_centavos INTEGER NOT NULL CHECK (typeof(total_centavos) = 'integer' AND total_centavos >= 0),
          reference_number TEXT,
          customer_note TEXT,
          items_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'cancelled')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_pending_gcash_status ON pending_gcash_drafts (status, created_at DESC);
      `);
    },
  },
  {
    version: 5,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE customers (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          nickname TEXT,
          note TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_customers_name ON customers (name);

        ALTER TABLE sales ADD COLUMN customer_id TEXT REFERENCES customers(id);
        ALTER TABLE sales ADD COLUMN paid_centavos INTEGER NOT NULL DEFAULT 0 CHECK (typeof(paid_centavos) = 'integer' AND paid_centavos >= 0);
        ALTER TABLE sales ADD COLUMN credit_centavos INTEGER NOT NULL DEFAULT 0 CHECK (typeof(credit_centavos) = 'integer' AND credit_centavos >= 0);

        CREATE TABLE credit_entries (
          id TEXT PRIMARY KEY NOT NULL,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          entry_type TEXT NOT NULL CHECK (entry_type IN ('sale_credit', 'opening_balance')),
          sale_id TEXT REFERENCES sales(id),
          original_amount_centavos INTEGER NOT NULL CHECK (typeof(original_amount_centavos) = 'integer' AND original_amount_centavos > 0),
          remaining_amount_centavos INTEGER NOT NULL CHECK (typeof(remaining_amount_centavos) = 'integer' AND remaining_amount_centavos >= 0 AND remaining_amount_centavos <= original_amount_centavos),
          description TEXT,
          original_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX idx_credit_entries_customer ON credit_entries (customer_id, created_at ASC);
      `);
    },
  },
  {
    version: 6,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE credit_repayments (
          id TEXT PRIMARY KEY NOT NULL,
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
          amount_centavos INTEGER NOT NULL CHECK (typeof(amount_centavos) = 'integer' AND amount_centavos > 0),
          payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'gcash')),
          reference_number TEXT,
          note TEXT,
          idempotency_key TEXT UNIQUE,
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_credit_repayments_customer ON credit_repayments (customer_id, created_at DESC);

        CREATE TABLE repayment_allocations (
          id TEXT PRIMARY KEY NOT NULL,
          repayment_id TEXT NOT NULL REFERENCES credit_repayments(id) ON DELETE CASCADE,
          credit_entry_id TEXT NOT NULL REFERENCES credit_entries(id) ON DELETE RESTRICT,
          allocated_centavos INTEGER NOT NULL CHECK (typeof(allocated_centavos) = 'integer' AND allocated_centavos > 0),
          created_at TEXT NOT NULL
        );

        CREATE INDEX idx_repayment_allocations_repayment ON repayment_allocations (repayment_id);
        CREATE INDEX idx_repayment_allocations_entry ON repayment_allocations (credit_entry_id);
      `);
    },
  },
  {
    version: 7,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS product_aliases (
          alias_normalized TEXT NOT NULL CHECK (length(alias_normalized) BETWEEN 1 AND 120),
          product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
          alias_text TEXT NOT NULL CHECK (length(trim(alias_text)) BETWEEN 1 AND 120),
          created_at TEXT NOT NULL CHECK (length(trim(created_at)) > 0),
          PRIMARY KEY (alias_normalized, product_id)
        );

        CREATE INDEX IF NOT EXISTS idx_product_aliases_product_id ON product_aliases (product_id);
      `);
    },
  },
  {
    version: 8,
    async up(db: DatabaseSession): Promise<void> {
      const salesColumns = await db.getAll<{ name: string }>('PRAGMA table_info(sales);');
      const salesColNames = new Set(salesColumns.map((c) => c.name));

      if (!salesColNames.has('status')) {
        await db.exec("ALTER TABLE sales ADD COLUMN status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('completed', 'cancelled'));");
      }
      if (!salesColNames.has('cancelled_at')) {
        await db.exec("ALTER TABLE sales ADD COLUMN cancelled_at TEXT;");
      }
      if (!salesColNames.has('cancellation_reason')) {
        await db.exec("ALTER TABLE sales ADD COLUMN cancellation_reason TEXT;");
      }

      const creditColumns = await db.getAll<{ name: string }>('PRAGMA table_info(credit_entries);');
      const creditColNames = new Set(creditColumns.map((c) => c.name));
      if (!creditColNames.has('status')) {
        await db.exec("ALTER TABLE credit_entries ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'cancelled'));");
      }

      const repayColumns = await db.getAll<{ name: string }>('PRAGMA table_info(credit_repayments);');
      const repayColNames = new Set(repayColumns.map((c) => c.name));
      if (!repayColNames.has('status')) {
        await db.exec("ALTER TABLE credit_repayments ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed'));");
      }
      if (!repayColNames.has('reversed_at')) {
        await db.exec("ALTER TABLE credit_repayments ADD COLUMN reversed_at TEXT;");
      }
      if (!repayColNames.has('reversal_reason')) {
        await db.exec("ALTER TABLE credit_repayments ADD COLUMN reversal_reason TEXT;");
      }

      const allocColumns = await db.getAll<{ name: string }>('PRAGMA table_info(repayment_allocations);');
      const allocColNames = new Set(allocColumns.map((c) => c.name));
      if (!allocColNames.has('status')) {
        await db.exec("ALTER TABLE repayment_allocations ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'reversed'));");
      }
    },
  },
  {
    version: 9,
    async up(db: DatabaseSession): Promise<void> {
      await db.exec(`
        CREATE TABLE IF NOT EXISTS receipt_attachments (
          id TEXT PRIMARY KEY NOT NULL,
          target_kind TEXT NOT NULL CHECK (target_kind IN ('sale', 'pending_draft')),
          target_id TEXT NOT NULL,
          image_path TEXT NOT NULL,
          amount_centavos INTEGER CHECK (amount_centavos IS NULL OR (typeof(amount_centavos) = 'integer' AND amount_centavos >= 0)),
          reference_number TEXT,
          sender_name TEXT,
          sender_mobile TEXT,
          raw_text TEXT,
          created_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_receipt_attachments_target ON receipt_attachments (target_kind, target_id);
        CREATE INDEX IF NOT EXISTS idx_receipt_attachments_reference ON receipt_attachments (reference_number);
        CREATE INDEX IF NOT EXISTS idx_receipt_attachments_created ON receipt_attachments (created_at DESC);
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
    // The pre-merge alias build used version 4 before main assigned it to GCash.
    // Preserve those aliases/history and install the missing GCash schema in
    // the same transaction before continuing with main's versions 5 and 6.
    if (appliedSet.has(4)) {
      const aliasTable = await db.getFirst<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'product_aliases';"
      );
      const salesColumns = await db.getAll<{ name: string }>('PRAGMA table_info(sales);');
      if (aliasTable && !salesColumns.some((column) => column.name === 'reference_number')) {
        const gcashMigration = MIGRATIONS.find((migration) => migration.version === 4);
        if (!gcashMigration) throw new Error('Missing GCash migration');
        await gcashMigration.up(db);
      }
    }
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
