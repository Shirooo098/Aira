# Ticket #3 — owner-confirmed aliases

Aliases belong to the saved catalog. They do not require speech recognition or a language model. The app stores each approved nickname against a stable product ID; prices always come from the current product record.

## Data contract

Migration 4 appends `product_aliases` to the existing catalog, inventory, and sales schema. It preserves migrations 1–3 and existing records. The composite alias/product key prevents duplicate mappings while permitting the same nickname for different products. Such collisions require an explicit product choice during lookup. Coordinate this migration slot with D3 before merging if another schema migration is being developed.

The prototype checkpoint in `prototypes/d2-language` remains a desktop experiment. Its JSON catalog, simplified product types, and terminal runners are not imported into the app. Production actions use the existing `DatabaseSession`, `Product`, and `LookupResult` contracts.

## Owner workflow

1. Open Pamahalaan and find an existing product.
2. Tap Bansag on the exact product/variant/unit.
3. Enter a nickname and request review.
4. Check the displayed product identity and any conflicting product choices.
5. Tap the explicit confirmation button to save, or cancel without saving.
6. Open Alamin ang Presyo and type the approved nickname.

Editing the nickname invalidates its reviewed proposal. Leaving Manage products discards an unconfirmed proposal. A confirmation already submitted by the owner is an authorized save; navigation is not a rollback of that save. Save errors must remain visible and must not be reported as success.

Aliases match after case and whitespace normalization. For example, `Coke maliit` and `maliit na Coke` are distinct nicknames unless separately approved. Unapproved synonyms and unknown variants must not inherit a guessed price.

## Automated verification

Run from the app root:

```text
npm run typecheck
npm test
npx expo export --platform android
```

The app tests use Node's runner and real SQLite, independently of the prototype's Vitest tests. Cover review without writes, invalid inputs, repeated confirmation, shared aliases, canonical-name collisions, current catalog prices, failure/retry, restart persistence, and upgrades preserving inventory and sales history.

Verified on 2026-10-10: TypeScript check passed, all 45 app tests passed, and the Android Hermes bundle exported successfully. Independent code review found no material issues. These checks do not replace the phone acceptance below.

## Phone acceptance — pending actual execution

Record the revision, phone/Android version, runtime (Expo Go or release APK), and observations. Do not mark these checks passed solely from desktop tests.

- [ ] Create Coke / 200 mL / bote / 15.00 and Coke / 1.5 L / bote / 75.00.
- [ ] Review `maliit na coke` for the small variant; verify full name, variant, and unit.
- [ ] Cancel, then search that nickname; verify it was not saved.
- [ ] Review again and confirm; verify the nickname retrieves exactly the small variant and its catalog price.
- [ ] Edit a reviewed nickname; verify confirmation requires another review.
- [ ] Leave Manage products with an unconfirmed review; verify no alias was created.
- [ ] Confirm repeatedly; verify no duplicate mapping or changed stock/price.
- [ ] Approve the same nickname for the large variant; verify two accessible choices and correct selected prices.
- [ ] Create an alias equal to another product's catalog name; verify lookup requires a choice.
- [ ] Update a product's price through its existing price action; verify alias lookup shows the new price.
- [ ] Force-stop and reopen; verify the alias mappings remain available.
- [ ] Verify an unknown nickname remains explicitly unknown.
- [ ] Verify review, cancellation, saving, and product choices remain usable with large text and TalkBack.
- [ ] Repeat lookup/save/restart in a standalone release APK with airplane mode on, Wi-Fi off, and Metro stopped. Follow ANDROID-ACCEPTANCE.md for build prerequisites; preserve existing app data during upgrades.

Ticket closure requires the relevant review and persistence acceptance evidence. Expo Go is useful for UI checks but does not establish standalone offline readiness.
