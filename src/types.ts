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
