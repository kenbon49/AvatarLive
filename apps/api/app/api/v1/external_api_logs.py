from typing import Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from ...security.accounts import require_admin
from ...services.external_api_logs import list_logs

router = APIRouter(prefix="/admin/external-api-logs", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("")
def logs(provider: str = Query(default="", max_length=60), status: Literal["", "success", "error"] = "",
         q: str = Query(default="", max_length=120), before: str = Query(default="", max_length=100),
         limit: int = Query(default=51, ge=1, le=101)):
    return JSONResponse({"items": list_logs(provider=provider, status=status, q=q, before=before, limit=limit)},
                        headers={"cache-control": "private, no-store"})
