import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from app.services.bailian_speech import VC_MODEL, synthesize_speech
from app.services.external_api_logs import list_logs


class BailianSpeechTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="avatarlive-bailian-speech-")
        self.addCleanup(self.directory.cleanup)
        log_patch = patch("app.services.external_api_logs.LOG_DIRECTORY", Path(self.directory.name))
        log_patch.start()
        self.addCleanup(log_patch.stop)
        self.async_client = httpx.AsyncClient

    def transport(self, handler):
        return patch("app.services.bailian_speech.httpx.AsyncClient", side_effect=lambda **kwargs: self.async_client(
            transport=httpx.MockTransport(handler), **kwargs))

    async def test_waits_until_voice_is_ready_then_uses_the_current_official_synthesis_endpoint(self):
        requests = []
        def handler(request):
            requests.append(request)
            body = json.loads(request.content)
            if body["model"] == "voice-enrollment":
                return httpx.Response(200, json={"output": {"status": "DEPLOYING" if len(requests) == 1 else "OK"}, "request_id": f"query-{len(requests)}"})
            return httpx.Response(200, json={"output": {"audio": {"url": "https://asset.aliyuncs.com/test.wav"}}, "request_id": "speech-123"})
        with self.transport(handler), patch("app.services.bailian_speech.asyncio.sleep", new_callable=AsyncMock) as sleep:
            result = await synthesize_speech("test-speech-private-key", "https://dashscope-intl.aliyuncs.com/api/v1", "你好", "voice-test")
        self.assertEqual(result, {"audio": {"url": "https://asset.aliyuncs.com/test.wav"}})
        self.assertEqual(len(requests), 3)
        sleep.assert_awaited_once_with(1)
        self.assertEqual(str(requests[-1].url), "https://dashscope-intl.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer")
        self.assertEqual(json.loads(requests[0].content), {"model": "voice-enrollment", "input": {"action": "query_voice", "voice_id": "voice-test"}})
        self.assertEqual(json.loads(requests[-1].content), {"model": VC_MODEL, "input": {"text": "你好", "voice": "voice-test", "format": "wav", "sample_rate": 24000}})
        self.assertTrue(all(request.headers["Authorization"] == "Bearer test-speech-private-key" for request in requests))
        log = list_logs(q="speech-123")[0]
        self.assertEqual((log["status"], log["method"], log["httpStatus"]), ("success", "POST", 200))
        self.assertNotIn("test-speech-private-key", json.dumps(log))

    async def test_provider_failure_preserves_details_in_logs_and_does_not_retry_synthesis(self):
        requests = []
        def handler(request):
            requests.append(request)
            if json.loads(request.content)["model"] == "voice-enrollment":
                return httpx.Response(200, json={"output": {"status": "OK"}})
            return httpx.Response(403, json={"code": "AccessDenied", "message": "rejected speech-private-key", "request_id": "denied-123"})
        with self.transport(handler):
            with self.assertRaises(HTTPException) as raised:
                await synthesize_speech("speech-private-key", "https://dashscope.aliyuncs.com/api/v1", "你好", "voice-test")
        self.assertEqual(raised.exception.status_code, 502)
        self.assertEqual(raised.exception.headers["x-bailian-provider-accepted"], "true")
        self.assertEqual(len(requests), 2)
        log = list_logs(status="error")[0]
        self.assertEqual(log["response"]["code"], "AccessDenied")
        self.assertEqual(log["requestId"], "denied-123")
        self.assertNotIn("speech-private-key", json.dumps(log))

    async def test_unready_or_failed_voices_never_trigger_synthesis_or_new_enrollment(self):
        for status in ["DEPLOYING", "FAILED", None]:
            requests = []
            def handler(request):
                requests.append(json.loads(request.content))
                return httpx.Response(200, json={"output": {"status": status}})
            with self.subTest(status=status), self.transport(handler), patch("app.services.bailian_speech.asyncio.sleep", new_callable=AsyncMock):
                with self.assertRaises(HTTPException) as raised:
                    await synthesize_speech("test-key", "https://dashscope.aliyuncs.com/api/v1", "你好", "voice-test")
            self.assertEqual(raised.exception.status_code, 504 if status == "DEPLOYING" else 502)
            self.assertEqual(len(requests), 30 if status == "DEPLOYING" else 1)
            self.assertTrue(all(body["input"]["action"] == "query_voice" for body in requests))

    async def test_network_errors_and_malformed_provider_responses_remain_diagnosable(self):
        def network_failure(request):
            raise httpx.ConnectError("connection refused", request=request)
        with self.transport(network_failure):
            with self.assertRaises(HTTPException) as raised:
                await synthesize_speech("test-key", "https://dashscope.aliyuncs.com/api/v1", "你好", "voice-test")
        self.assertIsInstance(raised.exception.__cause__, httpx.ConnectError)
        self.assertIn("connection refused", list_logs(status="error", q="connection refused")[0]["error"]["stack"])
        for response in [httpx.Response(200, text="invalid JSON"), httpx.Response(200, json={"code": "InvalidVoice"})]:
            with self.transport(lambda request: response):
                with self.assertRaises(HTTPException) as raised:
                    await synthesize_speech("test-key", "https://dashscope.aliyuncs.com/api/v1", "你好", "voice-test")
            self.assertEqual(raised.exception.headers["x-bailian-provider-accepted"], "true")

    async def test_timeout_reports_reusable_registration_without_leaving_background_work(self):
        async def immediate_timeout(coroutine, **kwargs):
            coroutine.close()
            raise asyncio.TimeoutError()
        with patch("app.services.bailian_speech.asyncio.wait_for", side_effect=immediate_timeout):
            with self.assertRaises(HTTPException) as raised:
                await synthesize_speech("test-key", "https://dashscope.aliyuncs.com/api/v1", "你好", "voice-test")
        self.assertEqual(raised.exception.status_code, 504)
        self.assertIn("自动复用", raised.exception.detail)
