# Continuity

## Ticket #14 — aged utang

- 2026-10-10 [USER] Requested pull of current main and development of ticket #14.
- 2026-10-10 [TOOL] Pulled main by fast-forward to 71e341c and based feat/#14-aged-utang on it; existing #12/#13 ledger contracts are merged. No commit or push performed.
- 2026-10-10 [TOOL] Added a read-only customer aging query and Sell dashboard with oldest known debt/date/remaining amount, Philippine calendar-day priorities, visible unknown-date balances and existing reviewed repayment/history flow. Original sale-credit created_at and opening original_date remain authoritative; repayments never reset age. No schema or package changes.
- 2026-10-10 [TOOL] Final tests: 162/162 pass, including 5 new aging suites covering real SQLite repayment/reversal/cancellation/restart and calendar boundaries. TypeScript passes. Android export passes; physical Oppo accessibility, foreground/midnight refresh and standalone offline acceptance remain pending. See docs/TICKET-14-AGING.md.

## Snapshot
- 2026-10-10 [USER] Goal: implement D4 tickets using astra-orchestrator and implement skills.
- 2026-10-10 [TOOL] Ticket #1 ("Create an offline catalog and typed price lookup") implementation and full verification complete.
- 2026-10-10 [USER] User switched role to Developer 3 ("D3 — Transactions, Inventory & Utang Ledger / Data Coordinator") and requested ticket implementation.
- 2026-10-10 [TOOL] Ticket #7 ("Complete a cash sale with consistent inventory") merged via PR #23.
- 2026-10-10 [TOOL] Created feature branch `feat/#9-owner-confirmed-gcash` on the unblocked frontier for Ticket #9 ("Record owner-confirmed GCash purchases").
- 2026-10-10 [TOOL] Ticket #9 implementation complete: Migration v4 (`pending_gcash_drafts` and `reference_number` column on `sales`), transactional drafting and confirmation action layer (`createPendingGcashDraft`, `confirmGcashSale`, `cancelPendingGcashDraft`), and complete UI slice in `SellView.tsx` with payment method toggle (Cash/GCash), owner confirmation banner (anti-screenshot-fraud warning), and pending draft queue.
- 2026-10-10 [TOOL] Verification: 42/42 automated tests pass across all test suites, `npm run typecheck` passes with zero errors, and `npx expo export --platform android` bundles successfully (652 modules).
- 2026-10-10 [TOOL] Review: Independent reviewer subagent gave a clean PASS verdict verifying compliance with non-negotiable invariants (strict offline, screenshots cannot confirm payment, drafts do not deduct stock or count as sales, atomic owner confirmation).




## Done
- 2026-10-09 [USER] Confirmed broad product: catalog/aliases, voice/text, reviewed sales/stock, GCash receipt OCR, utang and aging, dashboard periods, guarded reporting/restock agent.
- 2026-10-09 [TOOL] Read to-spec and setup-matt-pocock-skills instructions successfully after environment retry.
- 2026-10-09 [TOOL] Synthesized template-based draft with 52 stories, ownership, test strategy, priorities, exclusions, and open engineering decisions.
- 2026-10-09 [USER] Approved 20 proposed vertical slice tickets and requested publish & commit to repo.
- 2026-10-09 [TOOL] Created ready-for-agent label and published issues #1 through #20 on GitHub Shirooo098/Aira.
- 2026-10-09 [USER] Confirmed 4-developer task allocation; requested documentation update in AGENTS.md.
- 2026-10-09 [TOOL] Created AGENTS.md with team workstreams, non-negotiable invariants, test seams, and workflow.

## Decisions
- D1 2026-10-09 [USER] Bundled models supersede first-run download proposal; phone-only target retained.
- D2 2026-10-09 [USER] Utang included, superseding initial exclusion; oldest-first repayment, partial payment, correction history, age thresholds 3/7 days.
- D3 2026-10-09 [USER] Philippine calendar report periods: today/week/month/current plus prior five months/year.
- D4 2026-10-09 [USER] Four developer split: speech; catalog/understanding; transactions/data; app integration/OCR/UI.
- D5 2026-10-09 [USER] GitHub repository Shirooo098/Aira confirmed as issue tracker destination.
- D6 2026-10-10 [USER] Use Expo Go for foundation tests; supersedes local native build as a prerequisite for initial phone testing.

## Working set
- TINDIG-SPEC.md
- AGENTS.md
- CONTINUITY.md
- .scratch/tindig/TICKET-PLAN.md
- D4-FOUNDATION-PROPOSAL.md

## Receipts
- 2026-10-10 [TOOL] Independent reviewer subagent (conversation 6fcad9fb-4908-4065-8594-0900cc4e0b15) reviewed ticket #1: verified strict offline operation, integer centavo currency safety, guarded explicit draft review, atomic SQLite migrations, and full acceptance criteria compliance.
- 2026-10-10 [TOOL] Verification passed: `npm test` 16/16 tests pass across 7 suites; `npm run typecheck` (tsc --noEmit) passes with 0 errors after including node types in tsconfig; `npx expo export --platform android` bundles cleanly with 645 modules.
- 2026-10-10 [TOOL] Created docs/QUANTITY-UNITS.md documenting whole selling units, distinct variant/unit product identities, and invariants for upcoming Ticket #4 stock work.
- 2026-10-10 [TOOL] Expo dependencies installed. npm audit reports 22 affected entries; triage in docs/DEPENDENCY-NOTES.md. No native/device pass claimed.
- 2026-10-10 [TOOL] Antigravity explorer completed exit 0/status SUCCESS; conversation 55b28d02-da6a-4e7f-9875-405551575580 confirms docs-only foundation scope.
- 2026-10-10 [TOOL] Node 22.14.0, npm 10.9.2, Java 21 available; adb absent from PATH. Android SDK/device availability UNCONFIRMED.
- 2026-10-10 [TOOL] Expo official SQLite/audio/development-build docs and npm metadata consulted; proposed package versions and operational tradeoffs recorded in proposal.
- 2026-10-09 [TOOL] Shell working again; directory enumeration found no existing entries before document creation.
- 2026-10-09 [TOOL] No application tests, hardware inference benchmarks, dependencies, commits, or pushes performed.
- 2026-10-09 [TOOL] Primary proposed seam: application actions against real temporary SQLite; separate actual-device acceptance for speech/OCR/offline UI.
- 2026-10-09 [TOOL] Handwriting OCR, agent model, concrete versions, performance, backup policy, and some reversal/report semantics remain unconfirmed.

## Brand update
- 2026-10-10 [USER] Aira means Artificial Intelligence for Retail Assistance; supersedes the earlier brand decision.
- 2026-10-10 [TOOL] GitHub confirms canonical repository Shirooo098/Aira. Inspected all 20 issues; updated issue #1, the only issue with old brand text. Verified no old brand in live titles/bodies.
- 2026-10-10 [TOOL] Updated local specification, developer guide, ticket plan and ticket URL references. Legacy local filenames retained for stable links. No commit or push.

## Ticket #10 — D4 receipt first slice

- 2026-10-10 [USER] Requested starting ticket #10 and creating a branch.
- 2026-10-10 [TOOL] Fetched main at 4c02e62; #9 is merged via f6709a1 and closed on GitHub. Created feat/#10-gcash-receipt-ocr from origin/main.
- 2026-10-10 [TOOL] Implemented conservative receipt-text proposals and read-only amount/reference review against existing GCash sale/draft/repayment records. No payment confirmation, stock writes or schema changes.
- 2026-10-10 [TOOL] Type checking and all 129 tests pass; 16 new receipt tests. Standards/spec reviews resolved the sender-heading ambiguity and report no remaining findings for this first slice.
- 2026-10-10 [TOOL] Native dependency proposal and retention/consistency contract are in docs/TICKET-10-RECEIPTS.md. Requested approval for Infinite Red bundled Latin ML Kit wrapper, expo-image-picker and expo-file-system under existing dependency policy. No answer received yet; native capture/OCR, attachment persistence/search/UI and physical offline acceptance remain incomplete. No commit/push performed for #10.

## Ticket #2 — D1 speech implementation

- 2026-10-10 [USER] Requested astra-orchestrator to start building Ticket #2. Confirmed the Oppo is not available for testing now.
- 2026-10-10 [TOOL] Verified #1 is merged into fetched origin/main at c2fad40. Created local branch feat/#2-offline-transcription from the current foundation/D4-document baseline, preserving existing D1 research/workflow files.
- 2026-10-10 [TOOL] Implemented a reusable ephemeral speech-session controller, Expo PCM16 capture, bundled local Whisper adapter, push-to-talk/accessibility controls and editable/reviewable transcript in Ask price. No catalog, inventory or financial writes; no schema changes.
- 2026-10-10 [TOOL] Pinned whisper.rn 0.7.4 plus buffer 6.0.3. Reused existing expo-audio; removed experimental extra recorder dependency. Model acquisition is build-time only, with pinned source revision and SHA-256. Multilingual tiny is provisional; base comparison remains outstanding.
- 2026-10-10 [TOOL] Downloaded and verified tiny (77,691,713 bytes; SHA-256 be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21). Android prebuild passes and copies verified model/license/metadata to native APK assets with microphone permission enabled.
- 2026-10-10 [TOOL] Verification: 36/36 tests and TypeScript pass; final Android JS export passes (659 modules). Windows sandbox export needed TEMP/TMP in workspace dist/export-temp. Independent Astra reviewer found no blockers after final lifecycle fixes.
- 2026-10-10 [USER] Requested device-free tests and explicitly authorized committing/pushing Ticket #2 on feat/#2-whisper-speech.
- 2026-10-10 [TOOL] Device-free verification rerun: 36/36 tests pass; prior final Android JS export and Android prebuild passed. Stopped the unfinished Gradle dependency-download attempt in response to the device-free testing request; no APK compilation success is claimed. Oppo accuracy/RAM/latency/offline acceptance remains pending. See docs/SPEECH-BENCHMARK.md and docs/SPEECH-INTEGRATION.md.
- 2026-10-10 [TOOL] Prepared the Ticket #2 implementation for the requested branch. No PR publication or issue closure requested. #2 remains awaiting native/device acceptance; #5 retains the full three-second speech-to-price target.

