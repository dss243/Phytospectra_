import logging
import uuid
from datetime import datetime, timezone

from core.connection_manager import manager
from services.calibration import extract_gps_from_exif
from services import supabase_service

logger = logging.getLogger(__name__)


async def process_image(
    image_path: str,
    user_id: str,
    image_id: str,
    field_id: str = None,
    flight_id: str = None,
    drone_id: str = None,
    *,
    persist: bool = True,
) -> dict:
    """
    Manual upload / analyze pipeline — ViT only (vit_ndvi_leaf_health.pt).
    No NDVI heatmap generation or upload.
    """
    import os

    logger.info("ViT analyze: %s", image_path)

    if not os.path.exists(image_path):
        raise ValueError(f"Image not found: {image_path}")
    if os.path.getsize(image_path) == 0:
        raise ValueError("Image file is empty")

    from services.inference import predict_rgn

    try:
        prediction = predict_rgn(image_path)
    except Exception as e:
        logger.exception("ViT inference failed")
        raise RuntimeError(f"ViT model (vit_ndvi_leaf_health.pt) failed: {e}") from e

    final_class = prediction["stress_class"]
    confidence = prediction["confidence"]
    health_score = float(prediction["health_score"])
    health_pct = round(health_score, 2)

    gps = extract_gps_from_exif(image_path)

    seg_record = {
        "user_id":              user_id,
        "image_id":             image_id,
        "field_id":             field_id,
        "flight_id":            flight_id,
        "drone_id":             drone_id,
        "heatmap_url":          None,
        "ndvi_mean":            None,
        "gndvi_mean":           None,
        "health_score":         round(health_score, 4),
        "stress_class":         final_class,
        "confidence":           round(float(confidence), 4),
        "healthy_pixel_count":  None,
        "stressed_pixel_count": None,
        "health_percentage":    health_pct,
        "gps":                  gps,
    }

    segmentation_id = str(uuid.uuid4())
    offline = not persist

    if persist:
        try:
            saved_seg = await supabase_service.save_segmentation(seg_record)
            segmentation_id = saved_seg.get("id") or segmentation_id
        except Exception as e:
            logger.warning("Could not save segmentation (%s) — returning local result", e)
            offline = True

    broadcast_payload = {
        **seg_record,
        "segmentation_id": segmentation_id,
        "timestamp":       datetime.now(timezone.utc).isoformat(),
        "heatmap_data_url": None,
        "offline":         offline,
        "model":           "vit_ndvi_leaf_health.pt",
    }

    if persist and not offline:
        try:
            await manager.broadcast(broadcast_payload)
        except Exception as e:
            logger.warning("Broadcast failed (non-fatal): %s", e)

    logger.info(
        "ViT done | stress=%s | health=%.1f%% | confidence=%.2f",
        final_class,
        health_score,
        confidence,
    )

    return broadcast_payload
