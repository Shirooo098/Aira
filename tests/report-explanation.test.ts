import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  cancelSale,
  completeCashSale,
  confirmGcashSale,
  createPendingGcashDraft,
} from '../src/actions/sales-actions.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount } from '../src/actions/inventory-actions.ts';
import { getStoreReport } from '../src/actions/report-actions.ts';
import {
  completeCreditSale,
  createCustomer,
  recordOpeningBalance,
  recordRepayment,
  reverseRepayment,
} from '../src/actions/utang-actions.ts';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import {
  REPORT_EXPLANATION_FACT_IDS,
  REPORT_EXPLANATION_SCHEMA,
  buildReportExplanationEvidence,
  buildReportExplanationPrompt,
  parseReportExplanationFocus,
  renderReportExplanation,
} from '../src/domain/report-explanation.ts';

async function createMemoryStore(t: test.TestContext) {
  const syncDb = new DatabaseSync(':memory:');
  t.after(() => syncDb.close());
  const db = new NodeSqliteAdapter(syncDb);
  await runMigrations(db);
  return { syncDb, db };
}

function factById(evidence: ReturnType<typeof buildReportExplanationEvidence>, id: string): string {
  const fact = evidence.facts.find((item) => item.id === id);
  assert.ok(fact, `missing ${id} fact`);
  return fact.text;
}

test('grounds all report facts from real sales and repayment totals without writing or leaking raw data to the prompt', async (t) => {
  const { syncDb, db } = await createMemoryStore(t);
  const product = await saveProduct(db, {
    name: 'Tamang Data',
    variant: 'Piraso',
    unit: 'piraso',
    priceCentavos: 1000,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 50 });
  const customer = await createCustomer(db, { name: 'Suki Hidden' });

  await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 2 }],
    tenderCentavos: 2000,
  });
  const gcashDraft = await createPendingGcashDraft(db, {
    items: [{ productId: product.id, quantity: 1 }],
  });
  await confirmGcashSale(db, { draftId: gcashDraft.id, referenceNumber: 'GCASH-12345' });
  const cancelledSale = await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 1 }],
    tenderCentavos: 1000,
  });
  await cancelSale(db, { saleId: cancelledSale.id, reason: 'Fixture cancellation' });
  await completeCreditSale(db, {
    customerId: customer.id,
    items: [{ productId: product.id, quantity: 3 }],
    paidCentavos: 500,
    paymentMethod: 'cash',
  });
  await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 300,
    paymentMethod: 'cash',
  });
  await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 200,
    paymentMethod: 'gcash',
  });
  const reversedRepayment = await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 400,
    paymentMethod: 'gcash',
  });
  await reverseRepayment(db, { repaymentId: reversedRepayment.id, reason: 'Maling tala' });

  const writesBeforeReport = (syncDb.prepare('SELECT total_changes() AS count').get() as { count: number }).count;
  const report = await getStoreReport(db, { periodKey: 'today' });
  const evidence = buildReportExplanationEvidence(report);
  const prompt = buildReportExplanationPrompt(evidence);
  const focus = parseReportExplanationFocus('{"focus":["repayments","cash"]}', evidence);
  const rendered = renderReportExplanation(evidence, focus);
  const writesAfterRendering = (syncDb.prepare('SELECT total_changes() AS count').get() as { count: number }).count;

  assert.equal(evidence.hasPeriodActivity, true);
  assert.deepEqual(report.collectionBreakdown, {
    cashSalesCentavos: 2500,
    cashRepaymentsCentavos: 300,
    gcashSalesCentavos: 1000,
    gcashRepaymentsCentavos: 200,
  });
  assert.equal(report.netSalesCentavos, 6000);
  assert.equal(report.salesCount, 3);
  assert.equal(report.cancelledSalesCentavos, 1000);
  assert.equal(report.cancelledSalesCount, 1);
  assert.equal(report.grossSalesCentavos, 7000);
  assert.equal(report.newCreditCentavos, 2500);
  assert.equal(report.cashCollectionsCentavos, 2800);
  assert.equal(report.gcashCollectionsCentavos, 1200);
  assert.equal(report.totalCollectionsCentavos, 4000);
  assert.equal(report.currentOutstandingCreditCentavos, 2000);
  assert.equal(writesAfterRendering, writesBeforeReport);

  assert.deepEqual(evidence.facts.map(({ id }) => id), REPORT_EXPLANATION_FACT_IDS);
  assert.match(factById(evidence, 'cash'), /₱25\.00.*₱3\.00.*₱28\.00/u);
  assert.match(factById(evidence, 'gcash'), /₱10\.00.*₱2\.00.*₱12\.00/u);
  assert.match(factById(evidence, 'repayments'), /aktibong bayad.*₱5\.00.*hindi bagong benta/u);
  assert.match(factById(evidence, 'cancellations'), /orihinal na benta \(created_at\)/u);
  assert.match(factById(evidence, 'snapshot'), /hindi kabuuan para sa napiling panahon/u);
  assert.match(factById(evidence, 'limits'), /gastos o tubo.*sanhi.*kumpleto/u);
  assert.deepEqual(rendered.slice(0, 2).map(({ id }) => id), ['repayments', 'cash']);
  assert.deepEqual(rendered.map(({ id }) => id).sort(), [...REPORT_EXPLANATION_FACT_IDS].sort());

  assert.equal(prompt.messages.length, 2);
  assert.equal(prompt.messages[0].role, 'system');
  assert.equal(prompt.messages[1].role, 'user');
  assert.equal(prompt.messages[1].content.includes('Tamang Data'), false);
  assert.equal(prompt.messages[1].content.includes('Suki Hidden'), false);
  assert.equal(prompt.messages[1].content.includes('Fixture cancellation'), false);
  assert.equal(prompt.messages[1].content.includes('Maling tala'), false);

  assert.deepEqual(REPORT_EXPLANATION_SCHEMA, {
    type: 'object',
    properties: {
      focus: {
        type: 'array',
        items: { type: 'string', enum: REPORT_EXPLANATION_FACT_IDS },
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      },
    },
    required: ['focus'],
    additionalProperties: false,
  });
});

test('uses deterministic no-data facts and allows no focus only for a zero-activity report', async (t) => {
  const { db } = await createMemoryStore(t);
  const report = await getStoreReport(db, { periodKey: 'today' });
  const evidence = buildReportExplanationEvidence(report);

  assert.equal(evidence.hasPeriodActivity, false);
  assert.match(factById(evidence, 'sales'), /walang naitalang benta o kinanselang benta/u);
  assert.match(factById(evidence, 'repayments'), /Walang aktibong bayad sa utang na kasama sa ulat/u);
  assert.match(factById(evidence, 'cancellations'), /^0 kinanselang benta, halagang ₱0\.00/u);
  assert.deepEqual(renderReportExplanation(evidence, []).map(({ id }) => id), REPORT_EXPLANATION_FACT_IDS);
  assert.throws(() => renderReportExplanation(evidence, ['invalid']), /unsupported|dobleng/u);
});

test('treats repayment-only activity as activity and keeps it separate from sales', async (t) => {
  const { db } = await createMemoryStore(t);
  const customer = await createCustomer(db, { name: 'Repayment Only' });
  await recordOpeningBalance(db, { customerId: customer.id, amountCentavos: 2000 });
  await recordRepayment(db, {
    customerId: customer.id,
    amountCentavos: 500,
    paymentMethod: 'cash',
  });
  const report = await getStoreReport(db, { periodKey: 'today' });
  const evidence = buildReportExplanationEvidence(report);

  assert.equal(evidence.hasPeriodActivity, true);
  assert.equal(report.salesCount, 0);
  assert.equal(report.netSalesCentavos, 0);
  assert.equal(report.cashCollectionsCentavos, 500);
  assert.match(factById(evidence, 'sales'), /walang naitalang benta o kinanselang benta/u);
  assert.match(factById(evidence, 'repayments'), /aktibong bayad.*₱5\.00.*hindi bagong benta/u);
  assert.throws(() => renderReportExplanation(evidence, []), /focus list/u);
});

test('rejects invalid aggregates, dates, and model focus output', async (t) => {
  const { db } = await createMemoryStore(t);
  const report = await getStoreReport(db, { periodKey: 'today' });
  const evidence = buildReportExplanationEvidence(report);

  assert.throws(() => buildReportExplanationEvidence({ ...report, grossSalesCentavos: -1 }), /safe integer/u);
  assert.throws(() => buildReportExplanationEvidence({ ...report, grossSalesCentavos: 1 }), /gross sales/u);
  assert.throws(() => buildReportExplanationEvidence({
    ...report,
    period: { ...report.period, startManilaDate: '2026-02-30' },
  }), /wastong petsang/u);
  assert.throws(() => buildReportExplanationEvidence({
    ...report,
    collectionBreakdown: { ...report.collectionBreakdown, cashRepaymentsCentavos: Number.MAX_SAFE_INTEGER },
  }), /cash collections/u);

  for (const output of [
    '',
    'Nanguna ang sales.',
    '{"focus":["sales"],"summary":"profit"}',
    '{"focus":["profit"]}',
    '{"focus":["sales","sales"]}',
    '{"focus":[]}',
    '{"focus":[1]}',
    '{"focus":["sales","cash","gcash","credit"]}',
    '{"focus":["sales"]} trailing',
  ]) {
    assert.throws(() => parseReportExplanationFocus(output, evidence), undefined, output);
  }
});

test('deep-copies the report snapshot before rendering', async (t) => {
  const { db } = await createMemoryStore(t);
  const product = await saveProduct(db, {
    name: 'Copied Name',
    variant: 'Small',
    unit: 'piraso',
    priceCentavos: 100,
  });
  await setStockCount(db, { productId: product.id, newQuantity: 2 });
  await completeCashSale(db, {
    items: [{ productId: product.id, quantity: 1 }],
    tenderCentavos: 100,
  });
  const report = await getStoreReport(db, { periodKey: 'today' });
  const evidence = buildReportExplanationEvidence(report);
  const savedName = evidence.report.topProducts[0]?.productName;

  report.period.startManilaDate = '2000-01-01';
  if (report.topProducts[0]) report.topProducts[0].productName = 'Changed after copy';

  assert.notEqual(savedName, undefined);
  assert.notEqual(evidence.report.period.startManilaDate, report.period.startManilaDate);
  assert.equal(evidence.report.topProducts[0]?.productName, savedName);
  assert.equal(renderReportExplanation(evidence, ['sales']).length, 8);
});
