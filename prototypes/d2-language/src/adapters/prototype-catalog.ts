import { fileURLToPath } from "node:url";

import type { Product } from "../core/language";
import { JsonCatalogStore } from "./json-catalog-store";

const seedCatalog: Product[] = [
  {
    id: "coke-200ml",
    name: "Coke 200 mL",
    aliases: ["Coke maliit"],
    priceCentavos: 1500,
  },
  {
    id: "coke-1500ml",
    name: "Coke 1.5 L",
    aliases: ["Coke malaki"],
    priceCentavos: 7500,
  },
  {
    id: "lucky-me-chicken",
    name: "Lucky Me chicken",
    aliases: [],
    priceCentavos: 1500,
  },
];

const catalogPath = fileURLToPath(
  new URL("../../data/catalog.json", import.meta.url),
);

export const prototypeCatalogStore = new JsonCatalogStore(
  catalogPath,
  seedCatalog,
);