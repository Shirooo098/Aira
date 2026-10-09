# Ticket #6 — dictate and review catalog changes

The Manage screen offers **Idikta ang pagbabago**. Bundled Whisper supplies an editable transcript; a bounded, local parser proposes catalog fields. Neither recognition nor extraction saves anything. There is no Qwen server, cloud fallback, runtime model download, or new migration in this slice.

## Owner workflow

1. Open Pamahalaan → Idikta ang pagbabago.
2. Select new product, price update, set count, or delivery.
3. Dictate using the speech control in the Android development build, correct the transcript, and explicitly use it. Alternatively type the transcript and extract the fields in Expo Go.
4. Correct the extracted fields. Select the exact catalog identity for an existing product. Unknown and ambiguous products require correction or an explicit selection.
5. Review the structured proposal: name, variant, selling unit, and the applicable price/count change.
6. Tap confirmation, or use the separate confirmation speech control and say **kumpirmahin**. Review the confirmation transcript before applying it. Confirmation phrases mixed with another command are rejected.

For the ticket example `Lucky Me chicken, 15 pesos, 10 pieces`, the parser proposes that name, price 1500 centavos, quantity 10, and unit piraso. It does not guess the product/variant boundary. The owner must fill the variant and correct the name (for example Lucky Me / chicken) before review. A labeled form such as `Lucky Me, variant chicken, 15 pesos, 10 pieces` makes that boundary explicit.

Examples for existing products (use a catalog name/variant or an approved alias):

```text
presyo ng coke maliit, 18 pesos
itakda ang bilang ng coke maliit, 12 pieces
dagdag delivery ng coke maliit, 5 pieces
```

The parser supports a bounded command format. Unsupported wording, malformed values, and missing fields require owner correction; they are not guessed. Switching the selected intent discards its previous field review. Editing the original transcript or fields also invalidates review. Closing the dialog or changing app mode discards an unconfirmed draft and cancels speech. A write explicitly authorized before navigation can finish; navigation itself never starts a save.

## Persistence and safeguards

- Prices are parsed with the existing integer-centavo utilities.
- New products require a variant, unit, price, and initial whole-unit count; product and initial count save atomically.
- Duplicate product identities are rejected, with an explicit choice of update/count/delivery required instead.
- Price updates preserve stock, movement history, and past sale prices.
- Set count replaces the recorded physical count. Delivery increments it and records a distinct movement.
- Confirmation rechecks the reviewed product and relevant stock snapshot. Changed data requires fresh review.
- Failed writes roll back the entire change; the UI shows the error and requires review again before retrying.
- One draft session guards both button and spoken confirmation, preventing duplicate simultaneous saves.

## Verification

Run from the app repository:

```powershell
npm run typecheck
npm test
npx expo export --platform android
```

The automated tests use real SQLite for read-only preparation, duplicate/invalid/stale inputs, price-only preservation, atomic initial count, rollback, and persistence. Session tests cover confirmation scope, edits, cancellation/mode disposal, late preparation, and simultaneous confirmation.

Verified on 2026-10-10: TypeScript passed, all 120 app tests passed, Android Hermes export passed, and independent review found no remaining material issues. No rendered phone UI, native APK build, speech accuracy, or airplane-mode result is claimed by these desktop checks.

Integration with main's tickets #5 and #13 was subsequently verified: TypeScript, all 141 tests, and Android export passed. The shared speech input uses the reviewed-transcript and invalidation callbacks for both price lookup and catalog dictation. Native speech and offline phone acceptance remain pending.

## Physical-phone acceptance — pending

Use [speech build instructions](SPEECH-INTEGRATION.md) for a development build with the packaged model. Expo Go supports the typed flow but cannot run Whisper. Android export verifies the JavaScript bundle; it does not build an APK or prove native recognition.

- [ ] Dictate the ticket example, correct Lucky Me / chicken, review 15 pesos and 10 piraso, then confirm.
- [ ] Leave variant, unit, or quantity blank; confirm that the app requires clarification.
- [ ] Review a product and cancel or switch mode; verify that no product or movement was saved.
- [ ] Edit fields or the original transcript after review; verify that another review is required.
- [ ] Speak confirmation without an active review or mix confirmation with another command; verify that nothing is saved.
- [ ] Confirm a duplicate product; verify it is rejected rather than silently updating stock.
- [ ] Change only price; verify the stock and historic sale amounts remain unchanged.
- [ ] Set a count, then add a delivery; verify different previews and movement history.
- [ ] Confirm twice rapidly; verify one write.
- [ ] Force-stop and reopen; verify saved product/count/price persists.
- [ ] Test keyboard, large text, TalkBack, microphone denial, retry, and switching modes during transcription.
- [ ] Repeat speech, confirmation, and restart in a release APK with airplane mode on, Wi-Fi off, and Metro stopped.

Record commit, device/OS, model/build, observed results, and any timing measurements. Do not close the ticket or claim device acceptance from desktop tests alone.
