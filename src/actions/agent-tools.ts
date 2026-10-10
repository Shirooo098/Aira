import type { DatabaseSession } from '../db/database.ts';
import { getAllProductsWithStock } from './inventory-actions.ts';
import { lookupProduct } from './catalog-actions.ts';
import {
  AgentRequestValidationError,
  parseAgentToolRequest,
  type AgentToolRequest,
} from '../agent/agent-contract.ts';
import type { LookupResult, ProductWithStock } from '../types.ts';

export type AgentToolResult =
  | { kind: 'catalog_lookup'; query: string; lookup: LookupResult }
  | {
      kind: 'cart_item_proposal';
      query: string;
      quantity: number;
      resolution: 'exact' | 'ambiguous' | 'unknown';
      product: ProductWithStock | null;
      candidates: ProductWithStock[];
      requiresOwnerReview: true;
      message: string;
    };

export interface ReviewedAgentCartItem {
  product: ProductWithStock;
  quantity: number;
}

function validateRequest(request: unknown): AgentToolRequest {
  if (typeof request !== 'object' || request === null || Array.isArray(request)) {
    throw new AgentRequestValidationError('Hindi valid ang agent tool request.');
  }
  const prototype = Object.getPrototypeOf(request);
  if ((prototype !== Object.prototype && prototype !== null) || Reflect.ownKeys(request).some((key) => typeof key !== 'string')) {
    throw new AgentRequestValidationError('Hindi valid ang agent tool request.');
  }
  const record = request as Record<string, unknown>;
  const keys = Reflect.ownKeys(record) as string[];
  const expectedKeys = record.tool === 'catalog_lookup'
    ? ['tool', 'query']
    : record.tool === 'propose_cart_item'
      ? ['tool', 'query', 'quantity']
      : [];
  if (expectedKeys.length === 0 || keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new AgentRequestValidationError('Hindi tugma ang fields sa agent tool contract.');
  }
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(request);
  } catch {
    throw new AgentRequestValidationError('Hindi valid ang agent tool request.');
  }
  if (typeof serialized !== 'string') {
    throw new AgentRequestValidationError('Hindi valid ang agent tool request.');
  }
  return parseAgentToolRequest(serialized);
}

function toProposalMessage(resolution: 'exact' | 'ambiguous' | 'unknown'): string {
  switch (resolution) {
    case 'exact':
      return 'Nahanap ang produkto. Suriin ang pangalan, presyo, stock, at dami bago idagdag sa draft.';
    case 'ambiguous':
      return 'May posibleng tugma sa catalog. Piliin ang tamang variant bago idagdag sa draft.';
    case 'unknown':
      return 'Walang direktang tugma sa catalog. Hindi maaaring magdagdag ng hindi kilalang produkto.';
  }
}

/** Execute only the two host-defined, read-only tool requests. */
export async function prepareAgentTool(
  db: DatabaseSession,
  request: AgentToolRequest,
): Promise<AgentToolResult> {
  const safeRequest = validateRequest(request);
  const lookup = await lookupProduct(db, safeRequest.query);

  if (safeRequest.tool === 'catalog_lookup') {
    return { kind: 'catalog_lookup', query: safeRequest.query, lookup };
  }

  const products = await getAllProductsWithStock(db);
  const byId = new Map(products.map((product) => [product.id, product]));
  if (lookup.kind === 'exact') {
    const product = byId.get(lookup.product.id) ?? null;
    const resolution = product ? 'exact' : 'unknown';
    return {
      kind: 'cart_item_proposal',
      query: safeRequest.query,
      quantity: safeRequest.quantity,
      resolution,
      product,
      candidates: [],
      requiresOwnerReview: true,
      message: product
        ? toProposalMessage('exact')
        : 'Nagbago ang catalog habang inihahanda ang proposal. Hanapin muli ang produkto.',
    };
  }

  if (lookup.kind === 'ambiguous') {
    const candidates = lookup.products
      .map((candidate) => byId.get(candidate.id))
      .filter((candidate): candidate is ProductWithStock => candidate !== undefined);
    return {
      kind: 'cart_item_proposal',
      query: safeRequest.query,
      quantity: safeRequest.quantity,
      resolution: candidates.length > 0 ? 'ambiguous' : 'unknown',
      product: null,
      candidates,
      requiresOwnerReview: true,
      message: candidates.length > 0
        ? toProposalMessage('ambiguous')
        : 'Walang available na tugma sa kasalukuyang catalog. Hanapin muli ang produkto.',
    };
  }

  return {
    kind: 'cart_item_proposal',
    query: safeRequest.query,
    quantity: safeRequest.quantity,
    resolution: 'unknown',
    product: null,
    candidates: [],
    requiresOwnerReview: true,
    message: toProposalMessage('unknown'),
  };
}

function isProductWithStock(value: unknown): value is ProductWithStock {
  if (typeof value !== 'object' || value === null) return false;
  const product = value as Record<string, unknown>;
  return typeof product.id === 'string' && product.id.trim().length > 0 &&
    typeof product.name === 'string' && typeof product.variant === 'string' &&
    typeof product.unit === 'string' && Number.isSafeInteger(product.priceCentavos) &&
    (product.priceCentavos as number) >= 0 && typeof product.createdAt === 'string' &&
    typeof product.updatedAt === 'string' &&
    (product.quantity === null || (Number.isSafeInteger(product.quantity) && (product.quantity as number) >= 0)) &&
    (product.stockUpdatedAt === null || typeof product.stockUpdatedAt === 'string');
}

/** Explicitly review a cart proposal into temporary draft data; this function never writes. */
export function reviewAgentCartProposal(
  proposal: AgentToolResult,
  selectedCandidateId?: string,
): ReviewedAgentCartItem {
  if (!proposal || proposal.kind !== 'cart_item_proposal' || proposal.requiresOwnerReview !== true) {
    throw new AgentRequestValidationError('Walang cart proposal na maaaring repasuhin.');
  }
  if (typeof proposal.query !== 'string' || !proposal.query.trim() || typeof proposal.message !== 'string') {
    throw new AgentRequestValidationError('Hindi kumpleto ang cart proposal. Ihanda muli ito.');
  }
  if (!Number.isSafeInteger(proposal.quantity) || proposal.quantity <= 0) {
    throw new AgentRequestValidationError('Dapat positibong buong bilang ang dami sa proposal.');
  }
  if (proposal.resolution === 'unknown') {
    throw new AgentRequestValidationError('Hindi maaaring aprubahan ang produktong wala sa catalog.');
  }
  if (!Array.isArray(proposal.candidates)) {
    throw new AgentRequestValidationError('Hindi kumpleto ang mga pagpipilian sa proposal.');
  }
  const candidateIds = new Set<string>();
  for (const candidate of proposal.candidates) {
    if (!isProductWithStock(candidate) || candidateIds.has(candidate.id)) {
      throw new AgentRequestValidationError('Hindi valid ang mga pagpipilian sa proposal. Ihanda muli ito.');
    }
    candidateIds.add(candidate.id);
  }

  let product: ProductWithStock | null = null;
  if (proposal.resolution === 'exact') {
    if (proposal.candidates.length !== 0) {
      throw new AgentRequestValidationError('Hindi wasto ang eksaktong tugma. Ihanda muli ito.');
    }
    if (!isProductWithStock(proposal.product)) {
      throw new AgentRequestValidationError('Hindi kumpleto ang eksaktong produkto sa proposal. Ihanda muli ito.');
    }
    if (selectedCandidateId !== undefined && selectedCandidateId !== proposal.product.id) {
      throw new AgentRequestValidationError('Hindi tugma ang piniling produkto sa proposal. Ihanda muli ito.');
    }
    product = proposal.product;
  } else if (proposal.resolution === 'ambiguous') {
    if (proposal.product !== null || proposal.candidates.length === 0) {
      throw new AgentRequestValidationError('Hindi wasto ang ambiguous na proposal. Ihanda muli ito.');
    }
    if (typeof selectedCandidateId !== 'string' || !selectedCandidateId.trim()) {
      throw new AgentRequestValidationError('Pumili muna ng eksaktong produkto o variant.');
    }
    const candidate = proposal.candidates.find((item) =>
      isProductWithStock(item) && item.id === selectedCandidateId,
    );
    if (!candidate) {
      throw new AgentRequestValidationError('Pumili lamang mula sa mga produktong ipinakita sa proposal.');
    }
    product = candidate;
  } else {
    throw new AgentRequestValidationError('Hindi suportado ang uri ng product resolution.');
  }

  if (!product) throw new AgentRequestValidationError('Pumili muna ng produkto mula sa catalog.');
  if (!Number.isSafeInteger(product.priceCentavos * proposal.quantity)) {
    throw new AgentRequestValidationError('Masyadong malaki ang halaga ng item na ito para sa ligtas na pag-compute.');
  }
  return { product: { ...product }, quantity: proposal.quantity };
}
