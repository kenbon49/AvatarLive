"""Validated local avatar catalog for the MuseTalk action renderer."""

from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Any


_PROFILE_ID = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


class AvatarCatalogError(ValueError):
    """Raised when the local avatar catalog is unsafe or inconsistent."""


@dataclass(frozen=True)
class AvatarProfile:
    id: str
    label: str
    thumbnail: str
    manifest_path: Path
    cache_path: Path


@dataclass(frozen=True)
class AvatarCatalog:
    default: str
    profiles: tuple[AvatarProfile, ...]

    def by_id(self) -> dict[str, AvatarProfile]:
        return {profile.id: profile for profile in self.profiles}


def _safe_child(root: Path, value: Any, *, field: str, suffix: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise AvatarCatalogError(f"avatar {field} must be a non-empty string")
    relative = Path(value)
    if relative.is_absolute() or relative.suffix.lower() != suffix:
        raise AvatarCatalogError(f"avatar {field} must be a relative {suffix} path")
    resolved = (root / relative).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as exc:
        raise AvatarCatalogError(f"avatar {field} must stay inside its catalog root") from exc
    return resolved


def _fallback_profile(manifest_path: Path, cache_path: Path) -> AvatarCatalog:
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AvatarCatalogError(f"could not read fallback avatar manifest: {exc}") from exc
    profile_id = payload.get("profile", "default")
    if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
        raise AvatarCatalogError("fallback manifest profile is invalid")
    profile = AvatarProfile(
        id=profile_id,
        label="动作主播 PoC",
        thumbnail="/assets/musetalk-body/motion-host/reference.png",
        manifest_path=manifest_path,
        cache_path=cache_path,
    )
    return AvatarCatalog(default=profile_id, profiles=(profile,))


def load_avatar_catalog(
    catalog_path: str | Path | None,
    *,
    fallback_manifest_path: str | Path,
    fallback_cache_path: str | Path,
) -> AvatarCatalog:
    """Load fixed local paths; client input can only select a catalog id."""

    fallback_manifest = Path(fallback_manifest_path).expanduser().resolve()
    fallback_cache = Path(fallback_cache_path).expanduser().resolve()
    if catalog_path is None:
        return _fallback_profile(fallback_manifest, fallback_cache)

    path = Path(catalog_path).expanduser().resolve()
    if not path.is_file():
        return _fallback_profile(fallback_manifest, fallback_cache)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AvatarCatalogError(f"could not read avatar catalog: {exc}") from exc
    if not isinstance(payload, dict):
        raise AvatarCatalogError("avatar catalog must be an object")
    default = payload.get("default")
    entries = payload.get("avatars")
    if not isinstance(default, str) or not _PROFILE_ID.fullmatch(default):
        raise AvatarCatalogError("avatar catalog default is invalid")
    if not isinstance(entries, list) or not entries:
        raise AvatarCatalogError("avatar catalog avatars must be a non-empty array")

    asset_root = path.parent
    cache_root = fallback_cache.parent
    profiles: list[AvatarProfile] = []
    seen: set[str] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            raise AvatarCatalogError("each avatar catalog entry must be an object")
        profile_id = entry.get("id")
        label = entry.get("label")
        thumbnail = entry.get("thumbnail")
        if not isinstance(profile_id, str) or not _PROFILE_ID.fullmatch(profile_id):
            raise AvatarCatalogError("avatar id is invalid")
        if profile_id in seen:
            raise AvatarCatalogError(f"duplicate avatar id: {profile_id}")
        if not isinstance(label, str) or not label.strip():
            raise AvatarCatalogError(f"avatar {profile_id!r} label is invalid")
        if (
            not isinstance(thumbnail, str)
            or not thumbnail.startswith("/assets/musetalk-body/")
            or ".." in Path(thumbnail).parts
        ):
            raise AvatarCatalogError(f"avatar {profile_id!r} thumbnail is invalid")
        manifest = _safe_child(
            asset_root,
            entry.get("manifest", f"{profile_id}/manifest.json"),
            field="manifest",
            suffix=".json",
        )
        cache = _safe_child(
            cache_root,
            entry.get("cache", f"{profile_id}-v15.npz"),
            field="cache",
            suffix=".npz",
        )
        if not manifest.is_file():
            raise AvatarCatalogError(f"avatar manifest does not exist: {manifest}")
        profiles.append(
            AvatarProfile(
                id=profile_id,
                label=label.strip(),
                thumbnail=thumbnail,
                manifest_path=manifest,
                cache_path=cache,
            )
        )
        seen.add(profile_id)
    if default not in seen:
        raise AvatarCatalogError("avatar catalog default is not installed")
    return AvatarCatalog(default=default, profiles=tuple(profiles))
