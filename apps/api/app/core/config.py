"""全局配置：统一从 .env 读取（pydantic-settings）。

直播间控制台配置使用 PostgreSQL；Redis / Qdrant / MinIO 的连接串继续保留给
后续阶段（实时队列、RAG、资产落盘）启用，避免来回改 .env。
"""

from __future__ import annotations

from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- App ---
    app_name: str = "SynLive API"
    debug: bool = False
    api_prefix: str = "/api/v1"
    cors_origins: str = "http://localhost:3000,http://localhost:3001"

    # --- Azure TTS（与 LiveTalking azuretts 插件共用同一把 Key）---
    azure_service_key: str = ""
    azure_service_region: str = "eastasia"

    # --- 渲染后端（数字人驱动，可切换） ---
    # unreal     : UE5 + MetaHuman + Pixel Streaming（默认，3D 数字人）。
    #              后端 POST 文本到 UE 工程的 HTTP 接口；驱动由 UE 侧 Convai 完成。
    # livetalking: 旧 2D talking-head（见下方 LiveTalking 配置），保留作降级 / 对照。
    renderer_backend: str = "unreal"
    # UE 工程接收文本的 HTTP 接口（A 线在 UE 侧用 Remote Control / HttpServer / Python bridge 开）。
    # 留空 → speak() 降级返回，不阻塞主链路，等 UE 工程就绪后再填。
    ue_render_url: str = ""
    ue_render_timeout: float = 8.0

    # --- LiveTalking（旧 2D 后端，切回 RENDERER_BACKEND=livetalking 时生效）---
    # 本地（无 GPU）不真正渲染，会优雅降级；GPU 机器上指向 LiveTalking 服务
    livetalking_enabled: bool = True
    livetalking_url: str = "http://livetalking:8010"
    livetalking_timeout: float = 8.0

    # --- LLM（LiteLLM 网关，移植自 seo_video_generate）---
    # env 变量名沿用源项目约定（LITELLM_LLM_API_KEY / LITELLM_LLM_BASE_URL）
    llm_api_key: str = Field(
        default="",
        validation_alias=AliasChoices("LLM_API_KEY", "LITELLM_LLM_API_KEY"),
    )
    llm_base_url: str = Field(
        default="https://litellm.zuzuche.com/v1",
        validation_alias=AliasChoices("LLM_BASE_URL", "LITELLM_LLM_BASE_URL"),
    )
    # 默认模型 id（llm-gpt / llm-deepseek / llm-gemini / llm-doubao）
    llm_default_model_id: str = "llm-gpt"
    llm_max_output_tokens: int = 8192
    llm_request_timeout: int = 120

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
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"
    minio_endpoint: str = "localhost:9000"
    minio_access_key: str = "minioadmin"
    minio_secret_key: str = "minioadmin"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
