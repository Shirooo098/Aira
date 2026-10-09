# Ticket #1: Android offline acceptance

Status: NOT RUN on the Oppo. Desktop checks do not satisfy this checklist.

For everyday foundation testing, use [Expo Go](../README.md#test-on-the-phone-with-expo-go). Run the catalog, mode and review checks there first; record those as Expo Go results. The standalone offline checklist below remains the final device acceptance path.

## Build prerequisites

Use the Node version supported by the pinned React Native release, its compatible JDK, and the Android SDK/platform/build-tools selected by the generated Gradle project. Enable USB debugging on the Oppo Reno6 Z 5G and verify that `adb devices` lists it as authorized.

The development build uses Metro during development. For offline acceptance, build a standalone release APK with its JavaScript and three audio cues bundled, install it, and stop Metro. Do not uninstall an existing store installation to work around a migration error; that can delete its local data.

## On-device checklist

Record the tested Git revision (or exact uncommitted patch), APK hash, phone model, Android version, build commands and results. Mark each item pass/fail with observed evidence.

1. Launch the standalone APK with airplane mode enabled and Wi-Fi disabled. It must not need a server or asset/model download.
2. Confirm Ask price, Sell and Manage products modes are readable and reachable. Switch between them; each mode has a distinct short cue and a visible selected state. Check again with audio muted: all tasks remain usable.
3. Enter `Coke`, variant `250 ml`, unit `bottle`, price `15.50`. Review the complete product before confirming. Cancel a different draft and verify that it was not saved.
4. Search for the saved product and verify exactly `₱15.50`. Search for an unknown product and verify explicit missing-product feedback.
5. Add a second Coke variant. Search `Coke` and verify accessible choices show variant, unit and price; select the intended variant.
6. Force-stop and reopen the app while still offline. Repeat the lookup and confirm the saved identity and price persist.
7. Try blank required fields, negative prices, more than two decimal places, and duplicate product identity. Confirm clear validation and no accidental write.
8. Switch through all three modes and repeat the lookup. Mode switches must not change prices or create catalog/transaction records. Sell must clearly disclose that checkout is not available in this foundation slice.
9. Use TalkBack and large text. Verify field labels, focusable choices, selected-mode announcements, reachable review/save controls and readable errors. Check the keyboard does not hide required controls.
10. Inspect Android permissions: no microphone/camera permission is needed for ticket #1. Document cue playback failures and database initialization/save errors if observed; never report an unsuccessful save as successful.

## Evidence record

- Date/operator: pending
- Revision/patch and APK SHA-256: pending
- Device/Android: pending
- Build and install: pending
- Airplane mode and Wi-Fi disabled: pending
- Persistence and lookup: pending
- Review/cancel/validation: pending
- Cues, TalkBack, large text and keyboard: pending
- Failures and follow-up: pending

2026-10-10 [TOOL] Initial development environment: Node 22.14.0, npm 10.9.2, JDK 17 and 21 installed. `adb` is not on PATH; configured Android SDK directory does not exist. No native build or device pass is implied.
