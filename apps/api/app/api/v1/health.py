"""健康检查路由。"""

from __future__ import annotations

from fastapi import APIRouter

from ...core.config import settings
from ...security.settings_store import effective_api_value
from ...services.llm import get_litellm_default_model_id

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": settings.app_name}


@router.get("/health/ready")
async def ready() -> dict:
    return {
        "status": "ok",
        "azure_configured": bool(effective_api_value("azure_service_key")),
        "azure_region": effective_api_value("azure_service_region"),
        "llm_configured": bool(effective_api_value("llm_api_key")),
        "llm_default_model_id": get_litellm_default_model_id(),
        "renderer_backend": settings.renderer_backend,
        "ue_render_url": settings.ue_render_url,
        # 旧 LiveTalking 字段保留（切回 livetalking 后端时用）
        "livetalking_enabled": settings.livetalking_enabled,
        "livetalking_url": settings.livetalking_url,
    }
