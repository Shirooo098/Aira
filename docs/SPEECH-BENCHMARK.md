# Ticket #2 device evidence

Status: **NOT RUN on Oppo Reno6 Z 5G**. No phone was connected during initial implementation. Tiny/base comparison and final production selection are pending. Automated checks do not establish speech accuracy, memory use or speed.

## Shared representative recording set

Record each prompt once quietly and once with representative store noise: 20 recordings used unchanged for both candidates. Adapt brands/variants to the actual catalog before freezing the set. Manifest each recording ID, duration, environment, expected words and critical tokens. Do not publish private recordings without authorization.

| ID | Prompt | Critical tokens |
|---|---|---|
| S01 | Magkano ang isang Coke? | isang, Coke |
| S02 | Dalawang Lucky Me chicken. | dalawa, Lucky Me, chicken |
| S03 | Tatlong sachet ng shampoo. | tatlo, sachet, shampoo |
| S04 | Isang Bear Brand na maliit. | isa, Bear Brand, maliit |
| S05 | Limang SkyFlakes, magkano lahat? | lima, SkyFlakes |
| S06 | Coke mismo, hindi Sprite. | Coke, hindi, Sprite |
| S07 | Isa lang pala. | isa, lang, pala |
| S08 | Dalawa, dagdagan ng isa. | dalawa, dagdagan, isa |
| S09 | May malaking Tang orange ba? | malaki, Tang, orange |
| S10 | Magkano ang produkto na wala sa catalog? | unknown product phrase preserved |

Also test silence, very short clips, noise without speech and interrupted capture. This sample proposal is not an agreed accuracy/percentile criterion. Agree those criteria before declaring acceptance; #5 handles unknown products and price lookup.

## Run log

Record app revision/working-tree identity, APK hash/build type, device/Android version, sample manifest, ambient conditions, selected model/checksum, runtime version, actual PCM format, language/thread options. Copy model metadata from the APK.

| Model | Sample | Cold/warm | Expected | Raw transcript | Critical tokens correct | Readiness ms | Speech-end to release ms | Release to visible transcript ms | Error |
|---|---|---|---|---|---|---|---|---|---|
| NOT RUN | — | — | — | — | — | — | — | — | — |

Use instrumented timestamps or a screen recording with known timing resolution; report the method/uncertainty. Separate process/context initialization from warm inference. Preserve every failure/output, then summarize median/p95/max by condition when sample counts support it. Measure RAM/peak RSS with Android tooling where possible, and report build/installed size, repeated-run heat effects and errors. Explicitly mark unmeasured fields.

## Phone acceptance

- [ ] Standalone APK contains JS, runtime, selected model and license/metadata.
- [ ] Install, enable airplane mode with Wi-Fi disabled before first launch, initialize and transcribe without Metro.
- [ ] Restart offline and repeat; typed catalog lookup still works.
- [ ] Denied permission is visible; Settings/retry recovers after permission is granted.
- [ ] Hold/release and accessible start/stop both produce editable Filipino text.
- [ ] Release during permission/start, rapid interactions, cancel during inference, mode switching and backgrounding release capture and suppress stale results.
- [ ] Silence/short clips, noise-only input, unsupported PCM, missing/corrupt assets and timeout/error paths recover visibly.
- [ ] Owner edits survive review; review makes no business writes.
- [ ] Identical quiet/noisy recordings tested on tiny/base with raw outcomes retained.
- [ ] Accuracy, memory and cold/warm timing evidence supports the chosen model.

Ticket #2 remains awaiting hardware acceptance until these checks/results are recorded. The full under-three-second speech-end-to-price check is #5.
