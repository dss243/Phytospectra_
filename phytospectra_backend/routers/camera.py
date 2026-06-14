import logging
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response

from core.auth import get_current_user
from core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Camera"])

CAMERA_BASE = getattr(settings, "CAMERA_IP", "http://192.168.1.254").rstrip("/")
PROBE_PATHS = ["/", "/get_params.cgi?param=camera_clock", "/gp/gpControl"]


@router.get("/camera/ping")
async def camera_ping(user=Depends(get_current_user)):
    """Check whether the MAPIR camera is reachable from this machine."""
    last_err: Optional[str] = None
    async with httpx.AsyncClient(timeout=5.0) as client:
        for path in PROBE_PATHS:
            try:
                r = await client.get(f"{CAMERA_BASE}{path}")
                if r.status_code < 500:
                    return {"reachable": True, "status": r.status_code, "path": path}
            except Exception as e:
                last_err = str(e)
                logger.debug("Camera probe %s failed: %s", path, e)

    raise HTTPException(
        status_code=503,
        detail=f"Camera not reachable at {CAMERA_BASE}. Join the MAPIR WiFi on this PC first. ({last_err})",
    )


@router.api_route("/camera/proxy/{path:path}", methods=["GET", "POST", "PUT"])
async def camera_proxy(path: str, request: Request, user=Depends(get_current_user)):
    """Forward requests to the camera on the local WiFi hotspot (no browser CORS)."""
    url = f"{CAMERA_BASE}/{path.lstrip('/')}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    body = await request.body()
    headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length", "connection")
    }

    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            r = await client.request(request.method, url, content=body or None, headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Camera request timed out")
    except Exception as e:
        logger.error("Camera proxy error: %s", e, exc_info=True)
        raise HTTPException(status_code=502, detail=f"Camera proxy failed: {e}")

    skip = {"transfer-encoding", "connection", "content-encoding"}
    resp_headers = {k: v for k, v in r.headers.items() if k.lower() not in skip}
    return Response(content=r.content, status_code=r.status_code, headers=resp_headers)
