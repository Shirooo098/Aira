import { parseCentavos } from './money.ts';

export interface ParsedNotebookLine {
  rawLine: string;
  name: string;
  variant: string;
  unit: string;
  priceInput: string;
  priceCentavos: number | null;
  warnings: string[];
}

export interface NotebookProposalRow {
  id: string;
  rawLine: string;
  name: string;
  variant: string;
  unit: string;
  priceInput: string;
  priceCentavos: number | null;
  status: 'ready' | 'needs_clarification';
  clarificationReasons: string[];
  matchedProductId?: string;
  existingPriceCentavos?: number;
  existingStock?: number | null;
  action: 'create_product' | 'update_price';
}

/**
 * Standard unit abbreviations found in Filipino sari-sari store notebooks.
 */
const KNOWN_UNITS = [
  'piraso',
  'pc',
  'pcs',
  'pack',
  'pck',
  'balot',
  'sachet',
  'bote',
  'botelya',
  'lata',
  'can',
  'kilo',
  'kg',
  'bar',
  'roll',
];

/**
 * Parses a single photographed notebook line into structured product & price fields.
 * Example formats:
 *   "Coke 250ml bote - 15.00"
 *   "Lucky Me Pancit Canton Kalamansi 18"
 *   "Bear Brand 33g 12.00"
 *   "Safeguard white 35"
 */
export function parseNotebookLine(rawLine: string): ParsedNotebookLine {
  const line = rawLine.trim();
  const warnings: string[] = [];

  if (!line) {
    return {
      rawLine,
      name: '',
      variant: '',
      unit: 'piraso',
      priceInput: '',
      priceCentavos: null,
      warnings: ['Walang laman ang linyang ito.'],
    };
  }

  // 1. Extract trailing price (with optional separator like -, =, :, or space)
  // Matches " - 15", " 15.00", " : ₱25.50", "= 100", etc.
  const priceRegex = /(?:[-=:]|\s+)?(?:\s*(?:PHP|₱|P))?\s*(\d+(?:\.\d{1,2})?)\s*$/i;
  const priceMatch = line.match(priceRegex);

  let remaining = line;
  let priceInput = '';
  let priceCentavos: number | null = null;

  if (priceMatch && priceMatch[1]) {
    priceInput = priceMatch[1];
    remaining = line.slice(0, priceMatch.index).trim();
    // Clean trailing punctuation if any
    remaining = remaining.replace(/[-=:]+$/, '').trim();

    try {
      priceCentavos = parseCentavos(priceInput);
    } catch {
      priceCentavos = null;
      warnings.push(`Hindi wastong presyo: "${priceInput}".`);
    }
  } else {
    warnings.push('Walang natukoy na presyo sa dulo ng linya.');
  }

  // 2. Extract unit from remaining text if at end
  let unit = 'piraso';
  const tokens = remaining.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const lastToken = tokens[tokens.length - 1]!.toLowerCase().replace(/[(),]/g, '');
    if (KNOWN_UNITS.includes(lastToken)) {
      unit = lastToken;
      tokens.pop();
      remaining = tokens.join(' ');
    }
  }

  // 3. Extract variant and name
  // Common pattern: "Product Variant" e.g., "Coke 250ml", "Lucky Me Kalamansi", "Surf Powder Sun Fresh"
  // If in parentheses: "Lucky Me (Kalamansi)"
  let name = remaining;
  let variant = 'Standard';

  const parenMatch = remaining.match(/^(.*?)\s*\((.*?)\)$/);
  if (parenMatch) {
    name = parenMatch[1]!.trim();
    variant = parenMatch[2]!.trim();
  } else {
    // If multiple words, treat size/flavor keywords at the end as variant
    const words = remaining.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      const lastWord = words[words.length - 1]!;
      // Check if last word looks like a variant/size (e.g. 250ml, 1L, Small, Big, Red, Sachet)
      if (
        /^\d+(?:ml|g|kg|l|oz|cl|s|pcs)?$/i.test(lastWord) ||
        /^(small|medium|large|jumbo|reg|regular|solo|litro|sachet|mini)$/i.test(lastWord)
      ) {
        variant = lastWord;
        words.pop();
        name = words.join(' ');
      }
    }
  }

  if (!name.trim()) {
    warnings.push('Walang natukoy na pangalan ng produkto.');
  }

  return {
    rawLine,
    name: name.trim(),
    variant: variant.trim() || 'Standard',
    unit: unit.trim() || 'piraso',
    priceInput,
    priceCentavos,
    warnings,
  };
}

/**
 * Parses multi-line raw OCR text into candidate notebook proposal lines.
 */
export function parseNotebookText(rawText: string): ParsedNotebookLine[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return lines.map(parseNotebookLine);
}
