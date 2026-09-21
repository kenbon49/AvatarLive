"""CRUD endpoints for persistent live-room control-console drafts."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import ValidationError
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...repositories import live_rooms as repository
from ...schemas.live_room import (
    LiveRoomCopy,
    LiveRoomConfig,
    LiveRoomCreate,
    LiveRoomLayerChanges,
    LiveRoomLayerItem,
    LiveRoomPatch,
    LiveRoomResponse,
    LiveRoomSaveResponse,
    LiveRoomUpdate,
)
from ...models.account import User
from ...security.accounts import owns, require_user

router = APIRouter(prefix="/live-rooms", tags=["live rooms"])

LAYER_FIELD_NAMES = {
    field.alias or name
    for name, field in LiveRoomLayerItem.model_fields.items()
}


def require_room(db: Session, room_id: str, user: User | None = None):
    room = repository.get_live_room(db, room_id)
    if room is None or (user is not None and not owns(room.owner_id, user)):
        raise HTTPException(status_code=404, detail="live room not found")
    return room


def invalid_patch(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail)


def apply_layer_changes(config: dict, changes: LiveRoomLayerChanges) -> None:
    layers = [dict(layer) for layer in config.get("layers", [])]
    ids = [str(layer.get("id", "")) for layer in layers]
    if len(ids) != len(set(ids)):
        raise invalid_patch("saved layer IDs must be unique")

    delete_ids = changes.delete_ids
    if len(delete_ids) != len(set(delete_ids)):
        raise invalid_patch("deleteIds must not contain duplicates")
    delete_set = set(delete_ids)
    unknown_deletes = delete_set - set(ids)
    if unknown_deletes:
        raise invalid_patch(f"cannot delete unknown layers: {', '.join(sorted(unknown_deletes))}")
    layers = [layer for layer in layers if layer["id"] not in delete_set]

    by_id = {layer["id"]: layer for layer in layers}
    upsert_ids = [layer.id for layer in changes.upsert]
    if len(upsert_ids) != len(set(upsert_ids)):
        raise invalid_patch("upsert must contain each layer at most once")
    for layer in changes.upsert:
        value = layer.model_dump(mode="json", by_alias=True, exclude_none=True)
        if layer.id in by_id:
            index = next(index for index, item in enumerate(layers) if item["id"] == layer.id)
            layers[index] = value
        else:
            layers.append(value)
        by_id[layer.id] = value

    patch_ids = [patch.id for patch in changes.patches]
    if len(patch_ids) != len(set(patch_ids)):
        raise invalid_patch("patches must contain each layer at most once")
    for patch in changes.patches:
        layer = by_id.get(patch.id)
        if layer is None:
            raise invalid_patch(f"cannot patch unknown layer: {patch.id}")
        unknown_fields = set(patch.changes) - LAYER_FIELD_NAMES
        if unknown_fields:
            raise invalid_patch(f"unknown layer fields: {', '.join(sorted(unknown_fields))}")
        if "id" in patch.changes:
            raise invalid_patch("layer IDs cannot be changed")
        for field, value in patch.changes.items():
            if value is None:
                layer.pop(field, None)
            else:
                layer[field] = value

    if changes.order is not None:
        if len(changes.order) != len(set(changes.order)):
            raise invalid_patch("layer order must not contain duplicates")
        if set(changes.order) != set(by_id):
            raise invalid_patch("layer order must contain every saved layer exactly once")
        layers = [by_id[layer_id] for layer_id in changes.order]
    config["layers"] = layers


def merge_config_changes(current: dict, payload: LiveRoomPatch) -> dict:
    config = dict(current)
    changes = payload.changes
    if changes is None:
        return config
    config.update(changes.model_dump(
        mode="json",
        by_alias=True,
        exclude_unset=True,
        exclude={"layers"},
    ))
    if changes.layers is not None:
        apply_layer_changes(config, changes.layers)
    try:
        return LiveRoomConfig.model_validate(config).model_dump(mode="json", by_alias=True)
    except ValidationError as exc:
        detail = [
            {
                "loc": ["config", *error.get("loc", ())],
                "msg": error.get("msg", "invalid value"),
                "type": error.get("type", "validation_error"),
            }
            for error in exc.errors()
        ]
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=detail) from exc


@router.get("", response_model=list[LiveRoomResponse], response_model_exclude_none=True)
def list_rooms(
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> list:
    return repository.list_live_rooms(db, owner_id=user.id, offset=offset, limit=limit)


@router.post(
    "",
    response_model=LiveRoomResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_room(payload: LiveRoomCreate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return repository.create_live_room(
        db,
        name=payload.name,
        config=payload.config.model_dump(mode="json", by_alias=True),
        owner_id=user.id,
    )


@router.get("/{room_id}", response_model=LiveRoomResponse, response_model_exclude_none=True)
def get_room(room_id: str, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return require_room(db, room_id, user)


@router.put("/{room_id}", response_model=LiveRoomResponse, response_model_exclude_none=True)
def update_room(room_id: str, payload: LiveRoomUpdate, db: Session = Depends(get_db), user: User = Depends(require_user)):
    room = require_room(db, room_id, user)
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


@router.patch("/{room_id}", response_model=LiveRoomSaveResponse)
def patch_room(room_id: str, payload: LiveRoomPatch, db: Session = Depends(get_db), user: User = Depends(require_user)):
    room = require_room(db, room_id, user)
    config = merge_config_changes(room.config, payload)
    try:
        return repository.update_live_room(
            db,
            room,
            name=payload.name or room.name,
            config=config,
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
def copy_room(room_id: str, payload: LiveRoomCopy, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return repository.copy_live_room(db, require_room(db, room_id, user), name=payload.name)


@router.post("/{room_id}/publish", response_model=LiveRoomResponse, response_model_exclude_none=True)
def publish_room(room_id: str, db: Session = Depends(get_db), user: User = Depends(require_user)):
    return repository.publish_live_room(db, require_room(db, room_id, user))


@router.delete("/{room_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
def delete_room(room_id: str, db: Session = Depends(get_db), user: User = Depends(require_user)) -> Response:
    repository.delete_live_room(db, require_room(db, room_id, user))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
