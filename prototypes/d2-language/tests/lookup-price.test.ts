import { describe, expect, it } from "vitest";
import {
  formatCentavos,
  lookupPrice,
} from "../src/core/lookup-price";
import type { Product } from "../src/core/language";

function makeCatalog(): Product[] {
  return [
    {
      id: "coke-small",
      name: "Coke 200 mL",
      aliases: ["Coke maliit", "Coke sakto"],
      priceCentavos: 1550,
    },
    {
      id: "coke-large",
      name: "Coke 1.5 L",
      aliases: ["Coke malaki"],
      priceCentavos: 7500,
    },
  ];
}

describe("price lookup", () => {
  it.each([
    "Magkano ang Coke sakto?",
    "Magkano po yung Coke sakto?",
    "How much is Coke sakto?",
    "  COKE sakto  ",
  ])("looks up an approved alias: %s", text => {
    expect(lookupPrice(text, makeCatalog())).toEqual({
      kind: "found",
      productId: "coke-small",
      name: "Coke 200 mL",
      priceCentavos: 1550,
      displayPrice: "₱15.50",
    });
  });

  it("supports exact product names containing sizes", () => {
    expect(
      lookupPrice("Magkano ang Coke 1.5 L?", makeCatalog()),
    ).toEqual({
      kind: "found",
      productId: "coke-large",
      name: "Coke 1.5 L",
      priceCentavos: 7500,
      displayPrice: "₱75.00",
    });
  });

  it("does not invent a price for an unknown product", () => {
    expect(
      lookupPrice("Magkano ang mystery drink?", makeCatalog()),
    ).toEqual({
      kind: "unknown",
      query: "mystery drink",
    });
  });

  it("returns choices when an alias collides", () => {
    const catalog = makeCatalog();

    catalog[1].aliases.push("Coke sakto");

    expect(lookupPrice("Coke sakto", catalog)).toEqual({
      kind: "ambiguous",
      query: "coke sakto",
      candidates: [
        { productId: "coke-small", name: "Coke 200 mL" },
        { productId: "coke-large", name: "Coke 1.5 L" },
      ],
    });
  });

  it("uses the current catalog price", () => {
    const catalog = makeCatalog();
    catalog[0].priceCentavos = 1600;

    const result = lookupPrice("Coke sakto", catalog);

    expect(result.kind).toBe("found");

    if (result.kind !== "found") {
      throw new Error("Expected a price.");
    }

    expect(result.priceCentavos).toBe(1600);
    expect(result.displayPrice).toBe("₱16.00");
  });

  it("does not modify the catalog", () => {
    const catalog = makeCatalog();
    const before = JSON.stringify(catalog);

    lookupPrice("Coke sakto", catalog);

    expect(JSON.stringify(catalog)).toBe(before);
  });

  it.each(["", "  ", "Magkano?", "How much?"])(
    "requires a product: %s",
    text => {
      expect(lookupPrice(text, makeCatalog()).kind).toBe("invalid");
    },
  );

  it("rejects an invalid stored price", () => {
    const catalog = makeCatalog();
    catalog[0].priceCentavos = 15.5;

    expect(lookupPrice("Coke sakto", catalog).kind).toBe("invalid");
  });
});

describe("centavo display", () => {
  it.each([
    [0, "₱0.00"],
    [5, "₱0.05"],
    [99, "₱0.99"],
    [100, "₱1.00"],
    [1550, "₱15.50"],
  ])("formats %s centavos", (value, expected) => {
    expect(formatCentavos(value)).toBe(expected);
  });

  it.each([-1, 15.5, Infinity, NaN])(
    "rejects invalid money: %s",
    value => {
      expect(() => formatCentavos(value)).toThrow();
    },
  );
});