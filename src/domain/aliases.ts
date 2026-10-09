import type { Product } from '../types.ts';

export class AliasValidationError extends Error {}

export interface AliasProposal {
  aliasText: string;
  aliasNormalized: string;
  product: Product;
  conflicts: Product[];
}

export interface ValidatedAlias {
  aliasText: string;
  aliasNormalized: string;
}

export function normalizeAlias(text: string): string {
  return text.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function validateAlias(text: string): ValidatedAlias {
  if (typeof text !== 'string') {
    throw new AliasValidationError('Kailangang maglagay ng palayaw ng produkto');
  }

  const aliasText = text.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (aliasText.length === 0) {
    throw new AliasValidationError('Kailangang maglagay ng palayaw ng produkto');
  }
  if ([...aliasText].length > 120) {
    throw new AliasValidationError('Masyadong mahaba ang palayaw ng produkto (hanggang 120 karakter)');
  }

  const aliasNormalized = normalizeAlias(aliasText);
  if ([...aliasNormalized].length > 120) {
    throw new AliasValidationError('Masyadong mahaba ang palayaw ng produkto (hanggang 120 karakter)');
  }

  return { aliasText, aliasNormalized };
}
