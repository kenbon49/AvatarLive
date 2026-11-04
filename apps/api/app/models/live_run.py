"""Persistent live-run state and per-platform publish targets."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base
from .live_room import utc_now


class LiveRun(Base):
    __tablename__ = "live_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    request_id: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    live_room_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_rooms.id", ondelete="RESTRICT"),
        index=True,
    )
    status: Mapped[str] = mapped_column(String(20), default="preparing", index=True)
    room_version: Mapped[int] = mapped_column(Integer)
    config_snapshot: Mapped[dict] = mapped_column(JSON)
    media_source_kind: Mapped[str] = mapped_column(String(30))
    media_source_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    legal_source_confirmed: Mapped[bool] = mapped_column(Boolean, default=False)
    source_process_pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LiveRunTarget(Base):
    __tablename__ = "live_run_targets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    live_run_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_runs.id", ondelete="CASCADE"),
        index=True,
    )
    platform_connection_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("platform_connections.id", ondelete="RESTRICT"),
        index=True,
    )
    connection_version: Mapped[int] = mapped_column(Integer)
    connection_name: Mapped[str] = mapped_column(String(120))
    platform_label: Mapped[str] = mapped_column(String(80))
    server_url: Mapped[str] = mapped_column(String(500))
    stream_key_ciphertext: Mapped[str] = mapped_column(Text)
    stream_key_last4: Mapped[str] = mapped_column(String(4))
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    retry_count: Mapped[int] = mapped_column(Integer, default=0)
    process_pid: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(80), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
