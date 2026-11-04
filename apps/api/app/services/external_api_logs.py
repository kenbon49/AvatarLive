"""Bounded, private diagnostics for outbound calls. Logging never changes a call's result."""

from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
import json
from logging.handlers import RotatingFileHandler
from pathlib import Path
import re
import threading
import time
import traceback
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import uuid4

from ..core.config import settings

log_context: ContextVar[dict] = ContextVar("external_api_log_context", default={})
LOG_DIRECTORY = Path("runtime/external-api-logs")
_lock = threading.RLock()
_sensitive = re.compile(r"^(authorization|proxyauthorization|cookie|setcookie|password|passwd|secret|apikey|accesskeyid|accesskeysecret|accesskey|token|accesstoken|refreshtoken|securitytoken|credential|credentialid|signature|xapikey|xosscredential|xosssignature|xosssecuritytoken)$", re.I)
_omit = re.compile(r"^(data|base64|audiodata|imagedata|filecontent|referenceimages)$", re.I)


def sanitize(value, secrets=()):
    budget, nodes = 20_000, 0
    secrets = [str(item) for item in secrets if item and len(str(item)) >= 6]

    def text(raw):
        for secret in secrets:
            raw = raw.replace(secret, "[已隐藏]")
        raw = re.sub(r"data:[^\s\"']+;base64,[A-Za-z0-9+/=]+", "[已省略文件内容]", raw, flags=re.I)
        raw = re.sub(r"[A-Za-z0-9+/]{200,}={0,2}", "[已省略长编码内容]", raw)
        raw = re.sub(r"\b(?:sk-[A-Za-z0-9_-]{8,}|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+)\b", "[已隐藏]", raw)
        raw = re.sub(r"\b(Bearer|Basic)\s+[A-Za-z0-9+/=_.-]+", r"\1 [已隐藏]", raw, flags=re.I)
        raw = re.sub(r"([\"']?(?:api[_-]?key|access[_-]?key(?:[_-]?(?:id|secret))?|password|secret|token|signature|authorization|cookie)[\"']?\s*[:=]\s*)[\"']?[^\s,;&\"'}]+", r"\1[已隐藏]", raw, flags=re.I)

        def url(match):
            try:
                parts = urlsplit(match.group())
                host = parts.netloc.rsplit("@", 1)[-1]
                query = [(key, "[已隐藏]" if _sensitive.fullmatch(re.sub(r"[^a-z0-9]", "", key.lower()))
                          or re.search(r"signature|credential|token|secret", key, re.I) else item)
                         for key, item in parse_qsl(parts.query, keep_blank_values=True)]
                return urlunsplit((parts.scheme, host, parts.path, urlencode(query), ""))
            except ValueError:
                return "[无效地址]"
        return re.sub(r"https?://[^\s<>\"')]+", url, raw)

    def clean(item, depth=0):
        nonlocal budget, nodes
        nodes += 1
        if budget <= 0 or nodes > 500:
            return "[内容已截断]"
        if depth > 6:
            return "[层级已截断]"
        if isinstance(item, str):
            result = text(item)
            length = min(4000, budget)
            budget -= min(len(result), length)
            return result[:length] + ("…[内容已截断]" if len(result) > length else "")
        if item is None or isinstance(item, (bool, int, float)):
            return item
        if isinstance(item, (list, tuple)):
            return [clean(child, depth + 1) for child in item[:20]]
        if isinstance(item, dict):
            result = {}
            for key, child in list(item.items())[:40]:
                name = re.sub(r"[^a-z0-9]", "", str(key).lower())
                result[text(str(key))[:100]] = "[已隐藏]" if _sensitive.fullmatch(name) else (
                    "[已省略文件内容]" if _omit.fullmatch(name) and isinstance(child, str) and len(child) > 100
                    else clean(child, depth + 1))
            return result
        return clean(str(item), depth + 1)
    return clean(value)


def write_log(entry: dict) -> None:
    # Open per write so rotation remains compatible with API reloads and readers.
    # The API runs one worker; the lock also serializes thread-pool LLM calls.
    try:
        with _lock:
            LOG_DIRECTORY.mkdir(parents=True, exist_ok=True, mode=0o700)
            handler = RotatingFileHandler(LOG_DIRECTORY / "api.log", maxBytes=2 * 1024 * 1024,
                                          backupCount=4, encoding="utf-8", delay=True)
            try:
                import logging
                handler.emit(logging.makeLogRecord({"msg": json.dumps(entry, ensure_ascii=False), "args": ()}))
                (LOG_DIRECTORY / "api.log").chmod(0o600)
            finally:
                handler.close()
    except Exception:
        # Disk or diagnostics errors must never retry or fail a paid API call.
        pass


def list_logs(*, provider="", status="", q="", before="", limit=51) -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    entries = []
    with _lock:
        for suffix in ("", ".1", ".2", ".3", ".4"):
            try:
                contents = (LOG_DIRECTORY / f"api.log{suffix}").read_text(encoding="utf-8")
            except FileNotFoundError:
                continue
            for line in contents.splitlines():
                try:
                    item = json.loads(line)
                    if not isinstance(item, dict) or item.get("source") != "api" or not isinstance(item.get("id"), str):
                        continue
                    key = item["createdAt"] + "|" + item["id"]
                    if item["createdAt"] < cutoff or (before and key >= before):
                        continue
                    if (provider and item["provider"] != provider) or (status and item["status"] != status):
                        continue
                    if q and q.casefold() not in json.dumps(item, ensure_ascii=False).casefold():
                        continue
                    entries.append(item)
                except (ValueError, KeyError, TypeError):
                    continue
    return sorted(entries, key=lambda item: item["createdAt"] + "|" + item["id"], reverse=True)[:limit]


class external_api_call:
    def __init__(self, provider, operation, url, *, method="POST", request=None, secrets=()):
        self.secrets = list(secrets) + [getattr(settings, key, "") for key in (
            "llm_api_key", "bailian_tts_api_key", "aliyun_access_key_id", "aliyun_access_key_secret",
            "platform_encryption_key", "database_url")]
        self.started = time.monotonic()
        self.entry = dict(id=f"api-{uuid4()}", createdAt=datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z"),
                          source="api", provider=provider, operation=operation, method=method, url=url, status="success",
                          httpStatus=None, durationMs=0, requestId="", context=dict(log_context.get()), request=request,
                          response=None, error=None)

    def __enter__(self):
        return self

    def response(self, payload, *, status=200, request_id=""):
        self.entry.update(httpStatus=status, response=payload, requestId=request_id)
        if status >= 400 or (isinstance(payload, dict) and (payload.get("success") is False
            or payload.get("Success") is False or payload.get("error") or payload.get("code"))):
            self.entry.update(status="error", error=payload)

    def http_response(self, response):
        try:
            payload = response.json()
        except (ValueError, AttributeError):
            payload = response.text[:24_000]
        request_id = response.headers.get("x-request-id") or response.headers.get("x-acs-request-id")
        if not request_id and isinstance(payload, dict):
            request_id = payload.get("request_id") or payload.get("RequestId")
        self.response(payload, status=response.status_code, request_id=request_id or "")

    def failure(self, exc):
        provider_error = exc
        seen = set()
        while provider_error is not None and id(provider_error) not in seen:
            seen.add(id(provider_error))
            if self.entry["httpStatus"] is None and getattr(provider_error, "status_code", None):
                self.entry["httpStatus"] = provider_error.status_code
            response = getattr(provider_error, "response", None)
            if response is not None:
                self.http_response(response)
            provider_error = provider_error.__cause__
        self.entry.update(status="error", error={"type": type(exc).__name__, "message": str(exc),
            "stack": "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))})

    def __exit__(self, exc_type, exc, tb):
        try:
            self._finish(exc)
        except Exception:
            pass
        return False

    def _finish(self, exc):
        if exc is not None:
            if self.entry["httpStatus"] is None and getattr(exc, "status_code", None):
                self.entry["httpStatus"] = exc.status_code
            response = getattr(exc, "response", None)
            if response is not None:
                self.http_response(response)
            self.failure(exc)
        self.entry["durationMs"] = round((time.monotonic() - self.started) * 1000)
        # Give request, response and error separate budgets so a long prompt cannot hide an error.
        write_log({key: sanitize(value, self.secrets) for key, value in self.entry.items()})
