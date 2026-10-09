import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { prototypeCatalogStore } from "./adapters/prototype-catalog";
import { approveAlias, proposeAlias } from "./core/aliases";
import { resolveProduct } from "./core/language";

async function main() {
  const alias = process.argv[2];
  const productId = process.argv[3];

  if (!alias || !productId) {
    console.log(
      'Usage: npx tsx src/demo-alias.ts "Coke sakto" coke-200ml',
    );
    return;
  }

  const catalog = await prototypeCatalogStore.load();

  const proposed = proposeAlias(alias, productId, catalog);

  if (proposed.kind !== "review") {
    console.log(proposed.message);
    return;
  }

  console.log("Review alias:");
  console.table([proposed.proposal]);

  const existing = resolveProduct(alias, catalog);

  if (existing.some(product => product.id !== productId)) {
    console.log(
      "This alias also matches another product. Lookup will require a choice.",
    );
  }

  const terminal = createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    const answer = await terminal.question(
      "Type APPROVE to save this alias, or anything else to cancel: ",
    );

    if (answer.trim() !== "APPROVE") {
      console.log("Cancelled. Nothing saved.");
      return;
    }

    // Recheck against the current stored catalog before approval.
    const latestCatalog = await prototypeCatalogStore.load();
    const approved = approveAlias(
      proposed.proposal,
      latestCatalog,
    );

    if (approved.kind !== "approved") {
      console.log(approved.message);
      return;
    }

    await prototypeCatalogStore.save(approved.catalog);

    console.log("Alias saved. Lookup results:");
    console.table(
      resolveProduct(alias, approved.catalog).map(product => ({
        productId: product.id,
        name: product.name,
        priceCentavos: product.priceCentavos,
      })),
    );
  } finally {
    terminal.close();
  }
}

main().catch(error => {
  console.error(
    "Alias operation failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});