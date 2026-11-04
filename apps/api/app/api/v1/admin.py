"""Account approval and allowlisted, encrypted operations configuration."""

from __future__ import annotations

from datetime import datetime, timezone
import os
from typing import Literal
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...db.session import get_db
from ...models.account import (
    ApiUsage,
    CreditLedgerEntry,
    LoginSession,
    SystemSetting,
    User,
    UserAdminAudit,
)
from ...models.live_library import Product
from ...models.live_room import LiveRoom
from ...models.platform_connection import PlatformConnection
from ...security.accounts import require_admin
from ...security.platform_secrets import SecretConfigurationError, SecretDecryptionError
from ...security.settings_store import (
    SETTING_FIELDS,
    effective_api_value,
    put_setting,
    put_settings,
    root_key,
    rotate_platform_key,
)
from ...services.llm import (
    LlmModelDiscoveryError,
    discover_litellm_models,
    get_litellm_default_model_id,
    resolve_litellm_model,
    validate_litellm_base_url,
)
from ...services.billing import (
    adjust_user_credits as adjust_user_wallet,
    allocate_credits,
    funding_summary,
    recharge_admin,
    sync_funding_from_provider_balance,
)
from ...services.cost_pricing import micros_to_credits
from ...services.provider_balances import latest_provider_snapshot, refresh_aliyun_balance, snapshot_response
from ...services.user_admin import record_user_admin_audit


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class SettingUpdate(BaseModel):
    value: str = Field(min_length=1, max_length=4096)


class CreditRecharge(BaseModel):
    amount: int = Field(ge=1, le=1_000_000_000)
    payment_reference: str = Field(min_length=4, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")


class CreditAllocation(BaseModel):
    amount: int = Field(ge=1, le=1_000_000_000)


class CreditAdjustment(BaseModel):
    mode: Literal["add", "subtract", "set"]
    amount: int = Field(ge=0, le=1_000_000_000)
    reason: str = Field(min_length=2, max_length=200)


class UserStatusUpdate(BaseModel):
    status: Literal["approved", "suspended"]
    reason: str = Field(min_length=2, max_length=200)


class LlmConfigurationUpdate(BaseModel):
    base_url: str = Field(min_length=1, max_length=2048)
    api_key: str | None = Field(default=None, max_length=4096)


class LlmDefaultModelUpdate(BaseModel):
    model_id: str = Field(min_length=1, max_length=200)


def _llm_configuration_response(models: list[dict]) -> dict:
    default_model = get_litellm_default_model_id()
    try:
        default_model = resolve_litellm_model(default_model)["display_model"]
    except ValueError:
        pass
    base_url = effective_api_value("llm_base_url").strip().rstrip("/")
    return {
        "configured": bool(base_url and effective_api_value("llm_api_key").strip()),
        "baseUrl": base_url,
        "keyConfigured": bool(effective_api_value("llm_api_key").strip()),
        "defaultModel": default_model,
        "models": models,
    }


def _managed_user_response(user: User, usage: dict | None = None) -> dict:
    usage = usage or {}
    available_micros = max(0, user.credit_balance_micros - user.reserved_balance_micros)
    return {
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "creditBalance": micros_to_credits(available_micros),
        "walletMicros": user.credit_balance_micros,
        "reservedMicros": user.reserved_balance_micros,
        "unlimited": user.role == "admin",
        "usedCredits": micros_to_credits(int(usage.get("used_micros", 0))),
        "upstreamCostRmb": float(int(usage.get("cost_micros", 0)) / 1_000_000),
        "apiCalls": int(usage.get("calls", 0)),
        "createdAt": user.created_at.isoformat(),
        "reviewedAt": user.reviewed_at.isoformat() if user.reviewed_at else None,
    }


@router.get("/users")
def list_users(db: Session = Depends(get_db)) -> list[dict]:
    usage_rows = db.execute(
        select(
            ApiUsage.user_id,
            func.count(ApiUsage.id),
            func.coalesce(func.sum(ApiUsage.settled_micros), 0),
            func.coalesce(func.sum(ApiUsage.upstream_cost_micros), 0),
        )
        .group_by(ApiUsage.user_id)
    ).all()
    usage = {
        user_id: {"calls": calls, "used_micros": used, "cost_micros": cost}
        for user_id, calls, used, cost in usage_rows
    }
    users = db.scalars(select(User).order_by(User.role.desc(), User.created_at.asc())).all()
    return [_managed_user_response(user, usage.get(user.id)) for user in users]


@router.get("/users/{user_id}")
def user_detail(user_id: str, db: Session = Depends(get_db)) -> dict:
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    usage_summary = db.execute(
        select(
            func.count(ApiUsage.id),
            func.coalesce(func.sum(ApiUsage.settled_micros), 0),
            func.coalesce(func.sum(ApiUsage.upstream_cost_micros), 0),
        )
        .where(ApiUsage.user_id == user.id)
    ).one()
    now = datetime.now(timezone.utc)
    active_sessions = db.scalar(
        select(func.count()).select_from(LoginSession)
        .where(LoginSession.user_id == user.id, LoginSession.expires_at > now)
    ) or 0
    latest_session_at = db.scalar(
        select(func.max(LoginSession.created_at)).where(LoginSession.user_id == user.id)
    )
    ledger = db.scalars(
        select(CreditLedgerEntry)
        .where(CreditLedgerEntry.user_id == user.id)
        .order_by(CreditLedgerEntry.created_at.desc())
        .limit(30)
    ).all()
    recent_usage = db.scalars(
        select(ApiUsage)
        .where(ApiUsage.user_id == user.id)
        .order_by(ApiUsage.created_at.desc())
        .limit(30)
    ).all()
    audits = db.scalars(
        select(UserAdminAudit)
        .where(UserAdminAudit.target_user_id == user.id)
        .order_by(UserAdminAudit.created_at.desc())
        .limit(50)
    ).all()
    actor_ids = {audit.actor_id for audit in audits}
    actors = {
        actor.id: actor for actor in db.scalars(select(User).where(User.id.in_(actor_ids))).all()
    } if actor_ids else {}
    return {
        "user": _managed_user_response(user, {
            "calls": usage_summary[0],
            "used_micros": usage_summary[1],
            "cost_micros": usage_summary[2],
        }),
        "resources": {
            "liveRooms": db.scalar(select(func.count()).select_from(LiveRoom).where(LiveRoom.owner_id == user.id)) or 0,
            "products": db.scalar(select(func.count()).select_from(Product).where(Product.owner_id == user.id)) or 0,
            "platformConnections": db.scalar(
                select(func.count()).select_from(PlatformConnection).where(PlatformConnection.owner_id == user.id)
            ) or 0,
            "activeSessions": active_sessions,
        },
        "lastSessionAt": latest_session_at.isoformat() if latest_session_at else None,
        "ledger": [{
            "id": entry.id,
            "kind": entry.kind,
            "amount": entry.amount,
            "balanceAfter": entry.balance_after,
            "amountMicros": entry.amount_micros,
            "balanceAfterMicros": entry.balance_after_micros,
            "description": entry.description,
            "createdAt": entry.created_at.isoformat(),
        } for entry in ledger],
        "usage": [{
            "id": item.id,
            "operation": item.operation,
            "status": item.status,
            "credits": item.credits,
            "chargedMicros": item.settled_micros,
            "upstreamCostMicros": item.upstream_cost_micros,
            "reservedMicros": item.reserved_micros,
            "provider": item.provider,
            "model": item.model,
            "pricingVersion": item.pricing_version,
            "pricingTimeBand": item.pricing_time_band,
            "createdAt": item.created_at.isoformat(),
        } for item in recent_usage],
        "audit": [{
            "id": audit.id,
            "action": audit.action,
            "detail": audit.detail,
            "actor": actors[audit.actor_id].username or actors[audit.actor_id].email
            if audit.actor_id in actors else "未知管理员",
            "createdAt": audit.created_at.isoformat(),
        } for audit in audits],
    }


@router.post("/credits/recharge")
def recharge(
    payload: CreditRecharge,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    balance = recharge_admin(db, admin, payload.amount, payload.payment_reference)
    return {"balance": balance, "availableCredits": balance, "amount": payload.amount}


@router.get("/billing-status")
def billing_status(db: Session = Depends(get_db)) -> dict:
    # The admin page only needs the platform funding pool. Keep any existing
    # provider snapshot for diagnostics without triggering a paid provider API
    # request every time the page loads.
    snapshot = latest_provider_snapshot(db)
    return {
        "funding": funding_summary(db),
        "providerBalance": snapshot_response(snapshot),
        "creditsPerRmb": 100,
        "deepseekBalance": {
            "status": "unavailable",
            "message": "当前 LiteLLM 网关未提供余额接口，按返回 Token 用量记录成本",
        },
    }


@router.post("/provider-balances/aliyun/refresh")
def refresh_provider_balance(
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    snapshot = refresh_aliyun_balance(db, force=True)
    if snapshot.status == "ok" and snapshot.available_micros is not None:
        sync_funding_from_provider_balance(
            db,
            admin,
            snapshot.available_micros,
            snapshot.id,
        )
    return {
        "funding": funding_summary(db),
        "providerBalance": snapshot_response(snapshot),
        "creditsPerRmb": 100,
    }


@router.post("/users/{user_id}/allocate")
def allocate(
    user_id: str,
    payload: CreditAllocation,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    pool_balance, user_balance = allocate_credits(db, admin, user_id, payload.amount)
    return {
        "adminBalance": pool_balance,
        "poolBalance": pool_balance,
        "userBalance": user_balance,
        "amount": payload.amount,
    }


@router.post("/users/{user_id}/credits/adjust")
def adjust_user_credits(
    user_id: str,
    payload: CreditAdjustment,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role != "user" or target.status not in {"approved", "suspended"}:
        raise HTTPException(status_code=422, detail="只能调整已审核普通用户的积分")
    if payload.mode in {"add", "subtract"} and payload.amount < 1:
        raise HTTPException(status_code=422, detail="增加或扣减积分必须大于 0")
    reason = payload.reason.strip()
    balance_after, delta = adjust_user_wallet(
        db, admin, target, payload.mode, payload.amount, reason,
    )
    return {"creditBalance": balance_after, "delta": delta}


@router.put("/users/{user_id}/status")
def update_user_status(
    user_id: str,
    payload: UserStatusUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    target = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role != "user":
        raise HTTPException(status_code=422, detail="不能修改管理员账户状态")
    if target.status not in {"approved", "suspended"}:
        raise HTTPException(status_code=409, detail="待审核或已拒绝账户不能执行该操作")
    if target.status == payload.status:
        return {"status": target.status, "sessionsRevoked": 0}
    status_before = target.status
    target.status = payload.status
    sessions_revoked = 0
    if payload.status == "suspended":
        result = db.execute(delete(LoginSession).where(LoginSession.user_id == target.id))
        sessions_revoked = result.rowcount or 0
    reason = payload.reason.strip()
    record_user_admin_audit(
        db,
        actor=admin,
        target=target,
        action="account_suspended" if payload.status == "suspended" else "account_restored",
        detail={
            "statusBefore": status_before,
            "statusAfter": payload.status,
            "reason": reason,
            "sessionsRevoked": sessions_revoked,
        },
    )
    db.commit()
    return {"status": target.status, "sessionsRevoked": sessions_revoked}


@router.get("/settings")
def list_settings(db: Session = Depends(get_db)) -> dict:
    rows = []
    for key, (label, secret, mode) in SETTING_FIELDS.items():
        saved = db.get(SystemSetting, key)
        if mode == "deployment":
            configured = bool(getattr(settings, key, "") or os.getenv(key.upper(), ""))
        elif mode == "rotation":
            configured = saved is not None or bool(settings.platform_encryption_key)
        else:
            configured = saved is not None or bool(getattr(settings, key, ""))
        row = {
            "key": key, "label": label, "secret": secret, "configured": configured,
            "mode": mode, "saved": saved is not None,
            "updatedAt": saved.updated_at.isoformat() if saved else None,
        }
        if key in {"llm_base_url", "llm_default_model_id"}:
            row["value"] = effective_api_value(key)
        rows.append(row)
    try:
        root_key()
        root_ready = True
    except SecretConfigurationError:
        root_ready = False
    return {"settings": rows, "rootKeyConfigured": root_ready}


@router.get("/llm/models")
async def list_llm_models() -> dict:
    api_key = effective_api_value("llm_api_key").strip()
    api_base = effective_api_value("llm_base_url").strip()
    if not api_key or not api_base:
        return _llm_configuration_response([])
    try:
        models = await discover_litellm_models(api_key=api_key, api_base=api_base)
    except (LlmModelDiscoveryError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return _llm_configuration_response(models)


@router.put("/llm/configuration")
async def update_llm_configuration(
    payload: LlmConfigurationUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    try:
        base_url = validate_litellm_base_url(payload.base_url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    supplied_key = payload.api_key.strip() if payload.api_key is not None else ""
    api_key = supplied_key or effective_api_value("llm_api_key").strip()
    if not api_key:
        raise HTTPException(status_code=422, detail="请填写 LLM API Key")
    try:
        models = await discover_litellm_models(api_key=api_key, api_base=base_url)
    except (LlmModelDiscoveryError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    values = {"llm_base_url": base_url}
    if supplied_key:
        values["llm_api_key"] = supplied_key
    try:
        put_settings(db, values, admin)
    except SecretConfigurationError as exc:
        raise HTTPException(status_code=503, detail="服务器根密钥尚未配置，无法安全保存设置") from exc
    return _llm_configuration_response(models)


@router.put("/llm/default-model")
async def update_llm_default_model(
    payload: LlmDefaultModelUpdate,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    model_id = payload.model_id.strip()
    try:
        resolve_litellm_model(model_id)
        models = await discover_litellm_models()
    except (LlmModelDiscoveryError, ValueError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if model_id not in {item["id"] for item in models}:
        raise HTTPException(status_code=422, detail="所选模型不在当前服务的模型列表中")
    try:
        put_setting(db, "llm_default_model_id", model_id, admin)
    except SecretConfigurationError as exc:
        raise HTTPException(status_code=503, detail="服务器根密钥尚未配置，无法安全保存设置") from exc
    return _llm_configuration_response(models)


@router.put("/settings/{name}")
def update_setting(name: str, payload: SettingUpdate, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    if name not in SETTING_FIELDS:
        raise HTTPException(status_code=404, detail="未知配置项")
    if name in {"llm_api_key", "llm_base_url", "llm_default_model_id"}:
        raise HTTPException(status_code=422, detail="请通过大模型服务配置页面修改 LLM 设置")
    value = payload.value.strip()
    if not value or any(ord(character) < 32 for character in value):
        raise HTTPException(status_code=422, detail="配置值不能为空或包含控制字符")
    if name.endswith("_url") or name == "database_url":
        parsed = urlparse(value)
        if not parsed.scheme or not parsed.hostname:
            raise HTTPException(status_code=422, detail="请填写完整的服务地址")
        if name == "database_url" and parsed.scheme not in {"postgresql+psycopg", "postgresql"}:
            raise HTTPException(status_code=422, detail="数据库地址必须使用 PostgreSQL")
        if name.startswith("seo_") and name.endswith("_base_url") and parsed.scheme not in {"http", "https"}:
            raise HTTPException(status_code=422, detail="服务地址必须使用 HTTP 或 HTTPS")
    if name == "platform_master_key":
        try:
            rotate_platform_key(db, value, admin)
        except (ValueError, SecretConfigurationError, SecretDecryptionError) as exc:
            db.rollback()
            raise HTTPException(status_code=409, detail=str(exc)) from exc
    else:
        try:
            put_setting(db, name, value, admin)
        except SecretConfigurationError as exc:
            raise HTTPException(status_code=503, detail="服务器根密钥尚未配置，无法安全保存设置") from exc
    return {"key": name, "mode": SETTING_FIELDS[name][2], "status": "saved"}
