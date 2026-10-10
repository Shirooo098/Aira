export type CatalogChangeKind =
  | 'new_product'
  | 'price_update'
  | 'set_count'
  | 'add_delivery';

export interface CatalogChangeFields {
  kind: CatalogChangeKind;
  name: string;
  variant: string;
  unit: string;
  priceInput: string;
  quantityInput: string;
  productQuery: string;
  productId: string | null;
}

const SPOKEN_NUMBERS: Record<string, number> = {
  zero: 0, sero: 0,
  isa: 1, isang: 1, one: 1, uno: 1,
  dalawa: 2, dalawang: 2, two: 2, dos: 2,
  tatlo: 3, tatlong: 3, three: 3, tres: 3,
  apat: 4, 'apat na': 4, apatna: 4, four: 4, kwatro: 4, cuatro: 4,
  lima: 5, limang: 5, five: 5, singko: 5, cinco: 5,
  anim: 6, 'anim na': 6, six: 6, sais: 6, seis: 6,
  pito: 7, pitong: 7, seven: 7, syete: 7, siete: 7,
  walo: 8, walong: 8, eight: 8, otso: 8, ocho: 8,
  siyam: 9, 'siyam na': 9, nine: 9, nuwebe: 9, nueve: 9,
  sampu: 10, sampung: 10, ten: 10, dyes: 10, diyes: 10, diez: 10,
  labingisa: 11, 'labing isa': 11, 'labing-isa': 11, 'labing-isang': 11, onse: 11, once: 11,
  labingdalawa: 12, labindalawa: 12, labindalawang: 12, dose: 12, doce: 12,
  labintatlo: 13, labintatlong: 13, trese: 13, trece: 13,
  labingapat: 14, 'labing-apat': 14, katorse: 14, catorce: 14,
  labinglima: 15, labinglimang: 15, labinlima: 15, labinlimang: 15, kinse: 15, quince: 15,
  labinganim: 16, 'labing-anim': 16, disisais: 16,
  labingpito: 17, labimpito: 17, labimpitong: 17, disisyete: 17,
  labingwalo: 18, labingwalong: 18, disiotso: 18,
  labinsiyam: 19, disinuwebe: 19,
  dalawampu: 20, dalawampung: 20, bente: 20, veinte: 20,
  tatlumpu: 30, tatlumpung: 30, trenta: 30, treinta: 30,
  apatnapu: 40, apatnapung: 40, kwarenta: 40, cuarenta: 40,
  limampu: 50, limampung: 50, singkwenta: 50, cincuenta: 50,
  animnapu: 60, animnapung: 60, sisenta: 60, sesenta: 60,
  pitumpu: 70, pitumpung: 70, setenta: 70,
  walumpu: 80, walumpung: 80, otsenta: 80, ochenta: 80,
  siyamnapu: 90, siyamnapung: 90, nobenta: 90, noventa: 90,
  sandaan: 100, sangdaan: 100, 'isang daan': 100, 'isang daang': 100, siyento: 100, cien: 100, ciento: 100,
};

export function normalizeSpokenNumber(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/'t\s*/g, ' ').replace(/-/g, ' ');
  if (/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)) return clean;
  if (SPOKEN_NUMBERS[clean] !== undefined) return String(SPOKEN_NUMBERS[clean]);

  const parts = clean.split(/\s+(?:y\s+|'t\s+)?/);
  if (parts.length === 2) {
    const tens = SPOKEN_NUMBERS[parts[0]!];
    const units = SPOKEN_NUMBERS[parts[1]!];
    if (tens !== undefined && units !== undefined && tens >= 20 && units < 10) {
      return String(tens + units);
    }
  }
  return clean;
}

export function isNumericOrSpokenNumber(token: string): boolean {
  const normalized = normalizeSpokenNumber(token);
  return /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized);
}

const INTENT_PREFIXES: Array<{ kind: CatalogChangeKind; pattern: RegExp }> = [
  {
    kind: 'new_product',
    pattern: /^(?:bagong produkto|magdagdag ng produkto|idagdag ang produkto|magtala ng produkto|itala ang produkto|itala produkto|irecord ang produkto|irecord ang paninda|record product|new product|add new product)\b\s*[:,\-]?\s*/i,
  },
  {
    kind: 'price_update',
    pattern: /^(?:baguhin ang presyo ng|palitan ang presyo ng|presyo ng|update price for|change price of)\b\s*[:,\-]?\s*/i,
  },
  {
    kind: 'set_count',
    pattern: /^(?:itakda ang bilang ng|itakda bilang ng|bilang ng|set count for|set quantity of)\b\s*[:,\-]?\s*/i,
  },
  {
    kind: 'add_delivery',
    pattern: /^(?:magdagdag ng delivery ng|dagdag delivery ng|delivery ng|add delivery for|record delivery for)\b\s*[:,\-]?\s*/i,
  },
];

const UNIT_ALIASES: Array<{ pattern: string; unit: string }> = [
  { pattern: 'pieces?|pcs?\\.?|piraso|pirasong', unit: 'piraso' },
  { pattern: 'bottles?|bote|botelya|boteng', unit: 'bote' },
  { pattern: 'packs?|pakete|pakeng', unit: 'pack' },
  { pattern: 'sachets?|sachet na|sachet ng', unit: 'sachet' },
  { pattern: 'boxes?|kahon|kahong', unit: 'kahon' },
  { pattern: 'cans?|lata|latang', unit: 'lata' },
  { pattern: 'kilos?|kilograms?|kg', unit: 'kilo' },
  { pattern: 'grams?|g', unit: 'gramo' },
  { pattern: 'liters?|litres?|l', unit: 'litro' },
  { pattern: 'milliliters?|millilitres?|ml', unit: 'ml' },
  { pattern: 'bags?', unit: 'bag' },
  { pattern: 'sako|sakong', unit: 'sako' },
  { pattern: 'trays?', unit: 'tray' },
  { pattern: 'tubs?', unit: 'tub' },
  { pattern: 'rolls?', unit: 'roll' },
  { pattern: 'sticks?', unit: 'stick' },
  { pattern: 'bars?', unit: 'bar' },
];

function unitPattern(): string {
  return UNIT_ALIASES.map(({ pattern }) => pattern).join('|');
}

function normalizeUnit(raw: string): string {
  const value = raw.trim();
  for (const alias of UNIT_ALIASES) {
    if (new RegExp(`^(?:${alias.pattern})$`, 'i').test(value)) return alias.unit;
  }
  return value;
}

export function emptyCatalogChangeFields(
  kind: CatalogChangeKind = 'new_product'
): CatalogChangeFields {
  return {
    kind,
    name: '',
    variant: '',
    unit: '',
    priceInput: '',
    quantityInput: '',
    productQuery: '',
    productId: null,
  };
}

function extractPrice(part: string): { input: string; remainder: string } | null {
  const label = /\b(?:presyo|price)\s*(?::|=|is|ay)?\s*(.+)$/i.exec(part);
  if (label) {
    const payload = (label[1] ?? '').trim();
    const compound = /^([a-zA-Z]+(?:\s+(?:y|'t)?\s*[a-zA-Z]+))\s*(?:pesos?|piso|php)\b/i.exec(payload);
    if (compound && isNumericOrSpokenNumber(compound[1]!)) {
      const input = normalizeSpokenNumber(compound[1]!);
      const remainder = `${part.slice(0, label.index)} ${payload.slice(compound[0].length)}`.trim();
      return { input, remainder };
    }
    const prefixMatch = /^(?:₱|PHP\s*|P\s+)?([^\s,;]+)(?:\s*(?:pesos?|piso|php)\b)?/i.exec(payload);
    if (prefixMatch) {
      const raw = prefixMatch[1]!.trim();
      if (isNumericOrSpokenNumber(raw)) {
        const input = normalizeSpokenNumber(raw);
        const remainder = `${part.slice(0, label.index)} ${payload.slice(prefixMatch[0].length)}`.trim();
        return { input, remainder };
      }
    }
  }

  // Suffix compound: e.g. "bente singko pesos", "dalawampu't lima pesos"
  const suffixCompound = /\b([a-zA-Z]+(?:\s+(?:y|'t)?\s*[a-zA-Z]+))\s*(?:pesos?|piso|php)\b/i.exec(part);
  if (suffixCompound && isNumericOrSpokenNumber(suffixCompound[1]!)) {
    const raw = suffixCompound[1]!.trim();
    const input = normalizeSpokenNumber(raw);
    const before = part.slice(0, suffixCompound.index).replace(/\b(?:presyo|price)\s*(?::|=|is|ay)?\s*$/i, '').trim();
    const after = part.slice(suffixCompound.index + suffixCompound[0].length).trim();
    return {
      input,
      remainder: `${before}${before && after ? ' ' : ''}${after}`.trim(),
    };
  }

  // Suffix single: e.g. "15 pesos", "kinse pesos", "bente pesos"
  const suffix = /([^\s,;]+)\s*(?:pesos?|piso|php)\b/i.exec(part);
  if (suffix) {
    const raw = suffix[1]!.trim();
    if (isNumericOrSpokenNumber(raw)) {
      const input = normalizeSpokenNumber(raw);
      const before = part.slice(0, suffix.index).replace(/\b(?:presyo|price)\s*(?::|=|is|ay)?\s*$/i, '').trim();
      const after = part.slice(suffix.index + suffix[0].length).trim();
      return {
        input,
        remainder: `${before}${before && after ? ' ' : ''}${after}`.trim(),
      };
    }
  }

  const prefix = /₱([^\s,;]+)|\bPHP\s*([^\s,;]+)|\bP\s+([^\s,;]+)/i.exec(part);
  if (prefix) {
    const raw = (prefix[1] ?? prefix[2] ?? prefix[3] ?? '').trim();
    const input = normalizeSpokenNumber(raw);
    const before = part.slice(0, prefix.index).replace(/\b(?:presyo|price)\s*(?::|=|is|ay)?\s*$/i, '').trim();
    const after = part.slice(prefix.index + prefix[0].length).trim();
    return {
      input,
      remainder: `${before}${before && after ? ' ' : ''}${after}`.trim(),
    };
  }

  return null;
}

function extractQuantity(part: string): {
  input: string;
  unit: string;
  remainder: string;
} | null {
  const explicit = /\b(?:quantity|qty|dami|bilang)\s*(?::|=|is|ay)?\s*(.+)$/i.exec(part);
  const source = explicit?.[1]?.trim() ?? part;
  const sourceOffset = explicit ? explicit.index + explicit[0].length - (explicit[1]?.length ?? 0) : 0;
  const unit = unitPattern();

  // Match at start: e.g. "10 piraso ng Lucky Me", "sampung piraso ng Lucky Me", "10 pirasong Lucky Me"
  const leadingMatch = new RegExp(
    `^(\\d+(?:\\.\\d+)?|[a-zA-Z]+(?:\\s+(?:y|'t)\\s+[a-zA-Z]+)?|[a-zA-Z]+)\\s+(${unit})\\b(?:\\s+(?:ng|na))?\\s*(.*)$`,
    'i'
  ).exec(source);
  if (leadingMatch && isNumericOrSpokenNumber(leadingMatch[1]!)) {
    const rawInput = (leadingMatch[1] ?? '').trim();
    const rawUnit = (leadingMatch[2] ?? '').trim();
    const normalizedInput = normalizeSpokenNumber(rawInput);
    const normalizedUnit = normalizeUnit(rawUnit);
    const remainder = leadingMatch[3] ? leadingMatch[3].trim() : '';
    if (normalizedInput && normalizedUnit) {
      return { input: normalizedInput, unit: normalizedUnit, remainder };
    }
  }

  // Match at end (standard): e.g. "Lucky Me 10 piraso", "10 pieces"
  const unitMatch = new RegExp(
    `(\\d+(?:\\.\\d+)?|[a-zA-Z]+(?:\\s+(?:y|'t)\\s+[a-zA-Z]+)?|[a-zA-Z]+)\\s+(${unit})\\.?\\s*$`,
    'i'
  ).exec(source);
  if (unitMatch && isNumericOrSpokenNumber(unitMatch[1]!)) {
    const input = (unitMatch[1] ?? '').trim();
    const rawUnit = (unitMatch[2] ?? '').trim();
    const before = source.slice(0, unitMatch.index).trim();
    const after = source.slice(unitMatch.index + unitMatch[0].length).trim();
    const normalizedUnit = normalizeUnit(rawUnit);
    const isWeightOrVolume = /^(?:kilo|gramo|litro|kg|g|l|ml)$/i.test(normalizedUnit);
    if (isWeightOrVolume && before && !explicit) return null;
    const remainder = explicit
      ? `${part.slice(0, explicit.index)}${before ? ` ${before}` : ''}${after ? ` ${after}` : ''}`.trim()
      : `${before}${before && after ? ' ' : ''}${after}`.trim();
    return { input: normalizeSpokenNumber(input), unit: normalizedUnit, remainder };
  }

  // Generic unit with spoken count: e.g. "sampung piraso", "dalawang bote"
  const genericUnit = /\b(isa|isang|dalawa|dalawang|tatlo|tatlong|apat|apat na|lima|limang|anim|anim na|pito|pitong|walo|walong|siyam|siyam na|sampu|sampung|one|two|three|four|five|six|seven|eight|nine|ten)\s+([\p{L}-]+)\s*$/iu.exec(source);
  if (genericUnit) {
    const input = (genericUnit[1] ?? '').trim();
    const rawUnit = (genericUnit[2] ?? '').trim();
    const before = source.slice(0, genericUnit.index).trim();
    const after = source.slice(genericUnit.index + genericUnit[0].length).trim();
    const remainder = explicit
      ? `${part.slice(0, explicit.index)}${before ? ` ${before}` : ''}${after ? ` ${after}` : ''}`.trim()
      : `${before}${before && after ? ' ' : ''}${after}`.trim();
    return { input: normalizeSpokenNumber(input), unit: normalizeUnit(rawUnit), remainder };
  }

  if (explicit) {
    return {
      input: normalizeSpokenNumber(source),
      unit: '',
      remainder: part.slice(0, sourceOffset).replace(/\b(?:quantity|qty|dami|bilang)\s*(?::|=|is|ay)?\s*$/i, '').trim(),
    };
  }

  return null;
}

function normalizeSpokenQuantity(value: string): string {
  return normalizeSpokenNumber(value);
}

function findMentionedKinds(text: string): CatalogChangeKind[] {
  const kinds: CatalogChangeKind[] = [];
  for (const { kind, pattern } of INTENT_PREFIXES) {
    const source = new RegExp(pattern.source.replace(/^\^/, ''), pattern.flags);
    if (source.test(text)) kinds.push(kind);
  }
  return kinds;
}

function findLeadingIntent(text: string): { kind: CatalogChangeKind; remainder: string } | null {
  for (const { kind, pattern } of INTENT_PREFIXES) {
    const match = pattern.exec(text);
    if (match) return { kind, remainder: text.slice(match[0].length).trim() };
  }
  return null;
}

export function extractCatalogTranscript(
  text: string,
  kind?: CatalogChangeKind
): { fields: CatalogChangeFields; warnings: string[] } {
  const original = typeof text === 'string' ? text.trim() : '';
  const leading = findLeadingIntent(original);
  const detectedKinds = findMentionedKinds(original);
  const selectedKind = leading?.kind ?? kind ?? 'new_product';
  const warnings: string[] = [];

  const unsupportedPrefix = /^(?:ibenta|magbenta|benta|sell|sale|checkout|price update|set price|update|change|rename|change name|set unit|search|find|show|list|restock|delivery|return|refund|kanselahin|cancel|burahin|tanggalin|delete|remove)\b/i;
  if (original.length === 0) warnings.push('Walang nabasang detalye ng produkto');
  if (!leading && unsupportedPrefix.test(original)) {
    warnings.push('Hindi suportadong utos; piliin ang bagong produkto, presyo, bilang, o delivery');
  }
  if (new Set(detectedKinds).size > 1 || (leading && kind && leading.kind !== kind)) {
    warnings.push('Magkahalo ang uri ng pagbabago; ulitin bilang iisang utos');
  }

  const fields = emptyCatalogChangeFields(selectedKind);
  if (warnings.length > 0) return { fields, warnings };

  const remainder = leading?.remainder ?? original;
  const parts = remainder.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
  const nameParts: string[] = [];
  const prices: string[] = [];
  const quantities: string[] = [];
  const units: string[] = [];
  const variants: string[] = [];

  const KNOWN_VARIANTS = new Set([
    'regular', 'standard', 'maliit', 'malaki', 'solo', 'jumbo', 'medium', 'large', 'small',
  ]);

  for (let part of parts) {
    const variantMatch = /\b(?:variant|variety|lasa|size|sukat|flavor)\s*(?::|=|is|ay)?\s*(.+)$/i.exec(part);
    if (variantMatch) {
      const value = (variantMatch[1] ?? '').trim();
      if (value) variants.push(value);
      part = part.slice(0, variantMatch.index).trim();
    } else if (KNOWN_VARIANTS.has(part.trim().toLowerCase())) {
      variants.push(part.trim());
      part = '';
    }

    const unitMatch = /\bunit\s*(?::|=|is|ay)?\s*(.+)$/i.exec(part);
    if (unitMatch) {
      const value = (unitMatch[1] ?? '').trim();
      if (value) units.push(normalizeUnit(value));
      part = part.slice(0, unitMatch.index).trim();
    }

    const price = extractPrice(part);
    if (price) {
      prices.push(price.input);
      part = price.remainder;
    }

    const quantity = extractQuantity(part);
    if (quantity) {
      quantities.push(quantity.input);
      if (quantity.unit) units.push(quantity.unit);
      part = quantity.remainder;
    }

    const bareNumber = /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.exec(part.trim());
    if (bareNumber) {
      if (selectedKind === 'set_count' || selectedKind === 'add_delivery') {
        quantities.push(part.trim());
      } else if (selectedKind === 'price_update' || prices.length === 0) {
        prices.push(part.trim());
      } else {
        quantities.push(part.trim());
      }
      part = '';
    }

    part = part.replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
    if (part) nameParts.push(part);
  }

  // If new product has no explicit variant, but 2 comma-separated name parts exist (e.g. "Lucky Me, chicken"):
  if (selectedKind === 'new_product' && variants.length === 0 && nameParts.length === 2) {
    variants.push(nameParts[1]!);
    nameParts.splice(1, 1);
  }

  if (prices.length > 1 || quantities.length > 1 || new Set(units).size > 1 || variants.length > 1) {
    warnings.push('May higit sa isang presyo, bilang, o unit; ayusin muna ang transcript');
    return { fields, warnings };
  }

  const productText = nameParts.join(' ').replace(/\s+/g, ' ').trim();
  fields.variant = variants[0] ?? '';
  fields.unit = units[0] ?? '';
  fields.priceInput = prices[0] ?? '';
  fields.quantityInput = quantities[0] ?? '';

  if (selectedKind === 'new_product') {
    if (nameParts.length === 2 && !variants[0]) {
      fields.name = nameParts[0]!;
      fields.variant = nameParts[1]!;
    } else if (
      nameParts.length === 1 &&
      !variants[0] &&
      /^(?:regular|maliit|malaki|solo|original|hot and spicy|spicy|small|medium|large|extra large)$/i.test(nameParts[0]!)
    ) {
      fields.variant = nameParts[0]!;
      fields.name = '';
    } else {
      fields.name = productText;
    }
  } else {
    fields.productQuery = productText;
  }

  if (selectedKind === 'new_product') {
    if (!fields.name) warnings.push('Kailangan ang pangalan ng bagong produkto');
    if (!fields.variant) warnings.push('Kailangan ang variant o sukat; huwag itong hulaan');
    if (!fields.unit) warnings.push('Kailangan ang unit ng produkto');
    if (!fields.priceInput) warnings.push('Kailangan ang presyo');
    if (!fields.quantityInput) warnings.push('Kailangan ang panimulang bilang');
  } else {
    if (!fields.productQuery) warnings.push('Piliin o banggitin ang eksaktong produkto');
    if (selectedKind === 'price_update' && !fields.priceInput) warnings.push('Kailangan ang bagong presyo');
    if ((selectedKind === 'set_count' || selectedKind === 'add_delivery') && !fields.quantityInput) {
      warnings.push('Kailangan ang bilang o dami ng delivery');
    }
  }

  return { fields, warnings };
}
export function mergeCatalogChangeFields(
  current: CatalogChangeFields,
  incoming: CatalogChangeFields
): { fields: CatalogChangeFields; warnings: string[] } {
  const merged: CatalogChangeFields = {
    kind: current.kind,
    name: incoming.name || current.name,
    variant: incoming.variant || current.variant,
    unit: incoming.unit || current.unit,
    priceInput: incoming.priceInput || current.priceInput,
    quantityInput: incoming.quantityInput || current.quantityInput,
    productQuery: incoming.productQuery || current.productQuery,
    productId: incoming.productId ?? current.productId,
  };

  const warnings: string[] = [];
  if (merged.kind === 'new_product') {
    if (!merged.name) warnings.push('Kailangan ang pangalan ng bagong produkto');
    if (!merged.variant) warnings.push('Kailangan ang variant o sukat; huwag itong hulaan');
    if (!merged.unit) warnings.push('Kailangan ang unit ng produkto');
    if (!merged.priceInput) warnings.push('Kailangan ang presyo');
    if (!merged.quantityInput) warnings.push('Kailangan ang panimulang bilang');
  } else {
    if (!merged.productQuery) warnings.push('Piliin o banggitin ang eksaktong produkto');
    if (merged.kind === 'price_update' && !merged.priceInput) warnings.push('Kailangan ang bagong presyo');
    if ((merged.kind === 'set_count' || merged.kind === 'add_delivery') && !merged.quantityInput) {
      warnings.push('Kailangan ang bilang o dami ng delivery');
    }
  }

  return { fields: merged, warnings };
}
