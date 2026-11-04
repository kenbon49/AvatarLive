"""Persistent live-room draft configuration."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, JSON, LargeBinary, String
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class LiveRoom(Base):
    __tablename__ = "live_rooms"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
    slug: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    config: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LiveRoomMedia(Base):
    __tablename__ = "live_room_media"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=True, index=True)
    content_type: Mapped[str] = mapped_column(String(80))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class LiveRoomPlaybackSession(Base):
    __tablename__ = "live_room_playback_sessions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    live_room_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_rooms.id", ondelete="CASCADE"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    stopped_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    duration_ms: Mapped[int] = mapped_column(BigInteger, default=0)
