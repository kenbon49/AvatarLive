# Alibaba Cloud public avatar previews

The catalog was synchronized from the authenticated Alibaba Cloud Wanxiang
Digital Human official-avatar console on 2026-09-13. It contains 182 public
avatars: 61 male and 121 female entries.

- `covers/` contains all 182 official display covers, resized proportionally
  to a maximum width of 540 pixels without cropping.
- `videos/` contains the 170 official display previews exposed by the catalog,
  preserved at their original resolution and encoding. The remaining 12 3D/UE
  entries did not include a preview URL in the console response.
- `src/data/aliyun-public-avatars.json` preserves the official names, avatar
  IDs, source types, business scenarios, aspect ratios, and local media paths.

The checked-in catalog contains no account cookies, phone number, SMS code, or
temporary OSS signatures. Production synthesis may still require product
activation and an Alibaba Cloud resource mapping for the chosen avatar ID.
