"""Audit helpers for administrator actions on user accounts."""

from __future__ import annotations

from sqlalchemy.orm import Session

from ..models.account import User, UserAdminAudit


def record_user_admin_audit(
    db: Session,
    *,
    actor: User,
    target: User,
    action: str,
    detail: dict | None = None,
) -> UserAdminAudit:
    audit = UserAdminAudit(
        target_user_id=target.id,
        actor_id=actor.id,
        action=action,
        detail=detail or {},
    )
    db.add(audit)
    return audit
