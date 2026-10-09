import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeSqliteAdapter } from '../src/db/node-sqlite-adapter.ts';
import { runMigrations } from '../src/db/migrations.ts';
import { getAgedUtang } from '../src/actions/utang-aging-actions.ts';
import { createCustomer, recordOpeningBalance, recordRepayment, reverseRepayment, getCustomers, completeCreditSale } from '../src/actions/utang-actions.ts';
import { saveProduct } from '../src/actions/catalog-actions.ts';
import { setStockCount } from '../src/actions/inventory-actions.ts';
import { cancelSale } from '../src/actions/sales-actions.ts';
import { addCentavos, manilaDay, millisecondsToManilaMidnight } from '../src/domain/utang-aging.ts';

const asOf = '2026-10-10T04:00:00Z';
test('Manila calendar parsing, midnight, invalid dates and safe centavos', () => {
  assert.equal(manilaDay('2026-10-09T16:00:00Z'), manilaDay('2026-10-10'));
  assert.equal(manilaDay('2026-10-09T15:59:59Z'), manilaDay('2026-10-09'));
  assert.equal(manilaDay('2026-10-10T00:00:00+08:00'), manilaDay('2026-10-10'));
  for (const value of ['2026-02-30', '2026-13-01', '2026-10-10T12:00:00', 'bad', '2026-02-30T00:00:00Z']) assert.equal(manilaDay(value), null);
  assert.throws(() => addCentavos(Number.MAX_SAFE_INTEGER, 1));
  assert.throws(() => addCentavos(1, 1.5));
  assert.equal(millisecondsToManilaMidnight(Date.parse('2026-10-09T15:59:59Z')), 1000);
});

test('age thresholds, duplicate names, unknown visibility, reconciliation and stable ordering', async t => {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  const db = new NodeSqliteAdapter(raw); await runMigrations(db);
  const expected = new Map<string, string>();
  for (const [date, priority] of [['2026-10-08', 'Current'], ['2026-10-07', 'Needs attention'], ['2026-10-04', 'Needs attention'], ['2026-10-03', 'Urgent']]) {
    const c = await createCustomer(db, { name: 'Same name' });
    await recordOpeningBalance(db, { customerId: c.id, amountCentavos: 100, originalDate: date });
    expected.set(c.id, priority);
  }
  const mixed = await createCustomer(db, { name: 'Mixed' });
  await recordOpeningBalance(db, { customerId: mixed.id, amountCentavos: 200, originalDate: '2026-10-02' });
  await recordOpeningBalance(db, { customerId: mixed.id, amountCentavos: 300 });
  const unknown = await createCustomer(db, { name: 'Unknown' });
  for (const date of [undefined, '2026-02-30', '2026-10-11']) await recordOpeningBalance(db, { customerId: unknown.id, amountCentavos: 50, originalDate: date });
  const result = await getAgedUtang(db, asOf);
  assert.equal(result.customers.length, 6);
  for (const c of result.customers) if (expected.has(c.customerId)) assert.equal(c.priority, expected.get(c.customerId));
  assert.equal(result.customers[0].customerId, mixed.id);
  assert.equal(result.customers[0].unknownCentavos, 300);
  assert.equal(result.customers[0].knownCentavos, 200);
  assert.equal(result.customers[0].ageDays, 8);
  assert.equal(result.customers[0].oldestRemainingCentavos, 200);
  const u = result.customers.find(c => c.customerId === unknown.id)!;
  assert.equal(u.priority, 'Age unknown'); assert.equal(u.oldestDate, null); assert.equal(u.dateWarning, true);
  assert.equal(result.totalCentavos, (await getCustomers(db)).reduce((n, c) => n + c.totalDebtCentavos, 0));
  assert.deepEqual(await getAgedUtang(db, asOf), result);
  const before = await getAgedUtang(db, '2026-10-09T15:59:59Z');
  const after = await getAgedUtang(db, '2026-10-09T16:00:00Z');
  assert.equal(before.customers.find(c => c.customerId === mixed.id)!.ageDays, 7);
  assert.equal(after.customers.find(c => c.customerId === mixed.id)!.ageDays, 8);
});

test('repayment, oldest settlement, full settlement, reversal and database restart preserve original age', async t => {
  const folder = mkdtempSync(join(tmpdir(), 'aira-aging-'));
  const filename = join(folder, 'test.db');
  let raw = new DatabaseSync(filename);
  t.after(() => { raw.close(); rmSync(folder, { recursive: true, force: true }); });
  let db = new NodeSqliteAdapter(raw); await runMigrations(db);
  const c = await createCustomer(db, { name: 'Maria' });
  await recordOpeningBalance(db, { customerId: c.id, amountCentavos: 1000, originalDate: '2026-10-01' });
  await recordOpeningBalance(db, { customerId: c.id, amountCentavos: 500, originalDate: '2026-10-08' });
  const partial = await recordRepayment(db, { customerId: c.id, amountCentavos: 400, paymentMethod: 'cash' });
  assert.equal((await getAgedUtang(db, asOf)).customers[0].ageDays, 9);
  await recordRepayment(db, { customerId: c.id, amountCentavos: 600, paymentMethod: 'cash' });
  assert.equal((await getAgedUtang(db, asOf)).customers[0].priority, 'Current');
  await recordRepayment(db, { customerId: c.id, amountCentavos: 500, paymentMethod: 'cash' });
  assert.equal((await getAgedUtang(db, asOf)).customers.length, 0);
  await reverseRepayment(db, { repaymentId: partial.id, reason: 'Correction' });
  const restored = await getAgedUtang(db, asOf);
  assert.equal(restored.totalCentavos, 400); assert.equal(restored.customers[0].ageDays, 9);
  raw.close(); raw = new DatabaseSync(filename); db = new NodeSqliteAdapter(raw);
  assert.deepEqual(await getAgedUtang(db, asOf), restored);
});

test('sale credit uses original sale timestamp and cancellation removes it', async t => {
  const raw = new DatabaseSync(':memory:'); t.after(() => raw.close());
  const db = new NodeSqliteAdapter(raw); await runMigrations(db);
  const c = await createCustomer(db, { name: 'Buyer' });
  const p = await saveProduct(db, { name: 'Rice', variant: 'White', unit: 'kg', priceCentavos: 1000 });
  await setStockCount(db, { productId: p.id, newQuantity: 10 });
  const { sale, creditEntry } = await completeCreditSale(db, { customerId: c.id, items: [{ productId: p.id, quantity: 1 }], paidCentavos: 0, paymentMethod: 'cash' });
  await db.run('UPDATE credit_entries SET created_at = ? WHERE id = ?;', ['2026-10-03T00:00:00Z', creditEntry!.id]);
  assert.equal((await getAgedUtang(db, asOf)).customers[0].priority, 'Urgent');
  await cancelSale(db, { saleId: sale.id, reason: 'Wrong sale' });
  assert.equal((await getAgedUtang(db, asOf)).totalCentavos, 0);
});

test('database failures are surfaced instead of returning a false empty balance', async () => {
  const raw = new DatabaseSync(':memory:');
  const db = new NodeSqliteAdapter(raw); raw.close();
  await assert.rejects(getAgedUtang(db, asOf));
});
