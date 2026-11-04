"""Move embedded room media into authenticated binary records."""

from __future__ import annotations

import base64
import binascii
import hashlib
import re

from sqlalchemy.orm import Session

from ..models.live_room import LiveRoom, LiveRoomMedia


DATA_URL_TYPE = re.compile(r"^data:(image/(?:png|jpeg|webp|gif|avif)|video/(?:mp4|webm|quicktime));base64$", re.I)
MAX_MEDIA_BYTES = 20 * 1024 * 1024


def externalize_room_media(db: Session, owner_id: str | None, config: dict) -> tuple[dict, bool]:
    seen: set[str] = set()
    changed = False

    def replace(value):
        nonlocal changed
        if isinstance(value, dict):
            return {key: replace(item) for key, item in value.items()}
        if isinstance(value, list):
            return [replace(item) for item in value]
        if not isinstance(value, str) or not value.startswith("data:"):
            return value

        header, separator, encoded = value.partition(",")
        match = DATA_URL_TYPE.fullmatch(header) if separator else None
        if not match or len(encoded) > MAX_MEDIA_BYTES * 4 // 3 + 8:
            return value
        try:
            data = base64.b64decode(encoded, validate=True)
        except binascii.Error:
            return value
        if not data or len(data) > MAX_MEDIA_BYTES:
            return value

        content_type = match.group(1).lower()
        digest = hashlib.sha256((owner_id or "legacy").encode() + b"\0" + content_type.encode() + b"\0" + data).hexdigest()
        if digest not in seen and db.get(LiveRoomMedia, digest) is None:
            db.add(LiveRoomMedia(id=digest, owner_id=owner_id, content_type=content_type, data=data))
        seen.add(digest)
        changed = True
        return f"/api/v1/live-rooms/media/{digest}"

    result = replace(config)
    if changed:
        db.flush()
    return result, changed


def materialize_existing_room(db: Session, room: LiveRoom) -> bool:
    config, changed = externalize_room_media(db, room.owner_id, room.config)
    if changed:
        room.config = config
    return changed
