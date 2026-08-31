"""Schemas for encrypted platform connections managed by the live console."""

from __future__ import annotations

from datetime import datetime
from typing import Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic import ConfigDict, Field, field_validator

from .live_room import CamelModel, to_camel


def normalize_rtmp_server_url(value: str) -> str:
    candidate = value.strip()
    parsed = urlsplit(candidate)
    if parsed.scheme not in {"rtmp", "rtmps"}:
        raise ValueError("serverUrl must use rtmp:// or rtmps://")
    if not parsed.hostname:
        raise ValueError("serverUrl must include a hostname")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError("serverUrl cannot contain credentials, query parameters, or fragments")
    try:
        _ = parsed.port
    except ValueError as exc:
        raise ValueError("serverUrl contains an invalid port") from exc
    path = parsed.path.rstrip("/")
    return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))


class PlatformConnectionCreate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    platform_label: str = Field(default="通用 RTMP", min_length=1, max_length=80)
    server_url: str = Field(min_length=8, max_length=500)
    stream_key: str = Field(min_length=1, max_length=1000)

    @field_validator("name", "platform_label", "stream_key")
    @classmethod
    def strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value cannot be blank")
        return stripped

    @field_validator("server_url")
    @classmethod
    def validate_server_url(cls, value: str) -> str:
        return normalize_rtmp_server_url(value)


class PlatformConnectionUpdate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    platform_label: str = Field(min_length=1, max_length=80)
    server_url: str = Field(min_length=8, max_length=500)
    stream_key: str | None = Field(default=None, min_length=1, max_length=1000)
    status: Literal["enabled", "disabled"]
    expected_version: int = Field(ge=1)

    @field_validator("name", "platform_label")
    @classmethod
    def strip_text(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("value cannot be blank")
        return stripped

    @field_validator("stream_key")
    @classmethod
    def strip_optional_secret(cls, value: str | None) -> str | None:
        if value is None:
            return None
        stripped = value.strip()
        if not stripped:
            raise ValueError("streamKey cannot be blank")
        return stripped

    @field_validator("server_url")
    @classmethod
    def validate_server_url(cls, value: str) -> str:
        return normalize_rtmp_server_url(value)


class PlatformConnectionResponse(CamelModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        from_attributes=True,
    )

    id: str
    kind: Literal["manual_rtmp"]
    name: str
    platform_label: str
    server_url: str
    stream_key_last4: str
    status: Literal["enabled", "disabled"]
    test_status: Literal["untested", "passed", "failed"]
    test_message: str | None = None
    last_tested_at: datetime | None = None
    version: int
    created_at: datetime
    updated_at: datetime
