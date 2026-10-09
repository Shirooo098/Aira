import type { ProductWithStock } from '../types.ts';

export interface SpokenCartLine {
  product: ProductWithStock;
  quantity: number;
}

export type ParsedSpokenOrder =
  | { kind: 'add'; items: Array<{ query: string; quantity: number | null }> }
  | { kind: 'set_quantity'; query: string | null; quantity: number }
  | { kind: 'remove'; query: string | null }
  | { kind: 'unsupported'; message: string };

export class SpokenOrderValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpokenOrderValidationError';
  }
}

const SPOKEN_QUANTITIES: Record<string, number> = {
  isa: 1,
  isang: 1,
  dalawa: 2,
  dalawang: 2,
  tatlo: 3,
  tatlong: 3,
  apat: 4,
  'apat na': 4,
  lima: 5,
  limang: 5,
  anim: 6,
  'anim na': 6,
  pito: 7,
  pitong: 7,
  walo: 8,
  walong: 8,
  siyam: 9,
  'siyam na': 9,
  sampu: 10,
  sampung: 10,
  labingisa: 11,
  'labing isa': 11,
  'labing-isang': 11,
  labingdalawa: 12,
  labindalawa: 12,
  labindalawang: 12,
  labintatlo: 13,
  labintatlong: 13,
  labingapat: 14,
  labinglima: 15,
  labinganim: 16,
  labingpito: 17,
  labingwalo: 18,
  labinsiyam: 19,
  dalawampu: 20,
  dalawampung: 20,
  tatlumpu: 30,
  tatlumpung: 30,
  apatnapu: 40,
  apatnapung: 40,
  limampu: 50,
  limampung: 50,
  animnapu: 60,
  animnapung: 60,
  pitumpu: 70,
  pitumpung: 70,
  walumpu: 80,
  walumpung: 80,
  siyamnapu: 90,
  siyamnapung: 90,
  zero: 0,
  sero: 0,
};

const FILIPINO_TENS: Array<[word: string, value: number]> = [
  ['dalawampu', 20],
  ['tatlumpu', 30],
  ['apatnapu', 40],
  ['limampu', 50],
  ['animnapu', 60],
  ['pitumpu', 70],
  ['walumpu', 80],
  ['siyamnapu', 90],
];
const FILIPINO_UNITS: Array<[word: string, value: number]> = [
  ['isa', 1],
  ['isang', 1],
  ['dalawa', 2],
  ['dalawang', 2],
  ['tatlo', 3],
  ['tatlong', 3],
  ['apat', 4],
  ['lima', 5],
  ['limang', 5],
  ['anim', 6],
  ['pito', 7],
  ['pitong', 7],
  ['walo', 8],
  ['walong', 8],
  ['siyam', 9],
];
for (const [tensWord, tensValue] of FILIPINO_TENS) {
  for (const [unitWord, unitValue] of FILIPINO_UNITS) {
    SPOKEN_QUANTITIES[`${tensWord}'t ${unitWord}`] = tensValue + unitValue;
    SPOKEN_QUANTITIES[`${tensWord}t ${unitWord}`] = tensValue + unitValue;
  }
}

const QUANTITY_WORDS = Object.keys(SPOKEN_QUANTITIES)
  .sort((a, b) => b.length - a.length)
  .map(escapeRegExp)
  .join('|');

const QUANTITY_PREFIX = new RegExp(
  `^(?:${QUANTITY_WORDS}|[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))(?:\\s+|$)`,
  'iu'
);

type QuantityPrefix =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; quantity: number; remainder: string };

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unsupported(message: string): ParsedSpokenOrder {
  return { kind: 'unsupported', message };
}

function parseQuantityPrefix(text: string): QuantityPrefix {
  const source = text.trimStart();
  const match = QUANTITY_PREFIX.exec(source);
  if (!match) return { kind: 'none' };

  const token = (match[0] ?? '').trim().toLocaleLowerCase();
  const remainder = source.slice(match[0].length).trim();
  if (!remainder) return { kind: 'none' };

  const wordQuantity = SPOKEN_QUANTITIES[token];
  const quantity = wordQuantity ?? Number(token);
  if (!Number.isSafeInteger(quantity)) {
    return { kind: 'invalid', message: 'Dapat buong bilang na kayang bilangin nang tama ang dami.' };
  }
  if (quantity <= 0) {
    return { kind: 'invalid', message: 'Dapat higit sa zero ang dami ng bawat produkto.' };
  }

  return { kind: 'valid', quantity, remainder };
}

function parseQuantityToken(text: string): number | null {
  const normalized = text.trim().toLocaleLowerCase();
  const spoken = SPOKEN_QUANTITIES[normalized];
  if (spoken !== undefined) return spoken > 0 ? spoken : null;
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function stripOrderPrefix(text: string): string {
  return text.replace(
    /^(?:pabili(?:\s+po)?(?:\s+ng)?|pakibili(?:\s+po)?(?:\s+ng)?|bilhin(?:\s+mo)?(?:\s+ang)?|bibili\s+ako\s+ng|i\s+want)\s+/iu,
    ''
  ).trim();
}

function parseCorrection(text: string): ParsedSpokenOrder | null {
  const quantityThenCorrection = /^(.+?)\s+(?:(?:lang|na\s+lang|nalang)(?:\s+pala)?)(?:\s+(?:ang|ng|yung|the))?\s*(.*)$/iu.exec(text);

  if (quantityThenCorrection) {
    const quantity = parseQuantityToken(quantityThenCorrection[1] ?? '');
    if (quantity === null) {
      return unsupported('Hindi wasto ang dami. Gumamit ng positibong buong bilang.');
    }
    const query = (quantityThenCorrection[2] ?? '').trim();
    return { kind: 'set_quantity', query: query || null, quantity };
  }

  const namedCorrection = new RegExp(
    `^(?:gawing|gawin|palitan(?:\\s+ang\\s+dami\\s+ng)?|itakda(?:\\s+ang\\s+dami\\s+ng)?|set(?:\\s+the\\s+quantity\\s+of)?|change(?:\\s+the\\s+quantity\\s+of)?|make\\s+it)\\s+(.+?)\\s+(?:(?:lang|na\\s+lang)\\s+)?(?:ang|ng|yung|the|for|to)\\s+(.+)$`,
    'iu'
  ).exec(text);

  if (namedCorrection) {
    const quantity = parseQuantityToken(namedCorrection[1] ?? '');
    const query = (namedCorrection[2] ?? '').trim();
    if (quantity === null || !query) {
      return unsupported('Hindi malinaw ang dami o produktong itatama.');
    }
    return { kind: 'set_quantity', query, quantity };
  }

  return null;
}

function parseRemoval(text: string): ParsedSpokenOrder | null {
  const match = /^(?:tanggalin|alisin|burahin|remove|delete|huwag\s+na\s+isama|huwag\s+na)\s+(?:(?:ang|yung|the)\s+)?(.+)$/iu.exec(text);
  if (!match) return null;
  const query = (match[1] ?? '').trim();
  return query ? { kind: 'remove', query } : unsupported('Banggitin ang produktong aalisin sa cart.');
}

function startsLikeCorrection(text: string): boolean {
  return /^(?:gawing|gawin|palitan|itakda|set|change|make\s+it)\b/iu.test(text);
}

function isUnsupportedCommand(text: string): boolean {
  return /^(?:i[- ]?save|save|kumpirmahin|kumpirma|i[- ]?confirm|confirm|checkout|bayaran|magbayad|bayad|payment|gcash|cash|markahan\s+(?:na\s+)?paid|mark\s+(?:this\s+)?(?:as\s+)?paid|record\s+(?:a\s+)?(?:sale|payment|audio)|save\s+audio|record\s+audio|start\s+recording|stop\s+recording|simulan\s+ang\s+recording|itigil\s+ang\s+recording|transcribe|tapusin\s+ang\s+benta|kumpletuhin\s+ang\s+benta)\b/iu.test(text);
}

function splitConjoinedItems(text: string): string[] {
  const parts: string[] = [];
  let remaining = text;
  const conjunction = /\s+\b(?:at|and)\b\s+/giu;

  for (const match of text.matchAll(conjunction)) {
    const index = match.index ?? -1;
    if (index < 0) continue;
    const rightStart = index + match[0].length;
    const right = text.slice(rightStart);

    const separatorStartInRemaining = index - (text.length - remaining.length);
    if (separatorStartInRemaining < 0) continue;
    const left = remaining.slice(0, separatorStartInRemaining).trim();
    if (!left) continue;
    const rightQuantity = parseQuantityPrefix(right);
    const isTagalogAt = /^\s+at\s+$/iu.test(match[0]);
    if (rightQuantity.kind === 'none' && !(isTagalogAt && parseQuantityPrefix(left).kind === 'valid')) continue;
    parts.push(left);
    remaining = text.slice(rightStart);
  }

  if (remaining.trim()) parts.push(remaining.trim());
  return parts;
}

function parseAddItems(text: string): ParsedSpokenOrder {
  const commaParts = text.split(/[,;\n]+/u).map((part) => part.trim());
  if (commaParts.length > 20 || commaParts.some((part) => !part)) {
    return unsupported('Hindi kumpleto o masyadong mahaba ang listahan ng produkto. Ulitin nang paisa-isang item.');
  }

  const parts = commaParts.flatMap(splitConjoinedItems);
  if (parts.length === 0 || parts.length > 20) {
    return unsupported('Hindi malinaw ang listahan ng produkto.');
  }

  const items: Array<{ query: string; quantity: number | null }> = [];
  for (const part of parts) {
    if (/^(?:(?:negative|minus|negatibo|negatibong)\s+|(?:isa|isang|one)\s+(?:punto|point)\s+)/iu.test(part)) {
      return unsupported('Dapat positibong buong bilang ang dami; hindi tinatanggap ang negatibo o desimal.');
    }

    const quantity = parseQuantityPrefix(part);
    if (quantity.kind === 'invalid') return unsupported(quantity.message);
    if (
      quantity.kind === 'valid' &&
      /^(?:point|punto)\s+(?:[+-]?(?:\d+(?:\.\d*)?|\.\d+)|[\p{L}-]+)\b/iu.test(quantity.remainder)
    ) {
      return unsupported('Dapat positibong buong bilang ang dami; hindi tinatanggap ang desimal.');
    }
    const query = quantity.kind === 'valid'
      ? quantity.remainder.replace(/^na\s+/iu, '').trim()
      : part.trim();
    if (!query) return unsupported('Banggitin ang pangalan o variant ng produkto.');
    items.push({ query, quantity: quantity.kind === 'valid' ? quantity.quantity : null });
  }

  return { kind: 'add', items };
}

/**
 * Recognizes a small, explicit Filipino/Taglish order grammar. It only extracts
 * text and quantities; catalog resolution and all writes belong to later steps.
 */
export function parseSpokenOrder(rawText: string): ParsedSpokenOrder {
  if (typeof rawText !== 'string') {
    return unsupported('Walang nabasang order.');
  }

  const normalized = rawText
    .normalize('NFC')
    .trim()
    .replace(/\r\n?/gu, '\n')
    .replace(/[^\S\n]+/gu, ' ')
    .replace(/[’‘]/gu, "'")
    .replace(/[.!?？]+$/u, '')
    .trim();
  if (!normalized) return unsupported('Walang nabasang order.');
  if (isUnsupportedCommand(normalized)) {
    return unsupported('Hindi maisasagawa sa utos ng boses ang pag-save, pagbabayad, o pagkumpirma.');
  }

  const removal = parseRemoval(normalized);
  if (removal) return removal;

  const correction = parseCorrection(normalized);
  if (correction) return correction;
  if (startsLikeCorrection(normalized)) {
    return unsupported('Hindi malinaw ang pagwawasto sa dami.');
  }

  const addText = stripOrderPrefix(normalized);
  if (!addText) return unsupported('Banggitin ang mga produktong idaragdag sa cart.');
  return parseAddItems(addText);
}
