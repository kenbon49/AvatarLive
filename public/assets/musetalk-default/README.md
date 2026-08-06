# MuseTalk default idle avatar

The active idle avatar, `chinese.mp4`, is copied unchanged from:

```text
D:/code/avatar/MuseTalk/data/avatar_image/chinese.mp4
```

`american.mp4` is retained as an available fallback asset.

`chinese-idle-3f.mp4` is the browser idle loop. It contains three unique
closed-mouth frames extracted from source frames 16, 17, and 18, repeated at
3 FPS. The original `chinese.mp4` remains the inference source.

The live console keeps the idle video muted and loops its first second. It is
only the idle placeholder; generated audio/video replaces it as
soon as the `server_total` pipeline emits `stream_start`.

The source MuseTalk repository carries an MIT license for its software. Verify
each depicted person's separate portrait/model release before public or
commercial deployment.
