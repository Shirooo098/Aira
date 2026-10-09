# AGENTS.md — Tindig Agent & Developer Guide

Guidance for automated agents and developers working on Tindig.

## Project Overview

**Tindig** is an offline, Filipino-speaking sari-sari store assistant for Android, targeted for a single owner-operated store on an **Oppo Reno6 Z 5G**.
- **Working brand descriptor**: "Your offline, Filipino-speaking store assistant."
- **Primary goal**: Fast, reliable price lookup, voice-driven sales drafting, owner-verified GCash logging, and utang (credit) ledger tracking without internet connectivity.
- **Specification**: See [TINDIG-SPEC.md](TINDIG-SPEC.md) for full product scope and acceptance requirements.
- **Ticket Plan**: See [.scratch/tindig/TICKET-PLAN.md](.scratch/tindig/TICKET-PLAN.md) for the 20-ticket dependency graph and wave breakdown.
- **Tracker**: [Shirooo098/Tindig Issues](https://github.com/Shirooo098/Tindig/issues) (`ready-for-agent` label).

---

## 4-Developer Team Roles & Workstreams

Work is organized into 4 vertical-slice streams. Each stream lead owns the end-to-end slice (UI, action logic, persistence, and automated tests):

1. **D1 — Speech & On-Device Native Audio**
   - **Scope**: Native audio capture, `whisper.rn` / `whisper.cpp` bundling, push-to-talk UX, short audio cues, transcription latency benchmarks (<3s target on Oppo).
   - **Primary Tickets**: #2, #5.
2. **D2 — Language Understanding, Aliases & Guarded Agent**
   - **Scope**: Filipino & Taglish product alias resolution, voice-dictated catalog extraction, spoken cart drafting with correction (*"isa lang pala"*), and bounded on-device agent tool proposals.
   - **Primary Tickets**: #3, #6, #8, #16, #17, #18.
3. **D3 — Transactions, Inventory & Utang Ledger (Data Coordinator)**
   - **Scope**: Cash transactions, pending-to-confirmed GCash payment flows, oldest-first credit (*utang*) repayments, balance-preserving reversals, and coordination of shared SQLite schema migrations.
   - **Primary Tickets**: #4, #7, #9, #11, #12, #13.
4. **D4 — App Shell, OCR & Integration Lead**
   - **Scope**: React Native/Expo foundation, basic catalog UI, ML Kit receipt OCR, aged credit dashboard, reporting periods, notebook OCR spike, and final end-to-end offline demo verification.
   - **Primary Tickets**: #1, #10, #14, #15, #19, #20.

---

## Non-Negotiable Engineering Invariants

1. **Strict Offline Operation**
   - Every core business feature must function in airplane mode with Wi-Fi disabled.
   - Never implement silent cloud fallbacks or dynamic external model downloads. All production models must be bundled.
2. **Integer Centavos for Currency**
   - All monetary values must be stored and computed as integer centavos (`₱15.50` = `1550`).
   - Never use floating-point numbers for money calculations.
3. **Guarded Actions & Explicit Review**
   - AI models (transcription, OCR, agent) only *propose* draft state.
   - Never commit financial records, catalog updates, or stock adjustments autonomously. The store owner must explicitly review and confirm via UI action.
4. **Database Schema Discipline**
   - Coordinate all SQLite table schemas and migrations through D3 conventions.
   - Never perform destructive migrations without preserving existing store transaction history.
5. **Clear Stock Changes**
   - Separate physical delivery intake (`add-delivery`) from count corrections (`set-count`).
   - Sale cancellations must restore inventory exactly once.

---

## Test Seams & Verification

- **Business Logic Seam**: Write automated unit and integration tests executing application actions against a real temporary/in-memory SQLite database.
- **Hardware Acceptance Seam**: Speech transcription latency, camera OCR extraction, and RAM/CPU usage must be validated on an actual physical Oppo Reno6 Z 5G running offline.
- **Fixture Verification**: Test financial queries and report periods against deterministic fixtures with known totals for cash, GCash, credit, repayments, and reversals.

---

## Development Workflow

1. **Working the Frontier**
   - Only start tickets whose blockers are completely merged into `main`.
   - Check the dependency graph in [.scratch/tindig/TICKET-PLAN.md](.scratch/tindig/TICKET-PLAN.md) before picking up a ticket.
2. **Branching & Pull Requests**
   - Branch naming: `feat/#<issue-num>-<short-slug>` (e.g., `feat/#2-whisper-speech`).
   - Every PR must link to its corresponding issue: `Closes #<issue-num>`.
3. **Commit Messages**
   - Follow Conventional Commits: `<type>[optional scope]: <description>`.
   - Examples: `feat(catalog): add typed product lookup`, `fix(utang): allocate repayment oldest-first`.
4. **Issue Labels**
   - Tickets ready for implementation carry the `ready-for-agent` label.
