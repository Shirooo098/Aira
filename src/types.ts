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
