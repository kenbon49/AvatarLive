"""HMAC verification and process-local abuse protection for connector webhooks."""

from __future__ import annotations

from collections import defaultdict, deque
import hashlib
import hmac
import json
from threading import Lock
import time


class WebhookConfigurationError(RuntimeError):
    pass


class WebhookSignatureError(ValueError):
    pass


def resolve_webhook_secret(raw_config: str, platform: str) -> str:
    try:
        configured = json.loads(raw_config or "{}")
    except json.JSONDecodeError as exc:
        raise WebhookConfigurationError("platform webhook secret configuration is invalid JSON") from exc
    if not isinstance(configured, dict):
        raise WebhookConfigurationError("platform webhook secret configuration must be an object")
    normalized = platform.lower()
    secret = configured.get(normalized) or configured.get("*")
    if not isinstance(secret, str) or len(secret) < 16:
        raise WebhookConfigurationError(f"no webhook secret is configured for {normalized}")
    return secret


def sign_webhook(secret: str, timestamp: str, body: bytes) -> str:
    message = timestamp.encode("ascii") + b"." + body
    return hmac.new(secret.encode("utf-8"), message, hashlib.sha256).hexdigest()


def verify_webhook_signature(
    *,
    secret: str,
    timestamp: str | None,
    signature: str | None,
    body: bytes,
    tolerance_seconds: int,
    now: float | None = None,
) -> None:
    if not timestamp or not signature:
        raise WebhookSignatureError("missing webhook signature headers")
    try:
        timestamp_value = int(timestamp)
    except ValueError as exc:
        raise WebhookSignatureError("invalid webhook timestamp") from exc
    current_time = time.time() if now is None else now
    if abs(current_time - timestamp_value) > tolerance_seconds:
        raise WebhookSignatureError("webhook timestamp is outside the accepted window")
    supplied = signature.removeprefix("sha256=").lower()
    expected = sign_webhook(secret, timestamp, body)
    if len(supplied) != len(expected) or not hmac.compare_digest(supplied, expected):
        raise WebhookSignatureError("invalid webhook signature")


class FixedWindowRateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = Lock()

    def allow(self, key: str, limit: int, *, now: float | None = None) -> bool:
        current_time = time.monotonic() if now is None else now
        cutoff = current_time - 60
        with self._lock:
            hits = self._hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= limit:
                return False
            hits.append(current_time)
            return True

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


webhook_rate_limiter = FixedWindowRateLimiter()
