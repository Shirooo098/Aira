# Ticket #5 — reviewed voice price lookup

Implementation branch: `feat/#5-voice-price-lookup`. Both prerequisites are merged: speech (#2, PR #27) and owner-confirmed aliases (#3, PR #28). The branch starts from `a195111`.

## Owner flow

In Alamin ang Presyo, record a question, inspect the recognized text, edit it if necessary, and tap **Markahang Nasuri**. Only explicit review submits the question. The screen retains the reviewed question and displays the extracted product phrase used for lookup. Editing the transcript requires another review.

An exact catalog name, name plus variant, or saved confirmed alias can display the canonical product and its current catalog price. Conflicting identities and partial suggestions require an explicit product choice before displaying a price. An unknown product or variant has no price. Unsupported questions offer editing or typed lookup. Speech lookup does not save aliases or change catalog, stock, or financial records.

The shared catalog lookup now treats even one partial substring match as a suggestion requiring selection. This rule also applies to typed lookup. Existing alias collision handling and migration 7 remain the source of truth; no voice-specific alias store is introduced.

## Deterministic grammar

Supported forms, matched against the whole reviewed question:

- `Magkano [po] [ba] ang <product>?`
- `Magkano [po] [ba] yung <product>?`
- `Magkano [po] [ba] <product>?`
- `Ano ang presyo ng <product>?`

Bracketed particles are optional only in those positions. Case, Unicode NFC, repeated whitespace, and terminal question punctuation are normalized. Product words and internal punctuation are retained. The parser removes one recognized command prefix; it does not infer quantities, synonyms, corrections, or product identity.

For example, `Magkano ang Ang Ketchup?` searches `ang ketchup`. `Magkano ang Coke 999 ml?` searches the complete variant phrase and must not inherit another Coke variant's price.

### Shared speech sample interpretation

This freezes parser expectations for the existing samples in `SPEECH-BENCHMARK.md`; it does not establish speech recognition accuracy.

| Samples | Parser expectation |
|---|---|
| S01: Magkano ang isang Coke? | Preserve `isang coke`; unknown unless that complete phrase is a catalog identity or confirmed alias. Do not silently remove the quantity word. |
| S02–S09 | Unsupported price-command shape; edit or type a product name. These samples exercise other speech tasks. |
| S10: Magkano ang produkto na wala sa catalog? | Preserve `produkto na wala sa catalog`; unknown in the representative catalog. |

## Verification

Run `npm run typecheck`, `npm test`, and `npx expo export --platform android`. Tests exercise parser behavior, explicit review callbacks, and lookup actions using real SQLite, including persistence, alias collisions, unknown variants, partial suggestions, and stale-request suppression.

Verified on 2026-10-10: TypeScript passed, all 103 app tests passed, and Android Metro export succeeded (675 modules). Independent code review found no material issues. The export required access to the OS temporary directory for Hermes output. Rendered React Native interactions have not been exercised with an automated UI runner; controller and action tests cover their underlying behavior.

Desktop tests and Metro export do not establish physical capture, recognition accuracy, or the under-three-second target. No Oppo Reno6 Z 5G test has been performed for this ticket.

## Hardware acceptance — pending

Before declaring acceptance, agree the sample count, catalog and alias fixtures, quiet/noisy phrases, critical-token accuracy requirement, cold/warm conditions, and latency interpretation. In particular, record whether the three-second target applies to the complete owner-reviewed interaction; do not silently subtract owner review time.

Use the actual Oppo, a standalone APK, airplane mode enabled, Wi-Fi disabled, and Metro stopped. Record revision, APK/model identity, device/Android version, timing method and uncertainty. Retain every outcome, including errors and unsupported/unknown/ambiguous results.

| Sample / condition | Speech end | Transcript visible | Review start | Review confirmed / edits | Lookup start | Result visible / outcome |
|---|---|---|---|---|---|---|
| NOT RUN | — | — | — | — | — | — |

Report full speech-end-to-visible-result duration including review/edit delay, plus speech-end-to-transcript, owner review/edit duration, and review-confirmation-to-visible-result separately. For ambiguous results, record both the visible choices and the later owner-selected price. A database-only timing, mocked recognition, average, or single successful run cannot establish end-to-end acceptance.
