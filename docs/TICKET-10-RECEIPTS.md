# Ticket #10 — receipt evidence

2026-10-10. Branch: `feat/#10-gcash-receipt-ocr`. Merged current main `312a820` to combine the native dependency/build fix with the receipt UI/persistence implementation already delivered through PR #33. Device OCR and standalone offline acceptance remain separate from implementation and build results.

## Implemented first slice

- `src/domain/receipt.ts`: conservative labeled OCR-text proposals for amount, reference, sender name and sender mobile. Missing/conflicting fields remain empty; masks and source text are retained. Amounts use integer-centavo parsing, with strict thousands grouping. Fees, balances, recipients and unlabeled names are not inferred as sent amounts or sender identity.
- `src/actions/receipt-actions.ts`: read-only review against existing pending or confirmed GCash sales. Compare the amount; flag matching references on other GCash sales and credit repayments, including cancelled/reversed history. A flag is not fraud detection or proof of payment. The action performs no writes.
- A full #9 GCash sale can have `paid_centavos=0` from migration defaults: compare full sales with total, and partial-credit sales with their paid amount. Cancelled records preserve evidence/history.
- Tests exercise proposal ambiguity, masked data, invalid amounts, recipient distinction, pending-state/stock preservation, mismatches and duplicate references against real SQLite.

## Native dependencies — resolved 2026-10-10

The user requested fixing #10's missing dependencies. Main was pulled to `22eefd6` and this branch fast-forwarded to it before the fix. This request authorizes the dependency installation. The earlier approval-pending proposal below is superseded by the installed stack.

| Dependency | Purpose and tradeoff |
|---|---|
| `@react-native-ml-kit/text-recognition` (pinned 2.0.0, MIT) | Published React Native wrapper; installed Gradle declares bundled Latin `com.google.mlkit:text-recognition:16.0.1`. Its Java imports also require bundled Chinese, Devanagari, Japanese and Korean libraries, increasing APK size. Receipt extraction will use Latin. |
| `expo-image-picker` (~57.0.20, MIT) | SDK-compatible camera/photo selection. Config plugin supplies camera/photo descriptions and Android explicitly declares CAMERA. Existing RECORD_AUDIO is retained for speech: setting microphonePermission false in this plugin globally blocks that permission and breaks speech. Receipt UI must request image media only. |
| `expo-file-system` (~57.0.7, MIT) | SDK-compatible persistent private image storage; picker cache URIs alone are not durable evidence. |

The original Infinite Red 6.0.0 source candidate is not published to npm. Its published wrapper 5.0.1/core 3.1.0 references the removed ExpoModulesCorePlugin.gradle and introduces incompatible test-library peers. It was removed; neither package remains in the final dependency graph.

`scripts/prepare-receipt-ocr.cjs` runs after npm installation and before `npm run receipt:prebuild`: it guards the pinned wrapper version and bundled Latin dependency, adds the Android namespace, removes the old manifest package attribute and replaces dynamic react-native:+ with react-android. The four other script dependencies are retained because the native Java source imports them. No framework upgrades or cloud fallback were added.

Use `npm ci`, `npm run receipt:prebuild`, then `npm run android` and `npm run receipt:start`. Expo Go does not contain this native OCR module; installing JavaScript packages does not add it to an existing APK. Rebuild the development/release app. A fresh-install offline OCR/device check is still required.

Dependency installation, `npm ls` for the three direct packages, TypeScript, 162/162 tests and Android prebuild pass. Expo's version check used its local SDK map because networking was disabled. npm reports 22 advisories (7 moderate, 15 high), the same count as the initial dependency tree; no force upgrade was applied. Native APK compilation and actual OCR accuracy are tracked separately.

Final Android autolinking detects `com.rnmlkit.textrecognition.TextRecognitionPackage`; regenerated manifest retains both CAMERA and RECORD_AUDIO. Patch repeat-run checks and lockfile consistency pass. Initial build attempts stalled or failed on Whisper's uncached AGP 7.2.1 tree. That blocker is resolved by the follow-up configuration below; production OCR remains required to run without network.

### Follow-up build configuration

The setup script now guards Whisper 0.7.4 and restricts its AGP 7.2.1 buildscript to standalone library builds. When integrated with Aira, Whisper inherits the host's Android Gradle plugin instead of resolving a second, older plugin tree. This keeps Expo/RN/Whisper versions unchanged and is reapplied by npm postinstall and receipt:prebuild. Repeat-run checks pass. The online build progressed past configuration and downloaded the actual OCR/Android Maven artifacts.

To compile for the Oppo's arm64 architecture from PowerShell after prebuild:

```powershell
.\android\gradlew.bat -p android :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --console=plain
```

The debug APK is `android/app/build/outputs/apk/debug/app-debug.apk`. Debug builds use Metro and are not standalone offline release acceptance. Add `--offline` only after the necessary Maven artifacts are cached; it verifies build-cache completeness, not on-device offline OCR quality.

2026-10-10 final results: online arm64 debug APK build **passed** in 9m 38s; the same command with `--offline` **passed** in 17s (367 tasks, 360 up-to-date). Both Whisper and OCR Java/native integration compiled. APK inspection confirmed bundled Latin ML Kit recognizer assets, `libmlkit_google_ocr_pipeline.so`, Whisper native libraries and `assets/models/whisper.bin`.

Prior dependency-fix artifact: 160,853,925 bytes, SHA-256 `57520dc733ee10ac570361cd1b17ebfdadfe02a65828a65670a52ce62bc729b8`. Local ignored diagnostics: `.scratch/ticket-10-native-build.log` and `.scratch/ticket-10-offline-build.log`. These APK results predate the current-main merge and do not verify the newly integrated receipt UI/persistence. Device OCR accuracy and release/airplane-mode behavior remain outstanding.

## Image retention and consistency contract for the next slice

Receipt attachment is explicitly reviewed and saved by the owner. Receipt fields do not overwrite financial amounts/references or confirm payments. Support pending-draft evidence as well as completed sale evidence; preserve the link during draft confirmation and retain evidence after financial cancellation.

1. Capture/import is temporary. A rejected draft never creates financial data or a retained receipt.
2. Copy a reviewed image to a uniquely named file under the app-private receipt directory before inserting its database link. Never store the picker cache URI as the durable attachment.
3. Commit metadata/link atomically. If copying fails, insert nothing. If insertion fails, remove the staged file; cleanup failure must be recoverable.
4. On restart, remove unreferenced staged files after the save process is inactive. Do not delete referenced files during reconciliation. Surface missing referenced images while retaining metadata/history.
5. Keep saved images until explicit attachment removal or app-data deletion/uninstall. Do not auto-delete them on sale cancellation. App-private storage is not a backup; backup/export is outside this ticket.
6. For explicit attachment removal, remove the database link first and then the file. A failed file delete leaves an orphan recoverable on restart. Never delete payment/sale records through receipt removal.
7. Search the reviewed reference and visible sender fields with bound SQL parameters. Do not reconstruct masked phone digits. Preserve source image comparison in the review screen; no retained raw OCR text is needed after confirmed fields are saved unless explicitly required.

The integrated persistence slice uses migration 9 after existing v8 and actual sale/draft IDs; draft-to-sale transfer is documented below.

## Implementation & Verification of Persistence and UI Slice

1. **Schema Migration 9**: Added `receipt_attachments` table storing app-private file URI, integer centavo amounts, reference number, sender name, sender mobile, raw OCR text, and created timestamp, with indices on `(target_kind, target_id)`, `reference_number`, and `created_at`.
2. **Action Layer**: Added `attachReceipt`, `getReceiptAttachment`, `getReceiptAttachmentById`, `searchReceiptAttachments`, `deleteReceiptAttachment`, and `transferDraftReceiptToSale` in `src/actions/receipt-actions.ts`.
3. **Atomic Draft Transfer**: When `confirmGcashSale` is called with `draftId`, any receipt attached to the draft is automatically transferred to the confirmed sale in the same database transaction.
4. **Owner Review UI**: Implemented `ReceiptReviewModal.tsx` displaying editable extracted fields (Amount, Reference, Sender Name, Mobile), amount mismatch warnings against expected GCash total, and duplicate reference alerts against local payment history. Integrated into `SellView.tsx` on pending drafts and recent GCash sales.
5. **Automated Tests**: Added `tests/receipt-persistence.test.ts` exercising draft attachment, draft-to-sale transfer upon confirmation, direct sale attachment, multi-field search (normalized reference, name, mobile), non-destructive deletion, and real SQLite file restart persistence.
6. **Integrity**: 171/171 automated tests passing (`npm test`), `npm run typecheck` passes with 0 errors, and `npx expo export --platform android` bundles cleanly (689 modules).

## Sources

- [Ticket #10](https://github.com/Shirooo098/Aira/issues/10).
- [Installed alternative wrapper upstream Android build](https://github.com/a7medev/react-native-ml-kit/blob/main/text-recognition/android/build.gradle); installed 2.0.0 artifact was inspected directly and patched as described above.
- [Wrapper Android Gradle declaration](https://github.com/infinitered/react-native-mlkit/blob/main/modules/react-native-mlkit-text-recognition/android/build.gradle).
- [Wrapper package metadata](https://github.com/infinitered/react-native-mlkit/blob/main/modules/react-native-mlkit-text-recognition/package.json).
- [Google bundled/unbundled recognition options](https://developers.google.com/ml-kit/vision/text-recognition/v2/android).
- [Expo SDK 57 image picker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/).
- [Expo file system](https://docs.expo.dev/versions/latest/sdk/filesystem/).
