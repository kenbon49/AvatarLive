"""CRUD endpoints for persistent live-room control-console drafts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...repositories import live_rooms as repository
from ...schemas.live_room import (
    LiveRoomCopy,
    LiveRoomCreate,
    LiveRoomResponse,
    LiveRoomUpdate,
)

router = APIRouter(prefix="/live-rooms", tags=["live rooms"])


def require_room(db: Session, room_id: str):
    room = repository.get_live_room(db, room_id)
    if room is None:
        raise HTTPException(status_code=404, detail="live room not found")
    return room


@router.get("", response_model=list[LiveRoomResponse], response_model_exclude_none=True)
def list_rooms(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list:
    return repository.list_live_rooms(db, offset=offset, limit=limit)


@router.post(
    "",
    response_model=LiveRoomResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_room(payload: LiveRoomCreate, db: Session = Depends(get_db)):
    return repository.create_live_room(
        db,
        name=payload.name,
        config=payload.config.model_dump(mode="json", by_alias=True),
    )


@router.get("/{room_id}", response_model=LiveRoomResponse, response_model_exclude_none=True)
def get_room(room_id: str, db: Session = Depends(get_db)):
    return require_room(db, room_id)


@router.put("/{room_id}", response_model=LiveRoomResponse, response_model_exclude_none=True)
def update_room(room_id: str, payload: LiveRoomUpdate, db: Session = Depends(get_db)):
    room = require_room(db, room_id)
    try:
        return repository.update_live_room(
            db,
            room,
            name=payload.name,
            config=payload.config.model_dump(mode="json", by_alias=True),
            expected_version=payload.expected_version,
        )
    except repository.LiveRoomVersionConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="live room was updated elsewhere; reload before saving",
        ) from exc


@router.post(
    "/{room_id}/copy",
    response_model=LiveRoomResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def copy_room(room_id: str, payload: LiveRoomCopy, db: Session = Depends(get_db)):
    return repository.copy_live_room(db, require_room(db, room_id), name=payload.name)


@router.post("/{room_id}/publish", response_model=LiveRoomResponse, response_model_exclude_none=True)
def publish_room(room_id: str, db: Session = Depends(get_db)):
    return repository.publish_live_room(db, require_room(db, room_id))
