"""Server-authoritative checks required before a live run may be created."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from ...core.config import settings
from ...models.live_room import LiveRoom, utc_now
from ...models.platform_connection import PlatformConnection
from ...repositories.live_rooms import get_live_room
from ...repositories.platform_connections import get_platform_connection
from ...schemas.live_run import (
    LiveRunMediaSource,
    LiveRunPreflightCheck,
    LiveRunPreflightRequest,
    LiveRunPreflightResponse,
)
from ...security import SecretConfigurationError, SecretDecryptionError, decrypt_secret


@dataclass(frozen=True)
class PreflightEvaluation:
    response: LiveRunPreflightResponse
    room: LiveRoom | None
    connections: list[PlatformConnection]


def _check(code: str, label: str, passed: bool, message: str) -> LiveRunPreflightCheck:
    return LiveRunPreflightCheck(code=code, label=label, passed=passed, message=message)


def _media_source_check(media_source: LiveRunMediaSource) -> LiveRunPreflightCheck:
    if media_source.kind == "test_pattern":
        allowed = settings.live_run_allow_test_pattern
        return _check(
            "media_source_ready",
            "最终画面媒体源已连接",
            allowed,
            "测试画面源已由服务端显式启用" if allowed else "生产环境未启用测试画面源",
        )
    return _check(
        "media_source_ready",
        "最终画面媒体源已连接",
        False,
        "浏览器最终画面尚未接入媒体网关，当前不会启动外部推流",
    )


def evaluate_preflight(db: Session, payload: LiveRunPreflightRequest) -> PreflightEvaluation:
    room = get_live_room(db, payload.live_room_id)
    checks: list[LiveRunPreflightCheck] = []
    checks.append(
        _check(
            "room_exists",
            "直播间存在",
            room is not None,
            "已读取持久化直播间" if room else "直播间不存在或已删除",
        )
    )
    room_published = room is not None and room.status == "published"
    checks.append(
        _check(
            "room_published",
            "直播间已发布",
            room_published,
            "已发布配置可用于开播"
            if room_published
            else "请先发布直播间配置，再执行开播预检",
        )
    )
    version_matches = room is not None and room.version == payload.expected_room_version
    checks.append(
        _check(
            "room_version",
            "直播间配置已保存且版本一致",
            version_matches,
            (
                f"当前持久化版本为 {room.version}"
                if room and version_matches
                else f"请求版本 {payload.expected_room_version} 与当前版本不一致"
                if room
                else "无法检查直播间版本"
            ),
        )
    )

    selected_ids: list[str] = []
    if room:
        selected_ids = list(dict.fromkeys(room.config.get("selectedPlatformConnectionIds", [])))
    checks.append(
        _check(
            "targets_selected",
            "已选择至少一个推流目标",
            bool(selected_ids),
            f"已选择 {len(selected_ids)} 个目标" if selected_ids else "请先选择并保存推流目标",
        )
    )

    connections = [get_platform_connection(db, connection_id) for connection_id in selected_ids]
    resolved_connections = [connection for connection in connections if connection is not None]
    targets_exist = bool(selected_ids) and len(resolved_connections) == len(selected_ids)
    checks.append(
        _check(
            "targets_exist",
            "所选推流目标仍然存在",
            targets_exist,
            "全部目标已读取" if targets_exist else "部分推流目标不存在，请重新选择并保存",
        )
    )
    targets_enabled = targets_exist and all(connection.status == "enabled" for connection in resolved_connections)
    checks.append(
        _check(
            "targets_enabled",
            "所选推流目标已启用",
            targets_enabled,
            "全部目标已启用" if targets_enabled else "存在未启用的推流目标",
        )
    )
    targets_tested = targets_exist and all(connection.test_status == "passed" for connection in resolved_connections)
    checks.append(
        _check(
            "targets_tested",
            "所选目标连接测试通过",
            targets_tested,
            "全部目标最近一次连接测试通过" if targets_tested else "请对所有目标执行连接测试",
        )
    )

    credentials_ready = targets_exist
    credential_message = "全部加密凭据可由服务端解密"
    if targets_exist:
        try:
            for connection in resolved_connections:
                decrypt_secret(connection.stream_key_ciphertext, connection.id)
        except SecretConfigurationError:
            credentials_ready = False
            credential_message = "服务器未正确配置平台凭据主密钥"
        except SecretDecryptionError:
            credentials_ready = False
            credential_message = "存在无法解密的推流凭据，请重新保存该连接"
    else:
        credentials_ready = False
        credential_message = "没有可检查的推流凭据"
    checks.append(
        _check(
            "credentials_decryptable",
            "推流凭据可安全读取",
            credentials_ready,
            credential_message,
        )
    )

    output = room.config.get("outputConfig", {}) if room else {}
    output_supported = output.get("protocol") == "RTMP" and output.get("codec") == "H.264"
    checks.append(
        _check(
            "output_supported",
            "输出协议为 RTMP / H.264",
            output_supported,
            "当前编码输出受支持" if output_supported else "当前仅支持 RTMP / H.264",
        )
    )
    checks.append(
        _check(
            "legal_source_confirmed",
            "已确认推流地址来源合法",
            payload.legal_source_confirmed,
            "操作者已确认" if payload.legal_source_confirmed else "请勾选合法来源确认",
        )
    )
    checks.append(_media_source_check(payload.media_source))

    response = LiveRunPreflightResponse(
        ready=all(check.passed for check in checks),
        live_room_id=payload.live_room_id,
        room_version=room.version if room else None,
        media_source_kind=payload.media_source.kind,
        target_count=len(resolved_connections),
        checks=checks,
        checked_at=utc_now(),
    )
    return PreflightEvaluation(response=response, room=room, connections=resolved_connections)
