"""Authenticated balance and server-side API usage accounting endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...models.account import User
from ...security.accounts import require_user
from ...services.billing import (
    bind_api_usage,
    charge_api_usage,
    fail_api_usage,
    mark_api_usage,
    pricing,
    settle_video_usage,
    wallet_response,
)
from ...services.cost_pricing import micros_to_credits


router = APIRouter(prefix="/billing", tags=["billing"])


class ChargeRequest(BaseModel):
    operation: Literal["llm_chat", "storyboard_video"]
    reference: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9:_.-]+$")
    detail: dict = Field(default_factory=dict)


class UsageStatusRequest(BaseModel):
    status: Literal["succeeded", "failed"]
    reason: str = Field(default="", max_length=300)


class ProviderReferenceRequest(BaseModel):
    resource_id: str = Field(min_length=1, max_length=160, pattern=r"^[A-Za-z0-9:_.-]+$")


class VideoSettlementRequest(BaseModel):
    duration_seconds: float = Field(gt=0, le=86_400)


@router.get("/balance")
def balance(user: User = Depends(require_user)) -> dict:
    return {**wallet_response(user), "pricing": pricing(), "creditsPerRmb": 100}


@router.post("/charge")
def charge(payload: ChargeRequest, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    if len(str(payload.detail)) > 2000:
        raise HTTPException(status_code=422, detail="计费附加信息过长")
    usage = charge_api_usage(db, user, payload.operation, payload.reference, detail=payload.detail)
    db.refresh(user)
    return {
        "usageId": usage.id,
        "credits": micros_to_credits(usage.reserved_micros),
        "reservedMicros": usage.reserved_micros,
        **wallet_response(user),
    }


@router.put("/usages/{usage_id}/provider-reference")
def provider_reference(
    usage_id: str,
    payload: ProviderReferenceRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    usage = bind_api_usage(db, usage_id, user.id, payload.resource_id)
    return {"ok": True, "status": usage.status}


@router.post("/usages/{usage_id}/settle-video")
def settle_video(
    usage_id: str,
    payload: VideoSettlementRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    usage = settle_video_usage(db, usage_id, user.id, payload.duration_seconds)
    db.refresh(user)
    return {
        "ok": True,
        "status": usage.status,
        "chargedMicros": usage.settled_micros,
        "upstreamCostMicros": usage.upstream_cost_micros,
        **wallet_response(user),
    }


@router.put("/usages/{usage_id}/status")
def usage_status(
    usage_id: str,
    payload: UsageStatusRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    if payload.status == "failed":
        fail_api_usage(db, usage_id, user.id, payload.reason)
    else:
        mark_api_usage(db, usage_id, user.id, payload.status)
    return {"ok": True}
