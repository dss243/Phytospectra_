from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from core.connection_manager import manager
from core.auth import verify_websocket_token
from services import supabase_service
from core.config import settings
from services.pipeline import process_image
from services.calibration import extract_gps_from_exif
from services.camera_fetch import download_camera_photo, CAMERA_PHOTO_DIR
import os
import uuid
import logging
import shutil
import base64

from routers.uploads import LOCAL_BUCKET

logger = logging.getLogger(__name__)
router = APIRouter()

MIME_TYPES = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff", ".tiff": "image/tiff",
}


async def _run_analyze_and_respond(
    websocket: WebSocket,
    *,
    tmp_path: str,
    user_id: str,
    object_path: str,
    bucket: str,
    field_id,
    flight_id,
    drone_id,
    image_id,
    upload_source: str,
) -> None:
    persist = True

    if not image_id:
        await websocket.send_json({"type": "progress", "message": "Saving image record…"})
        gps = extract_gps_from_exif(tmp_path)
        try:
            image_row = await supabase_service.save_image({
                "user_id":       user_id,
                "field_id":      field_id,
                "flight_id":     flight_id,
                "drone_id":      drone_id,
                "storage_path":  object_path,
                "bucket_name":   bucket,
                "gps":           gps,
                "gps_source":    "MAPIR Survey3W EXIF",
                "upload_source": upload_source,
            })
            image_id = image_row.get("id")
        except Exception as save_err:
            logger.warning("Image record save failed (%s) — analyzing without cloud DB row", save_err)
            image_id = str(uuid.uuid4())
            persist = False

    if not image_id:
        image_id = str(uuid.uuid4())
        persist = False

    await websocket.send_json({"type": "progress", "message": "Running ViT (vit_ndvi_leaf_health.pt)…"})

    result = await process_image(
        image_path=tmp_path,
        user_id=user_id,
        image_id=image_id,
        field_id=field_id,
        flight_id=flight_id,
        drone_id=drone_id,
        persist=persist,
    )

    client = supabase_service.get_supabase()
    drone_image_url = None
    if client:
        drone_image_url = client.storage.from_(bucket).get_public_url(object_path)

    await websocket.send_json({
        "type":            "result",
        "zone_id":         result.get("segmentation_id") or field_id or "unknown",
        "timestamp":       result.get("timestamp"),
        "gps":             result.get("gps"),
        "health_score":    result.get("health_score"),
        "stress_class":    result.get("stress_class"),
        "confidence":      result.get("confidence"),
        "heatmap_url":     result.get("heatmap_url"),
        "heatmap_data_url": result.get("heatmap_data_url"),
        "offline":         result.get("offline", False),
        "drone_image_url": drone_image_url,
        "storage_path":    object_path,
        "bucket":          bucket,
        "image_id":        image_id,
    })


async def _run_offline_camera_analyze(
    websocket: WebSocket,
    *,
    tmp_path: str,
    user_id: str,
    field_id,
    flight_id,
    drone_id,
) -> None:
    """Analyze on camera Wi‑Fi with no internet — no Supabase calls."""
    image_id = str(uuid.uuid4())
    await websocket.send_json({
        "type": "progress",
        "message": "No internet — running analysis locally on this PC…",
    })
    await websocket.send_json({"type": "progress", "message": "Running ViT (vit_ndvi_leaf_health.pt)…"})

    result = await process_image(
        image_path=tmp_path,
        user_id=user_id,
        image_id=image_id,
        field_id=field_id,
        flight_id=flight_id,
        drone_id=drone_id,
        persist=False,
    )

    await websocket.send_json({
        "type":             "result",
        "zone_id":          result.get("segmentation_id") or field_id or "unknown",
        "timestamp":        result.get("timestamp"),
        "gps":              result.get("gps"),
        "health_score":     result.get("health_score"),
        "stress_class":     result.get("stress_class"),
        "confidence":       result.get("confidence"),
        "heatmap_url":      result.get("heatmap_url"),
        "heatmap_data_url": result.get("heatmap_data_url"),
        "offline":          True,
        "image_id":         image_id,
    })


@router.websocket("/ws/dashboard")
async def dashboard_feed(websocket: WebSocket):
    await websocket.accept()                      # ← accept first
    user = await verify_websocket_token(websocket)
    if not user:
        return
    # Register websocket under authenticated user_id so send_to_user() works
    user_id = user.get("sub") or user.get("id")
    if not user_id:
        logger.warning("WS dashboard: missing user id in token payload")
        return

    await manager.connect(websocket, user_id=user_id)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


@router.websocket("/ws/ingest")
async def ingest_result(websocket: WebSocket):
    await websocket.accept()                      # ← accept first
    user = await verify_websocket_token(websocket)
    if not user:
        return
    try:
        async for data in websocket.iter_json():
            await manager.broadcast(data)
            await supabase_service.save_detection(data)
    except WebSocketDisconnect:
        logger.info("Ingest client disconnected.")


@router.websocket("/ws/analyze/from-storage")
async def ws_analyze_from_storage(websocket: WebSocket):
    await websocket.accept()                      # ← must be first

    # Auth after accept — reject by sending error + closing, not by refusing upgrade
    user = await verify_websocket_token(websocket)
    if not user:
        await websocket.send_json({"type": "error", "message": "Unauthorized"})
        await websocket.close(code=4401)
        return

    tmp_path = None
    try:
        data        = await websocket.receive_json()
        object_path = data.get("object_path")
        bucket      = data.get("bucket") or settings.SUPABASE_BUCKET_RAW
        field_id    = data.get("field_id")
        flight_id   = data.get("flight_id")
        drone_id    = data.get("drone_id")
        image_id    = data.get("image_id")
        user_id     = user["sub"]

        if not object_path:
            await websocket.send_json({"type": "error", "message": "object_path is required"})
            return

        tmp_dir  = os.path.join(settings.OUTPUT_FOLDER, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        ext      = os.path.splitext(object_path)[1].lower() or ".jpg"
        tmp_path = os.path.join(tmp_dir, f"input_{uuid.uuid4().hex}{ext}")

        if bucket == LOCAL_BUCKET:
            local_path = os.path.join(settings.OUTPUT_FOLDER, "local_uploads", object_path.replace("/", os.sep))
            if not os.path.isfile(local_path) or os.path.getsize(local_path) == 0:
                await websocket.send_json({"type": "error", "message": "Local upload file not found"})
                return
            await websocket.send_json({"type": "progress", "message": "Loading locally saved image…"})
            shutil.copy2(local_path, tmp_path)
            await _run_offline_camera_analyze(
                websocket,
                tmp_path=tmp_path,
                user_id=user_id,
                field_id=field_id,
                flight_id=flight_id,
                drone_id=drone_id,
            )
            return

        # ── Download from cloud storage ───────────────────────────────────
        await websocket.send_json({"type": "progress", "message": "Downloading image from storage…"})

        await supabase_service.download_image(
            object_path=object_path,
            bucket=bucket,
            dest_path=tmp_path,
        )

        if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            await websocket.send_json({"type": "error", "message": "Download failed or empty file"})
            return

        # ── Resolve image record ──────────────────────────────────────────
        if not image_id:
            existing = await supabase_service.get_image_by_storage_path(object_path, user_id)
            image_id = existing.get("id") if existing else None

        await _run_analyze_and_respond(
            websocket,
            tmp_path=tmp_path,
            user_id=user_id,
            object_path=object_path,
            bucket=bucket,
            field_id=field_id,
            flight_id=flight_id,
            drone_id=drone_id,
            image_id=image_id,
            upload_source=data.get("upload_source", "manual"),
        )

    except WebSocketDisconnect:
        logger.info("Analyze client disconnected.")
    except Exception as e:
        logger.exception("ws_analyze_from_storage failed")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/analyze/from-upload")
async def ws_analyze_from_upload(websocket: WebSocket):
    """Browser fetches the MAPIR photo locally and sends it to the hosted backend for analysis."""
    await websocket.accept()

    user = await verify_websocket_token(websocket)
    if not user:
        await websocket.send_json({"type": "error", "message": "Unauthorized"})
        await websocket.close(code=4401)
        return

    tmp_path = None
    try:
        data = await websocket.receive_json()
        filename = (data.get("filename") or "photo.jpg").strip()
        field_id = data.get("field_id")
        flight_id = data.get("flight_id")
        drone_id = data.get("drone_id")
        upload_source = (data.get("upload_source") or "camera").strip() or "camera"
        image_b64 = data.get("image_base64")
        user_id = user["sub"]
        bucket = settings.SUPABASE_BUCKET_RAW

        if not image_b64:
            await websocket.send_json({"type": "error", "message": "image_base64 is required"})
            return

        ext = os.path.splitext(filename)[1].lower() or ".jpg"
        if ext not in MIME_TYPES:
            await websocket.send_json({"type": "error", "message": f"Unsupported file type: {ext}"})
            return

        await websocket.send_json({"type": "progress", "message": "Receiving image…"})

        try:
            file_bytes = base64.b64decode(image_b64, validate=True)
        except Exception:
            await websocket.send_json({"type": "error", "message": "Invalid image data"})
            return

        if not file_bytes:
            await websocket.send_json({"type": "error", "message": "Empty image data"})
            return

        tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_path = os.path.join(tmp_dir, f"upload_{uuid.uuid4().hex}{ext}")

        with open(tmp_path, "wb") as handle:
            handle.write(file_bytes)

        field_seg = field_id or "nofield"
        flight_seg = flight_id or "camera"
        storage_path = f"{user_id}/{field_seg}/{flight_seg}/{uuid.uuid4().hex}{ext}"

        cloud_ok = False
        client = supabase_service.get_supabase()
        if client:
            try:
                await websocket.send_json({"type": "progress", "message": "Uploading to storage…"})
                client.storage.from_(bucket).upload(
                    storage_path,
                    file_bytes,
                    file_options={"content-type": MIME_TYPES[ext]},
                )
                cloud_ok = True
            except Exception as upload_err:
                logger.warning("WebSocket upload to storage failed (%s)", upload_err)

        if cloud_ok:
            await _run_analyze_and_respond(
                websocket,
                tmp_path=tmp_path,
                user_id=user_id,
                object_path=storage_path,
                bucket=bucket,
                field_id=field_id,
                flight_id=flight_id,
                drone_id=drone_id,
                image_id=None,
                upload_source=upload_source,
            )
        else:
            await _run_offline_camera_analyze(
                websocket,
                tmp_path=tmp_path,
                user_id=user_id,
                field_id=field_id,
                flight_id=flight_id,
                drone_id=drone_id,
            )

    except WebSocketDisconnect:
        logger.info("Upload analyze client disconnected.")
    except Exception as e:
        logger.exception("ws_analyze_from_upload failed")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        try:
            await websocket.close()
        except Exception:
            pass


@router.websocket("/ws/analyze/from-camera")
async def ws_analyze_from_camera(websocket: WebSocket):
    """Pull a photo from the MAPIR camera on the server — no browser download needed."""
    await websocket.accept()

    user = await verify_websocket_token(websocket)
    if not user:
        await websocket.send_json({"type": "error", "message": "Unauthorized"})
        await websocket.close(code=4401)
        return

    tmp_path = None
    try:
        data = await websocket.receive_json()
        filename = (data.get("filename") or "").strip()
        field_id = data.get("field_id")
        flight_id = data.get("flight_id")
        drone_id = data.get("drone_id")
        user_id = user["sub"]
        bucket = settings.SUPABASE_BUCKET_RAW

        if not filename:
            await websocket.send_json({"type": "error", "message": "filename is required"})
            return

        ext = os.path.splitext(filename)[1].lower() or ".jpg"
        if ext not in MIME_TYPES:
            await websocket.send_json({"type": "error", "message": f"Unsupported file type: {ext}"})
            return

        tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)
        tmp_path = os.path.join(tmp_dir, f"camera_{uuid.uuid4().hex}{ext}")

        await websocket.send_json({
            "type": "progress",
            "message": f"Fetching {filename} from camera (via backend)…",
        })
        await download_camera_photo(filename, tmp_path, CAMERA_PHOTO_DIR)

        if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
            await websocket.send_json({"type": "error", "message": "Camera download failed or empty file"})
            return

        field_seg = field_id or "nofield"
        storage_path = f"{user_id}/{field_seg}/camera/{uuid.uuid4().hex}{ext}"

        cloud_ok = False
        with open(tmp_path, "rb") as handle:
            file_bytes = handle.read()

        client = supabase_service.get_supabase()
        if client:
            try:
                await websocket.send_json({"type": "progress", "message": "Uploading to storage…"})
                client.storage.from_(bucket).upload(
                    storage_path,
                    file_bytes,
                    file_options={"content-type": MIME_TYPES[ext]},
                )
                cloud_ok = True
            except Exception as upload_err:
                logger.warning("Camera cloud upload failed (%s) — offline mode", upload_err)

        if cloud_ok:
            await _run_analyze_and_respond(
                websocket,
                tmp_path=tmp_path,
                user_id=user_id,
                object_path=storage_path,
                bucket=bucket,
                field_id=field_id,
                flight_id=flight_id,
                drone_id=drone_id,
                image_id=None,
                upload_source="camera",
            )
        else:
            await _run_offline_camera_analyze(
                websocket,
                tmp_path=tmp_path,
                user_id=user_id,
                field_id=field_id,
                flight_id=flight_id,
                drone_id=drone_id,
            )

    except WebSocketDisconnect:
        logger.info("Camera analyze client disconnected.")
    except Exception as e:
        logger.exception("ws_analyze_from_camera failed")
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        try:
            await websocket.close()
        except Exception:
            pass