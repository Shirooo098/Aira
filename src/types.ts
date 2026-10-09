export interface Product {
  id: string;
  name: string;
  variant: string;
  unit: string;
  priceCentavos: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDraft {
  name: string;
  variant: string;
  unit: string;
  priceCentavos: number;
}

export type LookupResult =
  | { kind: 'empty' }
  | { kind: 'exact'; product: Product }
  | { kind: 'ambiguous'; query: string; products: Product[] }
  | { kind: 'unknown'; query: string };

export type AppMode = 'ask-price' | 'sell' | 'manage';

export interface StockLevel {
  productId: string;
  quantity: number;
  updatedAt: string;
}

export type InventoryMovementType =
  | 'set_count'
  | 'add_delivery'
  | 'sale_deduction'
  | 'sale_cancellation';

export interface InventoryMovement {
  id: string;
  productId: string;
  movementType: InventoryMovementType;
  quantityDelta: number;
  previousQuantity: number | null;
  newQuantity: number;
  note: string | null;
  createdAt: string;
}

export type ProductWithStock = Product & {
  quantity: number | null;
  stockUpdatedAt: string | null;
};

export interface StockPreview {
  productId: string;
  movementType: 'set_count' | 'add_delivery';
  previousQuantity: number | null;
  inputQuantity: number;
  newQuantity: number;
  quantityDelta: number | null;
  unit: string;
}

export type PaymentMethod = 'cash' | 'gcash';

export interface SaleItemDraft {
  productId: string;
  quantity: number;
}

export interface SaleDraft {
  items: SaleItemDraft[];
  tenderCentavos?: number;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  productVariant: string;
  productUnit: string;
  unitPriceCentavos: number;
  quantity: number;
  subtotalCentavos: number;
}

export interface PendingGcashDraft {
  id: string;
  totalCentavos: number;
  referenceNumber: string | null;
  customerNote: string | null;
  items: Array<{ productId: string; quantity: number }>;
  status: 'pending' | 'confirmed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  name: string;
  nickname?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CreditEntryType = 'sale_credit' | 'opening_balance';

export interface CreditEntry {
  id: string;
  customerId: string;
  entryType: CreditEntryType;
  saleId?: string | null;
  originalAmountCentavos: number;
  remainingAmountCentavos: number;
  description?: string | null;
  originalDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type CustomerWithBalance = Customer & {
  totalDebtCentavos: number;
  activeCreditCount: number;
};

export interface Sale {
  id: string;
  customerId?: string | null;
  totalCentavos: number;
  paymentMethod: PaymentMethod;
  tenderCentavos: number;
  changeCentavos: number;
  paidCentavos: number;
  creditCentavos: number;
  referenceNumber?: string | null;
  createdAt: string;
  items: SaleItem[];
}

export interface SalePreviewItem {
  productId: string;
  name: string;
  variant: string;
  unit: string;
  unitPriceCentavos: number;
  quantity: number;
  subtotalCentavos: number;
  availableStock: number | null;
  hasSufficientStock: boolean;
}

export interface SalePreview {
  items: SalePreviewItem[];
  totalCentavos: number;
  tenderCentavos: number;
  changeCentavos: number;
  canComplete: boolean;
  insufficientStockItems: string[];
}

