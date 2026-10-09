import type { DatabaseSession } from '../db/database.ts';
import type { Product, ProductDraft, LookupResult } from '../types.ts';
import { validateProductDraft, generateProductId, normalizeText, CatalogValidationError } from '../domain/catalog.ts';
import { normalizeAlias } from '../domain/aliases.ts';

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

function mapRow(row: ProductRow): Product {
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

export async function saveProduct(
  db: DatabaseSession,
  draft: ProductDraft
): Promise<Product> {
  const validated = validateProductDraft(draft);

  const existing = await db.getFirst<ProductRow>(
    'SELECT id FROM products WHERE name_normalized = ? AND variant_normalized = ? AND unit_normalized = ?;',
    [validated.nameNormalized, validated.variantNormalized, validated.unitNormalized]
  );

  if (existing) {
    throw new CatalogValidationError(
      `Mayroon nang nakatalang produkto: "${validated.name}" (${validated.variant}, ${validated.unit})`
    );
  }

  const id = generateProductId();
  const now = new Date().toISOString();

  await db.run(
    `INSERT INTO products (
      id, name, variant, unit, price_centavos,
      name_normalized, variant_normalized, unit_normalized,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [
      id,
      validated.name,
      validated.variant,
      validated.unit,
      validated.priceCentavos,
      validated.nameNormalized,
      validated.variantNormalized,
      validated.unitNormalized,
      now,
      now,
    ]
  );

  return {
    id,
    name: validated.name,
    variant: validated.variant,
    unit: validated.unit,
    priceCentavos: validated.priceCentavos,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getProductById(
  db: DatabaseSession,
  id: string
): Promise<Product | null> {
  const row = await db.getFirst<ProductRow>(
    'SELECT * FROM products WHERE id = ?;',
    [id]
  );
  return row ? mapRow(row) : null;
}

export async function getAllProducts(db: DatabaseSession): Promise<Product[]> {
  const rows = await db.getAll<ProductRow>(
    'SELECT * FROM products ORDER BY name_normalized ASC, variant_normalized ASC;'
  );
  return rows.map(mapRow);
}

export async function lookupProduct(
  db: DatabaseSession,
  rawQuery: string
): Promise<LookupResult> {
  const query = normalizeText(rawQuery);
  if (query.length === 0) {
    return { kind: 'empty' };
  }

  // Preserve the catalog's existing normalized-text behavior while normalizing
  // aliases independently so older product rows do not change semantics.
  const aliasQuery = normalizeAlias(rawQuery);
  const allRows = await db.getAll<ProductRow>('SELECT * FROM products;');
  const exactCandidates = new Map<string, ProductRow>();

  // Exact product-name matches and exact name + variant matches are collected
  // together with aliases so a collision can never return early as a single hit.
  for (const row of allRows) {
    if (row.name_normalized === query) exactCandidates.set(row.id, row);
  }

  const exactComboMatches = allRows.filter((r) => {
    const combo1 = `${r.name_normalized} ${r.variant_normalized}`;
    const combo2 = `${r.name_normalized} - ${r.variant_normalized}`;
    return combo1 === query || combo2 === query;
  });
  for (const row of exactComboMatches) exactCandidates.set(row.id, row);

  const aliasRows = await db.getAll<ProductRow>(
    `SELECT p.*
     FROM product_aliases a
     JOIN products p ON p.id = a.product_id
     WHERE a.alias_normalized = ?;`,
    [aliasQuery]
  );
  for (const row of aliasRows) exactCandidates.set(row.id, row);

  if (exactCandidates.size === 1) {
    const row = exactCandidates.values().next().value;
    if (row) return { kind: 'exact', product: mapRow(row) };
  } else if (exactCandidates.size > 1) {
    return {
      kind: 'ambiguous',
      query: rawQuery,
      products: [...exactCandidates.values()].map(mapRow),
    };
  }

  // Search only within saved text; an unknown variant must not inherit a known name's price.
  const partialMatches = allRows.filter((r) => {
    const fullName = `${r.name_normalized} ${r.variant_normalized}`;
    return (
      r.name_normalized.includes(query) ||
      fullName.includes(query)
    );
  });

  if (partialMatches.length > 0) {
    return {
      kind: 'ambiguous',
      query: rawQuery,
      products: partialMatches.map(mapRow),
    };
  }

  // 4. Unknown product - NEVER invents a price
  return { kind: 'unknown', query: rawQuery };
}

export async function updateProductPrice(
  db: DatabaseSession,
  productId: string,
  newPriceCentavos: number
): Promise<Product> {
  if (!Number.isSafeInteger(newPriceCentavos) || newPriceCentavos < 0) {
    throw new CatalogValidationError('Maling halaga ng presyo sa centavos');
  }

  const existing = await getProductById(db, productId);
  if (!existing) {
    throw new CatalogValidationError(`Hindi mahanap ang produkto na may ID: ${productId}`);
  }

  const now = new Date().toISOString();
  await db.run(
    'UPDATE products SET price_centavos = ?, updated_at = ? WHERE id = ?;',
    [newPriceCentavos, now, productId]
  );

  return {
    ...existing,
    priceCentavos: newPriceCentavos,
    updatedAt: now,
  };
}
