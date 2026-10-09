/**
 * Money utilities for integer centavo calculations.
 * Invariant: Never use floating point math for currency.
 */

export function parseCentavos(raw: string): number {
  if (typeof raw !== 'string') {
    throw new Error('Maling halaga ng pera: hindi text');
  }

  // Strip optional currency symbols and whitespace: ₱, P, PHP
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^PHP\s*/i, '');
  cleaned = cleaned.replace(/^[₱P]\s*/i, '');
  cleaned = cleaned.trim();

  if (cleaned.length === 0) {
    throw new Error('Kailangan maglagay ng presyo');
  }

  // Reject negative numbers or invalid characters
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    throw new Error(`Maling format ng presyo: "${raw}"`);
  }

  const parts = cleaned.split('.');
  const wholePart = parts[0];
  const decimalPart = parts[1] ?? '';

  const whole = Number.parseInt(wholePart, 10);
  if (!Number.isSafeInteger(whole) || whole < 0) {
    throw new Error('Masyadong malaki ang presyo');
  }

  let centavosFromFraction = 0;
  if (decimalPart.length === 1) {
    centavosFromFraction = Number.parseInt(decimalPart, 10) * 10;
  } else if (decimalPart.length === 2) {
    centavosFromFraction = Number.parseInt(decimalPart, 10);
  }

  const totalCentavos = whole * 100 + centavosFromFraction;
  if (!Number.isSafeInteger(totalCentavos) || totalCentavos < 0) {
    throw new Error('Masyadong malaki ang presyo');
  }

  return totalCentavos;
}

export function formatCentavos(centavos: number): string {
  if (!Number.isSafeInteger(centavos) || centavos < 0) {
    throw new Error(`Maling centavos: ${centavos}`);
  }

  const whole = Math.floor(centavos / 100);
  const fraction = centavos % 100;
  const fractionStr = fraction < 10 ? `0${fraction}` : `${fraction}`;

  return `₱${whole}.${fractionStr}`;
}
