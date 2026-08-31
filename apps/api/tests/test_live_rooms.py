from __future__ import annotations

import os
import tempfile
import unittest


TEST_DIRECTORY = tempfile.TemporaryDirectory(prefix="avatarlive-live-rooms-")
os.environ["DATABASE_URL"] = f"sqlite+pysqlite:///{TEST_DIRECTORY.name}/live-rooms.sqlite3"

from fastapi.testclient import TestClient

from app.db import Base, SessionLocal, engine
from app.main import app
from app.models.live_room import LiveRoom


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


if __name__ == "__main__":
    unittest.main()
