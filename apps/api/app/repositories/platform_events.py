"""Persistence operations for normalized inbound platform events."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.platform_event import PlatformLiveEvent
from ..schemas.platform_event import PlatformEventCreate, PlatformEventType


def get_event_by_external_id(
    db: Session,
    *,
    platform: str,
    live_room_id: str,
    external_event_id: str,
) -> PlatformLiveEvent | None:
    return db.scalar(
        select(PlatformLiveEvent).where(
            PlatformLiveEvent.platform == platform,
            PlatformLiveEvent.live_room_id == live_room_id,
            PlatformLiveEvent.external_event_id == external_event_id,
        )
    )


def create_event(
    db: Session,
    *,
    platform: str,
    payload: PlatformEventCreate,
) -> tuple[PlatformLiveEvent, bool]:
    existing = get_event_by_external_id(
        db,
        platform=platform,
        live_room_id=payload.live_room_id,
        external_event_id=payload.external_event_id,
    )
    if existing is not None:
        return existing, True

    event = PlatformLiveEvent(platform=platform, **payload.model_dump())
    db.add(event)
    try:
        db.commit()
    except IntegrityError:
        # The unique constraint is the final guard when two deliveries race.
        db.rollback()
        existing = get_event_by_external_id(
            db,
            platform=platform,
            live_room_id=payload.live_room_id,
            external_event_id=payload.external_event_id,
        )
        if existing is None:
            raise
        return existing, True
    db.refresh(event)
    return event, False


def list_events(
    db: Session,
    *,
    live_room_id: str,
    event_type: PlatformEventType | None = None,
    received_after: datetime | None = None,
    limit: int = 100,
) -> list[PlatformLiveEvent]:
    statement = select(PlatformLiveEvent).where(PlatformLiveEvent.live_room_id == live_room_id)
    if event_type is not None:
        statement = statement.where(PlatformLiveEvent.event_type == event_type)
    if received_after is not None:
        statement = statement.where(PlatformLiveEvent.received_at > received_after)
    statement = statement.order_by(PlatformLiveEvent.received_at.asc(), PlatformLiveEvent.id.asc()).limit(limit)
    return list(db.scalars(statement))
