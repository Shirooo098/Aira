import type { DatabaseSession } from '../db/database.ts';
import type { LookupResult } from '../types.ts';
import { lookupProduct } from './catalog-actions.ts';

export interface LookupState {
  result: LookupResult;
  loading: boolean;
  error: string | null;
}

export function createLookupSession(db: DatabaseSession, publish: (state: LookupState) => void) {
  let request = 0;
  return {
    cancel() { request++; },
    async search(query: string): Promise<void> {
      const current = ++request;
      publish({ result: { kind: 'empty' }, loading: !!query.trim(), error: null });
      if (!query.trim()) return;
      try {
        const result = await lookupProduct(db, query);
        if (current === request) publish({ result, loading: false, error: null });
      } catch (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.error('[Aira lookup]', error);
        if (current === request) {
          publish({ result: { kind: 'empty' }, loading: false, error: 'Hindi makuha ang presyo. Subukan muli.' });
        }
      }
    },
  };
}
