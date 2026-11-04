"""Transactional wallet reservations, settlement, and platform funding."""

from __future__ import annotations

from datetime import datetime, timezone
import math
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.account import (
    ApiUsage,
    CreditLedgerEntry,
    PlatformFundingAccount,
    PlatformFundingEntry,
    User,
)
from .cost_pricing import (
    CostQuote,
    MICROS_PER_CREDIT,
    charged_amount,
    credits_to_micros,
    micros_to_credits,
    quote_llm_actual,
    quote_llm_reservation,
    quote_video_actual,
    quote_video_reservation,
)
from .user_admin import record_user_admin_audit


OPERATION_LABELS = {
    "llm_chat": "LLM 话术生成",
    "storyboard_video": "数字人分镜合成",
}


def operation_price(operation: str) -> int | None:
    """Legacy estimate retained for older clients; settlement is usage-based."""
    if operation == "llm_chat":
        return int(settings.llm_credit_cost)
    if operation == "storyboard_video":
        return int(settings.storyboard_video_credit_cost)
    return None


def pricing() -> list[dict]:
    return [
        {
            "operation": "llm_chat",
            "label": OPERATION_LABELS["llm_chat"],
            "mode": "token_usage",
            "description": "按模型和峰谷时段计费：缓存命中 2–30 积分/百万 Token，缓存未命中 100–900 积分/百万 Token，输出 400–2700 积分/百万 Token",
            "credits": None,
        },
        {
            "operation": "storyboard_video",
            "label": OPERATION_LABELS["storyboard_video"],
            "mode": "duration",
            "description": "600 积分/分钟（6 元/分钟），按成片秒数结算",
            "credits": None,
        },
    ]


def _sync_legacy_balance(user: User) -> None:
    user.credit_balance = max(0, user.credit_balance_micros // MICROS_PER_CREDIT)


def available_micros(user: User) -> int:
    return max(0, user.credit_balance_micros - user.reserved_balance_micros)


def wallet_response(user: User) -> dict:
    available = available_micros(user)
    return {
        "balance": micros_to_credits(available),
        "balanceMicros": available,
        "walletMicros": user.credit_balance_micros,
        "reservedMicros": user.reserved_balance_micros,
        "unlimited": user.role == "admin",
    }


def _funding_account(db: Session, *, lock: bool = False) -> PlatformFundingAccount:
    query = select(PlatformFundingAccount).where(PlatformFundingAccount.id == "primary")
    if lock:
        query = query.with_for_update()
    account = db.scalar(query)
    if account is None:
        account = PlatformFundingAccount(id="primary")
        db.add(account)
        db.flush()
    return account


def funding_summary(db: Session) -> dict:
    account = _funding_account(db)
    user_wallet_micros = db.scalar(
        select(func.coalesce(func.sum(User.credit_balance_micros), 0)).where(User.role == "user")
    ) or 0
    return {
        "availableMicros": account.available_micros,
        "availableCredits": micros_to_credits(account.available_micros),
        "fundedMicros": account.total_funded_micros,
        "allocatedMicros": account.total_allocated_micros,
        "returnedMicros": account.total_returned_micros,
        "userWalletMicros": int(user_wallet_micros),
        "userWalletCredits": micros_to_credits(int(user_wallet_micros)),
    }


def sync_funding_from_provider_balance(
    db: Session,
    admin: User,
    provider_available_micros: int,
    snapshot_id: str,
) -> dict:
    """Reconcile allocatable points without re-crediting on repeated refreshes."""
    account = _funding_account(db, lock=True)
    user_wallet_micros = db.scalar(
        select(func.coalesce(func.sum(User.credit_balance_micros), 0)).where(User.role == "user")
    ) or 0
    target_available = max(0, provider_available_micros - int(user_wallet_micros))
    delta = target_available - account.available_micros
    if delta:
        account.available_micros = target_available
        if delta > 0:
            account.total_funded_micros += delta
        else:
            account.total_returned_micros += -delta
        db.add(PlatformFundingEntry(
            account_id=account.id,
            actor_id=admin.id,
            kind="provider_sync",
            amount_micros=delta,
            balance_after_micros=target_available,
            reference=f"provider-sync:aliyun:{snapshot_id}",
            description="按阿里云可用余额同步平台积分",
        ))
    db.commit()
    return funding_summary(db)


def _quote_for_operation(operation: str, detail: dict) -> CostQuote:
    if operation == "storyboard_video":
        return quote_video_reservation(
            int(detail.get("characters") or 0),
            float(detail.get("speechRate") or 1.0),
        )
    if operation == "llm_chat":
        model = str(detail.get("model") or settings.llm_default_model_id)
        messages = detail.get("messages") if isinstance(detail.get("messages"), list) else []
        max_output = int(detail.get("maxOutputTokens") or 4096)
        try:
            return quote_llm_reservation(model, messages, str(detail.get("systemPrompt") or ""), max_output)
        except ValueError:
            # Compatibility for manually configured non-DeepSeek models. A
            # gateway-specific price should be configured before production use.
            return CostQuote(
                amount_micros=credits_to_micros(settings.llm_credit_cost),
                provider="openai-compatible",
                model=model,
                pricing_version="legacy-fallback-v1",
                time_band="unknown",
            )
    raise HTTPException(status_code=422, detail="未知计费项目")


def charge_api_usage(
    db: Session,
    user: User,
    operation: str,
    reference: str,
    *,
    detail: dict | None = None,
    quote: CostQuote | None = None,
) -> ApiUsage:
    """Reserve the worst-case amount before an upstream request."""
    if operation not in OPERATION_LABELS:
        raise HTTPException(status_code=422, detail="未知计费项目")
    clean_detail = detail or {}
    quote = quote or _quote_for_operation(operation, clean_detail)
    existing = db.scalar(select(ApiUsage).where(ApiUsage.reference == reference))
    if existing:
        if existing.user_id != user.id or existing.operation != operation:
            raise HTTPException(status_code=409, detail="计费请求编号冲突")
        return existing

    locked_user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked_user is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    admin_unlimited = locked_user.role == "admin"
    reserved = 0 if admin_unlimited else quote.amount_micros
    available = available_micros(locked_user)
    if reserved > available:
        needed = micros_to_credits(reserved)
        remaining = micros_to_credits(available)
        raise HTTPException(
            status_code=402,
            detail=f"积分不足：{OPERATION_LABELS[operation]}预计需要 {needed:g} 积分，当前可用 {remaining:g}",
        )
    locked_user.reserved_balance_micros += reserved
    usage = ApiUsage(
        user_id=locked_user.id,
        operation=operation,
        status="reserved",
        request_units=1,
        credits=0,
        reserved_micros=reserved,
        settled_micros=0,
        upstream_cost_micros=0,
        provider=quote.provider,
        model=quote.model,
        pricing_version=quote.pricing_version,
        pricing_time_band=quote.time_band,
        reference=reference,
        detail=clean_detail,
    )
    db.add(usage)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(select(ApiUsage).where(ApiUsage.reference == reference))
        if existing and existing.user_id == user.id and existing.operation == operation:
            return existing
        raise HTTPException(status_code=409, detail="计费请求编号冲突")
    db.refresh(usage)
    return usage


def reserve_llm_usage(
    db: Session,
    user: User,
    reference: str,
    *,
    model: str,
    messages: list[dict],
    system_prompt: str,
    max_output_tokens: int,
    source: str = "llm_chat",
) -> ApiUsage:
    try:
        quote = quote_llm_reservation(model, messages, system_prompt, max_output_tokens)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return charge_api_usage(
        db,
        user,
        "llm_chat",
        reference,
        detail={"model": model, "source": source, "maxOutputTokens": max_output_tokens},
        quote=quote,
    )


def bind_api_usage(
    db: Session,
    usage_id: str,
    user_id: str,
    provider_resource_id: str,
) -> ApiUsage:
    usage = db.scalar(
        select(ApiUsage).where(ApiUsage.id == usage_id, ApiUsage.user_id == user_id).with_for_update()
    )
    if usage is None:
        raise HTTPException(status_code=404, detail="计费记录不存在")
    if usage.provider_resource_id and usage.provider_resource_id != provider_resource_id:
        raise HTTPException(status_code=409, detail="上游任务编号冲突")
    usage.provider_resource_id = provider_resource_id
    if usage.status == "reserved":
        usage.status = "submitted"
    db.commit()
    return usage


def settle_api_usage(
    db: Session,
    usage_id: str,
    user_id: str,
    quote: CostQuote,
    *,
    cache_hit_tokens: int = 0,
    cache_miss_tokens: int = 0,
    output_tokens: int = 0,
    detail: dict | None = None,
) -> ApiUsage:
    usage = db.scalar(
        select(ApiUsage).where(ApiUsage.id == usage_id, ApiUsage.user_id == user_id).with_for_update()
    )
    if usage is None:
        raise HTTPException(status_code=404, detail="计费记录不存在")
    if usage.status == "succeeded":
        return usage
    if usage.status == "failed":
        raise HTTPException(status_code=409, detail="失败的计费记录不能结算")
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise HTTPException(status_code=404, detail="账号不存在")

    user.reserved_balance_micros = max(0, user.reserved_balance_micros - usage.reserved_micros)
    requested_charge = 0 if user.role == "admin" else charged_amount(quote.amount_micros)
    chargeable = max(0, user.credit_balance_micros - user.reserved_balance_micros)
    settled = min(requested_charge, chargeable)
    user.credit_balance_micros -= settled
    _sync_legacy_balance(user)
    usage.status = "succeeded"
    usage.settled_micros = settled
    usage.upstream_cost_micros = quote.amount_micros
    usage.credits = math.ceil(settled / MICROS_PER_CREDIT) if settled else 0
    usage.provider = quote.provider
    usage.model = quote.model
    usage.pricing_version = quote.pricing_version
    usage.pricing_time_band = quote.time_band
    usage.input_cache_hit_tokens = max(0, cache_hit_tokens)
    usage.input_cache_miss_tokens = max(0, cache_miss_tokens)
    usage.output_tokens = max(0, output_tokens)
    usage.settled_at = datetime.now(timezone.utc)
    merged_detail = dict(usage.detail or {})
    merged_detail.update(detail or {})
    if settled < requested_charge:
        merged_detail["unfundedMicros"] = requested_charge - settled
    usage.detail = merged_detail
    if settled:
        db.add(CreditLedgerEntry(
            user_id=user.id,
            kind="usage",
            amount=-math.ceil(settled / MICROS_PER_CREDIT),
            balance_after=user.credit_balance,
            amount_micros=-settled,
            balance_after_micros=user.credit_balance_micros,
            usage_id=usage.id,
            reference=f"usage:{usage.reference}",
            description=OPERATION_LABELS.get(usage.operation, usage.operation),
        ))
    db.commit()
    db.refresh(usage)
    return usage


def settle_llm_usage(db: Session, usage_id: str, user_id: str, token_usage: dict) -> ApiUsage:
    usage = db.get(ApiUsage, usage_id)
    if usage is None or usage.user_id != user_id:
        raise HTTPException(status_code=404, detail="计费记录不存在")
    hit = int(token_usage.get("prompt_cache_hit_tokens") or 0)
    miss = int(token_usage.get("prompt_cache_miss_tokens") or 0)
    output = int(token_usage.get("completion_tokens") or 0)
    try:
        quote = quote_llm_actual(usage.model, hit, miss, output, usage.created_at)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return settle_api_usage(
        db, usage_id, user_id, quote,
        cache_hit_tokens=hit, cache_miss_tokens=miss, output_tokens=output,
        detail={"providerUsage": {"cacheHit": hit, "cacheMiss": miss, "output": output}},
    )


def settle_video_usage(db: Session, usage_id: str, user_id: str, duration_seconds: float) -> ApiUsage:
    quote, billable_seconds = quote_video_actual(duration_seconds)
    return settle_api_usage(
        db, usage_id, user_id, quote,
        detail={"durationSeconds": duration_seconds, "billableSeconds": billable_seconds},
    )


def fail_api_usage(db: Session, usage_id: str, user_id: str, reason: str = "") -> None:
    usage = db.scalar(
        select(ApiUsage).where(ApiUsage.id == usage_id, ApiUsage.user_id == user_id).with_for_update()
    )
    if usage is None or usage.status in {"failed", "succeeded"}:
        return
    user = db.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is not None:
        user.reserved_balance_micros = max(0, user.reserved_balance_micros - usage.reserved_micros)
    usage.status = "failed"
    usage.settled_at = datetime.now(timezone.utc)
    if reason:
        usage.detail = {**(usage.detail or {}), "failureReason": reason[:300]}
    db.commit()


def mark_api_usage(db: Session, usage_id: str, user_id: str, status: str) -> None:
    """Compatibility endpoint for older callers."""
    if status == "failed":
        fail_api_usage(db, usage_id, user_id)
        return
    if status != "succeeded":
        return
    usage = db.get(ApiUsage, usage_id)
    if usage is None or usage.user_id != user_id or usage.status in {"succeeded", "failed"}:
        return
    quote = CostQuote(
        amount_micros=usage.reserved_micros,
        provider=usage.provider,
        model=usage.model,
        pricing_version=usage.pricing_version,
        time_band=usage.pricing_time_band,
    )
    settle_api_usage(db, usage_id, user_id, quote)


def recharge_admin(db: Session, admin: User, amount: int, payment_reference: str) -> float:
    """Manually confirm real payment into the platform allocation pool."""
    ledger_reference = f"funding:{payment_reference.strip()}"
    if db.scalar(select(PlatformFundingEntry.id).where(PlatformFundingEntry.reference == ledger_reference)):
        raise HTTPException(status_code=409, detail="该付款凭证已经入账")
    account = _funding_account(db, lock=True)
    amount_micros = credits_to_micros(amount)
    account.available_micros += amount_micros
    account.total_funded_micros += amount_micros
    db.add(PlatformFundingEntry(
        account_id=account.id,
        actor_id=admin.id,
        kind="funding",
        amount_micros=amount_micros,
        balance_after_micros=account.available_micros,
        reference=ledger_reference,
        description="实际付款确认入账",
    ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="该付款凭证已经入账")
    return micros_to_credits(account.available_micros)


def _transfer_pool_to_user(
    db: Session,
    admin: User,
    target: User,
    delta_micros: int,
    *,
    kind: str,
    description: str,
) -> None:
    account = _funding_account(db, lock=True)
    if delta_micros > 0 and account.available_micros < delta_micros:
        raise HTTPException(
            status_code=409,
            detail=f"平台可分配积分不足，当前剩余 {micros_to_credits(account.available_micros):g}",
        )
    account.available_micros -= delta_micros
    if delta_micros > 0:
        account.total_allocated_micros += delta_micros
    else:
        account.total_returned_micros += -delta_micros
    transfer_id = str(uuid4())
    db.add(PlatformFundingEntry(
        account_id=account.id,
        actor_id=admin.id,
        target_user_id=target.id,
        kind=kind,
        amount_micros=-delta_micros,
        balance_after_micros=account.available_micros,
        reference=f"pool:{transfer_id}",
        description=description,
    ))


def allocate_credits(db: Session, admin: User, target_user_id: str, amount: int) -> tuple[float, float]:
    if admin.id == target_user_id:
        raise HTTPException(status_code=422, detail="不能向管理员账号分配积分")
    target = db.scalar(select(User).where(User.id == target_user_id).with_for_update())
    if target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        raise HTTPException(status_code=422, detail="只能向普通用户分配积分")
    balance_before = micros_to_credits(target.credit_balance_micros)
    amount_micros = credits_to_micros(amount)
    _transfer_pool_to_user(db, admin, target, amount_micros, kind="allocation", description="分配用户积分")
    target.credit_balance_micros += amount_micros
    _sync_legacy_balance(target)
    db.add(CreditLedgerEntry(
        user_id=target.id,
        counterparty_user_id=admin.id,
        kind="allocation_in",
        amount=amount,
        balance_after=target.credit_balance,
        amount_micros=amount_micros,
        balance_after_micros=target.credit_balance_micros,
        reference=f"allocation:{uuid4()}",
        description="管理员分配积分",
    ))
    record_user_admin_audit(
        db,
        actor=admin,
        target=target,
        action="credit_allocated",
        detail={"amount": amount, "balanceBefore": balance_before, "balanceAfter": micros_to_credits(target.credit_balance_micros)},
    )
    db.commit()
    account = _funding_account(db)
    return micros_to_credits(account.available_micros), micros_to_credits(target.credit_balance_micros)


def adjust_user_credits(
    db: Session,
    admin: User,
    target: User,
    mode: str,
    amount: int,
    reason: str,
) -> tuple[float, float]:
    before_micros = target.credit_balance_micros
    if mode == "add":
        after_micros = before_micros + credits_to_micros(amount)
    elif mode == "subtract":
        after_micros = before_micros - credits_to_micros(amount)
    else:
        after_micros = credits_to_micros(amount)
    if after_micros < target.reserved_balance_micros:
        raise HTTPException(status_code=409, detail="调整后积分不能低于当前已冻结积分")
    if after_micros == before_micros:
        raise HTTPException(status_code=422, detail="调整后的积分没有变化")
    delta_micros = after_micros - before_micros
    _transfer_pool_to_user(db, admin, target, delta_micros, kind="adjustment", description=reason)
    target.credit_balance_micros = after_micros
    _sync_legacy_balance(target)
    delta_credits = micros_to_credits(delta_micros)
    db.add(CreditLedgerEntry(
        user_id=target.id,
        counterparty_user_id=admin.id,
        kind="admin_adjustment",
        amount=math.ceil(delta_micros / MICROS_PER_CREDIT) if delta_micros > 0 else -math.ceil(-delta_micros / MICROS_PER_CREDIT),
        balance_after=target.credit_balance,
        amount_micros=delta_micros,
        balance_after_micros=target.credit_balance_micros,
        reference=f"admin-adjustment:{uuid4()}",
        description=reason,
    ))
    record_user_admin_audit(
        db,
        actor=admin,
        target=target,
        action="credit_adjusted",
        detail={
            "mode": mode,
            "amount": amount,
            "balanceBefore": micros_to_credits(before_micros),
            "balanceAfter": micros_to_credits(after_micros),
            "reason": reason,
        },
    )
    db.commit()
    return micros_to_credits(after_micros), delta_credits
