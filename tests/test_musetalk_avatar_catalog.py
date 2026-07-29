from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from apps.musetalk.avatar_catalog import AvatarCatalogError, load_avatar_catalog


class AvatarCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.cache = self.root / "cache" / "fallback.npz"
        self.fallback = self.root / "fallback" / "manifest.json"
        self.fallback.parent.mkdir()
        self.fallback.write_text(json.dumps({"profile": "fallback"}), encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _write_catalog(self, payload: dict) -> Path:
        path = self.root / "avatars" / "manifest.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def _entry(self, profile_id: str) -> dict[str, str]:
        directory = self.root / "avatars" / profile_id
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "manifest.json").write_text("{}", encoding="utf-8")
        return {
            "id": profile_id,
            "label": profile_id.title(),
            "thumbnail": f"/assets/musetalk-body/{profile_id}/reference.png",
        }

    def test_missing_catalog_uses_backward_compatible_single_profile(self) -> None:
        catalog = load_avatar_catalog(
            self.root / "missing.json",
            fallback_manifest_path=self.fallback,
            fallback_cache_path=self.cache,
        )

        self.assertEqual(catalog.default, "fallback")
        self.assertEqual([profile.id for profile in catalog.profiles], ["fallback"])
        self.assertEqual(catalog.profiles[0].manifest_path, self.fallback.resolve())

    def test_catalog_resolves_manifests_and_per_profile_caches(self) -> None:
        first = self._entry("first-host")
        second = self._entry("second-host")
        path = self._write_catalog(
            {"default": "first-host", "avatars": [first, second]}
        )

        catalog = load_avatar_catalog(
            path,
            fallback_manifest_path=self.fallback,
            fallback_cache_path=self.cache,
        )

        self.assertEqual(catalog.default, "first-host")
        self.assertEqual([profile.id for profile in catalog.profiles], ["first-host", "second-host"])
        self.assertEqual(catalog.profiles[1].cache_path, self.cache.parent / "second-host-v15.npz")

    def test_rejects_duplicate_missing_default_and_path_escape(self) -> None:
        valid = self._entry("first-host")
        cases = (
            ({"default": "missing", "avatars": [valid]}, "default"),
            ({"default": "first-host", "avatars": [valid, valid]}, "duplicate"),
            (
                {
                    "default": "first-host",
                    "avatars": [{**valid, "manifest": "../outside.json"}],
                },
                "inside",
            ),
        )
        for payload, message in cases:
            with self.subTest(message=message):
                path = self._write_catalog(payload)
                with self.assertRaisesRegex(AvatarCatalogError, message):
                    load_avatar_catalog(
                        path,
                        fallback_manifest_path=self.fallback,
                        fallback_cache_path=self.cache,
                    )


if __name__ == "__main__":
    unittest.main()
