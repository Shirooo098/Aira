import { correctCart } from "./correct-cart";
import {
  interpretOrder,
  type LanguageModel,
  type Product,
} from "./language";
import { lookupPrice, type PriceLookupResult } from "./lookup-price";
import type { Session } from "./session";

export type RoutedInput = {
  session: Session;
  message: string;
  price?: PriceLookupResult;
};

function describePrice(result: PriceLookupResult): string {
  switch (result.kind) {
    case "found":
      return result.name + ": " + result.displayPrice;

    case "ambiguous":
      return "Choose a product: " +
        result.candidates.map(item => item.name).join(", ");

    case "unknown":
      return "Unknown product: " + result.query;

    case "invalid":
      return result.message;
  }
}

export async function routeInput(
  text: string,
  session: Session,
  catalog: readonly Product[],
  model: LanguageModel,
): Promise<RoutedInput> {
  if (!text.trim()) {
    return {
      session,
      message: "Enter a request.",
    };
  }

  if (session.mode === "ask-price") {
    const price = lookupPrice(text, catalog);

    return {
      session,
      message: describePrice(price),
      price,
    };
  }

  if (session.mode === "manage-products") {
    return {
      session,
      message:
        "Use the alias review flow to select a product and approve an alias. Text alone does not save changes.",
    };
  }

  // From here onward, the active mode is Sell.
  const correction = correctCart(
    text,
    session.draft ?? { items: [] },
    session.selectedProductId ?? undefined,
  );

  if (correction.kind === "updated") {
    return {
      session: {
        ...session,
        draft: correction.draft,
      },
      message: "Cart updated. Review it before checkout.",
    };
  }

  if (correction.kind === "clarify") {
    return {
      session,
      message: correction.message,
    };
  }

  // Do not reinterpret an unsupported correction as a new order.
  if (/\bpala\b/i.test(text)) {
    return {
      session,
      message:
        'That correction is unsupported. Try "isa lang pala" after selecting an item.',
    };
  }

  if (/^\s*(magkano\b|how much\b)/i.test(text)) {
    return {
      session,
      message: "Switch to Ask price for price questions.",
    };
  }

  // This milestone supports one active cart.
  // Do not silently replace it with a new order.
  if (session.draft !== null) {
    return {
      session,
      message:
        "A cart is already open. Correct it or discard it before starting another order.",
    };
  }

  const result = await interpretOrder(text, catalog, model);

  if (result.kind === "draft") {
    return {
      session: {
        ...session,
        draft: result.draft,
        selectedProductId: null,
      },
      message: "Cart prepared. Review it before checkout.",
    };
  }

  if (result.kind === "clarify") {
    return {
      session,
      message: result.message,
    };
  }

  return {
    session,
    message: "This request is unsupported in Sell mode.",
  };
}