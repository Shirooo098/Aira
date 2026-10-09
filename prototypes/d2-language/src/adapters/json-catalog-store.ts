import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { CatalogStore } from "../core/catalog-store";
import type { Product } from "../core/language";

const ProductSchema = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(120),
  aliases: z.array(
    z.string().trim().min(1).max(120),
  ),
  priceCentavos: z.number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER),
}).strict();

const CatalogSchema = z.array(ProductSchema).superRefine(
  (products, context) => {
    const ids = new Set<string>();

    for (const product of products) {
      if (ids.has(product.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Duplicate product ID: " + product.id,
        });
      }

      ids.add(product.id);
    }
  },
);

const DocumentSchema = z.object({
  version: z.literal(1),
  products: CatalogSchema,
}).strict();

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === code
  );
}

export class JsonCatalogStore implements CatalogStore {
  constructor(
    private readonly filePath: string,
    private readonly seedCatalog: readonly Product[],
  ) {}

  async load(): Promise<Product[]> {
    let contents: string;

    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (hasErrorCode(error, "ENOENT")) {
        // A fresh prototype starts with fixtures.
        // Existing invalid files must not silently reset to fixtures.
        return CatalogSchema.parse(this.seedCatalog);
      }

      throw error;
    }

    const document = DocumentSchema.parse(JSON.parse(contents));
    return document.products;
  }

  async save(catalog: readonly Product[]): Promise<void> {
    const products = CatalogSchema.parse(catalog);

    const contents = JSON.stringify(
      { version: 1, products },
      null,
      2,
    );

    await mkdir(dirname(this.filePath), { recursive: true });

    const temporaryPath =
      this.filePath + "." + randomUUID() + ".tmp";

    try {
      await writeFile(temporaryPath, contents, {
        encoding: "utf8",
        flag: "wx",
      });

      // Replace the destination only after the full file is written.
      await rename(temporaryPath, this.filePath);
    } finally {
      try {
        await unlink(temporaryPath);
      } catch (error) {
        if (!hasErrorCode(error, "ENOENT")) {
          throw error;
        }
      }
    }
  }
}