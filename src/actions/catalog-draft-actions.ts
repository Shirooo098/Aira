import type { DatabaseSession } from '../db/database.ts';
import type { Product, ProductDraft } from '../types.ts';
import type { CatalogChangeFields, CatalogChangeKind } from '../domain/catalog-dictation.ts';
import { normalizeText, validateProductDraft } from '../domain/catalog.ts';
import { parseCentavos } from '../domain/money.ts';
import { validateDeliveryQuantity, validateStockQuantity } from '../domain/inventory.ts';
import { getProductById, lookupProduct, saveProduct, updateProductPrice } from './catalog-actions.ts';
import { getStockLevel, recordDelivery, setStockCount } from './inventory-actions.ts';

export class CatalogChangeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogChangeValidationError';
  }
}

interface CatalogChangeProposalBase {
  kind: CatalogChangeKind;
  priceCentavos: number | null;
  quantity: number | null;
  previousQuantity: number | null;
}

export type CatalogChangeProposal =
  | (CatalogChangeProposalBase & {
      kind: 'new_product';
      product: ProductDraft;
      priceCentavos: number;
      quantity: number;
      previousQuantity: null;
    })
  | (CatalogChangeProposalBase & {
      kind: 'price_update';
      product: Product;
      priceCentavos: number;
      quantity: null;
      previousQuantity: null;
    })
  | (CatalogChangeProposalBase & {
      kind: 'set_count' | 'add_delivery';
      product: Product;
      priceCentavos: null;
      quantity: number;
      previousQuantity: number | null;
    });

function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CatalogChangeValidationError(message);
  }
  return value.trim();
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function rejectUnexpectedText(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length > 0) {
    throw new CatalogChangeValidationError(`${field} ay hindi bahagi ng pagbabagong ito; hatiin ito sa magkahiwalay na draft`);
  }
}

function canonicalUnit(value: string): string {
  const unit = normalizeText(value).replace(/\s+/g, ' ');
  if (/^(?:pieces?|pcs?\.?|piraso)$/.test(unit)) return 'piraso';
  if (/^(?:bottles?|bote|botelya)$/.test(unit)) return 'bote';
  if (/^(?:packs?|pakete)$/.test(unit)) return 'pack';
  if (/^sachets?$/.test(unit)) return 'sachet';
  if (/^(?:boxes?|kahon)$/.test(unit)) return 'kahon';
  if (/^(?:cans?|lata)$/.test(unit)) return 'lata';
  if (/^(?:kilos?|kilograms?|kg)$/.test(unit)) return 'kilo';
  if (/^(?:grams?|g)$/.test(unit)) return 'gramo';
  if (/^(?:liters?|litres?|l)$/.test(unit)) return 'litro';
  if (/^(?:milliliters?|millilitres?|ml)$/.test(unit)) return 'ml';
  return unit;
}

function assertSelectedAttributes(fields: CatalogChangeFields, product: Product): void {
  if (hasText(fields.variant) && normalizeText(fields.variant) !== normalizeText(product.variant)) {
    throw new CatalogChangeValidationError(
      `Hindi tugma ang variant na "${fields.variant.trim()}" sa napiling produkto (${product.variant})`
    );
  }
  if (hasText(fields.unit) && canonicalUnit(fields.unit) !== canonicalUnit(product.unit)) {
    throw new CatalogChangeValidationError(
      `Hindi tugma ang unit na "${fields.unit.trim()}" sa napiling produkto (${product.unit})`
    );
  }
}

function parsePrice(value: string): number {
  try {
    return parseCentavos(value);
  } catch (error) {
    throw new CatalogChangeValidationError(
      error instanceof Error ? error.message : 'Maling halaga ng presyo'
    );
  }
}

function parseCount(value: string, kind: 'set_count' | 'add_delivery' | 'new_product'): number {
  let parsed: number;
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new CatalogChangeValidationError('Dapat buong numero (integer) ang bilang; walang decimal');
  }
  parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    throw new CatalogChangeValidationError('Masyadong malaki ang bilang ng stock');
  }

  try {
    return kind === 'add_delivery'
      ? validateDeliveryQuantity(parsed)
      : validateStockQuantity(parsed);
  } catch (error) {
    throw new CatalogChangeValidationError(
      error instanceof Error ? error.message : 'Maling bilang ng stock'
    );
  }
}

function productLookupError(fields: CatalogChangeFields): CatalogChangeValidationError {
  const query = typeof fields.productQuery === 'string' ? fields.productQuery.trim() : '';
  if (fields.productId !== null) {
    return new CatalogChangeValidationError('Hindi na makita ang napiling produkto; pumili muli');
  }
  if (!query) {
    return new CatalogChangeValidationError('Piliin o banggitin ang produktong babaguhin');
  }
  return new CatalogChangeValidationError(`Hindi mahanap ang produkto: "${query}"`);
}

async function resolveExistingProduct(
  db: DatabaseSession,
  fields: CatalogChangeFields
): Promise<Product> {
  if (fields.productId !== null) {
    if (typeof fields.productId !== 'string' || fields.productId.trim().length === 0) {
      throw new CatalogChangeValidationError('Maling napiling produkto');
    }
    const product = await getProductById(db, fields.productId.trim());
    if (product) return product;
    throw productLookupError(fields);
  }

  const query = requiredText(fields.productQuery, 'Piliin o banggitin ang produktong babaguhin');
  const result = await lookupProduct(db, query);
  if (result.kind === 'exact') return result.product;
  if (result.kind === 'ambiguous') {
    const choices = result.products.map((product) => `${product.name} (${product.variant}, ${product.unit})`);
    throw new CatalogChangeValidationError(
      `Maraming katugmang produkto sa "${query}"; pumili ng isa: ${choices.join('; ')}`
    );
  }
  throw productLookupError(fields);
}

async function getCurrentQuantity(db: DatabaseSession, productId: string): Promise<number | null> {
  const stock = await getStockLevel(db, productId);
  return stock?.quantity ?? null;
}

async function rejectDuplicateIdentity(db: DatabaseSession, draft: ProductDraft): Promise<void> {
  const validated = validateProductDraft(draft);
  const duplicate = await db.getFirst<{ id: string }>(
    `SELECT id FROM products
     WHERE name_normalized = ? AND variant_normalized = ? AND unit_normalized = ?;`,
    [validated.nameNormalized, validated.variantNormalized, validated.unitNormalized]
  );
  if (duplicate) {
    throw new CatalogChangeValidationError(
      `Mayroon nang ganitong produkto: "${validated.name}" (${validated.variant}, ${validated.unit}). Piliin ang pagbabago ng presyo, bilang, o delivery.`
    );
  }
}

export async function prepareCatalogChange(
  db: DatabaseSession,
  fields: CatalogChangeFields
): Promise<CatalogChangeProposal> {
  if (!fields || typeof fields !== 'object') {
    throw new CatalogChangeValidationError('Kailangang suriin muna ang mga detalye ng pagbabago');
  }

  if (fields.kind === 'new_product') {
    rejectUnexpectedText(fields.productQuery, 'Product query');
    if (fields.productId !== null) {
      throw new CatalogChangeValidationError('Hindi kailangan pumili ng kasalukuyang produkto para sa bagong produkto');
    }
    const product: ProductDraft = {
      name: requiredText(fields.name, 'Kailangan ang pangalan ng bagong produkto'),
      variant: requiredText(fields.variant, 'Kailangan ang variant o sukat ng produkto'),
      unit: requiredText(fields.unit, 'Kailangan ang unit ng produkto'),
      priceCentavos: parsePrice(requiredText(fields.priceInput, 'Kailangan ang presyo')),
    };
    try {
      validateProductDraft(product);
    } catch (error) {
      throw new CatalogChangeValidationError(
        error instanceof Error ? error.message : 'Maling detalye ng produkto'
      );
    }
    const quantity = parseCount(
      requiredText(fields.quantityInput, 'Kailangan ang panimulang bilang'),
      'new_product'
    );
    await rejectDuplicateIdentity(db, product);
    return {
      kind: 'new_product',
      product,
      priceCentavos: product.priceCentavos,
      quantity,
      previousQuantity: null,
    };
  }

  if (fields.kind !== 'price_update' && fields.kind !== 'set_count' && fields.kind !== 'add_delivery') {
    throw new CatalogChangeValidationError('Hindi suportadong uri ng pagbabago sa catalog');
  }

  rejectUnexpectedText(fields.name, 'Pangalan ng bagong produkto');
  if (fields.kind === 'price_update') {
    rejectUnexpectedText(fields.quantityInput, 'Bilang ng stock');
  } else {
    rejectUnexpectedText(fields.priceInput, 'Presyo');
  }

  const product = await resolveExistingProduct(db, fields);
  assertSelectedAttributes(fields, product);
  if (fields.kind === 'price_update') {
    return {
      kind: 'price_update',
      product,
      priceCentavos: parsePrice(requiredText(fields.priceInput, 'Kailangan ang bagong presyo')),
      quantity: null,
      previousQuantity: null,
    };
  }

  const quantity = parseCount(
    requiredText(
      fields.quantityInput,
      fields.kind === 'set_count' ? 'Kailangan ang bagong bilang ng stock' : 'Kailangan ang dami ng delivery'
    ),
    fields.kind
  );
  return {
    kind: fields.kind,
    product,
    priceCentavos: null,
    quantity,
    previousQuantity: await getCurrentQuantity(db, product.id),
  };
}

function transactionSession(db: DatabaseSession): DatabaseSession {
  return {
    exec: async (sql) => {
      if (/^(?:BEGIN\s+IMMEDIATE|COMMIT|ROLLBACK)\s*;?$/i.test(sql.trim())) return;
      await db.exec(sql);
    },
    run: (sql, params) => db.run(sql, params),
    getAll: (sql, params) => db.getAll(sql, params),
    getFirst: (sql, params) => db.getFirst(sql, params),
  };
}

function sameProductIdentity(current: Product, snapshot: Product): boolean {
  return (
    current.id === snapshot.id &&
    current.name === snapshot.name &&
    current.variant === snapshot.variant &&
    current.unit === snapshot.unit
  );
}

async function assertExistingSnapshot(
  db: DatabaseSession,
  proposal: Extract<CatalogChangeProposal, { product: Product }>
): Promise<void> {
  const current = await getProductById(db, proposal.product.id);
  if (!current || !sameProductIdentity(current, proposal.product)) {
    throw new CatalogChangeValidationError('Nagbago o nawala ang pagkakakilanlan ng produkto; suriin muli');
  }
  if (current.priceCentavos !== proposal.product.priceCentavos) {
    throw new CatalogChangeValidationError('Nagbago na ang presyo; suriin muli ang draft');
  }

  if (proposal.kind === 'set_count' || proposal.kind === 'add_delivery') {
    const quantity = await getCurrentQuantity(db, current.id);
    if (quantity !== proposal.previousQuantity) {
      throw new CatalogChangeValidationError('Nagbago na ang stock; suriin muli ang draft');
    }
  }
}

function assertNewProposal(proposal: Extract<CatalogChangeProposal, { kind: 'new_product' }>): void {
  try {
    validateProductDraft(proposal.product);
  } catch (error) {
    throw new CatalogChangeValidationError(
      error instanceof Error ? error.message : 'Maling detalye ng produkto'
    );
  }
  if (proposal.priceCentavos !== proposal.product.priceCentavos) {
    throw new CatalogChangeValidationError('Nagkakaiba ang presyo ng produkto at draft');
  }
  if (!Number.isSafeInteger(proposal.quantity) || proposal.quantity < 0) {
    throw new CatalogChangeValidationError('Maling panimulang bilang ng stock');
  }
}

function assertStockProposal(proposal: Extract<CatalogChangeProposal, { kind: 'set_count' | 'add_delivery' }>): void {
  if (proposal.priceCentavos !== null) {
    throw new CatalogChangeValidationError('Hindi maaaring magpalit ng presyo sa pagbabago ng stock');
  }
  if (proposal.quantity === null || !Number.isSafeInteger(proposal.quantity)) {
    throw new CatalogChangeValidationError('Maling bilang ng stock');
  }
  if (
    proposal.previousQuantity !== null &&
    (!Number.isSafeInteger(proposal.previousQuantity) || proposal.previousQuantity < 0)
  ) {
    throw new CatalogChangeValidationError('Maling snapshot ng dating stock');
  }
  try {
    if (proposal.kind === 'set_count') validateStockQuantity(proposal.quantity);
    else validateDeliveryQuantity(proposal.quantity);
  } catch (error) {
    throw new CatalogChangeValidationError(
      error instanceof Error ? error.message : 'Maling bilang ng stock'
    );
  }
}

export async function confirmCatalogChange(
  db: DatabaseSession,
  proposal: CatalogChangeProposal
): Promise<Product> {
  if (!proposal || typeof proposal !== 'object') {
    throw new CatalogChangeValidationError('Walang nasuring pagbabago sa catalog');
  }

  await db.exec('BEGIN IMMEDIATE');
  try {
    let updated: Product;
    const nested = transactionSession(db);

    if (proposal.kind === 'new_product') {
      assertNewProposal(proposal);
      await rejectDuplicateIdentity(db, proposal.product);
      updated = await saveProduct(nested, proposal.product);
      await setStockCount(nested, {
        productId: updated.id,
        newQuantity: proposal.quantity,
        note: 'Panimulang bilang mula sa catalog draft',
      });
    } else if (proposal.kind === 'price_update') {
      await assertExistingSnapshot(db, proposal);
      if (
        proposal.priceCentavos === null ||
        !Number.isSafeInteger(proposal.priceCentavos) ||
        proposal.priceCentavos < 0 ||
        proposal.quantity !== null ||
        proposal.previousQuantity !== null
      ) {
        throw new CatalogChangeValidationError('Maling bagong presyo');
      }
      updated = await updateProductPrice(nested, proposal.product.id, proposal.priceCentavos);
    } else if (proposal.kind === 'set_count' || proposal.kind === 'add_delivery') {
      await assertExistingSnapshot(db, proposal);
      assertStockProposal(proposal);
      if (proposal.kind === 'set_count') {
        await setStockCount(nested, {
          productId: proposal.product.id,
          newQuantity: proposal.quantity,
          note: 'Catalog draft',
        });
      } else {
        const nextQuantity = (proposal.previousQuantity ?? 0) + proposal.quantity;
        if (!Number.isSafeInteger(nextQuantity)) {
          throw new CatalogChangeValidationError('Lalampas sa ligtas na hangganan ang stock pagkatapos ng delivery');
        }
        await recordDelivery(nested, {
          productId: proposal.product.id,
          deliveryQuantity: proposal.quantity,
          note: 'Catalog draft',
        });
      }
      updated = proposal.product;
    } else {
      throw new CatalogChangeValidationError('Hindi suportadong uri ng pagbabago sa catalog');
    }

    await db.exec('COMMIT');
    return updated;
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // Preserve the original failure after attempting to roll back all writes.
    }
    throw error;
  }
}
