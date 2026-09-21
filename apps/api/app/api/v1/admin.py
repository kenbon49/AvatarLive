"""Account approval and allowlisted, encrypted operations configuration."""

from __future__ import annotations

import os
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...db.session import get_db
from ...models.account import ApiUsage, SystemSetting, User
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
from ...services.billing import allocate_credits, recharge_admin


router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(require_admin)])


class SettingUpdate(BaseModel):
    value: str = Field(min_length=1, max_length=4096)


class CreditRecharge(BaseModel):
    amount: int = Field(ge=1, le=1_000_000_000)
    payment_reference: str = Field(min_length=4, max_length=120, pattern=r"^[A-Za-z0-9_.:-]+$")


class CreditAllocation(BaseModel):
    amount: int = Field(ge=1, le=1_000_000_000)


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


@router.get("/users")
def list_users(db: Session = Depends(get_db)) -> list[dict]:
    usage_rows = db.execute(
        select(ApiUsage.user_id, func.count(ApiUsage.id), func.coalesce(func.sum(ApiUsage.credits), 0))
        .group_by(ApiUsage.user_id)
    ).all()
    usage = {user_id: {"calls": calls, "used": used} for user_id, calls, used in usage_rows}
    users = db.scalars(select(User).order_by(User.role.desc(), User.created_at.asc())).all()
    return [{
        "id": user.id,
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "status": user.status,
        "creditBalance": user.credit_balance,
        "unlimited": user.role == "admin",
        "usedCredits": int(usage.get(user.id, {}).get("used", 0)),
        "apiCalls": int(usage.get(user.id, {}).get("calls", 0)),
        "createdAt": user.created_at.isoformat(),
    } for user in users]


@router.post("/credits/recharge")
def recharge(
    payload: CreditRecharge,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    balance = recharge_admin(db, admin, payload.amount, payload.payment_reference)
    return {"balance": balance, "amount": payload.amount}


@router.post("/users/{user_id}/allocate")
def allocate(
    user_id: str,
    payload: CreditAllocation,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    admin_balance, user_balance = allocate_credits(db, admin, user_id, payload.amount)
    return {"adminBalance": admin_balance, "userBalance": user_balance, "amount": payload.amount}


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
    if name in {"llm_credit_cost", "storyboard_video_credit_cost"}:
        if not value.isdigit() or not 1 <= int(value) <= 1_000_000:
            raise HTTPException(status_code=422, detail="单次调用额度必须是 1 到 1000000 的整数")
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
