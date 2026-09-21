from __future__ import annotations

import base64
import json
import os
from pathlib import Path
import stat
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch


TEST_DIRECTORY = tempfile.TemporaryDirectory(prefix="avatarlive-live-rooms-")
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{TEST_DIRECTORY.name}/live-rooms.sqlite3"
os.environ["PLATFORM_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(bytes(range(32))).decode("ascii")

from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db import Base, SessionLocal, engine
from app.core.config import settings
from app.main import app
from app.models.live_room import LiveRoom
from app.models.live_library import LiveRoomProduct, LiveRoomProductSelection, LiveRoomScriptLibrary
from app.models.live_run import LiveRun, LiveRunTarget
from app.models.platform_connection import PlatformConnection
from app.models.platform_event import PlatformLiveEvent
from app.models.account import ApiUsage, CreditLedgerEntry, LoginSession, User
from app.security.accounts import COOKIE_NAME, create_session, hash_password
from app.bootstrap_admin import main as bootstrap_admin, write_generated_credentials
from app.security.platform_secrets import decrypt_secret
from app.services.llm.chat import complete_litellm_chat
from app.services.llm.config import (
    LlmModelDiscoveryError, discover_litellm_models,
    get_litellm_default_model_id, resolve_litellm_model,
)
from app.services.live_runs import preflight as live_run_preflight
from app.services.live_runs import media_supervisor
from app.services.live_runs.supervisor import _output_dimensions, _source_command
from app.services.platforms import (
    LocalRtmpSelfTestError,
    LocalRtmpSelfTestResult,
    RtmpProbeError,
    FixedWindowRateLimiter,
    probe_rtmp_endpoint,
    sign_webhook,
    verify_webhook_signature,
    WebhookSignatureError,
    webhook_rate_limiter,
)


class StubMediaProcess:
    _next_pid = 41000

    def __init__(self, command: tuple[str, ...]) -> None:
        self.command = command
        self.pid = StubMediaProcess._next_pid
        StubMediaProcess._next_pid += 1
        self.terminated = False

    def poll(self):
        return -15 if self.terminated else None

    def terminate(self):
        self.terminated = True

    def wait(self, timeout=None):
        self.terminated = True
        return -15

    def kill(self):
        self.terminated = True


def room_config() -> dict:
    return {
        "schemaVersion": 1,
        "avatarId": "chinese",
        "voice": {"voiceId": "professional", "speed": 1.1, "pitch": 3},
        "playbackMode": "sequence",
        "goods": [{"id": 1, "name": "测试商品", "source": "商品"}],
        "activeGoodsId": 1,
        "scripts": [
            {
                "id": 1,
                "title": "测试开场",
                "category": "开场",
                "duration": "00:12",
                "text": "欢迎进入测试直播间。",
                "state": "ready",
                "avatarVideo": {
                    "taskId": "avatar_task_0001",
                    "inputSignature": "v1-test-signature",
                    "status": "SUCCESS",
                    "videoUrl": "/aliyun-avatar-video-api/videos/avatar_task_0001/media",
                    "coverUrl": "https://example.test/avatar_task_0001.jpg",
                },
            }
        ],
        "qaItems": [{"id": 1, "question": "如何使用？", "answer": "请参考商品说明。"}],
        "selectedTemplateId": "food",
        "selectedTemplatePage": 2,
        "layers": [
            {
                "id": "host",
                "kind": "host",
                "value": "中文女",
                "sceneKey": "host",
                "x": 50,
                "y": 64,
                "width": 76,
                "height": 70,
                "rotation": 0,
                "opacity": 100,
                "chromaKeyEnabled": True,
                "chromaKeyColor": "#f8f8f8",
                "chromaKeyTolerance": 4,
                "chromaKeySoftness": 6,
            }
        ],
        "liveOptions": {
            "qa": True,
            "dynamic": True,
            "ambience": False,
            "product": True,
            "replyLimit": 5,
            "replyMode": "hybrid",
        },
        "outputConfig": {
            "resolution": "1080p",
            "frameRate": "25 fps",
            "codec": "H.264",
            "protocol": "RTMP",
        },
        "selectedPlatforms": ["美团"],
        "assets": {"image": [], "video": []},
    }


class LiveRoomApiTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        Base.metadata.create_all(bind=engine)
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client.close()
        engine.dispose()
        TEST_DIRECTORY.cleanup()

    def setUp(self) -> None:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        with SessionLocal() as db:
            admin = User(email="admin@example.com", password_hash=hash_password("test-password-1234"), role="admin", status="approved")
            db.add(admin)
            db.commit()
            db.refresh(admin)
            self.client.cookies.set(COOKIE_NAME, create_session(db, admin))
        settings.platform_webhook_secrets = json.dumps({"test-bridge": "test-webhook-secret-123456789"})
        settings.platform_webhook_rate_limit_per_minute = 600
        webhook_rate_limiter.reset()

    def post_platform_event(self, payload: dict, *, signature: str | None = None):
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        timestamp = str(int(time.time()))
        headers = {
            "Content-Type": "application/json",
            "X-SynLive-Timestamp": timestamp,
            "X-SynLive-Signature": signature or f"sha256={sign_webhook('test-webhook-secret-123456789', timestamp, body)}",
        }
        return self.client.post("/api/v1/platform-events/webhooks/test-bridge", content=body, headers=headers)

    def test_registration_review_login_and_resource_ownership(self) -> None:
        with TestClient(app) as anonymous:
            self.assertEqual(anonymous.get("/api/v1/live-rooms").status_code, 401)
            self.assertEqual(anonymous.get("/api/v1/admin/settings").status_code, 401)
            self.assertEqual(anonymous.get("/api/v1/admin/llm/models").status_code, 401)
            new_user = {"email": "viewer@example.com", "password": "long-password-1234"}
            self.assertEqual(anonymous.post("/api/v1/auth/register", json=new_user).status_code, 201)
            self.assertEqual(anonymous.post("/api/v1/auth/login", json=new_user).status_code, 403)
            pending = self.client.get("/api/v1/auth/pending").json()
            self.assertEqual(len(pending), 1)
            self.assertEqual(self.client.post(f"/api/v1/auth/pending/{pending[0]['id']}/approve").status_code, 200)
            logged_in = anonymous.post("/api/v1/auth/login", json=new_user)
            self.assertEqual(logged_in.status_code, 200, logged_in.text)
            anonymous.cookies.set(COOKIE_NAME, logged_in.cookies[COOKIE_NAME])
            self.assertEqual(anonymous.get("/api/v1/admin/settings").status_code, 403)
            self.assertEqual(anonymous.get("/api/v1/admin/llm/models").status_code, 403)
            self.assertEqual(anonymous.put("/api/v1/admin/llm/default-model", json={"model_id": "test-model"}).status_code, 403)
            admin_room = self.client.post("/api/v1/live-rooms", json={"name": "管理员直播间", "config": room_config()}).json()
            self.assertEqual(anonymous.get(f"/api/v1/live-rooms/{admin_room['id']}").status_code, 404)
            self.assertEqual(anonymous.get("/api/v1/live-rooms").json(), [])
            self.assertEqual(anonymous.post("/api/v1/live-rooms", json={"name": "用户直播间", "config": room_config()}).status_code, 201)
            self.assertEqual(len(anonymous.get("/api/v1/live-rooms").json()), 1)
            self.assertEqual(anonymous.post("/api/v1/auth/logout").status_code, 200)
            self.assertEqual(anonymous.get("/api/v1/live-rooms").status_code, 401)

    def test_administrator_can_login_with_username_and_email_clients_remain_compatible(self) -> None:
        with SessionLocal() as db:
            admin = db.scalar(select(User).where(User.role == "admin"))
            admin.username = "admin"
            db.commit()
        with TestClient(app) as client:
            username_login = client.post("/api/v1/auth/login", json={
                "identifier": "ADMIN", "password": "test-password-1234",
            })
            self.assertEqual(username_login.status_code, 200, username_login.text)
            self.assertEqual(username_login.json()["username"], "admin")
        with TestClient(app) as legacy_client:
            email_login = legacy_client.post("/api/v1/auth/login", json={
                "email": "admin@example.com", "password": "test-password-1234",
            })
            self.assertEqual(email_login.status_code, 200, email_login.text)

    def test_prepaid_credits_are_recharged_allocated_charged_and_reported(self) -> None:
        registration = {"email": "credits@example.com", "password": "long-password-1234"}
        with TestClient(app) as user_client:
            self.assertEqual(user_client.post("/api/v1/auth/register", json=registration).status_code, 201)
            managed = self.client.get("/api/v1/admin/users")
            self.assertEqual(managed.status_code, 200, managed.text)
            target = next(item for item in managed.json() if item["email"] == registration["email"])
            self.assertEqual(target["creditBalance"], 0)
            self.assertEqual(self.client.post(f"/api/v1/auth/pending/{target['id']}/approve").status_code, 200)

            recharge = self.client.post("/api/v1/admin/credits/recharge", json={
                "amount": 25, "payment_reference": "PAYMENT-UNIT-0001",
            })
            self.assertEqual(recharge.status_code, 200, recharge.text)
            self.assertEqual(recharge.json()["balance"], 25)
            duplicate = self.client.post("/api/v1/admin/credits/recharge", json={
                "amount": 25, "payment_reference": "PAYMENT-UNIT-0001",
            })
            self.assertEqual(duplicate.status_code, 409, duplicate.text)

            allocation = self.client.post(f"/api/v1/admin/users/{target['id']}/allocate", json={"amount": 12})
            self.assertEqual(allocation.status_code, 200, allocation.text)
            self.assertEqual(allocation.json()["adminBalance"], 13)
            self.assertEqual(allocation.json()["userBalance"], 12)

            login = user_client.post("/api/v1/auth/login", json=registration)
            self.assertEqual(login.status_code, 200, login.text)
            user_client.cookies.set(COOKIE_NAME, login.cookies[COOKIE_NAME])
            llm_charge = user_client.post("/api/v1/billing/charge", json={
                "operation": "llm_chat", "reference": "unit:llm:0001", "detail": {"test": True},
            })
            self.assertEqual(llm_charge.status_code, 200, llm_charge.text)
            self.assertEqual(llm_charge.json()["credits"], 1)
            video_charge = user_client.post("/api/v1/billing/charge", json={
                "operation": "storyboard_video", "reference": "unit:video:0001",
            })
            self.assertEqual(video_charge.status_code, 200, video_charge.text)
            self.assertEqual(video_charge.json()["credits"], 10)
            insufficient = user_client.post("/api/v1/billing/charge", json={
                "operation": "storyboard_video", "reference": "unit:video:0002",
            })
            self.assertEqual(insufficient.status_code, 402, insufficient.text)

            report = user_client.get("/api/v1/resources/report")
            self.assertEqual(report.status_code, 200, report.text)
            self.assertEqual(report.json()["currentBalance"], 1)
            self.assertEqual(report.json()["totalCalls"], 2)
            self.assertEqual(report.json()["chargedCredits"], 11)
            self.assertEqual(report.json()["operationCounts"]["llm_chat"], 1)
            self.assertEqual(report.json()["operationCounts"]["storyboard_video"], 1)

    def test_admin_api_calls_are_unlimited_without_spending_user_allocation_credits(self) -> None:
        balance = self.client.get("/api/v1/billing/balance")
        self.assertEqual(balance.status_code, 200)
        self.assertEqual(balance.json()["balance"], 0)
        self.assertTrue(balance.json()["unlimited"])
        for operation, reference in (("llm_chat", "admin:llm:1"), ("storyboard_video", "admin:video:1")):
            charged = self.client.post("/api/v1/billing/charge", json={"operation": operation, "reference": reference})
            self.assertEqual(charged.status_code, 200, charged.text)
            self.assertEqual(charged.json()["credits"], 0)
            self.assertEqual(charged.json()["balance"], 0)
            self.assertTrue(charged.json()["unlimited"])
            repeated = self.client.post("/api/v1/billing/charge", json={"operation": operation, "reference": reference})
            self.assertEqual(repeated.json()["usageId"], charged.json()["usageId"])
            self.assertEqual(self.client.put(
                f"/api/v1/billing/usages/{charged.json()['usageId']}/status", json={"status": "succeeded"},
            ).status_code, 200)
        with SessionLocal() as db:
            self.assertEqual(db.query(ApiUsage).count(), 2)
            self.assertEqual(db.query(CreditLedgerEntry).count(), 0)
        report = self.client.get("/api/v1/resources/report").json()
        self.assertTrue(report["unlimited"])
        self.assertEqual(report["currentBalance"], 0)
        self.assertEqual(report["totalCalls"], 2)
        self.assertEqual(report["chargedCredits"], 0)
        self.assertEqual(report["successfulCalls"], 2)
        self.assertEqual(self.client.get("/api/v1/admin/users").json()[0]["usedCredits"], 0)

        registration = {"email": "limited@example.com", "password": "long-password-1234"}
        with TestClient(app) as user_client:
            self.assertEqual(user_client.post("/api/v1/auth/register", json=registration).status_code, 201)
            user_id = next(user["id"] for user in self.client.get("/api/v1/admin/users").json()
                           if user["email"] == registration["email"])
            self.assertEqual(self.client.post(f"/api/v1/auth/pending/{user_id}/approve").status_code, 200)
            self.assertEqual(self.client.post(f"/api/v1/admin/users/{user_id}/allocate", json={"amount": 1}).status_code, 409)
            login = user_client.post("/api/v1/auth/login", json=registration)
            self.assertEqual(login.status_code, 200)
            user_client.cookies.set(COOKIE_NAME, login.cookies[COOKIE_NAME])
            self.assertFalse(user_client.get("/api/v1/billing/balance").json()["unlimited"])
            self.assertEqual(user_client.post("/api/v1/billing/charge", json={
                "operation": "llm_chat", "reference": "limited:llm:1",
            }).status_code, 402)

    def test_existing_password_can_be_rehashed_without_weakening_creation_policy(self) -> None:
        with self.assertRaises(ValueError):
            hash_password("ten-chars!")
        encoded = hash_password("ten-chars!", minimum_length=10)
        from app.security.accounts import verify_password
        self.assertTrue(verify_password("ten-chars!", encoded))

    def test_login_cookie_matches_http_and_https_entrypoints(self) -> None:
        credentials = {"identifier": "admin@example.com", "password": "test-password-1234"}
        with TestClient(app, base_url="http://testserver") as http_client:
            response = http_client.post("/api/v1/auth/login", json=credentials)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertNotIn("secure", response.headers["set-cookie"].lower())
            self.assertEqual(http_client.get("/api/v1/auth/me").status_code, 200)
        with TestClient(app, base_url="https://testserver") as https_client:
            response = https_client.post("/api/v1/auth/login", json=credentials)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIn("secure", response.headers["set-cookie"].lower())
            self.assertEqual(https_client.get("/api/v1/auth/me").status_code, 200)

    def test_admin_configuration_is_masked_and_key_rotation_preserves_secrets(self) -> None:
        connection = self.client.post("/api/v1/platform-connections", json={
            "name": "测试", "platformLabel": "通用 RTMP",
            "serverUrl": "rtmp://example.com/live", "streamKey": "secret-rotation-value",
        })
        self.assertEqual(connection.status_code, 201, connection.text)
        connection_id = connection.json()["id"]
        room = self.client.post("/api/v1/live-rooms", json={"name": "历史任务", "config": room_config()}).json()
        with SessionLocal() as db:
            saved = db.get(PlatformConnection, connection_id)
            run = LiveRun(request_id="rotation-run", live_room_id=room["id"], room_version=1,
                          config_snapshot={}, media_source_kind="test_pattern", status="stopped")
            db.add(run)
            db.flush()
            snapshot = LiveRunTarget(
                live_run_id=run.id, platform_connection_id=connection_id, connection_version=1,
                connection_name="测试", platform_label="通用 RTMP", server_url="rtmp://example.com/live",
                stream_key_ciphertext=saved.stream_key_ciphertext, stream_key_last4="alue", status="stopped",
            )
            db.add(snapshot)
            db.commit()
            snapshot_id = snapshot.id
        replacement = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
        response = self.client.put("/api/v1/admin/settings/platform_master_key", json={"value": replacement})
        self.assertEqual(response.status_code, 200, response.text)
        with SessionLocal() as db:
            stored = db.get(PlatformConnection, connection_id)
            self.assertEqual(decrypt_secret(stored.stream_key_ciphertext, connection_id), "secret-rotation-value")
            target = db.get(LiveRunTarget, snapshot_id)
            self.assertEqual(decrypt_secret(target.stream_key_ciphertext, connection_id), "secret-rotation-value")
        listing = self.client.get("/api/v1/admin/settings")
        self.assertEqual(listing.status_code, 200, listing.text)
        self.assertNotIn(replacement, listing.text)
        self.assertNotIn("secret-rotation-value", listing.text)
        staged = self.client.put("/api/v1/admin/settings/database_url", json={"value": "postgresql+psycopg://newuser:newpass@db.test/newdb"})
        self.assertEqual(staged.status_code, 200, staged.text)
        self.assertEqual(staged.json()["mode"], "deployment")
        status = self.client.get("/api/v1/admin/settings")
        self.assertNotIn("newpass", status.text)
        self.assertTrue(next(item for item in status.json()["settings"] if item["key"] == "database_url")["saved"])
        self.assertTrue(any(item["key"] == "minio_secret_key" for item in status.json()["settings"]))

    def test_master_key_rotation_rejects_active_runs_without_changing_credentials(self) -> None:
        connection = self.client.post("/api/v1/platform-connections", json={
            "name": "轮换保护", "platformLabel": "通用 RTMP",
            "serverUrl": "rtmp://example.com/live", "streamKey": "unchanged-secret",
        }).json()
        room = self.client.post("/api/v1/live-rooms", json={"name": "未结束直播", "config": room_config()}).json()
        with SessionLocal() as db:
            db.add(LiveRun(request_id="rotation-active-run", live_room_id=room["id"], room_version=1,
                           config_snapshot={}, media_source_kind="test_pattern", status="live"))
            db.commit()
        replacement = base64.urlsafe_b64encode(os.urandom(32)).decode("ascii")
        response = self.client.put("/api/v1/admin/settings/platform_master_key", json={"value": replacement})
        self.assertEqual(response.status_code, 409, response.text)
        with SessionLocal() as db:
            saved = db.get(PlatformConnection, connection["id"])
            self.assertEqual(decrypt_secret(saved.stream_key_ciphertext, connection["id"]), "unchanged-secret")
        self.assertFalse(next(item for item in self.client.get("/api/v1/admin/settings").json()["settings"]
                              if item["key"] == "platform_master_key")["saved"])

    def test_admin_setting_address_validation(self) -> None:
        for name, value in (
            ("seo_video_api_base_url", "file://example.com/media"),
            ("llm_base_url", "http://example.com/v1"),
            ("database_url", "sqlite:///tmp/new.sqlite3"),
        ):
            response = self.client.put(f"/api/v1/admin/settings/{name}", json={"value": value})
            self.assertEqual(response.status_code, 422, response.text)

    def test_admin_llm_configuration_discovers_models_before_saving(self) -> None:
        original = (settings.llm_api_key, settings.llm_base_url, settings.llm_default_model_id)
        models = [{"id": "custom-vision", "ownedBy": "provider"}, {"id": "custom-text", "ownedBy": "provider"}]
        try:
            with patch("app.api.v1.admin.discover_litellm_models", new=AsyncMock(return_value=models)) as discover:
                response = self.client.put("/api/v1/admin/llm/configuration", json={
                    "base_url": "https://models.example.com/v1/", "api_key": "test-secret",
                })
                self.assertEqual(response.status_code, 200, response.text)
                discover.assert_awaited_once_with(api_key="test-secret", api_base="https://models.example.com/v1")
                self.assertEqual([item["id"] for item in response.json()["models"]], ["custom-vision", "custom-text"])
                self.assertNotIn("test-secret", response.text)
                self.assertEqual(response.json()["baseUrl"], "https://models.example.com/v1")
            listing = self.client.get("/api/v1/admin/settings").json()["settings"]
            self.assertNotIn("test-secret", json.dumps(listing))
            self.assertTrue(next(item for item in listing if item["key"] == "llm_api_key")["saved"])
            with patch("app.api.v1.admin.discover_litellm_models", new=AsyncMock(return_value=models)):
                selected = self.client.put("/api/v1/admin/llm/default-model", json={"model_id": "custom-vision"})
                self.assertEqual(selected.status_code, 200, selected.text)
                self.assertEqual(self.client.get("/health/ready").json()["llm_default_model_id"], "custom-vision")
                with patch("app.api.v1.llm.discover_litellm_models", new=AsyncMock(return_value=models)):
                    self.assertEqual(self.client.get("/api/v1/llm/models").json()["default_model_id"], "custom-vision")
            self.assertEqual(resolve_litellm_model("custom-vision")["model"], "openai/custom-vision")
            self.assertEqual(resolve_litellm_model("openai/custom-vision")["model"], "openai/openai/custom-vision")
            with patch("app.services.llm.chat.litellm.completion", return_value=SimpleNamespace(
                choices=[SimpleNamespace(message={"content": "模型响应"})],
            )) as completion:
                generated = complete_litellm_chat(get_litellm_default_model_id(), [{"role": "user", "content": "测试"}])
            self.assertEqual(generated["content"], "模型响应")
            self.assertEqual(completion.call_args.kwargs["model"], "openai/custom-vision")
            self.assertEqual(completion.call_args.kwargs["api_base"], "https://models.example.com/v1")
            self.assertEqual(completion.call_args.kwargs["api_key"], "test-secret")
            self.assertNotIn("temperature", completion.call_args.kwargs)
            with patch("app.api.v1.admin.discover_litellm_models", new=AsyncMock(return_value=models)):
                invalid = self.client.put("/api/v1/admin/llm/default-model", json={"model_id": "not-listed"})
            self.assertEqual(invalid.status_code, 422)
            self.assertEqual(self.client.get("/health/ready").json()["llm_default_model_id"], "custom-vision")
            self.assertEqual(self.client.put("/api/v1/admin/settings/llm_default_model_id", json={"value": "not-listed"}).status_code, 422)
            self.assertEqual(self.client.put("/api/v1/admin/settings/llm_api_key", json={"value": "bypass"}).status_code, 422)
            with patch("app.api.v1.admin.discover_litellm_models", new=AsyncMock(side_effect=LlmModelDiscoveryError("鉴权失败"))):
                rejected = self.client.put("/api/v1/admin/llm/configuration", json={
                    "base_url": "https://bad.example.com/v1", "api_key": "wrong-secret",
                })
            self.assertEqual(rejected.status_code, 502)
            self.assertNotIn("wrong-secret", rejected.text)
            self.assertEqual(settings.llm_api_key, "test-secret")
            self.assertEqual(settings.llm_base_url, "https://models.example.com/v1")
            with patch("app.api.v1.admin.discover_litellm_models", new=AsyncMock(return_value=models)) as discover:
                unchanged_key = self.client.put("/api/v1/admin/llm/configuration", json={
                    "base_url": "https://new.example.com/v1",
                })
                self.assertEqual(unchanged_key.status_code, 200)
                discover.assert_awaited_once_with(api_key="test-secret", api_base="https://new.example.com/v1")
        finally:
            settings.llm_api_key, settings.llm_base_url, settings.llm_default_model_id = original

    def test_llm_model_discovery_handles_compatible_catalogs_and_failures(self) -> None:
        import asyncio
        import httpx

        async_client = httpx.AsyncClient
        received = []

        def catalog(request):
            received.append((str(request.url), request.headers.get("authorization")))
            return httpx.Response(200, json={"data": [
                {"id": "model-b", "owned_by": "vendor"}, {"id": "model-a"}, {"id": "model-a"},
                {"id": "invalid model"},
            ]})

        with patch("app.services.llm.config.httpx.AsyncClient", side_effect=lambda **kwargs: async_client(
            transport=httpx.MockTransport(catalog), **kwargs,
        )):
            models = asyncio.run(discover_litellm_models(api_key="only-in-header", api_base="https://models.example.com/v1"))
        self.assertEqual([item["id"] for item in models], ["model-a", "model-b"])
        self.assertEqual(received, [("https://models.example.com/v1/models", "Bearer only-in-header")])

        for status, body in ((401, {"error": "invalid"}), (200, {"data": []})):
            with patch("app.services.llm.config.httpx.AsyncClient", side_effect=lambda **kwargs: async_client(
                transport=httpx.MockTransport(lambda request: httpx.Response(status, json=body)), **kwargs,
            )):
                with self.assertRaises(LlmModelDiscoveryError):
                    asyncio.run(discover_litellm_models(api_key="invalid", api_base="https://models.example.com/v1"))

    def test_admin_settings_recognize_environment_aliyun_keys_without_exposing_them(self) -> None:
        with patch.object(settings, "aliyun_access_key_id", "environment-id"), patch.object(
            settings, "aliyun_access_key_secret", "environment-secret"
        ):
            response = self.client.get("/api/v1/admin/settings")
        self.assertEqual(response.status_code, 200, response.text)
        listed = {item["key"]: item for item in response.json()["settings"]}
        for key in ("aliyun_access_key_id", "aliyun_access_key_secret"):
            self.assertTrue(listed[key]["configured"])
            self.assertFalse(listed[key]["saved"])
        self.assertNotIn("environment-id", response.text)
        self.assertNotIn("environment-secret", response.text)

    def test_generated_admin_credentials_require_private_new_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="avatarlive-credentials-") as directory:
            path = Path(directory) / "admin.txt"
            write_generated_credentials(path, "admin@example.com", "test-password")
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertIn("test-password", path.read_text(encoding="utf-8"))
            with self.assertRaises(FileExistsError):
                write_generated_credentials(path, "other@example.com", "overwrite")
            self.assertNotIn("overwrite", path.read_text(encoding="utf-8"))
            os.chmod(directory, 0o755)
            with self.assertRaises(ValueError):
                write_generated_credentials(Path(directory) / "other.txt", "admin@example.com", "password")
            os.chmod(directory, 0o700)

    def test_bootstrap_admin_if_missing_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="avatarlive-bootstrap-") as directory:
            credentials = Path(directory) / "admin.txt"
            with patch("sys.argv", [
                "bootstrap-admin",
                "--if-missing",
                "--email", "new-admin@avatarlive.app",
                "--credentials-file", str(credentials),
            ]):
                bootstrap_admin()
            self.assertFalse(credentials.exists())

    def test_bootstrap_admin_creates_private_credentials_once(self) -> None:
        with SessionLocal() as db:
            db.query(LoginSession).delete()
            db.query(User).delete()
            db.commit()
        with tempfile.TemporaryDirectory(prefix="avatarlive-bootstrap-") as directory:
            credentials = Path(directory) / "admin.txt"
            with patch("sys.argv", [
                "bootstrap-admin",
                "--if-missing",
                "--email", "new-admin@avatarlive.app",
                "--username", "admin",
                "--credentials-file", str(credentials),
            ]):
                bootstrap_admin()
                first_content = credentials.read_text(encoding="utf-8")
                bootstrap_admin()
            self.assertEqual(stat.S_IMODE(credentials.stat().st_mode), 0o600)
            self.assertIn("new-admin@avatarlive.app", first_content)
            self.assertEqual(credentials.read_text(encoding="utf-8"), first_content)
            with SessionLocal() as db:
                self.assertEqual(db.query(User).filter(User.role == "admin").count(), 1)

    def test_cross_origin_mutation_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/live-rooms", json={"name": "不应创建", "config": room_config()},
            headers={"Origin": "https://foreign.example"},
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(self.client.get("/api/v1/live-rooms").json(), [])

    def test_create_update_copy_publish_and_persist(self) -> None:
        create_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "测试直播间", "config": room_config()},
        )
        self.assertEqual(create_response.status_code, 201, create_response.text)
        created = create_response.json()
        self.assertEqual(created["version"], 1)
        self.assertEqual(created["config"]["avatarId"], "chinese")
        self.assertEqual(created["config"]["selectedTemplatePage"], 2)
        self.assertEqual(
            created["config"]["scripts"][0]["avatarVideo"]["taskId"],
            "avatar_task_0001",
        )
        self.assertEqual(
            created["config"]["scripts"][0]["avatarVideo"]["videoUrl"],
            "/aliyun-avatar-video-api/videos/avatar_task_0001/media",
        )

        room_id = created["id"]
        updated_config = room_config()
        updated_config["scripts"][0]["text"] = "修改后仍应持久化。"
        updated_config["assets"]["image"] = [
            {
                "id": "six-fort-tea",
                "kind": "image",
                "name": "六堡茶.png",
                "preview": "data:image/png;base64,c2l4LWZvcnQtdGVh",
            }
        ]
        updated_config["importedMaterialImages"] = [
            {
                "name": "六堡茶参考图.png",
                "dataUrl": "data:image/png;base64,c2NyaXB0LXRlYS1pbWFnZQ==",
            }
        ]
        updated_config["layers"].insert(
            0,
            {
                "id": "tea-title",
                "kind": "text",
                "value": "六堡茶直播专场",
                "sceneKey": "custom",
                "x": 50,
                "y": 15,
                "width": 70,
                "height": 10,
                "rotation": 0,
                "opacity": 86,
                "fontSize": 24,
                "color": "#ffffff",
                "strokeEnabled": True,
                "strokeColor": "#000000",
                "strokeWidth": 2.5,
                "backgroundEnabled": True,
                "backgroundColor": "#111827",
                "backgroundOpacity": 72,
                "backgroundRadius": 6,
                "componentInstanceId": "component-tea-banner-1",
                "componentSourceId": "tea-banner",
                "componentName": "茶品标题组件",
                "componentLayerId": "title",
                "componentRole": "title",
                "componentTextLimit": 80,
            },
        )
        update_payload = {
            "name": "测试直播间",
            "expectedVersion": created["version"],
            "config": updated_config,
        }
        update_response = self.client.put(f"/api/v1/live-rooms/{room_id}", json=update_payload)
        self.assertEqual(update_response.status_code, 200, update_response.text)
        self.assertEqual(update_response.json()["version"], 2)
        self.assertEqual(update_response.json()["status"], "draft")
        self.assertEqual(update_response.json()["config"]["assets"]["image"][0]["name"], "六堡茶.png")
        self.assertEqual(update_response.json()["config"]["importedMaterialImages"][0]["name"], "六堡茶参考图.png")
        self.assertEqual(update_response.json()["config"]["layers"][0]["strokeWidth"], 2.5)
        self.assertTrue(update_response.json()["config"]["layers"][0]["backgroundEnabled"])
        self.assertEqual(
            update_response.json()["config"]["layers"][0]["componentInstanceId"],
            "component-tea-banner-1",
        )

        stale_response = self.client.put(f"/api/v1/live-rooms/{room_id}", json=update_payload)
        self.assertEqual(stale_response.status_code, 409)

        with SessionLocal() as db:
            persisted = db.get(LiveRoom, room_id)
            self.assertIsNotNone(persisted)
            self.assertEqual(persisted.config["scripts"][0]["text"], "修改后仍应持久化。")
            self.assertEqual(
                persisted.config["scripts"][0]["avatarVideo"]["videoUrl"],
                "/aliyun-avatar-video-api/videos/avatar_task_0001/media",
            )
            self.assertEqual(persisted.config["selectedTemplatePage"], 2)

        copy_response = self.client.post(
            f"/api/v1/live-rooms/{room_id}/copy",
            json={"name": "测试直播间副本"},
        )
        self.assertEqual(copy_response.status_code, 201, copy_response.text)
        self.assertNotEqual(copy_response.json()["id"], room_id)

        publish_response = self.client.post(f"/api/v1/live-rooms/{room_id}/publish")
        self.assertEqual(publish_response.status_code, 200, publish_response.text)
        self.assertEqual(publish_response.json()["status"], "published")

        revised_config = room_config()
        revised_config["scripts"][0]["text"] = "已发布直播间修改后自动回到草稿。"
        revised_response = self.client.put(
            f"/api/v1/live-rooms/{room_id}",
            json={
                "name": "测试直播间",
                "expectedVersion": publish_response.json()["version"],
                "config": revised_config,
            },
        )
        self.assertEqual(revised_response.status_code, 200, revised_response.text)
        self.assertEqual(revised_response.json()["status"], "draft")

        list_response = self.client.get("/api/v1/live-rooms")
        self.assertEqual(list_response.status_code, 200, list_response.text)
        self.assertEqual(len(list_response.json()), 2)

        copied_room_id = copy_response.json()["id"]
        delete_response = self.client.delete(f"/api/v1/live-rooms/{copied_room_id}")
        self.assertEqual(delete_response.status_code, 204, delete_response.text)
        self.assertEqual(len(self.client.get("/api/v1/live-rooms").json()), 1)
        self.assertEqual(self.client.delete(f"/api/v1/live-rooms/{copied_room_id}").status_code, 404)

    def test_editor_draft_survives_updates_without_becoming_a_storyboard(self) -> None:
        config = room_config()
        config["editorDraft"] = "尚未加入分镜的编辑内容"
        created_response = self.client.post(
            "/api/v1/live-rooms", json={"name": "编辑稿测试", "config": config},
        )
        self.assertEqual(created_response.status_code, 201, created_response.text)
        created = created_response.json()
        self.assertEqual(created["config"]["editorDraft"], config["editorDraft"])
        self.assertEqual(len(created["config"]["scripts"]), 1)

        config["editorDraft"] = "自动保存后的新编辑稿"
        updated_response = self.client.put(
            f"/api/v1/live-rooms/{created['id']}",
            json={"name": created["name"], "expectedVersion": created["version"], "config": config},
        )
        self.assertEqual(updated_response.status_code, 200, updated_response.text)
        self.assertEqual(updated_response.json()["config"]["editorDraft"], config["editorDraft"])
        self.assertEqual(len(updated_response.json()["config"]["scripts"]), 1)
        self.assertEqual(
            self.client.get(f"/api/v1/live-rooms/{created['id']}").json()["config"]["editorDraft"],
            config["editorDraft"],
        )

        config["editorDraft"] = "a" * 20001
        rejected_response = self.client.put(
            f"/api/v1/live-rooms/{created['id']}",
            json={"name": created["name"], "expectedVersion": updated_response.json()["version"], "config": config},
        )
        self.assertEqual(rejected_response.status_code, 422)

    def test_incremental_patch_preserves_large_fields_and_validates_layer_operations(self) -> None:
        config = room_config()
        preview = f"data:image/png;base64,{'A' * 8192}"
        config["layers"][0]["preview"] = preview
        config["assets"]["image"] = [
            {"id": "large-image", "kind": "image", "name": "大图.png", "preview": preview},
        ]
        config["importedMaterialImages"] = [{"name": "参考图.png", "dataUrl": preview}]
        created_response = self.client.post(
            "/api/v1/live-rooms", json={"name": "增量保存测试", "config": config},
        )
        self.assertEqual(created_response.status_code, 201, created_response.text)
        created = created_response.json()
        room_id = created["id"]

        revised_scripts = [dict(config["scripts"][0], text="只修改这一段口播。")]
        patch_response = self.client.patch(
            f"/api/v1/live-rooms/{room_id}",
            json={
                "expectedVersion": created["version"],
                "changes": {
                    "scripts": revised_scripts,
                    "layers": {"patches": [{"id": "host", "changes": {"x": 42, "y": 61}}]},
                },
            },
        )
        self.assertEqual(patch_response.status_code, 200, patch_response.text)
        patched = patch_response.json()
        self.assertEqual(set(patched), {"id", "name", "status", "version", "updatedAt"})
        self.assertLess(len(patch_response.content), 1000)
        self.assertNotIn("config", patched)
        self.assertEqual(patched["version"], 2)

        persisted = self.client.get(f"/api/v1/live-rooms/{room_id}").json()["config"]
        self.assertEqual(persisted["scripts"][0]["text"], "只修改这一段口播。")
        self.assertEqual(persisted["layers"][0]["x"], 42)
        self.assertEqual(persisted["layers"][0]["y"], 61)
        self.assertEqual(persisted["layers"][0]["preview"], preview)
        self.assertEqual(persisted["assets"]["image"][0]["preview"], preview)
        self.assertEqual(persisted["importedMaterialImages"][0]["dataUrl"], preview)

        title_layer = {
            "id": "title",
            "kind": "text",
            "value": "增量保存",
            "x": 50,
            "y": 10,
            "width": 50,
            "height": 10,
            "rotation": 0,
            "opacity": 100,
        }
        add_response = self.client.patch(
            f"/api/v1/live-rooms/{room_id}",
            json={
                "expectedVersion": patched["version"],
                "changes": {"layers": {"upsert": [title_layer], "order": ["title", "host"]}},
            },
        )
        self.assertEqual(add_response.status_code, 200, add_response.text)
        self.assertEqual(
            [layer["id"] for layer in self.client.get(f"/api/v1/live-rooms/{room_id}").json()["config"]["layers"]],
            ["title", "host"],
        )

        delete_response = self.client.patch(
            f"/api/v1/live-rooms/{room_id}",
            json={
                "expectedVersion": add_response.json()["version"],
                "changes": {"layers": {"deleteIds": ["title"], "order": ["host"]}},
            },
        )
        self.assertEqual(delete_response.status_code, 200, delete_response.text)
        current_version = delete_response.json()["version"]

        stale_response = self.client.patch(
            f"/api/v1/live-rooms/{room_id}",
            json={"expectedVersion": created["version"], "changes": {"editorDraft": "过期修改"}},
        )
        self.assertEqual(stale_response.status_code, 409, stale_response.text)

        invalid_patches = [
            {"layers": {"patches": [{"id": "host", "changes": {"unknownField": 1}}]}},
            {"layers": {"order": ["missing"]}},
            {"layers": {"upsert": [title_layer, title_layer]}},
            {"goods": []},
        ]
        for changes in invalid_patches:
            response = self.client.patch(
                f"/api/v1/live-rooms/{room_id}",
                json={"expectedVersion": current_version, "changes": changes},
            )
            self.assertEqual(response.status_code, 422, response.text)

    def test_rejects_invalid_control_console_config(self) -> None:
        invalid = room_config()
        invalid["goods"] = []
        response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "无商品直播间", "config": invalid},
        )
        self.assertEqual(response.status_code, 422)

    def test_room_library_persists_products_and_scripts(self) -> None:
        room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "商品脚本测试", "config": room_config()},
        )
        self.assertEqual(room_response.status_code, 201, room_response.text)
        room_id = room_response.json()["id"]
        product_response = self.client.post(
            f"/api/v1/live-rooms/{room_id}/products",
            json={
                "name": "精品咖啡豆",
                "sku": "COFFEE-001",
                "price": 39.9,
                "originalPrice": 59.9,
                "sellingPoints": ["新鲜烘焙", "醇厚风味"],
                "stockMessage": "库存 100 件",
                "afterSales": "七天无理由",
                "platformProductId": "douyin-001",
                "riskWords": ["全网最低"],
            },
        )
        self.assertEqual(product_response.status_code, 201, product_response.text)
        product = product_response.json()
        self.assertEqual(product["sellingPoints"], ["新鲜烘焙", "醇厚风味"])
        self.assertEqual(product["sourceType"], "self_built")
        self.assertTrue(product["selectionId"])
        script_response = self.client.post(
            f"/api/v1/live-rooms/{room_id}/scripts",
            json={
                "productId": product["id"],
                "title": "商品开场",
                "category": "开场",
                "duration": "00:20",
                "text": "欢迎来到咖啡专场。",
                "tags": ["欢迎"],
            },
        )
        self.assertEqual(script_response.status_code, 201, script_response.text)
        self.assertEqual(script_response.json()["liveRoomId"], room_id)
        self.assertEqual(script_response.json()["productId"], product["id"])
        self.assertEqual(len(self.client.get(f"/api/v1/live-rooms/{room_id}/products").json()), 1)
        self.assertEqual(len(self.client.get(f"/api/v1/live-rooms/{room_id}/scripts").json()), 1)
        catalog_response = self.client.get("/api/v1/products", params={"hasScripts": "true"})
        self.assertEqual(catalog_response.status_code, 200, catalog_response.text)
        self.assertEqual(catalog_response.json()[0]["id"], product["id"])

        second_room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "复用商品测试", "config": room_config()},
        )
        second_room_id = second_room_response.json()["id"]
        attach_response = self.client.post(
            f"/api/v1/live-rooms/{second_room_id}/product-selections",
            json={"productIds": [product["id"]]},
        )
        self.assertEqual(attach_response.status_code, 200, attach_response.text)
        self.assertEqual(attach_response.json()[0]["price"], 39.9)
        self.assertIsNone(attach_response.json()[0].get("imageUrl"))

        detach_response = self.client.delete(f"/api/v1/live-rooms/{room_id}/products/{product['id']}")
        self.assertEqual(detach_response.status_code, 204, detach_response.text)
        self.assertEqual(self.client.get(f"/api/v1/live-rooms/{room_id}/products").json(), [])
        self.assertEqual(len(self.client.get(f"/api/v1/live-rooms/{second_room_id}/products").json()), 1)
        with SessionLocal() as db:
            self.assertEqual(db.query(LiveRoomProduct).count(), 1)
            self.assertEqual(db.query(LiveRoomProductSelection).count(), 1)
            self.assertEqual(db.query(LiveRoomScriptLibrary).count(), 1)

    def test_deletes_only_unselected_self_built_catalog_products(self) -> None:
        room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "商品删除测试", "config": room_config()},
        )
        room_id = room_response.json()["id"]
        product_response = self.client.post(
            "/api/v1/products",
            json={"name": "待删除旧商品", "sku": "OLD-001"},
        )
        self.assertEqual(product_response.status_code, 201, product_response.text)
        product_id = product_response.json()["id"]

        attach_response = self.client.post(
            f"/api/v1/live-rooms/{room_id}/product-selections",
            json={"productIds": [product_id]},
        )
        self.assertEqual(attach_response.status_code, 200, attach_response.text)
        selected_delete = self.client.delete(f"/api/v1/products/{product_id}")
        self.assertEqual(selected_delete.status_code, 409, selected_delete.text)

        detach_response = self.client.delete(f"/api/v1/live-rooms/{room_id}/products/{product_id}")
        self.assertEqual(detach_response.status_code, 204, detach_response.text)
        delete_response = self.client.delete(f"/api/v1/products/{product_id}")
        self.assertEqual(delete_response.status_code, 204, delete_response.text)
        catalog = self.client.get("/api/v1/products").json()
        self.assertNotIn(product_id, {product["id"] for product in catalog})

    def test_platform_event_webhook_verifies_persists_and_deduplicates(self) -> None:
        room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "平台事件测试", "config": room_config()},
        )
        self.assertEqual(room_response.status_code, 201, room_response.text)
        room_id = room_response.json()["id"]
        payload = {
            "externalEventId": "comment-0001",
            "eventType": "comment",
            "liveRoomId": room_id,
            "actorId": "viewer-7",
            "actorName": "测试观众",
            "content": "咖啡豆是什么烘焙度？",
            "occurredAt": "2026-09-01T10:00:00+00:00",
            "data": {"sourceRoomId": "platform-room-8"},
        }

        first_response = self.post_platform_event(payload)
        self.assertEqual(first_response.status_code, 202, first_response.text)
        first = first_response.json()
        self.assertTrue(first["accepted"])
        self.assertFalse(first["duplicate"])
        self.assertEqual(first["event"]["platform"], "test-bridge")
        self.assertEqual(first["event"]["content"], payload["content"])

        duplicate_response = self.post_platform_event(payload)
        self.assertEqual(duplicate_response.status_code, 202, duplicate_response.text)
        duplicate = duplicate_response.json()
        self.assertTrue(duplicate["duplicate"])
        self.assertEqual(duplicate["event"]["id"], first["event"]["id"])

        list_response = self.client.get(
            f"/api/v1/live-rooms/{room_id}/platform-events",
            params={"eventType": "comment"},
        )
        self.assertEqual(list_response.status_code, 200, list_response.text)
        self.assertEqual(len(list_response.json()), 1)
        with SessionLocal() as db:
            self.assertEqual(db.query(PlatformLiveEvent).count(), 1)

    def test_platform_event_webhook_rejects_bad_signature_and_limits_bursts(self) -> None:
        room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "事件安全测试", "config": room_config()},
        )
        room_id = room_response.json()["id"]
        payload = {
            "externalEventId": "follow-0001",
            "eventType": "follow",
            "liveRoomId": room_id,
        }
        invalid_response = self.post_platform_event(payload, signature="sha256=" + "0" * 64)
        self.assertEqual(invalid_response.status_code, 401, invalid_response.text)

        limiter = FixedWindowRateLimiter()
        self.assertTrue(limiter.allow("connector:127.0.0.1", 2, now=10))
        self.assertTrue(limiter.allow("connector:127.0.0.1", 2, now=11))
        self.assertFalse(limiter.allow("connector:127.0.0.1", 2, now=12))
        self.assertTrue(limiter.allow("connector:127.0.0.1", 2, now=71))

        stale_timestamp = "100"
        body = b"{}"
        with self.assertRaises(WebhookSignatureError):
            verify_webhook_signature(
                secret="test-webhook-secret-123456789",
                timestamp=stale_timestamp,
                signature=sign_webhook("test-webhook-secret-123456789", stale_timestamp, body),
                body=body,
                tolerance_seconds=300,
                now=401,
            )

    def test_platform_connection_encrypts_secret_and_tracks_reachability(self) -> None:
        stream_key = "super-private-stream-key-9876"
        create_response = self.client.post(
            "/api/v1/platform-connections",
            json={
                "name": "测试 RTMP",
                "platformLabel": "测试平台",
                "serverUrl": "rtmps://push.example.com/live/",
                "streamKey": stream_key,
            },
        )
        self.assertEqual(create_response.status_code, 201, create_response.text)
        created = create_response.json()
        self.assertEqual(created["serverUrl"], "rtmps://push.example.com/live")
        self.assertEqual(created["streamKeyLast4"], "9876")
        self.assertNotIn("streamKey", created)
        self.assertNotIn("streamKeyCiphertext", created)

        connection_id = created["id"]
        with SessionLocal() as db:
            persisted = db.get(PlatformConnection, connection_id)
            self.assertIsNotNone(persisted)
            self.assertNotIn(stream_key, persisted.stream_key_ciphertext)
            self.assertTrue(persisted.stream_key_ciphertext.startswith("v1."))

        with patch(
            "app.api.v1.platform_connections.probe_rtmp_endpoint",
            return_value="服务器可达（push.example.com:443）；推流密钥将在正式推流时校验",
        ):
            test_response = self.client.post(f"/api/v1/platform-connections/{connection_id}/test")
        self.assertEqual(test_response.status_code, 200, test_response.text)
        tested = test_response.json()
        self.assertEqual(tested["testStatus"], "passed")
        self.assertIsNotNone(tested["lastTestedAt"])

        disable_response = self.client.put(
            f"/api/v1/platform-connections/{connection_id}",
            json={
                "name": tested["name"],
                "platformLabel": tested["platformLabel"],
                "serverUrl": tested["serverUrl"],
                "status": "disabled",
                "expectedVersion": tested["version"],
            },
        )
        self.assertEqual(disable_response.status_code, 200, disable_response.text)
        self.assertEqual(disable_response.json()["status"], "disabled")

        disabled_test = self.client.post(f"/api/v1/platform-connections/{connection_id}/test")
        self.assertEqual(disabled_test.status_code, 409)

    def test_local_rtmp_self_test_reports_success_without_platform_credentials(self) -> None:
        with patch(
            "app.api.v1.platform_connections.run_local_rtmp_self_test",
            return_value=LocalRtmpSelfTestResult(message="本机 RTMP 链路正常", duration_ms=2040),
        ):
            response = self.client.post("/api/v1/platform-connections/local-rtmp-self-test")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.json(),
            {"passed": True, "message": "本机 RTMP 链路正常", "durationMs": 2040},
        )

    def test_local_rtmp_self_test_returns_readable_failure(self) -> None:
        with patch(
            "app.api.v1.platform_connections.run_local_rtmp_self_test",
            side_effect=LocalRtmpSelfTestError("SRS 未运行"),
        ):
            response = self.client.post("/api/v1/platform-connections/local-rtmp-self-test")

        self.assertEqual(response.status_code, 503, response.text)
        self.assertEqual(response.json()["detail"], "SRS 未运行")

    def test_test_pattern_uses_configured_resolution_and_frame_rate(self) -> None:
        self.assertEqual(_output_dimensions({"outputConfig": {"resolution": "1080p"}}), (1920, 1080))
        self.assertEqual(_output_dimensions({"outputConfig": {"resolution": "4K"}}), (3840, 2160))
        self.assertEqual(_output_dimensions({"outputConfig": {"resolution": "unknown"}}), (1920, 1080))

        command = _source_command(
            "rtmp://127.0.0.1/live/test",
            {"outputConfig": {"resolution": "4K", "frameRate": "60 fps"}},
        )
        self.assertIn("testsrc2=size=3840x2160:rate=60", command)

    def test_platform_connection_rejects_embedded_credentials_and_query_secrets(self) -> None:
        for server_url in (
            "https://push.example.com/live",
            "rtmp://user:password@push.example.com/live",
            "rtmp://push.example.com/live?key=secret",
        ):
            response = self.client.post(
                "/api/v1/platform-connections",
                json={
                    "name": "无效目标",
                    "platformLabel": "测试",
                    "serverUrl": server_url,
                    "streamKey": "secret",
                },
            )
            self.assertEqual(response.status_code, 422, response.text)

    def test_rtmp_probe_blocks_private_network_targets(self) -> None:
        with self.assertRaisesRegex(RtmpProbeError, "只允许测试公网"):
            probe_rtmp_endpoint("rtmp://127.0.0.1/live")

    def test_live_run_preflight_create_idempotency_and_stop(self) -> None:
        connection_response = self.client.post(
            "/api/v1/platform-connections",
            json={
                "name": "开播测试目标",
                "platformLabel": "测试平台",
                "serverUrl": "rtmps://push.example.com/live",
                "streamKey": "run-secret-1234",
            },
        )
        self.assertEqual(connection_response.status_code, 201, connection_response.text)
        connection = connection_response.json()
        with patch(
            "app.api.v1.platform_connections.probe_rtmp_endpoint",
            return_value="服务器可达（push.example.com:443）；推流密钥将在正式推流时校验",
        ):
            tested_connection_response = self.client.post(
                f"/api/v1/platform-connections/{connection['id']}/test"
            )
        self.assertEqual(tested_connection_response.status_code, 200, tested_connection_response.text)
        connection = tested_connection_response.json()

        config = room_config()
        config["selectedPlatformConnectionIds"] = [connection["id"]]
        room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "可开播测试间", "config": config},
        )
        self.assertEqual(room_response.status_code, 201, room_response.text)
        room = room_response.json()
        publish_response = self.client.post(f"/api/v1/live-rooms/{room['id']}/publish")
        self.assertEqual(publish_response.status_code, 200, publish_response.text)
        room = publish_response.json()

        with patch.object(live_run_preflight.settings, "live_run_allow_test_pattern", True):
            preflight_response = self.client.post(
                "/api/v1/live-runs/preflight",
                json={
                    "liveRoomId": room["id"],
                    "expectedRoomVersion": room["version"],
                    "legalSourceConfirmed": True,
                    "mediaSource": {"kind": "test_pattern", "sourceId": "unit-test"},
                },
            )
            self.assertEqual(preflight_response.status_code, 200, preflight_response.text)
            preflight = preflight_response.json()
            self.assertTrue(preflight["ready"])
            self.assertEqual(preflight["targetCount"], 1)
            self.assertTrue(all(check["passed"] for check in preflight["checks"]))

            payload = {
                "requestId": "run-request-1234",
                "liveRoomId": room["id"],
                "expectedRoomVersion": room["version"],
                "legalSourceConfirmed": True,
                "mediaSource": {"kind": "test_pattern", "sourceId": "unit-test"},
            }
            create_response = self.client.post("/api/v1/live-runs", json=payload)
            self.assertEqual(create_response.status_code, 201, create_response.text)
            created = create_response.json()
            self.assertEqual(created["status"], "ready")
            self.assertEqual(len(created["targets"]), 1)
            self.assertEqual(created["targets"][0]["streamKeyLast4"], "1234")
            self.assertNotIn("serverUrl", created["targets"][0])
            self.assertNotIn("streamKeyCiphertext", created["targets"][0])

            retry_response = self.client.post("/api/v1/live-runs", json=payload)
            self.assertEqual(retry_response.status_code, 201, retry_response.text)
            self.assertEqual(retry_response.json()["id"], created["id"])

            with patch.object(live_run_preflight.settings, "live_run_allow_test_pattern", True), patch(
                "app.services.live_runs.supervisor.settings.media_heartbeat_interval", 0.05
            ):
                processes: list[StubMediaProcess] = []

                def spawn(command, **kwargs):
                    process = StubMediaProcess(tuple(command))
                    processes.append(process)
                    return process

                with patch.object(media_supervisor, "_spawn", side_effect=spawn):
                    start_response = self.client.post(f"/api/v1/live-runs/{created['id']}/start")
                    self.assertEqual(start_response.status_code, 200, start_response.text)
                    self.assertEqual(start_response.json()["status"], "live")
                    self.assertEqual(len(processes), 2)
                    self.assertTrue(any("testsrc2" in part for part in processes[0].command))
                    self.assertTrue(any("run-secret-1234" in part for part in processes[1].command))

        get_response = self.client.get(f"/api/v1/live-runs/{created['id']}")
        self.assertEqual(get_response.status_code, 200, get_response.text)
        stop_response = self.client.post(f"/api/v1/live-runs/{created['id']}/stop")
        self.assertEqual(stop_response.status_code, 200, stop_response.text)
        for _ in range(30):
            stop_response = self.client.get(f"/api/v1/live-runs/{created['id']}")
            if stop_response.json()["status"] == "stopped":
                break
            time.sleep(0.05)
        self.assertEqual(stop_response.json()["status"], "stopped")
        self.assertEqual(stop_response.json()["targets"][0]["status"], "stopped")

        with SessionLocal() as db:
            persisted_run = db.get(LiveRun, created["id"])
            self.assertIsNotNone(persisted_run)
            self.assertEqual(persisted_run.status, "stopped")
            persisted_target = db.query(LiveRunTarget).filter_by(live_run_id=created["id"]).one()
            self.assertEqual(persisted_target.status, "stopped")

        browser_payload = {
            "requestId": "browser-run-request-1234",
            "liveRoomId": room["id"],
            "expectedRoomVersion": room["version"],
            "legalSourceConfirmed": True,
            "mediaSource": {"kind": "browser_ingest", "sourceId": "untrusted-client-name"},
        }
        browser_create_response = self.client.post("/api/v1/live-runs", json=browser_payload)
        self.assertEqual(browser_create_response.status_code, 201, browser_create_response.text)
        browser_run = browser_create_response.json()
        self.assertEqual(browser_run["status"], "ready")
        self.assertEqual(browser_run["ingest"]["protocol"], "whip")
        self.assertEqual(browser_run["ingest"]["streamName"], browser_run["mediaSourceId"])
        self.assertNotEqual(browser_run["mediaSourceId"], "untrusted-client-name")
        self.assertIn("/rtc/v1/whip/", browser_run["ingest"]["url"])

        browser_processes: list[StubMediaProcess] = []

        def spawn_browser_target(command, **kwargs):
            process = StubMediaProcess(tuple(command))
            browser_processes.append(process)
            return process

        with patch.object(media_supervisor, "_stream_probe", return_value=True), patch.object(
            media_supervisor, "_spawn", side_effect=spawn_browser_target
        ), patch(
            "app.services.live_runs.supervisor.settings.media_heartbeat_interval", 0.05
        ):
            start_response = self.client.post(f"/api/v1/live-runs/{browser_run['id']}/start")
            self.assertEqual(start_response.status_code, 200, start_response.text)
            for _ in range(30):
                current = self.client.get(f"/api/v1/live-runs/{browser_run['id']}").json()
                if current["status"] == "live":
                    break
                time.sleep(0.05)
            self.assertEqual(current["status"], "live")
            self.assertEqual(len(browser_processes), 1)
            self.assertFalse(any("testsrc2" in part for part in browser_processes[0].command))
            self.assertTrue(any(browser_run["mediaSourceId"] in part for part in browser_processes[0].command))
            self.client.post(f"/api/v1/live-runs/{browser_run['id']}/stop")
            for _ in range(30):
                current = self.client.get(f"/api/v1/live-runs/{browser_run['id']}").json()
                if current["status"] == "stopped":
                    break
                time.sleep(0.05)
            self.assertEqual(current["status"], "stopped")

    def test_live_run_preflight_requires_published_room_and_configured_media_source(self) -> None:
        room_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "草稿测试间", "config": room_config()},
        )
        self.assertEqual(room_response.status_code, 201, room_response.text)
        room = room_response.json()
        with patch.object(live_run_preflight.settings, "live_run_allow_test_pattern", True):
            response = self.client.post(
                "/api/v1/live-runs/preflight",
                json={
                    "liveRoomId": room["id"],
                    "expectedRoomVersion": room["version"],
                    "legalSourceConfirmed": True,
                    "mediaSource": {"kind": "test_pattern"},
                },
            )
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertFalse(result["ready"])
        self.assertFalse(next(check for check in result["checks"] if check["code"] == "room_published")["passed"])

        publish_response = self.client.post(f"/api/v1/live-rooms/{room['id']}/publish")
        self.assertEqual(publish_response.status_code, 200, publish_response.text)
        published = publish_response.json()
        browser_response = self.client.post(
            "/api/v1/live-runs/preflight",
            json={
                "liveRoomId": published["id"],
                "expectedRoomVersion": published["version"],
                "legalSourceConfirmed": True,
                "mediaSource": {"kind": "browser_ingest"},
            },
        )
        self.assertEqual(browser_response.status_code, 200, browser_response.text)
        self.assertFalse(browser_response.json()["ready"])
        media_check = next(
            check for check in browser_response.json()["checks"] if check["code"] == "media_source_ready"
        )
        self.assertTrue(media_check["passed"])
        self.assertIn("WHIP", media_check["message"])


if __name__ == "__main__":
    unittest.main()
