# Aira UI redesign — selected direction

- 2026-10-10 [USER]: The current UI lacks a clear direction. New UI should feel like a Helpful Companion: warmer and less formal, with price lookup first.
- 2026-10-10 [USER]: Produce mockups before coding. User selected the attached Friendly Price Board concept and requested removing the top Offline badge because it is redundant.
- 2026-10-10 [TOOL]: Revised approved reference: ../.impeccable/mocks/decision/friendly-price-board-approved.png. Built-in image_gen edited the supplied image; exact prompt and approval provenance are in its JSON sidecar and PNG metadata.
- 2026-10-10 [CODE]: DESIGN.md and .impeccable/design.json now describe the implemented native theme. Original source-derived tokens/components are preserved in UI-BASELINE.md and UI-BASELINE.design.json.
- 2026-10-10 [TOOL]: Exploration images remain in .impeccable/mocks/decision as unselected history. A user selection from an earlier hand supersedes the later fresh-hand exploration.
- 2026-10-10 [USER]: Offline functionality remains required; only the persistent header indicator is removed from the design.

## Selected screen

Visitor mode: Operate. Owner looks up a product while serving a customer at a sari-sari store.

Flow: Aira identity → "Magkano ito?" → search → apricot "Magsalita" action → correction link → lilac product/variant/unit/price result → Presyo/Benta/Tindahan navigation.

Ink-purple, pale lilac, warm apricot, bold sans-serif, and rounded native controls establish one coherent world. No chat/avatar treatment. The sample product and ₱15.00 are synthetic design data, not new catalog records.

## Implementation and acceptance

2026-10-10 [CODE]: App.tsx and src/ui now implement the selected direction, preserving prior uncommitted polish. Shared theme roles and native icons extend through all existing workflows. Bottom navigation uses Presyo/Benta/Tindahan with unchanged mode keys. Price search, compact speech, correction and the lilac answer panel replace the earlier layout. The top Offline badge is removed.

2026-10-10 [USER]: Use astra-orchestrator for implementation. Antigravity exploration succeeded. The implementation worker saved edits but reported a network error; after its process stopped, root inspected/integrated the changes and fixed touch targets and flexible text sizing. Separate Codex testing and review verified the resulting source.

2026-10-10 [TOOL]: 25 focused tests, TypeScript checking, Android bundle export and speech presenter callback checks passed. Independent source review found no material introduced findings. Source preserves unknown/ambiguous lookup, editable speech, capture failures, consequential confirmation, safe areas and accessible control states. Database/actions/domain/speech-session/package configuration were not changed by this theme pass.

Runtime roles and observed source metrics are documented in DESIGN.md. Native real-product wrapping, keyboard interaction, TalkBack, large system text and Oppo rendering remain to be verified: no adb target/emulator is available. Images and export cannot certify those behaviors; the visual gate remains open pending native screenshots. Release packaging previously failed on repository DNS, per CONTINUITY.md, and was not retried for this theme pass. No commit or push was performed.
