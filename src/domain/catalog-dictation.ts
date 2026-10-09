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

const INTENT_PREFIXES: Array<{ kind: CatalogChangeKind; pattern: RegExp }> = [
  {
    kind: 'new_product',
    pattern: /^(?:bagong produkto|magdagdag ng produkto|idagdag ang produkto|new product|add new product)\b\s*[:,\-]?\s*/i,
  },
  {
    kind: 'price_update',
    pattern: /^(?:baguhin ang presyo ng|palitan ang presyo ng|presyo ng|update price for|change price of)\b\s*[:,\-]?\s*/i,
  },
  {
    kind: 'set_count',
    pattern: /^(?:itakda ang bilang ng|itakda bilang ng|set count for|set quantity of)\b\s*[:,\-]?\s*/i,
  },
  {
    kind: 'add_delivery',
    pattern: /^(?:magdagdag ng delivery ng|dagdag delivery ng|add delivery for|record delivery for)\b\s*[:,\-]?\s*/i,
  },
];

const UNIT_ALIASES: Array<{ pattern: string; unit: string }> = [
  { pattern: 'pieces?|pcs?\\.?|piraso', unit: 'piraso' },
  { pattern: 'bottles?|bote|botelya', unit: 'bote' },
  { pattern: 'packs?|pakete', unit: 'pack' },
  { pattern: 'sachets?', unit: 'sachet' },
  { pattern: 'boxes?|kahon', unit: 'kahon' },
  { pattern: 'cans?|lata', unit: 'lata' },
  { pattern: 'kilos?|kilograms?|kg', unit: 'kilo' },
  { pattern: 'grams?|g', unit: 'gramo' },
  { pattern: 'liters?|litres?|l', unit: 'litro' },
  { pattern: 'milliliters?|millilitres?|ml', unit: 'ml' },
  { pattern: 'bags?', unit: 'bag' },
  { pattern: 'sako', unit: 'sako' },
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
    const value = /^(\S+)(?:\s*(?:pesos?|piso|php)\b)?/i.exec(payload);
    const input = (value?.[1] ?? payload).trim();
    const remainder = `${part.slice(0, label.index)} ${payload.slice(value?.[0].length ?? 0)}`.trim();
    return { input, remainder };
  }

  const suffix = /([^\s,;]+)\s*(?:pesos?|piso|php)\b/i.exec(part);
  if (suffix) {
    return {
      input: (suffix[1] ?? '').trim(),
      remainder: `${part.slice(0, suffix.index)}${part.slice(suffix.index + suffix[0].length)}`.trim(),
    };
  }

  const prefix = /₱([^\s,;]+)|\bPHP\s*([^\s,;]+)|\bP\s+([^\s,;]+)/i.exec(part);
  if (prefix) {
    return {
      input: (prefix[1] ?? prefix[2] ?? prefix[3] ?? '').trim(),
      remainder: `${part.slice(0, prefix.index)}${part.slice(prefix.index + prefix[0].length)}`.trim(),
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
  const unitMatch = new RegExp(`([^\\s]+)\\s+(${unit})\\.?\\s*$`, 'i').exec(source);

  if (unitMatch) {
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
    return { input: normalizeSpokenQuantity(input), unit: normalizedUnit, remainder };
  }

  const genericUnit = /\b(isa|isang|dalawa|dalawang|tatlo|tatlong|apat|apat na|lima|limang|anim|anim na|pito|pitong|walo|walong|siyam|siyam na|sampu|sampung|one|two|three|four|five|six|seven|eight|nine|ten)\s+([\p{L}-]+)\s*$/iu.exec(source);
  if (genericUnit) {
    const input = (genericUnit[1] ?? '').trim();
    const rawUnit = (genericUnit[2] ?? '').trim();
    const before = source.slice(0, genericUnit.index).trim();
    const after = source.slice(genericUnit.index + genericUnit[0].length).trim();
    const remainder = explicit
      ? `${part.slice(0, explicit.index)}${before ? ` ${before}` : ''}${after ? ` ${after}` : ''}`.trim()
      : `${before}${before && after ? ' ' : ''}${after}`.trim();
    return { input: normalizeSpokenQuantity(input), unit: normalizeUnit(rawUnit), remainder };
  }

  if (explicit) {
    return {
      input: source,
      unit: '',
      remainder: part.slice(0, sourceOffset).replace(/\b(?:quantity|qty|dami|bilang)\s*(?::|=|is|ay)?\s*$/i, '').trim(),
    };
  }

  return null;
}

function normalizeSpokenQuantity(value: string): string {
  const spoken = value.trim().toLocaleLowerCase();
  const numbers: Record<string, string> = {
    isa: '1', isang: '1', one: '1',
    dalawa: '2', dalawang: '2', two: '2',
    tatlo: '3', tatlong: '3', three: '3',
    apat: '4', 'apat na': '4', four: '4',
    lima: '5', 'limang': '5', five: '5',
    anim: '6', 'anim na': '6', six: '6',
    pito: '7', pitong: '7', seven: '7',
    walo: '8', walong: '8', eight: '8',
    siyam: '9', 'siyam na': '9', nine: '9',
    sampu: '10', sampung: '10', ten: '10',
  };
  return numbers[spoken] ?? value.trim();
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

  for (let part of parts) {
    const variantMatch = /\b(?:variant|lasa|size|sukat)\s*(?::|=|is|ay)?\s*(.+)$/i.exec(part);
    if (variantMatch) {
      const value = (variantMatch[1] ?? '').trim();
      if (value) variants.push(value);
      part = part.slice(0, variantMatch.index).trim();
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

    if (part) nameParts.push(part);
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
    fields.name = productText;
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
