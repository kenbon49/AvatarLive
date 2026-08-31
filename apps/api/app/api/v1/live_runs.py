"""Server-authoritative preflight and persistent live-run APIs."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...repositories import live_runs as repository
from ...schemas.live_run import (
    LiveRunCreate,
    LiveRunPreflightRequest,
    LiveRunPreflightResponse,
    LiveRunResponse,
)
from ...services.live_runs import evaluate_preflight, media_supervisor

router = APIRouter(prefix="/live-runs", tags=["live runs"])


def require_run(db: Session, run_id: str):
    run = repository.get_live_run(db, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="live run not found")
    return run


def run_response(db: Session, run) -> LiveRunResponse:
    # Keep internal snapshots and process fields out of the public response.
    fields = {
        field: getattr(run, field)
        for field in LiveRunResponse.model_fields
        if field != "targets"
    }
    return LiveRunResponse.model_validate(
        {
            **fields,
            "targets": repository.list_live_run_targets(db, run.id),
        }
    )


@router.post("/preflight", response_model=LiveRunPreflightResponse, response_model_exclude_none=True)
def preflight(payload: LiveRunPreflightRequest, db: Session = Depends(get_db)):
    return evaluate_preflight(db, payload).response


@router.post(
    "",
    response_model=LiveRunResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_run(payload: LiveRunCreate, db: Session = Depends(get_db)):
    existing = repository.get_live_run_by_request_id(db, payload.request_id)
    if existing is not None:
        if existing.live_room_id != payload.live_room_id:
            raise HTTPException(status_code=409, detail="requestId is already used by another live room")
        return run_response(db, existing)

    evaluation = evaluate_preflight(db, payload)
    failed = [check.message for check in evaluation.response.checks if not check.passed]
    if not evaluation.response.ready or evaluation.room is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="开播预检未通过：" + "；".join(failed),
        )

    active = repository.get_active_live_run(db, payload.live_room_id)
    if active is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"该直播间已有未结束的运行记录：{active.id}",
        )
    try:
        run = repository.create_live_run(
            db,
            request_id=payload.request_id,
            room=evaluation.room,
            media_source_kind=payload.media_source.kind,
            media_source_id=payload.media_source.source_id,
            legal_source_confirmed=payload.legal_source_confirmed,
            connections=evaluation.connections,
        )
    except IntegrityError as exc:
        db.rollback()
        concurrent = repository.get_live_run_by_request_id(db, payload.request_id)
        if concurrent is not None:
            return run_response(db, concurrent)
        raise HTTPException(status_code=409, detail="live run could not be created concurrently") from exc
    return run_response(db, run)


@router.get("/{run_id}", response_model=LiveRunResponse, response_model_exclude_none=True)
def get_run(run_id: str, db: Session = Depends(get_db)):
    return run_response(db, require_run(db, run_id))


@router.post("/{run_id}/start", response_model=LiveRunResponse, response_model_exclude_none=True)
def start_run(run_id: str, db: Session = Depends(get_db)):
    require_run(db, run_id)
    try:
        media_supervisor.start(run_id)
    except LookupError as exc:
        raise HTTPException(status_code=404, detail="live run not found") from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    run = require_run(db, run_id)
    if run.status == "failed":
        raise HTTPException(status_code=409, detail=run.error_message or "媒体 supervisor 启动失败")
    return run_response(db, run)


@router.post("/{run_id}/stop", response_model=LiveRunResponse, response_model_exclude_none=True)
def stop_run(run_id: str, db: Session = Depends(get_db)):
    run = repository.request_stop(db, require_run(db, run_id))
    if run.status == "stopping":
        try:
            media_supervisor.stop(run_id)
        except LookupError:
            pass
    return run_response(db, require_run(db, run_id))
