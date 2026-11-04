"""Accounts, persistent login sessions, and administrative configuration."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import BigInteger, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base
from .live_room import utc_now


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str | None] = mapped_column(String(32), unique=True, index=True, nullable=True)
    password_hash: Mapped[str] = mapped_column(Text)
    role: Mapped[str] = mapped_column(String(20), default="user")
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    credit_balance: Mapped[int] = mapped_column(BigInteger, default=0)
    # Monetary values use integer micro-RMB. One visible credit is 0.01 RMB,
    # therefore one credit equals 10,000 micro-RMB.
    credit_balance_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    reserved_balance_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class LoginSession(Base):
    __tablename__ = "login_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    encrypted_value: Mapped[str] = mapped_column(Text)
    updated_by: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class SettingAudit(Base):
    __tablename__ = "setting_audit"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    key: Mapped[str] = mapped_column(String(100), index=True)
    action: Mapped[str] = mapped_column(String(20))
    actor_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class UserAdminAudit(Base):
    __tablename__ = "user_admin_audit"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    target_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), index=True,
    )
    actor_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), index=True,
    )
    action: Mapped[str] = mapped_column(String(40), index=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


class CreditLedgerEntry(Base):
    __tablename__ = "credit_ledger_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    counterparty_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True,
    )
    kind: Mapped[str] = mapped_column(String(30), index=True)
    amount: Mapped[int] = mapped_column(BigInteger)
    balance_after: Mapped[int] = mapped_column(BigInteger)
    amount_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    balance_after_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    usage_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("api_usages.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    reference: Mapped[str] = mapped_column(String(160), unique=True)
    description: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


class ApiUsage(Base):
    __tablename__ = "api_usages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    operation: Mapped[str] = mapped_column(String(40), index=True)
    status: Mapped[str] = mapped_column(String(20), default="reserved", index=True)
    request_units: Mapped[int] = mapped_column(BigInteger, default=1)
    credits: Mapped[int] = mapped_column(BigInteger)
    reserved_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    settled_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    upstream_cost_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    provider: Mapped[str] = mapped_column(String(40), default="")
    model: Mapped[str] = mapped_column(String(160), default="")
    provider_resource_id: Mapped[str | None] = mapped_column(String(160), nullable=True, index=True)
    pricing_version: Mapped[str] = mapped_column(String(80), default="")
    pricing_time_band: Mapped[str] = mapped_column(String(20), default="")
    input_cache_hit_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    input_cache_miss_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    output_tokens: Mapped[int] = mapped_column(BigInteger, default=0)
    reference: Mapped[str] = mapped_column(String(160), unique=True)
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    settled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class PlatformFundingAccount(Base):
    __tablename__ = "platform_funding_accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default="primary")
    available_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    total_funded_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    total_allocated_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    total_returned_micros: Mapped[int] = mapped_column(BigInteger, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class PlatformFundingEntry(Base):
    __tablename__ = "platform_funding_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    account_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("platform_funding_accounts.id", ondelete="RESTRICT"), index=True,
    )
    actor_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"))
    target_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True,
    )
    kind: Mapped[str] = mapped_column(String(30), index=True)
    amount_micros: Mapped[int] = mapped_column(BigInteger)
    balance_after_micros: Mapped[int] = mapped_column(BigInteger)
    reference: Mapped[str] = mapped_column(String(160), unique=True)
    description: Mapped[str] = mapped_column(String(300), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)


class ProviderBalanceSnapshot(Base):
    __tablename__ = "provider_balance_snapshots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    provider: Mapped[str] = mapped_column(String(40), index=True)
    currency: Mapped[str] = mapped_column(String(12), default="CNY")
    available_micros: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="ok", index=True)
    error: Mapped[str] = mapped_column(String(300), default="")
    detail: Mapped[dict] = mapped_column(JSON, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
