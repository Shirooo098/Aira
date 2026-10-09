# Aira

Artificial Intelligence for Retail Assistance — an offline, Filipino-speaking Android store assistant.

Framework: Expo with React Native and TypeScript. Development and phone testing: Expo Go.

This foundation implements ticket #1: owner-reviewed catalog entry and typed price lookup. Sales, stock, aliases, speech, OCR and utang belong to later tickets. The Sell mode is visible but does not process transactions.

## Test on the phone with Expo Go

Expo Go is our primary testing workflow for the ticket #1 catalog foundation. Install an Expo Go version compatible with this project's Expo SDK 57 on the Oppo, connect the phone and computer to the same Wi-Fi network, and run:

```text
npm ci
npx expo start --go --lan
# Or if your Wi-Fi has client isolation / firewall blocks:
npm run start:tunnel
```

Scan the terminal QR code inside the Expo Go app (do not scan using the default Android camera app, which opens a browser). Test product review/save, typed lookup, ambiguity choices, mode cues and reopening the catalog. Keep Metro running for this development workflow. USB debugging and a local Android SDK are not required for Expo Go testing.

Expo Go includes the SQLite and audio modules used by this slice. Custom speech/OCR native modules in later tickets may require an Expo development build. Standalone airplane-mode acceptance still uses the release APK checklist below.

## Automated checks and native builds

Use Node 22.14 or a compatible newer version. After `npm ci`, run:

```text
npm run typecheck
npm test
npx expo export --platform android
```

Node's SQLite API is used for real database tests; its experimental warning on Node 22 is expected. The phone uses Expo SQLite.

With a compatible Android SDK/JDK installed and a USB-debugging device or emulator connected:

```text
npm run android
npm start
```

For offline acceptance, build and install a release APK:

```text
npx expo run:android --variant release
```

A development build connected to Metro is not evidence of standalone offline operation. Follow [the Oppo acceptance checklist](docs/ANDROID-ACCEPTANCE.md) and retain results before closing #1.

## Constraints

- Persist prices as integer centavos; catalog lookups never infer prices.
- Review and explicitly confirm product changes. Navigation does not save records.
- Keep core behavior and bundled cues available without network access.
- Coordinate later migrations through D3; preserve existing IDs and catalog data.
- Each sellable variant/unit has its own product identity. Initial quantities mean whole selling units, with no automatic unit conversion or stock accounting in this slice.

See [the specification](TINDIG-SPEC.md), [ticket plan](.scratch/tindig/TICKET-PLAN.md), and [approved dependency direction](D4-FOUNDATION-PROPOSAL.md).
