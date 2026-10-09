import { z } from "zod";
import { parseSimpleOrder } from "./parse-simple-order";

export type Product = {
  id: string;
  name: string;
  aliases: string[]; // Already owner-approved mappings.
  priceCentavos: number;
};

// The model extracts names, not authoritative product IDs or prices.
export const ExtractionSchema = z.object({
  intent: z.enum(["sale", "clarify", "unsupported"]),
  items: z.array(
    z.object({
      query: z.string().trim().min(1).max(120),
      quantity: z.number().int().positive().nullable(),
    }).strict(),
  ).max(20),
}).strict();

export interface LanguageModel {
  extract(text: string): Promise<unknown>;
}

export type SaleDraft = {
  items: Array<{
    productId: string;
    name: string;
    quantity: number;
  }>;
};

export type Interpretation =
  | { kind: "draft"; draft: SaleDraft }
  | { kind: "clarify"; message: string }
  | { kind: "unsupported" };

export function normalize(text: string): string {
  return text.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveProduct(
  query: string,
  catalog: readonly Product[],
): Product[] {
  const key = normalize(query);

  return catalog.filter(product =>
    [product.name, ...product.aliases]
      .some(name => normalize(name) === key),
  );
}

export async function interpretOrder(
  text: string,
  catalog: readonly Product[],
  model: LanguageModel,
): Promise<Interpretation> {
  if (!text.trim()) {
    return { kind: "clarify", message: "Enter an order." };
  }

  if (text.length > 1000) {
    return { kind: "clarify", message: "Please shorten the order." };
  }

    const simpleResult = parseSimpleOrder(text, catalog);

    const extraction = ExtractionSchema.parse(
    simpleResult ?? await model.extract(text),
    );
    
  if (extraction.intent === "unsupported") {
    return { kind: "unsupported" };
  }

  if (extraction.intent === "clarify" || !extraction.items.length) {
    return {
      kind: "clarify",
      message: "Please specify the products and quantities.",
    };
  }

  const items: SaleDraft["items"] = [];

  for (const item of extraction.items) {
    if (item.quantity === null) {
      return {
        kind: "clarify",
        message: `How many ${item.query}?`,
      };
    }

    const matches = resolveProduct(item.query, catalog);

    if (matches.length === 0) {
      return {
        kind: "clarify",
        message: `Unknown product: ${item.query}`,
      };
    }

    if (matches.length > 1) {
      return {
        kind: "clarify",
        message: `Choose the product for "${item.query}": ${
          matches.map(product => product.name).join(", ")
        }`,
      };
    }

    const product = matches[0];
    const existing = items.find(line => line.productId === product.id);

    if (existing) {
      const quantity = existing.quantity + item.quantity;
      if (!Number.isSafeInteger(quantity)) {
        throw new Error("Invalid combined quantity.");
      }
      existing.quantity = quantity;
    } else {
      if (!Number.isSafeInteger(item.quantity)) {
        throw new Error("Invalid quantity.");
      }

      items.push({
        productId: product.id,
        name: product.name,
        quantity: item.quantity,
      });
    }
  }

  return { kind: "draft", draft: { items } };
}