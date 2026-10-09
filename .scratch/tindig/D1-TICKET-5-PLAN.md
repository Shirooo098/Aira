# D1 plan — Ticket #5 voice price lookup

Prepared 2026-10-10. Software implementation and desktop verification are complete; see `docs/TICKET-5-VOICE-PRICE.md` for the implemented contract and verification/acceptance boundary. The sections below retain the original implementation design. Physical-device acceptance remains pending.

## Status and dependency gate

Ticket #5 is **implemented locally; awaiting physical-device acceptance**. Type checking, all 103 app tests, Android Metro export, and independent code review passed on 2026-10-10. Dependencies were rechecked against freshly fetched `origin/main` (`a195111`). Branch `feat/#5-voice-price-lookup` was fast-forwarded to that revision, following the repository's `feat/#<issue-num>-<short-slug>` template.

- **#2 — Filipino speech transcription:** merged into `main` through PR #27 (`1571bd4`), including implementation `d1d8c30`. This prerequisite is satisfied.
- **#3 — owner-confirmed aliases:** merged through PR #28 (`a195111`), including implementation `f3f869e`. Use the shipped `prepareAlias`/`confirmAlias`, migration 7, and alias-aware `lookupProduct` contract. This prerequisite is satisfied.

`AGENTS.md` says to start a ticket only after its blockers have completely merged into `main`; both merges are now verified. This ticket adds no alias table, migration, or alias API. No device is available, and the user's device-free testing preference remains in effect.

## Source boundary at planning time (before #3 merge)

- `src/ui/SpeechTranscriptInput.tsx` owns capture, editable text, and the **Markahang Nasuri** action. It currently calls `session.review()` but retains the reviewed string only in component-local state.
- `src/speech/speech-session.ts` defines `review(): string | null`; it returns the current nonblank editable draft and does not perform lookup or persistence.
- `src/ui/AskPriceView.tsx` owns typed query state and renders `SpeechTranscriptInput`. Typed searches call `createLookupSession.search` immediately.
- `src/actions/lookup-session.ts` suppresses stale lookup results and publishes loading, result, and error state.
- `src/actions/catalog-actions.ts` exposes the current `lookupProduct` action. `src/types.ts` defines `empty`, `exact`, `ambiguous`, and `unknown` results. Unknown results carry a query and no price.
- The current generic catalog lookup can turn one substring match into `exact`. That behavior is too permissive for reviewed voice lookup: one partial match alone must not be displayed as a confirmed price.
- `src/db/migrations.ts` currently creates only the product table. Ticket #5 must not add alias persistence or duplicate #3's lookup logic.

## Intended reviewed-transcript flow

1. Keep the current push-to-talk, editable transcript, and explicit review step. Partial recognition and an unreviewed transcript must never start a catalog lookup.
2. Give `SpeechTranscriptInput` a parent callback with the conceptual contract `onReviewedTranscript(text: string): void`. Invoke it only when the owner taps **Markahang Nasuri** and `session.review()` returns a nonblank draft matching the current edit. The callback carries the exact reviewed text; it does not carry an inferred product or a price.
3. Editing invalidates the prior review as it does today. Retry, discard, cancel, and backgrounding must not emit a reviewed transcript. Re-reviewing an edited draft emits that new text.
4. In `AskPriceView`, parse the reviewed sentence using a small deterministic grammar. Show the extracted product phrase so the owner can see what will be searched, then submit it to the merged alias-aware lookup path. Keep the original reviewed sentence available for inspection.
5. Render the canonical product and catalog price for `exact`, current candidate choices for `ambiguous`, and a price-free unknown state for `unknown`. Never learn or save an alias from speech in #5. A choice among ambiguous candidates is an explicit lookup resolution, not an alias approval.

## Conservative command parsing

Use a pure deterministic parser; no local language model is needed. Freeze the accepted grammar against the shared speech samples before implementation. Start narrowly, for example:

- `Magkano [po] [ba] ang <product>?`
- `Magkano [po] [ba] yung <product>?`
- `Magkano [po] [ba] <product>?`
- `Ano ang presyo ng <product>?`

The bracketed words are optional only at those specified positions. Accept a form only when the whole utterance matches a supported anchored pattern and the extracted phrase is nonblank. Normalize Unicode to a consistent form, case, and repeated whitespace; trim terminal question punctuation. Preserve words and punctuation inside the product phrase.

Do not run a general Filipino stop-word remover. Strip only the exact command prefix selected by a full grammar match, once. For example, in `Magkano ang Ang Ketchup?`, remove the first command particle and preserve `Ang Ketchup` as the product phrase. Never remove `ang`, `ng`, `price`, `presyo`, or another token from the interior of a product name. If an utterance does not fit a supported form, show an edit/type recovery and do not pass the whole question as though it were a product name.

The parser recognizes command shape only; it does not establish product identity. Send the extracted phrase through #3's merged alias-aware lookup contract. A canonical exact name or name-plus-variant may resolve directly. A confirmed alias may resolve only to its persisted canonical product. If the lookup implementation offers partial suggestions, a single substring suggestion must not become `exact`; return an ambiguity choice or unknown unless the lookup contract can establish a canonical exact name, exact variant, or confirmed alias. If tightening that behavior requires changing the shared lookup action, coordinate the change with #3 rather than introducing a parallel voice-only catalog or alias store.

## Lookup behavior and safety cases

Use the existing visible result categories, adapting to #3's public result contract after it is merged:

- One canonical product identity from exact catalog text or an exact confirmed alias: show that product's stored integer-centavo price.
- Multiple distinct candidate product IDs, including a confirmed alias collision or a shared product name with multiple variants: show choices and no single selected price.
- No established match: show unknown and no price. A known product name must not donate its price to an unknown variant.
- Empty or unsupported command: keep the lookup empty and offer correction; do not guess the product phrase.
- Lookup failure or superseded request: clear stale price state and show recoverable feedback, following the current lookup-session behavior.

When combining canonical and alias matches, deduplicate candidates by canonical product ID. An exact alias must not silently override an exact canonical match to a different product; conflicting identities remain ambiguous. Read the actual #3 implementation and tests before finalizing how it expresses these cases. Do not assume alias uniqueness or invent an alias API here.

## Planned verification

After both dependencies merge, add focused parser checks and application-action tests against a real temporary SQLite database using #3's actual migration and confirmed-alias APIs. Include:

- Accepted grammar, unsupported phrasing, punctuation and casing.
- Product phrases beginning with common command words, including `Ang Ketchup`, and phrases containing `ang` or `ng` internally; verify parsing preserves their words.
- Canonical exact name and name-plus-variant lookup.
- Confirmed alias reuse after database restart, alias-to-product identity and catalog-authoritative price.
- Unknown product and unknown variant remain price-free.
- Two catalog variants, and an alias collision across distinct product IDs, remain ambiguous.
- A unique partial substring never becomes a confirmed exact price.
- The transcript callback fires only on explicit review of the current nonblank draft; editing requires a new review, and cancel/discard/retry do not dispatch.
- A newer query, clear action, or failed lookup cannot leave an older price visible.

These checks establish deterministic parsing and lookup behavior only. They do not establish Whisper accuracy, actual-device speed, memory use, or airplane-mode behavior.

## Timing and acceptance evidence

Do not claim the under-three-second acceptance from unit tests or a desktop run. The user's device-free test preference applies, and no Oppo Reno6 Z 5G is available here; code verification must be reported separately from the required hardware evidence.

For any future device run, record for each utterance: speech end/release time; visible transcript time; review start and completion; any owner edits; lookup start; and visible exact/unknown/ambiguous result. Report both:

- **Full speech-end to visible lookup**, which includes the owner's review and edit delay. This is the literal end-to-visible result and must not have the owner interval silently subtracted.
- **Component timings**, including speech-end to transcript, owner review/edit duration, and review confirmation to visible lookup. The latter is useful for measuring parser/database/render work but is not a substitute for the full elapsed time.

Before declaring acceptance, agree and record the sample size, test phrases, required critical-token/product accuracy, latency interpretation (including whether the target applies to the full owner-reviewed flow), and cold/warm conditions. Report every tested result and failures. Demonstrate airplane mode with Wi-Fi disabled on the actual target device when that device becomes available. Do not infer a three-second result from averages, a single run, mocked inference, or a database-only test.

## Relevant source files

- `src/ui/SpeechTranscriptInput.tsx`
- `src/speech/speech-session.ts`
- `src/ui/AskPriceView.tsx`
- `src/actions/lookup-session.ts`
- `src/actions/catalog-actions.ts`
- `src/types.ts`
- `src/db/migrations.ts` (inspect #3's merged migration contract; do not add alias schema in #5)
- `tests/lookup.test.ts`
- `tests/lookup-session.test.ts`
- `.scratch/tindig/issues/02.md`, `.scratch/tindig/issues/03.md`, `.scratch/tindig/issues/05.md`
- `docs/SPEECH-INTEGRATION.md`, `docs/SPEECH-BENCHMARK.md`
