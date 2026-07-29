# QuickTalk A/B Validation Report

Generated: 2026-07-22 20:23:14 +08:00

## Verdict

**Qualified pass for an isolated QuickTalk integration PoC.** The `welcome`,
`point`, and `talk-subtle` cases now each contain a fixed 100-frame input,
canonical WAV, MuseTalk baseline, QuickTalk render, live media probe, and
region metrics. Checksums, planner sequences, media timing, and audio
alignment pass.

The evidence does **not** establish a codec-generation-matched perceptual
ranking or phoneme-level lip-sync score. MuseTalk was captured through WebRTC
before its final encode, while QuickTalk rendered directly from the encoded
template. This material difference is described under
[Encoding limitation](#encoding-limitation).

No SynLive production code or service was changed for this validation, and no
service was started on port `8032`.

## Case status

| Case | Fixed input | MuseTalk | QuickTalk | Live probes | Audio | Frame order | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `welcome` | 100 frames | present | canonical fresh-state present | pass | pass | 100% duplicate-equivalent | qualified pass |
| `point` | 100 frames | present | present | pass | pass | qualified; see note | qualified pass |
| `talk-subtle` | 100 frames | present | present | pass | pass | 100% duplicate-equivalent | qualified pass |

The `point` raw-NPZ nearest-frame metric reports 99% duplicate-equivalent
accuracy because output frame 52 is marginally classified as raw source frame
51 (outside-face cost 3.3730 versus 3.4406 for expected frame 52). A secondary
comparison against the actual encoded template maps it to template frame 52;
all other deviations are the declared duplicate source frames 18, 43, and 78.
This is an encoded-template/raw-NPZ nearest-neighbor ambiguity, not evidence
that the renderer reordered the video.

For `talk-subtle`, exact positional accuracy is 72% because the ping-pong plan
reuses frames on its reverse leg. Pixel-equivalent accuracy is 100% for both
models and is the relevant check.

## Integrity checks

- All original `SHA256SUMS` and `PROBE_SHA256SUMS` files pass.
- `QUICKTALK_TWO_UTTERANCE_SHA256SUMS` and
  `QUICKTALK_FRESH_STATE_SHA256SUMS` pass.
- Sixteen stored local-media probes match a fresh `ffprobe -count_frames`
  reading for every recorded field.
- All three blind-review videos contain 100 side-by-side frames at 25 FPS and
  a complete 4.000-second, stereo 48 kHz AAC stream. Their first 192,000
  decoded samples align with the canonical WAV at correlation >= 0.999998568.
- All three `/tmp` WebRTC source recordings are present and match their
  manifest SHA256 exactly. Fresh probes match the recorded media facts except
  `codec_time_base` and `refs`, two decoder/version-derived fields that differ
  under the current `ffprobe` build. The MP4 files remain temporary and are not
  in the stable inventory; the manifests and checksum-covered probes are the
  durable records.
- The `point` planner is byte-identical to the declared sequence
  `point:0..64 -> talk_subtle:0..34`, including boxes and landmarks.
- The `talk-subtle` planner is byte-identical to
  `talk_subtle:0..74 -> 73..49`, including boxes and landmarks.
- All planner geometry is finite, all six-point landmarks are valid, and the
  serialized sequence hashes match their manifests.

The complete stable-evidence SHA256 inventory is in
[`validation-report.json`](validation-report.json). It covers all three case
directories plus `README.md`, `measure-video-ab.py`, and `make-blind-ab.py`;
the report outputs themselves and transient `__pycache__` bytecode are
explicitly excluded.

## Media and audio

Every template and rendered candidate contains 100 video frames at
`360 x 624`, 25 FPS, and 4.000 seconds. Each canonical WAV is PCM s16le,
stereo, 48 kHz, and exactly 192,000 samples per channel.

The MP4 AAC streams declare 192,000 samples and 4.000 seconds. `ffmpeg`
decodes 192,512 samples per channel because it exposes a 512-sample AAC tail;
alignment checks use the first 192,000 effective samples. All candidates are
aligned to the canonical WAV:

| Case | Candidate | Correlation | Relative RMSE |
| --- | --- | ---: | ---: |
| `welcome` | MuseTalk | 0.999998618 | 0.001671 |
| `welcome` | QuickTalk canonical | 0.999998618 | 0.001671 |
| `point` | MuseTalk / QuickTalk | 0.999998569 | 0.001704 |
| `talk-subtle` | MuseTalk / QuickTalk | 0.999998571 | 0.001698 |

The earlier `welcome-quicktalk-100f.mp4` used default AAC and scores
0.999983087 / 0.005854. The canonical fresh-state file uses the matched
192 kbit/s viewing encode:

```text
welcome/welcome-quicktalk-fresh-state-100f.mp4
SHA256 2ffc74ddeb8e253bdb7b16cb2b35a93da878ec725c3b53b83b8676536dc9ad71
```

## Region measurements

The following table reports the delivered encoded files. Lower cheek/chin and
upper-face errors are consistent with a narrower changing face layer, but the
absolute model-to-model difference also contains the encoding-generation
confound.

| Case | Model | Mouth activity | Mouth MAE | Cheek/chin MAE | Cheek/chin temporal MAD | Upper-face temporal MAD | Outside-face MAE |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `welcome` | MuseTalk | 7.669 | 19.550 | 7.472 | 5.848 | 4.848 | 3.580 |
| `welcome` | QuickTalk fresh | 8.860 | 15.120 | 4.223 | 3.432 | 2.317 | 2.234 |
| `point` | MuseTalk | 5.733 | 18.051 | 7.601 | 5.333 | 4.130 | 3.308 |
| `point` | QuickTalk | 6.945 | 13.286 | 4.604 | 3.472 | 2.272 | 2.298 |
| `talk-subtle` | MuseTalk | 4.578 | 15.592 | 6.403 | 4.146 | 3.713 | 3.082 |
| `talk-subtle` | QuickTalk | 5.580 | 13.326 | 4.094 | 2.699 | 2.051 | 2.264 |

Template mouth activity is 10.180 for `welcome`, 7.286 for `point`, and 5.091
for `talk-subtle`. QuickTalk is closer to the moving source in `welcome` and
`point`; it slightly exceeds the source activity in `talk-subtle`.

The `welcome` contact sheet qualitatively shows clearer openings and teeth for
QuickTalk. MuseTalk appears softer and is more often nearly closed. This is a
useful visual observation, not a phoneme-sync measurement:

[`welcome/welcome-mouth-contact-sheet.png`](welcome/welcome-mouth-contact-sheet.png)

## Blind review packets

Each case also has a side-by-side video and a ten-frame mouth contact sheet
whose A/B placement is derived from the canonical audio hash. Review the video
or sheet before opening its key:

| Case | Blind video | Blind mouth sheet | Reveal key |
| --- | --- | --- | --- |
| `welcome` | [`welcome-blind-ab.mp4`](welcome/welcome-blind-ab.mp4) | [`welcome-blind-mouth-contact-sheet.png`](welcome/welcome-blind-mouth-contact-sheet.png) | [`welcome-blind-key.json`](welcome/welcome-blind-key.json) |
| `point` | [`point-blind-ab.mp4`](point/point-blind-ab.mp4) | [`point-blind-mouth-contact-sheet.png`](point/point-blind-mouth-contact-sheet.png) | [`point-blind-key.json`](point/point-blind-key.json) |
| `talk-subtle` | [`talk-subtle-blind-ab.mp4`](talk-subtle/talk-subtle-blind-ab.mp4) | [`talk-subtle-blind-mouth-contact-sheet.png`](talk-subtle/talk-subtle-blind-mouth-contact-sheet.png) | [`talk-subtle-blind-key.json`](talk-subtle/talk-subtle-blind-key.json) |

These packets support a human preference review; no reviewer score is claimed
by this report. The initially generated one-second audio versions were replaced
before the final inventory. The listed files are the verified four-second
versions. Each MP4 has one audio track encoded from the canonical WAV and
shared by the A/B picture; it is not a two-track or left/right audio comparison.

### Metric interpretation

- Mouth MAE versus the template is **not** a quality score. A model can obtain
  a lower value by changing the original moving mouth less.
- `mouth_pixel_activity` is adjacent pixel motion in a normalized crop. It
  does not establish whether the mouth shape matches the current phoneme.
- Mouth residual temporal MAD includes intended articulation and differences
  from the source actor's original speech; it is not pure flicker.
- Cheek/chin and upper-face controls are more useful for detecting a broad,
  changing face layer, but still include codec and source-motion effects.
- Mouth color pumping can contain desired mouth changes and cannot be treated
  as an artifact-only metric.
- ROIs use fixed source-NPZ geometry. A candidate that shifts the mouth
  substantially can be sampled off-center or undercounted.
- The outside-face region is mostly background and body. It indicates a broad
  preservation/encoding floor, not an exact face-region codec correction.

## QuickTalk runtime result

An unprewarmed first render loop is not real-time. Once the model and kernels
are resident, the tested RTX 3090 render loop is comfortably above the 25 FPS
delivery target:

| Scenario | Render-loop first frame | Render-loop 100 frames | Render-loop FPS |
| --- | ---: | ---: | ---: |
| Cold, no adapter prewarm | 4.313 s | 5.766 s | 17.34 |
| Warm worker, fresh zeroed session state | 15.55 ms | 1.533 s | 65.24 |
| Cold process, prewarm before first user | 16.70 ms | 1.533 s | 65.21 |

These timings begin after complete HuBERT feature extraction and FFmpeg writer
setup. They are not end-to-end user TTFF or full-pipeline FPS. For the
prewarmed first user, four-second audio feature extraction takes another
82.7 ms, so feature start to first generated frame is about 99.4 ms. Feature
extraction, all 100 render frames, and MP4 mux finalization total about 2.247 s;
this still excludes TTS and assumes the complete WAV is already available.

The prewarm itself takes 4.468 seconds after 4.972 seconds of model/avatar
initialization. The service should complete adapter warmup and CUDA
synchronization before reporting ready.

A new zeroed session state after an earlier utterance preserves warm speed.
Fresh runs 1 and 3, and the separately prewarmed first-user run, produce the
same canonical video SHA256. Continuing the old recurrent state produces a
different output SHA. Therefore the integration should keep one resident,
prewarmed worker but create/reset state for every new session or utterance.

The welcome process used about 1.90 GiB of per-process NVIDIA memory and about
2.29 GiB RSS after rendering. The whole-GPU before/after delta is supporting
evidence only because other GPU workloads were resident.

The one-shot `point` and `talk-subtle` runs report 16.10 and 17.63 FPS,
respectively. They include cold first-frame work and are not representative of
the required resident-worker path. Their raw renderer stdout was not retained,
so their render-wall values have weaker provenance than the fully logged
welcome runs.

## Encoding limitation

This is the largest limitation in the current A/B:

```text
MuseTalk:
  planner frames -> MuseTalk -> WebRTC capture -> x264 slow CRF 10 / AAC 192k

QuickTalk canonical:
  encoded template -> QuickTalk -> x264 slow CRF 10 / AAC 192k
```

MuseTalk contains an extra WebRTC/capture generation. The original QuickTalk
file additionally used `veryfast` CRF 18 and default AAC, although the new
canonical QuickTalk files now use the same final x264/AAC settings as the
MuseTalk viewing copy.

The outside-face MAE illustrates the unequal preservation floor: MuseTalk is
3.58 versus QuickTalk 2.23 in `welcome`. Consequently, raw MAE, PSNR, and
temporal-residual differences cannot be assigned purely to model quality.
Qualitative inspection, timeline/audio checks, frame order, runtime warmup,
and the broad observation that QuickTalk changes a narrower region remain
useful.

## Unsupported conclusions

This evidence does not yet prove:

- phoneme-level lip synchronization;
- production identity preservation across diverse faces and head poses;
- absence of long-run recurrent drift, memory growth, or queue growth;
- multi-avatar cache capacity or concurrent-user behavior;
- commercial permission to redistribute or deploy all checkpoints.

The OpenTalking code is Apache-2.0, and the downloaded HuBERT checkpoint is
described as Apache-2.0. The `datascale-ai/quicktalk` repository itself declares
`license: other`; QuickTalk checkpoint provenance and the bundled InsightFace
assets require an explicit legal review before production use.

## Corrected next-round protocol

1. Capture raw or lossless renderer frames from both models before WebRTC or
   viewing-copy encoding.
2. Measure those frames, then create both viewing copies with one identical
   encoder invocation.
3. Add SyncNet/LSE or an audio-conditioned lip-aperture trace for actual
   lip-sync claims.
4. Add a content-matched encode-only control for every reported face region.
5. Run 30-minute, 2-hour, and 8-hour resident-worker tests while recording
   per-process GPU memory, RSS, queues, and session-state resets.
6. Audit QuickTalk, HuBERT, and InsightFace model licenses and provenance before
   any commercial or public deployment.

## Environment boundary

The model and adapter runtime come from OpenTalking commit
`69af1069eab3d736798b406e79801d6a600f581b`, but the benchmark was not run
through a pristine, unchanged CLI. The local `apps/cli/quicktalk_bench.py`
resamples the canonical 48 kHz stereo WAV to mono 16 kHz for the model and
uses x264 slow CRF 10 / AAC 192k for the viewing file. The two stored benchmark
patches add warm-worker, fresh-state, prewarm, memory, and timing
instrumentation. These harness changes do not alter the QuickTalk
adapter/model code, but they are required provenance for reproducing the
reported files and timings.

The successful renders used the existing dedicated
`/data/llm_model/opentalking/.venv-quicktalk` runtime (Python 3.10.20). This is
a non-hermetic overlay venv:
`include-system-site-packages=true`, and its Python links to the existing
`cyberverse` conda interpreter. It contains InsightFace 0.7.3 and
ONNX Runtime GPU 1.23.2; CUDA and TensorRT providers are available.

The separate official Python 3.11 sync completed successfully at the package
manager level: Python 3.11.13, 219 packages, `uv pip check` passed, Torch
2.10.0+cu128 sees CUDA, imports passed, and `quicktalk.pth` loaded as
TorchScript. It is **not accepted as a QuickTalk CUDA environment**, however.
It contains both `onnxruntime 1.27.0` and `onnxruntime-gpu 1.26.0`; the imported
CPU pybind exposes only Azure and CPU providers. InsightFace 1.0.1 requires the
CPU-named `onnxruntime` distribution while the `quicktalk-cuda` extra requires
`onnxruntime-gpu`, and both own the same import namespace. The dependency set
must be made mutually exclusive or pinned and then revalidated for
`CUDAExecutionProvider` before this Python 3.11 environment is used for the
QuickTalk service.
