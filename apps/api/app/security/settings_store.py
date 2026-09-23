"""Admin-owned encrypted settings and transactional platform-key rotation."""

from __future__ import annotations

import base64
from datetime import datetime, timezone
import os
import re

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..core.config import settings
from ..models.account import SettingAudit, SystemSetting, User
from ..models.live_run import LiveRun, LiveRunTarget
from ..models.platform_connection import PlatformConnection
from .platform_secrets import SecretConfigurationError, decrypt_secret, encrypt_secret


# A fixed allowlist prevents a web form from modifying arbitrary process environment.
SETTING_FIELDS = {
    "azure_service_key": ("Azure TTS Key", True, "api"),
    "azure_service_region": ("Azure 区域", False, "api"),
    "llm_api_key": ("LLM API Key", True, "api"),
    "llm_base_url": ("LLM 服务地址", False, "api"),
    "llm_default_model_id": ("LLM 默认模型", False, "api"),
    "seo_image_api_key": ("SEO 图片服务 Key", True, "deployment"),
    "seo_image_api_base_url": ("SEO 图片服务地址", False, "deployment"),
    "seo_voice_api_key": ("SEO 声音服务 Key", True, "deployment"),
    "seo_voice_api_base_url": ("SEO 声音服务地址", False, "deployment"),
    "seo_video_api_key": ("SEO 视频服务 Key", True, "deployment"),
    "seo_video_api_base_url": ("SEO 视频服务地址", False, "deployment"),
    "avatar_registry_key": ("形象注册服务 Key", True, "deployment"),
    "aliyun_access_key_id": ("阿里云 Access Key ID", True, "deployment"),
    "aliyun_access_key_secret": ("阿里云 Access Key Secret", True, "deployment"),
    "livetalking_url": ("LiveTalking 地址", False, "deployment"),
    "srs_internal_api_url": ("媒体网关 API 地址", False, "deployment"),
    "srs_internal_rtmp_url": ("媒体网关 RTMP 地址", False, "deployment"),
    "redis_url": ("Redis 地址", False, "deployment"),
    "qdrant_url": ("Qdrant 地址", False, "deployment"),
    "minio_endpoint": ("MinIO 地址", False, "deployment"),
    "minio_access_key": ("MinIO Access Key", True, "deployment"),
    "minio_secret_key": ("MinIO Secret Key", True, "deployment"),
    "database_url": ("数据库连接地址", True, "deployment"),
    "platform_master_key": ("平台凭据加密主密钥", True, "rotation"),
}
INTEGER_SETTING_FIELDS: set[str] = set()


def runtime_value(name: str, value: str):
    return int(value) if name in INTEGER_SETTING_FIELDS else value


def root_key() -> bytes:
    try:
        encoded = settings.platform_encryption_key.strip()
        key = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
        if len(key) == 32:
            return key
    except (ValueError, TypeError):
        pass
    raise SecretConfigurationError("PLATFORM_ENCRYPTION_KEY must be configured outside the app")


def encrypt_setting(name: str, value: str) -> str:
    nonce = os.urandom(12)
    ciphertext = AESGCM(root_key()).encrypt(nonce, value.encode(), f"synlive:setting:{name}:v1".encode())
    return "v1." + base64.urlsafe_b64encode(nonce + ciphertext).decode().rstrip("=")


def decrypt_setting(name: str, envelope: str) -> str:
    version, encoded = envelope.split(".", 1)
    if version != "v1":
        raise ValueError("unsupported setting encryption version")
    payload = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    return AESGCM(root_key()).decrypt(payload[:12], payload[12:], f"synlive:setting:{name}:v1".encode()).decode()


def stored_value(db: Session, name: str) -> str | None:
    row = db.get(SystemSetting, name)
    return decrypt_setting(name, row.encrypted_value) if row else None


def effective_api_value(name: str) -> str:
    from ..db.session import SessionLocal
    with SessionLocal() as db:
        saved = stored_value(db, name)
    return saved if saved is not None else getattr(settings, name)


def put_settings(db: Session, values: dict[str, str], admin: User) -> None:
    """Persist related settings in one transaction, then apply API settings in-process."""
    updated_at = datetime.now(timezone.utc)
    for name, value in values.items():
        if name not in SETTING_FIELDS:
            raise ValueError(f"unknown setting: {name}")
        row = db.get(SystemSetting, name)
        if row is None:
            row = SystemSetting(key=name, encrypted_value="", updated_by=admin.id)
            db.add(row)
        row.encrypted_value = encrypt_setting(name, value)
        row.updated_by = admin.id
        row.updated_at = updated_at
        db.add(SettingAudit(key=name, action="replace", actor_id=admin.id))
    db.commit()
    for name, value in values.items():
        if SETTING_FIELDS[name][2] == "api":
            setattr(settings, name, runtime_value(name, value))


def put_setting(db: Session, name: str, value: str, admin: User) -> None:
    put_settings(db, {name: value}, admin)


def apply_api_settings(db: Session) -> None:
    for name, (_, _, mode) in SETTING_FIELDS.items():
        if mode != "api":
            continue
        value = stored_value(db, name)
        if value is not None:
            setattr(settings, name, runtime_value(name, value))


def active_platform_key(db: Session) -> bytes:
    encoded = stored_value(db, "platform_master_key")
    if encoded is None:
        return root_key()
    try:
        key = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    except (ValueError, TypeError) as exc:
        raise SecretConfigurationError("invalid platform master key") from exc
    if len(key) != 32:
        raise SecretConfigurationError("platform master key must be 32 bytes")
    return key


def rotate_platform_key(db: Session, encoded: str, admin: User) -> None:
    if not re.fullmatch(r"[A-Za-z0-9_-]{43}=?", encoded):
        raise ValueError("主密钥必须是 32 字节 URL-safe Base64")
    try:
        new_key = base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4))
    except (ValueError, TypeError) as exc:
        raise ValueError("主密钥必须是 32 字节 URL-safe Base64") from exc
    if len(new_key) != 32:
        raise ValueError("主密钥必须是 32 字节 URL-safe Base64")
    if db.bind and db.bind.dialect.name == "postgresql":
        from sqlalchemy import text
        db.execute(text("LOCK TABLE live_runs, platform_connections, live_run_targets IN EXCLUSIVE MODE"))
    active = db.scalar(select(LiveRun.id).where(LiveRun.status.in_(("preparing", "ready", "starting", "live", "stopping"))).limit(1))
    if active:
        raise ValueError("存在未结束的直播任务，不能轮换平台主密钥")
    old_key = active_platform_key(db)
    if old_key == new_key:
        raise ValueError("新主密钥不能与当前主密钥相同")
    for model in (PlatformConnection, LiveRunTarget):
        for row in db.scalars(select(model)).all():
            plaintext = decrypt_secret(row.stream_key_ciphertext, row.id if model is PlatformConnection else row.platform_connection_id, key=old_key)
            row.stream_key_ciphertext = encrypt_secret(plaintext, row.id if model is PlatformConnection else row.platform_connection_id, key=new_key)
    row = db.get(SystemSetting, "platform_master_key")
    if row is None:
        row = SystemSetting(key="platform_master_key", encrypted_value="", updated_by=admin.id)
        db.add(row)
    row.encrypted_value = encrypt_setting("platform_master_key", encoded)
    row.updated_by = admin.id
    row.updated_at = datetime.now(timezone.utc)
    db.add(SettingAudit(key="platform_master_key", action="rotate", actor_id=admin.id))
    db.commit()
