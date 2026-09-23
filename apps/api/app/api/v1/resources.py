"""Owner-scoped metered API usage report."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...models.account import ApiUsage, User
from ...security.accounts import require_user
from ...services.billing import OPERATION_LABELS, pricing, wallet_response
from ...services.cost_pricing import micros_to_credits, micros_to_rmb


router = APIRouter(prefix="/resources", tags=["resources"])


@router.get("/report")
def report(db: Session = Depends(get_db), user: User = Depends(require_user)) -> dict:
    since = datetime.now(timezone.utc) - timedelta(days=30)
    rows = db.scalars(
        select(ApiUsage)
        .where(ApiUsage.user_id == user.id, ApiUsage.created_at >= since)
        .order_by(ApiUsage.created_at.desc())
    ).all()
    operation_counts = {operation: 0 for operation in OPERATION_LABELS}
    for usage in rows:
        operation_counts[usage.operation] = operation_counts.get(usage.operation, 0) + 1
    succeeded = sum(item.status == "succeeded" for item in rows)
    failed = sum(item.status == "failed" for item in rows)
    return {
        "periodDays": 30,
        "currentBalance": wallet_response(user)["balance"],
        "reservedCredits": micros_to_credits(user.reserved_balance_micros),
        "unlimited": user.role == "admin",
        "totalCalls": len(rows),
        "successfulCalls": succeeded,
        "failedCalls": failed,
        "chargedCredits": micros_to_credits(sum(item.settled_micros for item in rows)),
        "upstreamCostRmb": micros_to_rmb(sum(item.upstream_cost_micros for item in rows)),
        "operationCounts": operation_counts,
        "pricing": pricing(),
        "recentUsages": [
            {
                "id": item.id,
                "operation": item.operation,
                "label": OPERATION_LABELS.get(item.operation, item.operation),
                "status": item.status,
                "credits": item.credits,
                "chargedCredits": micros_to_credits(item.settled_micros),
                "reservedCredits": micros_to_credits(item.reserved_micros),
                "upstreamCostRmb": micros_to_rmb(item.upstream_cost_micros),
                "provider": item.provider,
                "model": item.model,
                "createdAt": item.created_at.isoformat(),
            }
            for item in rows[:50]
        ],
    }
