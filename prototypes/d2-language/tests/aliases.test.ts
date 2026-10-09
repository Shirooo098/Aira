import { describe, expect, it } from "vitest";
import { approveAlias, proposeAlias } from "../src/core/aliases";
import { resolveProduct, type Product } from "../src/core/language";

function makeCatalog(): Product[] {
  return [
    {
      id: "coke-small",
      name: "Coke 200 mL",
      aliases: ["Coke maliit"],
      priceCentavos: 1500,
    },
    {
      id: "coke-large",
      name: "Coke 1.5 L",
      aliases: ["Coke malaki"],
      priceCentavos: 7500,
    },
  ];
}

describe("owner-reviewed aliases", () => {
  it("shows the exact product in the proposal", () => {
    expect(
      proposeAlias("  COKE sakto  ", "coke-small", makeCatalog()),
    ).toEqual({
      kind: "review",
      proposal: {
        alias: "coke sakto",
        productId: "coke-small",
        productName: "Coke 200 mL",
      },
    });
  });

  it("does not teach an alias before approval", () => {
    const catalog = makeCatalog();
    const before = JSON.stringify(catalog);

    proposeAlias("Coke sakto", "coke-small", catalog);

    expect(JSON.stringify(catalog)).toBe(before);
    expect(resolveProduct("Coke sakto", catalog)).toEqual([]);
  });

  it("makes an approved alias available to lookup", () => {
    const catalog = makeCatalog();
    const proposed = proposeAlias("Coke sakto", "coke-small", catalog);

    if (proposed.kind !== "review") {
      throw new Error("Expected a review proposal.");
    }

    const approved = approveAlias(proposed.proposal, catalog);

    if (approved.kind !== "approved") {
      throw new Error("Expected approval.");
    }

    expect(
      resolveProduct("Coke sakto", approved.catalog)
        .map(product => product.id),
    ).toEqual(["coke-small"]);

    // Original catalog remains unchanged.
    expect(resolveProduct("Coke sakto", catalog)).toEqual([]);
  });

  it("does not duplicate the same approved mapping", () => {
    const catalog = makeCatalog();
    const proposed = proposeAlias("Coke maliit", "coke-small", catalog);

    if (proposed.kind !== "review") {
      throw new Error("Expected a review proposal.");
    }

    const approved = approveAlias(proposed.proposal, catalog);

    if (approved.kind !== "approved") {
      throw new Error("Expected approval.");
    }

    expect(approved.catalog[0].aliases).toEqual(["Coke maliit"]);
  });

  it("preserves collisions as ambiguous lookup choices", () => {
    const catalog = makeCatalog();
    const proposed = proposeAlias("Coke maliit", "coke-large", catalog);

    if (proposed.kind !== "review") {
      throw new Error("Expected a review proposal.");
    }

    const approved = approveAlias(proposed.proposal, catalog);

    if (approved.kind !== "approved") {
      throw new Error("Expected approval.");
    }

    expect(
      resolveProduct("Coke maliit", approved.catalog)
        .map(product => product.id),
    ).toEqual(["coke-small", "coke-large"]);
  });

  it("rejects a product that disappeared before approval", () => {
    const proposed = proposeAlias(
      "Coke sakto",
      "coke-small",
      makeCatalog(),
    );

    if (proposed.kind !== "review") {
      throw new Error("Expected a review proposal.");
    }

    expect(approveAlias(proposed.proposal, []).kind).toBe("error");
  });

  it("requires another review when the product name changes", () => {
    const catalog = makeCatalog();
    const proposed = proposeAlias("Coke sakto", "coke-small", catalog);

    if (proposed.kind !== "review") {
      throw new Error("Expected a review proposal.");
    }

    const changed = catalog.map(product => ({
      ...product,
      name:
        product.id === "coke-small"
          ? "Coke 250 mL"
          : product.name,
    }));

    expect(approveAlias(proposed.proposal, changed).kind).toBe("error");
  });

  it.each(["", "   ", "x".repeat(121)])(
    "rejects an invalid alias",
    alias => {
      expect(
        proposeAlias(alias, "coke-small", makeCatalog()).kind,
      ).toBe("error");
    },
  );
});