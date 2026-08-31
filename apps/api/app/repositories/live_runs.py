"""Persistence and guarded state transitions for live runs."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models.live_room import LiveRoom, utc_now
from ..models.live_run import LiveRun, LiveRunTarget
from ..models.platform_connection import PlatformConnection


ACTIVE_STATUSES = ("preparing", "ready", "starting", "live", "stopping")


def get_live_run(db: Session, run_id: str) -> LiveRun | None:
    return db.get(LiveRun, run_id)


def get_live_run_by_request_id(db: Session, request_id: str) -> LiveRun | None:
    return db.scalar(select(LiveRun).where(LiveRun.request_id == request_id))


def get_active_live_run(db: Session, live_room_id: str) -> LiveRun | None:
    return db.scalar(
        select(LiveRun)
        .where(LiveRun.live_room_id == live_room_id, LiveRun.status.in_(ACTIVE_STATUSES))
        .order_by(LiveRun.created_at.desc())
        .limit(1)
    )


def list_live_run_targets(db: Session, run_id: str) -> list[LiveRunTarget]:
    return list(
        db.scalars(
            select(LiveRunTarget)
            .where(LiveRunTarget.live_run_id == run_id)
            .order_by(LiveRunTarget.created_at.asc(), LiveRunTarget.id.asc())
        )
    )


def create_live_run(
    db: Session,
    *,
    request_id: str,
    room: LiveRoom,
    media_source_kind: str,
    media_source_id: str | None,
    legal_source_confirmed: bool,
    connections: list[PlatformConnection],
) -> LiveRun:
    run = LiveRun(
        request_id=request_id,
        live_room_id=room.id,
        status="ready",
        room_version=room.version,
        config_snapshot=dict(room.config),
        media_source_kind=media_source_kind,
        media_source_id=media_source_id,
        legal_source_confirmed=legal_source_confirmed,
    )
    db.add(run)
    db.flush()
    for connection in connections:
        db.add(
            LiveRunTarget(
                live_run_id=run.id,
                platform_connection_id=connection.id,
                connection_version=connection.version,
                connection_name=connection.name,
                platform_label=connection.platform_label,
                server_url=connection.server_url,
                stream_key_ciphertext=connection.stream_key_ciphertext,
                stream_key_last4=connection.stream_key_last4,
                status="pending",
            )
        )
    db.commit()
    db.refresh(run)
    return run


def request_stop(db: Session, run: LiveRun) -> LiveRun:
    if run.status in {"stopped", "failed"}:
        return run
    now = utc_now()
    if run.status in {"preparing", "ready"}:
        run.status = "stopped"
        run.stopped_at = now
        for target in list_live_run_targets(db, run.id):
            target.status = "stopped"
            target.stopped_at = now
            target.updated_at = now
    else:
        # The media supervisor completes this transition after child processes exit.
        run.status = "stopping"
        for target in list_live_run_targets(db, run.id):
            if target.status not in {"stopped", "failed"}:
                target.status = "stopping"
                target.updated_at = now
    run.updated_at = now
    db.commit()
    db.refresh(run)
    return run
