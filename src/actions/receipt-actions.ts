import type { DatabaseSession } from '../db/database.ts';
import type { ReceiptProposal } from '../domain/receipt.ts';
import { getPendingGcashDraftById, getSaleById } from './sales-actions.ts';

export type ReceiptTarget = { kind: 'sale' | 'pending'; id: string };
export interface ReferenceUse {
  kind: 'sale' | 'repayment';
  id: string;
  status: string;
}

function normalizeReference(reference: string): string {
  return reference.replace(/\s/g, '').toUpperCase();
}

/** Read-only comparison: this action cannot confirm payments or change stock. */
export async function reviewReceiptForSale(
  db: DatabaseSession,
  target: ReceiptTarget,
  proposal: ReceiptProposal,
): Promise<{ expectedAmountCentavos: number; amountMatches: boolean | null; referenceUses: ReferenceUse[] }> {
  let expectedAmountCentavos: number;
  if (target.kind === 'pending') {
    const draft = await getPendingGcashDraftById(db, target.id);
    if (!draft || draft.status !== 'pending') throw new Error('Pending GCash purchase is no longer available.');
    expectedAmountCentavos = draft.totalCentavos;
  } else {
    const sale = await getSaleById(db, target.id);
    if (!sale || sale.paymentMethod !== 'gcash') throw new Error('GCash sale was not found.');
    // #9's full GCash sales predate paid_centavos and retain its migration
    // default of zero. Credit sales use their actual partially paid amount.
    expectedAmountCentavos = (sale.creditCentavos ?? 0) > 0
      ? (sale.paidCentavos ?? 0)
      : sale.totalCentavos;
  }
  const referenceUses: ReferenceUse[] = [];
  if (proposal.referenceNumber?.trim()) {
    const reference = normalizeReference(proposal.referenceNumber);
    const rows = await db.getAll<{
      kind: 'sale' | 'repayment'; id: string; status: string; reference_number: string;
    }>(
      `SELECT 'sale' AS kind, id, status, reference_number FROM sales
       WHERE payment_method = 'gcash' AND reference_number IS NOT NULL
       UNION ALL
       SELECT 'repayment' AS kind, id, status, reference_number FROM credit_repayments
       WHERE payment_method = 'gcash' AND reference_number IS NOT NULL;`,
    );
    for (const row of rows) {
      if (target.kind === 'sale' && row.kind === 'sale' && row.id === target.id) continue;
      if (normalizeReference(row.reference_number) === reference) {
        referenceUses.push({ kind: row.kind, id: row.id, status: row.status });
      }
    }
  }
  return {
    expectedAmountCentavos,
    amountMatches: proposal.amountCentavos === null ? null : proposal.amountCentavos === expectedAmountCentavos,
    referenceUses,
  };
}
