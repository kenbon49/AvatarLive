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

## Download the preview resources

The media files are excluded from Git. The September 18 resource release
included covers but omitted the ignored MP4 files. The complete current
previews are distributed separately in
[avatar-previews-2026-11-05](https://github.com/kenbon49/AvatarLive/releases/tag/avatar-previews-2026-11-05):
182 WebP covers and 170 original MP4 videos in four independent ZIP archives.
The 12 catalog entries without a preview URL intentionally have no MP4.
Legacy PNG covers are not required by the current catalog.

On Windows, run from the repository root before building the web image:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-aliyun-avatar-assets.ps1
```

The script downloads the manifest and ZIPs into `.cache/avatar-previews-2026-11-05`,
verifies each archive's SHA256, extracts to `public/assets/aliyun-avatars/`,
and verifies every restored file. For an offline installation, download the
four ZIPs and `aliyun-avatar-previews-manifest.json` on another machine and use:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\restore-aliyun-avatar-assets.ps1 -DownloadDirectory D:\Downloads\avatar-previews
```

On Linux/macOS, download all four ZIPs, the manifest and `SHA256SUMS` from the
release into one directory. Verify there with `sha256sum -c SHA256SUMS`
(`shasum -a 256 -c SHA256SUMS` on macOS), then extract each ZIP into the
repository root. The ZIP entries already contain the `public/assets/...` prefix:

```bash
for archive in /path/to/downloads/aliyun-avatar-previews-2026-11-05-part-*.zip; do
  unzip -o "$archive" -d /path/to/AvatarLive
done
```

Deploy or rebuild the web image after extraction; `Dockerfile.web` copies these
files from `public` into the image. Restoring the files on the host alone does
not update an already built container.

## Repackage

```bash
python3 scripts/package-aliyun-avatar-assets.py --version 2026-11-05
```

This reads the checked-in catalog directly and explicitly includes its media
paths, regardless of Git ignore rules. It validates that every referenced file
exists, preserves the original media bytes, and writes independent ZIPs up to
512 MiB of source data per part, a file manifest, and `SHA256SUMS` under
`output/avatar-previews-2026-11-05/`. Use an empty output directory for each run.
