import type { DatabaseSession } from '../db/database.ts';
import type { Product } from '../types.ts';
import { normalizeText } from '../domain/catalog.ts';
import {
  AliasValidationError,
  type AliasProposal,
  validateAlias,
} from '../domain/aliases.ts';

interface ProductRow {
  id: string;
  name: string;
  variant: string;
  unit: string;
  price_centavos: number;
  name_normalized: string;
  variant_normalized: string;
  unit_normalized: string;
  created_at: string;
  updated_at: string;
}

interface AliasRow {
  alias_text: string;
  alias_normalized: string;
  product_id: string;
  created_at: string;
}

function mapProduct(row: ProductRow): Product {
  return {
    id: row.id,
    name: row.name,
    variant: row.variant,
    unit: row.unit,
    priceCentavos: row.price_centavos,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function prepareAlias(
  db: DatabaseSession,
  productId: string,
  aliasText: string
): Promise<AliasProposal> {
  const validated = validateAlias(aliasText);
  const productRow = await db.getFirst<ProductRow>(
    'SELECT * FROM products WHERE id = ?;',
    [productId]
  );
  if (!productRow) {
    throw new AliasValidationError(`Hindi mahanap ang produkto na may ID: ${productId}`);
  }

  const aliasConflictRows = await db.getAll<ProductRow>(
    `SELECT p.*
     FROM product_aliases a
     JOIN products p ON p.id = a.product_id
     WHERE a.alias_normalized = ? AND p.id <> ?
     ORDER BY p.name_normalized, p.variant_normalized, p.unit_normalized;`,
    [validated.aliasNormalized, productId]
  );
  const productRows = await db.getAll<ProductRow>('SELECT * FROM products;');
  const conflictProducts = new Map<string, ProductRow>();
  const canonicalQuery = normalizeText(validated.aliasText);
  for (const row of aliasConflictRows) conflictProducts.set(row.id, row);
  for (const row of productRows) {
    const exactNameMatch = row.name_normalized === canonicalQuery;
    const exactComboMatch =
      `${row.name_normalized} ${row.variant_normalized}` === canonicalQuery ||
      `${row.name_normalized} - ${row.variant_normalized}` === canonicalQuery;
    if ((exactNameMatch || exactComboMatch) && row.id !== productId) {
      conflictProducts.set(row.id, row);
    }
  }

  return {
    ...validated,
    product: mapProduct(productRow),
    conflicts: [...conflictProducts.values()]
      .sort((a, b) =>
        a.name_normalized.localeCompare(b.name_normalized) ||
        a.variant_normalized.localeCompare(b.variant_normalized) ||
        a.unit_normalized.localeCompare(b.unit_normalized)
      )
      .map(mapProduct),
  };
}

export async function confirmAlias(
  db: DatabaseSession,
  proposal: AliasProposal
): Promise<void> {
  if (!proposal || typeof proposal !== 'object' || !proposal.product) {
    throw new AliasValidationError('Hindi kumpleto ang nirepasong palayaw ng produkto');
  }

  const validated = validateAlias(proposal.aliasText);
  if (proposal.aliasNormalized !== validated.aliasNormalized) {
    throw new AliasValidationError('Nagbago ang nirepasong palayaw ng produkto');
  }

  const reviewedProduct = proposal.product;
  const productRow = await db.getFirst<ProductRow>(
    'SELECT * FROM products WHERE id = ?;',
    [reviewedProduct.id]
  );
  if (
    !productRow ||
    productRow.name !== reviewedProduct.name ||
    productRow.variant !== reviewedProduct.variant ||
    productRow.unit !== reviewedProduct.unit
  ) {
    throw new AliasValidationError('Nagbago ang produkto matapos itong repasuhin; suriin muli bago mag-save');
  }

  const createdAt = new Date().toISOString();
  await db.run(
    `INSERT INTO product_aliases (alias_normalized, product_id, alias_text, created_at)
     SELECT ?, id, ?, ?
     FROM products
     WHERE id = ? AND name = ? AND variant = ? AND unit = ?
     ON CONFLICT (alias_normalized, product_id) DO NOTHING;`,
    [
      validated.aliasNormalized,
      validated.aliasText,
      createdAt,
      reviewedProduct.id,
      reviewedProduct.name,
      reviewedProduct.variant,
      reviewedProduct.unit,
    ]
  );

  const mapping = await db.getFirst<AliasRow>(
    `SELECT a.alias_text, a.alias_normalized, a.product_id, a.created_at
     FROM product_aliases a
     JOIN products p ON p.id = a.product_id
     WHERE a.alias_normalized = ? AND a.product_id = ?
       AND p.name = ? AND p.variant = ? AND p.unit = ?;`,
    [
      validated.aliasNormalized,
      reviewedProduct.id,
      reviewedProduct.name,
      reviewedProduct.variant,
      reviewedProduct.unit,
    ]
  );
  if (!mapping) {
    throw new AliasValidationError('Hindi na-save ang palayaw; suriin muli ang produkto bago mag-save');
  }
}

export async function getProductAliases(
  db: DatabaseSession,
  productId: string
): Promise<Array<{ aliasText: string; aliasNormalized: string; productId: string; createdAt: string }>> {
  const rows = await db.getAll<AliasRow>(
    `SELECT alias_text, alias_normalized, product_id, created_at
     FROM product_aliases
     WHERE product_id = ?
     ORDER BY alias_normalized ASC;`,
    [productId]
  );
  return rows.map((row) => ({
    aliasText: row.alias_text,
    aliasNormalized: row.alias_normalized,
    productId: row.product_id,
    createdAt: row.created_at,
  }));
}
