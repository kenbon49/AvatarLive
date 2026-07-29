# QuickTalk A/B measurement

`measure-video-ab.py` compares a rendered 100-frame clip with the immutable
template sequence using only OpenCV and the face boxes/six-point landmarks in
the action NPZ. It does not call a running renderer.

MuseTalk baseline:

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  artifacts/quicktalk-ab/measure-video-ab.py
```

QuickTalk comparison, using exactly the same template, audio, and ROIs:

```bash
/home/super/miniconda3/envs/cyberverse/bin/python \
  artifacts/quicktalk-ab/measure-video-ab.py \
  --candidate artifacts/quicktalk-ab/welcome/welcome-quicktalk-100f.mp4 \
  --label quicktalk \
  --render-wall-seconds SECONDS \
  --output-json artifacts/quicktalk-ab/welcome/quicktalk-metrics.json
```

The candidate must contain 100 decoded RGB frames at 360 x 624 in the same
source-frame order as `welcome-template-100f.mp4`. Use
`welcome-audio.wav`, not audio extracted from an AAC viewing file, as model
input.

Key metrics:

- `mae_rgb_0_255`: candidate-to-template absolute RGB error.
- `changed_pixel_ratio`: fraction of pixels whose mean RGB error exceeds 8.
- `residual_temporal_mad_rgb`: frame-to-frame change of the
  candidate-minus-template residual; this exposes a changing face layer.
- `color_pumping`: temporal variation of mean Lab residual color.
- `mouth_pixel_activity`: adjacent-frame motion in a geometry-normalized
  mouth crop. It is a pixel-activity diagnostic, not a phoneme sync score.
- `outside_face`: codec/preservation control. Compare face-region error with
  this value rather than treating all encoded pixel differences as model edits.

Generation wall time cannot be recovered from an MP4. Pass the measured value
with `--render-wall-seconds`; otherwise the JSON deliberately leaves render FPS
null instead of confusing it with the 25 FPS playback rate.
