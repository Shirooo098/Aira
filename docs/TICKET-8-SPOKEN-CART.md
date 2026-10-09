# Ticket #8 — spoken orders and cart corrections

Sell offers a reviewed spoken/typed order flow. Bundled Whisper supplies an editable transcript; the bounded local parser proposes cart items or a correction. The owner must explicitly apply the proposal to the visible cart. Voice input cannot submit cash, GCash, or credit transactions.

## Owner workflow

1. Open Benta and choose **Idikta ang order / itama ang dami**.
2. Speak using the existing speech control in an Aira Android build, correct the transcript, and explicitly use it. In Expo Go, type a transcript instead.
3. Review every product, variant, selling unit, and quantity. Exact saved names and approved aliases resolve through the shared catalog action. Partial matches require a product selection, even when there is only one candidate.
4. Select products for ambiguous/unknown queries and enter missing quantities. Unknown phrases are never silently mapped to a catalog item. The entire command must be resolved before anything is applied.
5. Apply the proposed change to the cart. No stock, sale, credit, or payment record is saved by this operation.
6. Review the cart and the refreshed checkout total, enter cash received, then use the existing cash confirmation button to save intentionally.

Example transcripts (use identities or aliases present in your catalog):

```text
Pabili ng dalawang Coke maliit at tatlong Lucky Me chicken
isa lang pala
gawing isa ang Coke maliit
tanggalin ang Coke maliit
```

`isa lang pala` replaces a quantity; it does not decrement it. With one cart line, that line is the target. With multiple lines, the owner must select the target. The app does not guess the last-mentioned product. An explicit remove command is distinct from a positive quantity correction.

This is a bounded command format. Unsupported wording, negative/fractional/unsafe counts, unknown items, and missing quantities require clarification or transcript correction. Quantities never default to one. Product sizes such as 1.5 L must remain part of product identity rather than becoming a purchase quantity.

## Interruption and resume policy

- Closing the order dialog discards an unapplied proposal and keeps the existing Sell cart.
- Editing/discarding the transcript or beginning a new capture invalidates the previous proposal. Late lookup/transcription results cannot restore it.
- Backgrounding cancels speech and invalidates the pending proposal; the existing in-memory Sell cart remains while the view is mounted. Re-enter and review the interrupted command.
- Changing app mode unmounts Sell and discards its unsaved cart and speech state. There is no automatic resume or persistence of a cash cart across mode changes or app restart. Existing saved pending GCash drafts retain their separate behavior.
- Audio confirmation and mode changes never finalize the sale. An owner-button transaction already submitted may finish; navigation is not a transaction rollback.

## Integration and verification

No model server, cloud fallback, new dependency, or schema migration is introduced. Prices and financial arithmetic remain catalog-authoritative integer centavos. The existing transaction actions revalidate products, price, stock, and tender and commit inventory/sales atomically. Checkout previews are tied to the current cart/payment inputs so stale totals cannot enable submission during recalculation.

Run:

```powershell
npm run typecheck
npm test
npx expo export --platform android
```

Automated checks cover parser boundaries, catalog/alias collisions, explicit product selection, missing quantities, multi-item merge, contextual target selection, removal, read-only proposal/apply, interruption/stale results, and final cash confirmation through real SQLite.

Desktop verification on 2026-10-10: TypeScript passed, all 190 tests passed (14 cover the new spoken order/session flow), and `git diff --check` passed. Independent code review found no material issues. Android export could not finish: the merged project's declared `expo-image-picker` package is absent from local `node_modules`. Dependency installation was declined; run `npm ci` and retry the export when installation is permitted. No physical-device acceptance is claimed.

## Phone acceptance — pending actual execution

Use Expo Go for the typed path. Use [the native speech build](SPEECH-INTEGRATION.md) for actual microphone/Whisper tests and a standalone release APK for airplane-mode acceptance.

- [ ] Seed two product variants, approved aliases, known integer prices, and stock counts.
- [ ] Submit a multi-item order and verify exact identities, quantities, price totals, and no writes before cash confirmation.
- [ ] Omit a quantity; verify clarification instead of a default of one.
- [ ] Use an unknown phrase, a partial name, and a shared alias; verify explicit choices and no guessed mapping.
- [ ] Correct a one-item cart with `isa lang pala`; verify replacement rather than decrement.
- [ ] Correct a multi-item cart; verify target selection is required and other lines remain unchanged.
- [ ] Remove a named item; verify removal only after explicit apply.
- [ ] Cancel/edit/switch modes during a delayed speech result; verify no stale proposal or sale appears.
- [ ] Change the cart while a checkout preview is loading; verify stale totals cannot enable checkout.
- [ ] Apply twice rapidly; verify the command is applied once.
- [ ] Enter cash, confirm with the existing button, and verify saved sale snapshots, change, and one stock deduction.
- [ ] Repeat on the actual Oppo offline; record model/build, revision, OS, observed errors and speech timing.

No desktop test proves rendered native UI, microphone accuracy, latency, model memory, or standalone offline behavior. Record those results before declaring hardware acceptance complete.
