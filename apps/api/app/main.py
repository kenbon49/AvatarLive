"""SynLive API 入口。"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from .api.v1 import admin, auth, billing, health, live, live_library, live_rooms, live_runs, llm, platform_connections, platform_events, resources, tts
from .core.config import settings
from .core.logging import setup_logging
from .services.live_runs import media_supervisor
from .security.accounts import require_user
from .db.session import SessionLocal
from .security.settings_store import apply_api_settings


@asynccontextmanager
async def lifespan(_: FastAPI):
    setup_logging()
    with SessionLocal() as db:
        apply_api_settings(db)
    # A process-local supervisor cannot safely resume child PIDs after an API
    # restart; mark those rows failed rather than exposing a false LIVE state.
    media_supervisor.recover_orphaned_runs()
    yield
    media_supervisor.shutdown()


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    description="AI 数字人直播中控平台后端",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def log_request_validation_error(request: Request, exc: RequestValidationError):
    issues = [
        {
            "location": ".".join(str(part) for part in error.get("loc", ())),
            "type": error.get("type", "validation_error"),
            "message": error.get("msg", "invalid value"),
        }
        for error in exc.errors()
    ]
    logger.warning(
        "[validation] {} {} rejected: {}",
        request.method,
        request.url.path,
        issues,
    )
    return await request_validation_exception_handler(request, exc)


@app.middleware("http")
async def check_mutating_origin(request: Request, call_next):
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        forwarded_host = request.headers.get("x-forwarded-host", "")
        forwarded_proto = request.headers.get("x-forwarded-proto", "https")
        same_origin = {f"{request.url.scheme}://{request.headers.get('host', '')}"}
        if forwarded_host:
            same_origin.add(f"{forwarded_proto}://{forwarded_host}")
        permitted = {item.strip() for item in settings.cors_origins.split(",")}
        if origin and origin not in same_origin | permitted:
            return JSONResponse({"detail": "跨站请求已拒绝"}, status_code=403)
    return await call_next(request)

app.include_router(health.router)
app.include_router(auth.router, prefix=settings.api_prefix)
app.include_router(admin.router, prefix=settings.api_prefix)
app.include_router(billing.router, prefix=settings.api_prefix)
for protected_router in (tts.router, llm.router, live.router, live_rooms.router,
                         live_library.router, platform_connections.router, live_runs.router, resources.router):
    app.include_router(protected_router, prefix=settings.api_prefix, dependencies=[Depends(require_user)])
app.include_router(platform_events.router, prefix=settings.api_prefix)


@app.get("/")
async def root() -> dict:
    return {"service": settings.app_name, "version": "0.1.0", "docs": "/docs", "health": "/health"}
