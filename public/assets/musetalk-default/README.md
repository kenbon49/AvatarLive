# MuseTalk idle avatars

The remaining legacy frontend preview mirrors the Chinese avatar exposed by the
optional MuseTalk backend:

```text
chinese         -> chinese2-cycle-4to7.mp4 (derived from chinese2.mp4)
```

The Chinese avatar uses the same 15 FPS `4s -> 7s -> 4s` cycle for idle playback
and MuseTalk inference. The cycle omits duplicate turnaround frames and keeps the
hands in one relaxed pose. On return from speech, the browser resumes this asset
at the source phase immediately following the final generated frame.

The cloud-first product no longer publishes the old local portrait entries.

The source MuseTalk repository carries an MIT license for its software. Verify
each depicted person's separate portrait/model release before public or
commercial deployment.
