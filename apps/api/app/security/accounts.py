"""Password verification and database-backed browser sessions."""

from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import os
import secrets

from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

from ..db.session import get_db
from ..models.account import LoginSession, User


COOKIE_NAME = "synlive_session"
SESSION_DAYS = 14


def hash_password(password: str, *, minimum_length: int = 12) -> str:
    if not minimum_length <= len(password) <= 128:
        raise ValueError(f"password must be {minimum_length}-128 characters")
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024)
    return "scrypt$32768$" + base64.urlsafe_b64encode(salt + digest).decode("ascii")


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, cost, value = encoded.split("$", 2)
        if algorithm != "scrypt" or cost != "32768" or len(password) > 128:
            return False
        payload = base64.urlsafe_b64decode(value)
        expected = hashlib.scrypt(password.encode("utf-8"), salt=payload[:16], n=2**15, r=8, p=1, maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(payload[16:], expected)
    except (ValueError, TypeError):
        return False


def session_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def create_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(40)
    db.add(LoginSession(
        token_hash=session_hash(token), user_id=user.id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
    ))
    db.commit()
    return token


def lookup_user(db: Session, token: str | None) -> User | None:
    if not token or len(token) > 200 or not token.isascii():
        return None
    session = db.get(LoginSession, session_hash(token))
    if session is None:
        return None
    expires_at = session.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= datetime.now(timezone.utc):
        return None
    return db.get(User, session.user_id)


def require_user(request: Request, db: Session = Depends(get_db)) -> User:
    user = lookup_user(db, request.cookies.get(COOKIE_NAME))
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    if user.status != "approved":
        raise HTTPException(status_code=403, detail="账号尚未通过审核")
    return user


def require_admin(user: User = Depends(require_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="仅管理员可访问")
    return user


def owns(owner_id: str | None, user: User) -> bool:
    return owner_id == user.id or (owner_id is None and user.role == "admin")
