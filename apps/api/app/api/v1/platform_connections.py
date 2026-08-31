"""Platform authorization-center APIs, beginning with encrypted manual RTMP."""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ...db.session import get_db
from ...repositories import platform_connections as repository
from ...schemas.platform_connection import (
    PlatformConnectionCreate,
    PlatformConnectionResponse,
    PlatformConnectionUpdate,
)
from ...security import SecretConfigurationError, SecretDecryptionError, decrypt_secret, encrypt_secret
from ...services.platforms import RtmpProbeError, probe_rtmp_endpoint

router = APIRouter(prefix="/platform-connections", tags=["platform connections"])


def require_connection(db: Session, connection_id: str):
    connection = repository.get_platform_connection(db, connection_id)
    if connection is None:
        raise HTTPException(status_code=404, detail="platform connection not found")
    return connection


def encryption_unavailable(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="platform credential encryption is not configured on the server",
    )


@router.get("", response_model=list[PlatformConnectionResponse], response_model_exclude_none=True)
def list_connections(db: Session = Depends(get_db)) -> list:
    return repository.list_platform_connections(db)


@router.post(
    "",
    response_model=PlatformConnectionResponse,
    response_model_exclude_none=True,
    status_code=status.HTTP_201_CREATED,
)
def create_connection(payload: PlatformConnectionCreate, db: Session = Depends(get_db)):
    connection_id = str(uuid4())
    try:
        ciphertext = encrypt_secret(payload.stream_key, connection_id)
    except SecretConfigurationError as exc:
        raise encryption_unavailable(exc) from exc
    return repository.create_platform_connection(
        db,
        connection_id=connection_id,
        name=payload.name,
        platform_label=payload.platform_label,
        server_url=payload.server_url,
        stream_key_ciphertext=ciphertext,
        stream_key_last4=payload.stream_key[-4:],
    )


@router.get("/{connection_id}", response_model=PlatformConnectionResponse, response_model_exclude_none=True)
def get_connection(connection_id: str, db: Session = Depends(get_db)):
    return require_connection(db, connection_id)


@router.put("/{connection_id}", response_model=PlatformConnectionResponse, response_model_exclude_none=True)
def update_connection(
    connection_id: str,
    payload: PlatformConnectionUpdate,
    db: Session = Depends(get_db),
):
    connection = require_connection(db, connection_id)
    ciphertext = None
    last4 = None
    if payload.stream_key is not None:
        try:
            ciphertext = encrypt_secret(payload.stream_key, connection.id)
        except SecretConfigurationError as exc:
            raise encryption_unavailable(exc) from exc
        last4 = payload.stream_key[-4:]
    try:
        return repository.update_platform_connection(
            db,
            connection,
            name=payload.name,
            platform_label=payload.platform_label,
            server_url=payload.server_url,
            status=payload.status,
            expected_version=payload.expected_version,
            stream_key_ciphertext=ciphertext,
            stream_key_last4=last4,
        )
    except repository.PlatformConnectionVersionConflict as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="platform connection was updated elsewhere; reload before saving",
        ) from exc


@router.post(
    "/{connection_id}/test",
    response_model=PlatformConnectionResponse,
    response_model_exclude_none=True,
)
def test_connection(connection_id: str, db: Session = Depends(get_db)):
    connection = require_connection(db, connection_id)
    if connection.status != "enabled":
        raise HTTPException(status_code=409, detail="enable the platform connection before testing")
    try:
        decrypt_secret(connection.stream_key_ciphertext, connection.id)
    except SecretConfigurationError as exc:
        raise encryption_unavailable(exc) from exc
    except SecretDecryptionError as exc:
        raise HTTPException(status_code=500, detail="stored platform credential cannot be decrypted") from exc

    try:
        message = probe_rtmp_endpoint(connection.server_url)
        return repository.record_test_result(db, connection, passed=True, message=message)
    except RtmpProbeError as exc:
        return repository.record_test_result(db, connection, passed=False, message=str(exc))
