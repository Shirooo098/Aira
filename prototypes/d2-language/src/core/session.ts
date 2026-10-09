import type { SaleDraft } from "./language";

export type Mode = "ask-price" | "sell" | "manage-products";

export type Session = {
  mode: Mode;
  draft: SaleDraft | null;
  selectedProductId: string | null;
};

export function createSession(): Session {
  return {
    mode: "ask-price",
    draft: null,
    selectedProductId: null,
  };
}

export function switchMode(
  session: Session,
  mode: Mode,
): Session {
  if (session.mode === mode) {
    return session;
  }

  return {
    mode,
    draft: null,
    selectedProductId: null,
  };
}