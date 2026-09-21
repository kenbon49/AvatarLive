"""Transactional prepaid-credit accounting and API usage tracking."""

from __future__ import annotations

from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models.account import ApiUsage, CreditLedgerEntry, User
from ..core.config import settings


OPERATION_LABELS = {
    "llm_chat": "LLM 话术生成",
    "storyboard_video": "数字人分镜合成",
}


def operation_price(operation: str) -> int | None:
    if operation == "llm_chat":
        return int(settings.llm_credit_cost)
    if operation == "storyboard_video":
        return int(settings.storyboard_video_credit_cost)
    return None


def pricing() -> list[dict]:
    return [
        {"operation": operation, "label": label, "credits": operation_price(operation)}
        for operation, label in OPERATION_LABELS.items()
    ]


def charge_api_usage(
    db: Session,
    user: User,
    operation: str,
    reference: str,
    *,
    detail: dict | None = None,
) -> ApiUsage:
    credits = operation_price(operation)
    if credits is None:
        raise HTTPException(status_code=422, detail="未知计费项目")
    label = OPERATION_LABELS[operation]
    existing = db.scalar(select(ApiUsage).where(ApiUsage.reference == reference))
    if existing:
        if existing.user_id != user.id or existing.operation != operation:
            raise HTTPException(status_code=409, detail="计费请求编号冲突")
        return existing
    locked_user = db.scalar(select(User).where(User.id == user.id).with_for_update())
    if locked_user is None:
        raise HTTPException(status_code=404, detail="账号不存在")
    admin_unlimited = locked_user.role == "admin"
    if not admin_unlimited and locked_user.credit_balance < credits:
        raise HTTPException(
            status_code=402,
            detail=f"额度不足：{label}需要 {credits} 额度，当前剩余 {locked_user.credit_balance}",
        )
    charged_credits = 0 if admin_unlimited else credits
    locked_user.credit_balance -= charged_credits
    usage = ApiUsage(
        user_id=locked_user.id,
        operation=operation,
        status="charged",
        request_units=1,
        credits=charged_credits,
        reference=reference,
        detail=detail or {},
    )
    db.add(usage)
    db.flush()
    if charged_credits:
        db.add(CreditLedgerEntry(
            user_id=locked_user.id,
            kind="usage",
            amount=-charged_credits,
            balance_after=locked_user.credit_balance,
            reference=f"usage:{reference}",
            description=label,
        ))
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


def mark_api_usage(db: Session, usage_id: str, user_id: str, status: str) -> None:
    if status not in {"succeeded", "failed"}:
        return
    usage = db.scalar(select(ApiUsage).where(ApiUsage.id == usage_id, ApiUsage.user_id == user_id))
    if usage is None or usage.status not in {"charged", status}:
        return
    usage.status = status
    db.commit()


def recharge_admin(db: Session, admin: User, amount: int, payment_reference: str) -> int:
    ledger_reference = f"recharge:{payment_reference.strip()}"
    if db.scalar(select(CreditLedgerEntry.id).where(CreditLedgerEntry.reference == ledger_reference)):
        raise HTTPException(status_code=409, detail="该付款凭证已经入账")
    locked_admin = db.scalar(select(User).where(User.id == admin.id).with_for_update())
    if locked_admin is None:
        raise HTTPException(status_code=404, detail="管理员账号不存在")
    locked_admin.credit_balance += amount
    db.add(CreditLedgerEntry(
        user_id=locked_admin.id,
        kind="recharge",
        amount=amount,
        balance_after=locked_admin.credit_balance,
        reference=ledger_reference,
        description="实际付款充值入账",
    ))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="该付款凭证已经入账")
    return locked_admin.credit_balance


def allocate_credits(db: Session, admin: User, target_user_id: str, amount: int) -> tuple[int, int]:
    if admin.id == target_user_id:
        raise HTTPException(status_code=422, detail="不能向自己分配额度，请使用充值入账")
    user_ids = sorted([admin.id, target_user_id])
    locked = db.scalars(select(User).where(User.id.in_(user_ids)).order_by(User.id).with_for_update()).all()
    users = {item.id: item for item in locked}
    source = users.get(admin.id)
    target = users.get(target_user_id)
    if source is None or target is None:
        raise HTTPException(status_code=404, detail="用户不存在")
    if target.role == "admin":
        raise HTTPException(status_code=422, detail="只能向普通用户分配额度")
    if source.credit_balance < amount:
        raise HTTPException(status_code=409, detail=f"管理员可用额度不足，当前剩余 {source.credit_balance}")
    source.credit_balance -= amount
    target.credit_balance += amount
    transfer_id = str(uuid4())
    db.add_all([
        CreditLedgerEntry(
            user_id=source.id, counterparty_user_id=target.id, kind="allocation_out", amount=-amount,
            balance_after=source.credit_balance, reference=f"allocation:{transfer_id}:out",
            description=f"分配额度给 {target.username or target.email}",
        ),
        CreditLedgerEntry(
            user_id=target.id, counterparty_user_id=source.id, kind="allocation_in", amount=amount,
            balance_after=target.credit_balance, reference=f"allocation:{transfer_id}:in",
            description="管理员分配额度",
        ),
    ])
    db.commit()
    return source.credit_balance, target.credit_balance
