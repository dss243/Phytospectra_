import logging
import os

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

CAMERA_PHOTO_DIR = "/DCIM/PHOTO"


def camera_base_url() -> str:
    base = getattr(settings, "CAMERA_IP", "http://192.168.1.254")
    return str(base).rstrip("/")


async def download_camera_photo(filename: str, dest_path: str, photo_dir: str = CAMERA_PHOTO_DIR) -> None:
    """Fetch a photo from the MAPIR camera (PC must be on the camera Wi‑Fi)."""
    safe_name = os.path.basename(filename)
    url = f"{camera_base_url()}{photo_dir}/{safe_name}"
    logger.info("Fetching camera photo: %s", url)

    async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
        response = await client.get(url)
        response.raise_for_status()
        content = response.content

    if not content:
        raise ValueError("Camera returned an empty file")

    with open(dest_path, "wb") as handle:
        handle.write(content)

    logger.info("Saved camera photo to %s (%d bytes)", dest_path, len(content))
