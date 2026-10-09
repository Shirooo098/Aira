export class SaleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SaleValidationError';
  }
}

export class InsufficientStockError extends Error {
  public readonly insufficientItems: Array<{
    productId: string;
    productName: string;
    requestedQuantity: number;
    availableStock: number | null;
  }>;

  constructor(
    message: string,
    insufficientItems: Array<{
      productId: string;
      productName: string;
      requestedQuantity: number;
      availableStock: number | null;
    }> = []
  ) {
    super(message);
    this.name = 'InsufficientStockError';
    this.insufficientItems = insufficientItems;
  }
}

export function calculateSubtotal(quantity: number, unitPriceCentavos: number): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    throw new SaleValidationError('Dapat buong numero at higit sa zero ang dami ng binibili');
  }
  if (!Number.isSafeInteger(unitPriceCentavos) || unitPriceCentavos < 0) {
    throw new SaleValidationError('Dapat buong numero at hindi negatibo ang presyo');
  }
  const subtotal = quantity * unitPriceCentavos;
  if (!Number.isSafeInteger(subtotal)) {
    throw new SaleValidationError('Lumagpas sa limitasyon ang subtotal ng aytem');
  }
  return subtotal;
}

export function calculateSaleTotal(items: Array<{ subtotalCentavos: number }>): number {
  let total = 0;
  for (const item of items) {
    if (!Number.isSafeInteger(item.subtotalCentavos) || item.subtotalCentavos < 0) {
      throw new SaleValidationError('Dapat buong numero at hindi negatibo ang subtotal');
    }
    total += item.subtotalCentavos;
  }
  if (!Number.isSafeInteger(total)) {
    throw new SaleValidationError('Lumagpas sa limitasyon ang kabuuang halaga ng benta');
  }
  return total;
}

export function calculateChange(totalCentavos: number, tenderCentavos: number): number {
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 0) {
    throw new SaleValidationError('Dapat buong numero at hindi negatibo ang kabuuang halaga');
  }
  if (!Number.isSafeInteger(tenderCentavos) || tenderCentavos < 0) {
    throw new SaleValidationError('Dapat buong numero at hindi negatibo ang bayad');
  }
  if (tenderCentavos < totalCentavos) {
    throw new SaleValidationError('Kulang ang bayad para sa kabuuang halaga');
  }
  return tenderCentavos - totalCentavos;
}

export function generateSaleId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `sale_${timestamp}_${randomPart}`;
}

export function generateSaleItemId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `item_${timestamp}_${randomPart}`;
}
