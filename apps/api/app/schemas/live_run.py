"""Schemas for truthful live-run preflight and persistent runtime state."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field

from .live_room import CamelModel, to_camel


LiveRunStatus = Literal[
    "preparing",
    "ready",
    "starting",
    "live",
    "stopping",
    "stopped",
    "failed",
]
LiveRunTargetStatus = Literal["pending", "starting", "live", "stopping", "stopped", "failed"]
MediaSourceKind = Literal["browser_ingest", "test_pattern"]


class LiveRunMediaSource(CamelModel):
    kind: MediaSourceKind = "browser_ingest"
    source_id: str | None = Field(default=None, min_length=1, max_length=160)


class LiveRunPreflightRequest(CamelModel):
    live_room_id: str = Field(min_length=1, max_length=36)
    expected_room_version: int = Field(ge=1)
    legal_source_confirmed: bool = False
    media_source: LiveRunMediaSource = Field(default_factory=LiveRunMediaSource)


class LiveRunCreate(LiveRunPreflightRequest):
    request_id: str = Field(min_length=8, max_length=100)


class LiveRunPreflightCheck(CamelModel):
    code: str
    label: str
    passed: bool
    message: str


class LiveRunPreflightResponse(CamelModel):
    ready: bool
    live_room_id: str
    room_version: int | None = None
    media_source_kind: MediaSourceKind
    target_count: int = 0
    checks: list[LiveRunPreflightCheck]
    checked_at: datetime


class LiveRunTargetResponse(CamelModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        from_attributes=True,
    )

    id: str
    platform_connection_id: str
    connection_version: int
    connection_name: str
    platform_label: str
    stream_key_last4: str
    status: LiveRunTargetStatus
    retry_count: int
    error_code: str | None = None
    error_message: str | None = None
    started_at: datetime | None = None
    stopped_at: datetime | None = None


class LiveRunIngestResponse(CamelModel):
    protocol: Literal["whip"] = "whip"
    url: str
    stream_name: str


class LiveRunResponse(CamelModel):
    id: str
    request_id: str
    live_room_id: str
    status: LiveRunStatus
    room_version: int
    media_source_kind: MediaSourceKind
    media_source_id: str | None = None
    legal_source_confirmed: bool
    error_code: str | None = None
    error_message: str | None = None
    heartbeat_at: datetime | None = None
    started_at: datetime | None = None
    stopped_at: datetime | None = None
    created_at: datetime
    updated_at: datetime
    targets: list[LiveRunTargetResponse]
    ingest: LiveRunIngestResponse | None = None
