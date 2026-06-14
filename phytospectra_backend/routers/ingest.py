# routers/ingest.py
"""
Receives images from ESP32 (or simulator), runs SegFormer, saves result.
WebSocket clients subscribed to the flight are notified in real time.
"""
import io, json, time
import numpy as np
from fastapi  import APIRouter, File, UploadFile, Form, HTTPException, Depends
from PIL      import Image
from services import supabase_service, segformer_service
from core.auth import get_current_user
from routers.websocket import broadcast  # reuse your existing WS broadcaster

router = APIRouter(tags=["Ingest"])


@router.post("/ingest/image")
async def ingest_image(
    flight_id : str        = Form(...),
    latitude  : float      = Form(...),
    longitude : float      = Form(...),
    altitude  : float      = Form(0.0),
    file      : UploadFile = File(...),
    user                   = Depends(get_current_user),
):
    # ── 1. Decode image ──────────────────────────────────────────────────────
    raw = await file.read()
    try:
        pil_img    = Image.open(io.BytesIO(raw)).convert("RGB")
        img_array  = np.array(pil_img, dtype=np.float32)   # (H, W, 3)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Bad image: {e}")

    # ── 2. Run SegFormer ─────────────────────────────────────────────────────
    result = segformer_service.predict(img_array)

    # ── 3. Save to Supabase ──────────────────────────────────────────────────
    client = supabase_service.get_supabase()
    row = client.table("segmentations").insert({
        "flight_id"     : flight_id,
        "user_id"       : user["sub"],
        "latitude"      : latitude,
        "longitude"     : longitude,
        "altitude"      : altitude,
        "healthy_pct"   : result["healthy_pct"],
        "stressed_pct"  : result["stressed_pct"],
        "ndvi_mean"     : result["ndvi_mean"],
        "dominant_class": result["dominant_class"],
        # store mask as JSON — swap for Supabase Storage if images are large
        "pred_mask"     : json.dumps(result["pred_mask"]),
    }).execute()

    saved = row.data[0] if row.data else {}

    # ── 4. Broadcast over WebSocket ──────────────────────────────────────────
    await broadcast(json.dumps({
        "type"          : "segmentation",
        "flight_id"     : flight_id,
        "latitude"      : latitude,
        "longitude"     : longitude,
        "healthy_pct"   : result["healthy_pct"],
        "stressed_pct"  : result["stressed_pct"],
        "ndvi_mean"     : result["ndvi_mean"],
        "dominant_class": result["dominant_class"],
        "id"            : saved.get("id"),
    }))

    return {**result, "id": saved.get("id"), "flight_id": flight_id}
