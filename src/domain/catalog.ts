import type { ProductDraft } from '../types.ts';

export class CatalogValidationError extends Error {}

export interface ValidatedProductDraft {
  name: string;
  variant: string;
  unit: string;
  priceCentavos: number;
  nameNormalized: string;
  variantNormalized: string;
  unitNormalized: string;
}

export function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

export function validateProductDraft(draft: ProductDraft): ValidatedProductDraft {
  if (!draft || typeof draft !== 'object') {
    throw new CatalogValidationError('Kailangang maglagay ng detalye ng produkto');
  }

  const name = typeof draft.name === 'string' ? draft.name.trim() : '';
  if (name.length === 0) {
    throw new CatalogValidationError('Kailangan ang pangalan ng produkto');
  }

  const variant = typeof draft.variant === 'string' ? draft.variant.trim() : '';
  if (variant.length === 0) {
    throw new CatalogValidationError('Kailangan ang variant o sukat ng produkto');
  }

  const unit = typeof draft.unit === 'string' ? draft.unit.trim() : '';
  if (unit.length === 0) {
    throw new CatalogValidationError('Kailangan ang unit ng produkto (hal. piraso, bote, pack)');
  }

  const priceCentavos = draft.priceCentavos;
  if (!Number.isSafeInteger(priceCentavos) || priceCentavos < 0) {
    throw new CatalogValidationError('Maling halaga ng presyo sa centavos');
  }

  return {
    name,
    variant,
    unit,
    priceCentavos,
    nameNormalized: normalizeText(name),
    variantNormalized: normalizeText(variant),
    unitNormalized: normalizeText(unit),
  };
}

export function generateProductId(): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `prod_${timestamp}_${randomPart}`;
}
