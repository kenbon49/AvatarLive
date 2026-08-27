# MuseTalk idle avatars

The frontend catalog mirrors the three public avatars exposed by the MuseTalk
backend:

```text
chinese         -> chinese2-cycle-4to7.mp4 (derived from chinese2.mp4)
business_male_1 -> D:/code/avatar/MuseTalk/data/public/商务男确定.mp4
chen_yu         -> D:/code/avatar/MuseTalk/data/public/陈屿.mp4
```

The Chinese avatar uses the same 15 FPS `4s -> 7s -> 4s` cycle for idle playback
and MuseTalk inference. The cycle omits duplicate turnaround frames and keeps the
hands in one relaxed pose. On return from speech, the browser resumes this asset
at the source phase immediately following the final generated frame.

The other versioned `idle-*-0to1-*.mp4` files remain short 24 FPS ping-pong
previews for their matching backend sources.

The source MuseTalk repository carries an MIT license for its software. Verify
each depicted person's separate portrait/model release before public or
commercial deployment.
