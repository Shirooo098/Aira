# D4 workflow after ticket #1

Prepared 2026-10-10. Owner: D4, App Shell, OCR & Integration Lead.

## Starting point

Ticket #1 is complete per the user. Do not reopen its implementation. CONTINUITY.md records 16 passing tests, type checking and Android export; those are prior results, not checks rerun for this plan. Keep device/build evidence distinct from implementation completion.

The current code provides catalog actions, integer-centavo money handling, SQLite adapters/migrations, mode navigation and audio cues. It does not yet provide transaction, ledger, OCR or report contracts. `saveProduct` creates products and rejects duplicate identities; notebook price updates will need an explicit reviewed update operation rather than repeated inserts.

GitHub issue bodies were checked for this plan. Direct blockers #4, #9, #12 and #13 are open as of this snapshot. The `ready-for-agent` label appears on blocked tickets too: it is not sufficient evidence of readiness. Check dependency implementation and its merge into main before starting a dependent slice.

## Delivery map

| D4 ticket | Start gate | Deliverable | Priority |
|---|---|---|---|
| #1 Catalog foundation | Complete per user | Existing catalog and shell | Done |
| #10 Receipt OCR | D3 #9 merged | Reviewed, stored, searchable receipt evidence | Core |
| #14 Aged utang | D3 #12 merged | Accurate debt priorities and customer balances | Core |
| #15 Reports | D3 #13 merged | Reconciled calendar-period dashboard | Core; unlocks D2 #17 |
| #19 Notebook OCR | D3 #4 merged | Time-boxed feasibility evidence; import only if viable | Optional |
| #20 Offline demo | #6, #8, #10, #14, #18 merged | Release APK acceptance and submission evidence | Final |

Dependency paths:

- #1 → D3 #4 → #7 → #9 → D4 #10.
- D3 #9 → #11 → #12 → D4 #14.
- D3 #12 → #13 → D4 #15 → D2 #17 → #18 → D4 #20. D2 #17 also requires #16.
- D4 #20 also requires D2 #6 and #8, plus D4 #10 and #14.
- D3 #4 → D4 #19. #19 is excluded from #20's hard blockers.

Prefer #10, then #14, then #15 when gates open in that order. If several are ready, prioritize #15 when D2 is waiting for reports, otherwise finish the oldest active core slice. Optional #19 must yield to ready core work. Do not wait for #19 to deliver the demo.

## Useful work now

1. Package the #1 handoff: stable product IDs, distinct variant/unit identities, integer centavos, SQLite migration ownership, and docs/QUANTITY-UNITS.md. D3 coordinates every new migration.
2. Prepare a shared native integration checklist with D1: development build configuration, model packaging, build prerequisites and final release checks. Expo Go remains the foundation test route; future custom speech/OCR modules require a build that includes them.
3. Prepare receipt and notebook sample inventories separately, with expected visible fields and source images. Keep real customer information out of published evidence unless appropriately authorized.
4. Draft report and aging fixture expectations, including midnight boundaries, unknown dates and later reversals. Finalize against D3's actual contracts after merge.
5. Draft the #20 evidence form and demo script. Preparation is allowed before its blockers merge; final acceptance is not.

These are preparation tasks, not permission to implement blocked tickets against invented schemas.

## Repeat for each ready ticket

1. **Check readiness:** read the issue and dependency merges; inspect existing work and preserve unrelated edits. A closed issue alone is not proof its contract exists on main.
2. **Define the seam:** record incoming IDs, queries/actions, timestamps, failure behavior, migration owner and expected outputs. Resolve only decisions needed for this slice.
3. **Implement the vertical slice:** domain/parser or query → application action → persistence → visible review/results UI. Use real records; models propose drafts and never authorize financial writes.
4. **Verify:** focused real-SQLite tests, type checking, affected Android bundle/build checks, then physical Oppo checks for native behavior. Record failures honestly; simulated OCR does not establish phone OCR quality.
5. **Prepare handoff:** acceptance checklist, changed files, dependency decisions, migration notes, commands/results, device evidence and remaining limitations. Update continuity with facts.
6. **Deliver when requested:** repository branches follow `feat/#<issue>-<slug>`; commits use Conventional Commits; a PR links `Closes #<issue>`. Existing instructions require a separate request for commit/push. This plan creates no commits, PRs or issue changes. Obtain required dependency approval only after a concrete choice and its tradeoffs are documented.

## #10 — Receipt evidence

Inputs: merged #9 sale/payment IDs, pending/confirmed status contract, local receipt samples, and D3-approved migration plan.

Execution:

1. Choose and inspect an OCR integration that actually bundles Latin ML Kit on Android. Record wrapper/runtime versions, license, APK impact and evidence of bundled dependency; get required material-dependency approval before installation.
2. Specify image retention and image/database consistency before implementing persistence. Define capture staging, failed-save cleanup, restart reconciliation and explicit image removal behavior. Keep image storage app-private.
3. Capture/import → local OCR → editable proposal for amount, reference, sender name/mobile → owner review → attachment save → history/search retrieval. Preserve masks and missing fields; distinguish recipient from sender.
4. Compare proposed amount with the relevant payment and flag references already used locally. Flags are informational; OCR never changes payment confirmation state.
5. Test masked/missing/ambiguous fields, duplicate references, corrected amounts, permission denial, OCR failure, failed image/database saves, restart retrieval and search. Run actual receipt extraction offline on the Oppo.

Exit: evidence can be reviewed, persisted and retrieved after restart without confirming a payment automatically; retention policy and native offline evidence are recorded.

## #14 — Aged utang

Inputs: merged #12 debts, customer identities, repayment allocations, remaining balances and documented unknown-date ordering.

Execution:

1. Query outstanding entries and aggregate by stable customer ID. Use remaining debt's original date, not last payment time.
2. Calculate Asia/Manila calendar-day age: Current <3 days, Needs attention 3–6, Urgent ≥7, Age unknown for missing dates.
3. Put urgent known-date customers first and retain visible unknown-date balances. Document mixed known/unknown customer presentation and deterministic tie ordering; never fabricate a date.
4. Show balance, oldest known unpaid debt/date and clear unknown-age information. Use text/icons alongside color; remove fully settled customers.
5. Verify days 2/3/6/7, local midnight, partial repayment without age reset, full settlement, duplicate names and mixed known/unknown debt through real SQLite fixtures.

Exit: dashboard totals reconcile with #12 and priorities remain accurate after repayments and restart. No automatic debtor messages.

## #15 — Calendar reports

Inputs: merged #13 cancellation/reversal rules with worked attribution examples, sale price snapshots, payments, allocations and current stock.

Execution:

1. Freeze the meaning of each metric with D3 before coding queries. Later reversals must follow #13's documented attribution rather than an invented accounting policy.
2. Build Asia/Manila boundaries: Today at midnight; Week on Monday; Month on day 1; 6 Months on day 1 five months earlier; Year on January 1. Every range ends at captured now. Document and test timestamp inclusion consistently.
3. Query active sales/counts, cash/GCash collections, new credit, current outstanding balance and units sold ranking. Repayments and opening balances do not create sales. Label present-state values as Stock now and current outstanding credit.
4. Deliver the visible dashboard with empty/partial history states and inspectable breakdowns. No profit metric without supporting cost/expense data.
5. Verify month/year transitions, Monday boundaries, UTC-to-Manila crossings, partial payments, repayments, opening balances, cancelled sales and later reversals against independently calculated fixture totals.
6. Hand D2 #17 the selected period and deterministic report result contract, including history limitations and supporting breakdowns.

Exit: UI and query totals reconcile, period meaning is explicit, and D2 can consume report data without recomputing money in a model.

## #19 — Optional notebook experiment

Inputs: merged #4 stock actions, actual photographed handwriting samples, reviewed catalog update contract.

Planning timebox: one focused working day, interruptible when core D4 work becomes ready. This is a proposed scheduling limit, not an existing issue requirement.

1. Measure actual handwritten-row extraction and owner correction effort. Keep source/proposal comparisons, field errors and timings. Printed receipt results cannot prove handwriting support; Digital Ink strokes are not notebook-photo OCR.
2. Proceed only if sample evidence shows useful correction effort and safe explicit review. Record the sample set and rationale; no quality threshold is currently approved.
3. If viable, show existing/proposed fields and require missing variant/unit/price clarification. Reuse reviewed catalog operations; preserve stock on price-only changes and avoid silent duplicates on rescan.
4. Test rejected import, correction, duplicate scan, invalid values and stock preservation with SQLite; test extraction separately on the device.

Exit: either a verified reviewed import flow, or a documented failed feasibility gate with the feature incomplete. Both outcomes preserve progress toward #20.

## #20 — Integration and submission evidence

Start final acceptance only after #6, #8, #10, #14 and #18 merge. Their transitive dependencies cover core transactions, reports and agent feasibility. Check this coverage against actual merged behavior rather than issue labels.

1. Build a standalone release APK with bundled production assets/models. Record exact revision, build instructions, versions, licenses/disclosure inventory and device details.
2. On Oppo Reno6 Z 5G, verify fresh-install readiness, airplane mode with Wi-Fi off, restart persistence, speech/aliases, spoken corrections, cash and owner-confirmed GCash, receipt evidence, credit/repayment/reversal, reports and guarded agent review.
3. Record cold/warm voice timings using the agreed D1 measurement method. Keep the under-three-second price workflow target distinct from slower report inference. Retain correctness, failure and interruption results.
4. Check accessible controls and visible/audio modes. Repeat existing passing logic only when integration changes or failures justify it.
5. Prepare a five-minute demo: catalog/voice lookup (0:00–1:00), corrected order and payment (1:00–2:00), receipt review (2:00–2:40), utang/repayment/reversal (2:40–3:40), reports/guarded checklist (3:40–4:40), offline and disclosure evidence (4:40–5:00). Use clearly labeled fixtures and reveal incomplete behavior. Show #19 only if it passes and fits the time.

Exit: reproducible release and truthful acceptance/evidence package. A failed required native/model gate remains a blocker; documenting the failure does not satisfy the full demo acceptance. Publishing media or changing repository visibility requires corresponding authorization.

## Decision and failure routing

| Problem | Next action | Owner |
|---|---|---|
| Dependency not merged | Continue preparation; do not implement against assumed tables | D4 + owning stream |
| Conflicting schema/migration | Resolve contract and migration sequence before writes | D3 |
| Unknown-date debt ambiguity | Use #12 policy; finalize display rules without inventing dates | D3 + D4 |
| Report reversal ambiguity | Require #13 attribution examples before report assertions | D3 + D4 |
| Receipt retention unspecified | Write concrete retention/recovery decision before storage implementation | D4 |
| OCR/model/device failure | Record reproducible evidence and keep affected acceptance incomplete | D4 + native owner |
| Notebook feasibility fails | Mark feature incomplete; proceed with core demo | D4 |

## Sources

- Local AGENTS.md, PRODUCT.md, CONTINUITY.md, .scratch/tindig/TICKET-PLAN.md and current catalog/migration code.
- Live issue bodies: [#10](https://github.com/Shirooo098/Aira/issues/10), [#14](https://github.com/Shirooo098/Aira/issues/14), [#15](https://github.com/Shirooo098/Aira/issues/15), [#19](https://github.com/Shirooo098/Aira/issues/19), [#20](https://github.com/Shirooo098/Aira/issues/20).
- Direct blocker states checked through GitHub: #4, #9, #12 and #13 were open on 2026-10-10. Recheck before execution; this plan does not establish their merge status.
