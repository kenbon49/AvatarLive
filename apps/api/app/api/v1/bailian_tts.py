"""Authenticated BaiLian requests using admin-owned, encrypted credentials."""

from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from ...services.bailian_config import active_bailian_configuration
from ...services.external_api_logs import external_api_call


router = APIRouter(prefix="/tts/bailian", tags=["tts"])
VC_MODEL = "qwen3-tts-vc-2026-01-22"
VD_MODEL = "qwen3-tts-vd-2026-01-26"


class ProviderRequest(BaseModel):
    credential_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    model: Literal["qwen-voice-enrollment", "qwen-voice-design", "qwen3-tts-vc-2026-01-22"]
    input: dict


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    voice: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,200}$")


class EnrollmentAudio(BaseModel):
    data: str = Field(pattern=r"^data:audio/mpeg;base64,[A-Za-z0-9+/]+=*$", max_length=14_000_000)


class EnrollmentInput(BaseModel):
    action: Literal["create"]
    target_model: Literal["qwen3-tts-vc-2026-01-22"]
    preferred_name: str = Field(pattern=r"^[A-Za-z0-9_]{1,16}$")
    audio: EnrollmentAudio
    text: str = Field(min_length=1, max_length=500)
    language: Literal["zh", "en", "ja", "ko"]


class DesignInput(BaseModel):
    action: Literal["create"]
    target_model: Literal["qwen3-tts-vd-2026-01-26"]
    preferred_name: str = Field(pattern=r"^[A-Za-z0-9_]{1,16}$")
    voice_prompt: str = Field(min_length=1, max_length=1200)
    preview_text: str = Field(min_length=1, max_length=500)
    language: Literal["zh"]


@router.get("/configuration")
def configuration() -> dict:
    key, base_url, credential_id = active_bailian_configuration()
    # The browser and Web process receive a version fingerprint, never the key.
    return {"configured": bool(key), "base_url": base_url, "credential_id": credential_id}


@router.post("/request")
async def provider_request(payload: ProviderRequest) -> dict:
    key, base_url, credential_id = active_bailian_configuration()
    if not key:
        raise HTTPException(status_code=503, detail="请在管理员系统设置中配置百炼语音 API Key")
    if payload.credential_id != credential_id:
        raise HTTPException(status_code=409, detail="百炼密钥已更新，请重新试听")
    input_model = {
        "qwen-voice-enrollment": EnrollmentInput,
        "qwen-voice-design": DesignInput,
        VC_MODEL: SpeechInput,
    }[payload.model]
    try:
        validated = input_model.model_validate(payload.input)
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail="百炼语音请求参数无效") from exc
    body = {"model": payload.model, "input": validated.model_dump()}
    if payload.model == "qwen-voice-design":
        body["parameters"] = {"sample_rate": 24000, "response_format": "wav"}
    url = base_url + ("/services/aigc/multimodal-generation/generation" if payload.model == VC_MODEL else "/services/audio/tts/customization")
    with external_api_call("bailian", payload.model, url, request=body, secrets=[key]) as log:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=False) as client:
                response = await client.post(url, json=body, headers={"Authorization": f"Bearer {key}"})
                log.http_response(response)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="连接百炼语音服务失败或超时，请检查网络后重试") from exc
        if response.status_code in {401, 403}:
            raise HTTPException(status_code=502, detail="百炼 API Key 无效或没有当前语音模型的访问权限")
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="百炼请求过于频繁或额度不足，请稍后重试")
        if response.status_code != 200:
            raise HTTPException(status_code=502, detail=f"百炼语音调用失败（HTTP {response.status_code}），请检查账户额度和模型权限")
        try:
            result = response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="百炼语音返回格式无效",
                                headers={"x-bailian-provider-accepted": "true"}) from exc
        if not isinstance(result, dict) or result.get("code") or not isinstance(result.get("output"), dict):
            raise HTTPException(status_code=502, detail="百炼语音调用返回异常，请检查账户额度、模型权限和输入内容",
                                headers={"x-bailian-provider-accepted": "true"})
        output = result["output"]
        # Forward only fields consumed by the local audio client.
        fields = ("audio",) if payload.model == VC_MODEL else ("voice", "preview_audio")
        return {"output": {name: output[name] for name in fields if name in output}}
