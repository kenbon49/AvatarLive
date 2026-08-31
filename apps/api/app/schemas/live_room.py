"""Validated live-room control-console configuration schemas."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class CamelModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
    )


class LiveRoomGoodsItem(CamelModel):
    id: int
    name: str = Field(min_length=1, max_length=200)
    source: str = Field(min_length=1, max_length=80)


class LiveRoomScriptItem(CamelModel):
    id: int
    title: str = Field(min_length=1, max_length=200)
    category: Literal["开场", "讲品", "促单"]
    duration: str = Field(max_length=20)
    text: str = Field(min_length=1, max_length=20000)
    state: Literal["ready", "playing", "done"] = "ready"


class LiveRoomQaItem(CamelModel):
    id: int
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=10000)


class LiveRoomAssetItem(CamelModel):
    id: str = Field(min_length=1, max_length=160)
    kind: Literal["image", "video"]
    name: str = Field(min_length=1, max_length=500)
    preview: str | None = None


class LiveRoomLayerItem(CamelModel):
    id: str = Field(min_length=1, max_length=160)
    kind: Literal["text", "image", "video", "host"]
    value: str = Field(max_length=10000)
    scene_key: Literal[
        "host",
        "custom",
        "templateBackground",
        "templateTitle",
        "templateTag",
        "templateFooter",
    ] | None = None
    preview: str | None = None
    x: float
    y: float
    width: float
    height: float
    rotation: float
    opacity: float
    font_size: float | None = None
    color: str | None = Field(default=None, max_length=80)
    font_family: str | None = Field(default=None, max_length=160)
    letter_spacing: float | None = None
    font_weight: Literal["normal", "bold"] | None = None
    font_style: Literal["normal", "italic"] | None = None
    text_decoration: Literal["none", "underline", "line-through"] | None = None
    text_align: Literal["left", "center", "right"] | None = None
    line_height: float | None = None
    stroke_enabled: bool | None = None
    stroke_color: str | None = Field(default=None, max_length=80)
    shadow_enabled: bool | None = None
    shadow_color: str | None = Field(default=None, max_length=80)
    shadow_blur: float | None = None
    shadow_x: float | None = None
    shadow_y: float | None = None


class LiveRoomVoiceSettings(CamelModel):
    voice_id: str = Field(min_length=1, max_length=160)
    speed: float = Field(ge=0.5, le=2.0)
    pitch: float = Field(ge=-20, le=20)


class LiveRoomOptions(CamelModel):
    qa: bool
    dynamic: bool
    ambience: bool
    product: bool
    reply_limit: int = Field(ge=1, le=20)
    reply_mode: Literal["hybrid", "library"]


class LiveRoomOutputConfig(CamelModel):
    resolution: str = Field(min_length=1, max_length=40)
    frame_rate: str = Field(min_length=1, max_length=40)
    codec: str = Field(min_length=1, max_length=40)
    protocol: str = Field(min_length=1, max_length=40)


class LiveRoomAssets(CamelModel):
    image: list[LiveRoomAssetItem] = Field(default_factory=list, max_length=500)
    video: list[LiveRoomAssetItem] = Field(default_factory=list, max_length=500)


class LiveRoomConfig(CamelModel):
    schema_version: Literal[1] = 1
    avatar_id: str = Field(min_length=1, max_length=160)
    voice: LiveRoomVoiceSettings
    playback_mode: Literal["sequence", "random"]
    goods: list[LiveRoomGoodsItem] = Field(min_length=1, max_length=500)
    active_goods_id: int
    scripts: list[LiveRoomScriptItem] = Field(default_factory=list, max_length=5000)
    qa_items: list[LiveRoomQaItem] = Field(default_factory=list, max_length=5000)
    selected_template_id: str = Field(min_length=1, max_length=160)
    layers: list[LiveRoomLayerItem] = Field(default_factory=list, max_length=1000)
    live_options: LiveRoomOptions
    output_config: LiveRoomOutputConfig
    selected_platforms: list[str] = Field(default_factory=list, max_length=50)
    assets: LiveRoomAssets = Field(default_factory=LiveRoomAssets)


class LiveRoomCreate(CamelModel):
    name: str = Field(min_length=1, max_length=120)
    config: LiveRoomConfig


class LiveRoomUpdate(LiveRoomCreate):
    expected_version: int = Field(ge=1)


class LiveRoomCopy(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)


class LiveRoomResponse(CamelModel):
    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="forbid",
        from_attributes=True,
    )

    id: str
    slug: str
    name: str
    status: Literal["draft", "published"]
    version: int
    config: LiveRoomConfig
    created_at: datetime
    updated_at: datetime
