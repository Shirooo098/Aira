import type { DatabaseSession } from '../db/database.ts';
import type { Product, ProductDraft, LookupResult } from '../types.ts';
import { validateProductDraft, generateProductId, normalizeText, CatalogValidationError } from '../domain/catalog.ts';

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

  // 1. Check exact match on product name
  const exactNameRows = await db.getAll<ProductRow>(
    'SELECT * FROM products WHERE name_normalized = ?;',
    [query]
  );

  if (exactNameRows.length === 1) {
    const row = exactNameRows[0];
    if (row) return { kind: 'exact', product: mapRow(row) };
  } else if (exactNameRows.length > 1) {
    return {
      kind: 'ambiguous',
      query: rawQuery,
      products: exactNameRows.map(mapRow),
    };
  }

  // 2. Check exact match on name + variant (e.g. "Coke 1.5L" or "Coke Maliit")
  const allRows = await db.getAll<ProductRow>('SELECT * FROM products;');
  const exactComboMatches = allRows.filter((r) => {
    const combo1 = `${r.name_normalized} ${r.variant_normalized}`;
    const combo2 = `${r.name_normalized} - ${r.variant_normalized}`;
    return combo1 === query || combo2 === query;
  });

  if (exactComboMatches.length === 1) {
    const row = exactComboMatches[0];
    if (row) return { kind: 'exact', product: mapRow(row) };
  } else if (exactComboMatches.length > 1) {
    return {
      kind: 'ambiguous',
      query: rawQuery,
      products: exactComboMatches.map(mapRow),
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

  if (partialMatches.length === 1) {
    const row = partialMatches[0];
    if (row) return { kind: 'exact', product: mapRow(row) };
  } else if (partialMatches.length > 1) {
    return {
      kind: 'ambiguous',
      query: rawQuery,
      products: partialMatches.map(mapRow),
    };
  }

  // 4. Unknown product - NEVER invents a price
  return { kind: 'unknown', query: rawQuery };
}
