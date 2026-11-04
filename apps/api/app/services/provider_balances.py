"""Cached provider balance monitoring. Snapshots never mint platform credits."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import hashlib
import hmac
import json
from urllib.parse import quote
from uuid import uuid4

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.account import ProviderBalanceSnapshot
from .cost_pricing import MICROS_PER_RMB, micros_to_credits, micros_to_rmb


ALIYUN_BSS_ENDPOINT = "https://business.aliyuncs.com/"


def _percent(value: str) -> str:
    return quote(value, safe="~")


def _signature(params: dict[str, str], secret: str, method: str = "POST") -> str:
    canonical = "&".join(f"{_percent(key)}={_percent(value)}" for key, value in sorted(params.items()))
    string_to_sign = f"{method}&%2F&{_percent(canonical)}"
    digest = hmac.new(f"{secret}&".encode(), string_to_sign.encode(), hashlib.sha1).digest()
    return base64.b64encode(digest).decode()


def _amount_micros(value: object) -> int:
    try:
        return int((Decimal(str(value)) * MICROS_PER_RMB).to_integral_value(rounding=ROUND_HALF_UP))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise RuntimeError("阿里云余额响应格式异常") from exc


def fetch_aliyun_balance() -> tuple[int, str, dict]:
    if not settings.aliyun_access_key_id or not settings.aliyun_access_key_secret:
        raise RuntimeError("阿里云 AccessKey 尚未配置")
    now = datetime.now(timezone.utc)
    params = {
        "AccessKeyId": settings.aliyun_access_key_id,
        "Action": "QueryAccountBalance",
        "Format": "JSON",
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": str(uuid4()),
        "SignatureVersion": "1.0",
        "Timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "Version": "2017-12-14",
    }
    params["Signature"] = _signature(params, settings.aliyun_access_key_secret)
    try:
        # RPC parameters are sent in the form body so access-key identifiers
        # and signatures never appear in proxy/access-log URLs.
        response = httpx.post(ALIYUN_BSS_ENDPOINT, data=params, timeout=8)
    except httpx.HTTPError as exc:
        raise RuntimeError(f"阿里云余额查询连接失败：{type(exc).__name__}") from exc
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"阿里云余额查询失败：HTTP {response.status_code}，响应不是 JSON") from exc
    if response.status_code >= 400:
        code = str(payload.get("Code") or "UnknownError") if isinstance(payload, dict) else "UnknownError"
        message = str(payload.get("Message") or "请求被拒绝") if isinstance(payload, dict) else "请求被拒绝"
        raise RuntimeError(f"阿里云余额查询失败：HTTP {response.status_code}，{code}：{message[:160]}")
    data = payload.get("Data") if isinstance(payload, dict) else None
    if not isinstance(data, dict) or data.get("AvailableAmount") is None:
        message = payload.get("Message") if isinstance(payload, dict) else None
        raise RuntimeError(str(message or "阿里云没有返回可用余额"))
    currency = str(data.get("Currency") or "CNY")
    safe_detail = {
        key: data.get(key)
        for key in ("AvailableAmount", "AvailableCashAmount", "AvailableCredit", "CreditAmount")
        if data.get(key) is not None
    }
    return _amount_micros(data["AvailableAmount"]), currency, safe_detail


def latest_provider_snapshot(db: Session, provider: str = "aliyun") -> ProviderBalanceSnapshot | None:
    return db.scalar(
        select(ProviderBalanceSnapshot)
        .where(ProviderBalanceSnapshot.provider == provider)
        .order_by(ProviderBalanceSnapshot.fetched_at.desc())
        .limit(1)
    )


def refresh_aliyun_balance(db: Session, *, force: bool = False) -> ProviderBalanceSnapshot:
    latest = latest_provider_snapshot(db)
    cutoff = datetime.now(timezone.utc) - timedelta(seconds=settings.aliyun_balance_cache_seconds)
    if latest is not None and not force:
        fetched_at = latest.fetched_at
        if fetched_at.tzinfo is None:
            fetched_at = fetched_at.replace(tzinfo=timezone.utc)
        if fetched_at >= cutoff:
            return latest
    try:
        amount, currency, detail = fetch_aliyun_balance()
        snapshot = ProviderBalanceSnapshot(
            provider="aliyun",
            currency=currency,
            available_micros=amount,
            status="ok",
            detail=detail,
        )
    except RuntimeError as exc:
        snapshot = ProviderBalanceSnapshot(
            provider="aliyun",
            currency="CNY",
            status="error",
            error=str(exc)[:300],
            detail={},
        )
    db.add(snapshot)
    db.commit()
    db.refresh(snapshot)
    return snapshot


def snapshot_response(snapshot: ProviderBalanceSnapshot | None) -> dict:
    if snapshot is None:
        return {
            "provider": "aliyun",
            "status": "unavailable",
            "currency": "CNY",
            "availableMicros": None,
            "availableRmb": None,
            "availableCredits": None,
            "lowBalance": False,
            "error": "",
            "fetchedAt": None,
        }
    return {
        "provider": snapshot.provider,
        "status": snapshot.status,
        "currency": snapshot.currency,
        "availableMicros": snapshot.available_micros,
        "availableRmb": micros_to_rmb(snapshot.available_micros),
        "availableCredits": (
            micros_to_credits(snapshot.available_micros)
            if snapshot.available_micros is not None else None
        ),
        "lowBalance": (
            snapshot.available_micros is not None
            and snapshot.available_micros < settings.aliyun_low_balance_micros
        ),
        "error": snapshot.error,
        "fetchedAt": snapshot.fetched_at.isoformat(),
    }
