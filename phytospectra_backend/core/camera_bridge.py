"""PC1 (home server) → any registered field PC camera relay."""

from __future__ import annotations

from typing import Dict, Optional

import httpx
from fastapi import HTTPException, Request

from core.camera_bridge_registry import bridge_status, registered_bridge_url
from core.config import settings

BRIDGE_KEY_HEADER = "x-camera-bridge-key"


def remote_camera_bridge_enabled() -> bool:
    status = bridge_status()
    return bool(status.get("effective_bridge_url"))


def field_relay_available() -> bool:
    from core.field_bridge_ws import field_ws_connected

    return field_ws_connected() or remote_camera_bridge_enabled()


def bridge_base_url() -> str:
    status = bridge_status()
    url = status.get("effective_bridge_url") or ""
    return str(url).rstrip("/")


def bridge_request_headers(
    authorization: Optional[str] = None,
    extra: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    headers: Dict[str, str] = {}
    if settings.CAMERA_BRIDGE_KEY:
        headers[BRIDGE_KEY_HEADER] = settings.CAMERA_BRIDGE_KEY
    elif authorization:
        headers["Authorization"] = authorization
    base = bridge_base_url()
    if "ngrok" in base:
        headers["ngrok-skip-browser-warning"] = "true"
    if extra:
        for k, v in extra.items():
            lower = k.lower()
            if lower in ("host", "authorization", "content-length", "connection", BRIDGE_KEY_HEADER):
                continue
            headers[k] = v
    return headers


def authorization_from_request(request: Request) -> Optional[str]:
    auth = request.headers.get("authorization")
    return auth if auth else None


def _no_bridge_configured() -> HTTPException:
    return HTTPException(
        status_code=503,
        detail=(
            "No user PC connected. One-time install on that PC: "
            "Install-Phytospectra-Camera.bat (or scripts/install_user_pc_bridge.ps1). "
            "Then MAPIR Wi-Fi + USB internet — no scripts for the farmer after install."
        ),
    )


async def forward_bridge_get(
    path: str,
    authorization: Optional[str] = None,
    timeout: float = 30.0,
) -> httpx.Response:
    base = bridge_base_url()
    if not base:
        raise _no_bridge_configured()
    url = f"{base}{path}"
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        return await client.get(url, headers=bridge_request_headers(authorization))


async def forward_bridge_request(
    method: str,
    path: str,
    request: Request,
    body: bytes,
    timeout: float = 60.0,
) -> httpx.Response:
    base = bridge_base_url()
    if not base:
        raise _no_bridge_configured()
    url = f"{base}{path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"
    forward_headers = {
        k: v
        for k, v in request.headers.items()
        if k.lower() not in ("host", "authorization", "content-length", "connection", BRIDGE_KEY_HEADER)
    }
    headers = bridge_request_headers(extra=forward_headers)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        return await client.request(method, url, content=body or None, headers=headers)


def bridge_error_detail(response: httpx.Response) -> str:
    try:
        data = response.json()
        if isinstance(data, dict) and data.get("detail"):
            return str(data["detail"])
    except Exception:
        pass
    text = response.text.strip()
    return text or f"Field PC bridge returned HTTP {response.status_code}"
