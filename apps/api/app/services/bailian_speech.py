"""Current BaiLian HTTP speech API, with bounded voice readiness polling."""

from __future__ import annotations

import asyncio

import httpx
from fastapi import HTTPException

from .external_api_logs import external_api_call

VC_MODEL = "qwen-audio-3.1-tts-plus"


async def call_bailian(client: httpx.AsyncClient, key: str, url: str, body: dict,
                       *, provider_accepted: bool = False) -> dict:
    operation = body["model"]
    if body["input"].get("action"):
        operation += ":" + body["input"]["action"]
    with external_api_call("bailian", operation, url, request=body, secrets=[key]) as log:
        headers = {"x-bailian-provider-accepted": str(provider_accepted).lower()}
        try:
            response = await client.post(url, json=body, headers={"Authorization": f"Bearer {key}"})
            log.http_response(response)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="连接百炼语音服务失败或超时，请检查网络后重试", headers=headers) from exc
        if response.status_code in {401, 403}:
            raise HTTPException(status_code=502, detail="百炼 API Key 无效或没有当前语音模型的访问权限", headers=headers)
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="百炼请求过于频繁或额度不足，请稍后重试", headers=headers)
        if response.status_code != 200:
            detail = ("百炼当前语音模型不可用，请在日志查看中检查模型名称、地域及访问权限" if response.status_code == 404
                      else f"百炼语音调用失败（HTTP {response.status_code}），请在日志查看中检查详细错误")
            raise HTTPException(status_code=502, detail=detail, headers=headers)
        try:
            result = response.json()
        except ValueError as exc:
            raise HTTPException(status_code=502, detail="百炼语音返回格式无效",
                                headers={"x-bailian-provider-accepted": "true"}) from exc
        if not isinstance(result, dict) or result.get("code") or not isinstance(result.get("output"), dict):
            raise HTTPException(status_code=502, detail="百炼语音调用返回异常，请检查账户额度、模型权限和输入内容",
                                headers={"x-bailian-provider-accepted": "true"})
        return result["output"]


async def synthesize_speech(key: str, base_url: str, text: str, voice: str) -> dict:
    async def wait_and_synthesize():
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0), follow_redirects=False) as client:
            for attempt in range(30):
                output = await call_bailian(client, key, base_url + "/services/audio/tts/customization", {
                    "model": "voice-enrollment", "input": {"action": "query_voice", "voice_id": voice},
                }, provider_accepted=True)
                status = output.get("status")
                if status == "OK":
                    break
                if status != "DEPLOYING":
                    raise HTTPException(status_code=502, detail="百炼音色未就绪，请在日志查看中检查音色状态",
                                        headers={"x-bailian-provider-accepted": "true"})
                if attempt == 29:
                    raise HTTPException(status_code=504, detail="百炼音色仍在准备中，请稍后重新试听，已注册音色会自动复用",
                                        headers={"x-bailian-provider-accepted": "true"})
                await asyncio.sleep(1)
            output = await call_bailian(client, key, base_url + "/services/audio/tts/SpeechSynthesizer", {
                "model": VC_MODEL, "input": {"text": text, "voice": voice, "format": "wav", "sample_rate": 24000},
            }, provider_accepted=True)
            return {"audio": output.get("audio")}
    try:
        return await asyncio.wait_for(wait_and_synthesize(), timeout=120)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="百炼音色准备或合成超时，请稍后重试，已注册音色会自动复用",
                            headers={"x-bailian-provider-accepted": "true"}) from exc
