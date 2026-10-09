import { prototypeCatalogStore } from "./adapters/prototype-catalog";
import { lookupPrice } from "./core/lookup-price";

async function main() {
  const query = process.argv.slice(2).join(" ");

  if (!query.trim()) {
    console.log(
      'Usage: npx tsx src/demo-price.ts "Magkano ang Coke sakto?"',
    );
    return;
  }

  const catalog = await prototypeCatalogStore.load();
  const result = lookupPrice(query, catalog);

  switch (result.kind) {
    case "found":
      console.log(result.name + ": " + result.displayPrice);
      break;

    case "ambiguous":
      console.log("Choose the intended product:");
      console.table(result.candidates);
      console.log("Try again using the exact product name.");
      break;

    case "unknown":
      console.log("Unknown product: " + result.query);
      break;

    case "invalid":
      console.log(result.message);
      break;
  }
}

main().catch(error => {
  console.error(
    "Price lookup failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});