# MuseTalk body assets

This directory contains pre-recorded target-video frames for the SynLive
MuseTalk 1.5 action-avatar proof of concept.

## Internal PoC only

The current internal sources are:

```text
/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4
/data/llm_model/SoulX-LiveAct-models/LiveAct/assets/2.mp4
```

The source repository does not provide a separate production portrait release
for the person in this video. The current clips are therefore for internal
engineering and visual evaluation only. Do not publish, redistribute, or use
them in a commercial broadcast without obtaining explicit portrait,
performance, and commercial-use authorization.

The actor is already speaking in parts of these clips. The source mouth and jaw
motion can conflict with newly synthesized speech even though MuseTalk replaces
the lower-face pixels. Production footage must be re-recorded with the actor
silent, the mouth and jaw in a neutral state, a near-frontal pose, no hand or
product covering the mouth, and consistent camera, lighting, clothing, and
background.

## Current profiles

`manifest.json` is the fixed local avatar catalog. Both profiles use a 360 x
624 RGB output at 25 FPS, so the service can switch identities without
renegotiating WebRTC.

| Profile | Action frames | Idle motion span | Current `playback_rate` values |
| --- | ---: | ---: | --- |
| `motion-host` | 313 | 16.0 x 14.5 px | idle 1.0, talk_subtle 1.0, welcome 1.0, point 1.0, thank 1.0 |
| `blue-host` | 220 | 6.6 x 4.7 px | idle 1.0, talk_subtle 1.0, welcome 1.0, point 1.0, thank 1.0 |

`motion-host` previously used a 75-frame idle segment whose face center moved
about 38 pixels horizontally. The tuned 35-frame segment reduces that to about
16 pixels. The stable segment and all other sampled action clips are retained,
but every action now plays at its normal 1.0x source speed. Slow playback was
removed after visual review because repeated body frames made the motion feel
unnatural and made the continuously regenerated jaw region look more like an
independently changing overlay. Video, generated mouth, and the source
body-frame cursor all advance at 25 FPS.

Each action NPZ contains:

```text
frames                  uint8 [N, 624, 360, 3], RGB
face_boxes              float32 [N, 4]
face_landmarks          float32 [N, 6, 2]
face_landmarks_valid    bool [N]
```

Generated `*.npz` action clips are treated as model/data artifacts and are not
committed. Regenerate or copy them into the profile directories before running
the MuseTalk body renderer.

`reference.png` is retained with each profile for traceability and for the UI
thumbnail; the MuseTalk renderer uses each target video
frame as its geometry and identity source rather than pasting a generated full
face from that reference image.

These assets are separate from `public/assets/flashhead-body/`. The FlashHead
profile is 20 FPS, while this profile is 25 FPS. Do not overwrite or share the
manifest between the two services.

## Runtime use

`apps/musetalk/action_runtime.py` loads and validates the manifest and action
clips. `apps/musetalk/inference.py` precomputes a 256 x 256 VAE latent and a jaw
blend mask for every target frame. The current mask uses
`upper_boundary_ratio=0.55`; pixels where the mask is zero must remain exactly
equal to the source target frame.

Each profile has an independent runtime cache:

```text
/data/MuseTalk/results/synlive-cache/motion-host-v15.npz
/data/MuseTalk/results/synlive-cache/blue-host-v15.npz
```

The cache key includes this manifest, the action NPZ metadata, and the relevant
MuseTalk model metadata. Regenerating or replacing the assets invalidates the
cache automatically.

## Regenerating the internal fixture

The current fixtures were sampled with the shared body-asset preparation
script. For example:

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/prepare-flashhead-body-poc.py \
  --source /data/llm_model/SoulX-LiveAct-models/LiveAct/assets/1.mp4 \
  --fps 25 \
  --profile motion-host \
  --ranges-json scripts/musetalk-motion-host-ranges.json \
  --output-root public/assets/musetalk-body/motion-host \
  --avatar-output public/assets/musetalk-body/motion-host/reference.png
```

Use `scripts/musetalk-blue-host-ranges.json`, profile `blue-host`, source
`assets/2.mp4`, and the matching output directory to regenerate the second
profile.

Run the command from the SynLive repository root. It intentionally produces an
internal fixture, not a licensed production asset. Before replacing this
profile, verify the exact frame count, RGB/BGR path, face boxes, mask boundary,
25 FPS playback, action transitions, lip sync, teeth, jaw motion, occlusion,
and the actor's authorization records.

The original implementation is documented in
`docs/musetalk-action-avatar-implementation.md`. Current motion tuning,
multi-avatar switching, and validation results are in
`docs/musetalk-motion-tuning-multi-avatar-implementation.md`.
