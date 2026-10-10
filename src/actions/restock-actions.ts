import type { DatabaseSession } from '../db/database.ts';
import { getAllProductsWithStock } from './inventory-actions.ts';
import { getStoreReport, type ReportQueryOptions } from './report-actions.ts';
import {
  generateRestockSuggestions,
  validateChecklistQuantity,
  RestockValidationError,
  type RestockChecklist,
  type RestockChecklistItem,
  type RestockChecklistStatus,
  type RestockDecision,
  type RestockReason,
} from '../domain/restock.ts';

interface ChecklistRow {
  id: string;
  status: RestockChecklistStatus;
  period_key: string;
  period_label: string;
  evaluation_date: string;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  discarded_at: string | null;
}

interface ChecklistItemRow {
  id: string;
  checklist_id: string;
  product_id: string;
  product_name: string;
  product_variant: string;
  product_unit: string;
  current_stock: number | null;
  units_sold: number;
  suggested_quantity: number | null;
  requested_quantity: number | null;
  has_sufficient_history: number;
  reason: RestockReason;
  reason_explanation: string;
  history_explanation: string;
  is_included: number;
  is_priority: number;
  decision: RestockDecision;
  created_at: string;
}

interface ProductRow {
  id: string;
  name: string;
  variant: string;
  unit: string;
}

interface StockRow {
  quantity: number | null;
}

function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 9);
  return `${prefix}_${timestamp}_${randomPart}`;
}

function generateChecklistId(): string {
  return generateId('chk');
}

function generateItemId(): string {
  return generateId('it_chk');
}

function mapItemRow(row: ChecklistItemRow): RestockChecklistItem {
  return {
    id: row.id,
    checklistId: row.checklist_id,
    productId: row.product_id,
    productName: row.product_name,
    variant: row.product_variant,
    unit: row.product_unit,
    currentStock: row.current_stock,
    unitsSold: row.units_sold,
    suggestedQuantity: row.suggested_quantity,
    requestedQuantity: row.requested_quantity,
    hasSufficientHistory: row.has_sufficient_history === 1,
    reason: row.reason,
    reasonExplanation: row.reason_explanation,
    historyExplanation: row.history_explanation,
    isIncluded: row.is_included === 1,
    isPriority: row.is_priority === 1,
    decision: row.decision ?? 'pending',
    createdAt: row.created_at,
  };
}

export async function createDraftRestockChecklist(
  db: DatabaseSession,
  options: ReportQueryOptions & { notes?: string }
): Promise<RestockChecklist> {
  const products = await getAllProductsWithStock(db);
  const report = await getStoreReport(db, options);

  const drafts = generateRestockSuggestions({ products, report });
  const checklistId = generateChecklistId();
  const now = new Date().toISOString();

  await db.exec('BEGIN IMMEDIATE;');
  try {
    await db.run(
      `INSERT INTO restock_checklists (
        id, status, period_key, period_label, evaluation_date, notes, created_at
      ) VALUES (?, 'draft', ?, ?, ?, ?, ?);`,
      [
        checklistId,
        report.period.periodKey,
        report.period.labelFilipino,
        report.asOfUtcIso,
        options.notes ?? null,
        now,
      ]
    );

    const items: RestockChecklistItem[] = [];

    for (const draft of drafts) {
      const itemId = generateItemId();
      await db.run(
        `INSERT INTO restock_checklist_items (
          id, checklist_id, product_id, product_name, product_variant, product_unit,
          current_stock, units_sold, suggested_quantity, requested_quantity,
          has_sufficient_history, reason, reason_explanation, history_explanation,
          is_included, is_priority, decision, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?);`,
        [
          itemId,
          checklistId,
          draft.productId,
          draft.productName,
          draft.variant,
          draft.unit,
          draft.currentStock,
          draft.unitsSold,
          draft.suggestedQuantity,
          draft.requestedQuantity,
          draft.hasSufficientHistory ? 1 : 0,
          draft.reason,
          draft.reasonExplanation,
          draft.historyExplanation,
          draft.isIncluded ? 1 : 0,
          draft.isPriority ? 1 : 0,
          now,
        ]
      );

      items.push({
        ...draft,
        id: itemId,
        checklistId,
        decision: 'pending',
        createdAt: now,
      });
    }

    await db.exec('COMMIT;');

    return {
      id: checklistId,
      status: 'draft',
      periodKey: report.period.periodKey,
      periodLabel: report.period.labelFilipino,
      evaluationDate: report.asOfUtcIso,
      notes: options.notes ?? null,
      createdAt: now,
      approvedAt: null,
      discardedAt: null,
      items,
    };
  } catch (error) {
    await db.exec('ROLLBACK;').catch(() => undefined);
    throw error;
  }
}

export async function getRestockChecklist(
  db: DatabaseSession,
  checklistId: string
): Promise<RestockChecklist> {
  const row = await db.getFirst<ChecklistRow>(
    `SELECT id, status, period_key, period_label, evaluation_date, notes, created_at, approved_at, discarded_at
     FROM restock_checklists WHERE id = ?;`,
    [checklistId]
  );

  if (!row) {
    throw new RestockValidationError(`Hindi nahanap ang restock checklist na ${checklistId}`);
  }

  const itemRows = await db.getAll<ChecklistItemRow>(
    `SELECT * FROM restock_checklist_items WHERE checklist_id = ? ORDER BY is_priority DESC, created_at ASC;`,
    [checklistId]
  );

  return {
    id: row.id,
    status: row.status,
    periodKey: row.period_key,
    periodLabel: row.period_label,
    evaluationDate: row.evaluation_date,
    notes: row.notes,
    createdAt: row.created_at,
    approvedAt: row.approved_at,
    discardedAt: row.discarded_at,
    items: itemRows.map(mapItemRow),
  };
}

export async function getLatestRestockChecklist(
  db: DatabaseSession
): Promise<RestockChecklist | null> {
  const row = await db.getFirst<{ id: string }>(
    `SELECT id FROM restock_checklists ORDER BY created_at DESC LIMIT 1;`
  );
  if (!row) return null;
  return getRestockChecklist(db, row.id);
}

export async function updateChecklistItem(
  db: DatabaseSession,
  params: {
    itemId: string;
    requestedQuantity?: number;
    isIncluded?: boolean;
    isPriority?: boolean;
  }
): Promise<RestockChecklistItem> {
  const existing = await db.getFirst<ChecklistItemRow>(
    `SELECT * FROM restock_checklist_items WHERE id = ?;`,
    [params.itemId]
  );
  if (!existing) {
    throw new RestockValidationError('Hindi nahanap ang item sa checklist.');
  }

  let nextRequestedQuantity = existing.requested_quantity;
  if (params.requestedQuantity !== undefined) {
    nextRequestedQuantity = params.requestedQuantity === null ? null : validateChecklistQuantity(params.requestedQuantity);
  }

  const nextIsIncluded = params.isIncluded !== undefined ? (params.isIncluded ? 1 : 0) : existing.is_included;
  const nextIsPriority = params.isPriority !== undefined ? (params.isPriority ? 1 : 0) : existing.is_priority;

  // If newly included and quantity was null, default to 1 so there is an explicit quantity
  if (nextIsIncluded === 1 && nextRequestedQuantity === null) {
    nextRequestedQuantity = 1;
  }

  await db.run(
    `UPDATE restock_checklist_items
     SET requested_quantity = ?, is_included = ?, is_priority = ?
     WHERE id = ?;`,
    [nextRequestedQuantity, nextIsIncluded, nextIsPriority, params.itemId]
  );

  const updated = await db.getFirst<ChecklistItemRow>(
    `SELECT * FROM restock_checklist_items WHERE id = ?;`,
    [params.itemId]
  );
  if (!updated) {
    throw new RestockValidationError('Nabigo ang pag-update sa item ng checklist.');
  }
  return mapItemRow(updated);
}

export async function addChecklistItem(
  db: DatabaseSession,
  params: {
    checklistId: string;
    productId: string;
    requestedQuantity: number;
  }
): Promise<RestockChecklistItem> {
  const validatedQuantity = validateChecklistQuantity(params.requestedQuantity);

  const checklist = await db.getFirst<{ id: string; period_label: string }>(
    `SELECT id, period_label FROM restock_checklists WHERE id = ?;`,
    [params.checklistId]
  );
  if (!checklist) {
    throw new RestockValidationError('Hindi nahanap ang checklist.');
  }

  const product = await db.getFirst<ProductRow>(
    `SELECT id, name, variant, unit FROM products WHERE id = ?;`,
    [params.productId]
  );
  if (!product) {
    throw new RestockValidationError('Hindi nahanap ang produkto sa catalog.');
  }

  const stockRow = await db.getFirst<StockRow>(
    `SELECT quantity FROM stock_levels WHERE product_id = ?;`,
    [params.productId]
  );
  const currentStock = stockRow ? stockRow.quantity : null;

  const itemId = generateItemId();
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO restock_checklist_items (
      id, checklist_id, product_id, product_name, product_variant, product_unit,
      current_stock, units_sold, suggested_quantity, requested_quantity,
      has_sufficient_history, reason, reason_explanation, history_explanation,
      is_included, is_priority, decision, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, 0, 'manual', 'Manu-manong idinagdag ng may-ari sa checklist.', 'Manu-manong idinagdag.', 1, 0, 'pending', ?);`,
    [
      itemId,
      params.checklistId,
      product.id,
      product.name,
      product.variant,
      product.unit,
      currentStock,
      validatedQuantity,
      now,
    ]
  );

  const created = await db.getFirst<ChecklistItemRow>(
    `SELECT * FROM restock_checklist_items WHERE id = ?;`,
    [itemId]
  );
  if (!created) {
    throw new RestockValidationError('Nabigo ang pagdagdag sa item ng checklist.');
  }
  return mapItemRow(created);
}

export async function removeChecklistItem(
  db: DatabaseSession,
  itemId: string
): Promise<void> {
  await db.run(`DELETE FROM restock_checklist_items WHERE id = ?;`, [itemId]);
}

/**
 * Approves the restock checklist.
 * CRITICAL: strictly does NOT modify stock_levels or create inventory_movements!
 * Inventory increases only through subsequent owner-confirmed physical delivery intake.
 */
export async function approveRestockChecklist(
  db: DatabaseSession,
  params: {
    checklistId: string;
    notes?: string;
  }
): Promise<RestockChecklist> {
  const existing = await getRestockChecklist(db, params.checklistId);
  if (existing.status !== 'draft') {
    throw new RestockValidationError(`Hindi na draft ang checklist (${existing.status}).`);
  }

  const now = new Date().toISOString();
  const notes = params.notes !== undefined ? params.notes : existing.notes;

  await db.exec('BEGIN IMMEDIATE;');
  try {
    await db.run(
      `UPDATE restock_checklists
       SET status = 'approved', approved_at = ?, notes = ?
       WHERE id = ?;`,
      [now, notes, params.checklistId]
    );

    await db.run(
      `UPDATE restock_checklist_items
       SET decision = CASE
         WHEN is_included = 1 AND requested_quantity IS NOT NULL AND requested_quantity > 0 THEN 'approved'
         ELSE 'rejected'
       END
       WHERE checklist_id = ?;`,
      [params.checklistId]
    );

    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }

  return getRestockChecklist(db, params.checklistId);
}

/**
 * Discards the restock checklist without altering inventory.
 */
export async function discardRestockChecklist(
  db: DatabaseSession,
  params: {
    checklistId: string;
  }
): Promise<RestockChecklist> {
  const existing = await getRestockChecklist(db, params.checklistId);
  const now = new Date().toISOString();

  await db.exec('BEGIN IMMEDIATE;');
  try {
    await db.run(
      `UPDATE restock_checklists
       SET status = 'discarded', discarded_at = ?
       WHERE id = ?;`,
      [now, params.checklistId]
    );

    await db.run(
      `UPDATE restock_checklist_items
       SET decision = 'rejected'
       WHERE checklist_id = ?;`,
      [params.checklistId]
    );

    await db.exec('COMMIT;');
  } catch (err) {
    await db.exec('ROLLBACK;');
    throw err;
  }

  return getRestockChecklist(db, params.checklistId);
}
