# FlashHead body-motion PoC

`motion-host/` is generated from the locally available SoulX-LiveAct demo video
by `scripts/prepare-flashhead-body-poc.py`. The generated clips are pre-decoded
RGB frames plus per-frame face boxes and six-point target landmarks. The
WebRTC render loop performs no video I/O; it only tracks the generated source
face and applies a small face-ROI similarity warp and blend.

Generated `*.npz` clips are treated as model/data artifacts and are not
committed. Regenerate or copy them into `motion-host/` before running the
FlashHead body-motion service.

Version-two manifests keep the same face-shaped mask and boundary color match
when landmark fitting temporarily falls back to box alignment. Runtime health
exposes `tracking_enabled` and cumulative `fallback_frames` for monitoring.

This material is for internal visual validation only. The upstream repository
does not provide a separate production license or model release for the person
shown in the demo video. Replace the profile with recorded, identity-approved
footage before public or commercial use.

Regenerate it with:

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/prepare-flashhead-body-poc.py
```

The checked-in browser sample at `public/demos/flashhead-body-poc.mp4` is a
real WebRTC capture. Regenerate it after the FlashHead service is ready with:

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  scripts/record-flashhead-body-poc.py
```
