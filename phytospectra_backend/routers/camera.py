import asyncio
import logging
import socket
from typing import Dict, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket
from fastapi.responses import Response
from fastapi.security import HTTPAuthorizationCredentials
from pydantic import BaseModel, Field

from core.auth import optional_security, verify_token
from core.camera_bridge import (
    authorization_from_request,
    bridge_base_url,
    bridge_error_detail,
    bridge_request_headers,
    forward_bridge_get,
    forward_bridge_request,
    remote_camera_bridge_enabled,
)
from core.camera_bridge_registry import bridge_status, clear_field_bridge, register_field_bridge
from core.camera_local import PROBE_PATHS, ping_local_camera, probe_camera_path
from core.field_bridge_ws import accept_field_bridge_ws, field_ws_camera_ping, field_ws_camera_proxy, field_ws_connected, field_ws_status
from core.camera_net import (
    camera_bind_diagnostics,
    camera_host_from_url,
    camera_http_client,
    camera_unreachable_detail,
    camera_subnet_prefix,
    list_local_ipv4,
)
from core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Camera"])

CAMERA_BASE = settings.CAMERA_IP.rstrip("/")
PROBE_PATHS = ["/", "/get_params.cgi?param=camera_clock", "/DCIM/PHOTO"]
BRIDGE_KEY_HEADER = "x-camera-bridge-key"


class BridgeRegisterBody(BaseModel):
    bridge_url: str = Field(..., description="https ngrok URL of the field laptop")
    field_hostname: Optional[str] = None


def _local_on_camera_subnet() -> bool:
    prefix = camera_subnet_prefix(camera_host_from_url(settings.CAMERA_IP))
    if not prefix:
        return False
    return any(ip.startswith(prefix) for ip in list_local_ipv4())


def _bridge_required_message() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=(
            "No user PC connected. Install once: Install-Phytospectra-Camera.bat "
            "(or scripts/install_user_pc_bridge.ps1), then MAPIR Wi-Fi + USB internet."
        ),
    )


def _field_relay_available() -> bool:
    return field_ws_connected() or remote_camera_bridge_enabled()


async def _relay_camera_ping(request: Request) -> Dict:
    if field_ws_connected():
        try:
            return await field_ws_camera_ping()
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Field laptop camera check timed out")
        except ConnectionError:
            raise _bridge_required_message()
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e))

    if remote_camera_bridge_enabled():
        try:
            r = await forward_bridge_get(
                "/api/camera/ping",
                authorization=authorization_from_request(request),
                timeout=25.0,
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Field PC camera bridge timed out")
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Cannot reach field PC bridge at {bridge_base_url()}: {e}",
            )
        if r.is_success:
            return r.json()
        if r.status_code == 401:
            raise HTTPException(
                status_code=401,
                detail="Field PC bridge auth failed — check CAMERA_BRIDGE_KEY on both PCs.",
            )
        if r.status_code == 503:
            raise HTTPException(
                status_code=503,
                detail=f"Field laptop reached but camera failed: {bridge_error_detail(r)}",
            )
        raise HTTPException(status_code=r.status_code, detail=bridge_error_detail(r))

    raise _bridge_required_message()


async def resolve_bridge_registrar(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
) -> Dict:
    """Farmer JWT or shared bridge key — for registering any field laptop."""
    return await resolve_camera_user(request, creds)


async def resolve_camera_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
) -> Dict:
    """JWT from browser, bridge key from home server (PC1), or loopback for local tests."""
    bridge_key = request.headers.get(BRIDGE_KEY_HEADER)
    if bridge_key and settings.CAMERA_BRIDGE_KEY and bridge_key == settings.CAMERA_BRIDGE_KEY:
        return {"sub": "camera-bridge", "role": "farmer"}

    if creds and creds.credentials:
        return await verify_token(creds.credentials)

    host = (request.client.host if request.client else "") or ""
    if host in ("127.0.0.1", "::1"):
        return {"sub": "local-bridge", "role": "farmer"}

    raise HTTPException(
        status_code=401,
        detail="Log in on phytospectra.vercel.app, then tap Detect camera again.",
    )


async def _probe_camera_path(client: httpx.AsyncClient, path: str):
    return await probe_camera_path(client, path)


async def _ping_local_camera():
    try:
        return await ping_local_camera()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=camera_unreachable_detail(str(e)))


@router.websocket("/camera/bridge/ws")
async def camera_bridge_websocket(websocket: WebSocket):
    await accept_field_bridge_ws(websocket)


@router.get("/camera/bridge/status")
async def get_field_bridge_status(user: Dict = Depends(resolve_camera_user)):
    """Field laptop connection status (WebSocket preferred)."""
    status = bridge_status()
    status.update(field_ws_status())
    return status


@router.post("/camera/bridge/register")
async def register_field_bridge_endpoint(
    body: BridgeRegisterBody,
    user: Dict = Depends(resolve_bridge_registrar),
):
    """Register any field laptop ngrok URL (from the app on that laptop)."""
    try:
        info = register_field_bridge(
            body.bridge_url,
            registered_by=str(user.get("sub", "")),
            field_hostname=body.field_hostname or socket.gethostname(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Quick health check on the field bridge
    try:
        async with httpx.AsyncClient(timeout=12.0, follow_redirects=True) as client:
            r = await client.get(
                f"{info['effective_bridge_url']}/api/health",
                headers=bridge_request_headers(),
            )
        if not r.is_success:
            clear_field_bridge()
            raise HTTPException(
                status_code=502,
                detail=f"Field bridge unreachable at {body.bridge_url} (HTTP {r.status_code})",
            )
    except httpx.RequestError as e:
        clear_field_bridge()
        raise HTTPException(status_code=502, detail=f"Field bridge unreachable: {e}")

    logger.info("Field bridge registered: %s by %s", info["effective_bridge_url"], user.get("sub"))
    return info


@router.delete("/camera/bridge/register")
async def unregister_field_bridge(user: Dict = Depends(resolve_bridge_registrar)):
    clear_field_bridge()
    return {"ok": True}


@router.get("/camera/diagnostics")
async def camera_diagnostics(user: Dict = Depends(resolve_camera_user)):
    """Debug network setup on this machine (or field bridge when called remotely)."""
    diag = camera_bind_diagnostics()
    status = bridge_status()
    if remote_camera_bridge_enabled():
        diag["mode"] = "home_server_relay"
        diag["bridge"] = status
    elif settings.CAMERA_BRIDGE_ONLY:
        diag["mode"] = "field_bridge"
    else:
        diag["mode"] = "local_camera"
    return diag


@router.get("/camera/ping")
async def camera_ping(request: Request, user: Dict = Depends(resolve_camera_user)):
    """Check whether the MAPIR camera is reachable (locally or via field PC bridge)."""
    if _field_relay_available():
        return await _relay_camera_ping(request)

    if settings.CAMERA_BRIDGE_ONLY or _local_on_camera_subnet():
        return await _ping_local_camera()

    full = {**bridge_status(), **field_ws_status()}
    logger.warning(
        "Camera ping 503: no field laptop WebSocket (websocket_connected=%s, status=%s)",
        full.get("websocket_connected"),
        full,
    )
    raise _bridge_required_message()


@router.api_route("/camera/proxy/{path:path}", methods=["GET", "POST", "PUT"])
async def camera_proxy(
    path: str,
    request: Request,
    user: Dict = Depends(resolve_camera_user),
):
    """Forward requests to the camera (local) or to the field PC bridge (remote)."""
    import base64

    if field_ws_connected():
        body = await request.body()
        fwd_headers = {
            k: v
            for k, v in request.headers.items()
            if k.lower() not in ("host", "authorization", "content-length", "connection")
        }
        try:
            msg = await field_ws_camera_proxy(
                request.method,
                path,
                query=request.url.query or "",
                body=body,
                headers=fwd_headers,
            )
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Field PC camera bridge timed out")
        except ConnectionError:
            raise _bridge_required_message()
        if msg.get("error"):
            raise HTTPException(status_code=502, detail=str(msg["error"]))
        content = base64.b64decode(msg.get("body_b64") or "")
        skip = {"transfer-encoding", "connection", "content-encoding"}
        resp_headers = {k: v for k, v in (msg.get("headers") or {}).items() if k.lower() not in skip}
        return Response(content=content, status_code=int(msg.get("status") or 502), headers=resp_headers)

    if remote_camera_bridge_enabled():
        body = await request.body()
        try:
            r = await forward_bridge_request(
                request.method,
                f"/api/camera/proxy/{path}",
                request,
                body,
                timeout=90.0,
            )
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="Field PC camera bridge timed out")
        except httpx.RequestError as e:
            raise HTTPException(
                status_code=502,
                detail=f"Field PC bridge error: {e}",
            )
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=bridge_error_detail(r))
        skip = {"transfer-encoding", "connection", "content-encoding"}
        resp_headers = {k: v for k, v in r.headers.items() if k.lower() not in skip}
        return Response(content=r.content, status_code=r.status_code, headers=resp_headers)

    if not settings.CAMERA_BRIDGE_ONLY and not _local_on_camera_subnet():
        raise _bridge_required_message()

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
        async with camera_http_client(timeout=45.0, follow_redirects=True) as client:
            r = await client.request(request.method, url, content=body or None, headers=headers)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Camera request timed out")
    except Exception as e:
        logger.error("Camera proxy error: %s", e, exc_info=True)
        raise HTTPException(
            status_code=502,
            detail=camera_unreachable_detail(str(e)),
        )

    skip = {"transfer-encoding", "connection", "content-encoding"}
    resp_headers = {k: v for k, v in r.headers.items() if k.lower() not in skip}
    return Response(content=r.content, status_code=r.status_code, headers=resp_headers)
