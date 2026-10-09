import {
  normalize,
  resolveProduct,
  type Product,
} from "./language";

export type PriceLookupResult =
  | {
      kind: "found";
      productId: string;
      name: string;
      priceCentavos: number;
      displayPrice: string;
    }
  | {
      kind: "ambiguous";
      query: string;
      candidates: Array<{
        productId: string;
        name: string;
      }>;
    }
  | {
      kind: "unknown";
      query: string;
    }
  | {
      kind: "invalid";
      message: string;
    };

// Format integer centavos without decimal money calculations.
export function formatCentavos(value: number): string {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Price must be nonnegative integer centavos.");
  }

  const digits = String(value).padStart(3, "0");
  const pesos = digits.slice(0, -2);
  const centavos = digits.slice(-2);

  return "₱" + pesos + "." + centavos;
}

export function lookupPrice(
  text: string,
  catalog: readonly Product[],
): PriceLookupResult {
  const normalized = normalize(text)
    .replace(/[.!?]+$/, "");

  // Supported examples:
  // "Magkano ang Coke maliit?"
  // "Magkano po yung Coke maliit?"
  // "How much is Coke maliit?"
  // "Coke maliit"
  const query = normalized
    .replace(
      /^magkano(?: po)?(?: (?:ang|yung|iyong))?\s+/,
      "",
    )
    .replace(
      /^how much(?: is)?(?: the)?\s+/,
      "",
    )
    .trim();

  if (!query || /^(magkano(?: po)?|how much)$/.test(query)) {
    return {
      kind: "invalid",
      message: "Specify the product whose price you want.",
    };
  }

  if (query.length > 120) {
    return {
      kind: "invalid",
      message: "Please shorten the product query.",
    };
  }

  const matches = resolveProduct(query, catalog);

  if (matches.length === 0) {
    return { kind: "unknown", query };
  }

  if (matches.length > 1) {
    return {
      kind: "ambiguous",
      query,
      candidates: matches.map(product => ({
        productId: product.id,
        name: product.name,
      })),
    };
  }

  const product = matches[0];

  if (
    !Number.isSafeInteger(product.priceCentavos) ||
    product.priceCentavos < 0
  ) {
    return {
      kind: "invalid",
      message: "This product has an invalid catalog price.",
    };
  }

  return {
    kind: "found",
    productId: product.id,
    name: product.name,
    priceCentavos: product.priceCentavos,
    displayPrice: formatCentavos(product.priceCentavos),
  };
}