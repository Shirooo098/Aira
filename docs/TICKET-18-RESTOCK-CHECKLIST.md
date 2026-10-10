# Ticket 18 — Prepare an owner-approved restock checklist

## Workflow

Open **Pamahalaan → Ulat ng Tindahan** (or tap **Restock Checklist** in **Mga Produkto**), select a calendar period (e.g., Ngayong Araw, Linggo, Buwan), and tap **📋 Restock Checklist**.

The system analyzes current recorded stock (`stock_levels`) and sales data (`sales` / `sale_items` in the evaluated report period) to propose restock items:
- **Out of stock (`quantity === 0`)**: Flagged as *Ubos na ang stock*.
- **Low stock (`quantity <= 3` or less than units sold)**: Flagged as *Mababang stock*.
- **Uncounted (`quantity === null`)**: Flagged as *Hindi pa nabibilang*, without assuming zero.
- **Popular demand**: High sales in the period with dwindling stock.

The owner can:
1. Review candidate items and supporting stock/sales data.
2. Edit requested quantities (+ / − or numeric input).
3. Check or uncheck items to include or exclude them from the checklist.
4. Manually add any catalog product.
5. Optionally request local AI analysis (**⚡ AI Suriin**) using the bundled Qwen model to highlight urgent restock priorities.
6. **Aprubahan ang Checklist** (Approve Checklist) or **I-discard** (Discard Checklist).
7. On an approved checklist, tap **📦 Itala ang Delivery** for any item to seamlessly open `StockActionModal` in `add_delivery` mode when physical goods arrive.

## Grounding and invariants

1. **Strict Data Grounding & No Invented Forecasts**:
   - Reorder suggestions are grounded strictly in recorded stock and actual units sold during the chosen calendar period.
   - When history is missing or a product has 0 recorded sales in the period, Aira explicitly explains: *“Walang naitalang benta sa panahong ito; kulang ang kasaysayan upang magmungkahi ng tiyak na dami.”* It never invents reorder quantities, artificial demand curves, or forecasts.
2. **Consequential Action Isolation (Approval ≠ Purchase or Stock Change)**:
   - Approving or discarding a restock checklist **NEVER modifies `stock_levels`**, **NEVER inserts `inventory_movements`**, and **NEVER creates financial records or sales**.
   - Physical inventory changes **ONLY** when the owner explicitly records a physical delivery (`recordDelivery`) or sets count (`setStockCount`) via the verified `StockActionModal`.
3. **Guarded Local Agent Contract**:
   - The local model (via `createLlamaRestockAdapter()`) runs under a closed JSON grammar (`RESTOCK_SUGGESTIONS_SCHEMA`) accepting only `{ priorityProductIds: [...] }`.
   - The model cannot perform SQL queries, invent quantities, or commit writes.
   - If the model is unavailable or encounters an error, the host preserves the full deterministic draft checklist so the store owner is never blocked.

## Automated verification

Run from the repository root:

```powershell
npx tsc --noEmit
node --test --experimental-strip-types tests/restock.test.ts tests/restock-actions.test.ts tests/restock-session.test.ts tests/migrations.test.ts
npm test
```

## Phone checklist

- [ ] Open **Pamahalaan → Ulat ng Tindahan** in offline / airplane mode.
- [ ] Tap **📋 Restock Checklist** for an active report period; confirm low-stock and out-of-stock items appear.
- [ ] For items with sales, verify the explanation matches the report's units sold.
- [ ] For items with zero sales, verify that insufficient history is explicitly disclosed and no quantity is invented.
- [ ] Adjust quantities and toggle checkboxes; verify the draft updates cleanly.
- [ ] Tap **Aprubahan ang Checklist**; verify the checklist is marked approved.
- [ ] Check product stock in **Mga Produkto**; confirm that stock levels remain completely unchanged.
- [ ] Tap **📦 Itala ang Delivery** from the approved item; record physical stock intake and verify stock updates accurately.
