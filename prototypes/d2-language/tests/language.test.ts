import { describe, expect, it } from "vitest";
import { interpretOrder, type Product } from "../src/core/language";

const catalog: Product[] = [{
  id: "coke-small",
  name: "Coke 200 mL",
  aliases: ["Coke maliit"],
  priceCentavos: 1500,
}];

describe("order interpretation", () => {
  it("resolves an approved alias into a proposed line", async () => {
    const result = await interpretOrder("test", catalog, {
      extract: async () => ({
        intent: "sale",
        items: [{ query: "Coke maliit", quantity: 2 }],
      }),
    });

    expect(result).toEqual({
      kind: "draft",
      draft: {
        items: [{
          productId: "coke-small",
          name: "Coke 200 mL",
          quantity: 2,
        }],
      },
    });
  });

  it("asks for clarification for an unknown product", async () => {
    const result = await interpretOrder("test", catalog, {
      extract: async () => ({
        intent: "sale",
        items: [{ query: "Unknown drink", quantity: 1 }],
      }),
    });

    expect(result.kind).toBe("clarify");
  });

  it("rejects a malformed model quantity", async () => {
    await expect(interpretOrder("test", catalog, {
      extract: async () => ({
        intent: "sale",
        items: [{ query: "Coke maliit", quantity: -2 }],
      }),
    })).rejects.toThrow();
  });

  it("handles an explicit quantity without calling the model", async () => {
  const result = await interpretOrder(
    "Pabili ng tatlong Coke maliit",
    catalog,
    {
      extract: async () => {
        throw new Error("Model should not be called.");
      },
    },
  );

  expect(result).toEqual({
    kind: "draft",
    draft: {
      items: [{
        productId: "coke-small",
        name: "Coke 200 mL",
        quantity: 3,
      }],
    },
  });
});

    it("asks for missing quantity without letting the model guess", async () => {
    const result = await interpretOrder(
        "Pabili ng Coke maliit",
        catalog,
        {
        extract: async () => {
            throw new Error("Model should not be called.");
        },
        },
    );

    expect(result.kind).toBe("clarify");
    });
});