from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import os
import uuid
import logging
import shutil
from typing import Optional

from core.auth import get_current_user
from services import supabase_service
from services.pipeline import process_image
from services.calibration import extract_gps_from_exif
from core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Analyze"])

LOCAL_BUCKET = "local"


class AnalyzeRequest(BaseModel):
    object_path: str
    bucket:      Optional[str] = None
    field_id:    Optional[str] = None
    flight_id:   Optional[str] = None
    drone_id:    Optional[str] = None


class AnalyzeRunRequest(BaseModel):
    """Run ViT on an image already uploaded via POST /api/upload."""
    object_path: str
    bucket:      Optional[str] = None
    field_id:    Optional[str] = None
    flight_id:   Optional[str] = None
    image_id:    Optional[str] = None


def _result_payload(result: dict, *, field_id: str | None, object_path: str, bucket: str, image_id: str | None) -> dict:
    client = supabase_service.get_supabase()
    drone_image_url = None
    if client and bucket != LOCAL_BUCKET:
        try:
            drone_image_url = client.storage.from_(bucket).get_public_url(object_path)
        except Exception:
            pass

    return {
        "type":            "result",
        "status":          "success",
        "zone_id":         result.get("segmentation_id") or field_id or "unknown",
        "timestamp":       result.get("timestamp"),
        "gps":             result.get("gps"),
        "health_score":    result.get("health_score"),
        "stress_class":    result.get("stress_class"),
        "confidence":      result.get("confidence"),
        "heatmap_url":     result.get("heatmap_url"),
        "heatmap_data_url": result.get("heatmap_data_url"),
        "offline":         result.get("offline", False),
        "storage_path":    object_path,
        "bucket":          bucket,
        "image_id":        image_id,
        "drone_image_url": drone_image_url,
        "model":           result.get("model"),
    }


async def _prepare_image_tmp(object_path: str, bucket: str, tmp_path: str) -> None:
    if bucket == LOCAL_BUCKET:
        local_path = os.path.join(
            settings.OUTPUT_FOLDER, "local_uploads", object_path.replace("/", os.sep)
        )
        if not os.path.isfile(local_path) or os.path.getsize(local_path) == 0:
            raise HTTPException(status_code=404, detail="Local upload file not found")
        shutil.copy2(local_path, tmp_path)
        return

    await supabase_service.download_image(object_path, bucket, tmp_path)
    if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
        raise HTTPException(status_code=500, detail="Download failed or empty file")


@router.post("/analyze/run")
async def analyze_run(body: AnalyzeRunRequest, user=Depends(get_current_user)):
    """
    ViT classification for manual upload — image already stored via POST /api/upload.
    Prefer this over WebSocket for browser manual uploads (more reliable).
    """
    user_id = user["sub"]
    bucket = body.bucket or settings.SUPABASE_BUCKET_RAW

    tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    ext = os.path.splitext(body.object_path)[1].lower() or ".png"
    tmp_path = os.path.join(tmp_dir, f"run_{uuid.uuid4().hex}{ext}")

    image_id = body.image_id
    persist = bool(image_id)
    if not image_id:
        image_id = str(uuid.uuid4())

    try:
        await _prepare_image_tmp(body.object_path, bucket, tmp_path)

        try:
            result = await process_image(
                image_path=tmp_path,
                user_id=user_id,
                image_id=image_id,
                field_id=body.field_id,
                flight_id=body.flight_id,
                persist=persist,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e

        return _result_payload(
            result,
            field_id=body.field_id,
            object_path=body.object_path,
            bucket=bucket,
            image_id=body.image_id or image_id,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("analyze_run failed")
        raise HTTPException(status_code=500, detail=str(e)) from e
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


@router.post("/analyze/from-storage")
async def analyze_from_storage(
    body: AnalyzeRequest,
    user=Depends(get_current_user),
):
    user_id = user["sub"]
    bucket  = body.bucket or settings.SUPABASE_BUCKET_RAW

    tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)
    ext      = os.path.splitext(body.object_path)[1].lower() or ".png"
    tmp_path = os.path.join(tmp_dir, f"input_{uuid.uuid4().hex}{ext}")

    try:
        await _prepare_image_tmp(body.object_path, bucket, tmp_path)

        gps = extract_gps_from_exif(tmp_path)

        try:
            image_row = await supabase_service.save_image({
                "user_id":       user_id,
                "field_id":      body.field_id,
                "flight_id":     body.flight_id,
                "drone_id":      body.drone_id,
                "storage_path":  body.object_path,
                "bucket_name":   bucket,
                "gps":           gps,
                "gps_source":    "MAPIR Survey3W EXIF",
                "upload_source": "manual",
            })
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Image record save failed: {str(e)}")

        image_id = image_row.get("id")
        if not image_id:
            raise HTTPException(status_code=500, detail="Image saved but no ID returned")

        try:
            result = await process_image(
                image_path=tmp_path,
                user_id=user_id,
                image_id=image_id,
                field_id=body.field_id,
                flight_id=body.flight_id,
                drone_id=body.drone_id,
            )
        except RuntimeError as e:
            raise HTTPException(status_code=503, detail=str(e)) from e

        return {"status": "success", **result}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("analyze_from_storage failed")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
