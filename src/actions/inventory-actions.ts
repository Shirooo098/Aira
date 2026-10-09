import type { DatabaseSession } from '../db/database.ts';
import type {
  StockLevel,
  InventoryMovement,
  InventoryMovementType,
  ProductWithStock,
  StockPreview,
} from '../types.ts';
import {
  validateStockQuantity,
  validateDeliveryQuantity,
  generateMovementId,
  StockValidationError,
} from '../domain/inventory.ts';

interface StockLevelRow {
  product_id: string;
  quantity: number;
  updated_at: string;
}

interface InventoryMovementRow {
  id: string;
  product_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  previous_quantity: number | null;
  new_quantity: number;
  note: string | null;
  created_at: string;
}

interface ProductWithStockRow {
  id: string;
  name: string;
  variant: string;
  unit: string;
  price_centavos: number;
  created_at: string;
  updated_at: string;
  quantity: number | null;
  stock_updated_at: string | null;
}

export async function getStockLevel(
  db: DatabaseSession,
  productId: string
): Promise<StockLevel | null> {
  const row = await db.getFirst<StockLevelRow>(
    'SELECT product_id, quantity, updated_at FROM stock_levels WHERE product_id = ?;',
    [productId]
  );
  if (!row) {
    return null;
  }
  return {
    productId: row.product_id,
    quantity: row.quantity,
    updatedAt: row.updated_at,
  };
}

export function calculateStockPreview(params: {
  productId: string;
  movementType: 'set_count' | 'add_delivery';
  inputQuantity: number;
  currentQuantity: number | null;
  unit: string;
}): StockPreview {
  if (params.movementType === 'set_count') {
    const validated = validateStockQuantity(params.inputQuantity);
    return {
      productId: params.productId,
      movementType: 'set_count',
      previousQuantity: params.currentQuantity,
      inputQuantity: validated,
      newQuantity: validated,
      quantityDelta:
        params.currentQuantity === null ? null : validated - params.currentQuantity,
      unit: params.unit,
    };
  }

  if (params.movementType === 'add_delivery') {
    const validated = validateDeliveryQuantity(params.inputQuantity);
    return {
      productId: params.productId,
      movementType: 'add_delivery',
      previousQuantity: params.currentQuantity,
      inputQuantity: validated,
      newQuantity: (params.currentQuantity ?? 0) + validated,
      quantityDelta: validated,
      unit: params.unit,
    };
  }

  throw new StockValidationError('Hindi suportadong uri ng pagkilos sa stock');
}

export async function setStockCount(
  db: DatabaseSession,
  params: {
    productId: string;
    newQuantity: number;
    note?: string | null;
  }
): Promise<InventoryMovement> {
  const validatedQty = validateStockQuantity(params.newQuantity);

  await db.exec('BEGIN IMMEDIATE');
  try {
    const product = await db.getFirst<{ id: string }>(
      'SELECT id FROM products WHERE id = ?;',
      [params.productId]
    );
    if (!product) {
      throw new StockValidationError(`Hindi mahanap ang produkto na may ID: ${params.productId}`);
    }

    const currentStock = await getStockLevel(db, params.productId);
    const previousQuantity = currentStock !== null ? currentStock.quantity : null;
    const quantityDelta =
      previousQuantity === null ? validatedQty : validatedQty - previousQuantity;
    const movementId = generateMovementId();
    const now = new Date().toISOString();
    const note = params.note ?? null;

    await db.run(
      `INSERT INTO stock_levels (product_id, quantity, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
         quantity = excluded.quantity,
         updated_at = excluded.updated_at;`,
      [params.productId, validatedQty, now]
    );

    await db.run(
      `INSERT INTO inventory_movements (
         id, product_id, movement_type, quantity_delta,
         previous_quantity, new_quantity, note, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        movementId,
        params.productId,
        'set_count',
        quantityDelta,
        previousQuantity,
        validatedQty,
        note,
        now,
      ]
    );

    await db.exec('COMMIT');

    return {
      id: movementId,
      productId: params.productId,
      movementType: 'set_count',
      quantityDelta,
      previousQuantity,
      newQuantity: validatedQty,
      note,
      createdAt: now,
    };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // rollback error suppressed to rethrow original error
    }
    throw error;
  }
}

export async function recordDelivery(
  db: DatabaseSession,
  params: {
    productId: string;
    deliveryQuantity: number;
    note?: string | null;
  }
): Promise<InventoryMovement> {
  const validatedQty = validateDeliveryQuantity(params.deliveryQuantity);

  await db.exec('BEGIN IMMEDIATE');
  try {
    const product = await db.getFirst<{ id: string }>(
      'SELECT id FROM products WHERE id = ?;',
      [params.productId]
    );
    if (!product) {
      throw new StockValidationError(`Hindi mahanap ang produkto na may ID: ${params.productId}`);
    }

    const currentStock = await getStockLevel(db, params.productId);
    const previousQuantity = currentStock !== null ? currentStock.quantity : null;
    const newQuantity = (previousQuantity ?? 0) + validatedQty;
    const quantityDelta = validatedQty;
    const movementId = generateMovementId();
    const now = new Date().toISOString();
    const note = params.note ?? null;

    await db.run(
      `INSERT INTO stock_levels (product_id, quantity, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(product_id) DO UPDATE SET
         quantity = excluded.quantity,
         updated_at = excluded.updated_at;`,
      [params.productId, newQuantity, now]
    );

    await db.run(
      `INSERT INTO inventory_movements (
         id, product_id, movement_type, quantity_delta,
         previous_quantity, new_quantity, note, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        movementId,
        params.productId,
        'add_delivery',
        quantityDelta,
        previousQuantity,
        newQuantity,
        note,
        now,
      ]
    );

    await db.exec('COMMIT');

    return {
      id: movementId,
      productId: params.productId,
      movementType: 'add_delivery',
      quantityDelta,
      previousQuantity,
      newQuantity,
      note,
      createdAt: now,
    };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // rollback error suppressed to rethrow original error
    }
    throw error;
  }
}

export async function getInventoryHistory(
  db: DatabaseSession,
  productId: string
): Promise<InventoryMovement[]> {
  const rows = await db.getAll<InventoryMovementRow>(
    `SELECT id, product_id, movement_type, quantity_delta,
            previous_quantity, new_quantity, note, created_at
     FROM inventory_movements
     WHERE product_id = ?
     ORDER BY created_at DESC, rowid DESC;`,
    [productId]
  );

  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    movementType: row.movement_type,
    quantityDelta: row.quantity_delta,
    previousQuantity: row.previous_quantity,
    newQuantity: row.new_quantity,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export async function getAllProductsWithStock(
  db: DatabaseSession
): Promise<ProductWithStock[]> {
  const rows = await db.getAll<ProductWithStockRow>(
    `SELECT 
       p.id,
       p.name,
       p.variant,
       p.unit,
       p.price_centavos,
       p.created_at,
       p.updated_at,
       s.quantity,
       s.updated_at AS stock_updated_at
     FROM products p
     LEFT JOIN stock_levels s ON p.id = s.product_id
     ORDER BY p.name_normalized ASC, p.variant_normalized ASC;`
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    variant: row.variant,
    unit: row.unit,
    priceCentavos: row.price_centavos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    quantity: row.quantity,
    stockUpdatedAt: row.stock_updated_at,
  }));
}
