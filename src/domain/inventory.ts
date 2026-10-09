export class StockValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockValidationError';
  }
}

export function validateStockQuantity(quantity: unknown, fieldName?: string): number {
  const prefix = fieldName ? `${fieldName}: ` : '';

  if (quantity === null || quantity === undefined) {
    throw new StockValidationError(`${prefix}Kailangang maglagay ng bilang ng stock`);
  }

  let num: number;
  if (typeof quantity === 'number') {
    num = quantity;
  } else if (typeof quantity === 'string') {
    const trimmed = quantity.trim();
    if (trimmed.length === 0) {
      throw new StockValidationError(`${prefix}Kailangang maglagay ng bilang ng stock`);
    }
    if (!/^-?\d+$/.test(trimmed)) {
      throw new StockValidationError(`${prefix}Dapat buong numero (integer) ang bilang ng stock`);
    }
    num = Number(trimmed);
  } else {
    throw new StockValidationError(`${prefix}Dapat buong numero (integer) ang bilang ng stock`);
  }

  if (!Number.isSafeInteger(num)) {
    throw new StockValidationError(`${prefix}Dapat buong numero (integer) ang bilang ng stock`);
  }

  if (num < 0) {
    throw new StockValidationError(`${prefix}Hindi maaaring negatibo ang bilang ng stock`);
  }

  return num;
}

export function validateDeliveryQuantity(quantity: unknown, fieldName?: string): number {
  const prefix = fieldName ? `${fieldName}: ` : '';

  if (quantity === null || quantity === undefined) {
    throw new StockValidationError(`${prefix}Kailangang maglagay ng dami ng delivery`);
  }

  let num: number;
  if (typeof quantity === 'number') {
    num = quantity;
  } else if (typeof quantity === 'string') {
    const trimmed = quantity.trim();
    if (trimmed.length === 0) {
      throw new StockValidationError(`${prefix}Kailangang maglagay ng dami ng delivery`);
    }
    if (!/^-?\d+$/.test(trimmed)) {
      throw new StockValidationError(`${prefix}Dapat buong numero (integer) ang dami ng delivery`);
    }
    num = Number(trimmed);
  } else {
    throw new StockValidationError(`${prefix}Dapat buong numero (integer) ang dami ng delivery`);
  }

  if (!Number.isSafeInteger(num)) {
    throw new StockValidationError(`${prefix}Dapat buong numero (integer) ang dami ng delivery`);
  }

  if (num <= 0) {
    throw new StockValidationError(`${prefix}Dapat higit sa zero ang dami ng delivery`);
  }

  return num;
}

export function generateMovementId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `mov_${timestamp}_${randomPart}`;
}
