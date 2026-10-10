# Ticket 17 — Explain the selected report in Filipino

## Workflow

Open **Pamahalaan → Ulat**, select a calendar period, then tap **Ipaliwanag ang napiling ulat**. The explanation uses the exact returned report snapshot. **Tingnan ang pinagbatayang breakdown** exposes the selected Manila dates, UTC boundaries, snapshot time, sale collections, repayments, credit and cancellation amounts.

Changing period, refreshing, navigating away, cancelling or backgrounding invalidates in-flight explanations. A failed generation shows an error and permits an explicit retry. There is no cloud fallback or automatic financial write.

## Grounding and limits

The same bundled Qwen model from ticket 16 selects one to three fact IDs to emphasize, under a closed JSON grammar. It does not generate displayable totals or free-form financial claims. The host validates the IDs and renders Filipino sentences from the report's integer-centavo values. All supporting categories remain visible even when the model emphasizes only a few. This deliberately bounded explanation prevents invented totals, causal explanations and profit claims rather than attempting to filter arbitrary prose after generation.

Collections distinguish sale receipts from cash and GCash repayments. Repayments are not additional sales. Cancelled sales are attributed to their original creation period and excluded from net sales and collections; reversed repayments are excluded. Outstanding credit and inventory are current snapshots, not balances reconstructed at the end of a historical period. No statement asserts that missing records represent complete history, zero demand or a known business cause.

If there are no active or cancelled sales and no included repayments in the selected period, the app displays an explicit deterministic no-activity explanation without initializing the model. Current credit or stock may still be nonzero. A repayment-only period still counts as activity and can request model inference.

No migrations, new dependency, model installation or downloads are required. The report adapter reuses the bundled model, private file copy and exclusive model lease. It uses a 2048-token context and up to 128 generated tokens. The progress UI allows cancellation; the overall request has a one-minute timeout. Initialization and generation time are displayed separately. Report reasoning is explicitly outside the price-lookup latency target.

## Owner verification — not executed by the coding agent

Run from the repository root and stop at the first error:

```powershell
npm run typecheck
node --test --experimental-strip-types tests/report-explanation.test.ts tests/report-explanation-session.test.ts tests/store-reports.test.ts tests/agent-session.test.ts tests/agent-tools.test.ts
npm test
git diff --check
```

The SQLite fixtures cover cash, confirmed GCash, credit sales, cash/GCash repayments, cancellations, reversed repayments, empty activity and repayment-only periods. Fake runtimes check lifecycle and rejection behavior; they do not establish Qwen accuracy or phone speed.

For development testing, use the existing installed Android development build and Metro:

```powershell
npm run agent:start -- --clear
```

If ticket 16 release testing replaced the development app on the phone, install the previously built development APK first (its bundled native modules and model already support this feature):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
adb install -r .\android\app\build\outputs\apk\debug\app-debug.apk
```

Stop on a missing APK or signing mismatch; do not uninstall or clear application storage. A new development build is needed only if the cached APK is unavailable or lacks the bundled ticket 16 model/native modules.

These changes are JavaScript/TypeScript only; a development build with the ticket 16 native modules and model already installed can reload them. A previously installed release APK must be rebuilt to include these source changes. For release acceptance use the model-enabled build workflow from ticket 16, with `NODE_ENV=production`, and test without Metro in airplane mode with Wi-Fi explicitly disabled.

Phone checklist:

- [ ] Check the selected date range and all amounts against the dashboard and supporting breakdown.
- [ ] Request explanations for Today, Week, Month and a prior month with saved records.
- [ ] Ensure collections preserve cash and GCash totals, credit is not described as collected cash, and repayments do not inflate sales.
- [ ] Check cancelled sales and reversed repayments against the report's attribution rule.
- [ ] Select an empty period: explicit no-activity text, no invented history and no native inference.
- [ ] Confirm a repayment-only period is not incorrectly treated as empty.
- [ ] Change period or refresh during generation: no old explanation appears under the new period.
- [ ] Cancel, background and navigate away during loading/inference, then retry without stale results.
- [ ] Check useful failure/retry behavior in Expo Go (native model unavailable); do not treat it as model acceptance.
- [ ] Confirm sales, repayments, catalog and stock do not change when requesting explanations.
- [ ] Test the standalone APK offline on the physical target Oppo.
- [ ] Record first initialization, warm inference, peak RAM/CPU and storage evidence. Do not substitute unit-test timings.

## Acceptance evidence

Implementation is supplied for owner verification. Automated results and actual phone inference measurements remain pending until the owner runs the checks. Record device/build identifier, selected period, expected totals, actual results, initialization time, inference time and any failure here before marking ticket 17 complete.
