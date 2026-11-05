#!/usr/bin/env python3
"""Package the catalog's covers and previews, including Git-ignored MP4 files."""

from __future__ import annotations

import argparse
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile


ROOT = Path(__file__).resolve().parents[1]
CATALOG = Path("src/data/aliyun-public-avatars.json")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default=date.today().isoformat())
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--part-size-mib", type=int, default=512)
    args = parser.parse_args()
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", args.version):
        parser.error("version must contain only letters, digits, dots, underscores and hyphens")
    if args.part_size_mib <= 0:
        parser.error("part-size-mib must be positive")

    catalog = json.loads((ROOT / CATALOG).read_text(encoding="utf-8"))
    paths = set()
    for avatar in catalog:
        for key, folder, suffix in (("image", "covers", ".webp"), ("previewVideo", "videos", ".mp4")):
            value = avatar.get(key)
            if not value:
                if key == "image":
                    raise ValueError(f"Missing cover for {avatar['id']}")
                continue
            expected = f"/assets/aliyun-avatars/{folder}/{avatar['id']}{suffix}"
            if value != expected or not re.fullmatch(r"[A-Za-z0-9_-]+", avatar["id"]):
                raise ValueError(f"Unexpected catalog asset path: {value}")
            path = Path("public" + value)
            if not (ROOT / path).is_file() or not (ROOT / path).stat().st_size:
                raise ValueError(f"Missing or empty asset: {path}")
            paths.add(path)

    output = args.output_dir or ROOT / "output" / f"avatar-previews-{args.version}"
    output.mkdir(parents=True, exist_ok=True)
    # A fresh destination prevents a stale ZIP from being published with a new manifest.
    if any(output.iterdir()):
        raise ValueError(f"Output directory must be empty: {output}")
    parts: list[list[Path]] = [[]]
    part_bytes = 0
    for path in sorted(paths):
        size = (ROOT / path).stat().st_size
        if parts[-1] and part_bytes + size > args.part_size_mib * 1024 * 1024:
            parts.append([])
            part_bytes = 0
        parts[-1].append(path)
        part_bytes += size

    manifest = {
        "schemaVersion": 1,
        "repository": "kenbon49/AvatarLive",
        "version": args.version,
        "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
        "catalog": {
            "path": CATALOG.as_posix(),
            "sha256": sha256(ROOT / CATALOG),
            "avatarCount": len(catalog),
            "videoCount": sum(bool(avatar.get("previewVideo")) for avatar in catalog),
        },
        "files": [],
        "archives": [],
    }
    for index, paths_in_part in enumerate(parts, 1):
        name = f"aliyun-avatar-previews-{args.version}-part-{index:02d}.zip"
        archive = output / name
        # Videos and WebP are already compressed. Store them without re-encoding.
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_STORED) as bundle:
            for path in paths_in_part:
                digest = hashlib.sha256()
                size = 0
                info = zipfile.ZipInfo(path.as_posix(), date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = 0o100644 << 16
                with (ROOT / path).open("rb") as source, bundle.open(info, "w", force_zip64=True) as target:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        target.write(chunk)
                        digest.update(chunk)
                        size += len(chunk)
                manifest["files"].append({
                    "path": path.as_posix(), "bytes": size,
                    "sha256": digest.hexdigest(), "archive": name,
                })
        manifest["archives"].append({
            "name": name, "bytes": archive.stat().st_size,
            "sha256": sha256(archive), "fileCount": len(paths_in_part),
        })
        print(f"Packaged {name}: {len(paths_in_part)} files, {archive.stat().st_size:,} bytes", flush=True)

    manifest_path = output / "aliyun-avatar-previews-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sums = [f"{entry['sha256']}  {entry['name']}\n" for entry in manifest["archives"]]
    sums.append(f"{sha256(manifest_path)}  {manifest_path.name}\n")
    (output / "SHA256SUMS").write_text("".join(sums), encoding="utf-8")
    print(f"Complete: {len(manifest['files'])} files in {len(parts)} ZIP archives at {output}")


if __name__ == "__main__":
    main()
