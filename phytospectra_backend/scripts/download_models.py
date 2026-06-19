"""Download ML weights from Supabase Storage when missing locally (cloud deploy)."""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core.config import settings  # noqa: E402
from services.supabase_service import get_supabase  # noqa: E402

logger = logging.getLogger(__name__)

MODELS = (
    "vit_ndvi_leaf_health.pt",
    "segformer_b0_boxfill.pt",
)


def _dest(name: str) -> Path:
    return ROOT / "models" / name


def _storage_path(name: str) -> str:
    prefix = settings.MODELS_STORAGE_PREFIX.strip("/")
    return f"{prefix}/{name}" if prefix else name


def _needs_download(path: Path, min_bytes: int = 1_000_000) -> bool:
    return not path.is_file() or path.stat().st_size < min_bytes


def download_models() -> None:
    models_dir = ROOT / "models"
    models_dir.mkdir(parents=True, exist_ok=True)

    pending = [n for n in MODELS if _needs_download(_dest(n))]
    if not pending:
        logger.info("Model weights already present in %s", models_dir)
        return

    client = get_supabase()
    if not client:
        logger.warning(
            "Supabase not configured — skipping model download. "
            "Mount models/ or set SUPABASE_URL + SUPABASE_KEY."
        )
        return

    bucket = settings.MODELS_BUCKET
    logger.info(
        "Downloading %s model(s) from bucket %s …",
        len(pending),
        bucket,
    )

    for name in pending:
        storage_path = _storage_path(name)
        dest = _dest(name)
        try:
            data = client.storage.from_(bucket).download(storage_path)
            if not data or len(data) < 1_000_000:
                raise RuntimeError(f"download too small ({len(data or b'')} bytes)")
            dest.write_bytes(data)
            logger.info("Saved %s (%d bytes)", dest.name, len(data))
        except Exception as e:
            logger.error(
                "Failed to download %s from %s/%s: %s",
                name,
                bucket,
                storage_path,
                e,
            )
            raise


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
    download_models()
