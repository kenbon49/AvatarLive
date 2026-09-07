"""Signed webhook ingestion and polling APIs for normalized platform events."""

from __future__ import annotations

from datetime import datetime
import re

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from ...core.config import settings
from ...db.session import get_db
from ...models.live_run import LiveRun
from ...repositories.live_rooms import get_live_room
from ...repositories import platform_events as repository
from ...schemas.platform_event import (
    PlatformEventCreate,
    PlatformEventIngestResponse,
    PlatformEventResponse,
    PlatformEventType,
)
from ...services.platforms import (
    WebhookConfigurationError,
    WebhookSignatureError,
    resolve_webhook_secret,
    verify_webhook_signature,
    webhook_rate_limiter,
)

router = APIRouter(tags=["platform events"])
PLATFORM_SLUG = re.compile(r"^[a-z0-9][a-z0-9_-]{0,49}$")


def require_room(db: Session, room_id: str):
    room = get_live_room(db, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="live room not found")
    return room


@router.post(
    "/platform-events/webhooks/{platform}",
    response_model=PlatformEventIngestResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_202_ACCEPTED,
)
async def ingest_platform_event(
    platform: str,
    payload: PlatformEventCreate,
    request: Request,
    x_synlive_timestamp: str | None = Header(default=None),
    x_synlive_signature: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    normalized_platform = platform.lower()
    if not PLATFORM_SLUG.fullmatch(normalized_platform):
        raise HTTPException(status_code=404, detail="unsupported platform connector slug")
    try:
        secret = resolve_webhook_secret(settings.platform_webhook_secrets, normalized_platform)
    except WebhookConfigurationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    try:
        verify_webhook_signature(
            secret=secret,
            timestamp=x_synlive_timestamp,
            signature=x_synlive_signature,
            body=await request.body(),
            tolerance_seconds=settings.platform_webhook_signature_tolerance_seconds,
        )
    except WebhookSignatureError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc

    client_host = request.client.host if request.client else "unknown"
    rate_key = f"{normalized_platform}:{client_host}"
    if not webhook_rate_limiter.allow(rate_key, settings.platform_webhook_rate_limit_per_minute):
        raise HTTPException(status_code=429, detail="platform event rate limit exceeded", headers={"Retry-After": "60"})

    require_room(db, payload.live_room_id)
    if payload.live_run_id:
        live_run = db.get(LiveRun, payload.live_run_id)
        if live_run is None or live_run.live_room_id != payload.live_room_id:
            raise HTTPException(status_code=422, detail="live run does not belong to the live room")
    event, duplicate = repository.create_event(db, platform=normalized_platform, payload=payload)
    return PlatformEventIngestResponse(duplicate=duplicate, event=event)


@router.get(
    "/live-rooms/{room_id}/platform-events",
    response_model=list[PlatformEventResponse],
    response_model_exclude_none=True,
)
def list_platform_events(
    room_id: str,
    event_type: PlatformEventType | None = Query(default=None, alias="eventType"),
    received_after: datetime | None = Query(default=None, alias="receivedAfter"),
    limit: int = Query(default=100, ge=1, le=200),
    db: Session = Depends(get_db),
):
    require_room(db, room_id)
    return repository.list_events(
        db,
        live_room_id=room_id,
        event_type=event_type,
        received_after=received_after,
        limit=limit,
    )
