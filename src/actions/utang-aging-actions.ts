import type { DatabaseSession } from '../db/database.ts';
import type { DebtPriority } from '../domain/utang-aging.ts';
import { addCentavos, calendarDate, debtPriority, manilaDay } from '../domain/utang-aging.ts';

export interface AgedCustomer {
  customerId: string;
  name: string;
  totalCentavos: number;
  knownCentavos: number;
  unknownCentavos: number;
  unknownCount: number;
  dateWarning: boolean;
  oldestEntryId: string | null;
  oldestRemainingCentavos: number | null;
  oldestDate: string | null;
  ageDays: number | null;
  priority: DebtPriority;
}

interface Row {
  customer_id: string; name: string; id: string;
  entry_type: 'sale_credit' | 'opening_balance';
  original_date: string | null; created_at: string; remaining_amount_centavos: number;
}

export async function getAgedUtang(db: DatabaseSession, asOf = new Date().toISOString()) {
  const today = manilaDay(asOf);
  if (today === null) throw new Error('Invalid aging date');
  // One SELECT provides a consistent SQLite statement snapshot.
  const rows = await db.getAll<Row>(`SELECT c.id AS customer_id, c.name, ce.id,
    ce.entry_type, ce.original_date, ce.created_at, ce.remaining_amount_centavos
    FROM customers c JOIN credit_entries ce ON ce.customer_id = c.id
    WHERE ce.remaining_amount_centavos > 0 AND ce.status != 'cancelled';`);
  const grouped = new Map<string, AgedCustomer>();
  for (const row of rows) {
    let customer = grouped.get(row.customer_id);
    if (!customer) {
      customer = { customerId: row.customer_id, name: row.name, totalCentavos: 0,
        knownCentavos: 0, unknownCentavos: 0, unknownCount: 0, dateWarning: false,
        oldestEntryId: null, oldestRemainingCentavos: null, oldestDate: null, ageDays: null, priority: 'Age unknown' };
      grouped.set(row.customer_id, customer);
    }
    const amount = row.remaining_amount_centavos;
    customer.totalCentavos = addCentavos(customer.totalCentavos, amount);
    // Sale credits store the original sale timestamp in created_at (#11 contract).
    const source = row.entry_type === 'sale_credit' ? row.created_at : row.original_date;
    const day = source ? manilaDay(source) : null;
    if (day === null || day > today) {
      customer.unknownCentavos = addCentavos(customer.unknownCentavos, amount);
      customer.unknownCount++;
      customer.dateWarning ||= !!source;
      continue;
    }
    customer.knownCentavos = addCentavos(customer.knownCentavos, amount);
    const date = calendarDate(day);
    if (customer.oldestDate === null || date < customer.oldestDate ||
      (date === customer.oldestDate && row.id < customer.oldestEntryId!)) {
      customer.oldestDate = date;
      customer.oldestEntryId = row.id;
      customer.oldestRemainingCentavos = amount;
      customer.ageDays = today - day;
      customer.priority = debtPriority(customer.ageDays);
    }
  }
  const ranks: Record<DebtPriority, number> = { Urgent: 0, 'Needs attention': 1, 'Age unknown': 2, Current: 3 };
  const customers = [...grouped.values()].sort((a, b) => ranks[a.priority] - ranks[b.priority] ||
    (a.oldestDate ?? '').localeCompare(b.oldestDate ?? '') || b.totalCentavos - a.totalCentavos ||
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.customerId.localeCompare(b.customerId));
  return { asOf, customers, totalCentavos: customers.reduce((sum, c) => addCentavos(sum, c.totalCentavos), 0) };
}
