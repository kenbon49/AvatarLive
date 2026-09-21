"""LLM 服务模块。

通过 LiteLLM 网关统一调用 GPT / DeepSeek / Gemini / Doubao
（移植自 seo_video_generate/services/llm_model_service.py，解耦 Django）。
"""

from .chat import complete_litellm_chat, stream_litellm_chat
from .config import (
    DEFAULT_PERSONA_SYSTEM_PROMPT,
    LlmModelDiscoveryError,
    LITELLM_MODEL_OPTIONS,
    MODEL_MAP,
    discover_litellm_models,
    get_litellm_config,
    get_litellm_default_model_id,
    list_litellm_models,
    resolve_litellm_model,
    validate_litellm_base_url,
)

__all__ = [
    "DEFAULT_PERSONA_SYSTEM_PROMPT",
    "LlmModelDiscoveryError",
    "LITELLM_MODEL_OPTIONS",
    "MODEL_MAP",
    "complete_litellm_chat",
    "discover_litellm_models",
    "stream_litellm_chat",
    "get_litellm_config",
    "get_litellm_default_model_id",
    "list_litellm_models",
    "resolve_litellm_model",
    "validate_litellm_base_url",
]
