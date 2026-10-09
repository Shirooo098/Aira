import { describe, expect, it } from "vitest";
import {
  createSession,
  switchMode,
  type Session,
} from "../src/core/session";

describe("session modes", () => {
  it("starts in Ask price with no draft", () => {
    expect(createSession()).toEqual({
      mode: "ask-price",
      draft: null,
      selectedProductId: null,
    });
  });

  it("clears the cart and selection when changing modes", () => {
    const session: Session = {
      mode: "sell",
      draft: {
        items: [{
          productId: "coke-200ml",
          name: "Coke 200 mL",
          quantity: 2,
        }],
      },
      selectedProductId: "coke-200ml",
    };

    expect(switchMode(session, "ask-price")).toEqual({
      mode: "ask-price",
      draft: null,
      selectedProductId: null,
    });

    expect(session.draft?.items[0].quantity).toBe(2);
  });

  it("preserves state when selecting the current mode", () => {
    const session = createSession();

    expect(switchMode(session, "ask-price")).toBe(session);
  });
});