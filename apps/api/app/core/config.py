"""全局配置：统一从 .env 读取（pydantic-settings）。"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(Path(__file__).resolve().parent.parent.parent.parent.parent / ".env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- App ---
    app_name: str = "SynLive API"
    debug: bool = False
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    auth_cookie_secure: bool = True

    # --- OpenAI-compatible LLM；兼容旧 LITELLM_LLM_* 环境变量 ---
    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("LLM_API_KEY", "LITELLM_LLM_API_KEY"),
    )
    llm_base_url: str = Field(
        default="https://api.deepseek.com",
        validation_alias=AliasChoices("LLM_BASE_URL", "LITELLM_LLM_BASE_URL"),
    )
    # Can be a legacy alias or an ID returned by the configured /models endpoint.
    llm_default_model_id: str = "deepseek-flash"
    llm_max_output_tokens: int = 8192
    llm_request_timeout: int = 120
    # Cost accounting uses integer micro-RMB. Pricing overrides accept the
    # same RMB-per-million-token values published by the configured gateway.
    llm_pricing_override_json: str = "{}"
    deepseek_holiday_dates: str = ""
    billing_markup_basis_points: int = Field(default=10_000, ge=0, le=100_000)
    billing_min_charge_micros: int = Field(default=1, ge=0, le=1_000_000)
    aliyun_video_micros_per_second: int = Field(default=100_000, ge=1)
    aliyun_balance_cache_seconds: int = Field(default=600, ge=60, le=86_400)
    aliyun_low_balance_micros: int = Field(default=50_000_000, ge=0)
    # Kept for compatibility with older stored settings. New requests are not
    # billed by these fixed values.
    llm_credit_cost: int = Field(default=1, ge=1, le=1_000_000)
    storyboard_video_credit_cost: int = Field(default=10, ge=1, le=1_000_000)
    aliyun_access_key_id: str = ""
    aliyun_access_key_secret: str = ""
    bailian_tts_api_key: str = ""

    # --- 持久化与基础设施 ---
    database_url: str = "postgresql+psycopg://synlive:synlive@localhost:5432/synlive"
    # URL-safe base64 encoded 32-byte master key for AES-GCM credential envelopes.
    platform_encryption_key: str = ""
    # JSON object mapping connector slugs to HMAC secrets, for example
    # {"douyin-bridge":"replace-with-a-random-secret"}.
    platform_webhook_secrets: str = "{}"
    platform_webhook_signature_tolerance_seconds: int = Field(default=300, ge=30, le=3600)
    platform_webhook_rate_limit_per_minute: int = Field(default=600, ge=1, le=100_000)
    # Test-pattern publishing is opt-in and must stay disabled in production.
    live_run_allow_test_pattern: bool = False
    # Media supervisor settings. The API container publishes to SRS over the
    # compose network; override for a host-local or remote media gateway.
    media_supervisor_enabled: bool = True
    srs_internal_rtmp_url: str = "rtmp://srs:1935/live"
    srs_internal_api_url: str = "http://srs:1985"
    # Browsers publish WHIP signaling through the same-origin Caddy route.
    srs_public_whip_path: str = "/rtc/v1/whip/"
    ffmpeg_binary: str = "ffmpeg"
    media_heartbeat_interval: float = 2.0
    media_ingest_wait_timeout: float = 30.0
    media_ingest_disconnect_grace_seconds: float = 30.0
    media_max_retries: int = 3
    media_retry_backoff_seconds: float = 2.0
@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
