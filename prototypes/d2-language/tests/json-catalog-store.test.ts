import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

import { JsonCatalogStore } from "../src/adapters/json-catalog-store";
import { approveAlias, proposeAlias } from "../src/core/aliases";
import { resolveProduct, type Product } from "../src/core/language";

const temporaryDirectories: string[] = [];
const temporaryRoot = resolve(tmpdir());

const seed: Product[] = [{
  id: "coke-small",
  name: "Coke 200 mL",
  aliases: [],
  priceCentavos: 1500,
}];

async function makeFilePath(): Promise<string> {
  const directory = await mkdtemp(
    join(temporaryRoot, "aira-catalog-test-"),
  );

  temporaryDirectories.push(directory);
  return join(directory, "catalog.json");
}

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    const target = resolve(directory);

    if (
      dirname(target) !== temporaryRoot ||
      !basename(target).startsWith("aira-catalog-test-")
    ) {
      throw new Error("Unexpected cleanup target.");
    }

    await rm(target, { recursive: true, force: true });
  }
});

describe("desktop catalog persistence", () => {
  it("loads fixtures when no file exists", async () => {
    const store = new JsonCatalogStore(await makeFilePath(), seed);

    expect(await store.load()).toEqual(seed);
  });

  it("reuses an approved alias from a new store instance", async () => {
    const filePath = await makeFilePath();
    const firstStore = new JsonCatalogStore(filePath, seed);
    const catalog = await firstStore.load();

    const proposed = proposeAlias("Coke sakto", "coke-small", catalog);

    if (proposed.kind !== "review") {
      throw new Error("Expected a review proposal.");
    }

    const approved = approveAlias(proposed.proposal, catalog);

    if (approved.kind !== "approved") {
      throw new Error("Expected approval.");
    }

    await firstStore.save(approved.catalog);

    const restartedStore = new JsonCatalogStore(filePath, []);
    const restored = await restartedStore.load();

    expect(
      resolveProduct("Coke sakto", restored)
        .map(product => product.id),
    ).toEqual(["coke-small"]);
  });

  it("surfaces a corrupt file without replacing it", async () => {
    const filePath = await makeFilePath();
    await writeFile(filePath, "broken JSON", "utf8");

    const store = new JsonCatalogStore(filePath, seed);

    await expect(store.load()).rejects.toThrow();
    expect(await readFile(filePath, "utf8")).toBe("broken JSON");
  });

  it("rejects duplicate IDs before replacing saved data", async () => {
    const filePath = await makeFilePath();
    const store = new JsonCatalogStore(filePath, seed);

    await store.save(seed);
    const before = await readFile(filePath, "utf8");

    await expect(store.save([seed[0], seed[0]])).rejects.toThrow();

    expect(await readFile(filePath, "utf8")).toBe(before);
  });
});