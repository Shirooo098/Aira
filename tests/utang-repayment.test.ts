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
  createCustomer,
  recordOpeningBalance,
  completeCreditSale,
  previewRepaymentAllocation,
  recordRepayment,
  getCustomerById,
  getCustomerLedger,
  getCustomerRepayments,
  getRepaymentById,
} from '../src/actions/utang-actions.ts';
import {
  CreditValidationError,
  OverpaymentError,
} from '../src/domain/utang.ts';

test('previewRepaymentAllocation calculates oldest-first allocation and rejects overpayment', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Aling Maria' });
  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 10000, // ₱100.00
    description: 'Dating utang',
  });
  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 5000, // ₱50.00
    description: 'Pangalawang utang',
  });

  // Attempting to repay more than total debt (₱150.00) throws OverpaymentError
  await assert.rejects(
    previewRepaymentAllocation(db, {
      customerId: customer.id,
      amountCentavos: 16000, // ₱160.00
    }),
    (err: unknown) => {
      assert.ok(err instanceof OverpaymentError);
      assert.match(err.message, /Sobra ang ibinabayad/);
      assert.match(err.message, /150\.00/);
      return true;
    }
  );

  // Attempting to pay 0 or negative centavos throws CreditValidationError
  await assert.rejects(
    previewRepaymentAllocation(db, {
      customerId: customer.id,
      amountCentavos: 0,
    }),
    CreditValidationError
  );
  await assert.rejects(
    previewRepaymentAllocation(db, {
      customerId: customer.id,
      amountCentavos: -500,
    }),
    CreditValidationError
  );

  // Valid partial repayment preview
  const preview = await previewRepaymentAllocation(db, {
    customerId: customer.id,
    amountCentavos: 12000, // ₱120.00
  });

  assert.equal(preview.customerId, customer.id);
  assert.equal(preview.currentTotalDebtCentavos, 15000);
  assert.equal(preview.repaymentAmountCentavos, 12000);
  assert.equal(preview.newTotalDebtCentavos, 3000);
  assert.equal(preview.allocations.length, 2);

  // First debt is fully covered
  assert.equal(preview.allocations[0]?.allocatedCentavos, 10000);
  assert.equal(preview.allocations[0]?.newRemainingCentavos, 0);
  assert.equal(preview.allocations[0]?.isFullySettled, true);

  // Second debt is partially covered (2000 allocated, 3000 remaining)
  assert.equal(preview.allocations[1]?.allocatedCentavos, 2000);
  assert.equal(preview.allocations[1]?.newRemainingCentavos, 3000);
  assert.equal(preview.allocations[1]?.isFullySettled, false);
});

test('allocations across multiple debts apply FIFO oldest-first to known dates', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Mang Teban' });

  const product = await saveProduct(db, {
    name: 'Sardinas',
    variant: '155g',
    unit: 'lata',
    priceCentavos: 2500,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 100 });

  // Create 3 credit sales
  const sale1 = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 4 }], // ₱100.00
    paidCentavos: 0,
    paymentMethod: 'cash',
  });
  const sale2 = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2 }], // ₱50.00
    paidCentavos: 0,
    paymentMethod: 'cash',
  });
  const sale3 = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2 }], // ₱50.00
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  // Repay ₱125.00
  const repayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 12500,
    paymentMethod: 'cash',
    note: 'Partial bayad',
  });

  assert.equal(repayment.amountCentavos, 12500);
  assert.equal(repayment.allocations.length, 2);

  // Sale 1 (₱100.00) fully paid
  assert.equal(repayment.allocations[0]?.creditEntryId, sale1.creditEntry!.id);
  assert.equal(repayment.allocations[0]?.allocatedCentavos, 10000);

  // Sale 2 (₱50.00) paid ₱25.00, remaining ₱25.00
  assert.equal(repayment.allocations[1]?.creditEntryId, sale2.creditEntry!.id);
  assert.equal(repayment.allocations[1]?.allocatedCentavos, 2500);

  // Verify updated customer balance
  const updatedCustomer = await getCustomerById(db, customer.id);
  assert.equal(updatedCustomer?.totalDebtCentavos, 7500); // 20000 - 12500 = 7500
  assert.equal(updatedCustomer?.activeCreditCount, 2); // sale2 and sale3 still open
});

test('unknown-date opening debts are prioritized without inventing dates', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Aling Tess' });

  // 1. Undated opening balance (from old notebook)
  const undatedEntry = await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 5000, // ₱50.00
    description: 'Lumang notebook utang',
    originalDate: null,
  });

  // 2. Dated opening balance
  const datedEntry = await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 7000, // ₱70.00
    description: 'Utang noong Septiyembre',
    originalDate: '2026-09-15',
  });

  // 3. Aira sale credit
  const bigas = await saveProduct(db, {
    name: 'Sinandomeng',
    variant: '1kg',
    unit: 'pack',
    priceCentavos: 6000,
  });
  await setStockCount(db, { productId: bigas.id, newQuantity: 20 });
  const saleCredit = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: bigas.id, quantity: 1 }],
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  // Total debt: 5000 + 7000 + 6000 = 18000
  // Repay ₱80.00
  const repayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 8000,
    paymentMethod: 'cash',
  });

  assert.equal(repayment.allocations.length, 2);

  // First allocation: undated opening debt is paid FIRST (5000)
  assert.equal(repayment.allocations[0]?.creditEntryId, undatedEntry.id);
  assert.equal(repayment.allocations[0]?.allocatedCentavos, 5000);

  // Second allocation: dated opening debt receives remaining 3000
  assert.equal(repayment.allocations[1]?.creditEntryId, datedEntry.id);
  assert.equal(repayment.allocations[1]?.allocatedCentavos, 3000);

  // Verify that undated entry still has original_date IS NULL in DB (no invented dates)
  const undatedRow = await db.getFirst<{ original_date: string | null; remaining_amount_centavos: number }>(
    'SELECT original_date, remaining_amount_centavos FROM credit_entries WHERE id = ?;',
    [undatedEntry.id]
  );
  assert.equal(undatedRow?.original_date, null);
  assert.equal(undatedRow?.remaining_amount_centavos, 0);

  // Verify dated entry has original_date unchanged and remaining 4000
  const datedRow = await db.getFirst<{ original_date: string | null; remaining_amount_centavos: number }>(
    'SELECT original_date, remaining_amount_centavos FROM credit_entries WHERE id = ?;',
    [datedEntry.id]
  );
  assert.equal(datedRow?.original_date, '2026-09-15');
  assert.equal(datedRow?.remaining_amount_centavos, 4000);

  // Verify sale credit was untouched
  const saleRow = await db.getFirst<{ remaining_amount_centavos: number }>(
    'SELECT remaining_amount_centavos FROM credit_entries WHERE id = ?;',
    [saleCredit.creditEntry!.id]
  );
  assert.equal(saleRow?.remaining_amount_centavos, 6000);
});

test('commit payment and allocations atomically; partial payment preserves remaining debt age', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Kuya Boy' });

  // Insert a credit entry with known historical timestamp
  const historicalCreatedAt = '2026-09-01T10:00:00.000Z';
  await syncDb.prepare(`
    INSERT INTO credit_entries (
      id, customer_id, entry_type, sale_id, original_amount_centavos,
      remaining_amount_centavos, description, original_date, created_at, updated_at
    ) VALUES ('hist_1', ?, 'opening_balance', NULL, 10000, 10000, 'Lumang Utang', '2026-08-20', ?, ?);
  `).run(customer.id, historicalCreatedAt, historicalCreatedAt);

  // Partial repayment of ₱40.00
  await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 4000,
    paymentMethod: 'gcash',
    referenceNumber: 'GCASH-123456789',
    note: 'GCash partial payment',
  });

  const entry = await db.getFirst<{
    remaining_amount_centavos: number;
    original_date: string | null;
    created_at: string;
    updated_at: string;
  }>(
    'SELECT remaining_amount_centavos, original_date, created_at, updated_at FROM credit_entries WHERE id = ?;',
    ['hist_1']
  );

  // Remaining debt reduced by 4000 to 6000
  assert.equal(entry?.remaining_amount_centavos, 6000);
  // Original date is intact
  assert.equal(entry?.original_date, '2026-08-20');
  // Age is preserved: created_at did NOT change
  assert.equal(entry?.created_at, historicalCreatedAt);
  // updated_at was updated
  assert.notEqual(entry?.updated_at, historicalCreatedAt);

  // Repayment record verified
  const repayments = await getCustomerRepayments(db, customer.id);
  assert.equal(repayments.length, 1);
  assert.equal(repayments[0]?.amountCentavos, 4000);
  assert.equal(repayments[0]?.paymentMethod, 'gcash');
  assert.equal(repayments[0]?.referenceNumber, 'GCASH-123456789');
  assert.equal(repayments[0]?.allocations.length, 1);
  assert.equal(repayments[0]?.allocations[0]?.allocatedCentavos, 4000);
});

test('repayments add collections, never second sales or stock changes', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const kape = await saveProduct(db, {
    name: 'Nescafe',
    variant: 'Classic 25g',
    unit: 'sachet',
    priceCentavos: 1200,
  });
  await setStockCount(db, { productId: kape.id, newQuantity: 50 });
  const customer = await createCustomer(db, { name: 'Aling Gina' });

  await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: kape.id, quantity: 5 }],
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  // Check state before repayment
  const salesBefore = await db.getAll('SELECT * FROM sales;');
  const saleItemsBefore = await db.getAll('SELECT * FROM sale_items;');
  const stockBefore = await getStockLevel(db, kape.id);
  const movementsBefore = await db.getAll('SELECT * FROM inventory_movements;');

  assert.equal(salesBefore.length, 1);
  assert.equal(saleItemsBefore.length, 1);
  assert.equal(stockBefore?.quantity, 45); // 50 - 5

  // Record full repayment
  await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 6000,
    paymentMethod: 'cash',
  });

  // Check state after repayment
  const salesAfter = await db.getAll('SELECT * FROM sales;');
  const saleItemsAfter = await db.getAll('SELECT * FROM sale_items;');
  const stockAfter = await getStockLevel(db, kape.id);
  const movementsAfter = await db.getAll('SELECT * FROM inventory_movements;');

  // Repayment NEVER adds a second sale or alters stock!
  assert.equal(salesAfter.length, salesBefore.length);
  assert.equal(saleItemsAfter.length, saleItemsBefore.length);
  assert.equal(stockAfter?.quantity, stockBefore?.quantity);
  assert.equal(movementsAfter.length, movementsBefore.length);
});

test('duplicate submission with idempotencyKey returns existing repayment without double allocation', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Lito' });
  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 10000,
  });

  const params = {
    customerId: customer.id,
    amountCentavos: 4000,
    paymentMethod: 'cash' as const,
    idempotencyKey: 'repay-idemp-unique-123',
  };

  const firstCall = await recordRepayment(db, params);
  const secondCall = await recordRepayment(db, params);

  assert.equal(firstCall.id, secondCall.id);
  assert.equal(firstCall.amountCentavos, secondCall.amountCentavos);
  assert.equal(firstCall.allocations.length, secondCall.allocations.length);

  // Balance should only be deducted once (10000 - 4000 = 6000)
  const cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 6000);

  const repayments = await db.getAll('SELECT * FROM credit_repayments;');
  assert.equal(repayments.length, 1);

  const allocations = await db.getAll('SELECT * FROM repayment_allocations;');
  assert.equal(allocations.length, 1);
});

test('full settlement of all debts leaves customer with 0 balance and 0 active credits', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Nora' });
  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 3500,
  });
  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 4500,
  });

  // Exact full repayment: 8000
  const repayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 8000,
    paymentMethod: 'cash',
  });

  assert.equal(repayment.allocations.length, 2);
  assert.equal(repayment.allocations[0]?.allocatedCentavos, 3500);
  assert.equal(repayment.allocations[1]?.allocatedCentavos, 4500);

  const cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 0);
  assert.equal(cust?.activeCreditCount, 0);

  // Subsequent repayment throws OverpaymentError because total debt is 0
  await assert.rejects(
    recordRepayment(db, {
      customerId: customer.id,
      amountCentavos: 500,
      paymentMethod: 'cash',
    }),
    OverpaymentError
  );
});

test('persists repayments and allocations across app restart on real SQLite file', async (t) => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aira-repay-test-'));
  const dbPath = join(tempDir, 'aira.db');

  try {
    // Session 1: create customer, debt, and record repayment
    let sqlite = new DatabaseSync(dbPath);
    let db = new NodeSqliteAdapter(sqlite);
    await runMigrations(db);

    const customer = await createCustomer(db, { name: 'Aling Maring', note: 'Kanto' });
    await recordOpeningBalance(db, {
      customerId: customer.id,
      amountCentavos: 15000,
      description: 'Dating pautang',
    });

    const repayment = await recordRepayment(db, {
      customerId: customer.id,
      amountCentavos: 6500,
      paymentMethod: 'gcash',
      referenceNumber: 'GCASH-998877',
      note: 'Unang bayad sa utang',
    });

    assert.equal(repayment.amountCentavos, 6500);
    sqlite.close();

    // Session 2: simulate app restart with fresh connection
    sqlite = new DatabaseSync(dbPath);
    db = new NodeSqliteAdapter(sqlite);
    await runMigrations(db);

    const ledger = await getCustomerLedger(db, customer.id);
    assert.equal(ledger.customer.id, customer.id);
    assert.equal(ledger.customer.name, 'Aling Maring');
    assert.equal(ledger.customer.totalDebtCentavos, 8500); // 15000 - 6500
    assert.equal(ledger.customer.activeCreditCount, 1);

    assert.equal(ledger.repayments.length, 1);
    assert.equal(ledger.repayments[0]?.amountCentavos, 6500);
    assert.equal(ledger.repayments[0]?.paymentMethod, 'gcash');
    assert.equal(ledger.repayments[0]?.referenceNumber, 'GCASH-998877');
    assert.equal(ledger.repayments[0]?.allocations.length, 1);
    assert.equal(ledger.repayments[0]?.allocations[0]?.allocatedCentavos, 6500);

    const fetchedRepayment = await getRepaymentById(db, repayment.id);
    assert.equal(fetchedRepayment?.id, repayment.id);
    assert.equal(fetchedRepayment?.amountCentavos, 6500);

    sqlite.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
