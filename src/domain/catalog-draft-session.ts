import type { Product } from '../types.ts';
import type { CatalogChangeFields } from './catalog-dictation.ts';
import type { CatalogChangeProposal } from '../actions/catalog-draft-actions.ts';

export interface CatalogDraftState {
  status: 'editing' | 'reviewing' | 'reviewed' | 'saving' | 'saved' | 'closed';
  proposal: CatalogChangeProposal | null;
  error: string | null;
}

/** Explicit catalog choice supplies identity, never a new-product name. */
export function selectCatalogProduct(fields: CatalogChangeFields, product: Product): CatalogChangeFields {
  if (fields.kind === 'new_product') throw new Error('Bagong produkto ang napiling uri ng pagbabago.');
  return {
    ...fields,
    productId: product.id,
    name: '',
    variant: product.variant,
    unit: product.unit,
    productQuery: fields.productQuery || `${product.name} ${product.variant}`,
  };
}

export function isSpokenCatalogConfirmation(text: string): boolean {
  const command = text.normalize('NFC').trim().toLowerCase().replace(/[.!?]+$/u, '').trim();
  return ['kumpirmahin', 'kumpirmahin at i-save', 'i-save', 'isave', 'save', 'confirm'].includes(command);
}

/** One owner-reviewed draft; recognition and navigation cannot authorize a write. */
export function createCatalogDraftSession(actions: {
  prepare: (fields: CatalogChangeFields) => Promise<CatalogChangeProposal>;
  save: (proposal: CatalogChangeProposal) => Promise<Product>;
}) {
  let state: CatalogDraftState = { status: 'editing', proposal: null, error: null };
  let revision = 0;
  let pendingSave: Promise<Product | null> | null = null;
  const listeners = new Set<(state: CatalogDraftState) => void>();
  function publish(next: CatalogDraftState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  return {
    getState: () => state,
    subscribe(listener: (state: CatalogDraftState) => void) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    edit() {
      if (state.status === 'closed' || state.status === 'saving') return;
      revision++;
      publish({ status: 'editing', proposal: null, error: null });
    },
    async review(fields: CatalogChangeFields): Promise<void> {
      if (state.status === 'closed' || state.status === 'saving') return;
      const attempt = ++revision;
      publish({ status: 'reviewing', proposal: null, error: null });
      try {
        const proposal = await actions.prepare({ ...fields });
        if (attempt !== revision) return;
        publish({ status: 'reviewed', proposal, error: null });
      } catch (error) {
        if (attempt !== revision) return;
        publish({ status: 'editing', proposal: null, error: error instanceof Error ? error.message : 'Hindi masuri ang pagbabago.' });
      }
    },
    confirm(source: 'button' | 'spoken', text = ''): Promise<Product | null> {
      if (source !== 'button' && (source !== 'spoken' || !isSpokenCatalogConfirmation(text))) {
        return Promise.resolve(null);
      }
      if (state.status === 'saving' && pendingSave) return pendingSave;
      if (state.status !== 'reviewed' || !state.proposal) return Promise.resolve(null);
      const proposal = state.proposal;
      const attempt = ++revision;
      publish({ status: 'saving', proposal, error: null });
      pendingSave = Promise.resolve().then(() => actions.save(proposal)).then((product) => {
        if (attempt === revision && state.status !== 'closed') {
          publish({ status: 'saved', proposal, error: null });
        }
        return product;
      }).catch((error: unknown) => {
        if (attempt === revision && state.status !== 'closed') {
          publish({ status: 'editing', proposal: null, error: error instanceof Error ? error.message : 'Hindi na-save ang pagbabago. Suriin muli.' });
        }
        return null;
      }).finally(() => { pendingSave = null; });
      return pendingSave;
    },
    close() {
      revision++;
      publish({ status: 'closed', proposal: null, error: null });
      listeners.clear();
    },
  };
}
