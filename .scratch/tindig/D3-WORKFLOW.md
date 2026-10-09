# D3 Workflow & Completion Summary — Transactions, Inventory & Utang Ledger

Prepared: 2026-10-10. Owner: D3 (Transactions, Inventory & Utang Ledger / Data Coordinator).

---

## 1. Executive Summary

Developer 3 owns the end-to-end data, transaction, inventory, utang (credit) ledger, payment correction/reversal domain slices, and coordinates shared SQLite schema migrations across the Aira engineering team.

As of commit `4c02e62` on `main`, **all six (6) primary Developer 3 tickets have been fully implemented, rigorously verified with 113 automated tests, reviewed by independent reviewers, and merged into `main`**.

---

## 2. Developer 3 Delivery Matrix

| Issue # | Title | Branch | PR | Status | Key Deliverables |
|---|---|---|---|---|---|
| **#4** | Set stock counts and record deliveries | `feat/#4-stock-counts-deliveries` | [#22](https://github.com/Shirooo098/Aira/pull/22) | **MERGED & CLOSED** | Migration 2 (`stock_levels`, `inventory_movements`), `setStockCount`, `recordDelivery`, uncounted is `null` convention, `tests/inventory-actions.test.ts` |
| **#7** | Complete a cash sale with consistent inventory | `feat/#7-cash-sale-inventory` | [#23](https://github.com/Shirooo098/Aira/pull/23) | **MERGED & CLOSED** | Migration 3 (`sales`, `sale_items`), `completeCashSale`, atomic SQLite transaction, exact centavo tender/change, `sale_deduction` inventory movements, `tests/sales-actions.test.ts` |
| **#9** | Record owner-confirmed GCash purchases | `feat/#9-owner-confirmed-gcash` | [#24](https://github.com/Shirooo098/Aira/pull/24) | **MERGED & CLOSED** | Migration 4 (`pending_gcash_drafts`, `sales.reference_number`), `createPendingGcashDraft`, `confirmGcashSale`, owner confirmation invariant, `tests/gcash-sales.test.ts` |
| **#11** | Record customer credit and partial-payment purchases | `feat/#11-customer-credit-sales` | [#25](https://github.com/Shirooo098/Aira/pull/25) | **MERGED & CLOSED** | Migration 5 (`customers`, `credit_entries`, `sales.customer_id`, `sales.paid_centavos`, `sales.credit_centavos`), `recordOpeningBalance`, `completeCreditSale`, `tests/utang-actions.test.ts` |
| **#12** | Repay utang against the oldest unpaid entries | `feat/#12-repay-utang-oldest-first` | [#26](https://github.com/Shirooo098/Aira/pull/26) | **MERGED & CLOSED** | Migration 6 (`credit_repayments`, `repayment_allocations`), FIFO oldest-first repayment engine, `previewRepaymentAllocation`, `recordRepayment`, `tests/repayments.test.ts` |
| **#13** | Correct payments and cancel sales without corrupting balances | `feat/#13-cancel-sales-reverse-payments` | [#29](https://github.com/Shirooo098/Aira/pull/29) | **MERGED & CLOSED** | Migration 8 (`status`, `cancelled_at`, `cancellation_reason`, `reversed_at`, `reversal_reason`), `cancelSale`, `reverseRepayment`, `docs/REVERSAL-REPORT-ATTRIBUTION.md`, `tests/cancellations-reversals.test.ts` |

---

## 3. SQLite Migration Log & Coordination

D3 coordinates all SQLite migrations to guarantee backward compatibility, zero destructive table drops, and schema integrity:

- **Migration 1 (`products`)**: Catalog foundation (D4).
- **Migration 2 (`stock_levels`, `inventory_movements`)**: Inventory levels with `CHECK(quantity >= 0)`, uncounted products omitted (`quantity: null`), movement audit log.
- **Migration 3 (`sales`, `sale_items`)**: Cash sales with line item price snapshots, integer centavo totals, and idempotency protection.
- **Migration 4 (`sales.reference_number`, `pending_gcash_drafts`)**: Pending draft lifecycle without premature inventory deductions or unconfirmed financial writes.
- **Migration 5 (`customers`, `credit_entries`, `sales.customer_id`, `sales.paid_centavos`, `sales.credit_centavos`)**: Customer registry with duplicate name differentiation notes, debt tracking, and opening debt balances without phantom sales or inventory changes.
- **Migration 6 (`credit_repayments`, `repayment_allocations`)**: Atomic oldest-first repayment recording and allocation history linking payments to specific credit debts.
- **Migration 7 (`product_aliases`)**: Owner-confirmed product nicknames and colloquial search aliases (coordinated with D2).
- **Migration 8 (Status & Reversal Audit Fields)**: Cancellation and reversal fields across `sales`, `credit_entries`, `credit_repayments`, and `repayment_allocations` with `PRAGMA table_info` idempotency checks.

---

## 4. Downstream Handoff Contracts

### 4.1 For D4 — Ticket #14 ("Show aged utang with attention priorities")
- **Source Tables**: `customers`, `credit_entries` (where `status = 'active'` and `remaining_amount_centavos > 0`).
- **Debt Age Calculation**: Based on `credit_entries.original_date` (or `credit_entries.created_at` if `original_date` is omitted).
- **Unknown Dates Policy**: Opening balances where `original_date IS NULL` are explicitly flagged as `"Age unknown"` / prioritized safely without fabricating dates.
- **Aging Thresholds (Asia/Manila)**:
  - **Current**: < 3 days
  - **Needs attention**: 3 – 6 days
  - **Urgent**: ≥ 7 days
- **Settlement Filter**: Customers with `totalDebtCentavos === 0` are automatically excluded from the active attention list.

### 4.2 For D4 — Ticket #15 ("View accurate store reports across calendar periods")
- **Attribution Specification**: Fully documented with worked mathematical examples in [`docs/REVERSAL-REPORT-ATTRIBUTION.md`](file:///D:/Old%20D%20Drive/Side%20Hustle/AppBuilders/docs/REVERSAL-REPORT-ATTRIBUTION.md).
- **Active Sales Filter**: Only include `sales` where `status = 'completed'` (cancelled sales `status = 'cancelled'` are excluded from gross/net sales counts).
- **Collections Query**:
  - Cash Sales: `sales` where `status = 'completed'` and `payment_method = 'cash'` (`paid_centavos`).
  - GCash Sales: `sales` where `status = 'completed'` and `payment_method = 'gcash'` (`paid_centavos`).
  - Repayments: `credit_repayments` where `status = 'completed'` (`amount_centavos`), grouped by cash or GCash.
- **Inventory Snapshot**: Label as `"Stock now"` from `stock_levels` (excluding null/uncounted).
- **Outstanding Credit**: Sum of `remaining_amount_centavos` from `credit_entries` where `status = 'active'`.

### 4.3 For D2 — Ticket #6 ("Dictate and review catalog changes")
- Reuses `setStockCount` and `recordDelivery` from [`src/actions/inventory-actions.ts`](file:///D:/Old%20D%20Drive/Side%20Hustle/AppBuilders/src/actions/inventory-actions.ts) with explicit owner confirmation.

### 4.4 For D2 — Ticket #8 ("Speak and correct an order before checkout")
- Consumes `SaleItemDraft` and `buildSalePreview` from [`src/actions/sales-actions.ts`](file:///D:/Old%20D%20Drive/Side%20Hustle/AppBuilders/src/actions/sales-actions.ts) before calling `completeCashSale`, `confirmGcashSale`, or `completeCreditSale`.

---

## 5. Verification State

- **Automated Tests**: 113 / 113 passing (`npm test`).
- **TypeScript**: 0 errors (`npm run typecheck`).
- **Android Export**: 0 errors (`npx expo export --platform android`).
- **Offline Invariant**: 100% compliant. No cloud fallbacks, integer centavos preserved, guarded review on all state changes.
