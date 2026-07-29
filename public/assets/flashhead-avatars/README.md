# FlashHead demo avatars

These portraits are bundled only for internal avatar-switching validation. Replace
them with identity-approved production assets before public or commercial use.

| File | Source | Notes |
| --- | --- | --- |
| `current.png` | Existing `cyberverse/cv_assets/face.jpg` | Existing validation asset; provenance was not recorded. |
| `warm-studio.png` | Soul-AILab/SoulX-FlashHead `examples/girl.png` | Official FlashHead example downloaded on 2026-07-20. |
| `calm-host.png` | thispersondoesnotexist.com | Site-provided StyleGAN2 synthetic portrait, downloaded on 2026-07-20. |
| `clear-host.png` | thispersondoesnotexist.com | Site-provided StyleGAN2 synthetic portrait, downloaded on 2026-07-20. |
| `bright-host.png` | thispersondoesnotexist.com | Site-provided StyleGAN2 synthetic portrait, downloaded on 2026-07-20. |
| `motion-host.png` | SoulX-LiveAct local demo `assets/1.mp4` | Frame-derived identity for the body-motion PoC; internal validation only. |

Sources:

- https://github.com/Soul-AILab/SoulX-FlashHead/blob/main/examples/girl.png
- https://thispersondoesnotexist.com/

The synthetic portraits retain their embedded StyleGAN2 attribution and were
resized to the model's native 512x512 input. Their use is intentionally limited
to internal testing because the source site does not publish a sufficiently clear
production license.
