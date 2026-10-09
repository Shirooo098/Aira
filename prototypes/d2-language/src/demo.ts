import { DesktopQwen } from "./adapters/desktop-qwen";
import { interpretOrder } from "./core/language";
import { prototypeCatalogStore } from "./adapters/prototype-catalog";


async function main() {
  const catalog = await prototypeCatalogStore.load();
  const text = process.argv.slice(2).join(" ");
  const started = performance.now();

  const result = await interpretOrder(text, catalog, new DesktopQwen());

  console.log(JSON.stringify(result, null, 2));
  console.log(`Desktop processing: ${
    Math.round(performance.now() - started)
  } ms`);
  console.log("Proposal only. Nothing was saved.");
}

main().catch(error => {
  console.error(
    "Could not prepare the proposal:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});