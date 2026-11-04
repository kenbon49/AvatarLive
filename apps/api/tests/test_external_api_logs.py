from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException

from app.services.external_api_logs import external_api_call, list_logs, log_context, sanitize, write_log


class ExternalApiLogTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="avatarlive-external-log-")
        self.addCleanup(self.directory.cleanup)
        self.patch = patch("app.services.external_api_logs.LOG_DIRECTORY", Path(self.directory.name))
        self.patch.start()
        self.addCleanup(self.patch.stop)

    def test_provider_error_retains_original_status_body_request_id_and_exception_chain(self):
        context = log_context.set({"userId": "user-test", "route": "/api/v1/tts/bailian/request"})
        self.addCleanup(log_context.reset, context)
        with self.assertRaises(HTTPException):
            with external_api_call("bailian", "合成语音", "https://dashscope.aliyuncs.com/api/v1/test",
                                   request={"text": "测试", "api_key": "private-log-test-key"}, secrets=["private-log-test-key"]) as log:
                response = httpx.Response(401, json={"code": "InvalidApiKey", "message": "Rejected private-log-test-key", "request_id": "request-123"})
                log.http_response(response)
                raise HTTPException(status_code=502, detail="百炼 API Key 无效")
        item = list_logs(provider="bailian", status="error", q="InvalidApiKey")[0]
        self.assertEqual(item["httpStatus"], 401)
        self.assertEqual(item["requestId"], "request-123")
        self.assertEqual(item["context"]["userId"], "user-test")
        self.assertIn("HTTPException", item["error"]["stack"])
        self.assertNotIn("private-log-test-key", json.dumps(item))
        self.assertEqual((Path(self.directory.name) / "api.log").stat().st_mode & 0o777, 0o600)

    def test_logging_failure_never_changes_a_successful_call_or_original_exception(self):
        with patch("app.services.external_api_logs.write_log", side_effect=OSError("disk full")):
            with external_api_call("llm", "对话", "https://example.test/") as log:
                log.response({"content": "成功"})
            error = RuntimeError("provider disconnected")
            with self.assertRaises(RuntimeError) as raised:
                with external_api_call("llm", "流式对话", "https://example.test/"):
                    raise error
            self.assertIs(raised.exception, error)

    def test_caught_stream_failure_is_saved_with_upstream_status_and_sanitized_stack(self):
        with external_api_call("llm", "流式对话", "https://example.test/", secrets=["stream-private-key"]) as log:
            try:
                request = httpx.Request("POST", "https://example.test/")
                response = httpx.Response(429, request=request, json={"error": {"message": "stream-private-key quota exceeded"}})
                raise httpx.HTTPStatusError("request failed", request=request, response=response)
            except Exception as exc:
                log.failure(exc)
        entry = list_logs(status="error")[0]
        self.assertEqual(entry["httpStatus"], 429)
        self.assertIn("HTTPStatusError", entry["error"]["stack"])
        self.assertNotIn("stream-private-key", json.dumps(entry))

    def test_retention_filters_and_stable_cursor_keep_restarts_and_tied_timestamps_consistent(self):
        now = datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        for index in range(5):
            write_log({"id": f"api-{index}", "createdAt": now, "source": "api", "provider": "llm", "status": "error", "error": "quota"})
        write_log({"id": "api-old", "createdAt": (datetime.now(timezone.utc) - timedelta(days=8)).isoformat(),
                   "source": "api", "provider": "llm", "status": "error", "error": "quota"})
        first = list_logs(provider="llm", status="error", q="quota", limit=2)
        cursor = first[-1]["createdAt"] + "|" + first[-1]["id"]
        second = list_logs(before=cursor, limit=10)
        self.assertEqual([item["id"] for item in first + second], [f"api-{index}" for index in range(4, -1, -1)])
        self.assertEqual(list_logs(status="success"), [])
        with (Path(self.directory.name) / "api.log").open("a") as file:
            file.write('{"partial":')
        self.assertEqual(len(list_logs()), 5)

    def test_redaction_hides_nested_keys_signed_urls_raw_headers_files_and_large_payloads(self):
        value = sanitize({"AccessKeyId": "private-id", "Signature": "private-signature",
            "url": "https://user:pass@asset.aliyuncs.com/a?x-oss-signature=private-url-signature&model=qwen",
            "detail": "Authorization: Bearer private-bearer, api_key=private-raw-key",
            "custom": "private-unspecified-key", "audio": {"data": "a" * 10000}}, ["private-unspecified-key"])
        encoded = json.dumps(value)
        for secret in ("private-id", "private-signature", "user:pass", "private-url-signature", "private-bearer", "private-raw-key", "private-unspecified-key", "a" * 200):
            self.assertNotIn(secret, encoded)
        self.assertIn("model=qwen", encoded)
        bounded = sanitize({"request": [{"prompt": "字" * 10000}] * 100, "status": "error"})
        self.assertLess(len(json.dumps(bounded, ensure_ascii=False)), 25000)
