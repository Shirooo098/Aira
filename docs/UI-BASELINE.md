---
name: Aira — current UI baseline
description: Source-derived record before the price-lookup redesign
colors:
  primary: "#0369a1"
  primary-surface: "#f0f9ff"
  primary-outline: "#bae6fd"
  background: "#f8fafc"
  surface: "#ffffff"
  muted-surface: "#f1f5f9"
  ink: "#0f172a"
  body: "#334155"
  secondary-text: "#475569"
  muted-text: "#64748b"
  outline: "#cbd5e1"
  divider: "#e2e8f0"
  success: "#047857"
  lookup-success: "#15803d"
  success-surface: "#f0fdf4"
  warning: "#92400e"
  warning-surface: "#fffbeb"
  error: "#b91c1c"
  error-surface: "#fef2f2"
typography:
  screen-title:
    fontSize: "22px"
    fontWeight: 800
  section-title:
    fontSize: "18px"
    fontWeight: 800
  body:
    fontSize: "14px"
    lineHeight: "20px"
  action:
    fontSize: "15px"
    fontWeight: 800
  caption:
    fontSize: "12px"
  lookup-price:
    fontSize: "32px"
    fontWeight: 900
rounded:
  control: "8px"
  action: "10px"
  card: "12px"
  review: "16px"
spacing:
  small: "8px"
  group: "12px"
  gutter: "16px"
  large: "20px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    typography: "{typography.action}"
    rounded: "{rounded.action}"
    padding: "11px 16px"
  button-secondary:
    backgroundColor: "{colors.primary-surface}"
    textColor: "#075985"
    rounded: "{rounded.action}"
    padding: "10px 16px"
  input:
    backgroundColor: "{colors.background}"
    textColor: "#1e293b"
    rounded: "{rounded.control}"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.card}"
    padding: "16px"
---

# Design System: Aira — current UI baseline

## Overview

**Creative North Star: "The Helpful Companion"**

The owner should feel helped by familiar Filipino language, clear answers, and controls that invite correction. The user chose this description on 2026-10-10 and asked for a warmer, less formal redesign.

This document records the existing light UI, not the proposed replacement. The implementation currently uses blue actions, cool slate backgrounds, rounded white cards, and substantial bold text. The user considers that UI to lack a clear theme; preserving these values is not a redesign requirement.

**Key Characteristics:**

- Filipino-first labels, with English supporting labels on the main mode selector.
- Visible offline identity and editable speech transcripts.
- Card-based forms, lists, summaries, and explicit review actions.
- Large monetary answers relative to supporting product details.

Evidence: current App.tsx and src/ui working-tree files on 2026-10-10, based on commit 545d06968459eaee6f3919d9aa2b2ca1454f3ed7 with uncommitted UI polish present. No connected Android device or screenshot fixtures were available. This is source evidence, not a rendered accessibility or hardware certification.

The frontmatter follows the [DESIGN.md format](https://raw.githubusercontent.com/google-labs-code/design.md/main/docs/spec.md). Its px dimensions serialize observed React Native numeric values for portable tooling; layout values are native density-independent units and text follows React Native font scaling. They are not fixed physical screen pixels. No shared runtime token module exists; these names organize repeated literal values.

## Colors

The incumbent palette is cool and functional, with semantic green, amber, and red feedback.

### Primary

- **Clear Blue** (`primary`): primary buttons, active mode, selected filters, sale totals, and highlighted prices.
- **Pale Sky** (`primary-surface`): transcript proposals, selection states, and secondary actions.
- **Sky Outline** (`primary-outline`): speech panels and informational card borders.

### Secondary

- **Deep Green** (`success`): stock availability, change, and offline status.
- **Lookup Green** (`lookup-success`): successful lookup prices and success messages.
- **Soft Green** (`success-surface`): lookup result and saved-state feedback.

### Neutral

- **Cool Ground** (`background`): app canvas and inset form summaries.
- **White Surface** (`surface`): headers, cards, and dialogs.
- **Quiet Slate** (`muted-surface`): secondary controls.
- **Ink / Body / Secondary / Muted**: descending text emphasis.
- **Outline / Divider**: input boundaries and row separators.

### Feedback

Amber panels explain unknown products and audio warnings; red marks errors, destructive actions, and some debt balances. Other observed green, orange, and blue shades remain in individual screens; this extraction captures recurring roles rather than every literal.

**The State Clarity Rule.** Pair state colors with text, selection indicators, or symbols. Debt and payment status must remain understandable without color.

## Typography

No custom font family is assigned in App.tsx or src/ui; text inherits the platform default. Android's actual rendered typeface has not been inspected.

The UI favors bold sans-serif headings and monetary values. There is no shared Material type-scale implementation.

- Screen titles: the shared Ask Price, Sell, and Manage styles use the screen-title role.
- Section titles: commonly 17–18 native units and weight 800; modal titles vary from 18–21.
- Body: commonly 14–16, with explicit line heights on explanatory text.
- Captions: commonly 11–13 for variants, units, dates, and helper text.
- Price lookup: the lookup-price role dominates a successful answer.
- Financial summaries: sale total is 18/900; report values use 20/800 or 26/900; they are separate existing roles.

**The Answer First Rule.** Keep the product name, variant, selling unit, and price readable together; an enlarged price must not obscure which product it belongs to.

## Layout

The app wraps content in a SafeAreaProvider and a SafeAreaView covering all four edges. A white identity header sits above the mode selector. The three modes switch the main content slot.

Main screens use a single vertical flow with 16-unit gutters and commonly 40 units of bottom content padding. Cards group capture, review, and confirmation. Rows use flex layout; several financial and report rows wrap.

Common spacing is 8, 12, 16, and 20, with local exceptions such as 14 and 18. This is an observed vocabulary, not a uniformly enforced grid.

Dialogs generally use padded overlays and scrollable content: stock review caps width at 480, repayment/catalog dictation at 520, and modal heights commonly cap at 90–95%. The aged-utang view is a full-screen modal.

No tablet navigation adaptation, width breakpoints, dynamic-color scheme, or dark scheme was found in the scanned UI. Keyboard, system Back, large text, and narrow-width rendering require native verification.

## Elevation & Depth

Everyday screens use flat white surfaces, pale inset areas, and thin borders. Depth mainly belongs to modal overlays.

- Stock and repayment dialogs declare Android elevation 8 and a black shadow with offset (0, 4), opacity 0.15, radius 12.
- Catalog dictation declares elevation 8.
- Receipt review declares elevation 5 and a black shadow with offset (0, 2), opacity 0.25, radius 4.
- Modal backdrops vary: slate-black at 0.55–0.65 alpha, or black at 0.5.

These are existing differences, not a unified shadow system.

## Shapes

Controls commonly use 8–10-unit corners; cards use 12–16. Speech panels use 14; stock and catalog dialogs use 20 and 18 respectively. Circular quantity buttons use 24-unit corners.

Borders commonly measure 1 or 1.5 units. Lookup success uses a stronger 2-unit green outline. Report period chips use 20-unit corners.

## Components

### Navigation

ModeSelector presents three equal-width top tabs: "Alamin ang Presyo" / "Ask Price", "Benta" / "Sell", and "Pamahalaan" / "Manage". Each is at least 64 units tall. The selected tab fills blue with white labels; inactive tabs sit on a gray group background. Tab roles and selected accessibility state are provided. Press opacity is explicitly 0.7.

Reports are reached inside Manage; aging and repayment are reached from Sell. These are not independent root destinations today.

### Buttons

Primary actions use blue fill and white bold text. Secondary actions use slate or pale-blue fill, or text alone. Confirmation buttons are visually prominent.

Many controls declare a minimum height of 48; that is not proof that every touch target passes. Disabled appearance varies between opacity 0.55 and a muted slate fill. Most pressable controls use TouchableOpacity defaults rather than a shared interaction component.

### Inputs

Single-line inputs generally use pale or white surfaces, slate outlines, rounded corners, and 48–54-unit minimum heights. Search and money fields commonly have 12–16 units of horizontal padding. Placeholders use muted slate.

Speech correction is multiline, with a minimum height of 84. Labels, helper text, validation messages, and keyboard types vary by workflow. No shared custom focus ring or focus-state style was found.

### Cards and lookup states

Ordinary cards are white with slate borders. A successful price lookup uses a green panel, bold product name, variant/unit, and large price. Ambiguous products become tappable white choices. Unknown products use an amber explanation panel; no price is fabricated.

### Speech capture and review

A white outlined speech panel contains explanatory copy, recording/transcribing state, a large hold-to-speak control, recognized text, and an editable transcript. Capture, correction, review, cancel, and failure recovery must remain distinct.

### Review dialogs

Aliases, dictated catalog changes, spoken orders, stock changes, receipts, notebooks, and repayments each have their own modal. They show proposed data and explicit owner actions. Existing fade/slide modal motion is platform-provided; a custom reduced-motion policy was not found.

### Reports and debt

Reports use horizontal period chips, compact KPI cards, and ranked product rows. Debt views pair names, balances, age, priority text/symbols, and review/pay controls. Some priority copy remains English; localization is not uniform.

## Do's and Don'ts

### Do:

- Do retain Filipino-first task language and editable speech input.
- Do make product identity, variant, unit, and money visible at review.
- Do keep explicit confirmation and visible pending/error states.
- Do preserve safe areas, accessible names, and selected/disabled semantics when replacing controls.
- Do validate the replacement on Android with large text and TalkBack.

### Don't:

- Don't treat this baseline palette as an approved replacement theme.
- Don't hide ambiguity, unknown products, missing history, or payment uncertainty.
- Don't make audio or color the only indication of mode or state.
- Don't replace owner review with automatic saves.
- Don't claim dark theme, tablet support, or device acceptance from these source observations.
