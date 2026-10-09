# Ticket #14 — Aged utang

Open **Sell → Utang — mga dapat unahin**. The dashboard reads the existing ledger and opens the existing reviewed repayment/history flow. It performs no financial writes and sends no messages. No schema changes or packages were added.

## Calendar and priority

Age uses Asia/Manila calendar days, independent of the device timezone. One captured `asOf` applies to the whole query. At 2026-10-09 16:00:00Z, Manila becomes October 10 and debt age advances one day, even if fewer than 24 hours elapsed.

Current is 0–2 days; Needs attention is 3–6; Urgent is 7 or more. Date-only values are validated calendar dates; timestamps require explicit timezone offsets. Invalid, ambiguous or future dates count toward the unknown balance and show a date-quality warning. Missing dates stay unknown.

Opening debts use `original_date`. Sale credits use their original `created_at`, which #11 writes at sale creation while leaving `original_date` null. Repayment and reversal do not change these fields; updated_at is never used for aging. This display does not change #12's opening-debt repayment precedence.

## Balances and order

Only positive remaining balances from non-cancelled entries are included. One SELECT joins stable customer IDs to credit entries; duplicate names remain separate. Integer centavo sums reject unsafe values/overflow. Fully settled customers leave the list.

Mixed customers show the priority and oldest calendar date of the known portion, its balance, and a separate Age unknown amount/count. The full balance is never described as having the known age. Unknown-only customers show Age unknown without an invented date.

Order: Urgent, Needs attention, Age unknown, Current. Known groups sort by oldest date, then balance descending, lowercase name and stable customer ID. Unknown-only groups use balance descending, lowercase name and ID. Text and symbols convey priority alongside any styling.

## Refresh and failures

The view refreshes on opening, manual refresh, foreground, Manila midnight, repayment/reversal success, and return from repayment history. Closing it reloads Sell's customer list. Timers/listeners are removed on unmount; request ordering prevents older reads replacing newer results. Failed reads show a retry message rather than a false empty ledger. Existing repayment validation and owner confirmation remain authoritative.

## Verification

`tests/utang-aging.test.ts` covers 2/3/6/7-day thresholds, Manila midnight, timezone offsets, invalid dates, unknown/mixed debt, duplicate names, deterministic ordering, reconciliation, partial/full repayments, oldest-entry settlement, reversal, cancelled sale credit, file-backed restart and surfaced query errors through real SQLite.

Physical Oppo UI/accessibility, midnight/foreground behavior and standalone airplane-mode acceptance remain pending. Android JS export is bundle validation, not evidence of an APK or device pass.

2026-10-10 verification: `npm test` passed 162/162 tests; `npm run typecheck` passed; Android export passed with 683 modules. Final export used a workspace temporary cache outside dist to avoid export cleanup removing Metro's cache folder. `git diff --check` passed.
