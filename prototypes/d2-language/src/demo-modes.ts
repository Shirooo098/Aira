import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { DesktopQwen } from "./adapters/desktop-qwen";
import { prototypeCatalogStore } from "./adapters/prototype-catalog";
import { routeInput } from "./core/route-input";
import {
  createSession,
  switchMode,
  type Mode,
  type Session,
} from "./core/session";

const modes: Mode[] = ["ask-price", "sell", "manage-products"];

function showSession(session: Session) {
  console.log("\nMode:", session.mode);
  console.log("Selected item:", session.selectedProductId ?? "none");

  if (session.draft) {
    console.table(session.draft.items);
  } else {
    console.log("No current cart.");
  }

  console.log("No sale has been saved.\n");
}

async function main() {
  const catalog = await prototypeCatalogStore.load();
  const model = new DesktopQwen();
  let session = createSession();

  const terminal = createInterface({
    input: stdin,
    output: stdout,
  });

  console.log("Aira mode demo");
  console.log("/mode ask-price");
  console.log("/mode sell");
  console.log("/mode manage-products");
  console.log("/select PRODUCT_ID");
  console.log("/clear-selection");
  console.log("/cancel");
  console.log("/show");
  console.log("/quit");

  showSession(session);

  try {
    while (true) {
      const input = (await terminal.question("> ")).trim();

      if (input === "/quit") {
        break;
      }

      if (input === "/show") {
        showSession(session);
        continue;
      }

      if (input.startsWith("/mode ")) {
        const requested = input.slice("/mode ".length).trim();
        const mode = modes.find(value => value === requested);

        if (!mode) {
          console.log("Use ask-price, sell, or manage-products.");
          continue;
        }

        const changingMode = mode !== session.mode;
        session = switchMode(session, mode);

        if (changingMode) {
          console.log("Mode changed. Any unconfirmed cart was discarded.");
        }

        showSession(session);
        continue;
      }

      if (input === "/cancel") {
        session = {
          ...session,
          draft: null,
          selectedProductId: null,
        };

        console.log("Draft discarded.");
        showSession(session);
        continue;
      }

      if (input === "/clear-selection") {
        session = {
          ...session,
          selectedProductId: null,
        };

        showSession(session);
        continue;
      }

      if (input.startsWith("/select ")) {
        if (session.mode !== "sell" || !session.draft) {
          console.log("Open a cart in Sell mode first.");
          continue;
        }

        const productId = input.slice("/select ".length).trim();
        const item = session.draft.items.find(
          line => line.productId === productId,
        );

        if (!item) {
          console.log("That product is not in the current cart.");
          continue;
        }

        session = {
          ...session,
          selectedProductId: item.productId,
        };

        showSession(session);
        continue;
      }

      if (input.startsWith("/")) {
        console.log("Unknown command.");
        continue;
      }

      try {
        const result = await routeInput(
          input,
          session,
          catalog,
          model,
        );

        session = result.session;
        console.log(result.message);

        if (result.price?.kind === "ambiguous") {
          console.table(result.price.candidates);
        }

        showSession(session);
      } catch (error) {
        console.error(
          "Request failed. Session unchanged:",
          error instanceof Error ? error.message : String(error),
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