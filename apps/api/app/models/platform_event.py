"""Normalized inbound events received from live-platform connectors."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from sqlalchemy import DateTime, ForeignKey, Index, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base
from .live_room import utc_now


class PlatformLiveEvent(Base):
    __tablename__ = "platform_live_events"
    __table_args__ = (
        UniqueConstraint(
            "platform",
            "live_room_id",
            "external_event_id",
            name="uq_platform_live_events_source_event",
        ),
        Index("ix_platform_live_events_room_received", "live_room_id", "received_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    platform: Mapped[str] = mapped_column(String(50), index=True)
    external_event_id: Mapped[str] = mapped_column(String(200))
    event_type: Mapped[str] = mapped_column(String(30), index=True)
    live_room_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_rooms.id", ondelete="CASCADE"),
        index=True,
    )
    live_run_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("live_runs.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    actor_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actor_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    actor_avatar_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    data: Mapped[dict] = mapped_column(JSON, default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
