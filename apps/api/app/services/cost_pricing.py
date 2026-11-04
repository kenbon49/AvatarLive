"""Versioned provider pricing and deterministic micro-RMB calculations."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timezone
from decimal import Decimal, ROUND_CEILING
from functools import lru_cache
import json
import math
from zoneinfo import ZoneInfo

import holidays

from ..core.config import settings


MICROS_PER_RMB = 1_000_000
CREDITS_PER_RMB = 100
MICROS_PER_CREDIT = MICROS_PER_RMB // CREDITS_PER_RMB
DEEPSEEK_PRICING_VERSION = "deepseek-cn-2026-09-23"
ALIYUN_VIDEO_PRICING_VERSION = "aliyun-lingmou-6rmb-minute-2025-05-27"
SHANGHAI = ZoneInfo("Asia/Shanghai")


@dataclass(frozen=True)
class CostQuote:
    amount_micros: int
    provider: str
    model: str
    pricing_version: str
    time_band: str


DEEPSEEK_RATES = {
    "deepseek-flash": {
        "off_peak": {"cache_hit": Decimal("0.02"), "cache_miss": Decimal("1"), "output": Decimal("4")},
        "peak": {"cache_hit": Decimal("0.04"), "cache_miss": Decimal("2"), "output": Decimal("8")},
    },
    "deepseek-v4-pro": {
        "off_peak": {"cache_hit": Decimal("0.15"), "cache_miss": Decimal("4.5"), "output": Decimal("13.5")},
        "peak": {"cache_hit": Decimal("0.30"), "cache_miss": Decimal("9"), "output": Decimal("27")},
    },
}


@lru_cache(maxsize=8)
def _china_holidays(year: int) -> set[str]:
    return {day.isoformat() for day in holidays.country_holidays("CN", years=[year])}


def credits_to_micros(credits: int | float | Decimal) -> int:
    return int((Decimal(str(credits)) * MICROS_PER_CREDIT).to_integral_value(rounding=ROUND_CEILING))


def micros_to_credits(micros: int) -> float:
    return float((Decimal(micros) / MICROS_PER_CREDIT).quantize(Decimal("0.0001")))


def micros_to_rmb(micros: int | None) -> float | None:
    if micros is None:
        return None
    return float((Decimal(micros) / MICROS_PER_RMB).quantize(Decimal("0.000001")))


def deepseek_time_band(at: datetime | None = None) -> str:
    moment = at or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    local = moment.astimezone(SHANGHAI)
    configured_holidays = {item.strip() for item in settings.deepseek_holiday_dates.split(",") if item.strip()}
    holiday_dates = _china_holidays(local.year) | configured_holidays
    clock = local.timetz().replace(tzinfo=None)
    peak_window = time(9) <= clock < time(12) or time(14) <= clock < time(18)
    return "peak" if local.weekday() < 5 and local.date().isoformat() not in holiday_dates and peak_window else "off_peak"


def _model_family(model: str) -> str | None:
    normalized = model.lower().replace("_", "-")
    if "deepseek" not in normalized:
        return None
    if "v4-pro" in normalized or normalized.endswith("-pro"):
        return "deepseek-v4-pro"
    if "flash" in normalized:
        return "deepseek-flash"
    return None


def _override_rates(model: str, band: str) -> dict[str, Decimal] | None:
    try:
        payload = json.loads(settings.llm_pricing_override_json or "{}")
        row = payload.get(model) or payload.get("*")
        values = row.get(band) if isinstance(row, dict) else None
        if not isinstance(values, dict):
            return None
        return {name: Decimal(str(values[name])) for name in ("cache_hit", "cache_miss", "output")}
    except (ValueError, TypeError, KeyError, json.JSONDecodeError):
        return None


def llm_rates(model: str, at: datetime | None = None) -> tuple[dict[str, Decimal], str, str]:
    band = deepseek_time_band(at)
    override = _override_rates(model, band)
    if override is not None:
        return override, band, "gateway-config-v1"
    family = _model_family(model)
    if family is None:
        raise ValueError(f"模型 {model} 尚未配置计费价格")
    return DEEPSEEK_RATES[family][band], band, DEEPSEEK_PRICING_VERSION


def estimate_message_tokens(messages: list[dict], system_prompt: str = "") -> int:
    # Conservative tokenizer-independent estimate for reservation only. The
    # final charge always uses provider-reported usage.
    serialized = json.dumps([{"role": "system", "content": system_prompt}, *messages], ensure_ascii=False)
    image_count = serialized.count("image_url")
    return max(1, math.ceil(len(serialized) / 2) + image_count * 1_500)


def quote_llm_reservation(
    model: str,
    messages: list[dict],
    system_prompt: str,
    max_output_tokens: int,
    at: datetime | None = None,
) -> CostQuote:
    rates, band, version = llm_rates(model, at)
    input_tokens = estimate_message_tokens(messages, system_prompt)
    amount = Decimal(input_tokens) * rates["cache_miss"] + Decimal(max_output_tokens) * rates["output"]
    return CostQuote(
        amount_micros=max(1, int(amount.to_integral_value(rounding=ROUND_CEILING))),
        provider="deepseek-compatible",
        model=model,
        pricing_version=version,
        time_band=band,
    )


def quote_llm_actual(
    model: str,
    cache_hit_tokens: int,
    cache_miss_tokens: int,
    output_tokens: int,
    at: datetime | None = None,
) -> CostQuote:
    rates, band, version = llm_rates(model, at)
    amount = (
        Decimal(max(0, cache_hit_tokens)) * rates["cache_hit"]
        + Decimal(max(0, cache_miss_tokens)) * rates["cache_miss"]
        + Decimal(max(0, output_tokens)) * rates["output"]
    )
    return CostQuote(
        amount_micros=max(0, int(amount.to_integral_value(rounding=ROUND_CEILING))),
        provider="deepseek-compatible",
        model=model,
        pricing_version=version,
        time_band=band,
    )


def quote_video_reservation(characters: int, speech_rate: float = 1.0) -> CostQuote:
    safe_rate = min(2.0, max(0.5, speech_rate))
    estimated_seconds = (
        max(1, math.ceil(characters / (2.0 * safe_rate) + 5))
        if characters > 0 else 1
    )
    return CostQuote(
        amount_micros=estimated_seconds * settings.aliyun_video_micros_per_second,
        provider="aliyun-lingmou",
        model="CreateBroadcastVideoFromTemplate",
        pricing_version=ALIYUN_VIDEO_PRICING_VERSION,
        time_band="standard",
    )


def quote_video_actual(duration_seconds: float) -> tuple[CostQuote, int]:
    billable_seconds = max(1, math.ceil(duration_seconds))
    return CostQuote(
        amount_micros=billable_seconds * settings.aliyun_video_micros_per_second,
        provider="aliyun-lingmou",
        model="CreateBroadcastVideoFromTemplate",
        pricing_version=ALIYUN_VIDEO_PRICING_VERSION,
        time_band="standard",
    ), billable_seconds


def charged_amount(upstream_cost_micros: int) -> int:
    if upstream_cost_micros <= 0:
        return 0
    marked_up = (
        Decimal(upstream_cost_micros) * Decimal(settings.billing_markup_basis_points) / Decimal(10_000)
    ).to_integral_value(rounding=ROUND_CEILING)
    return max(settings.billing_min_charge_micros, int(marked_up))
