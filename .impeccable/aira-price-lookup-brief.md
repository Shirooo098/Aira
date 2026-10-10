# Price lookup — approved visual direction

Primary target: src/ui/AskPriceView.tsx
Related targets: App.tsx; src/ui/ModeSelector.tsx; src/ui/ask-price-styles.ts; src/ui/SpeechTranscriptInput.tsx; src/ui/speech-transcript-styles.ts
Visitor mode: Operate
Status: Mockup approved by user; native implementation not started.
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

Preserve speech capture/review, ambiguity resolution, typing, safe areas and existing workflows. Sample product/price labels are synthetic design data. Never rasterize live UI or copy sample store data into persistence. Gesture/keyboard/TalkBack/large-text/device verification remains outstanding. This pass edits images and documentation only.
