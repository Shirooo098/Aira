# Continuity

## Snapshot
- 2026-10-09 [USER] Goal: document 4-developer task split and maintain AGENTS.md.
- 2026-10-09 [TOOL] Created comprehensive AGENTS.md covering developer roles, invariants, test seams, and workflow.
- 2026-10-09 [TOOL] All 20 issues published to GitHub repo Shirooo098/Tindig with label `ready-for-agent`.
- 2026-10-09 [TOOL] Next: Begin implementation of Ticket #1 (offline catalog & typed price lookup).

## Done
- 2026-10-09 [USER] Confirmed broad product: catalog/aliases, voice/text, reviewed sales/stock, GCash receipt OCR, utang and aging, dashboard periods, guarded reporting/restock agent.
- 2026-10-09 [TOOL] Read to-spec and setup-matt-pocock-skills instructions successfully after environment retry.
- 2026-10-09 [TOOL] Synthesized template-based draft with 52 stories, ownership, test strategy, priorities, exclusions, and open engineering decisions.
- 2026-10-09 [USER] Approved 20 proposed vertical slice tickets and requested publish & commit to repo.
- 2026-10-09 [TOOL] Created ready-for-agent label and published issues #1 through #20 on GitHub Shirooo098/Tindig.
- 2026-10-09 [USER] Confirmed 4-developer task allocation; requested documentation update in AGENTS.md.
- 2026-10-09 [TOOL] Created AGENTS.md with team workstreams, non-negotiable invariants, test seams, and workflow.

## Decisions
- D1 2026-10-09 [USER] Bundled models supersede first-run download proposal; phone-only target retained.
- D2 2026-10-09 [USER] Utang included, superseding initial exclusion; oldest-first repayment, partial payment, correction history, age thresholds 3/7 days.
- D3 2026-10-09 [USER] Philippine calendar report periods: today/week/month/current plus prior five months/year.
- D4 2026-10-09 [USER] Four developer split: speech; catalog/understanding; transactions/data; app integration/OCR/UI.
- D5 2026-10-09 [USER] GitHub repository Shirooo098/Tindig confirmed as issue tracker destination.

## Working set
- TINDIG-SPEC.md
- AGENTS.md
- CONTINUITY.md
- .scratch/tindig/TICKET-PLAN.md

## Receipts
- 2026-10-09 [TOOL] Shell working again; directory enumeration found no existing entries before document creation.
- 2026-10-09 [TOOL] No application tests, hardware inference benchmarks, dependencies, commits, or pushes performed.
- 2026-10-09 [TOOL] Primary proposed seam: application actions against real temporary SQLite; separate actual-device acceptance for speech/OCR/offline UI.
- 2026-10-09 [TOOL] Handwriting OCR, agent model, concrete versions, performance, backup policy, and some reversal/report semantics remain unconfirmed.
