import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount } from '../src/actions/inventory-actions.ts';
import {
  completeCashSale,
  confirmGcashSale,
  createPendingGcashDraft,
  cancelSale,
} from '../src/actions/sales-actions.ts';
import {
  createCustomer,
  completeCreditSale,
  recordOpeningBalance,
  recordRepayment,
  reverseRepayment,
} from '../src/actions/utang-actions.ts';
import { getStoreReport } from '../src/actions/report-actions.ts';
import {
  calculatePeriodRange,
  getAvailablePriorMonths,
  getManilaDateTimeParts,
  createUtcIsoFromManila,
} from '../src/domain/reports.ts';

test('calculatePeriodRange computes accurate boundaries in Asia/Manila ending at now', () => {
  // Test evaluation date: Wednesday 2026-10-14 14:30:00 Manila (06:30:00 UTC)
  const evalDate = new Date('2026-10-14T06:30:00.000Z');

  // 1. Today: from 2026-10-14 00:00:00 Manila (2026-10-13 16:00:00 UTC) to evalDate
  const today = calculatePeriodRange('today', evalDate);
  assert.equal(today.startManilaDate, '2026-10-14');
  assert.equal(today.endManilaDate, '2026-10-14');
  assert.equal(today.startUtcIso, '2026-10-13T16:00:00.000Z');
  assert.equal(today.endUtcIso, evalDate.toISOString());

  // 2. Week: Monday-start! 2026-10-14 is Wednesday -> Monday is 2026-10-12
  const week = calculatePeriodRange('week', evalDate);
  assert.equal(week.startManilaDate, '2026-10-12');
  assert.equal(week.startUtcIso, '2026-10-11T16:00:00.000Z');
  assert.equal(week.endUtcIso, evalDate.toISOString());

  // Test Sunday evaluation: Sunday 2026-10-18 Manila (dayOfWeek = 0)
  const sundayEval = new Date('2026-10-18T06:00:00.000Z');
  const sundayWeek = calculatePeriodRange('week', sundayEval);
  // Monday is 6 days prior: 2026-10-12
  assert.equal(sundayWeek.startManilaDate, '2026-10-12');

  // 3. Month: 1st of October 2026 (2026-10-01 00:00:00 Manila = 2026-09-30 16:00:00 UTC)
  const month = calculatePeriodRange('month', evalDate);
  assert.equal(month.startManilaDate, '2026-10-01');
  assert.equal(month.startUtcIso, '2026-09-30T16:00:00.000Z');
  assert.equal(month.endUtcIso, evalDate.toISOString());

  // 4. Year: Jan 1 2026 (2026-01-01 00:00:00 Manila = 2025-12-31 16:00:00 UTC)
  const year = calculatePeriodRange('year', evalDate);
  assert.equal(year.startManilaDate, '2026-01-01');
  assert.equal(year.startUtcIso, '2025-12-31T16:00:00.000Z');
  assert.equal(year.endUtcIso, evalDate.toISOString());

  // 5. Six Months: 5 months prior = May 1 2026 (2026-05-01 00:00:00 Manila)
  const sixMonths = calculatePeriodRange('six_months', evalDate);
  assert.equal(sixMonths.startManilaDate, '2026-05-01');
  assert.equal(sixMonths.startUtcIso, '2026-04-30T16:00:00.000Z');
  assert.equal(sixMonths.endUtcIso, evalDate.toISOString());

  // 6. Prior month options: Setyembre, Agosto, Hulyo, Hunyo, Mayo
  const priors = getAvailablePriorMonths(evalDate);
  assert.equal(priors.length, 5);
  assert.equal(priors[0].label, 'Setyembre 2026');
  assert.equal(priors[4].label, 'Mayo 2026');

  // Prior month query: offset 1 = September 2026 (full month 2026-09-01 to 2026-09-30)
  const septReport = calculatePeriodRange('prior_month', evalDate, 1);
  assert.equal(septReport.startManilaDate, '2026-09-01');
  assert.equal(septReport.endManilaDate, '2026-09-30');
});

test('getStoreReport returns zeroed metrics on empty database without error', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const report = await getStoreReport(db, { periodKey: 'today' });

  assert.equal(report.netSalesCentavos, 0);
  assert.equal(report.grossSalesCentavos, 0);
  assert.equal(report.cancelledSalesCentavos, 0);
  assert.equal(report.salesCount, 0);
  assert.equal(report.cancelledSalesCount, 0);
  assert.equal(report.cashCollectionsCentavos, 0);
  assert.equal(report.gcashCollectionsCentavos, 0);
  assert.equal(report.totalCollectionsCentavos, 0);
  assert.equal(report.newCreditCentavos, 0);
  assert.equal(report.currentOutstandingCreditCentavos, 0);
  assert.equal(report.stockNowUnits, 0);
  assert.deepEqual(report.topProducts, []);
});

test('getStoreReport calculates net sales, exclusions of cancelled sales, and collections correctly', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  // Setup products
  const coke = await saveProduct(db, {
    name: 'Coca-Cola',
    variant: '1.5L',
    unit: 'bote',
    priceCentavos: 7000, // ₱70.00
  });
  await setStockCount(db, { productId: coke.id, newQuantity: 50 });

  const noodles = await saveProduct(db, {
    name: 'Lucky Me',
    variant: 'Chicken',
    unit: 'piraso',
    priceCentavos: 1500, // ₱15.00
  });
  await setStockCount(db, { productId: noodles.id, newQuantity: 100 });

  // 1. Complete a Cash Sale: 1 Coke (₱70.00)
  const cashSale = await completeCashSale(db, {
    items: [{ productId: coke.id, quantity: 1 }],
    tenderCentavos: 10000,
  });

  // 2. Complete a GCash Sale: 2 Noodles (₱30.00)
  const gcashDraft = await createPendingGcashDraft(db, {
    items: [{ productId: noodles.id, quantity: 2 }],
  });
  const gcashSale = await confirmGcashSale(db, {
    draftId: gcashDraft.id,
    referenceNumber: 'GCASH-12345',
  });

  // 3. Complete a Sale to be Cancelled: 1 Coke (₱70.00)
  const saleToCancel = await completeCashSale(db, {
    items: [{ productId: coke.id, quantity: 1 }],
    tenderCentavos: 7000,
  });
  await cancelSale(db, {
    saleId: saleToCancel.id,
    reason: 'Nagkamali ng order',
  });

  // Query report
  const report = await getStoreReport(db, { periodKey: 'today' });

  // Expected metrics:
  // Active sales: cashSale (₱70) + gcashSale (₱30) = ₱100.00
  // Cancelled sales: saleToCancel (₱70)
  // Gross sales = ₱170.00
  // Net sales = ₱100.00
  assert.equal(report.netSalesCentavos, 10000);
  assert.equal(report.cancelledSalesCentavos, 7000);
  assert.equal(report.grossSalesCentavos, 17000);
  assert.equal(report.salesCount, 2);
  assert.equal(report.cancelledSalesCount, 1);

  // Collections:
  // Cash = ₱70.00 (from active cash sale)
  // GCash = ₱30.00 (from active GCash sale)
  // Total = ₱100.00
  assert.equal(report.cashCollectionsCentavos, 7000);
  assert.equal(report.gcashCollectionsCentavos, 3000);
  assert.equal(report.totalCollectionsCentavos, 10000);

  // Top Products:
  // Noodles: 2 units sold (₱30.00)
  // Coke: 1 unit sold (₱70.00) — cancelled Coke excluded!
  assert.equal(report.topProducts.length, 2);
  assert.equal(report.topProducts[0].productName, 'Lucky Me');
  assert.equal(report.topProducts[0].unitsSold, 2);
  assert.equal(report.topProducts[0].revenueCentavos, 3000);

  assert.equal(report.topProducts[1].productName, 'Coca-Cola');
  assert.equal(report.topProducts[1].unitsSold, 1);
  assert.equal(report.topProducts[1].revenueCentavos, 7000);
});

test('getStoreReport attributes credit sales, repayments, reversals, and stock now snapshot', async (t) => {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);

  const product = await saveProduct(db, {
    name: 'Kape',
    variant: 'Sachet',
    unit: 'piraso',
    priceCentavos: 1200, // ₱12.00
  });
  await setStockCount(db, { productId: product.id, newQuantity: 20 });

  const customer = await createCustomer(db, { name: 'Aling Maring' });

  // 1. Credit Sale: 5 sachets = ₱60.00. Paid ₱20 cash, Credit ₱40.
  await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 5 }],
    paidCentavos: 2000, // ₱20.00 downpayment
    paymentMethod: 'cash',
  });

  // 2. Repayment: customer pays ₱30 via GCash
  const repay = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 3000, // ₱30.00
    paymentMethod: 'gcash',
  });

  // 3. Another repayment that gets reversed: ₱10 cash
  const reversedRepay = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 1000,
    paymentMethod: 'cash',
  });
  await reverseRepayment(db, {
    repaymentId: reversedRepay.id,
    reason: 'Maling tala',
  });

  const report = await getStoreReport(db, { periodKey: 'today' });

  // Net Sales: ₱60.00 (the retail sale) — Repayments are NOT sales!
  assert.equal(report.netSalesCentavos, 6000);
  assert.equal(report.salesCount, 1);

  // New Credit issued in period: ₱40.00
  assert.equal(report.newCreditCentavos, 4000);

  // Collections:
  // Cash = ₱20.00 (downpayment from sale; reversed ₱10 repayment excluded)
  // GCash = ₱30.00 (active repayment)
  // Total Collections = ₱50.00
  assert.equal(report.cashCollectionsCentavos, 2000);
  assert.equal(report.gcashCollectionsCentavos, 3000);
  assert.equal(report.totalCollectionsCentavos, 5000);

  // Current Outstanding Credit:
  // Original debt ₱40.00 - ₱30.00 repayment = ₱10.00 remaining debt
  assert.equal(report.currentOutstandingCreditCentavos, 1000);

  // Stock now: 20 - 5 = 15 units
  assert.equal(report.stockNowUnits, 15);
});
