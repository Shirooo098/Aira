import type { DatabaseSession } from '../db/database.ts';
import type { ProductWithStock } from '../types.ts';
import {
  parseSpokenOrder,
  SpokenOrderValidationError,
  type ParsedSpokenOrder,
  type SpokenCartLine,
} from '../domain/spoken-order.ts';
import { lookupProduct } from './catalog-actions.ts';
import { getAllProductsWithStock } from './inventory-actions.ts';

export type { SpokenCartLine } from '../domain/spoken-order.ts';
export { SpokenOrderValidationError } from '../domain/spoken-order.ts';

export type SpokenOrderProposal =
  | {
      kind: 'add';
      items: Array<{
        query: string;
        quantity: number | null;
        product: ProductWithStock | null;
        candidates: ProductWithStock[];
        message: string | null;
      }>;
    }
  | {
      kind: 'set_quantity' | 'remove';
      quantity: number | null;
      targetProductId: string | null;
      candidates: SpokenCartLine[];
      message: string | null;
    };

export interface SpokenOrderSelection {
  items?: Array<{ productId: string; quantity: number }>;
  targetProductId?: string;
}

const ADD_ITEM_LIMIT = 20;

function requireProduct(product: ProductWithStock): ProductWithStock {
  if (
    !product ||
    typeof product !== 'object' ||
    typeof product.id !== 'string' ||
    !product.id.trim() ||
    typeof product.name !== 'string' ||
    typeof product.variant !== 'string' ||
    typeof product.unit !== 'string' ||
    !Number.isSafeInteger(product.priceCentavos) ||
    product.priceCentavos < 0 ||
    typeof product.createdAt !== 'string' ||
    typeof product.updatedAt !== 'string' ||
    (product.quantity !== null && (!Number.isSafeInteger(product.quantity) || product.quantity < 0)) ||
    (product.stockUpdatedAt !== null && typeof product.stockUpdatedAt !== 'string')
  ) {
    throw new SpokenOrderValidationError('Hindi kumpleto ang napiling produkto. Suriin muli ang listahan.');
  }
  return product;
}

function requireQuantity(quantity: unknown): number {
  if (!Number.isSafeInteger(quantity) || (quantity as number) <= 0) {
    throw new SpokenOrderValidationError('Dapat positibong buong bilang ang dami ng produkto.');
  }
  return quantity as number;
}

function combineMessage(...messages: Array<string | null>): string | null {
  const unique = [...new Set(messages.filter((message): message is string => !!message))];
  return unique.length > 0 ? unique.join(' ') : null;
}

function productDisplayName(product: ProductWithStock): string {
  return `${product.name} ${product.variant}`.trim();
}

function candidateLines(cart: SpokenCartLine[]): SpokenCartLine[] {
  const seen = new Set<string>();
  return cart.filter((line) => {
    if (seen.has(line.product.id)) return false;
    seen.add(line.product.id);
    return true;
  });
}

async function prepareAddProposal(
  db: DatabaseSession,
  parsed: Extract<ParsedSpokenOrder, { kind: 'add' }>
): Promise<SpokenOrderProposal> {
  if (parsed.items.length === 0 || parsed.items.length > ADD_ITEM_LIMIT) {
    throw new SpokenOrderValidationError('Walang produkto sa order o masyadong mahaba ang listahan.');
  }

  const products = await getAllProductsWithStock(db);
  const byId = new Map(products.map((product) => [product.id, product]));
  const items = await Promise.all(parsed.items.map(async (item) => {
    const lookup = await lookupProduct(db, item.query);
    let product: ProductWithStock | null = null;
    let candidates: ProductWithStock[] = [];
    let resolutionMessage: string | null = null;

    if (lookup.kind === 'exact') {
      product = byId.get(lookup.product.id) ?? null;
      if (!product) {
        resolutionMessage = 'Nagbago ang catalog habang inihahanda ang order. Suriin muli ang produkto.';
      }
    } else if (lookup.kind === 'ambiguous') {
      candidates = lookup.products
        .map((candidate) => byId.get(candidate.id))
        .filter((candidate): candidate is ProductWithStock => candidate !== undefined);
      resolutionMessage = candidates.length > 0
        ? 'May posibleng tugma ang pangalan; piliin muna ang tamang produkto.'
        : 'Walang available na tugma sa kasalukuyang catalog; suriin muli ang produkto.';
    } else {
      candidates = products;
      resolutionMessage = candidates.length > 0
        ? 'Walang direktang tugma; pumili nang sadya sa mga naka-save na produkto.'
        : 'Walang tugma at wala pang naka-save na produkto sa catalog.';
    }

    const quantityMessage = item.quantity === null
      ? 'Hindi nabanggit ang dami; ilagay ito bago idagdag.'
      : null;

    return {
      query: item.query,
      quantity: item.quantity,
      product,
      candidates,
      message: combineMessage(resolutionMessage, quantityMessage),
    };
  }));

  return { kind: 'add', items };
}

async function prepareCorrectionProposal(
  db: DatabaseSession,
  parsed: Extract<ParsedSpokenOrder, { kind: 'set_quantity' | 'remove' }>,
  cart: SpokenCartLine[]
): Promise<SpokenOrderProposal> {
  const lines = candidateLines(cart);
  const quantity = parsed.kind === 'set_quantity' ? parsed.quantity : null;
  if (lines.length === 0) {
    return {
      kind: parsed.kind,
      quantity,
      targetProductId: null,
      candidates: [],
      message: 'Walang laman ang kasalukuyang cart na maitama o maalis.',
    };
  }

  if (parsed.query === null) {
    if (lines.length === 1) {
      return {
        kind: parsed.kind,
        quantity,
        targetProductId: lines[0]?.product.id ?? null,
        candidates: [],
        message: null,
      };
    }
    return {
      kind: parsed.kind,
      quantity,
      targetProductId: null,
      candidates: lines,
      message: 'Piliin kung aling produkto sa cart ang itatama o aalisin.',
    };
  }

  const lookup = await lookupProduct(db, parsed.query);
  if (lookup.kind === 'exact') {
    const inCart = lines.find((line) => line.product.id === lookup.product.id);
    return {
      kind: parsed.kind,
      quantity,
      targetProductId: inCart?.product.id ?? null,
      candidates: [],
      message: inCart
        ? null
        : `Wala sa kasalukuyang cart ang ${productDisplayName({
            ...lookup.product,
            quantity: null,
            stockUpdatedAt: null,
          })}.`,
    };
  }

  if (lookup.kind === 'ambiguous') {
    const matchingIds = new Set(lookup.products.map((product) => product.id));
    const candidates = lines.filter((line) => matchingIds.has(line.product.id));
    return {
      kind: parsed.kind,
      quantity,
      targetProductId: null,
      candidates,
      message: candidates.length > 0
        ? 'May posibleng tugma sa cart; piliin muna ang tamang produkto.'
        : 'Walang posibleng tugma sa kasalukuyang cart.',
    };
  }

  return {
    kind: parsed.kind,
    quantity,
    targetProductId: null,
    candidates: [],
    message: 'Hindi nahanap ang produktong babaguhin sa catalog at kasalukuyang cart.',
  };
}

/** Prepare a voice order or correction using catalog/alias lookup, without writes. */
export async function prepareSpokenOrder(
  db: DatabaseSession,
  text: string,
  cart: SpokenCartLine[]
): Promise<SpokenOrderProposal> {
  const parsed = parseSpokenOrder(text);
  if (parsed.kind === 'unsupported') {
    throw new SpokenOrderValidationError(parsed.message);
  }
  if (parsed.kind === 'add') return prepareAddProposal(db, parsed);
  return prepareCorrectionProposal(db, parsed, normalizeCart(cart));
}

function normalizeCart(cart: SpokenCartLine[]): SpokenCartLine[] {
  if (!Array.isArray(cart)) {
    throw new SpokenOrderValidationError('Hindi mabasa ang kasalukuyang cart.');
  }
  const normalized: SpokenCartLine[] = [];
  const byId = new Map<string, SpokenCartLine>();
  for (const line of cart) {
    if (!line || typeof line !== 'object') {
      throw new SpokenOrderValidationError('May hindi kumpletong produkto sa kasalukuyang cart.');
    }
    const product = requireProduct(line.product);
    const quantity = requireQuantity(line.quantity);
    const existing = byId.get(product.id);
    if (existing) {
      const combined = existing.quantity + quantity;
      if (!Number.isSafeInteger(combined)) {
        throw new SpokenOrderValidationError('Masyadong malaki ang pinagsamang dami ng produkto.');
      }
      existing.quantity = combined;
    } else {
      const copy = { product, quantity };
      normalized.push(copy);
      byId.set(product.id, copy);
    }
  }
  return normalized;
}

function getSelectionItems(
  proposalItems: Array<{ query: string; product: ProductWithStock | null; candidates: ProductWithStock[]; quantity: number | null }>,
  selection: SpokenOrderSelection | undefined
): Array<{ product: ProductWithStock; quantity: number }> {
  const selectedItems = selection?.items;
  if (selectedItems !== undefined && (!Array.isArray(selectedItems) || selectedItems.length !== proposalItems.length)) {
    throw new SpokenOrderValidationError('Piliin ang produkto at dami para sa bawat linya ng order.');
  }

  return proposalItems.map((item, index) => {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof item.query !== 'string' ||
      !item.query.trim() ||
      !Array.isArray(item.candidates)
    ) {
      throw new SpokenOrderValidationError('Hindi kumpleto ang isang linya sa nirepasong order.');
    }
    if (item.product) requireProduct(item.product);
    for (const candidate of item.candidates) requireProduct(candidate);

    const chosen = selectedItems?.[index];
    let product: ProductWithStock | null = item.product;
    let quantity: number | null = item.quantity;

    if (chosen !== undefined) {
      if (!chosen || typeof chosen !== 'object' || typeof chosen.productId !== 'string' || !chosen.productId.trim()) {
        throw new SpokenOrderValidationError('Pumili ng produkto mula sa mga ipinakitang tugma.');
      }
      const candidate = item.candidates.find((entry) => entry.id === chosen.productId);
      if (item.product) {
        if (item.product.id !== chosen.productId) {
          throw new SpokenOrderValidationError('Nagbago ang eksaktong tugma ng produkto; ihanda muli ang order.');
        }
        product = item.product;
      } else if (candidate) {
        product = candidate;
      } else {
        throw new SpokenOrderValidationError('Pumili lamang mula sa mga produktong ipinakita para sa item na ito.');
      }
      quantity = requireQuantity(chosen.quantity);
    }

    if (!product) {
      throw new SpokenOrderValidationError('Hindi pa napipili ang tamang produkto. Pumili muna ng produkto mula sa mga mungkahi.');
    }
    if (quantity === null) {
      throw new SpokenOrderValidationError('Hindi pa naitakda ang dami ng produkto. Ilagay muna ang dami.');
    }
    return { product: requireProduct(product), quantity: requireQuantity(quantity) };
  });
}

/** Apply only a reviewed proposal, returning a new cart without mutating inputs. */
export function applySpokenOrderProposal(
  cart: SpokenCartLine[],
  proposal: SpokenOrderProposal,
  selection?: SpokenOrderSelection
): SpokenCartLine[] {
  const currentCart = normalizeCart(cart);
  if (!proposal || typeof proposal !== 'object') {
    throw new SpokenOrderValidationError('Hindi mabasa ang nirepasong order. Ihanda muli bago ilapat.');
  }
  if (selection !== undefined && (!selection || typeof selection !== 'object')) {
    throw new SpokenOrderValidationError('Hindi mabasa ang piniling produkto o dami.');
  }

  if (proposal.kind === 'add') {
    if (!Array.isArray(proposal.items) || proposal.items.length === 0 || proposal.items.length > ADD_ITEM_LIMIT) {
      throw new SpokenOrderValidationError('Walang maidaragdag na item sa nirepasong order.');
    }
    const selected = getSelectionItems(proposal.items, selection);
    const result = currentCart.map((line) => ({ ...line }));
    const byId = new Map(result.map((line) => [line.product.id, line]));

    for (const item of selected) {
      const existing = byId.get(item.product.id);
      if (existing) {
        const combined = existing.quantity + item.quantity;
        if (!Number.isSafeInteger(combined)) {
          throw new SpokenOrderValidationError('Masyadong malaki ang pinagsamang dami ng produkto.');
        }
        existing.quantity = combined;
      } else {
        const line = { product: item.product, quantity: item.quantity };
        result.push(line);
        byId.set(item.product.id, line);
      }
    }
    return result;
  }

  if (proposal.kind !== 'set_quantity' && proposal.kind !== 'remove') {
    throw new SpokenOrderValidationError('Hindi suportado ang ganitong pagbabago sa cart.');
  }
  if (!Array.isArray(proposal.candidates)) {
    throw new SpokenOrderValidationError('Hindi kumpleto ang mga pagpipilian para sa pagwawasto. Ihanda muli ito.');
  }
  if (proposal.kind === 'remove' && proposal.quantity !== null) {
    throw new SpokenOrderValidationError('Hindi wasto ang nirepasong utos na mag-alis ng produkto.');
  }
  if (currentCart.length === 0) {
    throw new SpokenOrderValidationError('Walang laman ang cart na maitama o maalis.');
  }

  const candidateIds = new Set<string>();
  for (const candidate of proposal.candidates) {
    if (!candidate || typeof candidate !== 'object') {
      throw new SpokenOrderValidationError('Hindi kumpleto ang isang pagpipilian para sa pagwawasto.');
    }
    const product = requireProduct(candidate.product);
    requireQuantity(candidate.quantity);
    if (!currentCart.some((line) => line.product.id === product.id)) {
      throw new SpokenOrderValidationError('Nagbago ang cart matapos ihanda ang pagwawasto. Ihanda muli ito.');
    }
    candidateIds.add(product.id);
  }

  let targetProductId = proposal.targetProductId;
  if (selection?.targetProductId !== undefined) {
    const selectedId = selection.targetProductId;
    if (typeof selectedId !== 'string' || !selectedId.trim()) {
      throw new SpokenOrderValidationError('Pumili ng produktong nasa kasalukuyang cart.');
    }
    if (targetProductId && targetProductId !== selectedId) {
      throw new SpokenOrderValidationError('Nagbago ang piniling produkto para sa pagwawasto.');
    }
    if (!targetProductId && !candidateIds.has(selectedId)) {
      throw new SpokenOrderValidationError('Pumili lamang mula sa mga produktong ipinakita sa kasalukuyang cart.');
    }
    targetProductId = selectedId;
  }

  if (!targetProductId || !currentCart.some((line) => line.product.id === targetProductId)) {
    throw new SpokenOrderValidationError('Piliin kung aling produkto sa kasalukuyang cart ang itatama o aalisin.');
  }

  if (proposal.kind === 'remove') {
    return currentCart.filter((line) => line.product.id !== targetProductId);
  }

  const quantity = requireQuantity(proposal.quantity);
  return currentCart.map((line) => line.product.id === targetProductId
    ? { product: line.product, quantity }
    : { ...line });
}
