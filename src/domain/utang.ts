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
