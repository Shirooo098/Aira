import { proposeReceiptFields, type ReceiptProposal } from '../domain/receipt.ts';
import { formatCentavos } from '../domain/money.ts';
import type { DatabaseSession } from '../db/database.ts';
import { reviewReceiptForSale, type ReceiptTarget, type ReferenceUse } from '../actions/receipt-actions.ts';

export interface OcrReviewResult {
  proposal: ReceiptProposal;
  expectedAmountCentavos: number;
  amountMatches: boolean | null;
  referenceUses: ReferenceUse[];
  feedbackNotes: string[];
}

/**
 * Service to process OCR on receipt image and produce reviewable proposal with safety checks.
 */
export async function processReceiptOcr(
  db: DatabaseSession,
  target: ReceiptTarget,
  rawOcrText: string
): Promise<OcrReviewResult> {
  const proposal = proposeReceiptFields(rawOcrText);
  const review = await reviewReceiptForSale(db, target, proposal);

  const feedbackNotes: string[] = [];

  if (review.amountMatches === false && proposal.amountCentavos !== null) {
    feedbackNotes.push(
      `Babala: Hindi tugma ang halaga sa resibo (${formatCentavos(proposal.amountCentavos)}) sa kailangan bayaran (${formatCentavos(review.expectedAmountCentavos)}).`
    );
  } else if (review.amountMatches === true) {
    feedbackNotes.push('Tugma ang halaga ng resibo sa binabayarang halaga.');
  }

  if (review.referenceUses.length > 0) {
    const refsCount = review.referenceUses.length;
    feedbackNotes.push(
      `Babala: Ang reference number na ito ay nagamit na sa ${refsCount} ibang transaksyon sa tindahan. Siguraduhing hindi ito dobleng kopya.`
    );
  }

  return {
    proposal,
    expectedAmountCentavos: review.expectedAmountCentavos,
    amountMatches: review.amountMatches,
    referenceUses: review.referenceUses,
    feedbackNotes,
  };
}
