---
version: 1
slug: "src-ui-askpriceview-tsx"
primary_target: "src/ui/AskPriceView.tsx"
related_targets: ["App.tsx","src/ui/ModeSelector.tsx","src/ui/ask-price-styles.ts","src/ui/SpeechTranscriptInput.tsx","src/ui/SpeechTranscriptControls.tsx","src/ui/speech-transcript-styles.ts","src/ui/theme.ts","src/ui/AppIcon.tsx"]
---

# Price lookup — approved visual direction

Primary target: src/ui/AskPriceView.tsx
Related targets: App.tsx; src/ui/ModeSelector.tsx; src/ui/ask-price-styles.ts; src/ui/SpeechTranscriptInput.tsx; src/ui/speech-transcript-styles.ts
Visitor mode: Operate
Status: Implemented in native source; focused tests, typecheck, Android bundle export and independent source review passed. Native visual acceptance pending.
Approved comp: .impeccable/mocks/decision/friendly-price-board-approved.png
Approval: 2026-10-10 user selected Friendly Price Board from attached image; requested removal of header Offline badge.

## Direction contract

THESIS: A friendly price board makes the correct product and its price the focal answer, replacing the previous unrelated blue/slate cards.

OWN-WORLD: Deep purple sans-serif anchors, pale lilac answer surfaces, rounded apricot speech actions, and a light canvas. No persistent top Offline indicator.

STORY: The owner asks or types a product, reads its variant/unit and catalog price, and can correct the input. Product uncertainty stays visible.

FIRST VIEWPORT: Small Aira wordmark; conversational heading; wide search field; apricot speech action; purple correction link; broad lilac answer panel with product, variant and price; Presyo/Benta/Tindahan bottom navigation. Preserve the selected composition while adapting to native text scaling and real data.

FORM: Friendly Price Board, user-selected pick from original direction seed d7c515f4; the user's attached reference supersedes the fresh-hand exploration. Exact revised comp path is recorded above.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Implementation constraints

Preserve speech capture/review, ambiguity resolution, typing, safe areas and existing workflows. Sample product/price labels are synthetic design data. Never rasterize live UI or copy sample store data into persistence. Gesture/keyboard/TalkBack/large-text/device verification remains outstanding.

## Implementation receipt — 2026-10-10

Shared purple/lilac/apricot roles are in src/ui/theme.ts; simple icons use native View geometry. Price lookup has compact speech controls, real-data answer hierarchy and a correction link that focuses search. Existing speech preparation, accessible toggle, cancel, review, permission recovery and lookup states remain. Root navigation now sits at the bottom with the existing internal mode keys. Sales, store tools, reports, debt and review dialogs share the theme.

25 focused tests, TypeScript, Android bundle export and an ephemeral speech presenter callback check passed. Independent source review found no material introduced findings. Covered diff hash: 85b79eac50f455d789bb9c67d05af6a676fe27a4. Logs: .scratch/theme-tests.log, theme-typecheck.log, theme-export.log. Runtime tokens and source specimens are documented in DESIGN.md and .impeccable/design.json.

No device/emulator is available; no native screenshot or TalkBack acceptance is claimed. Impeccable's visual hero gate remains open pending native capture. No shipping raster UI assets or new dependencies were added.
