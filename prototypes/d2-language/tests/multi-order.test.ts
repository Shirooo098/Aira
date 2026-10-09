import { describe, expect, it } from "vitest";
import { interpretOrder, type Product } from "../src/core/language";
import { parseSimpleOrder } from "../src/core/parse-simple-order";

const catalog: Product[] = [
  { id: "coke", name: "Coke 200 mL", aliases: ["Coke maliit"], priceCentavos: 1500 },
  { id: "large", name: "Coke 1.5 L", aliases: ["Coke malaki"], priceCentavos: 7500 },
  { id: "noodles", name: "Lucky Me chicken", aliases: [], priceCentavos: 1500 },
];
const noModel = {
  extract: async (): Promise<unknown> => {
    throw new Error("Supported orders must not call the model.");
  },
};

describe("multiple-item order interpretation", () => {
  it.each(["at", "and", ","])("keeps item quantities separate with %s", async separator => {
    expect(await interpretOrder(
      "Pabili ng isang Coke maliit " + separator + " dalawang Lucky Me chicken",
      catalog,
      noModel,
    )).toEqual({
      kind: "draft",
      draft: { items: [
        { productId: "coke", name: "Coke 200 mL", quantity: 1 },
        { productId: "noodles", name: "Lucky Me chicken", quantity: 2 },
      ] },
    });
  });

  it("clarifies a missing quantity instead of returning a partial cart", async () => {
    expect(await interpretOrder(
      "Isang Coke maliit at Lucky Me chicken", catalog, noModel,
    )).toEqual({ kind: "clarify", message: "How many lucky me chicken?" });
  });

  it("clarifies an unknown product without asking the model to guess", async () => {
    expect(await interpretOrder(
      "Isang Coke maliit at dalawang unknown drink", catalog, noModel,
    )).toEqual({ kind: "clarify", message: "Unknown product: unknown drink" });
  });

  it("clarifies an unknown single item", async () => {
    expect(await interpretOrder("Isang unknown drink", catalog, noModel)).toEqual({
      kind: "clarify", message: "Unknown product: unknown drink",
    });
  });

  it("combines repeated products through their aliases and catalog names", async () => {
    expect(await interpretOrder(
      "Dalawang Coke maliit at isang Coke 200 mL", catalog, noModel,
    )).toEqual({
      kind: "draft",
      draft: { items: [{ productId: "coke", name: "Coke 200 mL", quantity: 3 }] },
    });
  });

  it("keeps a product size separate from a missing quantity", async () => {
    expect(await interpretOrder(
      "Isang Coke maliit at Coke 1.5 L", catalog, noModel,
    )).toEqual({ kind: "clarify", message: "How many coke 1.5 l?" });
  });

  it("clarifies alias collisions", async () => {
    const ambiguous = [...catalog, {
      id: "other", name: "Other Coke", aliases: ["Coke maliit"], priceCentavos: 2000,
    }];
    const result = await interpretOrder(
      "Isang Coke maliit at dalawang Lucky Me chicken", ambiguous, noModel,
    );
    expect(result.kind).toBe("clarify");
    if (result.kind === "clarify") expect(result.message).toContain("Choose the product");
  });

  it.each([
    "Isang Coke maliit at",
    "Isang Coke maliit,,dalawang Lucky Me chicken",
    "Isang Coke maliit at 0 Lucky Me chicken",
    "Isang Coke maliit at -2 Lucky Me chicken",
    "Isang Coke maliit at 1.5 Lucky Me chicken",
    "Isang Coke maliit at mystery wording",
  ])("clarifies malformed or incomplete orders: %s", async text => {
    expect((await interpretOrder(text, catalog, noModel)).kind).toBe("clarify");
  });

  it("preserves a catalog name containing a separator", () => {
    const namedProduct = [{ name: "Salt and Pepper", aliases: [] }];
    expect(parseSimpleOrder("Isang Salt and Pepper", namedProduct)).toEqual({
      intent: "sale", items: [{ query: "salt and pepper", quantity: 1 }],
    });
  });

  it("leaves unrelated single requests to the existing model adapter", async () => {
    let called = false;
    const result = await interpretOrder("Explain my report", catalog, {
      extract: async () => {
        called = true;
        return { intent: "unsupported", items: [] };
      },
    });
    expect(called).toBe(true);
    expect(result).toEqual({ kind: "unsupported" });
  });
});
