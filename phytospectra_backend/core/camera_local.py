"""Direct MAPIR camera access on the field laptop."""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional

import httpx

from core.camera_net import camera_http_client
from core.config import settings

CAMERA_BASE = settings.CAMERA_IP.rstrip("/")
PROBE_PATHS = ["/", "/get_params.cgi?param=camera_clock", "/DCIM/PHOTO"]


async def probe_camera_path(client: httpx.AsyncClient, path: str) -> Optional[Dict[str, Any]]:
    r = await client.get(f"{CAMERA_BASE}{path}")
    if r.status_code < 500:
        return {
            "reachable": True,
            "status": r.status_code,
            "path": path,
            "camera_base": CAMERA_BASE,
        }
    return None


async def ping_local_camera() -> Dict[str, Any]:
    last_err: Optional[str] = None
    async with camera_http_client(timeout=6.0, follow_redirects=True) as client:
        tasks = [probe_camera_path(client, path) for path in PROBE_PATHS]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for path, result in zip(PROBE_PATHS, results):
            if isinstance(result, Exception):
                last_err = str(result)
            elif result:
                return result
    raise RuntimeError(last_err or "camera unreachable")
