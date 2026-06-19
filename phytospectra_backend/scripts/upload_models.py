"""One-time upload of local .pt weights to Supabase for cloud backend startup."""

from __future__ import annotations

import logging
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


def _storage_path(name: str) -> str:
    prefix = settings.MODELS_STORAGE_PREFIX.strip("/")
    return f"{prefix}/{name}" if prefix else name


def upload_models() -> None:
    client = get_supabase()
    if not client:
        raise SystemExit("Set SUPABASE_URL and SUPABASE_KEY (service role) in .env")

    bucket = settings.MODELS_BUCKET
    for name in MODELS:
        local = ROOT / "models" / name
        if not local.is_file():
            raise SystemExit(f"Missing local file: {local}")

        storage_path = _storage_path(name)
        data = local.read_bytes()
        logger.info("Uploading %s → %s/%s (%d bytes)", local, bucket, storage_path, len(data))
        client.storage.from_(bucket).upload(
            storage_path,
            data,
            file_options={"content-type": "application/octet-stream", "upsert": "true"},
        )
        logger.info("OK %s", storage_path)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
    upload_models()
