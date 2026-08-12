# MuseTalk idle avatars

The frontend catalog mirrors the three public avatars exposed by the MuseTalk
backend:

```text
chinese         -> D:/code/avatar/MuseTalk/data/public/chinese2.mp4
business_male_1 -> D:/code/avatar/MuseTalk/data/public/商务男确定.mp4
chen_yu         -> D:/code/avatar/MuseTalk/data/public/陈屿.mp4
```

Each versioned `idle-*-0to1-*.mp4` is generated from the matching latest backend
video as a 24 FPS `0s -> 1s -> 0s` ping-pong sequence. The exact source frame at
1 second is retained at output time 1 second and encoded as a keyframe. Whenever
the first streamed video packet arrives, the frontend pauses and seeks directly
to that 1-second frame before releasing the buffered inference stream. On return,
the idle source seeks to 0 seconds and resumes before the canvas fades out.

The source MuseTalk repository carries an MIT license for its software. Verify
each depicted person's separate portrait/model release before public or
commercial deployment.
