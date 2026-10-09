import type { DatabaseSession } from '../db/database.ts';
import type {
  Customer,
  CustomerWithBalance,
  CreditEntry,
  Sale,
  SaleItem,
} from '../types.ts';
import {
  CustomerValidationError,
  CreditValidationError,
  validateCustomerName,
  validateCentavoAmount,
  generateCustomerId,
  generateCreditEntryId,
} from '../domain/utang.ts';
import {
  SaleValidationError,
  InsufficientStockError,
  calculateSubtotal,
  calculateSaleTotal,
  generateSaleId,
  generateSaleItemId,
} from '../domain/sales.ts';
import { generateMovementId } from '../domain/inventory.ts';

interface CustomerRow {
  id: string;
  name: string;
  nickname: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface CreditEntryRow {
  id: string;
  customer_id: string;
  entry_type: 'sale_credit' | 'opening_balance';
  sale_id: string | null;
  original_amount_centavos: number;
  remaining_amount_centavos: number;
  description: string | null;
  original_date: string | null;
  created_at: string;
  updated_at: string;
}

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
  customer_id: string | null;
  payment_method: 'cash' | 'gcash';
  total_centavos: number;
  tender_centavos: number;
  change_centavos: number;
  paid_centavos: number;
  credit_centavos: number;
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

function mapCreditEntryRow(row: CreditEntryRow): CreditEntry {
  return {
    id: row.id,
    customerId: row.customer_id,
    entryType: row.entry_type,
    saleId: row.sale_id ?? null,
    originalAmountCentavos: row.original_amount_centavos,
    remainingAmountCentavos: row.remaining_amount_centavos,
    description: row.description ?? null,
    originalDate: row.original_date ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function mapSaleRow(row: SaleRow, items: SaleItem[]): Sale {
  return {
    id: row.id,
    customerId: row.customer_id ?? null,
    paymentMethod: row.payment_method,
    totalCentavos: row.total_centavos,
    tenderCentavos: row.tender_centavos,
    changeCentavos: row.change_centavos,
    paidCentavos: row.paid_centavos,
    creditCentavos: row.credit_centavos,
    referenceNumber: row.reference_number ?? null,
    createdAt: row.created_at,
    items,
  };
}

export async function createCustomer(
  db: DatabaseSession,
  params: { name: string; nickname?: string; note?: string }
): Promise<Customer> {
  const validatedName = validateCustomerName(params.name);
  const nickname = params.nickname?.trim() || null;
  const note = params.note?.trim() || null;
  const id = generateCustomerId();
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO customers (id, name, nickname, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [id, validatedName, nickname, note, now, now]
  );

  return {
    id,
    name: validatedName,
    nickname,
    note,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getCustomers(db: DatabaseSession): Promise<CustomerWithBalance[]> {
  const rows = await db.getAll<
    CustomerRow & { total_debt: number | null; active_credit_count: number }
  >(`
    SELECT
      c.id, c.name, c.nickname, c.note, c.created_at, c.updated_at,
      COALESCE(SUM(ce.remaining_amount_centavos), 0) AS total_debt,
      COUNT(CASE WHEN ce.remaining_amount_centavos > 0 THEN 1 END) AS active_credit_count
    FROM customers c
    LEFT JOIN credit_entries ce ON c.id = ce.customer_id
    GROUP BY c.id
    ORDER BY c.name COLLATE NOCASE ASC, c.created_at ASC;
  `);

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    nickname: r.nickname ?? null,
    note: r.note ?? null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalDebtCentavos: r.total_debt ?? 0,
    activeCreditCount: r.active_credit_count ?? 0,
  }));
}

export async function getCustomerById(
  db: DatabaseSession,
  customerId: string
): Promise<CustomerWithBalance | null> {
  const row = await db.getFirst<
    CustomerRow & { total_debt: number | null; active_credit_count: number }
  >(
    `
    SELECT
      c.id, c.name, c.nickname, c.note, c.created_at, c.updated_at,
      COALESCE(SUM(ce.remaining_amount_centavos), 0) AS total_debt,
      COUNT(CASE WHEN ce.remaining_amount_centavos > 0 THEN 1 END) AS active_credit_count
    FROM customers c
    LEFT JOIN credit_entries ce ON c.id = ce.customer_id
    WHERE c.id = ?
    GROUP BY c.id;
  `,
    [customerId]
  );

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    nickname: row.nickname ?? null,
    note: row.note ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    totalDebtCentavos: row.total_debt ?? 0,
    activeCreditCount: row.active_credit_count ?? 0,
  };
}

export async function recordOpeningBalance(
  db: DatabaseSession,
  params: {
    customerId: string;
    amountCentavos: number;
    description?: string;
    originalDate?: string | null;
  }
): Promise<CreditEntry> {
  const validatedAmount = validateCentavoAmount(params.amountCentavos, 'opening balance');
  if (validatedAmount <= 0) {
    throw new CreditValidationError('Dapat higit sa zero ang halaga ng dating utang');
  }

  // Ensure customer exists
  const customer = await db.getFirst<CustomerRow>(
    'SELECT id FROM customers WHERE id = ?;',
    [params.customerId]
  );
  if (!customer) {
    throw new CustomerValidationError(`Hindi mahanap ang suki na may ID: ${params.customerId}`);
  }

  const id = generateCreditEntryId();
  const description = params.description?.trim() || 'Utang Bago Nag-Aira';
  const originalDate = params.originalDate !== undefined && params.originalDate !== null && params.originalDate.trim().length > 0
    ? params.originalDate.trim()
    : null;
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO credit_entries (
       id, customer_id, entry_type, sale_id, original_amount_centavos,
       remaining_amount_centavos, description, original_date, created_at, updated_at
     ) VALUES (?, ?, 'opening_balance', NULL, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      params.customerId,
      validatedAmount,
      validatedAmount,
      description,
      originalDate,
      now,
      now,
    ]
  );

  return {
    id,
    customerId: params.customerId,
    entryType: 'opening_balance',
    saleId: null,
    originalAmountCentavos: validatedAmount,
    remainingAmountCentavos: validatedAmount,
    description,
    originalDate,
    createdAt: now,
    updatedAt: now,
  };
}

export async function completeCreditSale(
  db: DatabaseSession,
  params: {
    customerId: string;
    items: Array<{ productId: string; quantity: number }>;
    paidCentavos: number;
    paymentMethod: 'cash' | 'gcash';
    gcashReference?: string;
    idempotencyKey?: string;
  }
): Promise<{ sale: Sale; creditEntry: CreditEntry | null }> {
  if (!params.customerId) {
    throw new CustomerValidationError('Kailangang pumili ng suki para sa pautang');
  }

  if (!Array.isArray(params.items) || params.items.length === 0) {
    throw new SaleValidationError('Walang aytem sa benta');
  }

  const paidCentavos = validateCentavoAmount(params.paidCentavos, 'bayad');

  // Idempotency check before lock
  if (params.idempotencyKey) {
    const existingSale = await db.getFirst<SaleRow>(
      `SELECT id, customer_id, payment_method, total_centavos, tender_centavos,
              change_centavos, paid_centavos, credit_centavos, reference_number,
              idempotency_key, created_at
       FROM sales WHERE idempotency_key = ?;`,
      [params.idempotencyKey]
    );

    if (existingSale) {
      const items = await getSaleItems(db, existingSale.id);
      const creditEntryRow = await db.getFirst<CreditEntryRow>(
        'SELECT * FROM credit_entries WHERE sale_id = ?;',
        [existingSale.id]
      );
      return {
        sale: mapSaleRow(existingSale, items),
        creditEntry: creditEntryRow ? mapCreditEntryRow(creditEntryRow) : null,
      };
    }
  }

  // Pre-validate items: check safe quantities and consolidate per productId
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
        `SELECT id, customer_id, payment_method, total_centavos, tender_centavos,
                change_centavos, paid_centavos, credit_centavos, reference_number,
                idempotency_key, created_at
         FROM sales WHERE idempotency_key = ?;`,
        [params.idempotencyKey]
      );

      if (existingSale) {
        await db.exec('COMMIT');
        const items = await getSaleItems(db, existingSale.id);
        const creditEntryRow = await db.getFirst<CreditEntryRow>(
          'SELECT * FROM credit_entries WHERE sale_id = ?;',
          [existingSale.id]
        );
        return {
          sale: mapSaleRow(existingSale, items),
          creditEntry: creditEntryRow ? mapCreditEntryRow(creditEntryRow) : null,
        };
      }
    }

    // Check customer existence
    const customer = await db.getFirst<CustomerRow>(
      'SELECT id, name FROM customers WHERE id = ?;',
      [params.customerId]
    );
    if (!customer) {
      throw new CustomerValidationError(`Hindi mahanap ang suki na may ID: ${params.customerId}`);
    }

    // Fetch product snapshots and stock levels
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
      throw new InsufficientStockError(
        'Kulang o hindi pa nabibilang ang stock para sa transaksyon',
        insufficientDetails
      );
    }

    // Generate sale ID and compute line items
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

    if (paidCentavos > totalCentavos) {
      throw new SaleValidationError('Hindi maaaring higit ang bayad sa kabuuang halaga ng pautang');
    }

    const creditCentavos = totalCentavos - paidCentavos;
    const refNum = params.paymentMethod === 'gcash' && params.gcashReference?.trim()
      ? params.gcashReference.trim()
      : null;

    // Insert sales row
    await db.run(
      `INSERT INTO sales (
         id, customer_id, payment_method, total_centavos, tender_centavos,
         change_centavos, paid_centavos, credit_centavos, reference_number,
         idempotency_key, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        saleId,
        params.customerId,
        params.paymentMethod,
        totalCentavos,
        paidCentavos, // tender_centavos represents amount tendered towards this sale
        0,            // change is 0 since paidCentavos <= totalCentavos
        paidCentavos,
        creditCentavos,
        refNum,
        params.idempotencyKey ?? null,
        now,
      ]
    );

    // Insert sale items
    for (const item of saleItemsToInsert) {
      await db.run(
        `INSERT INTO sale_items (
           id, sale_id, product_id, product_name, product_variant, product_unit,
           unit_price_centavos, quantity, subtotal_centavos
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        [
          item.id,
          item.saleId,
          item.productId,
          item.productName,
          item.productVariant,
          item.productUnit,
          item.unitPriceCentavos,
          item.quantity,
          item.subtotalCentavos,
        ]
      );
    }

    // Deduct stock levels and record inventory movements
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
          `Pautang: ${saleId}`,
          now,
        ]
      );
    }

    // If there is an unpaid remainder (creditCentavos > 0), insert into credit_entries
    let creditEntry: CreditEntry | null = null;
    if (creditCentavos > 0) {
      const creditId = generateCreditEntryId();
      await db.run(
        `INSERT INTO credit_entries (
           id, customer_id, entry_type, sale_id, original_amount_centavos,
           remaining_amount_centavos, description, original_date, created_at, updated_at
         ) VALUES (?, ?, 'sale_credit', ?, ?, ?, ?, NULL, ?, ?);`,
        [
          creditId,
          params.customerId,
          saleId,
          creditCentavos,
          creditCentavos,
          paidCentavos > 0 ? `Kulang na bayad sa benta: ${saleId}` : `Buong pautang sa benta: ${saleId}`,
          now,
          now,
        ]
      );

      creditEntry = {
        id: creditId,
        customerId: params.customerId,
        entryType: 'sale_credit',
        saleId,
        originalAmountCentavos: creditCentavos,
        remainingAmountCentavos: creditCentavos,
        description: paidCentavos > 0 ? `Kulang na bayad sa benta: ${saleId}` : `Buong pautang sa benta: ${saleId}`,
        originalDate: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    await db.exec('COMMIT');

    const sale: Sale = {
      id: saleId,
      customerId: params.customerId,
      totalCentavos,
      paymentMethod: params.paymentMethod,
      tenderCentavos: paidCentavos,
      changeCentavos: 0,
      paidCentavos,
      creditCentavos,
      referenceNumber: refNum,
      createdAt: now,
      items: saleItemsToInsert,
    };

    return { sale, creditEntry };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {
      // rollback error suppressed
    }
    throw error;
  }
}

export async function getCustomerLedger(
  db: DatabaseSession,
  customerId: string
): Promise<{
  customer: CustomerWithBalance;
  creditEntries: CreditEntry[];
  sales: Sale[];
}> {
  const customer = await getCustomerById(db, customerId);
  if (!customer) {
    throw new CustomerValidationError(`Hindi mahanap ang suki na may ID: ${customerId}`);
  }

  const creditRows = await db.getAll<CreditEntryRow>(
    `SELECT id, customer_id, entry_type, sale_id, original_amount_centavos,
            remaining_amount_centavos, description, original_date, created_at, updated_at
     FROM credit_entries
     WHERE customer_id = ?
     ORDER BY created_at ASC;`,
    [customerId]
  );

  const creditEntries = creditRows.map(mapCreditEntryRow);

  const saleRows = await db.getAll<SaleRow>(
    `SELECT id, customer_id, payment_method, total_centavos, tender_centavos,
            change_centavos, paid_centavos, credit_centavos, reference_number,
            idempotency_key, created_at
     FROM sales
     WHERE customer_id = ?
     ORDER BY created_at DESC;`,
    [customerId]
  );

  const sales: Sale[] = [];
  for (const sRow of saleRows) {
    const items = await getSaleItems(db, sRow.id);
    sales.push(mapSaleRow(sRow, items));
  }

  return {
    customer,
    creditEntries,
    sales,
  };
}
