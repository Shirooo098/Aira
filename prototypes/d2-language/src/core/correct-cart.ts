import type { SaleDraft } from "./language";

export type CorrectionResult =
  | { kind: "updated"; draft: SaleDraft }
  | { kind: "clarify"; message: string }
  | { kind: "unsupported" };

const quantityWords: Record<string, number> = {
  isa: 1,
  isang: 1,
  dalawa: 2,
  dalawang: 2,
  tatlo: 3,
  tatlong: 3,
  apat: 4,
  lima: 5,
  limang: 5,
};

export function correctCart(
  text: string,
  draft: SaleDraft,
  selectedProductId?: string,
): CorrectionResult {
  const phrase = text
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");

  // Bounded correction syntax:
  // "isa lang pala", "tatlo lang pala", "2 lang pala".
  const match = phrase.match(
    /^(isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|limang|[+-]?\d+(?:\.\d+)?) lang pala$/,
  );

  if (!match) {
    return { kind: "unsupported" };
  }

  const quantityText = match[1];
  const quantity =
    quantityWords[quantityText] ?? Number(quantityText);

  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return {
      kind: "clarify",
      message: "Use a positive whole-piece quantity.",
    };
  }

  if (draft.items.length === 0) {
    return {
      kind: "clarify",
      message: "There is no current cart to correct.",
    };
  }

  let targetProductId: string;

  if (selectedProductId !== undefined) {
    const matches = draft.items.filter(
      item => item.productId === selectedProductId,
    );

    if (matches.length !== 1) {
      return {
        kind: "clarify",
        message: "Select an item that exists once in the current cart.",
      };
    }

    targetProductId = selectedProductId;
  } else if (draft.items.length === 1) {
    targetProductId = draft.items[0].productId;
  } else {
    return {
      kind: "clarify",
      message: "Select which item you want to correct.",
    };
  }

  // Return a new draft. Do not mutate the existing one.
  return {
    kind: "updated",
    draft: {
      items: draft.items.map(item => ({
        ...item,
        quantity:
          item.productId === targetProductId
            ? quantity
            : item.quantity,
      })),
    },
  };
}