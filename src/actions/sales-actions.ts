import type { DatabaseSession } from '../db/database.ts';
import type {
  Sale,
  SaleItem,
  SalePreview,
  SalePreviewItem,
  PendingGcashDraft,
} from '../types.ts';
import {
  SaleValidationError,
  InsufficientStockError,
  calculateSubtotal,
  calculateSaleTotal,
  calculateChange,
  generateSaleId,
  generateSaleItemId,
  generateDraftId,
} from '../domain/sales.ts';
import { generateMovementId } from '../domain/inventory.ts';

interface ProductRow {
  id: string;
  name: string;
  variant: string;
  unit: string;
  price_centavos: number;
}

interface StockRow {
  product_id: string;
  quantity: number;
}

interface SaleRow {
  id: string;
  payment_method: 'cash' | 'gcash';
  total_centavos: number;
  tender_centavos: number;
  change_centavos: number;
  reference_number: string | null;
  idempotency_key: string | null;
  created_at: string;
}

interface SaleItemRow {
  id: string;
  sale_id: string;
  product_id: string;
  product_name: string;
  product_variant: string;
  product_unit: string;
  unit_price_centavos: number;
  quantity: number;
  subtotal_centavos: number;
}

interface PendingGcashDraftRow {
  id: string;
  total_centavos: number;
  reference_number: string | null;
  customer_note: string | null;
  items_json: string;
  status: 'pending' | 'confirmed' | 'cancelled';
  created_at: string;
  updated_at: string;
}

export async function buildSalePreview(
  db: DatabaseSession,
  draft: {
    items: Array<{ productId: string; quantity: number }>;
    tenderCentavos: number;
  }
): Promise<SalePreview> {
  if (!Array.isArray(draft.items) || draft.items.length === 0) {
    throw new SaleValidationError('Walang aytem sa listahan ng bibilhin');
  }

  const previewItems: SalePreviewItem[] = [];
  const insufficientStockItems: string[] = [];

  for (const item of draft.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new SaleValidationError('Dapat buong numero at higit sa zero ang dami ng binibili');
    }

    const product = await db.getFirst<ProductRow>(
      'SELECT id, name, variant, unit, price_centavos FROM products WHERE id = ?;',
      [item.productId]
    );

    if (!product) {
      throw new SaleValidationError(`Hindi mahanap ang produkto na may ID: ${item.productId}`);
    }

    const stock = await db.getFirst<StockRow>(
      'SELECT product_id, quantity FROM stock_levels WHERE product_id = ?;',
      [item.productId]
    );

    const availableStock = stock !== null ? stock.quantity : null;
    const hasSufficientStock = availableStock !== null && availableStock >= item.quantity;

    if (!hasSufficientStock) {
      insufficientStockItems.push(product.name);
    }

    const subtotalCentavos = calculateSubtotal(item.quantity, product.price_centavos);

    previewItems.push({
      productId: product.id,
      name: product.name,
      variant: product.variant,
      unit: product.unit,
      unitPriceCentavos: product.price_centavos,
      quantity: item.quantity,
      subtotalCentavos,
      availableStock,
      hasSufficientStock,
    });
  }

  const totalCentavos = calculateSaleTotal(previewItems);
  const tenderCentavos = draft.tenderCentavos ?? 0;
  if (!Number.isSafeInteger(tenderCentavos) || tenderCentavos < 0) {
    throw new SaleValidationError('Dapat buong numero at hindi negatibo ang bayad');
  }

  const changeCentavos = tenderCentavos >= totalCentavos ? tenderCentavos - totalCentavos : 0;
  const canComplete = insufficientStockItems.length === 0 && tenderCentavos >= totalCentavos;

  return {
    items: previewItems,
    totalCentavos,
    tenderCentavos,
    changeCentavos,
    canComplete,
    insufficientStockItems,
  };
}

export async function completeCashSale(
  db: DatabaseSession,
  params: {
    items: Array<{ productId: string; quantity: number }>;
    tenderCentavos: number;
    idempotencyKey?: string;
  }
): Promise<Sale> {
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new SaleValidationError('Walang aytem sa benta');
  }

  // Check idempotency first if key provided
  if (params.idempotencyKey) {
    const existingSale = await db.getFirst<SaleRow>(
      'SELECT id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at FROM sales WHERE idempotency_key = ?;',
      [params.idempotencyKey]
    );
    if (existingSale) {
      const items = await getSaleItems(db, existingSale.id);
      return {
        id: existingSale.id,
        paymentMethod: existingSale.payment_method,
        totalCentavos: existingSale.total_centavos,
        tenderCentavos: existingSale.tender_centavos,
        changeCentavos: existingSale.change_centavos,
        referenceNumber: existingSale.reference_number,
        createdAt: existingSale.created_at,
        items,
      };
    }
  }

  // Pre-validate items: check existence and consolidate quantities per productId
  const aggregatedQuantities = new Map<string, number>();
  for (const item of params.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new SaleValidationError('Dapat buong numero at higit sa zero ang dami ng binibili');
    }
    const current = aggregatedQuantities.get(item.productId) ?? 0;
    aggregatedQuantities.set(item.productId, current + item.quantity);
  }

  await db.exec('BEGIN IMMEDIATE');
  try {
    // Re-check idempotency key inside lock
    if (params.idempotencyKey) {
      const existingSale = await db.getFirst<SaleRow>(
        'SELECT id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at FROM sales WHERE idempotency_key = ?;',
        [params.idempotencyKey]
      );
      if (existingSale) {
        await db.exec('COMMIT');
        const items = await getSaleItems(db, existingSale.id);
        return {
          id: existingSale.id,
          paymentMethod: existingSale.payment_method,
          totalCentavos: existingSale.total_centavos,
          tenderCentavos: existingSale.tender_centavos,
          changeCentavos: existingSale.change_centavos,
          referenceNumber: existingSale.reference_number,
          createdAt: existingSale.created_at,
          items,
        };
      }
    }

    // Fetch product snapshot and stock levels
    const productMap = new Map<string, ProductRow>();
    const stockMap = new Map<string, number | null>();

    for (const productId of aggregatedQuantities.keys()) {
      const product = await db.getFirst<ProductRow>(
        'SELECT id, name, variant, unit, price_centavos FROM products WHERE id = ?;',
        [productId]
      );
      if (!product) {
        throw new SaleValidationError(`Hindi mahanap ang produkto na may ID: ${productId}`);
      }
      productMap.set(productId, product);

      const stock = await db.getFirst<StockRow>(
        'SELECT product_id, quantity FROM stock_levels WHERE product_id = ?;',
        [productId]
      );
      stockMap.set(productId, stock !== null ? stock.quantity : null);
    }

    // Check stock sufficiency
    const insufficientDetails: Array<{
      productId: string;
      productName: string;
      requestedQuantity: number;
      availableStock: number | null;
    }> = [];

    for (const [productId, requestedQuantity] of aggregatedQuantities.entries()) {
      const currentStock = stockMap.get(productId);
      const product = productMap.get(productId)!;

      if (currentStock === null || currentStock === undefined || currentStock < requestedQuantity) {
        insufficientDetails.push({
          productId,
          productName: product.name,
          requestedQuantity,
          availableStock: currentStock ?? null,
        });
      }
    }

    if (insufficientDetails.length > 0) {
      const errorNames = insufficientDetails.map((d) => d.productName).join(', ');
      throw new InsufficientStockError(
        `Kulang o hindi pa nabibilang ang stock para sa: ${errorNames}. Kailangan munang iwasto ang bilang bago maibenta.`,
        insufficientDetails
      );
    }

    // Calculate line items and total
    const saleId = generateSaleId();
    const now = new Date().toISOString();
    const saleItemsToInsert: SaleItem[] = [];

    for (const item of params.items) {
      const product = productMap.get(item.productId)!;
      const subtotalCentavos = calculateSubtotal(item.quantity, product.price_centavos);
      saleItemsToInsert.push({
        id: generateSaleItemId(),
        saleId,
        productId: product.id,
        productName: product.name,
        productVariant: product.variant,
        productUnit: product.unit,
        unitPriceCentavos: product.price_centavos,
        quantity: item.quantity,
        subtotalCentavos,
      });
    }

    const totalCentavos = calculateSaleTotal(saleItemsToInsert);
    const tenderCentavos = params.tenderCentavos;
    const changeCentavos = calculateChange(totalCentavos, tenderCentavos);

    // Insert sales record
    await db.run(
      `INSERT INTO sales (
         id, payment_method, total_centavos, tender_centavos, change_centavos,
         reference_number, idempotency_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        saleId,
        'cash',
        totalCentavos,
        tenderCentavos,
        changeCentavos,
        null,
        params.idempotencyKey ?? null,
        now,
      ]
    );

    // Insert sale items
    for (const saleItem of saleItemsToInsert) {
      await db.run(
        `INSERT INTO sale_items (
           id, sale_id, product_id, product_name, product_variant, product_unit,
           unit_price_centavos, quantity, subtotal_centavos
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          saleItem.id,
          saleItem.saleId,
          saleItem.productId,
          saleItem.productName,
          saleItem.productVariant,
          saleItem.productUnit,
          saleItem.unitPriceCentavos,
          saleItem.quantity,
          saleItem.subtotalCentavos,
        ]
      );
    }

    // Deduct stock levels and record inventory movements per aggregated product
    for (const [productId, deductQuantity] of aggregatedQuantities.entries()) {
      const prevStock = stockMap.get(productId)!; // guaranteed safe and >= deductQuantity
      const newStock = prevStock - deductQuantity;
      const movementId = generateMovementId();

      await db.run(
        `UPDATE stock_levels SET quantity = ?, updated_at = ? WHERE product_id = ?;`,
        [newStock, now, productId]
      );

      await db.run(
        `INSERT INTO inventory_movements (
           id, product_id, movement_type, quantity_delta,
           previous_quantity, new_quantity, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          movementId,
          productId,
          'sale_deduction',
          -deductQuantity,
          prevStock,
          newStock,
          `Benta: ${saleId}`,
          now,
        ]
      );
    }

    await db.exec('COMMIT');

    return {
      id: saleId,
      totalCentavos,
      paymentMethod: 'cash',
      tenderCentavos,
      changeCentavos,
      referenceNumber: null,
      createdAt: now,
      items: saleItemsToInsert,
    };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // rollback error suppressed
    }
    throw error;
  }
}

function parseDraftItems(itemsJson: string): Array<{ productId: string; quantity: number }> {
  try {
    const parsed = JSON.parse(itemsJson);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        productId: String(item.productId),
        quantity: Number(item.quantity),
      }));
    }
  } catch {
    // ignore parse error
  }
  return [];
}

export async function createPendingGcashDraft(
  db: DatabaseSession,
  params: {
    items: Array<{ productId: string; quantity: number }>;
    referenceNumber?: string;
    customerNote?: string;
  }
): Promise<PendingGcashDraft> {
  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new SaleValidationError('Walang aytem sa listahan ng GCash draft');
  }

  let totalCentavos = 0;
  for (const item of params.items) {
    if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
      throw new SaleValidationError('Dapat buong numero at higit sa zero ang dami ng binibili');
    }

    const product = await db.getFirst<ProductRow>(
      'SELECT id, name, variant, unit, price_centavos FROM products WHERE id = ?;',
      [item.productId]
    );

    if (!product) {
      throw new SaleValidationError(`Hindi mahanap ang produkto na may ID: ${item.productId}`);
    }

    totalCentavos += calculateSubtotal(item.quantity, product.price_centavos);
  }

  if (!Number.isSafeInteger(totalCentavos)) {
    throw new SaleValidationError('Lumagpas sa limitasyon ang kabuuang halaga ng draft');
  }

  const draftId = generateDraftId();
  const now = new Date().toISOString();
  const normalizedItems = params.items.map((i) => ({ productId: i.productId, quantity: i.quantity }));
  const itemsJson = JSON.stringify(normalizedItems);
  const refNum = params.referenceNumber?.trim() || null;
  const custNote = params.customerNote?.trim() || null;

  await db.run(
    `INSERT INTO pending_gcash_drafts (
       id, total_centavos, reference_number, customer_note, items_json, status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
    [draftId, totalCentavos, refNum, custNote, itemsJson, 'pending', now, now]
  );

  return {
    id: draftId,
    totalCentavos,
    referenceNumber: refNum,
    customerNote: custNote,
    items: normalizedItems,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
  };
}

export async function getPendingGcashDrafts(db: DatabaseSession): Promise<PendingGcashDraft[]> {
  const rows = await db.getAll<PendingGcashDraftRow>(
    `SELECT id, total_centavos, reference_number, customer_note, items_json, status, created_at, updated_at
     FROM pending_gcash_drafts
     WHERE status = 'pending'
     ORDER BY created_at DESC;`
  );

  return rows.map((r) => ({
    id: r.id,
    totalCentavos: r.total_centavos,
    referenceNumber: r.reference_number,
    customerNote: r.customer_note,
    items: parseDraftItems(r.items_json),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }));
}

export async function getPendingGcashDraftById(
  db: DatabaseSession,
  draftId: string
): Promise<PendingGcashDraft | null> {
  const row = await db.getFirst<PendingGcashDraftRow>(
    `SELECT id, total_centavos, reference_number, customer_note, items_json, status, created_at, updated_at
     FROM pending_gcash_drafts
     WHERE id = ?;`,
    [draftId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    totalCentavos: row.total_centavos,
    referenceNumber: row.reference_number,
    customerNote: row.customer_note,
    items: parseDraftItems(row.items_json),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function cancelPendingGcashDraft(
  db: DatabaseSession,
  draftId: string
): Promise<void> {
  const row = await db.getFirst<PendingGcashDraftRow>(
    'SELECT id, status FROM pending_gcash_drafts WHERE id = ?;',
    [draftId]
  );

  if (!row) {
    throw new SaleValidationError(`Hindi mahanap ang GCash draft na may ID: ${draftId}`);
  }

  if (row.status === 'confirmed') {
    throw new SaleValidationError('Hindi na maaaring ikansela ang kumpirmadong GCash draft');
  }

  const now = new Date().toISOString();
  await db.run(
    "UPDATE pending_gcash_drafts SET status = 'cancelled', updated_at = ? WHERE id = ?;",
    [now, draftId]
  );
}

export async function confirmGcashSale(
  db: DatabaseSession,
  params: {
    draftId?: string;
    items?: Array<{ productId: string; quantity: number }>;
    referenceNumber?: string;
    idempotencyKey?: string;
  }
): Promise<Sale> {
  const effectiveIdempotencyKey = params.idempotencyKey ?? (params.draftId ? `gcash_draft_${params.draftId}` : undefined);

  // Check idempotency first before entering lock
  if (effectiveIdempotencyKey) {
    const existingSale = await db.getFirst<SaleRow>(
      'SELECT id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at FROM sales WHERE idempotency_key = ?;',
      [effectiveIdempotencyKey]
    );
    if (existingSale) {
      const items = await getSaleItems(db, existingSale.id);
      return {
        id: existingSale.id,
        paymentMethod: existingSale.payment_method,
        totalCentavos: existingSale.total_centavos,
        tenderCentavos: existingSale.tender_centavos,
        changeCentavos: existingSale.change_centavos,
        referenceNumber: existingSale.reference_number,
        createdAt: existingSale.created_at,
        items,
      };
    }
  }

  await db.exec('BEGIN IMMEDIATE');
  try {
    // Re-check idempotency key inside lock
    if (effectiveIdempotencyKey) {
      const existingSale = await db.getFirst<SaleRow>(
        'SELECT id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at FROM sales WHERE idempotency_key = ?;',
        [effectiveIdempotencyKey]
      );
      if (existingSale) {
        await db.exec('COMMIT');
        const items = await getSaleItems(db, existingSale.id);
        return {
          id: existingSale.id,
          paymentMethod: existingSale.payment_method,
          totalCentavos: existingSale.total_centavos,
          tenderCentavos: existingSale.tender_centavos,
          changeCentavos: existingSale.change_centavos,
          referenceNumber: existingSale.reference_number,
          createdAt: existingSale.created_at,
          items,
        };
      }
    }

    let itemsToProcess = params.items;
    let refNum = params.referenceNumber?.trim() || null;

    if (params.draftId) {
      const draftRow = await db.getFirst<PendingGcashDraftRow>(
        'SELECT id, total_centavos, reference_number, customer_note, items_json, status, created_at, updated_at FROM pending_gcash_drafts WHERE id = ?;',
        [params.draftId]
      );
      if (!draftRow) {
        throw new SaleValidationError(`Hindi mahanap ang GCash draft na may ID: ${params.draftId}`);
      }
      if (draftRow.status === 'confirmed') {
        // If draft was marked confirmed but sale lookup above didn't match (e.g. customized idempotency key),
        // we should disallow re-confirming an already confirmed draft
        throw new SaleValidationError('Kumpirmado na ang GCash draft na ito');
      }
      if (draftRow.status === 'cancelled') {
        throw new SaleValidationError('Kanselado na ang GCash draft na ito');
      }

      if (!itemsToProcess || itemsToProcess.length === 0) {
        itemsToProcess = parseDraftItems(draftRow.items_json);
      }
      if (!refNum && draftRow.reference_number) {
        refNum = draftRow.reference_number;
      }
    }

    if (!itemsToProcess || itemsToProcess.length === 0) {
      throw new SaleValidationError('Walang aytem sa kumpirmasyon ng GCash sale');
    }

    // Aggregate quantities
    const aggregatedQuantities = new Map<string, number>();
    for (const item of itemsToProcess) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity <= 0) {
        throw new SaleValidationError('Dapat buong numero at higit sa zero ang dami ng binibili');
      }
      const current = aggregatedQuantities.get(item.productId) ?? 0;
      aggregatedQuantities.set(item.productId, current + item.quantity);
    }

    // Fetch product snapshot and stock levels
    const productMap = new Map<string, ProductRow>();
    const stockMap = new Map<string, number | null>();

    for (const productId of aggregatedQuantities.keys()) {
      const product = await db.getFirst<ProductRow>(
        'SELECT id, name, variant, unit, price_centavos FROM products WHERE id = ?;',
        [productId]
      );
      if (!product) {
        throw new SaleValidationError(`Hindi mahanap ang produkto na may ID: ${productId}`);
      }
      productMap.set(productId, product);

      const stock = await db.getFirst<StockRow>(
        'SELECT product_id, quantity FROM stock_levels WHERE product_id = ?;',
        [productId]
      );
      stockMap.set(productId, stock !== null ? stock.quantity : null);
    }

    // Check stock sufficiency at time of confirmation
    const insufficientDetails: Array<{
      productId: string;
      productName: string;
      requestedQuantity: number;
      availableStock: number | null;
    }> = [];

    for (const [productId, requestedQuantity] of aggregatedQuantities.entries()) {
      const currentStock = stockMap.get(productId);
      const product = productMap.get(productId)!;

      if (currentStock === null || currentStock === undefined || currentStock < requestedQuantity) {
        insufficientDetails.push({
          productId,
          productName: product.name,
          requestedQuantity,
          availableStock: currentStock ?? null,
        });
      }
    }

    if (insufficientDetails.length > 0) {
      const errorNames = insufficientDetails.map((d) => d.productName).join(', ');
      throw new InsufficientStockError(
        `Kulang o hindi pa nabibilang ang stock para sa: ${errorNames}. Kailangan munang iwasto ang bilang bago maibenta.`,
        insufficientDetails
      );
    }

    // Calculate line items and total
    const saleId = generateSaleId();
    const now = new Date().toISOString();
    const saleItemsToInsert: SaleItem[] = [];

    for (const item of itemsToProcess) {
      const product = productMap.get(item.productId)!;
      const subtotalCentavos = calculateSubtotal(item.quantity, product.price_centavos);
      saleItemsToInsert.push({
        id: generateSaleItemId(),
        saleId,
        productId: product.id,
        productName: product.name,
        productVariant: product.variant,
        productUnit: product.unit,
        unitPriceCentavos: product.price_centavos,
        quantity: item.quantity,
        subtotalCentavos,
      });
    }

    const totalCentavos = calculateSaleTotal(saleItemsToInsert);
    // For GCash, exact payment is received directly
    const tenderCentavos = totalCentavos;
    const changeCentavos = 0;

    // Insert sales record
    await db.run(
      `INSERT INTO sales (
         id, payment_method, total_centavos, tender_centavos, change_centavos,
         reference_number, idempotency_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        saleId,
        'gcash',
        totalCentavos,
        tenderCentavos,
        changeCentavos,
        refNum,
        effectiveIdempotencyKey ?? null,
        now,
      ]
    );

    // Insert sale items
    for (const saleItem of saleItemsToInsert) {
      await db.run(
        `INSERT INTO sale_items (
           id, sale_id, product_id, product_name, product_variant, product_unit,
           unit_price_centavos, quantity, subtotal_centavos
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          saleItem.id,
          saleItem.saleId,
          saleItem.productId,
          saleItem.productName,
          saleItem.productVariant,
          saleItem.productUnit,
          saleItem.unitPriceCentavos,
          saleItem.quantity,
          saleItem.subtotalCentavos,
        ]
      );
    }

    // Deduct stock levels and record inventory movements per aggregated product
    for (const [productId, deductQuantity] of aggregatedQuantities.entries()) {
      const prevStock = stockMap.get(productId)!;
      const newStock = prevStock - deductQuantity;
      const movementId = generateMovementId();

      await db.run(
        `UPDATE stock_levels SET quantity = ?, updated_at = ? WHERE product_id = ?;`,
        [newStock, now, productId]
      );

      await db.run(
        `INSERT INTO inventory_movements (
           id, product_id, movement_type, quantity_delta,
           previous_quantity, new_quantity, note, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          movementId,
          productId,
          'sale_deduction',
          -deductQuantity,
          prevStock,
          newStock,
          `Benta: ${saleId}`,
          now,
        ]
      );
    }

    // Mark draft as confirmed if draftId provided
    if (params.draftId) {
      await db.run(
        "UPDATE pending_gcash_drafts SET status = 'confirmed', updated_at = ? WHERE id = ?;",
        [now, params.draftId]
      );
    }

    await db.exec('COMMIT');

    return {
      id: saleId,
      totalCentavos,
      paymentMethod: 'gcash',
      tenderCentavos,
      changeCentavos,
      referenceNumber: refNum,
      createdAt: now,
      items: saleItemsToInsert,
    };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // rollback error suppressed
    }
    throw error;
  }
}

async function getSaleItems(db: DatabaseSession, saleId: string): Promise<SaleItem[]> {
  const rows = await db.getAll<SaleItemRow>(
    `SELECT id, sale_id, product_id, product_name, product_variant, product_unit,
            unit_price_centavos, quantity, subtotal_centavos
     FROM sale_items
     WHERE sale_id = ?
     ORDER BY rowid ASC;`,
    [saleId]
  );

  return rows.map((r) => ({
    id: r.id,
    saleId: r.sale_id,
    productId: r.product_id,
    productName: r.product_name,
    productVariant: r.product_variant,
    productUnit: r.product_unit,
    unitPriceCentavos: r.unit_price_centavos,
    quantity: r.quantity,
    subtotalCentavos: r.subtotal_centavos,
  }));
}

export async function getSaleById(
  db: DatabaseSession,
  saleId: string
): Promise<Sale | null> {
  const row = await db.getFirst<SaleRow>(
    'SELECT id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at FROM sales WHERE id = ?;',
    [saleId]
  );
  if (!row) {
    return null;
  }

  const items = await getSaleItems(db, row.id);
  return {
    id: row.id,
    paymentMethod: row.payment_method,
    totalCentavos: row.total_centavos,
    tenderCentavos: row.tender_centavos,
    changeCentavos: row.change_centavos,
    referenceNumber: row.reference_number,
    createdAt: row.created_at,
    items,
  };
}

export async function getRecentSales(
  db: DatabaseSession,
  limit: number = 20
): Promise<Sale[]> {
  const rows = await db.getAll<SaleRow>(
    `SELECT id, payment_method, total_centavos, tender_centavos, change_centavos, reference_number, idempotency_key, created_at
     FROM sales
     ORDER BY created_at DESC, rowid DESC
     LIMIT ?;`,
    [limit]
  );

  const sales: Sale[] = [];
  for (const row of rows) {
    const items = await getSaleItems(db, row.id);
    sales.push({
      id: row.id,
      paymentMethod: row.payment_method,
      totalCentavos: row.total_centavos,
      tenderCentavos: row.tender_centavos,
      changeCentavos: row.change_centavos,
      referenceNumber: row.reference_number,
      createdAt: row.created_at,
      items,
    });
  }

  return sales;
}
