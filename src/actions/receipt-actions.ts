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

export class ReceiptValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReceiptValidationError';
  }
}

export interface ReceiptAttachment {
  id: string;
  targetKind: 'sale' | 'pending_draft';
  targetId: string;
  imagePath: string;
  amountCentavos: number | null;
  referenceNumber: string | null;
  senderName: string | null;
  senderMobile: string | null;
  rawText: string | null;
  createdAt: string;
}

interface ReceiptAttachmentRow {
  id: string;
  target_kind: 'sale' | 'pending_draft';
  target_id: string;
  image_path: string;
  amount_centavos: number | null;
  reference_number: string | null;
  sender_name: string | null;
  sender_mobile: string | null;
  raw_text: string | null;
  created_at: string;
}

function mapReceiptAttachmentRow(row: ReceiptAttachmentRow): ReceiptAttachment {
  return {
    id: row.id,
    targetKind: row.target_kind,
    targetId: row.target_id,
    imagePath: row.image_path,
    amountCentavos: row.amount_centavos,
    referenceNumber: row.reference_number,
    senderName: row.sender_name,
    senderMobile: row.sender_mobile,
    rawText: row.raw_text,
    createdAt: row.created_at,
  };
}

export function generateReceiptAttachmentId(): string {
  return `rcpt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Persist app-private receipt attachment metadata linked to a sale or draft.
 * Does not confirm payments or alter account balances.
 */
export async function attachReceipt(
  db: DatabaseSession,
  params: {
    targetKind: 'sale' | 'pending_draft';
    targetId: string;
    imagePath: string;
    amountCentavos?: number | null;
    referenceNumber?: string | null;
    senderName?: string | null;
    senderMobile?: string | null;
    rawText?: string | null;
  }
): Promise<ReceiptAttachment> {
  const targetId = params.targetId?.trim();
  if (!targetId) {
    throw new ReceiptValidationError('Kailangan ng target ID para sa resibo.');
  }
  const imagePath = params.imagePath?.trim();
  if (!imagePath) {
    throw new ReceiptValidationError('Kailangan ng path ng larawan ng resibo.');
  }

  // Validate target existence
  if (params.targetKind === 'pending_draft') {
    const draft = await getPendingGcashDraftById(db, targetId);
    if (!draft) {
      throw new ReceiptValidationError(`Hindi mahanap ang pending GCash draft: ${targetId}`);
    }
  } else if (params.targetKind === 'sale') {
    const sale = await getSaleById(db, targetId);
    if (!sale) {
      throw new ReceiptValidationError(`Hindi mahanap ang benta: ${targetId}`);
    }
  } else {
    throw new ReceiptValidationError(`Hindi wastong uri ng target: ${params.targetKind}`);
  }

  if (params.amountCentavos !== undefined && params.amountCentavos !== null) {
    if (!Number.isSafeInteger(params.amountCentavos) || params.amountCentavos < 0) {
      throw new ReceiptValidationError('Ang halaga ay dapat positibong integer centavos.');
    }
  }

  const id = generateReceiptAttachmentId();
  const now = new Date().toISOString();
  const ref = params.referenceNumber?.trim() || null;
  const name = params.senderName?.trim() || null;
  const mobile = params.senderMobile?.trim() || null;
  const raw = params.rawText?.trim() || null;

  await db.run(
    `INSERT INTO receipt_attachments (
       id, target_kind, target_id, image_path, amount_centavos,
       reference_number, sender_name, sender_mobile, raw_text, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      params.targetKind,
      targetId,
      imagePath,
      params.amountCentavos ?? null,
      ref,
      name,
      mobile,
      raw,
      now,
    ]
  );

  return {
    id,
    targetKind: params.targetKind,
    targetId,
    imagePath,
    amountCentavos: params.amountCentavos ?? null,
    referenceNumber: ref,
    senderName: name,
    senderMobile: mobile,
    rawText: raw,
    createdAt: now,
  };
}

/**
 * Retrieve receipt attachment for a specific target.
 */
export async function getReceiptAttachment(
  db: DatabaseSession,
  targetKind: 'sale' | 'pending_draft',
  targetId: string
): Promise<ReceiptAttachment | null> {
  const row = await db.getFirst<ReceiptAttachmentRow>(
    `SELECT id, target_kind, target_id, image_path, amount_centavos,
            reference_number, sender_name, sender_mobile, raw_text, created_at
     FROM receipt_attachments
     WHERE target_kind = ? AND target_id = ?
     ORDER BY created_at DESC;`,
    [targetKind, targetId.trim()]
  );
  return row ? mapReceiptAttachmentRow(row) : null;
}

/**
 * Retrieve receipt attachment by its primary ID.
 */
export async function getReceiptAttachmentById(
  db: DatabaseSession,
  id: string
): Promise<ReceiptAttachment | null> {
  const row = await db.getFirst<ReceiptAttachmentRow>(
    `SELECT id, target_kind, target_id, image_path, amount_centavos,
            reference_number, sender_name, sender_mobile, raw_text, created_at
     FROM receipt_attachments
     WHERE id = ?;`,
    [id.trim()]
  );
  return row ? mapReceiptAttachmentRow(row) : null;
}

/**
 * Search receipt attachments by reference number, sender name, or sender mobile.
 */
export async function searchReceiptAttachments(
  db: DatabaseSession,
  query: {
    referenceNumber?: string;
    senderName?: string;
    senderMobile?: string;
  }
): Promise<ReceiptAttachment[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.referenceNumber?.trim()) {
    conditions.push("UPPER(REPLACE(reference_number, ' ', '')) LIKE UPPER(?)");
    params.push(`%${query.referenceNumber.trim().replace(/\s/g, '')}%`);
  }
  if (query.senderName?.trim()) {
    conditions.push('UPPER(sender_name) LIKE UPPER(?)');
    params.push(`%${query.senderName.trim()}%`);
  }
  if (query.senderMobile?.trim()) {
    conditions.push("REPLACE(REPLACE(sender_mobile, ' ', ''), '-', '') LIKE ?");
    params.push(`%${query.senderMobile.trim().replace(/[\s-]/g, '')}%`);
  }

  let sql = `SELECT id, target_kind, target_id, image_path, amount_centavos,
                    reference_number, sender_name, sender_mobile, raw_text, created_at
             FROM receipt_attachments`;
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }
  sql += ' ORDER BY created_at DESC;';

  const rows = await db.getAll<ReceiptAttachmentRow>(sql, params);
  return rows.map(mapReceiptAttachmentRow);
}

/**
 * Delete a receipt attachment without modifying sales, stock, or ledger balances.
 */
export async function deleteReceiptAttachment(
  db: DatabaseSession,
  id: string
): Promise<boolean> {
  const existing = await getReceiptAttachmentById(db, id);
  if (!existing) return false;
  await db.run('DELETE FROM receipt_attachments WHERE id = ?;', [id.trim()]);
  return true;
}

/**
 * Transfer receipt attachment from a pending draft to the confirmed sale.
 */
export async function transferDraftReceiptToSale(
  db: DatabaseSession,
  draftId: string,
  saleId: string
): Promise<void> {
  await db.run(
    `UPDATE receipt_attachments
     SET target_kind = 'sale', target_id = ?
     WHERE target_kind = 'pending_draft' AND target_id = ?;`,
    [saleId.trim(), draftId.trim()]
  );
}
