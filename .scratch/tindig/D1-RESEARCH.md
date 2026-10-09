# D1 preparation and research

Researched 2026-10-10. Research only; no dependencies installed, app implementation, model download, or device benchmark performed.

## Repository context

- Latest fetched `origin/main`: `c7b179b`; contains specifications and tickets only, with no package manifest or Android application.
- Working branch: `feat/#2-whisper-speech`, following AGENTS.md. Branch is local.
- D1 owns #2 (offline editable speech transcription) and #5 (voice price lookup).
- #2 implementation is blocked by merged #1 (D4 app/catalog foundation); #5 needs #2 and #3 (D2 aliases). Research and interface preparation can proceed now.
- The source of truth is AGENTS.md, TINDIG-SPEC.md, TICKET-PLAN.md and issue drafts 01/02/05. Some spec status text predates the published ticket plan. The remote issue page could not be retrieved by the browser during this research; dependency conclusions use committed documents and fetched main.

## Verified technical facts

- `whisper.rn` latest GitHub release resolves to v0.7.4. Treat it as a candidate to test against D4's chosen stack, not an approved dependency. Its peer constraints accept any React/RN version, which does not establish compatibility. Tagged package development dependencies use RN 0.84.1, and Node engine is >=20.19.4. [Release](https://github.com/mybigday/whisper.rn/releases/tag/v0.7.4), [tagged package](https://github.com/mybigday/whisper.rn/blob/v0.7.4/package.json).
- Native speech requires a compiled Android app. The wrapper documents Expo prebuild, and Expo development builds permit custom native libraries. Expo Go is insufficient. [Wrapper](https://github.com/mybigday/whisper.rn/blob/v0.7.4/README.md), [Expo](https://docs.expo.dev/develop/development-builds/introduction/).
- Multilingual tiny and base are distinct from English-only `.en` versions. Unquantized GGML weights are approximately 75 MiB and 142 MiB respectively; weight size is not app size or peak RAM. [Model inventory](https://github.com/ggml-org/whisper.cpp/blob/master/models/README.md).
- Whisper lists Tagalog as `tl`. Compare explicit `tl` versus language detection on short Taglish fixtures instead of assuming either wins. Disable translation for the transcription workflow. [Tokenizer](https://github.com/openai/whisper/blob/main/whisper/tokenizer.py).
- Tagged wrapper documentation supports model assets via `require(...)`, Metro `bin` asset registration, `initWhisper`, and file transcription returning `stop` plus a result promise. Keep release-tagged documentation distinct from master, which includes newer build/backend details. [Tagged wrapper usage](https://github.com/mybigday/whisper.rn/blob/v0.7.4/README.md).
- Whisper can produce unspoken or repetitive text and varies across languages. Empty/silent/noisy audio needs explicit evaluation; editable transcripts remain necessary. [Model card](https://github.com/openai/whisper/blob/main/model-card.md).
- Android microphone access requires manifest and runtime permission handling, including denial. [Android permission guidance](https://developer.android.com/training/permissions/requesting).
- The tagged recording example uses 16 kHz, mono, 16-bit audio. Capture is a separate concern from the wrapper's file/data inference. Use `stop()` for inference cancellation and `context.release()` for cleanup; streaming adds PCM adapter, VAD and filesystem requirements. [Tagged recording example](https://github.com/mybigday/whisper.rn/blob/v0.7.4/example/src/TranscribeData.tsx), [tagged implementation](https://github.com/mybigday/whisper.rn/blob/v0.7.4/src/index.ts).
- Wrapper, whisper.cpp and OpenAI Whisper repositories carry MIT licenses. Preserve license notices, and verify the exact downloaded model artifact's provenance before distribution. [Wrapper license](https://github.com/mybigday/whisper.rn/blob/v0.7.4/LICENSE), [runtime license](https://github.com/ggml-org/whisper.cpp/blob/master/LICENSE), [Whisper license](https://github.com/openai/whisper/blob/main/LICENSE).

## Proposed implementation direction

Recommendations below are engineering proposals, not implemented or benchmarked selections.

1. Agree with D4 on the Expo/RN version, native build path, permission configuration, Metro config ownership and shared audio cue responsibilities. Do not introduce a competing app scaffold.
2. Prove transcription of a fixed WAV fixture on the phone before adding microphone capture. Compare multilingual tiny/base using the same recording set. Ship only the selected model.
3. Prefer bounded push-to-talk recording followed by file transcription initially. Require a recorder that delivers mono 16 kHz PCM WAV verified against the pinned wrapper; do not assume a default AAC/M4A recording is usable. Select the recorder after inspecting D4's dependencies.
4. Bundle weights at build time; record origin, license, byte size and a locally computed SHA-256. Validate first-install asset availability in a standalone offline build. Show readiness/extraction progress only if extraction is actually needed. Missing/corrupt models must produce a recoverable error, never a network fallback.
5. Keep speech output as draft text. Suggested state flow: model preparing -> ready -> recording -> transcribing -> editable transcript, with separate denied/cancelled/failed states. Permit one capture/inference at a time; discard stale results after cancellation, mode changes or unmount; release native resources and delete temporary audio.
6. Coordinate a transcript handoff with D2. #2 ends with editable text; #5 later passes reviewed text into catalog/alias resolution and renders found/unknown/ambiguous results. D1 must not invent prices or bypass owner confirmation.

## Device evidence plan

- Use real Filipino quantities, English brands, sizes, similar product variants, corrections, unknown products and store noise; include silence and interrupted recordings.
- Record app commit/build type, phone OS, model hash, runtime versions, audio duration, language/options, success/error and raw elapsed times for every run.
- Separate model load/cold start, audio finalization and transcription timing. In #5 also measure utterance end through interpretation/lookup to visible price; transcription timing alone cannot prove the under-three-second goal.
- Proposed starting dataset: at least 30 distinct utterances spanning quiet and noisy conditions; repeat under cold/warm conditions. Team must agree sample count, accuracy threshold and latency percentile before acceptance. Report failures alongside median/p95/max, memory observations and repeated-run heat effects.
- Verify clean installation and restart in airplane mode with Wi-Fi disabled using bundled JS/assets. A development session receiving assets from Metro does not prove standalone offline readiness.
- Automated verification covers permission/cancel/error state behavior and transcript handoff. Model quality and speed need the physical Oppo; mocked inference is not performance evidence.

## Local preparation and unresolved decisions

Node v24.13.0, Java command, adb and Android SDK directories (including NDK/CMake) were located. Java version, SDK component versions, connected device, native build compatibility and actual phone specifications were not established. No toolchain installation is justified yet.

Before implementation: #1 merge; D4 framework/build choices; pinned wrapper and recorder; verified model asset/license; D2 handoff; actual Oppo access; accepted dataset/accuracy/latency criteria. No claim that the three-second target is achievable has been made.
