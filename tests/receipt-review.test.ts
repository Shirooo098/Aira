import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount, getStockLevel } from '../src/actions/inventory-actions.ts';
import { createPendingGcashDraft, confirmGcashSale, getPendingGcashDraftById, completeCashSale } from '../src/actions/sales-actions.ts';
import { reviewReceiptForSale } from '../src/actions/receipt-actions.ts';
import { proposeReceiptFields } from '../src/domain/receipt.ts';
import { createCustomer, completeCreditSale, recordOpeningBalance, recordRepayment, reverseRepayment } from '../src/actions/utang-actions.ts';

async function fixture(t: test.TestContext) {
  const raw = new DatabaseSync(':memory:');
  t.after(() => raw.close());
  const db = new NodeSqliteAdapter(raw);
  await runMigrations(db);
  const product = await saveProduct(db, { name: 'Coke', variant: '250ml', unit: 'bote', priceCentavos: 2500 });
  await setStockCount(db, { productId: product.id, newQuantity: 10 });
  const items = [{ productId: product.id, quantity: 1 }];
  const draft = await createPendingGcashDraft(db, { items });
  return { db, product, items, draft };
}

test('receipt review compares a pending amount without confirming the sale or moving stock', async t => {
  const { db, product, draft } = await fixture(t);
  const result = await reviewReceiptForSale(db, { kind: 'pending', id: draft.id }, proposeReceiptFields('Amount: 25.00'));
  assert.equal(result.amountMatches, true);
  assert.equal(result.expectedAmountCentavos, 2500);
  assert.equal((await getPendingGcashDraftById(db, draft.id))?.status, 'pending');
  assert.equal((await getStockLevel(db, product.id))?.quantity, 10);
  assert.equal((await db.getAll('SELECT * FROM sales')).length, 0);
});

test('flags amount mismatch and normalized references on other local payments', async t => {
  const { db, items, draft } = await fixture(t);
  const prior = await confirmGcashSale(db, { items, referenceNumber: 'ABC 123' });
  const result = await reviewReceiptForSale(db, { kind: 'pending', id: draft.id }, proposeReceiptFields('Amount: 50.00\nReference: abc123'));
  assert.equal(result.amountMatches, false);
  assert.deepEqual(result.referenceUses, [{ kind: 'sale', id: prior.id, status: 'completed' }]);
});

test('a confirmed sale does not flag its own reference as another payment', async t => {
  const { db, items } = await fixture(t);
  const sale = await confirmGcashSale(db, { items, referenceNumber: 'OWN-REF' });
  const result = await reviewReceiptForSale(db, { kind: 'sale', id: sale.id }, proposeReceiptFields('Amount: 25.00\nReference: OWN-REF'));
  assert.equal(result.amountMatches, true);
  assert.deepEqual(result.referenceUses, []);
});

test('missing targets and cash sales cannot be treated as GCash receipt targets', async t => {
  const { db, items } = await fixture(t);
  const proposal = proposeReceiptFields('Amount: 25.00');
  await assert.rejects(reviewReceiptForSale(db, { kind: 'pending', id: 'missing' }, proposal));
  const cash = await completeCashSale(db, { items, tenderCentavos: 2500 });
  await assert.rejects(reviewReceiptForSale(db, { kind: 'sale', id: cash.id }, proposal));
});

test('partial-credit receipt compares the received payment rather than full sale total', async t => {
  const { db, items } = await fixture(t);
  const customer = await createCustomer(db, { name: 'Juan' });
  const { sale } = await completeCreditSale(db, { customerId: customer.id, items, paidCentavos: 1000, paymentMethod: 'gcash' });
  const result = await reviewReceiptForSale(db, { kind: 'sale', id: sale.id }, proposeReceiptFields('Amount: 10.00'));
  assert.equal(result.expectedAmountCentavos, 1000);
  assert.equal(result.amountMatches, true);
});

test('reference comparison includes reversed GCash repayments without changing debt', async t => {
  const { db, draft } = await fixture(t);
  const customer = await createCustomer(db, { name: 'Maria' });
  await recordOpeningBalance(db, { customerId: customer.id, amountCentavos: 5000 });
  const repayment = await recordRepayment(db, { customerId: customer.id, amountCentavos: 1000, paymentMethod: 'gcash', referenceNumber: 'REP 123' });
  await reverseRepayment(db, { repaymentId: repayment.id, reason: 'Incorrect record' });
  const before = await db.getAll('SELECT * FROM credit_entries');
  const result = await reviewReceiptForSale(db, { kind: 'pending', id: draft.id }, proposeReceiptFields('Reference: rep123'));
  assert.deepEqual(result.referenceUses, [{ kind: 'repayment', id: repayment.id, status: 'reversed' }]);
  assert.equal(result.amountMatches, null);
  assert.deepEqual(await db.getAll('SELECT * FROM credit_entries'), before);
});
