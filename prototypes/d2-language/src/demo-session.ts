import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { DesktopQwen } from "./adapters/desktop-qwen";
import { correctCart } from "./core/correct-cart";

import { prototypeCatalogStore } from "./adapters/prototype-catalog";

import {
  interpretOrder,
  type SaleDraft,
} from "./core/language";


function showDraft(draft: SaleDraft) {
  console.table(draft.items);
  console.log("Draft only. No sale has been saved.");
}

async function main() {
  const order = process.argv.slice(2).join(" ");
  const catalog = await prototypeCatalogStore.load();

  if (!order.trim()) {
    console.log(
      'Usage: npx tsx src/demo-session.ts "Dalawang Coke maliit"',
    );
    return;
  }

  const result = await interpretOrder(
    order,
    catalog,
    new DesktopQwen(),
  );

  if (result.kind !== "draft") {
    console.log(result);
    return;
  }

  let draft = result.draft;
  let selectedProductId: string | undefined;

  const terminal = createInterface({
    input: stdin,
    output: stdout,
  });

  try {
    showDraft(draft);

    console.log('Enter a correction such as "isa lang pala".');
    console.log("Select an item: /select PRODUCT_ID");
    console.log("Clear selection: /clear-selection");
    console.log("Discard this draft: /cancel");
    console.log("Exit: /quit");

    while (true) {
      const input = (await terminal.question("> ")).trim();

      if (input === "/quit") {
        console.log("Session ended. Nothing was saved.");
        break;
      }

      if (input === "/cancel") {
        draft = { items: [] };
        selectedProductId = undefined;
        console.log("Draft discarded. Nothing was saved.");
        break;
      }

      if (input === "/clear-selection") {
        selectedProductId = undefined;
        console.log("Selection cleared.");
        continue;
      }

      if (input.startsWith("/select ")) {
        const productId = input.slice("/select ".length).trim();
        const item = draft.items.find(
          line => line.productId === productId,
        );

        if (!item) {
          console.log("That product is not in this cart.");
          continue;
        }

        selectedProductId = item.productId;
        console.log("Selected: " + item.name);
        continue;
      }

      const correction = correctCart(
        input,
        draft,
        selectedProductId,
      );

      if (correction.kind === "updated") {
        draft = correction.draft;
        showDraft(draft);
      } else if (correction.kind === "clarify") {
        console.log(correction.message);
      } else {
        console.log(
          'Supported correction: "QUANTITY lang pala". Cart unchanged.',
        );
      }
    }
  } finally {
    terminal.close();
  }
}

main().catch(error => {
  console.error(
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});