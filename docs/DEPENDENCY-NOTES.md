# Foundation dependency notes

2026-10-10 [USER] The Expo SDK 57 foundation stack was approved before installation. Exact resolved versions are captured in package-lock.json; use `npm ci` for reproducible installs.

## Maintenance and licenses

2026-10-10 [TOOL] Expo's bundledNativeModules.json selects React 19.2.3, React Native 0.86.3, expo-sqlite ~57.0.4, expo-audio ~57.0.5, expo-dev-client ~57.0.19 and react-native-safe-area-context ~5.7.0. Upgrade the compatible set together and rebuild/retest native integrations.

2026-10-10 [TOOL] Direct framework/audio/SQLite/dev-client/safe-area/React packages and React/Node type definitions report MIT licenses; TypeScript reports Apache-2.0. This is package metadata verification, not an exhaustive transitive-license audit.

## Known npm advisories

2026-10-10 [TOOL] Initial `npm audit --omit=dev --json` reports 22 affected-package entries (15 high, 7 moderate), propagated from three underlying advisories. Expo includes build tooling beneath production dependencies, so this command also includes development/build tools:

| Dependency path | Advisory | Current disposition |
| --- | --- | --- |
| Expo → Metro → micromatch → braces 3.0.3 | [Nested-pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Latest registry version is affected; no patched version listed. Avoid untrusted build configuration/glob patterns. |
| Expo CLI/code-signing-certificates → node-forge 1.4.0 | [RSA verification parsing](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Latest registry version is affected. This app does not configure OTA/code-signing services; re-evaluate before adding them. |
| Expo config-plugins → xcode → uuid 7.0.3 | [Buffer bounds in v3/v5/v6](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | iOS project tooling path; Android-only foundation. A forced major override is not a verified compatible fix. |

2026-10-10 [TOOL] npm's suggested automatic changes include downgrading Expo to 44 and React Native to 0.72. Those do not preserve the approved SDK 57 compatibility and were not applied. Recheck upstream fixes before release. The dependency tree is not audit-clean.

2026-10-10 [ASSUMPTION] Observed paths indicate build-tool exposure rather than catalog input handling. This is not a proof that every shipped native/transitive dependency is vulnerability-free. Keep Metro local, do not feed untrusted project configuration into the build, and use a standalone release for offline acceptance.
