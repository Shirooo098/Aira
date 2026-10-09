import type { DatabaseSession } from '../db/database.ts';
import {
  parseNotebookText,
  type NotebookProposalRow,
} from '../domain/notebook.ts';
import { normalizeText } from '../domain/catalog.ts';

export class NotebookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotebookValidationError';
  }
}

interface ProductDbRow {
  id: string;
  name: string;
  variant: string;
  unit: string;
  price_centavos: number;
}

interface StockDbRow {
  product_id: string;
  quantity: number | null;
}

/**
 * Matches extracted notebook text against existing catalog products.
 * Distinguishes new products from price updates on existing products.
 */
export async function proposeNotebookCatalogUpdates(
  db: DatabaseSession,
  rawOcrText: string
): Promise<NotebookProposalRow[]> {
  const parsedLines = parseNotebookText(rawOcrText);

  // Fetch all existing products
  const products = await db.getAll<ProductDbRow>(
    'SELECT id, name, variant, unit, price_centavos FROM products;'
  );

  // Fetch stock levels
  const stockRows = await db.getAll<StockDbRow>(
    'SELECT product_id, quantity FROM stock_levels;'
  );
  const stockMap = new Map<string, number | null>();
  for (const s of stockRows) {
    stockMap.set(s.product_id, s.quantity);
  }

  const proposals: NotebookProposalRow[] = [];

  for (let i = 0; i < parsedLines.length; i++) {
    const line = parsedLines[i]!;
    const normName = normalizeText(line.name);
    const normVariant = normalizeText(line.variant);

    // Look for exact product match by normalized name and variant
    const matched = products.find(
      (p) =>
        normalizeText(p.name) === normName &&
        normalizeText(p.variant) === normVariant
    );

    const reasons: string[] = [...line.warnings];
    if (line.priceCentavos === null || line.priceCentavos <= 0) {
      reasons.push('Kailangang maglagay ng wastong presyo bago i-save.');
    }
    if (!line.name.trim()) {
      reasons.push('Kailangang tukuyin ang pangalan ng produkto.');
    }

    const isReady =
      reasons.length === 0 &&
      line.name.trim().length > 0 &&
      line.priceCentavos !== null &&
      line.priceCentavos > 0;

    proposals.push({
      id: `nb_row_${Date.now()}_${i}`,
      rawLine: line.rawLine,
      name: line.name,
      variant: line.variant,
      unit: line.unit,
      priceInput: line.priceInput,
      priceCentavos: line.priceCentavos,
      status: isReady ? 'ready' : 'needs_clarification',
      clarificationReasons: reasons,
      matchedProductId: matched?.id,
      existingPriceCentavos: matched?.price_centavos,
      existingStock: matched ? (stockMap.get(matched.id) ?? null) : null,
      action: matched ? 'update_price' : 'create_product',
    });
  }

  return proposals;
}

/**
 * Commits reviewed notebook updates to the SQLite database.
 * Preserves inventory stock levels on price updates and avoids duplicate creation.
 */
export async function applyNotebookCatalogUpdates(
  db: DatabaseSession,
  rows: NotebookProposalRow[]
): Promise<{ updatedCount: number; createdCount: number }> {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new NotebookValidationError('Walang aytem na napiling i-apply.');
  }

  // Validate that all rows are ready
  for (const row of rows) {
    if (row.status === 'needs_clarification') {
      const reason = row.clarificationReasons.join(', ') || 'may kulang na impormasyon';
      throw new NotebookValidationError(
        `Hindi maaaring i-save ang "${row.name || row.rawLine}": ${reason}.`
      );
    }
    if (row.priceCentavos === null || row.priceCentavos <= 0) {
      throw new NotebookValidationError(
        `Hindi wastong presyo para sa "${row.name}": dapat higit sa zero ang halaga.`
      );
    }
  }

  await db.exec('BEGIN IMMEDIATE');
  try {
    let updatedCount = 0;
    let createdCount = 0;
    const now = new Date().toISOString();

    for (const row of rows) {
      const normName = normalizeText(row.name);
      const normVariant = normalizeText(row.variant);
      const normUnit = normalizeText(row.unit);

      // Check if product exists right now in DB
      const existingProduct = await db.getFirst<ProductDbRow>(
        `SELECT id, name, variant, unit, price_centavos
         FROM products
         WHERE name_normalized = ? AND variant_normalized = ?;`,
        [normName, normVariant]
      );

      if (existingProduct) {
        // Price update on existing product — preserves stock!
        await db.run(
          'UPDATE products SET price_centavos = ?, updated_at = ? WHERE id = ?;',
          [row.priceCentavos, now, existingProduct.id]
        );
        updatedCount++;
      } else {
        // Create new product
        const newId = `prod_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        await db.run(
          `INSERT INTO products (
             id, name, variant, unit, price_centavos,
             name_normalized, variant_normalized, unit_normalized,
             created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
          [
            newId,
            row.name.trim(),
            row.variant.trim(),
            row.unit.trim(),
            row.priceCentavos,
            normName,
            normVariant,
            normUnit,
            now,
            now,
          ]
        );
        createdCount++;
      }
    }

    await db.exec('COMMIT');
    return { updatedCount, createdCount };
  } catch (error) {
    try {
      await db.exec('ROLLBACK');
    } catch {}
    throw error;
  }
}
