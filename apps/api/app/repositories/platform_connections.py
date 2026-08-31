"""Persistence operations for encrypted outbound platform connections."""

from __future__ import annotations

from sqlalchemy import Select, select, update
from sqlalchemy.orm import Session

from ..models.live_room import utc_now
from ..models.platform_connection import PlatformConnection


class PlatformConnectionVersionConflict(Exception):
    """Raised when a stale client updates a connection."""


def _ordered_connections() -> Select[tuple[PlatformConnection]]:
    return select(PlatformConnection).order_by(
        PlatformConnection.created_at.asc(),
        PlatformConnection.id.asc(),
    )


def list_platform_connections(db: Session) -> list[PlatformConnection]:
    return list(db.scalars(_ordered_connections()))


def get_platform_connection(db: Session, connection_id: str) -> PlatformConnection | None:
    return db.get(PlatformConnection, connection_id)


def create_platform_connection(
    db: Session,
    *,
    connection_id: str,
    name: str,
    platform_label: str,
    server_url: str,
    stream_key_ciphertext: str,
    stream_key_last4: str,
) -> PlatformConnection:
    connection = PlatformConnection(
        id=connection_id,
        kind="manual_rtmp",
        name=name,
        platform_label=platform_label,
        server_url=server_url,
        stream_key_ciphertext=stream_key_ciphertext,
        stream_key_last4=stream_key_last4,
    )
    db.add(connection)
    db.commit()
    db.refresh(connection)
    return connection


def update_platform_connection(
    db: Session,
    connection: PlatformConnection,
    *,
    name: str,
    platform_label: str,
    server_url: str,
    status: str,
    expected_version: int,
    stream_key_ciphertext: str | None = None,
    stream_key_last4: str | None = None,
) -> PlatformConnection:
    values: dict = {
        "name": name,
        "platform_label": platform_label,
        "server_url": server_url,
        "status": status,
        "version": expected_version + 1,
        "updated_at": utc_now(),
    }
    if stream_key_ciphertext is not None and stream_key_last4 is not None:
        values.update(
            stream_key_ciphertext=stream_key_ciphertext,
            stream_key_last4=stream_key_last4,
            test_status="untested",
            test_message=None,
            last_tested_at=None,
        )
    elif server_url != connection.server_url:
        values.update(test_status="untested", test_message=None, last_tested_at=None)

    result = db.execute(
        update(PlatformConnection)
        .where(
            PlatformConnection.id == connection.id,
            PlatformConnection.version == expected_version,
        )
        .values(**values)
    )
    if result.rowcount != 1:
        db.rollback()
        raise PlatformConnectionVersionConflict
    db.commit()
    db.refresh(connection)
    return connection


def record_test_result(
    db: Session,
    connection: PlatformConnection,
    *,
    passed: bool,
    message: str,
) -> PlatformConnection:
    connection.test_status = "passed" if passed else "failed"
    connection.test_message = message[:500]
    connection.last_tested_at = utc_now()
    connection.version += 1
    connection.updated_at = utc_now()
    db.commit()
    db.refresh(connection)
    return connection
