export class CustomerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CustomerValidationError';
  }
}

export class CreditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditValidationError';
  }
}

export class OverpaymentError extends CreditValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'OverpaymentError';
  }
}

export function validateCustomerName(name: string): string {
  if (typeof name !== 'string') {
    throw new CustomerValidationError('Kailangang maglagay ng pangalan ng suki');
  }

  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new CustomerValidationError('Kailangang maglagay ng pangalan ng suki');
  }

  return trimmed;
}

export function validateCentavoAmount(amount: unknown, label: string): number {
  if (amount === null || amount === undefined) {
    throw new CreditValidationError(`Kailangang maglagay ng halaga para sa ${label}`);
  }

  let num: number;
  if (typeof amount === 'number') {
    num = amount;
  } else if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (trimmed.length === 0) {
      throw new CreditValidationError(`Kailangang maglagay ng halaga para sa ${label}`);
    }
    if (!/^-?\d+$/.test(trimmed)) {
      throw new CreditValidationError(`Dapat buong numero (integer) ang centavos para sa ${label}`);
    }
    num = Number(trimmed);
  } else {
    throw new CreditValidationError(`Dapat buong numero (integer) ang centavos para sa ${label}`);
  }

  if (!Number.isSafeInteger(num)) {
    throw new CreditValidationError(`Dapat buong numero (integer) ang centavos para sa ${label}`);
  }

  if (num < 0) {
    throw new CreditValidationError(`Hindi maaaring negatibo ang halaga para sa ${label}`);
  }

  return num;
}

export function generateCustomerId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `cust_${timestamp}_${randomPart}`;
}

export function generateCreditEntryId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `credit_${timestamp}_${randomPart}`;
}

export function generateRepaymentId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `repay_${timestamp}_${randomPart}`;
}

export function generateAllocationId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `alloc_${timestamp}_${randomPart}`;
}

export interface SortableCreditEntry {
  id: string;
  entryType: 'sale_credit' | 'opening_balance';
  originalDate?: string | null;
  createdAt: string;
  rowid?: number;
}

/**
 * Orders unpaid credit entries oldest-first (FIFO) without inventing dates:
 * 1. Prior balance (opening_balance) entries precede new sale credits.
 * 2. Undated legacy debts (original_date IS NULL) precede dated opening debts.
 * 3. Dated opening debts order chronologically by original_date ASC.
 * 4. Ties in opening debts order by entry creation date (createdAt ASC), rowid, then ID.
 * 5. Sale credits order chronologically by sale timestamp (createdAt ASC), rowid, then ID.
 */
export function compareCreditEntriesOldestFirst(
  a: SortableCreditEntry,
  b: SortableCreditEntry
): number {
  const aRank = a.entryType === 'opening_balance' ? 0 : 1;
  const bRank = b.entryType === 'opening_balance' ? 0 : 1;
  if (aRank !== bRank) {
    return aRank - bRank;
  }

  if (a.entryType === 'opening_balance') {
    const aHasDate = a.originalDate != null && a.originalDate.trim().length > 0;
    const bHasDate = b.originalDate != null && b.originalDate.trim().length > 0;
    if (!aHasDate && bHasDate) return -1;
    if (aHasDate && !bHasDate) return 1;
    if (aHasDate && bHasDate) {
      const cmp = a.originalDate!.localeCompare(b.originalDate!);
      if (cmp !== 0) return cmp;
    }
    const createdCmp = a.createdAt.localeCompare(b.createdAt);
    if (createdCmp !== 0) return createdCmp;
    if (a.rowid != null && b.rowid != null && a.rowid !== b.rowid) {
      return a.rowid - b.rowid;
    }
    return a.id.localeCompare(b.id);
  }

  const saleCmp = a.createdAt.localeCompare(b.createdAt);
  if (saleCmp !== 0) return saleCmp;
  if (a.rowid != null && b.rowid != null && a.rowid !== b.rowid) {
    return a.rowid - b.rowid;
  }
  return a.id.localeCompare(b.id);
}
