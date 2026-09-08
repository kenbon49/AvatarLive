from __future__ import annotations

import base64
import json
import os
import tempfile
import time
import unittest
from unittest.mock import patch


TEST_DIRECTORY = tempfile.TemporaryDirectory(prefix="avatarlive-live-rooms-")
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{TEST_DIRECTORY.name}/live-rooms.sqlite3"
os.environ["PLATFORM_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(bytes(range(32))).decode("ascii")

from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.core.config import settings
from app.main import app
from app.models.live_room import LiveRoom
from app.models.live_library import LiveRoomProduct, LiveRoomProductSelection, LiveRoomScriptLibrary
from app.models.live_run import LiveRun, LiveRunTarget
from app.models.platform_connection import PlatformConnection
from app.models.platform_event import PlatformLiveEvent
from app.services.live_runs import preflight as live_run_preflight
from app.services.live_runs import media_supervisor
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
            }
        ],
        "qaItems": [{"id": 1, "question": "如何使用？", "answer": "请参考商品说明。"}],
        "selectedTemplateId": "food",
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

    def test_create_update_copy_publish_and_persist(self) -> None:
        create_response = self.client.post(
            "/api/v1/live-rooms",
            json={"name": "测试直播间", "config": room_config()},
        )
        self.assertEqual(create_response.status_code, 201, create_response.text)
        created = create_response.json()
        self.assertEqual(created["version"], 1)
        self.assertEqual(created["config"]["avatarId"], "chinese")

        room_id = created["id"]
        updated_config = room_config()
        updated_config["scripts"][0]["text"] = "修改后仍应持久化。"
        update_payload = {
            "name": "测试直播间",
            "expectedVersion": created["version"],
            "config": updated_config,
        }
        update_response = self.client.put(f"/api/v1/live-rooms/{room_id}", json=update_payload)
        self.assertEqual(update_response.status_code, 200, update_response.text)
        self.assertEqual(update_response.json()["version"], 2)
        self.assertEqual(update_response.json()["status"], "draft")

        stale_response = self.client.put(f"/api/v1/live-rooms/{room_id}", json=update_payload)
        self.assertEqual(stale_response.status_code, 409)

        with SessionLocal() as db:
            persisted = db.get(LiveRoom, room_id)
            self.assertIsNotNone(persisted)
            self.assertEqual(persisted.config["scripts"][0]["text"], "修改后仍应持久化。")

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
