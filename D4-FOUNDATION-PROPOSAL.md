# D4 foundation proposal — ticket #1

2026-10-10 [TOOL] Local and GitHub inventories contain documentation only. All 20 issues are open; no merged PRs were returned. Ticket #1 has no blockers. D4 tickets #10, #14, #15, #19 and #20 must wait for their specified dependencies to merge into main.

## Approved dependency direction

2026-10-10 [USER] Approved this dependency stack with "yes do implement". Exact compatible versions and verification results will be recorded after implementation.

| Dependency | Need and tradeoff |
| --- | --- |
| Expo SDK 57 with its compatible React/React Native versions | Expo Go for foundation testing, development builds for later custom native modules, and a release APK for offline acceptance; upgrades follow Expo's compatibility matrix. |
| TypeScript and React type definitions | Type checking for the selected React Native platform; development only. |
| expo-sqlite | App-private persistent catalog; native build dependency, parameterized SQL, explicit migrations. |
| expo-audio | Bundled short mode cues; adds native audio lifecycle work. Playback only for #1, without microphone permission. |
| expo-dev-client | Development integration for later native modules; release acceptance must use a standalone APK without Metro. |
| react-native-safe-area-context | Keep controls clear of Android system bars; native dependency aligned with Expo. |

2026-10-10 [TOOL] npm reports MIT licenses for expo, react-native, expo-sqlite and expo-audio. Remaining direct-package licenses, transitive licenses and advisories must be checked when resolving the lockfile. No claim of an audited dependency tree is made.

2026-10-10 [ASSUMPTION] Security/operations: dependencies and Android build tools need network access during development; installed core behavior must remain offline. Use bound SQL parameters, no cloud persistence or runtime downloads, and bundled audio. SQLite is not encrypted by default; Android app-private storage is the initial catalog boundary. Package upgrades require native rebuild and regression checks. Future receipt/customer privacy requirements need separate review.

2026-10-10 [TOOL] Registry candidate versions: expo 57.0.27, expo-sqlite 57.0.4, expo-audio 57.0.5. Resolve React Native and remaining packages through Expo compatibility rather than independently selecting their latest versions. Node 22.14.0 and Java 21 are available; adb is not on PATH. Android SDK and compatible Node/JDK requirements remain UNCONFIRMED.

## Implementation scope after approval

2026-10-10 [USER] Expo Go is the primary phone test workflow for ticket #1. See README.md for the command and setup. This supersedes requiring a local native build for initial functional testing; standalone offline acceptance remains separate.

2026-10-10 [ASSUMPTION] Create branch feat/#1-offline-catalog, preserving pre-existing documentation edits. Add the app entrypoint/configuration, accessible mode navigation, reviewed product entry, typed lookup and ambiguity choices, bundled cues, catalog application actions, initial SQLite migration, tests and Android acceptance instructions. Sell mode visibly identifies that checkout arrives in ticket #7.

2026-10-10 [ASSUMPTION] Initial product contract for D3 coordination: stable ID, name, variant, selling-unit label and nonnegative safe-integer centavo price. Parse decimal price text into centavos without floating-point currency arithmetic. Each variant/unit combination is a distinct sellable product. For this slice quantities are whole selling units, with no conversion between bottle/pack/piece and no stock writes; fractional-unit requirements must be settled before #4.

2026-10-10 [ASSUMPTION] Tests: confirmed save and reopen against real temporary SQLite, price preservation, invalid inputs, unknown/ambiguous lookup and navigation without writes. Use Node's test runner and built-in SQLite where compatible to avoid a separate database test dependency; compile tests with TypeScript. Run focused checks during implementation, full suite once at completion, and independent review of migration/public contracts.

2026-10-10 [ASSUMPTION] Device acceptance remains required: standalone APK on Oppo Reno6 Z 5G, airplane mode and Wi-Fi disabled, save/restart/lookup, accessible ambiguity selection and mode cues. Desktop tests cannot establish this result.

## Sources

- [Ticket #1](https://github.com/Shirooo098/Aira/issues/1)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)

2026-10-10 [USER] Repository instructions require approval before adding material dependencies and prohibit commits/pushes without a separate request; these override the implement skill's default commit step.
