import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel, getInventoryHistory } from '../src/actions/inventory-actions.ts';
import {
  completeCashSale,
  confirmGcashSale,
  cancelSale,
  getSaleById,
} from '../src/actions/sales-actions.ts';
import {
  createCustomer,
  recordOpeningBalance,
  completeCreditSale,
  recordRepayment,
  reverseRepayment,
  getCustomerById,
  getCustomerRepayments,
  getCustomerLedger,
} from '../src/actions/utang-actions.ts';
import {
  SaleAlreadyCancelledError,
  PaidCreditSaleCancellationError,
} from '../src/domain/sales.ts';
import {
  RepaymentAlreadyReversedError,
} from '../src/domain/utang.ts';

test('unpaid cash sale cancellation restores stock exactly once and records sale_cancellation movement', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const productA = await saveProduct(db, {
    name: 'Lucky Me Pancit Canton',
    variant: 'Original',
    unit: 'piraso',
    priceCentavos: 1500,
  });
  const productB = await saveProduct(db, {
    name: 'Bear Brand Fortified',
    variant: '33g',
    unit: 'sachet',
    priceCentavos: 1800,
  });

  await setStockCount(db, { productId: productA.id, newQuantity: 20 });
  await setStockCount(db, { productId: productB.id, newQuantity: 15 });

  // 1. Complete cash sale
  const sale = await completeCashSale(db, {
    items: [
      { productId: productA.id, quantity: 3 },
      { productId: productB.id, quantity: 2 },
    ],
    tenderCentavos: 10000,
  });

  const stockAfterSaleA = await getStockLevel(db, productA.id);
  const stockAfterSaleB = await getStockLevel(db, productB.id);
  assert.equal(stockAfterSaleA?.quantity, 17);
  assert.equal(stockAfterSaleB?.quantity, 13);

  // 2. Cancel sale
  const cancelResult = await cancelSale(db, {
    saleId: sale.id,
    reason: 'Nagkamali ang mamimili ng kinuha',
  });

  assert.equal(cancelResult.sale.status, 'cancelled');
  assert.ok(cancelResult.sale.cancelledAt);
  assert.equal(cancelResult.sale.cancellationReason, 'Nagkamali ang mamimili ng kinuha');
  assert.equal(cancelResult.restoredItems.length, 2);

  // Verify stock restoration
  const stockAfterCancelA = await getStockLevel(db, productA.id);
  const stockAfterCancelB = await getStockLevel(db, productB.id);
  assert.equal(stockAfterCancelA?.quantity, 20);
  assert.equal(stockAfterCancelB?.quantity, 15);

  // Verify inventory movements
  const historyA = await getInventoryHistory(db, productA.id);
  assert.equal(historyA[0].movementType, 'sale_cancellation');
  assert.equal(historyA[0].quantityDelta, 3);
  assert.equal(historyA[0].previousQuantity, 17);
  assert.equal(historyA[0].newQuantity, 20);
  assert.match(historyA[0].note || '', /Kanseladong benta/);

  // Verify getSaleById reflects cancellation
  const fetchedSale = await getSaleById(db, sale.id);
  assert.equal(fetchedSale?.status, 'cancelled');
  assert.equal(fetchedSale?.cancellationReason, 'Nagkamali ang mamimili ng kinuha');
});

test('duplicate sale cancellation is rejected and never restores stock twice', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Silver Swan Suka',
    variant: '350ml',
    unit: 'bote',
    priceCentavos: 2200,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  const sale = await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 4 }],
    tenderCentavos: 10000,
  });

  // First cancellation succeeds
  await cancelSale(db, { saleId: sale.id });
  const stockAfterFirst = await getStockLevel(db, product.id);
  assert.equal(stockAfterFirst?.quantity, 10);

  // Duplicate cancellation fails
  await assert.rejects(
    cancelSale(db, { saleId: sale.id }),
    (err: unknown) => {
      assert.ok(err instanceof SaleAlreadyCancelledError);
      assert.match(err.message, /Kanselado na ang bentang ito/);
      return true;
    }
  );

  // Stock remains 10 (never restored twice to 14)
  const stockAfterSecond = await getStockLevel(db, product.id);
  assert.equal(stockAfterSecond?.quantity, 10);
});

test('unpaid credit sale cancellation zeroes customer balance and restores stock', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'San Miguel Pale Pilsen',
    variant: '330ml',
    unit: 'bote',
    priceCentavos: 6500,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 12 });

  const customer = await createCustomer(db, { name: 'Kumpareng Noel' });

  // Fully unpaid credit sale (0 paid)
  const creditSaleResult = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2 }],
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  assert.ok(creditSaleResult.creditEntry);
  assert.equal(creditSaleResult.creditEntry.remainingAmountCentavos, 13000);

  let custWithBalance = await getCustomerById(db, customer.id);
  assert.equal(custWithBalance?.totalDebtCentavos, 13000);
  assert.equal(custWithBalance?.activeCreditCount, 1);

  // Stock deducted
  assert.equal((await getStockLevel(db, product.id))?.quantity, 10);

  // Cancel unpaid credit sale
  const cancelResult = await cancelSale(db, {
    saleId: creditSaleResult.sale.id,
    reason: 'Hindi na kinuha ang alak',
  });

  assert.equal(cancelResult.sale.status, 'cancelled');

  // Customer debt is now 0 and activeCreditCount is 0
  custWithBalance = await getCustomerById(db, customer.id);
  assert.equal(custWithBalance?.totalDebtCentavos, 0);
  assert.equal(custWithBalance?.activeCreditCount, 0);

  // Stock restored back to 12
  assert.equal((await getStockLevel(db, product.id))?.quantity, 12);
});

test('cancelling paid-down credit sale without prior repayment reversal is blocked', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Corned Beef',
    variant: '150g',
    unit: 'lata',
    priceCentavos: 4000,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 20 });

  const customer = await createCustomer(db, { name: 'Aling Juana' });

  // Credit sale: 2 cans = ₱80.00 debt
  const creditSale = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2 }],
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  // Repayment of ₱30.00 against this credit sale
  await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 3000,
    paymentMethod: 'cash',
  });

  // Attempting to cancel sale directly must fail because repayment was allocated
  await assert.rejects(
    cancelSale(db, { saleId: creditSale.sale.id }),
    (err: unknown) => {
      assert.ok(err instanceof PaidCreditSaleCancellationError);
      assert.match(
        err.message,
        /Hindi maaaring kanselahin ang benta dahil may naibayad na rito\. Kailangan munang i-reverse ang mga bayad/
      );
      return true;
    }
  );

  // State remains untouched: stock is still 18, debt is still ₱50.00
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 18);
  const cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 5000);
});

test('repayment reversal restores customer debt across cross-debt allocations preserving debt age', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Mang Tasyo' });

  // Two separate debts with distinct original dates
  const debt1 = await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 10000, // ₱100.00
    description: 'Utang noong Enero',
    originalDate: '2026-01-15',
  });
  const debt2 = await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 15000, // ₱150.00
    description: 'Utang noong Pebrero',
    originalDate: '2026-02-20',
  });

  // Repay ₱150.00 across both debts (₱100 to debt1 settling it, ₱50 to debt2 partially)
  const repayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 15000,
    paymentMethod: 'cash',
    note: 'Bayad sa dalawang utang',
  });

  assert.equal(repayment.allocations.length, 2);

  // Customer debt before reversal is ₱100.00
  let cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 10000);

  // Reverse repayment
  const reversalResult = await reverseRepayment(db, {
    repaymentId: repayment.id,
    reason: 'Nagkamali ng amount na encode',
  });

  assert.equal(reversalResult.repayment.status, 'reversed');
  assert.ok(reversalResult.repayment.reversedAt);
  assert.equal(reversalResult.repayment.reversalReason, 'Nagkamali ng amount na encode');
  assert.equal(reversalResult.restoredEntries.length, 2);

  // Customer debt restored to full ₱250.00
  cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 25000);
  assert.equal(cust?.activeCreditCount, 2);

  // Check ledger entries: original dates and created_at are preserved
  const ledger = await getCustomerLedger(db, customer.id);
  const entry1 = ledger.creditEntries.find((e) => e.id === debt1.id);
  const entry2 = ledger.creditEntries.find((e) => e.id === debt2.id);

  assert.equal(entry1?.remainingAmountCentavos, 10000);
  assert.equal(entry1?.originalDate, '2026-01-15');
  assert.equal(entry1?.createdAt, debt1.createdAt);

  assert.equal(entry2?.remainingAmountCentavos, 15000);
  assert.equal(entry2?.originalDate, '2026-02-20');
  assert.equal(entry2?.createdAt, debt2.createdAt);

  // Check repayments history in ledger
  const repInLedger = ledger.repayments.find((r) => r.id === repayment.id);
  assert.equal(repInLedger?.status, 'reversed');
  assert.equal(repInLedger?.reversalReason, 'Nagkamali ng amount na encode');
});

test('duplicate repayment reversal is rejected and does not inflate customer debt', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const customer = await createCustomer(db, { name: 'Aling Belen' });
  await recordOpeningBalance(db, {
    customerId: customer.id,
    amountCentavos: 5000,
  });

  const repayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 2000,
    paymentMethod: 'cash',
  });

  // First reversal succeeds
  await reverseRepayment(db, { repaymentId: repayment.id });
  let cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 5000);

  // Duplicate reversal is rejected
  await assert.rejects(
    reverseRepayment(db, { repaymentId: repayment.id }),
    (err: unknown) => {
      assert.ok(err instanceof RepaymentAlreadyReversedError);
      assert.match(err.message, /Na-reverse na ang bayad na ito/);
      return true;
    }
  );

  // Debt is NOT inflated beyond original ₱50.00
  cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 5000);
});

test('cancelling credit sale succeeds after repayment is reversed', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Sardinas 555',
    variant: '155g',
    unit: 'lata',
    priceCentavos: 2500,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 10 });

  const customer = await createCustomer(db, { name: 'Tito Boy' });

  // Credit sale: 2 cans = ₱50.00
  const creditSale = await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 2 }],
    paidCentavos: 0,
    paymentMethod: 'cash',
  });

  // Repayment of ₱50.00 settles the debt
  const repayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 5000,
    paymentMethod: 'cash',
  });

  // 1. Direct cancellation fails
  await assert.rejects(
    cancelSale(db, { saleId: creditSale.sale.id }),
    PaidCreditSaleCancellationError
  );

  // 2. Reverse repayment
  await reverseRepayment(db, { repaymentId: repayment.id, reason: 'Isinauli ang mga aytem' });

  // 3. Now cancel sale succeeds!
  const cancelResult = await cancelSale(db, {
    saleId: creditSale.sale.id,
    reason: 'Isinauli ang paninda',
  });

  assert.equal(cancelResult.sale.status, 'cancelled');

  // Stock is restored from 8 back to 10
  const stock = await getStockLevel(db, product.id);
  assert.equal(stock?.quantity, 10);

  // Customer has 0 debt
  const cust = await getCustomerById(db, customer.id);
  assert.equal(cust?.totalDebtCentavos, 0);
});

test('confirmed GCash sale cancellation restores stock without fake refund', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Kopiko Blanca',
    variant: 'Twin Pack',
    unit: 'piraso',
    priceCentavos: 1400,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 30 });

  const gcashSale = await confirmGcashSale(db, {
    items: [{ productId: product.id, quantity: 5 }],
    referenceNumber: 'GCASH-987654321',
  });

  assert.equal((await getStockLevel(db, product.id))?.quantity, 25);

  const cancelResult = await cancelSale(db, {
    saleId: gcashSale.id,
    reason: 'Maling produkto ang naibigay',
  });

  assert.equal(cancelResult.sale.status, 'cancelled');
  assert.equal(cancelResult.sale.referenceNumber, 'GCASH-987654321');

  // Stock restored back to 30
  assert.equal((await getStockLevel(db, product.id))?.quantity, 30);
});

test('persists cancellations and reversals across app restart on real SQLite file', async (t) => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'aira-cancel-reverse-test-'));
  const dbPath = join(tmpDir, 'test_store.db');

  t.after(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  let saleId = '';
  let repaymentId = '';
  let customerId = '';
  let productId = '';

  // Session 1: Create sale, repayment, and perform cancellations/reversals
  {
    const syncDb = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(syncDb);
    await runMigrations(db);

    const product = await saveProduct(db, {
      name: 'Magic Sarap',
      variant: '8g',
      unit: 'sachet',
      priceCentavos: 600,
    });
    productId = product.id;
    await setStockCount(db, { productId, newQuantity: 50 });

    const customer = await createCustomer(db, { name: 'Ate Lolit' });
    customerId = customer.id;

    // Debt from opening balance: ₱20.00
    await recordOpeningBalance(db, {
      customerId,
      amountCentavos: 2000,
      description: 'Dating pautang',
    });

    // Repayment: ₱20.00
    const rep = await recordRepayment(db, {
      customerId,
      amountCentavos: 2000,
      paymentMethod: 'cash',
    });
    repaymentId = rep.id;

    // Reverse repayment
    await reverseRepayment(db, {
      repaymentId,
      reason: 'Pekeng pera ang ibinayad',
    });

    // Cash sale: 5 sachets
    const sale = await completeCashSale(db, {
      items: [{ productId, quantity: 5 }],
      tenderCentavos: 5000,
    });
    saleId = sale.id;

    // Cancel sale
    await cancelSale(db, {
      saleId,
      reason: 'Kanselado ng tindero',
    });

    syncDb.close();
  }

  // Session 2: Reopen real database from disk and verify persistence
  {
    const syncDb = new DatabaseSync(dbPath);
    const db = new NodeSqliteAdapter(syncDb);

    // Verify stock is 50 (deducted 5, restored 5)
    const stock = await getStockLevel(db, productId);
    assert.equal(stock?.quantity, 50);

    // Verify sale is cancelled
    const sale = await getSaleById(db, saleId);
    assert.equal(sale?.status, 'cancelled');
    assert.equal(sale?.cancellationReason, 'Kanselado ng tindero');

    // Verify customer debt is restored to ₱20.00
    const cust = await getCustomerById(db, customerId);
    assert.equal(cust?.totalDebtCentavos, 2000);

    // Verify repayment status is reversed
    const repayments = await getCustomerRepayments(db, customerId);
    assert.equal(repayments.length, 1);
    assert.equal(repayments[0].status, 'reversed');
    assert.equal(repayments[0].reversalReason, 'Pekeng pera ang ibinayad');

    // Verify duplicate operations fail across restart
    await assert.rejects(
      cancelSale(db, { saleId }),
      SaleAlreadyCancelledError
    );
    await assert.rejects(
      reverseRepayment(db, { repaymentId }),
      RepaymentAlreadyReversedError
    );

    syncDb.close();
  }
});
