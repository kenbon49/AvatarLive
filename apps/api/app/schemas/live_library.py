"""Schemas for the reusable product catalog, room selections, and script library."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import ConfigDict, Field, model_validator

from .live_room import CamelModel, to_camel


ProductSourceType = Literal["self_built", "platform", "script_library"]


class ProductFields(CamelModel):
    name: str = Field(min_length=1, max_length=200)
    sku: str = Field(default="", max_length=160)
    image_url: str | None = Field(default=None, max_length=1000)
    price: float | None = Field(default=None, ge=0)
    original_price: float | None = Field(default=None, ge=0)
    selling_points: list[str] = Field(default_factory=list, max_length=30)
    stock_message: str = Field(default="", max_length=500)
    after_sales: str = Field(default="", max_length=5000)
    platform_product_id: str = Field(default="", max_length=200)
    risk_words: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def validate_prices(self):
        if self.price is not None and self.original_price is not None and self.original_price < self.price:
            raise ValueError("original price cannot be lower than the live price")
        return self


class ProductCreate(ProductFields):
    source_type: Literal["self_built"] = "self_built"


class ProductUpdate(ProductFields):
    pass


class ProductResponse(ProductFields):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", from_attributes=True)

    id: str
    source_type: ProductSourceType
    platform: str | None = None
    platform_account_id: str | None = None
    platform_status: str
    last_synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class LiveRoomProductCreate(ProductCreate):
    """Compatibility payload that creates and immediately selects a product."""


class LiveRoomProductUpdate(ProductUpdate):
    pass


class LiveRoomProductResponse(ProductResponse):
    live_room_id: str
    selection_id: str
    sort_order: int
    enabled: bool
    card_mode: Literal["visual", "native", "both"]


class LiveRoomProductSelectionCreate(CamelModel):
    product_ids: list[str] = Field(min_length=1, max_length=100)


class LiveRoomProductSelectionOrder(CamelModel):
    selection_ids: list[str] = Field(min_length=1, max_length=500)


class LiveRoomScriptBase(CamelModel):
    product_id: str | None = Field(default=None, max_length=36)
    title: str = Field(min_length=1, max_length=200)
    category: Literal["开场", "讲品", "促单"]
    duration: str = Field(default="00:30", max_length=20)
    text: str = Field(min_length=1, max_length=20000)
    tags: list[str] = Field(default_factory=list, max_length=30)


class LiveRoomScriptCreate(LiveRoomScriptBase):
    pass


class LiveRoomScriptUpdate(LiveRoomScriptBase):
    pass


class LiveRoomScriptResponse(LiveRoomScriptBase):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid", from_attributes=True)

    id: str
    live_room_id: str
