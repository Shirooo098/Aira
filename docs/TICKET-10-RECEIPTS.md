# Ticket #10 — receipt evidence

2026-10-10. Branch: `feat/#10-gcash-receipt-ocr`, based on main `4c02e62`. Main contains #9 via merge `f6709a1` and subsequent ledger/reversal work. This is an in-progress slice, not completed OCR support.

## Implemented first slice

- `src/domain/receipt.ts`: conservative labeled OCR-text proposals for amount, reference, sender name and sender mobile. Missing/conflicting fields remain empty; masks and source text are retained. Amounts use integer-centavo parsing, with strict thousands grouping. Fees, balances, recipients and unlabeled names are not inferred as sent amounts or sender identity.
- `src/actions/receipt-actions.ts`: read-only review against existing pending or confirmed GCash sales. Compare the amount; flag matching references on other GCash sales and credit repayments, including cancelled/reversed history. A flag is not fraud detection or proof of payment. The action performs no writes.
- A full #9 GCash sale can have `paid_centavos=0` from migration defaults: compare full sales with total, and partial-credit sales with their paid amount. Cancelled records preserve evidence/history.
- Tests exercise proposal ambiguity, masked data, invalid amounts, recipient distinction, pending-state/stock preservation, mismatches and duplicate references against real SQLite.

## Native dependency proposal — approval pending

The existing dependency policy is recorded in D4-FOUNDATION-PROPOSAL.md: "Repository instructions require approval before adding material dependencies". No new dependencies have been installed for this slice.

| Dependency | Purpose and tradeoff |
|---|---|
| `@infinitered/react-native-mlkit-text-recognition` (source candidate 6.0.0, with matching core) | Expo module wrapping local OCR. Upstream Gradle declares bundled Latin `com.google.mlkit:text-recognition:16.0.1`. Adds native build/size and compatibility work; cannot run in Expo Go. Verify the published package's Gradle file and Expo 57 build compatibility before claiming bundled readiness. |
| `expo-image-picker` (SDK 57 compatible version) | Camera and system photo selection. Request camera permission only for capture; cancel/denial must be recoverable. Disable microphone permission for this plugin. |
| `expo-file-system` (SDK 57 compatible version) | Copy selected images into app-private persistent storage and clean staged images. Adds a direct dependency; cache picker URIs are not durable receipt evidence. |

Use Expo's compatibility resolution for Expo packages; pin the OCR wrapper/core after checking the published artifact, licenses and native dependency graph. Keep current framework versions. A development/release build is required. On first fresh install with no network, OCR must work without a model download.

Source inspection supports the proposed choice, not verified Expo 57 compatibility or actual OCR quality. Capture installed versions and license/audit results when dependencies are approved and resolved.

## Image retention and consistency contract for the next slice

Receipt attachment is explicitly reviewed and saved by the owner. Receipt fields do not overwrite financial amounts/references or confirm payments. Support pending-draft evidence as well as completed sale evidence; preserve the link during draft confirmation and retain evidence after financial cancellation.

1. Capture/import is temporary. A rejected draft never creates financial data or a retained receipt.
2. Copy a reviewed image to a uniquely named file under the app-private receipt directory before inserting its database link. Never store the picker cache URI as the durable attachment.
3. Commit metadata/link atomically. If copying fails, insert nothing. If insertion fails, remove the staged file; cleanup failure must be recoverable.
4. On restart, remove unreferenced staged files after the save process is inactive. Do not delete referenced files during reconciliation. Surface missing referenced images while retaining metadata/history.
5. Keep saved images until explicit attachment removal or app-data deletion/uninstall. Do not auto-delete them on sale cancellation. App-private storage is not a backup; backup/export is outside this ticket.
6. For explicit attachment removal, remove the database link first and then the file. A failed file delete leaves an orphan recoverable on restart. Never delete payment/sale records through receipt removal.
7. Search the reviewed reference and visible sender fields with bound SQL parameters. Do not reconstruct masked phone digits. Preserve source image comparison in the review screen; no retained raw OCR text is needed after confirmed fields are saved unless explicitly required.

Schema follow-up through D3 conventions: allocate migration after existing v8, reference actual sale/draft IDs, preserve all previous data, and document draft-to-sale transfer. Do not invent replacement transaction tables.

## Implementation & Verification of Persistence and UI Slice

1. **Schema Migration 9**: Added `receipt_attachments` table storing app-private file URI, integer centavo amounts, reference number, sender name, sender mobile, raw OCR text, and created timestamp, with indices on `(target_kind, target_id)`, `reference_number`, and `created_at`.
2. **Action Layer**: Added `attachReceipt`, `getReceiptAttachment`, `getReceiptAttachmentById`, `searchReceiptAttachments`, `deleteReceiptAttachment`, and `transferDraftReceiptToSale` in `src/actions/receipt-actions.ts`.
3. **Atomic Draft Transfer**: When `confirmGcashSale` is called with `draftId`, any receipt attached to the draft is automatically transferred to the confirmed sale in the same database transaction.
4. **Owner Review UI**: Implemented `ReceiptReviewModal.tsx` displaying editable extracted fields (Amount, Reference, Sender Name, Mobile), amount mismatch warnings against expected GCash total, and duplicate reference alerts against local payment history. Integrated into `SellView.tsx` on pending drafts and recent GCash sales.
5. **Automated Tests**: Added `tests/receipt-persistence.test.ts` exercising draft attachment, draft-to-sale transfer upon confirmation, direct sale attachment, multi-field search (normalized reference, name, mobile), non-destructive deletion, and real SQLite file restart persistence.
6. **Integrity**: 171/171 automated tests passing (`npm test`), `npm run typecheck` passes with 0 errors, and `npx expo export --platform android` bundles cleanly (689 modules).

## Sources

- [Ticket #10](https://github.com/Shirooo098/Aira/issues/10).
- [Wrapper Android Gradle declaration](https://github.com/infinitered/react-native-mlkit/blob/main/modules/react-native-mlkit-text-recognition/android/build.gradle).
- [Wrapper package metadata](https://github.com/infinitered/react-native-mlkit/blob/main/modules/react-native-mlkit-text-recognition/package.json).
- [Google bundled/unbundled recognition options](https://developers.google.com/ml-kit/vision/text-recognition/v2/android).
- [Expo SDK 57 image picker](https://docs.expo.dev/versions/v57.0.0/sdk/imagepicker/).
- [Expo file system](https://docs.expo.dev/versions/latest/sdk/filesystem/).
