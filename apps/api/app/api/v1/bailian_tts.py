"""Authenticated BaiLian requests using admin-owned, encrypted credentials."""

from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field, ValidationError

from ...services.bailian_config import active_bailian_configuration
from ...services.bailian_speech import VC_MODEL, call_bailian, synthesize_speech


router = APIRouter(prefix="/tts/bailian", tags=["tts"])
VD_MODEL = "qwen3-tts-vd-2026-01-26"


class ProviderRequest(BaseModel):
    credential_id: str = Field(pattern=r"^[a-f0-9]{64}$")
    model: Literal["qwen-voice-enrollment", "qwen-voice-design", "qwen-audio-3.1-tts-plus"]
    input: dict


class SpeechInput(BaseModel):
    text: str = Field(min_length=1, max_length=800)
    voice: str = Field(pattern=r"^[A-Za-z0-9_.:-]{1,200}$")


class EnrollmentAudio(BaseModel):
    data: str = Field(pattern=r"^data:audio/mpeg;base64,[A-Za-z0-9+/]+=*$", max_length=14_000_000)


class EnrollmentInput(BaseModel):
    action: Literal["create"]
    target_model: Literal["qwen-audio-3.1-tts-plus"]
    preferred_name: str = Field(pattern=r"^[a-z0-9]{1,10}$")
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
    if payload.model == VC_MODEL:
        return {"output": await synthesize_speech(key, base_url, validated.text, validated.voice)}
    if payload.model == "qwen-voice-enrollment":
        body = {"model": "voice-enrollment", "input": {
            "action": "create_voice", "target_model": VC_MODEL,
            "prefix": validated.preferred_name, "audio": validated.audio.data,
        }}
    async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=False) as client:
        output = await call_bailian(client, key, base_url + "/services/audio/tts/customization", body)
    if payload.model == "qwen-voice-enrollment":
        return {"output": {"voice": output.get("voice_id")}}
    return {"output": {name: output[name] for name in ("voice", "preview_audio") if name in output}}
