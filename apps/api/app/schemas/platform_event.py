"""Canonical event contract shared by inbound live-platform connectors."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import ConfigDict, Field, model_validator

from ..models.live_room import utc_now
from .live_room import CamelModel, to_camel


PlatformEventType = Literal[
    "comment",
    "viewer_enter",
    "follow",
    "like",
    "gift",
    "order",
    "product_click",
    "system",
]


class PlatformEventCreate(CamelModel):
    external_event_id: str = Field(min_length=1, max_length=200)
    event_type: PlatformEventType
    live_room_id: str = Field(min_length=1, max_length=36)
    live_run_id: str | None = Field(default=None, min_length=1, max_length=36)
    actor_id: str | None = Field(default=None, max_length=200)
    actor_name: str | None = Field(default=None, max_length=200)
    actor_avatar_url: str | None = Field(default=None, max_length=1000)
    content: str | None = Field(default=None, max_length=4000)
    quantity: int = Field(default=1, ge=1, le=1_000_000)
    data: dict[str, Any] = Field(default_factory=dict)
    occurred_at: datetime = Field(default_factory=utc_now)

    @model_validator(mode="after")
    def require_comment_content(self):
        if self.event_type == "comment" and not (self.content or "").strip():
            raise ValueError("comment events require content")
        return self


class PlatformEventResponse(PlatformEventCreate):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        from_attributes=True,
    )

    id: str
    platform: str
    received_at: datetime


class PlatformEventIngestResponse(CamelModel):
    accepted: bool = True
    duplicate: bool
    event: PlatformEventResponse
