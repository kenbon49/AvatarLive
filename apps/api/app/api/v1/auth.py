"""Registration, review, and signed-in account endpoints."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from time import monotonic
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import AliasChoices, BaseModel, EmailStr, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ...core.config import settings
from ...db.session import get_db
from ...models.account import LoginSession, User
from ...security.accounts import COOKIE_NAME, SESSION_DAYS, create_session, hash_password, lookup_user, require_admin, require_user, session_hash, verify_password
from ...services.user_admin import record_user_admin_audit


router = APIRouter(prefix="/auth", tags=["accounts"])
_limit_lock = Lock()
_request_counts: dict[str, tuple[float, int]] = {}


def limit_attempt(key: str, *, max_attempts: int, seconds: int) -> None:
    with _limit_lock:
        if len(_request_counts) > 10_000:
            now = monotonic()
            _request_counts.update({name: item for name, item in _request_counts.items() if now - item[0] < 3600})
        started, count = _request_counts.get(key, (monotonic(), 0))
        if monotonic() - started >= seconds:
            started, count = monotonic(), 0
        if count >= max_attempts:
            raise HTTPException(status_code=429, detail="请求过于频繁，请稍后重试")
        _request_counts[key] = (started, count + 1)


class RegistrationCredentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)


class LoginCredentials(BaseModel):
    identifier: str = Field(
        min_length=1,
        max_length=255,
        validation_alias=AliasChoices("identifier", "email"),
    )
    password: str = Field(min_length=1, max_length=128)


def public_user(user: User) -> dict:
    return {"id": user.id, "email": user.email, "username": user.username, "role": user.role, "status": user.status}


def secure_cookie_for_request(request: Request) -> bool:
    if not settings.auth_cookie_secure:
        return False
    origin = request.headers.get("origin")
    if origin:
        return urlsplit(origin).scheme.lower() == "https"
    forwarded_proto = request.headers.get("x-forwarded-proto", "").split(",", 1)[0].strip().lower()
    return (forwarded_proto or request.url.scheme).lower() == "https"


@router.post("/register", status_code=201)
def register(payload: RegistrationCredentials, request: Request, db: Session = Depends(get_db)) -> dict:
    email = payload.email.lower()
    limit_attempt(f"register:{request.client.host if request.client else 'unknown'}", max_attempts=60, seconds=3600)
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(status_code=409, detail="该邮箱已注册")
    user = User(email=email, password_hash=hash_password(payload.password), role="user", status="pending")
    db.add(user)
    db.commit()
    return {"status": "pending", "message": "注册成功，等待管理员审核"}


@router.post("/login")
def login(payload: LoginCredentials, request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    identifier = payload.identifier.strip().lower()
    limit_attempt(f"login:{identifier}", max_attempts=12, seconds=900)
    user = db.scalar(select(User).where(or_(User.email == identifier, User.username == identifier)))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="账号或密码错误")
    if user.status != "approved":
        raise HTTPException(status_code=403, detail="账号尚未通过审核" if user.status == "pending" else "账号不可用")
    token = create_session(db, user)
    response.set_cookie(COOKIE_NAME, token, httponly=True, secure=secure_cookie_for_request(request),
                        samesite="lax", max_age=SESSION_DAYS * 86400, path="/")
    return public_user(user)


@router.get("/me")
def me(user: User = Depends(require_user)) -> dict:
    return public_user(user)


@router.post("/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if token and len(token) <= 200 and token.isascii():
        session = db.get(LoginSession, session_hash(token))
        if session:
            db.delete(session)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}


@router.get("/pending")
def pending(_: User = Depends(require_admin), db: Session = Depends(get_db)) -> list[dict]:
    users = db.scalars(select(User).where(User.status == "pending").order_by(User.created_at)).all()
    return [public_user(user) for user in users]


@router.post("/pending/{user_id}/{decision}")
def review(user_id: str, decision: str, admin: User = Depends(require_admin), db: Session = Depends(get_db)) -> dict:
    if decision not in {"approve", "reject"}:
        raise HTTPException(status_code=404, detail="未知审核操作")
    user = db.get(User, user_id)
    if user is None or user.role != "user" or user.status != "pending":
        raise HTTPException(status_code=404, detail="待审核用户不存在")
    user.status = "approved" if decision == "approve" else "rejected"
    user.reviewed_at = datetime.now(timezone.utc)
    record_user_admin_audit(
        db,
        actor=admin,
        target=user,
        action="account_approved" if decision == "approve" else "account_rejected",
    )
    db.commit()
    return public_user(user)
