# Aira

Artificial Intelligence for Retail Assistance — an offline, Filipino-speaking Android store assistant.

Framework: Expo with React Native and TypeScript. Development and phone testing: Expo Go.

The app includes catalog and typed price lookup (#1), owner-confirmed aliases (#3), inventory (#4), cash and GCash sales (#7/#9), and customer credit and repayments (#11/#12). For aliases, open Pamahalaan, tap Bansag on a product, review the exact variant/unit, and explicitly confirm. Approved nicknames work in Alamin ang Presyo; conflicting mappings show product choices.

See [the alias workflow and acceptance checklist](docs/TICKET-3-ALIASES.md). Alias behavior does not require Qwen or a desktop model server.

Ticket #6 adds **Idikta ang pagbabago** in Pamahalaan: edit a spoken or typed transcript, correct the proposed fields, review the exact product and change, then explicitly confirm. New product, price update, count correction, and delivery stay separate. See [dictated catalog workflow and phone checks](docs/TICKET-6-DICTATED-CATALOG.md).

Ticket #2 adds offline push-to-talk and an editable transcript through a native Android build. Follow [speech build instructions](docs/SPEECH-INTEGRATION.md) and the [Oppo benchmark checklist](docs/SPEECH-BENCHMARK.md). Expo Go supports catalog and alias testing; Whisper needs an Android development build.

Ticket #5 connects explicitly reviewed Filipino price questions to the catalog and confirmed aliases. The screen shows the reviewed question and extracted product phrase; partial matches and conflicting identities require a product choice before a price appears. See [supported voice commands and pending device acceptance](docs/TICKET-5-VOICE-PRICE.md).

Ticket #8 adds **Idikta ang order / itama ang dami** in Sell. Review spoken or typed orders, choose unresolved products and quantities, and apply the proposed cart change. Checkout remains a separate confirmation. See [spoken cart examples, interruption rules, and phone checks](docs/TICKET-8-SPOKEN-CART.md).

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
