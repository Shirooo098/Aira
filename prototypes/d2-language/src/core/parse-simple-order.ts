type CatalogEntry = {
  name: string;
  aliases: readonly string[];
};

type Extraction = {
  intent: "sale" | "clarify";
  items: Array<{
    query: string;
    quantity: number | null;
  }>;
};

const quantities: Record<string, number> = {
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

const normalizeName = (value: string) =>
  value.normalize("NFC").trim().toLowerCase().replace(/\s+/g, " ");

// null means this parser does not handle the single request.
export function parseSimpleOrder(
  text: string,
  catalog: readonly CatalogEntry[],
): Extraction | null {
  const phrase = normalizeName(text)
    .replace(/[.!?]+$/, "")
    .replace(/^pabili(?: po)? ng\s+/, "");

  if (/\bpala\b/.test(phrase)) return null;

  const isKnownProduct = (query: string) =>
    catalog.some(product =>
      [product.name, ...product.aliases]
        .some(name => normalizeName(name) === query),
    );

  const clarify = (): Extraction => ({ intent: "clarify", items: [] });

  function parseItem(part: string): Extraction | null {
    // Product sizes and numeric brand names are not quantities.
    if (isKnownProduct(part)) {
      return { intent: "sale", items: [{ query: part, quantity: null }] };
    }

    const match = part.match(
      /^(isa|isang|dalawa|dalawang|tatlo|tatlong|apat|lima|limang|\d+)(?:\s+na)?\s+(.+)$/,
    );

    if (!match) {
      // Unsupported numeric quantities need clarification, not model guessing.
      if (/^[+-]?\d+(?:[.,]\d+)?(?:\s+na)?\s+/.test(part)) return clarify();
      return null;
    }

    const [, quantityText, query] = match;
    const quantity = quantities[quantityText] ?? Number(quantityText);
    if (!Number.isSafeInteger(quantity) || quantity <= 0) return clarify();

    // Keep unknown names unchanged for the shared resolver to clarify.
    return { intent: "sale", items: [{ query, quantity }] };
  }

  const whole = parseItem(phrase);
  const separator = /\s*,\s*|\s*\b(?:at|and)\b\s*/;

  if (!separator.test(phrase)) return whole;

  // Prefer an exact complete catalog match before treating conjunctions as joins.
  if (
    whole?.intent === "sale" &&
    isKnownProduct(whole.items[0].query)
  ) {
    return whole;
  }

  const parts = phrase.split(separator);
  if (parts.length > 20 || parts.some(part => !part.trim())) return clarify();

  const items: Extraction["items"] = [];
  for (const part of parts) {
    const parsed = parseItem(part.trim());
    if (!parsed || parsed.intent === "clarify") return clarify();
    items.push(...parsed.items);
  }

  return { intent: "sale", items };
}
