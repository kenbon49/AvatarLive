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
        "llm_configured": bool(effective_api_value("llm_api_key")),
        "llm_default_model_id": get_litellm_default_model_id(),
    }
