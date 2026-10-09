# Ticket #14 — Aged utang workflow

Prepared 2026-10-10 (Asia/Taipei). Lead: D4. Scope: implementation workflow and readiness assessment; no feature implementation performed.

## Readiness verdict

**Ready to build, with dependency gate satisfied.** This is source/dependency readiness, not a claim that the feature or phone acceptance already passes.

- Live [#14](https://github.com/Shirooo098/Aira/issues/14) is open and requires #12. Its ready-for-agent label alone does not establish readiness.
- Live [#12](https://github.com/Shirooo098/Aira/issues/12) is closed as completed. [PR #26](https://github.com/Shirooo098/Aira/pull/26) merged into main at `ec0458d8d66aaf020196e71119a3e67f6162654a` on 2026-10-10 at 03:27 Asia/Taipei.
- Local HEAD is `4c02e6223216e6c220bc885726f09d3a62476f66`; `git merge-base --is-ancestor ec0458d8d66aaf020196e71119a3e67f6162654a HEAD` succeeded. The #12 implementation is present locally, including migrations, repayment actions, UI and real-SQLite tests.
- #13 is also merged through [PR #29](https://github.com/Shirooo098/Aira/pull/29). Its cancellation/reversal status handling must be respected by the aging query, although #13 is not a direct #14 blocker.
- Existing code supplies stable customer IDs, remaining centavo balances, original dates, repayment allocations and documented unknown-date repayment ordering in `docs/UTANG-ORDERING.md`.
- The earlier `D4-WORKFLOW.md` blocker snapshot is superseded for #14 by this live check. `CONTINUITY.md` is also behind the current merged ledger code.
- Current branch is `feat/#10-gcash-receipt-ocr`. Untracked receipt docs, actions, domain and tests belong to ongoing #10 work. Preserve them. Before implementation, use a clean separate checkout or safely isolate #14 on `feat/#14-aged-utang`; do not include #10 changes in its delivery.

No tests, Android build or device checks were rerun for this planning task. Recheck main and working-tree state when implementation begins.

## Contract and rules

Reuse `DatabaseSession`, migrations, `Customer`, `CreditEntry`, `getCustomers`, `getCustomerLedger`, `recordRepayment` and `reverseRepayment`. Do not create a second ledger or change repayment allocation policy. A new read-only query should fetch all outstanding entries with customer identities in one database snapshot, avoiding a per-customer ledger/history fetch.

Query only entries with `remaining_amount_centavos > 0` and non-cancelled status. Aggregate by customer ID, never name. Sum remaining balances as safe integer centavos; reject overflow explicitly. Settled customers disappear. Compare dashboard totals with `getCustomers` and ledger totals from the same fixture state.

Proposed result per customer: ID/name, total remaining centavos, known-date remaining centavos, unknown-date remaining centavos/count, oldest known outstanding entry ID/date, age in calendar days (nullable), priority and explicit unknown-date indicator. Capture one `asOf` value per refresh and return it with the result.

Use Asia/Manila calendar dates, irrespective of phone timezone. Age is the difference between local calendar-day ordinals, not elapsed 24-hour periods. Preserve valid YYYY-MM-DD dates as calendar dates; convert timestamps with explicit offsets to Manila dates. Inspect actual stored formats before finalizing parsing. Missing/blank/invalid or timezone-ambiguous dates must remain visibly unknown; a future date must show a date-quality warning and must not gain urgent status. Do not substitute insertion time for missing opening-debt dates. For sale credits, inspect the creation contract and use the original sale date; never repayment time or updated_at.

| Known calendar age | Priority |
|---|---|
| 0–2 days | Current |
| 3–6 days | Needs attention |
| 7+ days | Urgent |
| No usable original date | Age unknown |

Proposed mixed-debt display: classify the known portion using the oldest known unpaid date and add a separate “Age unknown” label and unknown balance. Never imply the complete balance has that known age. For unknown-only customers, show Age unknown with no fabricated oldest date. Keep unknown-only customers in a visible section after Urgent and Needs attention, before Current.

Proposed deterministic order: Urgent, Needs attention, Age unknown, Current; within known groups oldest calendar date first, then remaining balance descending, normalized name, customer ID. Within unknown-only groups use balance descending, normalized name, customer ID. These presentation choices are workflow proposals, not requirements already approved in #12. Repayment ordering remains exactly the existing #12 contract.

## Build sequence

1. **Prepare the checkout and baseline.** Recheck live #14/#12 and main ancestry. Preserve unrelated changes, establish the #14 branch, inspect migration versions and stored date formats. Run existing utang/reversal tests and type checking; distinguish pre-existing failures from new regressions.
2. **Document the aging seam.** Add `docs/TICKET-14-AGING.md` with date parsing, Manila midnight examples, mixed-date labels, sorting and read-only behavior. Confirm any required schema/index change with D3; no migration is expected for the initial query.
3. **Implement pure aging rules.** Add a focused domain module such as `src/domain/utang-aging.ts` with an injected clock/asOf, validated calendar conversion, classification, aggregation and deterministic comparison. Preserve original dates through partial repayment and reversal.
4. **Implement the read action.** Add a focused action such as `getAgedUtang` in `src/actions/utang-aging-actions.ts`. Read existing customer/credit tables without financial writes, exclude cancelled entries, retain unknown balances and return reconcilable totals. Surface database failures explicitly.
5. **Connect the visible slice.** Add `src/ui/AgedUtangView.tsx` and an accessible entry point from Sell/Utang, reusing the existing repayment flow by stable customer ID. Show total balance, oldest known unpaid debt/date, known age, text/icon priority, unknown balance, loading/error/retry and empty states. Avoid expanding report scope from #15.
6. **Keep results fresh.** Reload after repayment, reversal, cancellation, returning to the screen and app foreground. Recalculate at Manila midnight while visible and cancel timers on unmount. A settled oldest entry moves priority to the next unpaid known date; partial repayment does not reset age. Send no automatic messages.
7. **Verify and hand off.** Run the checks below, record actual results and limitations, update continuity with facts, and prepare changed-file/migration notes and acceptance checklist. Commit/push only on a separate user request; a later PR should link `Closes #14`.

## Verification matrix

Use real temporary SQLite with production migrations and application actions. Pure calendar tests supplement the integration tests.

| Fixture/action | Expected result |
|---|---|
| Ages 2, 3, 6, 7 | Current, Needs attention, Needs attention, Urgent |
| 2026-10-09 15:59:59Z → 16:00:00Z | Manila date crosses midnight; age advances one day |
| Same fixture under different host timezones | Identical age and order |
| Unknown-only and mixed known/unknown balances | Full balance retained; explicit unknown label/amount |
| Missing, invalid, ambiguous and future dates | No invented age; visible date-quality handling |
| Partial repayment of oldest debt | Remaining balance falls; original age stays |
| Full settlement of oldest entry | Next unpaid known date determines known priority |
| Full customer settlement | Customer removed; dashboard total reconciles |
| Reversal of repayment | Balance/priority restored using original debt dates |
| Cancelled credit sale | Cancelled debt excluded |
| Duplicate customer names and sort ties | IDs remain separate; deterministic order |
| Close and reopen file-backed database | Same balances and priorities at the same asOf |
| Query failure and empty ledger | Explicit retry/error or useful empty state |

Run focused tests first, then `npm test`, `npm run typecheck`, and `npx expo export --platform android` for the integrated UI. No new native package is expected. Android export establishes bundle compatibility, not an APK/device pass.

On the Oppo when available: check readable labels/icons beyond color, scrolling, repayment return refresh, midnight/foreground refresh and persistence after restart. Final offline acceptance uses a standalone build in airplane mode with Wi-Fi off. Record device checks as pending until actually performed; no speech/OCR benchmark is needed for this read-only slice.

## Completion gate

- All #14 acceptance criteria map to working UI and verified real ledger queries.
- Totals reconcile after repayments, cancellations, reversals and restart.
- Unknown dates remain visible; partial repayments preserve age; settled customers leave the list.
- Philippine calendar aging and deterministic mixed-debt presentation are documented.
- Automated/build results and outstanding device acceptance are reported separately.
- No unrelated #10 changes, automatic debtor messages, financial writes from aging, or unrequested publication.
