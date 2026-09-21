"""Authenticated balance and server-side API usage accounting endpoints."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...models.account import User
from ...security.accounts import require_user
from ...services.billing import charge_api_usage, mark_api_usage, pricing


router = APIRouter(prefix="/billing", tags=["billing"])


class ChargeRequest(BaseModel):
    operation: Literal["llm_chat", "storyboard_video"]
    reference: str = Field(min_length=8, max_length=120, pattern=r"^[A-Za-z0-9:_.-]+$")
    detail: dict = Field(default_factory=dict)


class UsageStatusRequest(BaseModel):
    status: Literal["succeeded", "failed"]


@router.get("/balance")
def balance(user: User = Depends(require_user)) -> dict:
    return {"balance": user.credit_balance, "unlimited": user.role == "admin", "pricing": pricing()}


@router.post("/charge")
def charge(payload: ChargeRequest, user: User = Depends(require_user), db: Session = Depends(get_db)) -> dict:
    if len(str(payload.detail)) > 2000:
        raise HTTPException(status_code=422, detail="计费附加信息过长")
    usage = charge_api_usage(db, user, payload.operation, payload.reference, detail=payload.detail)
    db.refresh(user)
    return {"usageId": usage.id, "credits": usage.credits, "balance": user.credit_balance, "unlimited": user.role == "admin"}


@router.put("/usages/{usage_id}/status")
def usage_status(
    usage_id: str,
    payload: UsageStatusRequest,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
) -> dict:
    mark_api_usage(db, usage_id, user.id, payload.status)
    return {"ok": True}
