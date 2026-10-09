# Ticket #2 — offline speech integration

Prepared 2026-10-10. #1 is merged into fetched origin/main at c2fad40. This slice adds capture and an editable transcript in Ask price. It performs no catalog, stock or financial writes. #5 connects reviewed text to alias/price lookup.

## Runtime decisions

- Pinned `whisper.rn@0.7.4` (embedded whisper.cpp version metadata: 1.9.3), imported via its exported `whisper.rn/index` subpath. `buffer@6.0.3` provides the polyfill needed by Whisper's safe-buffer import in Metro; no global Buffer assignment is needed.
- Existing Expo SDK 57 expo-audio `AudioModule.AudioStream` captures 16 kHz, mono, signed PCM16 into memory. No added recorder/filesystem dependency or saved recording files. The adapter checks actual sample rate and channels; unsupported rates produce an error instead of inaccurate-rate inference.
- Tagged native Whisper code decodes `transcribeData(ArrayBuffer)` as PCM16 despite its float32 JSDoc. Transcription uses Tagalog `tl`, translation disabled, four CPU threads and GPU disabled.
- Capture is bounded to 15 seconds/480,000 PCM bytes. A 30-second inference timeout cancels the native job; stale results are suppressed. A conservative short-input/RMS guard rejects empty audio and requires quiet-voice validation on the Oppo.
- Tiny is a **provisional multilingual candidate**. Base can be packaged in a separate comparison build; final selection requires actual-device evidence. Neither candidate is English-only.
- `assets/models/manifest.json` pins source revision, size and SHA-256 from upstream LFS metadata. Weights are ignored by Git and acquired during build preparation. The installed app never downloads a model. MIT model notice is bundled.

## Build and launch (PowerShell, project directory)

```powershell
npm ci
npm run speech:model -- tiny
npm run speech:prebuild
npm run android
npm run speech:start
```

An Android SDK, compatible JDK and required SDK/NDK components are necessary. Prebuild/Gradle may acquire developer build dependencies. `npm run android` builds/installs a development app on a connected device/emulator; `speech:start` starts its Metro session. Foundation `npm start` remains Expo Go, with typed input and a recoverable speech-unavailable message.

The config plugin verifies the selected weight size/checksum and copies only that candidate into APK asset `models/whisper.bin`, with `model-manifest.json` and its license. The adapter reads that native asset using `isBundleAsset:true`, even in development. No model URL, Metro asset fetch or runtime download is used. Android loads directly from the packaged asset; no app-level extraction is required. Initialization/preparation failures are visible and retryable. Build verification detects corrupt bytes; native initialization detects invalid models.

To compare base:

```powershell
npm run speech:model -- base
$env:AIRA_SPEECH_MODEL = 'base'
npm run speech:prebuild
npm run android
Remove-Item Env:AIRA_SPEECH_MODEL
```

Rebuild after every candidate change. The installed APK keeps its packaged model. After comparison, choose the supported candidate and prebuild again. Generated Android/iOS directories are ignored; persist future native changes through config plugins.

For standalone offline acceptance after prebuild:

```powershell
Push-Location android
.\gradlew.bat assembleRelease -PreactNativeArchitectures=arm64-v8a
Pop-Location
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

Verify signing configuration before distribution; generated development signing is not production release signing. Disable network before first launch and use SPEECH-BENCHMARK.md. Expo export or a Metro development session does not prove standalone offline acceptance.

## Lifecycle and handoff

Prepare is an explicit UI action. Hold/release and accessible start/stop controls request permission on capture. Release while permission/start is pending cancels that attempt. Backgrounding, mode unmount and cancellation stop capture/inference; a replacement waits for old resources. Mode cues are skipped while the microphone is active. Permission denial offers Settings and typed input.

Recognized text and owner edits remain separate. `createSpeechSessionController().review()` returns only the current nonblank editable draft; it performs no lookup or save. D2/D1 later consumers can use this contract without schema changes. Cancel/discard clear ephemeral text and in-memory audio.

Controller/PCM tests prove software handling. Type checking and Metro export prove JS integration. Only an actual Oppo test proves capture, initialization, Filipino accuracy, RAM, latency and airplane-mode acceptance. The full three-second speech-end-to-visible-price criterion remains #5.

Primary sources: [Whisper 0.7.4](https://github.com/mybigday/whisper.rn/blob/v0.7.4/README.md), [native PCM decoder](https://github.com/mybigday/whisper.rn/blob/v0.7.4/cpp/jsi/RNWhisperJSI.cpp), [Expo SDK 57 audio](https://docs.expo.dev/versions/v57.0.0/sdk/audio/), [pinned model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1).
