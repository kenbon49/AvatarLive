"""AES-GCM envelope encryption for RTMP keys and future OAuth credentials."""

from __future__ import annotations

import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM



class SecretConfigurationError(RuntimeError):
    """Raised when the server-side encryption key is absent or malformed."""


class SecretDecryptionError(RuntimeError):
    """Raised when ciphertext cannot be authenticated with the configured key."""


def _master_key() -> bytes:
    from ..db.session import SessionLocal
    from .settings_store import active_platform_key
    with SessionLocal() as db:
        return active_platform_key(db)


def _aad(connection_id: str) -> bytes:
    return f"synlive:platform-connection:{connection_id}:v1".encode("utf-8")


def encrypt_secret(value: str, connection_id: str, *, key: bytes | None = None) -> str:
    nonce = os.urandom(12)
    encrypted = AESGCM(key or _master_key()).encrypt(nonce, value.encode("utf-8"), _aad(connection_id))
    envelope = base64.urlsafe_b64encode(nonce + encrypted).decode("ascii").rstrip("=")
    return f"v1.{envelope}"


def decrypt_secret(envelope: str, connection_id: str, *, key: bytes | None = None) -> str:
    try:
        version, encoded = envelope.split(".", 1)
        if version != "v1":
            raise ValueError("unsupported envelope version")
        padding = "=" * (-len(encoded) % 4)
        payload = base64.urlsafe_b64decode(encoded + padding)
        nonce, encrypted = payload[:12], payload[12:]
        if len(nonce) != 12 or not encrypted:
            raise ValueError("invalid envelope")
        plaintext = AESGCM(key or _master_key()).decrypt(nonce, encrypted, _aad(connection_id))
        return plaintext.decode("utf-8")
    except SecretConfigurationError:
        raise
    except (InvalidTag, UnicodeDecodeError, ValueError, TypeError) as exc:
        raise SecretDecryptionError("platform credential could not be decrypted") from exc
