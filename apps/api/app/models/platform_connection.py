"""Encrypted outbound platform connections used by the live-room console."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base
from .live_room import utc_now


class PlatformConnection(Base):
    __tablename__ = "platform_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    kind: Mapped[str] = mapped_column(String(30), default="manual_rtmp", index=True)
    name: Mapped[str] = mapped_column(String(120))
    platform_label: Mapped[str] = mapped_column(String(80), default="通用 RTMP")
    server_url: Mapped[str] = mapped_column(String(500))
    stream_key_ciphertext: Mapped[str] = mapped_column(Text)
    stream_key_last4: Mapped[str] = mapped_column(String(4))
    status: Mapped[str] = mapped_column(String(20), default="enabled", index=True)
    test_status: Mapped[str] = mapped_column(String(20), default="untested")
    test_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    last_tested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)
