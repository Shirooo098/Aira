import { describe, expect, it } from "vitest";
import { correctCart } from "../src/core/correct-cart";
import type { SaleDraft } from "../src/core/language";

function singleItemCart(): SaleDraft {
  return {
    items: [{
      productId: "coke-200ml",
      name: "Coke 200 mL",
      quantity: 2,
    }],
  };
}

function multipleItemCart(): SaleDraft {
  return {
    items: [
      {
        productId: "coke-200ml",
        name: "Coke 200 mL",
        quantity: 2,
      },
      {
        productId: "lucky-me-chicken",
        name: "Lucky Me chicken",
        quantity: 3,
      },
    ],
  };
}

describe("cart corrections", () => {
  it("corrects the only item without requiring selection", () => {
    const result = correctCart(
      "isa lang pala",
      singleItemCart(),
    );

    expect(result).toEqual({
      kind: "updated",
      draft: {
        items: [{
          productId: "coke-200ml",
          name: "Coke 200 mL",
          quantity: 1,
        }],
      },
    });
  });

  it("requires selection when several items exist", () => {
    const draft = multipleItemCart();

    const result = correctCart("isa lang pala", draft);

    expect(result).toEqual({
      kind: "clarify",
      message: "Select which item you want to correct.",
    });

    expect(draft.items.map(item => item.quantity)).toEqual([2, 3]);
  });

  it("changes only the selected item", () => {
    const result = correctCart(
      "isa lang pala",
      multipleItemCart(),
      "lucky-me-chicken",
    );

    expect(result).toEqual({
      kind: "updated",
      draft: {
        items: [
          {
            productId: "coke-200ml",
            name: "Coke 200 mL",
            quantity: 2,
          },
          {
            productId: "lucky-me-chicken",
            name: "Lucky Me chicken",
            quantity: 1,
          },
        ],
      },
    });
  });

  it("does not mutate the original draft", () => {
    const draft = singleItemCart();
    const snapshot = JSON.stringify(draft);

    const result = correctCart("tatlo lang pala", draft);

    expect(JSON.stringify(draft)).toBe(snapshot);

    if (result.kind !== "updated") {
      throw new Error("Expected an updated draft.");
    }

    expect(result.draft).not.toBe(draft);
    expect(result.draft.items[0]).not.toBe(draft.items[0]);
    expect(result.draft.items[0].quantity).toBe(3);
  });

  it("clarifies a stale selection instead of choosing another item", () => {
    const result = correctCart(
      "isa lang pala",
      singleItemCart(),
      "missing-product",
    );

    expect(result.kind).toBe("clarify");
  });

  it("requires an existing cart", () => {
    expect(
      correctCart("isa lang pala", { items: [] }).kind,
    ).toBe("clarify");
  });

  it.each([
    "0 lang pala",
    "-1 lang pala",
    "1.5 lang pala",
    "9007199254740992 lang pala",
  ])("rejects invalid quantities: %s", text => {
    expect(
      correctCart(text, singleItemCart()).kind,
    ).toBe("clarify");
  });

  it.each([
    "confirm sale",
    "dagdag isa",
    "isa",
    "cancel",
  ])("does not interpret unsupported text as a correction: %s", text => {
    expect(correctCart(text, singleItemCart())).toEqual({
      kind: "unsupported",
    });
  });

  it("repeating the correction replaces rather than adds", () => {
    const first = correctCart("isa lang pala", singleItemCart());

    if (first.kind !== "updated") {
      throw new Error("Expected an updated draft.");
    }

    const second = correctCart("isa lang pala", first.draft);

    expect(second).toEqual(first);
  });
});