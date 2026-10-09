# D1 workflow — Ticket #2 offline Filipino transcription

Prepared 2026-10-10. Owner: D1, Speech & On-Device Native Audio.

## Analysis and start gate

D1 owns #2 (bundled offline transcription) and #5 (voice price lookup). Ticket #2 already exists: [Transcribe Filipino speech with a bundled model](https://github.com/Shirooo098/Aira/issues/2). This document plans its implementation; it does not create a duplicate issue.

GitHub currently shows #1 closed as completed and #2 open. Local CONTINUITY.md records foundation verification, but it does not establish that the implementation has merged into main or passed standalone phone acceptance. Before implementing, verify #1's code is on main, as required by AGENTS.md. If it is only local, prepare the speech contract and recordings while integration is resolved. A ready-for-agent label alone does not satisfy the dependency gate.

Current foundation: Expo 57.0.27, React Native 0.86.3, expo-audio, expo-asset, expo-dev-client, SQLite catalog, mode navigation and short cues. No speech runtime or microphone capture implementation exists. Installed audio dependencies do not prove Whisper compatibility.

Delivery path: #1 → **#2** → #5 (also needs D2 #3). D2 #6 also consumes #2 after #4. Keep #2 focused on capture and an editable transcript; product matching, price results, catalog extraction and transaction writes belong to later tickets.

## User flow

Open Ask price → see model preparation/readiness → press and hold the microphone → speak → release → see transcribing status → review and edit the transcript → retry or discard.

For #2, reviewed text stays draft state and does not execute lookup or write catalog/financial data. Provide readable instructions, recording indication, a cancel control and an accessible start/stop alternative to holding. Typing stays available when speech is unavailable.

## Implementation sequence

### 1. Verify baseline and choose the native build route

- Read AGENTS.md, AIRA-SPEC.md, issues/02.md, README.md and existing audio/UI code. Preserve unrelated changes.
- Confirm #1 is integrated on main, then use repository branch convention `feat/#2-whisper-speech` when implementation is authorized.
- Record baseline `npm test` and `npm run typecheck` results.
- Coordinate native configuration with D4. Use an Expo development build containing whisper.rn; Expo Go cannot load a newly added custom native runtime. Retain the existing foundation launch instructions and document a separate speech route.
- Check the pinned runtime against the actual Expo/React Native architecture and Android toolchain. Prove initialization on the Oppo before building the full UI. Record compatibility failures instead of assuming an older example works.
- Document proposed package version, model source/license, build requirements and size implications before installation. Apply the foundation's material-dependency approval requirement if it remains applicable; prepare a concrete dependency decision first.

Output: native-build decision and a reproducible runtime initialization smoke test. A Metro export is not native acceptance.

### 2. Prepare a shared recording set before selecting the model

Use the same recordings for multilingual tiny and base. Do not use `.en` models. Start with a proposed minimum of 20 short utterances spanning Filipino quantities, English brands, Taglish, similar variants, corrections and unknown products. Include quiet and representative store-noise recordings; list actual sample counts and conditions. This is an initial benchmark protocol, not an already agreed product acceptance threshold.

Examples to adapt to the actual store catalog: “Magkano ang isang Coke?”, “Dalawang Lucky Me chicken”, “Tatlong sachet ng shampoo”, “Isa lang pala”, and an unknown product name. Record expected words and critical product/quantity/action tokens. Include silence and very short clips for failure tests.

Output: shared fixture manifest with recording ID, duration, expected transcript/tokens and noise condition. D2 and later #5 reuse it.

### 3. Bundle and initialize the selected model

- Benchmark tiny/base on the target phone and select the smallest candidate with adequate measured Filipino behavior. If neither is viable, publish the limitation and keep typing usable.
- Ship one selected production model in the installation. Model acquisition during development/build is separate from app runtime; the installed app must never download a required model.
- Resolve the packaged asset to a local runtime-readable path. If extraction is required, use temporary output, verify completion/integrity and atomically mark it ready. Recover from interruption, corruption, low storage or missing assets without a network fallback.
- Show preparing, ready and recoverable error states. Record model filename, checksum, format/quantization, runtime version and inference configuration.
- Reuse a ready context where supported; release it safely when appropriate. Measure initialization, extraction storage, installed size and memory observations.

Output: offline model readiness on a fresh installation and subsequent launches.

### 4. Implement capture and session ownership

Suggested small modules: `src/speech/model-loader.ts`, `src/speech/speech-session.ts`, `src/speech/whisper-adapter.ts` and a reusable `src/ui/SpeechTranscriptInput.tsx`. Adjust names to repository conventions; avoid introducing a general agent framework.

Expose start, stop/transcribe, cancel and dispose through one session controller. Track model state separately from capture state: idle → recording → transcribing → review, with explicit permission/error paths.

- Request microphone permission at the point of use. Denial offers typed input and settings guidance where appropriate.
- Select capture format supported by the pinned runtime; verify sample rate/channel/encoding on Android. Do not assume the recorder's default compressed file is compatible.
- Allow only one active session. Use a session identifier so cancelled, previous-mode or unmounted callbacks cannot overwrite current text.
- Stop capture on cancellation, mode switch, unmount or app backgrounding; invalidate pending results. Release recorder resources and remove temporary recordings after completion/discard.
- Define and show a short capture limit (proposed 15 seconds) and bounded inference timeout. Final values must be recorded and verified, not silently guessed.
- Coordinate mode cues so they do not contaminate microphone recordings. Keep visual status usable if audio fails.
- Empty/silent audio, busy microphone, capture failure, inference failure and timeout produce visible recovery actions. Retrying creates a fresh session.

Output: safe push-to-talk capture with no overlapping recording or stale-result races.

### 5. Return an editable draft

Use local multilingual transcription rather than translation. Record the chosen language strategy and test it against Filipino/Taglish recordings. Display a transcript only for the current successful session. Never manufacture text for an empty or failed result.

Keep recognized text and owner-edited text distinguishable in the session. Offer edit, retry and discard. Expose reviewed draft text to later consumers without calling catalog or transaction actions in #2. Keep the session ephemeral; no new database migration is required for this slice.

Output: reusable transcript component and a documented draft handoff contract.

### 6. Verify software behavior and actual hardware separately

Automated tests should cover permission denial, empty capture, cancellation during recording/inference, timeout, retry, duplicate starts, stale callbacks, cleanup and protection of edited text. Inject fake adapters to verify controller behavior; label these as control-flow tests, never model accuracy or speed evidence.

Run `npm test` and `npm run typecheck`. Build and install the native Android app. Confirm typed catalog behavior and mode cues still work. Use application-action SQLite tests if integration touches database actions; otherwise avoid inventing database writes for speech tests.

On the Oppo Reno6 Z 5G:

1. Install a build with JS and the selected model embedded. Enable airplane mode with Wi-Fi disabled before first launch. Verify extraction/init and a transcript without Metro or an external download.
2. Test permission denial/recovery, silence, cancel, retry, rapid interactions, mode switching and backgrounding.
3. Run the shared recording set against both candidates using identical settings/conditions. Report every output, failures and critical-token accuracy; optionally include word error rate.
4. Separate cold runs (process restart/context initialization, with first-use extraction separately) from warm runs. Log utterance duration, speech end, capture stop, inference start/end and visible editable transcript time. Report both capture-stop-to-transcript and speech-end-to-transcript so user release delay is visible.
5. Record observed RAM/peak memory if tooling supports it, measurement method, thermal condition and failures. Mark unmeasured fields explicitly.

Ticket #2 provides transcription evidence. The under-three-second speech-end-to-visible-price target remains #5 and includes interpretation, lookup and rendering. The agreed sample size and success/percentile interpretation are still unresolved; do not declare final performance acceptance from averages or a single fast run.

### 7. Deliver the D1 handoff

Provide D4 native configuration and launch/build instructions. Provide D2 a reviewed transcript contract and representative fixtures. When #2 and #3 are merged, D1 starts #5: reviewed transcript → confirmed alias lookup → exact saved price or unknown/ambiguity UI → full end-to-end measurement.

Suggested artifacts:

- `docs/SPEECH-INTEGRATION.md`: dependency/model decisions, bundle/extraction behavior, native commands and failure recovery.
- `docs/SPEECH-BENCHMARK.md`: tested revision, APK/build type, device/OS, runtime/model checksum, configuration, sample counts, individual outcomes, cold/warm timing, memory observations and selection rationale.
- Shared fixture manifest and controller tests; do not publish private recordings without authorization.

Prepare a reviewable diff and evidence summary. If a PR is separately requested, link `Closes #2`. No commit, push, issue closure or publication is authorized by this planning request.

## Completion checklist

- [ ] #1 implementation verified on main before dependent implementation starts.
- [ ] Selected multilingual Whisper model is bundled; readiness/extraction errors are visible and recoverable.
- [ ] Push-to-talk produces an editable Filipino transcript on the actual Oppo while offline.
- [ ] Denial, empty input, cancellation and inference failure recover without hidden fallback.
- [ ] Shared recording results include Filipino quantities, English brands and store noise.
- [ ] Runtime/model details, accuracy, RAM observations and cold/warm timing are recorded truthfully.
- [ ] Automated checks and foundation regression checks pass; native/device evidence is separate.
- [ ] D2/D4 handoffs are documented, with #5 end-to-end performance explicitly outstanding.

## References

- [Live Ticket #2](https://github.com/Shirooo098/Aira/issues/2), checked 2026-10-10.
- [Live Ticket #1](https://github.com/Shirooo098/Aira/issues/1), closed/completed at this snapshot.
- Local AGENTS.md, AIRA-SPEC.md, CONTINUITY.md, TICKET-PLAN.md and issues/02.md and issues/05.md.
- [whisper.rn primary documentation](https://github.com/mybigday/whisper.rn): native integration; pin and verify the version during implementation.
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/): custom native dependencies require a development build.

This is a workflow document. No speech implementation, dependency installation or hardware benchmark was performed while preparing it.
