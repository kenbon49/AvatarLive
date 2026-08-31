from __future__ import annotations

import base64
import os
import tempfile
import unittest
from unittest.mock import patch


TEST_DIRECTORY = tempfile.TemporaryDirectory(prefix="avatarlive-live-rooms-")
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{TEST_DIRECTORY.name}/live-rooms.sqlite3"
os.environ["PLATFORM_ENCRYPTION_KEY"] = base64.urlsafe_b64encode(bytes(range(32))).decode("ascii")

from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models.live_room import LiveRoom
from app.models.platform_connection import PlatformConnection
from app.services.platforms import RtmpProbeError, probe_rtmp_endpoint


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


if __name__ == "__main__":
    unittest.main()
