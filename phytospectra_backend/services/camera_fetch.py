import base64
import logging
import os

import httpx

from core.camera_bridge import bridge_base_url, bridge_request_headers, field_relay_available, remote_camera_bridge_enabled
from core.camera_net import camera_http_client
from core.field_bridge_ws import field_ws_camera_proxy
from core.config import settings

logger = logging.getLogger(__name__)

CAMERA_PHOTO_DIR = "/DCIM/PHOTO"


def camera_base_url() -> str:
    base = getattr(settings, "CAMERA_IP", "http://192.168.1.254")
    return str(base).rstrip("/")


async def download_camera_photo(filename: str, dest_path: str, photo_dir: str = CAMERA_PHOTO_DIR) -> None:
    """Fetch a photo from the MAPIR camera (local) or field PC bridge (remote)."""
    safe_name = os.path.basename(filename)
    proxy_path = f"{photo_dir.lstrip('/')}/{safe_name}"
    content: bytes

    if field_relay_available() and not settings.CAMERA_BRIDGE_ONLY:
        if remote_camera_bridge_enabled():
            url = f"{bridge_base_url()}/api/camera/proxy/{proxy_path}"
            logger.info("Fetching camera photo via field bridge HTTP: %s", url)
            async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
                response = await client.get(url, headers=bridge_request_headers())
            response.raise_for_status()
            content = response.content
        else:
            logger.info("Fetching camera photo via field bridge WebSocket: %s", proxy_path)
            msg = await field_ws_camera_proxy("GET", proxy_path)
            if msg.get("error"):
                raise RuntimeError(str(msg["error"]))
            status = int(msg.get("status") or 0)
            content = base64.b64decode(msg.get("body_b64") or "")
            if status >= 400:
                raise RuntimeError(f"Camera photo HTTP {status}")
    else:
        url = f"{camera_base_url()}{photo_dir}/{safe_name}"
        logger.info("Fetching camera photo: %s", url)
        async with camera_http_client(timeout=90.0, follow_redirects=True) as client:
            response = await client.get(url)
        response.raise_for_status()
        content = response.content

    if not content:
        raise ValueError("Camera returned an empty file")

    with open(dest_path, "wb") as handle:
        handle.write(content)

    logger.info("Saved camera photo to %s (%d bytes)", dest_path, len(content))
