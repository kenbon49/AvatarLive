"""Reusable product catalog, room selections, and saved live scripts."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from ..db.base import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint(
            "platform",
            "platform_account_id",
            "platform_product_id",
            name="uq_products_platform_account_product",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    source_type: Mapped[str] = mapped_column(String(30), default="self_built", index=True)
    platform: Mapped[str | None] = mapped_column(String(50), nullable=True, index=True)
    platform_account_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    sku: Mapped[str] = mapped_column(String(160), default="")
    image_url: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    original_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    selling_points: Mapped[list] = mapped_column(JSON, default=list)
    stock_message: Mapped[str] = mapped_column(String(500), default="")
    after_sales: Mapped[str] = mapped_column(Text, default="")
    platform_product_id: Mapped[str] = mapped_column(String(200), default="")
    risk_words: Mapped[list] = mapped_column(JSON, default=list)
    platform_status: Mapped[str] = mapped_column(String(30), default="local")
    raw_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LiveRoomProductSelection(Base):
    __tablename__ = "live_room_product_selections"
    __table_args__ = (
        UniqueConstraint("live_room_id", "product_id", name="uq_live_room_product_selections_room_product"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    live_room_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("live_rooms.id", ondelete="CASCADE"),
        index=True,
    )
    product_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("products.id", ondelete="CASCADE"),
        index=True,
    )
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    card_mode: Mapped[str] = mapped_column(String(20), default="visual")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class LiveRoomScriptLibrary(Base):
    __tablename__ = "live_room_script_library"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    live_room_id: Mapped[str] = mapped_column(String(36), ForeignKey("live_rooms.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[str | None] = mapped_column(
        String(36),
        ForeignKey("products.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(200))
    category: Mapped[str] = mapped_column(String(20))
    duration: Mapped[str] = mapped_column(String(20), default="00:30")
    text: Mapped[str] = mapped_column(Text)
    tags: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now)


# Keep imports used by older modules and integrations source-compatible.
LiveRoomProduct = Product
