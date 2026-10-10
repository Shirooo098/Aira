---
name: Aira — The Helpful Companion
description: Implemented Friendly Price Board theme for the native Android UI
colors:
  primary: "#402668"
  primaryStrong: "#40235f"
  primaryMuted: "#6b587f"
  background: "#fdfbff"
  surface: "#ffffff"
  surfaceSoft: "#f5f1fa"
  lilac: "#f3edff"
  selected: "#e9ddff"
  outline: "#d6c7e4"
  divider: "#e8dff0"
  accent: "#ffb974"
  accentSoft: "#fff0df"
  text: "#32263f"
  muted: "#736780"
  success: "#216c48"
  successSoft: "#edf7ef"
  successOutline: "#a8d0b5"
  warning: "#85441d"
  warningSoft: "#fff2df"
  warningOutline: "#e8bd8b"
  error: "#a52d40"
  errorSoft: "#fff0f2"
  errorOutline: "#e9b8c0"
  disabled: "#aa9ab8"
typography:
  lookup-title:
    fontSize: "32px"
    fontWeight: 900
  lookup-product:
    fontSize: "36px"
    fontWeight: 900
    lineHeight: "42px"
  lookup-price:
    fontSize: "58px"
    fontWeight: 900
  lookup-meta:
    fontSize: "16px"
    fontWeight: 600
  body:
    fontSize: "15px"
    lineHeight: "22px"
  speech-action:
    fontSize: "16px"
    fontWeight: 700
  navigation:
    fontSize: "12px"
rounded:
  field: "18px"
  button: "18px"
  card: "24px"
  dialog: "24px"
  lookup-search: "28px"
  lookup-result: "26px"
spacing:
  small: "8px"
  group: "12px"
  inset: "16px"
  lookup-gutter: "20px"
  lookup-result: "22px"
components:
  speech-action:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.primary}"
    typography: "{typography.speech-action}"
    rounded: "{rounded.button}"
    padding: "12px 20px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.button}"
  button-secondary:
    backgroundColor: "{colors.surfaceSoft}"
    textColor: "{colors.primary}"
    rounded: "{rounded.button}"
  lookup-search:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lookup-search}"
  lookup-result:
    backgroundColor: "{colors.lilac}"
    textColor: "{colors.primary}"
    rounded: "{rounded.lookup-result}"
    padding: "22px"
---

# Design System: Aira

## Overview

**Creative North Star: "The Helpful Companion"**

Aira feels like a welcoming helper at a neighborhood sari-sari store. Warm Filipino prompts, clear product answers, and easy correction define the character. The user selected the [Friendly Price Board reference](.impeccable/mocks/decision/friendly-price-board-approved.png), removing its redundant top Offline badge.

**Key Characteristics:**

- Deep purple anchors, pale lilac answers, and apricot speech actions.
- Rounded native controls and bold, legible product and price text.
- Visible typing, speech, correction, and owner review.
- One palette across price lookup, sales, store management, reports, debt, and review dialogs.

This document describes the 2026-10-10 working-tree implementation, based on main `545d069` with prior UI polish preserved. Shared runtime roles live in [theme.ts](src/ui/theme.ts); the old source system is archived in [UI-BASELINE.md](docs/UI-BASELINE.md). No new dependencies or font assets were added.

Frontmatter px values serialize React Native numeric units for documentation tooling. Layout uses density-independent units; text follows native font scaling. HTML/CSS sidecar previews illustrate source styles and are not Android screenshots.

Source review, 25 focused tests, TypeScript checking, an Android bundle export, and speech presenter callback checks passed. Native rendering, keyboard behavior, TalkBack, large system text, and Oppo acceptance remain unverified because no device/emulator is available. The visual build gate remains open pending native capture.

## Colors

### Primary

Ink purple (`primary`) carries the wordmark, headings, prices, icons, selected navigation, and routine actions. `primaryStrong` and `primaryMuted` support prominent tags and quieter purple text.

### Secondary

Apricot (`accent`) marks speech capture and the successful lookup tag. Lilac (`lilac`) forms the answer panel; `selected` marks active navigation. These roles are separate from semantic success green.

### Neutral

Near-white `background`, white `surface`, and pale `surfaceSoft` separate working areas. `text` and `muted` define body/supporting text; `outline` and `divider` define boundaries. Shared modal backdrop is `rgba(50, 38, 63, 0.58)`.

### Feedback

Green, amber, and red retain distinct success, warning, and error roles, each with a soft surface and outline. Unknown products use amber; capture/lookup errors use red. State labels and recovery controls remain visible.

**State Clarity.** Pair color with text or selected state. Ten intended text/surface pairs have automated contrast checks at 4.5:1 or better; this does not certify every rendered control or disabled state.

## Typography

Text inherits the native system face; no custom family or network font loading is used. The actual Android face and weight rendering still need device inspection.

The price surface uses 32/900 for its question, 36/900 with 42 line height for product identity, 58/900 for price, and 16/600 for variant/unit. Helper text is 15/22; compact speech text is 16/700. Bottom navigation uses 12, with weight 700 when selected.

Other workflows retain their existing type hierarchy while sharing colors and shapes. They do not inherit the large lookup price scale.

**Answer First.** Product name, variant, selling unit, and price remain readable together. Values come from real catalog data and integer-centavo formatting. Text wraps rather than truncating product identity.

## Layout

SafeAreaProvider and a four-edge SafeAreaView contain the app. The small Aira header sits above the flexible main view; Presyo/Benta/Tindahan navigation sits below it. The header has no Offline badge.

Price lookup uses a vertical scroll flow with 20-unit gutters: question and helper, search, compact speech controls, correction link, then the answer or applicable lookup state. Search and speech controls have minimum height 56; clear/correction controls have 48-unit targets. The result has 22-unit padding. Bottom navigation has minimum height 72 and may expand with text.

Real product names, metadata, prices, and badge labels wrap. Speech review/error controls remain in the flow when needed. Existing modal scrolling, width limits, and confirmation layouts are retained. There are no new breakpoints, tablet navigation, or dark scheme.

## Elevation & Depth

Everyday surfaces stay flat, separated by pale fills and thin borders. Existing dialog elevation and shadows remain: stock/repayment elevation 8; receipt review elevation 5. No new shadow or animation system was introduced.

Native Modal slide/fade and TouchableOpacity feedback remain platform interaction behavior. ModeSelector explicitly uses press opacity 0.7.

## Shapes

Shared fields/buttons use 18-unit corners; cards/dialogs use 24. Price search uses 28, its answer panel 26, and navigation icon capsules 16. Circular controls retain their geometry. Existing local feedback containers retain some smaller radii.

Search/transcript borders commonly use 1.5 units; navigation has a 1-unit separator. Simple decorative icons are native View geometry in AppIcon, excluded from accessibility traversal.

## Components

### Identity and navigation

A purple Aira wordmark with three apricot rays provides identity. Bottom tabs expose native tab roles and selected states. Internal mode keys and workflows remain unchanged; reports stay in Tindahan and debt tools in Benta.

### Capture and correction

Search has a visible search icon and labeled clear control. "I-edit ang hinahanap" focuses the input. Speech preparation truthfully says "Ihanda ang boses"; ready capture says "Magsalita — hawakan". The existing accessible start/stop action complements hold capture.

Recording/transcribing status, cancel, retry, permission recovery, partial transcript, editable review, explicit confirmation, and discard remain available. Compact presentation is used only on price lookup; catalog and sales retain the fuller speech panel.

### Lookup answer and uncertainty

The lilac answer panel contains actual product identity, variant/unit, formatted price, apricot "Nahanap sa paninda" tag, and variant/size reminder. Its decorative marker is not a draggable sheet handle. Loading, error/retry, ambiguity choices, unknown, and empty states remain functional.

### Review and financial controls

Routine actions use purple/white; speech uses apricot/purple; secondary controls use pale surfaces. Confirmation, pending-payment states, stock-change distinctions, and recoverable errors stay explicit. The theme changes presentation without changing database, money, speech-session, or transaction logic.

## Do's and Don'ts

### Do:

- Use shared theme roles across existing workflows.
- Keep product identity and price readable together.
- Preserve speech correction, owner review, and useful failures.
- Verify native layout and accessibility before claiming device acceptance.

### Don't:

- Restore the redundant top Offline badge.
- Insert synthetic mockup products or prices into the store.
- Rasterize live controls or hide uncertainty to imitate the successful sample.
- Treat bundle export or documentation previews as native visual verification.
