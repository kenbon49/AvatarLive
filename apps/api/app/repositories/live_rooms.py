"""Live-room persistence operations."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import Select, select, update
from sqlalchemy.orm import Session

from ..models.live_room import LiveRoom, utc_now


class LiveRoomVersionConflict(Exception):
    """Raised when a stale browser attempts to overwrite a newer draft."""


def _ordered_rooms() -> Select[tuple[LiveRoom]]:
    return select(LiveRoom).order_by(LiveRoom.created_at.asc(), LiveRoom.id.asc())


def list_live_rooms(db: Session, *, offset: int = 0, limit: int = 50) -> list[LiveRoom]:
    return list(db.scalars(_ordered_rooms().offset(offset).limit(limit)))


def get_live_room(db: Session, room_id: str) -> LiveRoom | None:
    return db.get(LiveRoom, room_id)


def create_live_room(db: Session, *, name: str, config: dict, slug: str | None = None) -> LiveRoom:
    room = LiveRoom(
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
    )


def publish_live_room(db: Session, room: LiveRoom) -> LiveRoom:
    room.status = "published"
    room.version += 1
    room.updated_at = utc_now()
    db.commit()
    db.refresh(room)
    return room
