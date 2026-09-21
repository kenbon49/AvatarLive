"""LLM 路由：模型列表 + 非流式对话 + SSE 流式对话。"""

from __future__ import annotations

import asyncio
import time
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger
from starlette.concurrency import iterate_in_threadpool
from sqlalchemy.orm import Session

from ...db.session import SessionLocal, get_db
from ...models.account import User
from ...security.accounts import require_user
from ...schemas.llm import ChatRequest, ChatResponse
from ...services.llm import (
    DEFAULT_PERSONA_SYSTEM_PROMPT,
    LlmModelDiscoveryError,
    complete_litellm_chat,
    discover_litellm_models,
    get_litellm_config,
    get_litellm_default_model_id,
    stream_litellm_chat,
)
from ...services.billing import charge_api_usage, mark_api_usage

router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/models")
async def list_models() -> dict:
    api_key, _, _ = get_litellm_config()
    try:
        discovered = await discover_litellm_models() if api_key else []
    except (LlmModelDiscoveryError, ValueError) as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "default_model_id": get_litellm_default_model_id(),
        "configured": bool(api_key),
        "models": [{
            "id": item["id"],
            "provider": item["ownedBy"] or "openai-compatible",
            "name": item["id"],
            "model": item["id"],
            "description": "OpenAI-compatible model",
            "supports_images": True,
        } for item in discovered],
    }


@router.post("/chat", response_model=ChatResponse)
async def chat(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> ChatResponse:
    model_id = req.model_id or get_litellm_default_model_id()
    messages = [m.model_dump() for m in req.messages]
    start = time.perf_counter()
    usage = charge_api_usage(db, user, "llm_chat", f"llm:{uuid4()}", detail={"model": model_id})
    logger.info("[LLM] request started: model={} messages={}", model_id, len(messages))
    try:
        # litellm.completion 同步阻塞，丢线程池避免卡事件循环
        result = await asyncio.to_thread(
            complete_litellm_chat,
            model_id=model_id,
            messages=messages,
            system_prompt=req.system_prompt,
            max_tokens=req.max_tokens,
            temperature=req.temperature,
        )
    except ValueError as exc:
        mark_api_usage(db, usage.id, user.id, "failed")
        logger.warning("[LLM] request rejected: model={} reason={}", model_id, str(exc))
        raise HTTPException(status_code=400, detail=str(exc))
    except RuntimeError as exc:
        mark_api_usage(db, usage.id, user.id, "failed")
        logger.error("[LLM] request failed: model={} reason={}", model_id, str(exc))
        raise HTTPException(status_code=502, detail=str(exc))
    latency_ms = int((time.perf_counter() - start) * 1000)
    logger.info("[LLM] request completed: model={} latency_ms={}", model_id, latency_ms)
    mark_api_usage(db, usage.id, user.id, "succeeded")
    return ChatResponse(latency_ms=latency_ms, **result)


@router.post("/chat/stream")
async def chat_stream(
    req: ChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(require_user),
) -> StreamingResponse:
    model_id = req.model_id or get_litellm_default_model_id()
    messages = [m.model_dump() for m in req.messages]
    usage = charge_api_usage(db, user, "llm_chat", f"llm:{uuid4()}", detail={"model": model_id})

    async def event_source():
        final_status = "succeeded"
        try:
            # stream_litellm_chat 是同步生成器（litellm.completion 阻塞），
            # 用 iterate_in_threadpool 在线程池里迭代，避免阻塞事件循环
            async for chunk in iterate_in_threadpool(
                stream_litellm_chat(
                    model_id=model_id,
                    messages=messages,
                    system_prompt=req.system_prompt,
                    max_tokens=req.max_tokens,
                    temperature=req.temperature,
                )
            ):
                if "event: error" in chunk:
                    final_status = "failed"
                yield chunk
        except Exception as exc:  # 兜底，避免生成器中途抛异常破坏 SSE
            final_status = "failed"
            logger.error(f"[LLM] stream generator error: {exc}")
            yield f"event: error\ndata: {{\"message\": \"流式生成异常: {str(exc)[:200]}\"}}\n\n"
        finally:
            with SessionLocal() as usage_db:
                mark_api_usage(usage_db, usage.id, user.id, final_status)

    return StreamingResponse(
        event_source(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/persona")
async def default_persona() -> dict:
    """返回默认数字人主播人设，前端可基于此再编辑。"""
    return {"system_prompt": DEFAULT_PERSONA_SYSTEM_PROMPT}
