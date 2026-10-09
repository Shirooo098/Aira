import { describe, expect, it } from "vitest";
import { routeInput } from "../src/core/route-input";
import { createSession, switchMode, type Session } from "../src/core/session";
import type { Product } from "../src/core/language";

const catalog: Product[] = [
  {
    id: "coke",
    name: "Coke 200 mL",
    aliases: ["Coke maliit"],
    priceCentavos: 1500,
  },
  {
    id: "noodles",
    name: "Lucky Me chicken",
    aliases: [],
    priceCentavos: 1500,
  },
];

const noModel = {
  extract: async (): Promise<unknown> => {
    throw new Error("This supported flow must not call the model.");
  },
};

describe("mode routing", () => {
  it("looks up a price in Ask price without creating a cart", async () => {
    const session = createSession();

    const result = await routeInput(
      "Magkano ang Coke maliit?",
      session,
      catalog,
      noModel,
    );

    expect(result.price?.kind).toBe("found");
    expect(result.message).toBe("Coke 200 mL: ₱15.00");
    expect(result.session).toBe(session);
    expect(result.session.draft).toBeNull();
  });

  it("does not create a sale from an order in Ask price", async () => {
    const result = await routeInput(
      "Dalawang Coke maliit",
      createSession(),
      catalog,
      noModel,
    );

    expect(result.session.draft).toBeNull();
  });

  it("prepares a draft in Sell", async () => {
    const session = switchMode(createSession(), "sell");

    const result = await routeInput(
      "Dalawang Coke maliit",
      session,
      catalog,
      noModel,
    );

    expect(result.session.draft).toEqual({
      items: [{
        productId: "coke",
        name: "Coke 200 mL",
        quantity: 2,
      }],
    });

    expect(session.draft).toBeNull();
  });

  it("blocks price questions in Sell", async () => {
    const session = switchMode(createSession(), "sell");

    const result = await routeInput(
      "Magkano ang Coke maliit?",
      session,
      catalog,
      noModel,
    );

    expect(result.message).toBe(
      "Switch to Ask price for price questions.",
    );
    expect(result.session).toBe(session);
  });

  it("corrects the single item in the current cart", async () => {
    const session: Session = {
      mode: "sell",
      selectedProductId: null,
      draft: {
        items: [{
          productId: "coke",
          name: "Coke 200 mL",
          quantity: 2,
        }],
      },
    };

    const result = await routeInput(
      "isa lang pala",
      session,
      catalog,
      noModel,
    );

    expect(result.session.draft?.items[0].quantity).toBe(1);
    expect(session.draft?.items[0].quantity).toBe(2);
  });

  it("preserves a multi-item cart when the correction target is unclear", async () => {
    const session: Session = {
      mode: "sell",
      selectedProductId: null,
      draft: {
        items: [
          { productId: "coke", name: "Coke 200 mL", quantity: 2 },
          { productId: "noodles", name: "Lucky Me chicken", quantity: 3 },
        ],
      },
    };

    const result = await routeInput(
      "isa lang pala",
      session,
      catalog,
      noModel,
    );

    expect(result.message).toBe(
      "Select which item you want to correct.",
    );
    expect(result.session).toBe(session);
  });

  it("does not silently replace an existing cart", async () => {
    const session: Session = {
      mode: "sell",
      selectedProductId: null,
      draft: {
        items: [{
          productId: "coke",
          name: "Coke 200 mL",
          quantity: 2,
        }],
      },
    };

    const result = await routeInput(
      "Tatlong Lucky Me chicken",
      session,
      catalog,
      noModel,
    );

    expect(result.session).toBe(session);
    expect(result.session.draft?.items[0].productId).toBe("coke");
  });

  it("does not prepare sales in Manage products", async () => {
    const session = switchMode(createSession(), "manage-products");

    const result = await routeInput(
      "Dalawang Coke maliit",
      session,
      catalog,
      noModel,
    );

    expect(result.session).toBe(session);
    expect(result.session.draft).toBeNull();
  });

  it("requires a cart before applying a correction", async () => {
    const session = switchMode(createSession(), "sell");

    const result = await routeInput(
      "isa lang pala",
      session,
      catalog,
      noModel,
    );

    expect(result.message).toBe(
      "There is no current cart to correct.",
    );
    expect(result.session).toBe(session);
  });
});