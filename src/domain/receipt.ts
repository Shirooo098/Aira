import { parseCentavos } from './money.ts';

/** OCR output is evidence for an editable draft, never payment authentication. */
export interface ReceiptProposal {
  rawText: string;
  amountInput: string;
  amountCentavos: number | null;
  referenceNumber: string | null;
  senderName: string | null;
  senderMobile: string | null;
  warnings: string[];
}

type Field = 'amount' | 'reference' | 'senderName' | 'senderMobile';
const LABELS: ReadonlyArray<{ field: Field; pattern: RegExp }> = [
  { field: 'amount', pattern: /^amount(?:\s+(?:sent|received))?\s*(?::|\s+-\s+|$)/i },
  { field: 'reference', pattern: /^(?:reference(?:\s+(?:no\.?|number))?|ref\.?\s*(?:no\.?|number)?)\s*(?::|\s+-\s+|$)/i },
  { field: 'senderName', pattern: /^(?:sender(?:\s+name)?|from)\s*(?::|\s+-\s+|$)/i },
  { field: 'senderMobile', pattern: /^sender\s+(?:mobile(?:\s+(?:no\.?|number))?|phone(?:\s+number)?)\s*(?::|\s+-\s+|$)/i },
];

function isFieldLabel(line: string): boolean {
  return LABELS.some(label => label.pattern.test(line)) ||
    /^(?:recipient|to|sent\s+to|paid\s+to|mobile|phone|fee|balance|total|date|time|transaction)\b/i.test(line) ||
    // Unknown label-like lines are safer left empty than assigned to a sender.
    /^[\p{L}\s.]+\s*:/u.test(line);
}

/** Conservative labeled extraction. Unsupported layouts stay empty for review. */
export function proposeReceiptFields(rawText: string): ReceiptProposal {
  const lines = rawText.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const candidates: Record<Field, Set<string>> = {
    amount: new Set(), reference: new Set(), senderName: new Set(), senderMobile: new Set(),
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    for (const label of LABELS) {
      const match = line.match(label.pattern);
      if (!match) continue;
      let value = line.slice(match[0].length).trim();
      const next = lines[index + 1];
      if (!value && next && !isFieldLabel(next)) value = next;
      if (value) candidates[label.field].add(value);
      break;
    }
  }
  const warnings: string[] = [];
  const unique = (field: Field): string | null => {
    const values = [...candidates[field]];
    if (values.length !== 1) {
      warnings.push(values.length ? `Conflicting ${field}; compare with the image.` : `Missing ${field}; enter only what is visible.`);
      return null;
    }
    return values[0]!;
  };
  const rawAmount = unique('amount');
  let amountInput = '';
  let amountCentavos: number | null = null;
  if (rawAmount !== null) {
    const numeric = rawAmount.replace(/^(?:PHP|₱|P)\s*/i, '').trim();
    // Grouped amounts must use groups of three, not an OCR decimal guess.
    if (/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(numeric)) {
      try {
        amountInput = numeric.replace(/,/g, '');
        amountCentavos = parseCentavos(amountInput);
      } catch {
        amountInput = '';
      }
    }
    if (amountCentavos === null) warnings.push('Invalid amount; compare with the image and correct it.');
  }
  return {
    rawText, amountInput, amountCentavos,
    referenceNumber: unique('reference'),
    senderName: unique('senderName'),
    senderMobile: unique('senderMobile'),
    warnings,
  };
}
