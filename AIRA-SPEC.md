# Aira — Hackathon MVP Specification

Status: Product decisions confirmed; specification draft prepared for review. Test seams and publication destination await confirmation. Not yet published or labeled ready-for-agent.

Date: 2026-10-09 (Asia/Manila).

Provenance: Synthesized from the user's confirmed planning session. No implementation, device benchmark, or competitor hands-on test has been completed. Proposed engineering details and unresolved choices are explicitly identified below.

## Problem Statement

A sari-sari store owner keeps product prices in a notebook and sometimes forgets prices while serving customers. Looking up prices, encoding products, documenting payments, maintaining stock, and tracking customer credit interrupt selling. The owner wants to speak naturally in Filipino, use familiar product names, and retain control over changes to store records.

The target is one owner-operated store on one Oppo Reno6 Z 5G. Useful AI functionality must execute locally and continue working without internet. Photographing an existing notebook is desirable but must not block a reliable voice workflow.

Existing products already advertise offline POS, Filipino input, reporting, credit ledgers, or receipt OCR. Aira does not claim to be the first or only such product. Its proposed distinction is reliable on-device speech, owner-confirmed store vocabulary, and low-effort capture with visible correction.

## Solution

Aira (Artificial Intelligence for Retail Assistance) is an offline, Filipino-speaking Android store assistant. The working brand descriptor is “Your offline, Filipino-speaking store assistant.” Brand availability has not been checked.

Confirmed improvement priorities:

1. Reliable speech recognition.
2. Owner-confirmed product aliases.
3. Notebook onboarding: important, but a nice-to-have for the hackathon and not a blocker for the first two priorities.

The complete agreed product scope includes a product catalog, price lookup, reviewed sales, inventory, cash and GCash records, customer credit (utang), a reporting dashboard, and guarded agent assistance. Prioritization changes build order, not silent removal of accepted features. Incomplete features must be disclosed.

Modes are Ask price, Sell, and Manage products, with visible indicators and short audio cues. Voice and typing are available. The app proposes changes; the owner reviews and confirms them. Missing data and ambiguous interpretations are surfaced rather than guessed.

## User Stories

1. As an owner, I want the required AI models included in the app installation, so that I do not need separate model downloads.
2. As an owner, I want setup to show extraction progress and readiness when needed, so that I know when offline operation is available.
3. As an owner, I want to use the core app without internet, so that connectivity does not interrupt store work.
4. As an owner, I want to speak Filipino with familiar English brand names and numbers, so that I can work naturally.
5. As an owner, I want to type or correct captured text, so that recognition errors do not prevent work.
6. As an owner, I want to see and hear the active mode, so that I know whether I am asking, selling, or managing products.
7. As an owner, I want switching modes to leave records unchanged, so that navigation does not accidentally save transactions.
8. As an owner, I want to ask a product price, so that I do not have to search my notebook.
9. As an owner, I want prices retrieved from my catalog, so that model guesses never determine what I charge.
10. As an owner, I want choices for ambiguous products and sizes, so that I select the intended item.
11. As an owner, I want unknown products identified explicitly, so that I can add or correct them.
12. As an owner, I want to approve an alias such as “Coke maliit,” so that future requests recognize my store vocabulary.
13. As an owner, I want conflicting aliases to require clarification, so that shorthand does not silently select the wrong product.
14. As an owner, I want to dictate product, price, and quantity, so that catalog entry requires less typing.
15. As an owner, I want to review captured catalog fields, so that errors are corrected before saving.
16. As an owner, I want to supply missing sizes, prices, or quantities explicitly, so that missing values are not invented or treated as zero.
17. As an owner, I want to scan notebook entries when recognition is useful, so that I can reuse existing records.
18. As an owner, I want rescans to propose product updates, so that they do not silently duplicate products or add stock.
19. As an owner, I want price-only updates to preserve stock, so that catalog maintenance does not change inventory.
20. As an owner, I want separate set-count and add-delivery actions, so that quantity changes have clear meanings.
21. As an owner, I want spoken orders converted into a visible draft, so that I can check products, quantities, and total.
22. As an owner, I want to correct a draft order before confirmation, so that “isa lang pala” does not require restarting the sale.
23. As an owner, I want to correct insufficient recorded stock, so that the app does not silently create negative inventory.
24. As an owner, I want a clear final sale-confirmation button, so that background speech cannot finalize a purchase.
25. As an owner, I want a confirmed sale and stock deduction saved together, so that records remain consistent.
26. As an owner, I want cash tender and change calculated, so that I can return the correct amount.
27. As an owner, I want to record GCash after checking my own account, so that payment status reflects my confirmation.
28. As an owner, I want a receipt image attached to its sale, so that I can find supporting evidence later.
29. As an owner, I want OCR to propose the visible buyer name, mobile number, reference, and amount when present, so that I copy less information manually.
30. As an owner, I want masked or absent receipt fields preserved honestly and sender/recipient identities distinguished, so that records do not contain fabricated buyer details.
31. As an owner, I want reused references and amount discrepancies flagged, so that I can investigate a possible mismatch.
32. As an owner, I want receipt searches by reference or visible buyer details, so that I can retrieve the relevant sale.
33. As an owner, I want to record a customer's unpaid purchase, so that stock decreases while their credit balance increases.
34. As an owner, I want partial payment at purchase, so that only the unpaid portion becomes utang.
35. As an owner, I want a name or nickname and optional distinguishing note for customers, so that similar names can be resolved explicitly.
36. As an owner, I want reviewed opening debts marked Previous balance, so that older debt does not create new sales or affect stock.
37. As an owner, I want partial or full repayments by cash or owner-confirmed GCash, so that balances decrease correctly.
38. As an owner, I want repayments allocated oldest first and overpayments rejected, so that allocations remain understandable.
39. As an owner, I want corrections and reversals retained in history, so that I can understand balance changes.
40. As an owner, I want sale cancellation to restore stock once, so that repeated actions do not inflate inventory.
41. As an owner, I want to review and reverse affected repayments before cancelling a paid-down credit sale, so that debt records remain consistent.
42. As an owner, I want credit ages shown as Current, Needs attention, Urgent, or Age unknown, so that I can prioritize follow-up.
43. As an owner, I want partial payments not to reset the remaining debt's age, so that older unpaid debt remains visible.
44. As an owner, I want fully settled balances removed from the attention list, so that I focus on outstanding debt.
45. As an owner, I want dashboard sales, collections, credit, payment mix, product performance, and current stock, so that I can understand store activity.
46. As an owner, I want calendar-based report filters, so that I can view Today, Week, Month, 6 Months, and Year consistently.
47. As an owner, I want missing history and empty periods identified, so that incomplete records are not presented as complete business activity.
48. As an owner, I want a Filipino explanation based on the selected report period, so that I can understand the calculated results.
49. As an owner, I want optional restock suggestions in an editable checklist, so that I retain control of purchasing decisions.
50. As an owner, I want approving a checklist to leave inventory unchanged, so that stock increases only when received or explicitly corrected.
51. As an owner, I want useful errors for failed inference, capture, or saving, so that I know whether an operation succeeded.
52. As an owner, I want readable controls and visual alternatives to audio cues, so that the app remains usable in a noisy store.

## Implementation Decisions

### Confirmed platform and delivery

- React Native with TypeScript is chosen because all four developers know React. Expo Go is the confirmed primary phone-testing workflow for the catalog foundation (2026-10-10). Follow README.md for launch instructions. Later custom native inference modules require an Expo development build when unavailable in Expo Go; final standalone offline acceptance uses a release APK.
- One Android device and one store; Oppo Reno6 Z 5G is the acceptance device. No laptop-hosted inference in the intended product.
- Required production models are bundled, superseding the earlier download-on-first-use proposal. If extraction is necessary, expose progress, validate readiness, and do not quietly download a replacement.
- Exact framework, wrapper, runtime, and model versions are pending a successful native integration test. Bundling does not itself establish offline readiness or speed.

### Candidate inference stack, not benchmarked selections

- Speech: multilingual Whisper tiny versus base, run through whisper.cpp with whisper.rn. Do not use English-only variants for Filipino. Select and ship the smallest tested model meeting the acceptance needs, not every benchmark candidate.
- Receipt OCR: bundled Latin-script Google ML Kit Text Recognition v2. The Infinite Red React Native wrapper is a candidate; verify native dependency selection and compatibility.
- Notebook handwriting OCR: unresolved. Image OCR must be tested on real notebook photographs. Digital Ink recognition of pen strokes is not a solution for photographed handwriting.
- Agent reasoning: a small quantized local instruction model and runtime remain unresolved. No performance, tool-use quality, or Filipino-language guarantee exists yet.
- Clear commands use a validated fast path; guarded reasoning is reserved for requests needing it. Unsupported or ambiguous commands produce an explicit clarification/error, not a guessed operation.
- Proposed push-to-talk capture bounds utterances. Always-on listening and wake-word detection are not part of the agreed MVP.

### Responsibility boundaries and contracts

- Capture produces a transcript or OCR candidates; it does not write business records.
- Catalog resolution converts text into identified products, candidate matches, or missing/ambiguous results. Confirmed aliases map owner vocabulary to catalog products; saving one does not retrain a model.
- Command understanding produces a proposed action and visible draft in the current mode.
- The transaction layer validates confirmed actions and owns persistent financial and inventory changes.
- Reporting queries calculate numbers deterministically; the agent explains returned data and proposes allowed actions. It does not run unrestricted SQL or write directly to the database.
- Restock suggestions require owner review and do not invent reorder quantities from insufficient history.
- Local SQLite is the intended source of truth. Store receipt images in app-private files with record references. Exact SQLite integration remains to be selected.
- Proposed engineering representation: money uses integer centavos; products and customers have stable identifiers. Supported selling units and quantity precision must be settled before schema finalization.
- Proposed integrity requirements: snapshot unit prices on sales, retain correction/reversal events, prevent duplicate confirmation, and atomically update sale, payment/debt, and inventory records.

### Sales, payments, and catalog rules

- Final sale confirmation is an explicit button. Catalog changes may accept spoken confirmation with a visible field review.
- Price lookup never generates a missing price. Variant/size ambiguity requires choices.
- Rescanning proposes catalog changes, showing existing versus proposed values. It does not add deliveries or overwrite counts implicitly.
- Receipt OCR preserves masking, leaves missing fields empty, distinguishes sender and recipient where identifiable, and never authenticates payment. Duplicate-reference detection applies only to known local records.
- Payment evidence and owner confirmation are distinct: a matching receipt does not mean funds were verified. Only the owner checks actual GCash receipt.
- Cancelling a record does not execute a cash or GCash refund. Exact handling of already-paid cash sales and repayment allocations spanning several debts needs a documented state transition before implementation.

### Utang rules

- Utang is included, superseding its earlier exclusion.
- Debt is the unpaid portion of a confirmed purchase. Opening balances are separate from sales and stock.
- Repayments apply oldest first and may not exceed outstanding debt. They increase collections, not sales.
- Credit-sale cancellation with affected repayments requires explicit review and reversal first; preserve history and restore stock exactly once on cancellation.
- Current: under 3 days; Needs attention: 3–6 days; Urgent: 7+ days. Original date unknown: Age unknown.
- Partial payments preserve the age of remaining unpaid entries. Customer priority reflects the oldest still-unpaid entry; settled customers leave the attention list.
- Proposed date convention: aging uses Philippine calendar dates. Unknown-date opening debts need an explicit ordering rule before oldest-first allocation can be fully implemented; never invent an original date.
- These indicators represent internal follow-up priority, not contractual delinquency. No automatic reminders or customer messages.

### Dashboard and reporting rules

- All calendar filters use Asia/Manila: Today from midnight; Week from Monday; Month from its first day; 6 Months from the first day of the month five months before the current month; Year from January 1. Each ends at now.
- Show sales and transaction counts excluding cancelled sales, cash versus owner-confirmed GCash collections, new credit, outstanding credit, and products ranked by quantity sold.
- Separate sales from collections: credit purchases are sales, while subsequent repayments are collections, not second sales. Opening debts are not sales.
- Current stock is labeled Stock now and does not become historical stock when a report filter changes. Proposed analogous label: Outstanding now for current credit balances.
- Empty periods show No recorded sales. Partial history shows Records available since the first recorded date. Do not claim profit without cost and expense data.
- Exact period attribution for later cancellations/reversals and historical collection totals must be specified before report tests are finalized; do not silently rewrite accounting meaning.

### Four-developer ownership (confirmed split)

1. Speech/device owner: bundled model integration, audio capture, offline transcription, noise testing, latency measurements.
2. Catalog/understanding owner: catalog operations, product/variant resolution, confirmed aliases, proposed actions, draft corrections, bounded agent experiment.
3. Data/transaction owner: schema and migrations, atomic sales and stock, payments, credit allocation and reversals, aging and reporting queries. Sole coordinator for schema changes.
4. App/integration owner: app shell, modes/audio cues, shared UI and review screens, Android integration, dashboard presentation, receipt OCR and bounded notebook experiment.

Each developer integrates and verifies their own work. Developer 4 coordinates integration rather than receiving every unfinished branch. The native AI build must be proven before heavy UI investment.

## Testing Decisions

Status: The following seams are proposed for user confirmation, as required by the to-spec skill. There is no existing codebase, test framework, or prior test suite to reuse in this empty workspace.

- Primary automated seam: the application action boundary against a real temporary SQLite database. Submit proposed/confirmed actions and assert externally observable records, balances, stock, and report results. Test behavior rather than internal helpers or model wording.
- Device seam: a small end-to-end acceptance suite on the actual Oppo covering bundled-model readiness, microphone/camera input, interpretations, owner review, persistence, and rendered results. Model performance cannot be established by mocked inference.
- Speech fixture set: real catalog names, Filipino quantities, English brand names, similar variants, draft corrections, unknown products, and representative store noise. Measure product/quantity/action correctness, not transcript readability alone.
- Timing acceptance: visible result for a short supported utterance within 3 seconds after speech ends, with faster preferred. Measure complete transcription/interpretation/lookup/render latency; report cold and warm runs separately. Final sample size, acceptable success rate, and percentile criterion remain unresolved.
- Offline acceptance: fresh installation with required models available from the bundle, airplane mode, and Wi-Fi disabled. Verify extraction if required, model readiness, catalog entry, price lookup, alias confirmation/reuse, draft sale correction, and transaction persistence after app restart.
- Catalog/alias acceptance: ambiguities produce choices, missing values remain missing, aliases require approval, and price rescans do not duplicate products or alter stock unintentionally.
- Transaction acceptance: repeated confirmation does not duplicate sales, stock/debt/payment updates are atomic, insufficient stock does not become negative, and cancellation restores stock once.
- Credit acceptance: partial/full payments, oldest-first allocations, overpayment rejection, opening balances, repayment reversals, duplicate customer names, age thresholds, unknown dates, and preservation of age after partial payment.
- Reporting acceptance: cash sale, GCash sale, partial credit purchase, later repayment, opening debt, and cancellations all produce agreed totals without double-counted sales. Test week/month/year boundaries and the six-month start date.
- OCR acceptance: printed receipts versus handwriting evaluated separately. Missing/masked details, sender/recipient confusion, duplicate references, and amount mismatches remain visible. No OCR result can independently mark payment verified.
- Agent acceptance: permitted tool calls only, malformed requests rejected, no direct database writes, no financial arithmetic invented by the model, no action outside the active task without confirmation, and no receipt text treated as an instruction.
- UX acceptance: visual mode cues alongside audio, readable/tappable choices, recoverable capture failures, visible save failures, and no reliance on color alone for debt priority.
- Evidence: record tested revision, device/OS, model/runtime versions, sample counts, outcomes, and cold/warm latency. No fabricated benchmark or claim of unexecuted checks.

## Out of Scope

- Multiple devices, branches, cloud synchronization, remote monitoring, or laptop-hosted inference in the intended phone-only workflow.
- Autonomous payment verification, sending transfers/refunds, or treating screenshots as proof of received funds.
- Automatic debtor messages, interest, credit limits, or customer credit scoring.
- Unrestricted agent conversation, arbitrary SQL execution, autonomous price/stock changes, or model-generated money calculations.
- Automatic ordering of supplies; approving a restock checklist does not mean goods were purchased or received.
- Profit accounting without purchase costs/expenses, tax-filing/compliance claims, or a claim to replace a certified fiscal system.
- Cloud AI as an undisclosed fallback when local inference fails.
- Proven worldwide uniqueness, trademark clearance, or guaranteed hackathon placement.

## Further Notes

### Implementation sequence

1. Prove bundled offline speech on the target phone.
2. Demonstrate accurate catalog lookup, clarification, and owner-confirmed aliases.
3. Complete a corrected and confirmed sale with consistent stock.
4. Integrate credit/payment correctness, dashboard results, receipt capture, and guarded explanations.
5. Run notebook OCR as a bounded parallel experiment; include it in the headline demo only if it genuinely reduces input effort. Do not misrepresent typed/printed input as handwritten recognition.

### Hackathon fit and evidence

The supplied AppBuildersPH Hackathon 2026 briefing assigns Problem & Usefulness 25%, Local AI Implementation 25%, Technical Execution 20%, Innovation 15%, and Product & Demo Quality 15%. It requires meaningful local inference, a working product substantially built during the event, and disclosure of models, frameworks, APIs, major tools, and reused assets.

The briefing lists submission at 10:00 AM on October 10, 2026, a public repository, a demo video/social video link, local-versus-internet disclosures, and a five-minute pitch plus three-minute Q&A. Verify the submission checklist against the supplied briefing before submitting. Documentation creation is not authorization to publish a repository, deploy, or post a social video.

The strongest planned demo is a real voice task, ambiguity resolution, approved alias reuse, a confirmed transaction, and consistent reporting in airplane mode. Notebook capture is conditional on its feasibility result. Any historical demo data must be labeled seeded rather than real operating history.

### Unresolved engineering decisions

- Exact dependency/model versions, maintenance/license review, bundle size, peak extraction storage, RAM use, and measured Filipino accuracy/latency.
- Reliable photographed-handwriting engine and realistic acceptance accuracy.
- Local reasoning model, permissible tool set, and behavior when it cannot process a request promptly.
- Selling-unit/quantity precision, unknown-date debt allocation order, later cancellation reporting, paid-sale reversal details, and interruption/resume behavior for drafts.
- Local backup/recovery and receipt retention policies; single-device storage is not itself a backup. These are open decisions, not approved extra features.
- Named developer assignments, available build hours, and actual test dataset.
- Tracker destination and confirmation of proposed test seams.

### References

- Product source: confirmed user conversation dated 2026-10-09.
- Event source: user-supplied AppBuildersPH Hackathon 2026 Participant Briefing (1).pdf.
- Speech integration: https://github.com/mybigday/whisper.rn
- Whisper Android example: https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.android/README.md
- OCR: https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- OCR wrapper candidate: https://github.com/infinitered/react-native-mlkit
- Digital Ink limitation: https://developers.google.com/ml-kit/vision/digital-ink-recognition
- Native Expo builds: https://docs.expo.dev/develop/development-builds/introduction/
- Competitor references: https://getsuki.app/ ; https://www.peddlr.io/en ; https://www.zigmafy.com/ ; https://paytrack.business/

No dependencies have been installed, application code authored, or external issue published by this specification task.
