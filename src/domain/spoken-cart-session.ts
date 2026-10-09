import type { SpokenCartLine } from './spoken-order.ts';
import type { SpokenOrderProposal, SpokenOrderSelection } from '../actions/spoken-order-actions.ts';

export interface SpokenCartState {
  status: 'editing' | 'preparing' | 'review' | 'applied' | 'closed';
  cart: SpokenCartLine[];
  proposal: SpokenOrderProposal | null;
  error: string | null;
}

function copyCart(cart: SpokenCartLine[]): SpokenCartLine[] {
  return cart.map((line) => ({ ...line, product: { ...line.product } }));
}

/** Holds one temporary voice command. Applying it changes only the visible cart. */
export function createSpokenCartSession(actions: {
  prepare: (text: string, cart: SpokenCartLine[]) => Promise<SpokenOrderProposal>;
  apply: (cart: SpokenCartLine[], proposal: SpokenOrderProposal, selection?: SpokenOrderSelection) => SpokenCartLine[];
}, baseCart: SpokenCartLine[]) {
  let state: SpokenCartState = { status: 'editing', cart: copyCart(baseCart), proposal: null, error: null };
  let revision = 0;
  const listeners = new Set<(state: SpokenCartState) => void>();
  function publish(next: SpokenCartState) {
    state = next;
    for (const listener of listeners) listener(state);
  }

  return {
    getState: () => state,
    subscribe(listener: (state: SpokenCartState) => void) {
      listeners.add(listener);
      listener(state);
      return () => { listeners.delete(listener); };
    },
    invalidate() {
      if (state.status === 'closed' || state.status === 'applied') return;
      revision++;
      publish({ ...state, status: 'editing', proposal: null, error: null });
    },
    async prepare(text: string): Promise<void> {
      if (state.status === 'closed' || state.status === 'applied') return;
      const attempt = ++revision;
      const cart = copyCart(state.cart);
      publish({ ...state, status: 'preparing', proposal: null, error: null });
      try {
        const proposal = await actions.prepare(text, cart);
        if (attempt !== revision) return;
        publish({ ...state, status: 'review', proposal, error: null });
      } catch (error) {
        if (attempt !== revision) return;
        publish({ ...state, status: 'editing', proposal: null,
          error: error instanceof Error ? error.message : 'Hindi masuri ang order. Subukan muli.' });
      }
    },
    apply(selection?: SpokenOrderSelection): SpokenCartLine[] | null {
      if (state.status !== 'review' || !state.proposal) return null;
      try {
        const cart = actions.apply(copyCart(state.cart), state.proposal, selection);
        revision++;
        publish({ status: 'applied', cart: copyCart(cart), proposal: null, error: null });
        return copyCart(cart);
      } catch (error) {
        publish({ ...state, error: error instanceof Error ? error.message : 'Hindi mailapat ang order. Suriin muli.' });
        return null;
      }
    },
    close() {
      revision++;
      publish({ ...state, status: 'closed', proposal: null, error: null });
      listeners.clear();
    },
  };
}
