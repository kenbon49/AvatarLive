"""LLM 集中配置：模型表 + LiteLLM 凭据 + 消息规整。

移植自 seo_video_generate/services/llm_model_service.py，去掉 Django 依赖，
凭据改从 app.core.config.settings 读取（LITELLM_LLM_API_KEY / LITELLM_LLM_BASE_URL）。
"""

from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx

from ...core.config import settings

# 可用模型表（id → LiteLLM model 串）
LITELLM_MODEL_OPTIONS = [
    {
        "id": "llm-gpt",
        "provider": "gpt",
        "name": "GPT",
        "model": "openai/azure-gpt-5.4",
        "display_model": "azure-gpt-5.4",
        "description": "Azure GPT 5.4 via LiteLLM",
        "temperature": 1.0,
        "supports_images": True,
        "max_output_tokens": 32768,
    },
    {
        "id": "llm-deepseek",
        "provider": "deepseek",
        "name": "DeepSeek",
        "model": "openai/deepseek-v4-pro",
        "display_model": "deepseek-v4-pro",
        "description": "DeepSeek V4 Pro via LiteLLM",
        "temperature": 0.7,
        "supports_images": False,
        "max_output_tokens": 8192,
    },
    {
        "id": "llm-gemini",
        "provider": "gemini",
        "name": "Gemini",
        "model": "openai/gemini-3-pro-preview",
        "display_model": "gemini-3-pro-preview",
        "description": "Gemini 3 Pro Preview via LiteLLM",
        "temperature": 0.7,
        "supports_images": True,
        "max_output_tokens": 8192,
    },
    {
        "id": "llm-doubao",
        "provider": "doubao",
        "name": "Doubao",
        "model": "openai/doubao-seed-2-0-pro-260215",
        "display_model": "doubao-seed-2-0-pro-260215",
        "description": "Doubao Seed 2.0 Pro via LiteLLM",
        "temperature": 0.7,
        "supports_images": True,
        "max_output_tokens": 8192,
    },
]

MODEL_MAP = {item["id"]: item for item in LITELLM_MODEL_OPTIONS}
MODEL_BY_DISPLAY_NAME = {item["display_model"]: item for item in LITELLM_MODEL_OPTIONS}
MODEL_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$")


class LlmModelDiscoveryError(RuntimeError):
    pass

# 数字人直播主播默认人设（口播向、简洁、不编造）
DEFAULT_PERSONA_SYSTEM_PROMPT = (
    "你是一名专业的 AI 数字人直播主播兼客服。请用口语化、热情、简洁的中文回答观众问题；"
    "回答控制在 2-3 句话以内、适合口播；不要编造不确定的信息，不知道就说不太清楚并建议咨询；"
    "避免使用 Markdown、表情符号和列表符号。"
)


def get_litellm_config() -> tuple[str, str, int]:
    """返回 (api_key, api_base, max_output_tokens)，统一从 settings 读取。"""
    from ...security.settings_store import effective_api_value
    return (
        effective_api_value("llm_api_key"),
        effective_api_value("llm_base_url"),
        settings.llm_max_output_tokens,
    )


def get_litellm_default_model_id() -> str:
    from ...security.settings_store import effective_api_value
    return effective_api_value("llm_default_model_id").strip() or "llm-gpt"


def resolve_litellm_model(model_id: str) -> dict:
    """Resolve legacy aliases and provider model IDs discovered from /models."""
    normalized = model_id.strip()
    known = MODEL_MAP.get(normalized) or MODEL_BY_DISPLAY_NAME.get(normalized)
    if known:
        return {**known, "id": normalized}
    if not MODEL_ID_PATTERN.fullmatch(normalized):
        raise ValueError("不支持的 LLM 模型")
    return {
        "id": normalized,
        "provider": "openai-compatible",
        "name": normalized,
        "model": f"openai/{normalized}",
        "display_model": normalized,
        "description": "OpenAI-compatible model",
        "temperature": 0.7,
        # OpenAI-compatible model catalogs do not expose modality metadata.
        # Let the selected upstream validate image support when images are sent.
        "supports_images": True,
        "max_output_tokens": settings.llm_max_output_tokens,
    }


def validate_litellm_base_url(value: str) -> str:
    normalized = value.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("LLM 服务地址必须是完整的 HTTPS 地址")
    if parsed.query or parsed.fragment:
        raise ValueError("LLM 服务地址不能包含查询参数或片段")
    return normalized


async def discover_litellm_models(*, api_key: str | None = None, api_base: str | None = None) -> list[dict]:
    """Read an OpenAI-compatible /models catalog without making a billable completion."""
    configured_key, configured_base, _ = get_litellm_config()
    key = (api_key if api_key is not None else configured_key).strip()
    base = validate_litellm_base_url(api_base if api_base is not None else configured_base)
    if not key:
        raise LlmModelDiscoveryError("LLM API Key 尚未配置")
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(20.0, connect=8.0),
            follow_redirects=False,
        ) as client:
            response = await client.get(
                f"{base}/models",
                headers={"Authorization": f"Bearer {key}", "Accept": "application/json"},
            )
    except httpx.TimeoutException as exc:
        raise LlmModelDiscoveryError("读取模型列表超时") from exc
    except httpx.HTTPError as exc:
        raise LlmModelDiscoveryError("无法连接 LLM 服务") from exc
    if response.status_code in {401, 403}:
        raise LlmModelDiscoveryError("LLM API Key 无效或无权读取模型列表")
    if not response.is_success:
        raise LlmModelDiscoveryError(f"LLM 模型接口返回 HTTP {response.status_code}")
    try:
        payload = response.json()
    except ValueError as exc:
        raise LlmModelDiscoveryError("LLM 模型接口没有返回有效 JSON") from exc
    candidates = payload.get("data") if isinstance(payload, dict) else None
    if not isinstance(candidates, list) and isinstance(payload, dict):
        candidates = payload.get("models")
    if not isinstance(candidates, list):
        raise LlmModelDiscoveryError("LLM 模型接口返回格式不兼容")
    discovered: dict[str, dict] = {}
    for item in candidates[:2000]:
        if isinstance(item, str):
            model_id, owner = item.strip(), ""
        elif isinstance(item, dict):
            raw_id = item.get("id") or item.get("model") or item.get("name")
            model_id = raw_id.strip() if isinstance(raw_id, str) else ""
            raw_owner = item.get("owned_by") or item.get("provider") or ""
            owner = raw_owner.strip()[:80] if isinstance(raw_owner, str) else ""
        else:
            continue
        if MODEL_ID_PATTERN.fullmatch(model_id):
            discovered[model_id] = {"id": model_id, "ownedBy": owner}
        if len(discovered) >= 500:
            break
    if not discovered:
        raise LlmModelDiscoveryError("LLM 服务没有返回可用模型")
    return [discovered[key] for key in sorted(discovered, key=str.casefold)]


def list_litellm_models() -> list[dict]:
    """返回前端可用模型配置，不暴露 API Key。"""
    return [
        {
            "id": item["id"],
            "provider": item["provider"],
            "name": item["name"],
            "model": item["display_model"],
            "description": item["description"],
            "supports_images": item["supports_images"],
        }
        for item in LITELLM_MODEL_OPTIONS
    ]


def _normalize_content(content):
    if isinstance(content, str):
        return content.strip()

    if not isinstance(content, list):
        return None

    normalized = []
    for item in content:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if item_type == "text":
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                normalized.append({"type": "text", "text": text.strip()})
        elif item_type == "image_url":
            image_url = item.get("image_url") or {}
            url = image_url.get("url") if isinstance(image_url, dict) else None
            if isinstance(url, str) and (
                url.startswith("data:image/")
                or url.startswith("http://")
                or url.startswith("https://")
            ):
                normalized.append({"type": "image_url", "image_url": {"url": url}})

    return normalized or None


def _messages_have_images(messages: list[dict]) -> bool:
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, list):
            for item in content:
                if isinstance(item, dict) and item.get("type") == "image_url":
                    return True
    return False


def _normalize_messages(messages: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    for msg in messages[-20:]:
        role = msg.get("role")
        content = msg.get("content")
        if role not in {"system", "user", "assistant"}:
            continue
        clean_content = _normalize_content(content)
        if not clean_content:
            continue
        normalized.append({"role": role, "content": clean_content})
    return normalized


def _normalize_temperature(model_name: str, temperature: float | None, default_temperature: float) -> float:
    """
    GPT 5 系列通过当前 LiteLLM 代理调用时仅接受 temperature=1。
    其他模型保持传入值或模型默认值。
    """
    if "gpt-5" in model_name or "azure-gpt-5" in model_name:
        return 1.0
    if temperature is None:
        return default_temperature
    return max(0.0, min(float(temperature), 2.0))


def _format_litellm_error(exc: Exception) -> str:
    error_msg = str(exc)
    lowered = error_msg.lower()
    if "api_key" in lowered or "authentication" in lowered or "unauthorized" in lowered:
        return "LiteLLM API Key 无效或已过期"
    if "rate" in lowered or "quota" in lowered:
        return "LiteLLM 配额不足或触发速率限制"
    return f"LLM 调用失败: {error_msg[:300]}"
