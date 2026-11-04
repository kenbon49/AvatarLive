"""Live-room persistence operations."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import re
from uuid import uuid4

from sqlalchemy import Select, func, select, update
from sqlalchemy.orm import Session

from ..models.live_room import LiveRoom, LiveRoomPlaybackSession, utc_now
from ..models.live_run import LiveRun


YIJING_TEMPLATE_ID = re.compile(r"^yijing-(\d{1,6})$")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _room_card_details(config: dict) -> dict:
    layers = config.get("layers") or []
    background = next((layer.get("preview") for layer in layers
                       if isinstance(layer, dict) and layer.get("sceneKey") == "templateBackground"), None)
    cover = background if isinstance(background, str) and not background.endswith("/blank.png") else None
    if not cover:
        template = YIJING_TEMPLATE_ID.fullmatch(str(config.get("selectedTemplateId", "")))
        if template:
            cover = f"/assets/xiling-live/yijing/covers/{template.group(1)}.png"
    if not isinstance(cover, str) or len(cover) > 1000 or not (cover.startswith("/") and not cover.startswith("//")):
        cover = None

    scripts = config.get("scripts") or []
    first_script = next((script for script in scripts if isinstance(script, dict) and str(script.get("text", "")).strip()), None)
    preview = " ".join(str(first_script["text"]).split())[:160] if first_script else None
    return {
        "cover_url": cover,
        "avatar_id": config.get("avatarId") if isinstance(config.get("avatarId"), str) else None,
        "script_title": str(first_script.get("title", ""))[:200] if first_script else None,
        "script_preview": preview,
        "script_count": len(scripts),
    }


class LiveRoomVersionConflict(Exception):
    """Raised when a stale browser attempts to overwrite a newer draft."""


def _ordered_rooms() -> Select[tuple[LiveRoom]]:
    return select(LiveRoom).order_by(LiveRoom.created_at.asc(), LiveRoom.id.asc())


def list_live_rooms(db: Session, *, owner_id: str | None = None, offset: int = 0, limit: int = 50) -> list[LiveRoom]:
    statement = _ordered_rooms()
    if owner_id is not None:
        statement = statement.where(LiveRoom.owner_id == owner_id)
    return list(db.scalars(statement.offset(offset).limit(limit)))


def list_live_room_summaries(db: Session, *, owner_id: str, offset: int = 0, limit: int = 50) -> list[dict]:
    statement = (
        select(
            LiveRoom.id,
            LiveRoom.slug,
            LiveRoom.name,
            LiveRoom.status,
            LiveRoom.version,
            LiveRoom.created_at,
            LiveRoom.updated_at,
            LiveRoom.config,
        )
        .where(LiveRoom.owner_id == owner_id)
        .order_by(LiveRoom.created_at.asc(), LiveRoom.id.asc())
        .offset(offset)
        .limit(limit)
    )
    rows = list(db.execute(statement).mappings())
    if not rows:
        return []
    ids = [row["id"] for row in rows]
    duration_ms = {room_id: int(total or 0) for room_id, total in db.execute(
        select(LiveRoomPlaybackSession.live_room_id, func.sum(LiveRoomPlaybackSession.duration_ms))
        .where(LiveRoomPlaybackSession.live_room_id.in_(ids))
        .group_by(LiveRoomPlaybackSession.live_room_id)
    )}
    now = utc_now()
    for room_id, started, stopped, heartbeat, run_status in db.execute(
        select(LiveRun.live_room_id, LiveRun.started_at, LiveRun.stopped_at, LiveRun.heartbeat_at, LiveRun.status)
        .where(LiveRun.live_room_id.in_(ids), LiveRun.started_at.is_not(None))
    ):
        end = stopped or heartbeat
        if run_status == "live" and heartbeat and now - _utc(heartbeat) < timedelta(seconds=60):
            end = now
        if started and end:
            duration_ms[room_id] = duration_ms.get(room_id, 0) + max(0, int((_utc(end) - _utc(started)).total_seconds() * 1000))

    return [
        {
            **{key: value for key, value in row.items() if key != "config"},
            **_room_card_details(row["config"] or {}),
            "total_playback_seconds": duration_ms.get(row["id"], 0) // 1000,
        }
        for row in rows
    ]


def get_live_room(db: Session, room_id: str) -> LiveRoom | None:
    return db.get(LiveRoom, room_id)


def create_live_room(db: Session, *, name: str, config: dict, slug: str | None = None, owner_id: str | None = None) -> LiveRoom:
    room = LiveRoom(
        owner_id=owner_id,
        slug=slug or f"room-{uuid4().hex[:12]}",
        name=name,
        config=config,
    )
    db.add(room)
    db.commit()
    db.refresh(room)
    return room


def update_live_room(
    db: Session,
    room: LiveRoom,
    *,
    name: str,
    config: dict,
    expected_version: int,
) -> LiveRoom:
    statement = (
        update(LiveRoom)
        .where(LiveRoom.id == room.id, LiveRoom.version == expected_version)
        .values(
            name=name,
            config=config,
            status="draft",
            version=expected_version + 1,
            updated_at=utc_now(),
        )
    )
    result = db.execute(statement)
    if result.rowcount != 1:
        db.rollback()
        raise LiveRoomVersionConflict
    db.commit()
    db.refresh(room)
    return room


def copy_live_room(db: Session, room: LiveRoom, *, name: str | None = None) -> LiveRoom:
    return create_live_room(
        db,
        name=name or f"{room.name} - 副本",
        config=dict(room.config),
        owner_id=room.owner_id,
    )


def publish_live_room(db: Session, room: LiveRoom) -> LiveRoom:
    room.status = "published"
    room.version += 1
    room.updated_at = utc_now()
    db.commit()
    db.refresh(room)
    return room


def delete_live_room(db: Session, room: LiveRoom) -> None:
    db.delete(room)
    db.commit()
