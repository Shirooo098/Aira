import type { Product } from "./language";

export interface CatalogStore {
  load(): Promise<Product[]>;
  save(catalog: readonly Product[]): Promise<void>;
}