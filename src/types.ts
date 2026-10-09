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

export interface Sale {
  id: string;
  totalCentavos: number;
  paymentMethod: PaymentMethod;
  tenderCentavos: number;
  changeCentavos: number;
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

