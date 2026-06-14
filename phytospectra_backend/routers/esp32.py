"""
ESP32 device API — mission sync and image DB registration.

The farmer creates a flight in the app; the ESP32 polls GET /api/esp32/mission
using its device_id (drones.esp32_device_id), uploads to Supabase storage,
then POSTs /api/esp32/image-record (or upload-raw) so rows land in the images table.

Mission resolution:
  1. Find ALL drones with esp32_device_id == device_id
  2. Find the most recently CREATED flight (created_at desc) for that farmer,
     using any of their drone rows (one physical ESP32, many field labels)
  3. Return that flight's user_id / field_id / flight_id / drone_id / bucket
"""
import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, UploadFile, File, Form, Request
from pydantic import BaseModel

from core.config import settings
from services.supabase_service import get_supabase, save_image
from services.calibration import extract_gps_from_exif

logger = logging.getLogger(__name__)
router = APIRouter(tags=["ESP32"])

MIME_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff", ".tiff": "image/tiff",
}


def _verify_esp32_key(x_esp32_key: Optional[str]) -> None:
    expected = getattr(settings, "ESP32_DEVICE_KEY", None) or ""
    if not expected or x_esp32_key != expected:
        raise HTTPException(status_code=401, detail="Invalid or missing X-ESP32-Key")


def _get_client():
    client = get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")
    return client


def _fetch_latest_flight(client, user_id: str, drone_ids: list) -> Optional[dict]:
    """Newest flight by created_at across drone_ids (your spec)."""
    if not drone_ids:
        return None
    for order_col in ("created_at", "id"):
        try:
            res = (
                client.table("flights")
                .select("id, user_id, field_id, drone_id, created_at")
                .in_("drone_id", drone_ids)
                .eq("user_id", user_id)
                .order(order_col, desc=True)
                .limit(1)
                .execute()
            )
            if res.data:
                return res.data[0]
        except Exception as e:
            logger.warning("latest flight order %s failed: %s", order_col, e)
    return None


def _resolve_mission(device_id: str, flight_id_override: Optional[str] = None) -> dict:
    """
    All drones with this esp32_device_id → latest CREATED flight for that farmer.
    """
    client = _get_client()

    drone_res = (
        client.table("drones")
        .select("id, user_id, field_id, esp32_device_id, drone_name")
        .eq("esp32_device_id", device_id)
        .execute()
    )
    if not drone_res.data:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No drone registered for device_id '{device_id}'. "
                "Set esp32_device_id in the Drones page."
            ),
        )

    esp32_drones = drone_res.data
    user_id = esp32_drones[0]["user_id"]
    esp32_drone_ids = [d["id"] for d in esp32_drones]

    # Fallback: one physical ESP32, flights may use any field-label drone row.
    all_drone_res = (
        client.table("drones")
        .select("id")
        .eq("user_id", user_id)
        .execute()
    )
    all_drone_ids = [d["id"] for d in (all_drone_res.data or [])] or esp32_drone_ids

    flight = None

    if flight_id_override:
        locked = (
            client.table("flights")
            .select("id, user_id, field_id, drone_id, created_at")
            .eq("id", flight_id_override)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not locked.data:
            raise HTTPException(
                status_code=400,
                detail=f"flight_id '{flight_id_override}' not found for this account",
            )
        flight = locked.data[0]

    if not flight:
        flight = _fetch_latest_flight(client, user_id, esp32_drone_ids)
    if not flight:
        flight = _fetch_latest_flight(client, user_id, all_drone_ids)
    if not flight:
        raise HTTPException(
            status_code=404,
            detail="No flight found — create a flight in the app first.",
        )

    field_id = flight.get("field_id")
    if not field_id:
        raise HTTPException(status_code=404, detail="Flight has no field_id")
    drone_id = flight.get("drone_id") or esp32_drones[0]["id"]

    field_name = None
    try:
        field_res = (
            client.table("fields")
            .select("field_name")
            .eq("id", field_id)
            .limit(1)
            .execute()
        )
        if field_res.data:
            field_name = field_res.data[0].get("field_name")
    except Exception as e:
        logger.warning("field name lookup failed: %s", e)

    logger.info(
        "ESP32 mission device=%s user=%s flight=%s field=%s (%s) drone=%s created_at=%s",
        device_id,
        user_id,
        flight["id"],
        field_id,
        field_name,
        drone_id,
        flight.get("created_at"),
    )

    return {
        "user_id": user_id,
        "field_id": field_id,
        "field_name": field_name,
        "flight_id": flight["id"],
        "drone_id": drone_id,
        "created_at": flight.get("created_at"),
        "bucket": settings.SUPABASE_BUCKET_RAW,
    }


@router.get("/esp32/ping")
async def esp32_ping():
    """No auth — use from ESP32 to verify it can reach the backend on the LAN."""
    return {"status": "ok", "service": "phytospectra"}


@router.get("/esp32/mission")
async def get_active_mission(
    device_id: str = Query(..., description="Must match drones.esp32_device_id"),
    x_esp32_key: Optional[str] = Header(None, alias="X-ESP32-Key"),
):
    """
    Return the active mission context for this ESP32.
    Active = most recently created flight across drones linked to device_id.
    """
    _verify_esp32_key(x_esp32_key)
    mission = _resolve_mission(device_id)
    logger.info(
        "ESP32 mission device=%s drone=%s flight=%s field=%s",
        device_id,
        mission["drone_id"],
        mission["flight_id"],
        mission["field_id"],
    )
    return mission


class ImageRecordBody(BaseModel):
    device_id: str
    storage_path: str
    original_filename: Optional[str] = None
    flight_id: Optional[str] = None


@router.post("/esp32/image-record")
async def register_esp32_image(
    body: ImageRecordBody,
    x_esp32_key: Optional[str] = Header(None, alias="X-ESP32-Key"),
):
    """
    Register an image already uploaded to Supabase storage by the ESP32.
    storage_path must follow: {user_id}/{field_id}/{flight_id}/{filename}
    """
    _verify_esp32_key(x_esp32_key)
    mission = _resolve_mission(body.device_id, flight_id_override=body.flight_id)

    prefix = f"{mission['user_id']}/{mission['field_id']}/{mission['flight_id']}/"
    if not body.storage_path.startswith(prefix):
        raise HTTPException(
            status_code=400,
            detail=f"storage_path must start with {prefix}",
        )

    existing = (
        _get_client()
        .table("images")
        .select("id")
        .eq("storage_path", body.storage_path)
        .eq("user_id", mission["user_id"])
        .limit(1)
        .execute()
    )
    if existing.data:
        return {
            "status": "already_registered",
            "image_id": existing.data[0]["id"],
            "storage_path": body.storage_path,
        }

    image_row = await save_image({
        "user_id": mission["user_id"],
        "field_id": mission["field_id"],
        "flight_id": mission["flight_id"],
        "drone_id": mission["drone_id"],
        "storage_path": body.storage_path,
        "bucket_name": mission["bucket"],
        "gps": None,
        "gps_source": "MAPIR Survey3W EXIF",
        "upload_source": "esp32",
    })

    image_id = image_row.get("id")
    if not image_id:
        raise HTTPException(status_code=500, detail="Image record saved but no id returned")

    logger.info(
        "ESP32 image registered device=%s path=%s id=%s flight=%s",
        body.device_id,
        body.storage_path,
        image_id,
        mission["flight_id"],
    )
    return {
        "status": "registered",
        "image_id": image_id,
        "storage_path": body.storage_path,
        "flight_id": mission["flight_id"],
    }


@router.post("/esp32/upload")
async def esp32_upload_image(
    device_id: str = Form(...),
    file: UploadFile = File(...),
    original_filename: Optional[str] = Form(None),
    flight_id: Optional[str] = Form(None),
    x_esp32_key: Optional[str] = Header(None, alias="X-ESP32-Key"),
):
    """Upload image from ESP32 via LAN backend."""
    _verify_esp32_key(x_esp32_key)
    mission = _resolve_mission(device_id, flight_id_override=flight_id)

    name = original_filename or file.filename or "photo.jpg"
    ext = os.path.splitext(name)[1].lower() or ".jpg"
    if ext not in MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty file")

    storage_path = (
        f"{mission['user_id']}/{mission['field_id']}/{mission['flight_id']}/"
        f"{uuid.uuid4().hex}{ext}"
    )
    bucket = mission["bucket"]

    client = get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")

    try:
        client.storage.from_(bucket).upload(
            storage_path,
            contents,
            file_options={"content-type": MIME_TYPES[ext]},
        )
    except Exception as e:
        logger.error("ESP32 storage upload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")

    gps = None
    tmp = os.path.join(settings.OUTPUT_FOLDER, "tmp", f"esp32_{uuid.uuid4().hex}{ext}")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    try:
        with open(tmp, "wb") as handle:
            handle.write(contents)
        gps = extract_gps_from_exif(tmp)
    except Exception as e:
        logger.warning("GPS extraction failed (non-fatal): %s", e)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    image_row = await save_image({
        "user_id": mission["user_id"],
        "field_id": mission["field_id"],
        "flight_id": mission["flight_id"],
        "drone_id": mission["drone_id"],
        "storage_path": storage_path,
        "bucket_name": bucket,
        "gps": gps,
        "gps_source": "MAPIR Survey3W EXIF",
        "upload_source": "esp32",
    })

    image_id = image_row.get("id")
    logger.info("ESP32 upload device=%s path=%s id=%s", device_id, storage_path, image_id)
    return {
        "status": "uploaded",
        "image_id": image_id,
        "storage_path": storage_path,
        "flight_id": mission["flight_id"],
        "gps": gps,
    }


@router.post("/esp32/upload-raw")
async def esp32_upload_image_raw(
    request: Request,
    device_id: str = Query(...),
    flight_id: Optional[str] = Query(None, description="Mission flight_id from GET /esp32/mission"),
    original_filename: Optional[str] = Query("photo.jpg"),
    x_esp32_key: Optional[str] = Header(None, alias="X-ESP32-Key"),
):
    """
    ESP32-friendly upload: raw JPEG body + query params (no multipart).
    Pass flight_id from mission sync so the whole batch stays on one flight.
    """
    _verify_esp32_key(x_esp32_key)
    mission = _resolve_mission(device_id, flight_id_override=flight_id)

    name = original_filename or "photo.jpg"
    ext = os.path.splitext(name)[1].lower() or ".jpg"
    if ext not in MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext}")

    contents = await request.body()
    if not contents:
        raise HTTPException(status_code=400, detail="Empty body")

    storage_path = (
        f"{mission['user_id']}/{mission['field_id']}/{mission['flight_id']}/"
        f"{uuid.uuid4().hex}{ext}"
    )
    bucket = mission["bucket"]

    client = get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")

    try:
        client.storage.from_(bucket).upload(
            storage_path,
            contents,
            file_options={"content-type": MIME_TYPES[ext]},
        )
    except Exception as e:
        logger.error("ESP32 storage upload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Storage upload failed: {e}")

    gps = None
    tmp = os.path.join(settings.OUTPUT_FOLDER, "tmp", f"esp32_{uuid.uuid4().hex}{ext}")
    os.makedirs(os.path.dirname(tmp), exist_ok=True)
    try:
        with open(tmp, "wb") as handle:
            handle.write(contents)
        gps = extract_gps_from_exif(tmp)
    except Exception as e:
        logger.warning("GPS extraction failed (non-fatal): %s", e)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)

    image_row = await save_image({
        "user_id": mission["user_id"],
        "field_id": mission["field_id"],
        "flight_id": mission["flight_id"],
        "drone_id": mission["drone_id"],
        "storage_path": storage_path,
        "bucket_name": bucket,
        "gps": gps,
        "gps_source": "MAPIR Survey3W EXIF",
        "upload_source": "esp32",
    })

    image_id = image_row.get("id")
    logger.info(
        "ESP32 raw upload device=%s flight=%s field=%s path=%s id=%s",
        device_id,
        mission["flight_id"],
        mission["field_id"],
        storage_path,
        image_id,
    )
    return {
        "status": "uploaded",
        "image_id": image_id,
        "storage_path": storage_path,
        "flight_id": mission["flight_id"],
        "gps": gps,
    }
