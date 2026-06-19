from __future__ import annotations

import io
import logging
import os
import uuid
import asyncio
import time
from typing import Any
import httpx
from fastapi import APIRouter, Depends, HTTPException

from core.auth import get_current_user
from core.config import settings
from core.connection_manager import manager
from services import supabase_service
from services.calibration import extract_gps_from_exif
from services.gps_utils import normalize_gps
from services.segformer_inference import (
    normalize_segformer_stats,
    should_send_stress_alert,
)

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Segmentation"])


# ── Constants ─────────────────────────────────────────────────────────────────

# Health score thresholds for alert severity (after SegFormer stats)
_SEVERITY_HIGH_THRESHOLD   = 40   # health_score < 40  → high
_SEVERITY_MEDIUM_THRESHOLD = 70   # health_score < 70  → medium
                                   # health_score >= 70 → low

# Internal alert endpoint (same process)
_ALERT_URL = "http://localhost:8000/api/alerts/stress"
_ALERT_TIMEOUT_SECS = 10.0


async def _alert_recently_sent(
    client,
    *,
    farmer_id: str,
    flight_id: str | None,
    image_id: str,
    within_minutes: int = 240,
) -> bool:
    """Skip if this image already triggered an alert recently (any flight re-run)."""
    if not client:
        return False
    try:
        from datetime import datetime, timedelta, timezone

        since = (datetime.now(timezone.utc) - timedelta(minutes=within_minutes)).isoformat()
        needle = f"image:{image_id}"
        res = (
            client.table("alerts")
            .select("id, message")
            .eq("farmer_id", farmer_id)
            .eq("alert_type", "stress")
            .gte("created_at", since)
            .limit(50)
            .execute()
        )
        for row in res.data or []:
            msg = row.get("message") or ""
            if needle in msg:
                return True
    except Exception as e:
        logger.warning("alert dedup check failed: %s", e)
    return False


# ── Storage helpers ───────────────────────────────────────────────────────────

def _mask_bucket(source_bucket: str) -> str:
    return f"{source_bucket}-masks"


async def _upload_mask_image(
    mask_image,
    source_bucket: str,
    image_id: str,
    user_id: str,
    flight_id: str,
) -> str:
    """Save overlay mask PNG to Supabase, return public URL."""
    buf = io.BytesIO()
    mask_image.save(buf, format="PNG", optimize=True, compress_level=3)
    buf.seek(0)

    mask_filename   = f"mask_{uuid.uuid4().hex[:8]}.png"
    mask_storage    = f"{user_id}/{flight_id or 'noflight'}/{mask_filename}"
    mask_local_path = os.path.join(settings.OUTPUT_FOLDER, mask_filename)
    os.makedirs(settings.OUTPUT_FOLDER, exist_ok=True)

    with open(mask_local_path, "wb") as f:
        f.write(buf.getvalue())

    try:
        mask_url = await supabase_service.upload_image(
            mask_local_path,
            _mask_bucket(source_bucket),
            mask_storage,
        )
    finally:
        try:
            os.remove(mask_local_path)
        except OSError:
            pass

    return mask_url


# ── DB helpers ────────────────────────────────────────────────────────────────

async def _upsert_segmentation(
    image_id: str,
    flight_id: str | None,
    mask_url: str,
    label_counts: dict,
    stats: dict,
    user_id: str,
    field_id: str | None = None,
    drone_id: str | None = None,
    gps: dict | None = None,
) -> dict:
    record = {
        "user_id":               user_id,
        "image_id":              image_id,
        "field_id":              field_id,
        "flight_id":             flight_id,
        "drone_id":              drone_id,
        "heatmap_url":           mask_url,
        "stress_class":          stats["stress_class"],
        "confidence":            stats["confidence"],
        "health_score":          stats["health_score"],
        "health_percentage":     stats["health_percentage"],
        "healthy_pixel_count":   stats["healthy_pixel_count"],
        "stressed_pixel_count":  stats["stressed_pixel_count"],
        "ndvi_mean":             None,
        "gndvi_mean":            None,
        "gps":                   gps,
    }
    return await supabase_service.save_segmentation(record)


async def _fetch_cached(image_id: str) -> dict | None:
    client = supabase_service.get_supabase()
    if not client:
        return None
    try:
        res = (
            client.table("segmentations")
            .select("*")
            .eq("image_id", image_id)
            .order("processed_at", desc=True)
            .limit(1)
            .execute()
        )
        return res.data[0] if res.data else None
    except Exception as e:
        logger.warning(f"Cache lookup failed for image {image_id}: {e}")
        return None


async def _fetch_cached_bulk(image_ids: list[str]) -> dict[str, dict]:
    """Latest segmentation row per image_id (one Supabase round-trip)."""
    if not image_ids:
        return {}
    client = supabase_service.get_supabase()
    if not client:
        return {}
    try:
        res = (
            client.table("segmentations")
            .select("*")
            .in_("image_id", image_ids)
            .order("processed_at", desc=True)
            .execute()
        )
        out: dict[str, dict] = {}
        for row in res.data or []:
            iid = row.get("image_id")
            if iid and iid not in out:
                out[iid] = row
        return out
    except Exception as e:
        logger.warning("Bulk cache lookup failed: %s", e)
        return {}


def _payload_from_cached(image_id: str, cached: dict) -> dict:
    h = cached.get("healthy_pixel_count")
    s = cached.get("stressed_pixel_count")
    stressed_pct = None
    if h is not None and s is not None:
        try:
            total = int(h) + int(s)
            if total > 0:
                stressed_pct = round(int(s) / total * 100, 2)
        except (TypeError, ValueError):
            pass
    return {
        "image_id":             image_id,
        "mask_url":             cached.get("heatmap_url"),
        "stress_class":         cached.get("stress_class"),
        "health_score":         cached.get("health_score"),
        "health_percentage":    cached.get("health_percentage"),
        "stressed_percentage":  stressed_pct,
        "healthy_pixel_count":  h,
        "stressed_pixel_count": s,
        "confidence":           cached.get("confidence"),
        "gps":                  normalize_gps(cached.get("gps")),
        "label_counts":         {},
        "cached":               True,
    }


async def _enrich_results_with_gps(client, rows: list[dict]) -> list[dict]:
    """Attach GPS from segmentation row or linked image."""
    if not rows:
        return []
    image_ids = [r["image_id"] for r in rows if r.get("image_id")]
    gps_by_image: dict[str, dict] = {}
    if image_ids:
        try:
            img_res = (
                client.table("images")
                .select("id, gps")
                .in_("id", image_ids)
                .execute()
            )
            for img in img_res.data or []:
                g = normalize_gps(img.get("gps"))
                if g:
                    gps_by_image[img["id"]] = g
        except Exception as e:
            logger.warning("GPS image lookup failed: %s", e)

    enriched: list[dict] = []
    for row in rows:
        gps = normalize_gps(row.get("gps")) or gps_by_image.get(row.get("image_id"))
        enriched.append({**row, "gps": gps})
    return enriched


async def _flight_field_meta(client, flight_id: str, user_id: str) -> dict | None:
    try:
        res = (
            client.table("flights")
            .select("field_id, fields(field_name, boundary, latitude, longitude)")
            .eq("id", flight_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        row = res.data[0]
        fields = row.get("fields") or {}
        if not isinstance(fields, dict):
            fields = {}
        return {
            "field_id": row.get("field_id"),
            "field_name": fields.get("field_name"),
            "boundary": fields.get("boundary"),
            "latitude": fields.get("latitude"),
            "longitude": fields.get("longitude"),
        }
    except Exception as e:
        logger.warning("Flight field meta lookup failed: %s", e)
        return None


# ── GPS helpers ───────────────────────────────────────────────────────────────

async def _resolve_gps(
    gps: dict | None,
    field_id: str | None,
    client,
) -> dict | None:
    """
    Return GPS coordinates to use for alerting.

    Priority:
      1. EXIF GPS extracted directly from the image (most accurate).
      2. Field centroid stored in the `fields` table (fallback when EXIF
         is absent, e.g. PNG files that strip metadata).
      3. None — alert will be skipped gracefully downstream.
    """
    # 1. EXIF GPS present and valid — use it directly
    if gps and gps.get("lat") and gps.get("lng"):
        return gps

    # 2. No EXIF GPS — try field centroid as fallback
    if not field_id or not client:
        logger.warning(
            "GPS fallback skipped — no field_id available or Supabase unavailable."
        )
        return None

    try:
        res = (
            client.table("fields")
            .select("centroid_lat, centroid_lng")
            .eq("id", field_id)
            .limit(1)
            .execute()
        )
        if res.data:
            row = res.data[0]
            lat = row.get("centroid_lat")
            lng = row.get("centroid_lng")
            if lat and lng:
                logger.info(
                    "GPS fallback: using field centroid for field_id=%s "
                    "(lat=%.6f, lng=%.6f)",
                    field_id, lat, lng,
                )
                return {"lat": lat, "lng": lng}
            else:
                logger.warning(
                    "GPS fallback: field %s has no centroid_lat/centroid_lng set.",
                    field_id,
                )
    except Exception as e:
        logger.warning(
            "GPS fallback lookup failed for field %s: %s", field_id, e
        )

    return None


# ── Alert helper ──────────────────────────────────────────────────────────────

def _severity_from_score(health_score: float) -> str:
    if health_score < _SEVERITY_HIGH_THRESHOLD:
        return "high"
    if health_score < _SEVERITY_MEDIUM_THRESHOLD:
        return "medium"
    return "low"


async def _trigger_stress_alert(
    *,
    image_id: str,
    flight_id: str | None,
    field_id: str | None,
    user_id: str,
    stats: dict,
    gps: dict | None,
) -> None:
    """
    Fire-and-forget alert call after a stressed image is segmented.

    Looks up farmer_id and field_id from the flights table, then POSTs
    to /api/alerts/stress. Any failure is logged but never re-raised so
    that segmentation results are always returned to the caller.

    Skipped entirely when:
      - stressed vegetation is below STRESS_ALERT_STRESSED_PCT (default 30%)
      - GPS coordinates are unavailable after EXIF + field centroid fallback
    """
    stats = normalize_segformer_stats(stats)
    if not should_send_stress_alert(stats):
        return

    client = supabase_service.get_supabase()
    resolved_gps = await _resolve_gps(gps, field_id, client)

    if not resolved_gps or not resolved_gps.get("lat") or not resolved_gps.get("lng"):
        logger.warning(
            "Alert skipped for image %s — no GPS coordinates available "
            "(no EXIF data and no field centroid). "
            "Ensure images have EXIF GPS or that the field has centroid_lat/centroid_lng set.",
            image_id,
        )
        return

    if not client:
        logger.warning("Alert skipped — Supabase unavailable")
        return

    try:
        # Resolve farmer_id and field_id from the flight record
        farmer_id      = user_id   # fallback if flight lookup fails
        resolved_field = field_id

        if flight_id:
            flight_res = (
                client.table("flights")
                .select("user_id, field_id")
                .eq("id", flight_id)
                .limit(1)
                .execute()
            )
            if flight_res.data:
                farmer_id      = flight_res.data[0]["user_id"]
                resolved_field = flight_res.data[0]["field_id"] or field_id

        if await _alert_recently_sent(
            client, farmer_id=farmer_id, flight_id=flight_id, image_id=image_id
        ):
            logger.info("Alert skipped (already sent) | image=%s", image_id)
            return

        health_score = float(stats.get("health_score") or 0)
        severity = _severity_from_score(health_score)

        alert_payload = {
            "farmer_id":    farmer_id,
            "field_id":     resolved_field or "",
            "flight_id":    flight_id,
            "lat":          resolved_gps["lat"],
            "lng":          resolved_gps["lng"],
            "health_score": health_score,
            "severity":     severity,
            "message": (
                f"⚠️ Crop stress on image:{image_id} — "
                f"{stats.get('stressed_percentage', 100 - health_score):.0f}% stressed vegetation "
                f"({health_score:.0f}% health)."
            ),
        }

        async with httpx.AsyncClient() as http:
            resp = await http.post(
                _ALERT_URL,
                json=alert_payload,
                timeout=_ALERT_TIMEOUT_SECS,
            )
            resp.raise_for_status()

        logger.info(
            "Alert triggered | image=%s | flight=%s | "
            "health=%.1f%% | stressed=%.1f%% | severity=%s",
            image_id,
            flight_id,
            stats.get("health_score", 0),
            stats.get("stressed_percentage", 0),
            severity,
        )

    except Exception as e:
        # Non-fatal — log and continue
        logger.warning("Alert trigger failed for image %s: %s", image_id, e)


# ── Core per-image processing ─────────────────────────────────────────────────

async def _process_one_image(
    *,
    image_row: dict,
    user_id: str,
    force: bool,
    tmp_dir: str,
) -> dict:
    """
    Download → segment → upload mask → persist → broadcast → (maybe) alert.
    Returns the result payload. Never raises from the alert step.
    """
    image_id     = image_row["id"]
    storage_path = image_row["storage_path"]
    bucket       = image_row.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
    flight_id    = image_row.get("flight_id")
    field_id     = image_row.get("field_id")
    drone_id     = image_row.get("drone_id")

    # ── Return cached result unless forced ────────────────────────────────
    if not force:
        cached = await _fetch_cached(image_id)
        if cached:
            logger.info(f"Returning cached segmentation for image {image_id}")
            payload = _payload_from_cached(image_id, cached)
            await _trigger_stress_alert(
                image_id=image_id,
                flight_id=flight_id,
                field_id=field_id,
                user_id=user_id,
                stats=payload,
                gps=normalize_gps(cached.get("gps")),
            )
            return payload

    # ── Download to temp file ─────────────────────────────────────────────
    ext      = os.path.splitext(storage_path)[1].lower() or ".png"
    tmp_path = os.path.join(tmp_dir, f"seg_{uuid.uuid4().hex}{ext}")
    t0 = time.perf_counter()

    try:
        await asyncio.to_thread(
            supabase_service.download_image_sync,
            storage_path,
            bucket,
            tmp_path,
        )
        t_dl = time.perf_counter() - t0
        dl_bytes = os.path.getsize(tmp_path) if os.path.exists(tmp_path) else 0

        if not os.path.exists(tmp_path) or dl_bytes == 0:
            raise RuntimeError(f"Downloaded file is empty: {storage_path}")

        gps = extract_gps_from_exif(tmp_path)

        from services.segformer_inference import run_segformer
        t_inf0 = time.perf_counter()
        result = await asyncio.to_thread(run_segformer, tmp_path)
        t_inf = time.perf_counter() - t_inf0

        stats = {
            "stress_class":         result["stress_class"],
            "confidence":           result["confidence"],
            "health_score":         result["health_score"],
            "health_percentage":    result["health_percentage"],
            "stressed_percentage":  result["stressed_percentage"],
            "healthy_pixel_count":  result["healthy_pixel_count"],
            "stressed_pixel_count": result["stressed_pixel_count"],
        }

        t_up0 = time.perf_counter()
        mask_url = await _upload_mask_image(
            result["mask_image"], bucket, image_id, user_id, flight_id or "noflight"
        )
        t_up = time.perf_counter() - t_up0

        logger.info(
            "segment timing image=%s download=%.1fs (%.1fMB) infer=%.1fs upload=%.1fs",
            image_id,
            t_dl,
            dl_bytes / 1_048_576,
            t_inf,
            t_up,
        )

        # ── Persist segmentation record ───────────────────────────────────
        saved = await _upsert_segmentation(
            image_id=image_id,
            flight_id=flight_id,
            mask_url=mask_url,
            label_counts=result["label_counts"],
            stats=stats,
            user_id=user_id,
            field_id=field_id,
            drone_id=drone_id,
            gps=gps,
        )

        payload = {
            "image_id":        image_id,
            "segmentation_id": saved.get("id"),
            "mask_url":        mask_url,
            "label_counts":    result["label_counts"],
            "gps":             gps,
            "cached":          False,
            **stats,
        }

        # ── WebSocket broadcast ───────────────────────────────────────────
        await manager.broadcast(payload)
        logger.info(
            "Segmented image %s | stress=%s | health=%.1f%%",
            image_id, stats["stress_class"], stats["health_score"],
        )

        # ── Auto-alert if stressed ────────────────────────────────────────
        await _trigger_stress_alert(
            image_id=image_id,
            flight_id=flight_id,
            field_id=field_id,
            user_id=user_id,
            stats=stats,
            gps=gps,
        )

        return payload

    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/segment/flight/{flight_id}")
async def segment_flight(
    flight_id: str,
    force: bool = False,
    user: Any = Depends(get_current_user),
) -> dict:
    """
    Run SegFormer segmentation on all images attached to a flight.
    Pass ?force=true to re-run even when a cached result exists.
    Alerts every image with >= STRESS_ALERT_STRESSED_PCT stressed vegetation (default 30%).
    """
    user_id = user["sub"]
    logger.info("segment_flight | flight_id=%s | user_id=%s", flight_id, user_id)

    client = supabase_service.get_supabase()
    if not client:
        raise HTTPException(503, "Supabase unavailable")

    # ── Fetch images ──────────────────────────────────────────────────────
    img_res = (
        client.table("images")
        .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
        .eq("flight_id", flight_id)
        .eq("user_id", user_id)
        .execute()
    )
    flight_images: list[dict] = img_res.data or []
    logger.info("Images found: %d for flight %s", len(flight_images), flight_id)

    if not flight_images:
        # Debug: check if flight exists under a different user
        all_res = (
            client.table("images")
            .select("id, flight_id, user_id, storage_path")
            .eq("flight_id", flight_id)
            .limit(5)
            .execute()
        )
        logger.warning(
            "No images for flight_id=%s with user_id=%s. "
            "Images with this flight_id (any user): %s",
            flight_id, user_id, all_res.data,
        )
        raise HTTPException(404, f"No images found for flight {flight_id}.")

    tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    results: list[dict] = []
    errors:  list[dict] = []

    cached_map: dict[str, dict] = {}
    if not force:
        cached_map = await _fetch_cached_bulk([img["id"] for img in flight_images])

    to_run: list[dict] = []
    for img_row in flight_images:
        iid = img_row["id"]
        if not force and iid in cached_map:
            results.append(_payload_from_cached(iid, cached_map[iid]))
        else:
            to_run.append(img_row)

    logger.info(
        "segment_flight | %d cached, %d to process",
        len(results), len(to_run),
    )

    for img_row in to_run:
        try:
            result = await _process_one_image(
                image_row=img_row,
                user_id=user_id,
                force=force,
                tmp_dir=tmp_dir,
            )
            results.append(result)
        except Exception as e:
            logger.exception("Failed to segment image %s: %s", img_row.get("id"), e)
            errors.append({"image_id": img_row.get("id"), "error": str(e)})

    stressed_count = sum(
        1 for r in results if should_send_stress_alert(normalize_segformer_stats(r))
    )

    if results:
        results = await _enrich_results_with_gps(client, results)
        signed_rows = supabase_service.attach_segmentation_mask_urls([
            {"image_id": r["image_id"], "heatmap_url": r.get("mask_url"), **r}
            for r in results
        ])
        for r, signed in zip(results, signed_rows):
            if signed.get("mask_url"):
                r["mask_url"] = signed["mask_url"]

    return {
        "flight_id":       flight_id,
        "processed":       len(results),
        "failed":          len(errors),
        "stressed_images": stressed_count,
        "results":         results,
        "errors":          errors,
    }


@router.get("/segment/flight/{flight_id}")
async def get_flight_segmentations(
    flight_id: str,
    user: Any = Depends(get_current_user),
) -> dict:
    """Return cached segmentation results for a flight. Returns empty list if none exist."""
    client = supabase_service.get_supabase()
    if not client:
        raise HTTPException(503, "Supabase unavailable")

    user_id = user["sub"]
    rows = await supabase_service.get_flight_segmentation_rows(
        flight_id=flight_id,
        user_id=user_id,
        limit=500,
    )
    rows = await _enrich_results_with_gps(client, rows)
    field_meta = await _flight_field_meta(client, flight_id, user_id)

    logger.info("GET segment/flight/%s: %d cached results", flight_id, len(rows))
    return {
        "flight_id": flight_id,
        "count":     len(rows),
        "field":     field_meta,
        "results": [
            {
                "image_id":             r["image_id"],
                "mask_url":             r.get("mask_url") or r.get("heatmap_url"),
                "stress_class":         r.get("stress_class"),
                "health_score":         r.get("health_score"),
                "health_percentage":    r.get("health_percentage"),
                "healthy_pixel_count":  r.get("healthy_pixel_count"),
                "stressed_pixel_count": r.get("stressed_pixel_count"),
                "confidence":           r.get("confidence"),
                "gps":                  r.get("gps"),
                "processed_at":         r.get("processed_at"),
            }
            for r in rows
        ],
    }


@router.post("/segment/image/{image_id}")
async def segment_single_image(
    image_id: str,
    force: bool = False,
    user: Any = Depends(get_current_user),
) -> dict:
    """
    Run SegFormer on a single already-uploaded image (by image_id).
    Also triggers a stress alert if the image is stressed.
    """
    user_id = user["sub"]
    client  = supabase_service.get_supabase()
    if not client:
        raise HTTPException(503, "Supabase unavailable")

    res = (
        client.table("images")
        .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
        .eq("id", image_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, f"Image {image_id} not found")

    tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    result = await _process_one_image(
        image_row=res.data[0],
        user_id=user_id,
        force=force,
        tmp_dir=tmp_dir,
    )
    return {"status": "success", **result}


async def auto_segment_image(image_id: str, user_id: str) -> None:
    """
    Run SegFormer on one newly uploaded image (background task).
    Errors are logged but never raised.
    """
    from core.role import is_field_pc

    if is_field_pc():
        logger.info(
            "auto_segment_image: skipped on field PC | image_id=%s",
            image_id,
        )
        return

    logger.info("auto_segment_image: starting | image_id=%s user_id=%s", image_id, user_id)
    client = supabase_service.get_supabase()
    if not client:
        logger.warning("auto_segment_image: Supabase unavailable, skipping")
        return

    try:
        res = (
            client.table("images")
            .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
            .eq("id", image_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not res.data:
            logger.warning("auto_segment_image: image not found | id=%s", image_id)
            return

        tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)

        await _process_one_image(
            image_row=res.data[0],
            user_id=user_id,
            force=False,
            tmp_dir=tmp_dir,
        )
        logger.info("auto_segment_image: done | image_id=%s", image_id)
    except Exception as e:
        logger.exception("auto_segment_image: failed | image_id=%s: %s", image_id, e)


async def auto_segment_flight(flight_id: str, user_id: str) -> None:
    """
    Run SegFormer on every image in a flight (background task).
    Silently runs segmentation and triggers alerts for stressed images.
    Errors are logged but never raised.
    """
    logger.info("auto_segment_flight: starting | flight_id=%s user_id=%s", flight_id, user_id)
    client = supabase_service.get_supabase()
    if not client:
        logger.warning("auto_segment_flight: Supabase unavailable, skipping")
        return

    try:
        img_res = (
            client.table("images")
            .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
            .eq("flight_id", flight_id)
            .eq("user_id", user_id)
            .execute()
        )
        flight_images: list[dict] = img_res.data or []

        if not flight_images:
            logger.warning("auto_segment_flight: no images found for flight %s", flight_id)
            return

        tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
        os.makedirs(tmp_dir, exist_ok=True)

        ok = 0
        for img_row in flight_images:
            try:
                await _process_one_image(
                    image_row=img_row,
                    user_id=user_id,
                    force=False,
                    tmp_dir=tmp_dir,
                )
                ok += 1
            except Exception as e:
                logger.exception(
                    "auto_segment_flight: failed on image %s: %s",
                    img_row.get("id"), e,
                )

        logger.info(
            "auto_segment_flight: done | flight_id=%s | %d/%d succeeded",
            flight_id, ok, len(flight_images),
        )
    except Exception as e:
        logger.exception(
            "auto_segment_flight: unexpected error for flight %s: %s", flight_id, e
        )
# from __future__ import annotations

# import io
# import logging
# import os
# import uuid
# from typing import Any

# import httpx
# from fastapi import APIRouter, Depends, HTTPException

# from core.auth import get_current_user
# from core.config import settings
# from core.connection_manager import manager
# from services import supabase_service
# from services.calibration import extract_gps_from_exif
# from services.segformer_inference import run_segformer

# logger = logging.getLogger(__name__)
# router = APIRouter(tags=["Segmentation"])


# # ── Constants ─────────────────────────────────────────────────────────────────

# # Health score thresholds for severity classification
# _SEVERITY_HIGH_THRESHOLD   = 40   # health_score < 40  → high
# _SEVERITY_MEDIUM_THRESHOLD = 70   # health_score < 70  → medium
#                                    # health_score >= 70 → low

# # Internal alert endpoint (same process)
# _ALERT_URL = "http://localhost:8000/api/alerts/stress"
# _ALERT_TIMEOUT_SECS = 10.0


# # ── Storage helpers ───────────────────────────────────────────────────────────

# def _mask_bucket(source_bucket: str) -> str:
#     return f"{source_bucket}-masks"


# async def _upload_mask_image(
#     mask_image,
#     source_bucket: str,
#     image_id: str,
#     user_id: str,
#     flight_id: str,
# ) -> str:
#     """Save colourised mask PNG to Supabase, return public URL."""
#     buf = io.BytesIO()
#     mask_image.save(buf, format="PNG")
#     buf.seek(0)

#     mask_filename   = f"mask_{uuid.uuid4().hex[:8]}.png"
#     mask_storage    = f"{user_id}/{flight_id or 'noflight'}/{mask_filename}"
#     mask_local_path = os.path.join(settings.OUTPUT_FOLDER, mask_filename)
#     os.makedirs(settings.OUTPUT_FOLDER, exist_ok=True)

#     with open(mask_local_path, "wb") as f:
#         f.write(buf.getvalue())

#     try:
#         mask_url = await supabase_service.upload_image(
#             mask_local_path,
#             _mask_bucket(source_bucket),
#             mask_storage,
#         )
#     finally:
#         try:
#             os.remove(mask_local_path)
#         except OSError:
#             pass

#     return mask_url


# # ── DB helpers ────────────────────────────────────────────────────────────────

# async def _upsert_segmentation(
#     image_id: str,
#     flight_id: str | None,
#     mask_url: str,
#     label_counts: dict,
#     stats: dict,
#     user_id: str,
#     field_id: str | None = None,
#     drone_id: str | None = None,
#     gps: dict | None = None,
# ) -> dict:
#     record = {
#         "user_id":               user_id,
#         "image_id":              image_id,
#         "field_id":              field_id,
#         "flight_id":             flight_id,
#         "drone_id":              drone_id,
#         "heatmap_url":           mask_url,
#         "stress_class":          stats["stress_class"],
#         "confidence":            stats["confidence"],
#         "health_score":          stats["health_score"],
#         "health_percentage":     stats["health_percentage"],
#         "healthy_pixel_count":   stats["healthy_pixel_count"],
#         "stressed_pixel_count":  stats["stressed_pixel_count"],
#         "ndvi_mean":             None,
#         "gndvi_mean":            None,
#         "gps":                   gps,
#     }
#     return await supabase_service.save_segmentation(record)


# async def _fetch_cached(image_id: str) -> dict | None:
#     client = supabase_service.get_supabase()
#     if not client:
#         return None
#     try:
#         res = (
#             client.table("segmentations")
#             .select("*")
#             .eq("image_id", image_id)
#             .order("processed_at", desc=True)
#             .limit(1)
#             .execute()
#         )
#         return res.data[0] if res.data else None
#     except Exception as e:
#         logger.warning(f"Cache lookup failed for image {image_id}: {e}")
#         return None


# # ── Alert helper ──────────────────────────────────────────────────────────────

# def _severity_from_score(health_score: float) -> str:
#     if health_score < _SEVERITY_HIGH_THRESHOLD:
#         return "high"
#     if health_score < _SEVERITY_MEDIUM_THRESHOLD:
#         return "medium"
#     return "low"


# async def _trigger_stress_alert(
#     *,
#     image_id: str,
#     flight_id: str | None,
#     field_id: str | None,
#     user_id: str,
#     stats: dict,
#     gps: dict | None,
# ) -> None:
#     """
#     Fire-and-forget alert call after a stressed image is segmented.

#     Looks up farmer_id and field_id from the flights table, then POSTs
#     to /api/alerts/stress. Any failure is logged but never re-raised so
#     that segmentation results are always returned to the caller.

#     Skipped entirely when:
#       - stress_class is not "stressed"
#       - GPS coordinates are unavailable (alert needs a location)
#     """
#     if stats["stress_class"] != "stressed":
#         return

#     if not gps or not gps.get("lat") or not gps.get("lng"):
#         logger.warning(
#             f"Alert skipped for image {image_id} — no GPS coordinates available. "
#             "Ensure images have EXIF GPS or pass field centroid coordinates."
#         )
#         return

#     client = supabase_service.get_supabase()
#     if not client:
#         logger.warning("Alert skipped — Supabase unavailable")
#         return

#     try:
#         # Resolve farmer_id and field_id from the flight record
#         farmer_id      = user_id   # fallback if flight lookup fails
#         resolved_field = field_id

#         if flight_id:
#             flight_res = (
#                 client.table("flights")
#                 .select("user_id, field_id")
#                 .eq("id", flight_id)
#                 .limit(1)
#                 .execute()
#             )
#             if flight_res.data:
#                 farmer_id      = flight_res.data[0]["user_id"]
#                 resolved_field = flight_res.data[0]["field_id"] or field_id

#         severity = _severity_from_score(stats["health_score"])

#         alert_payload = {
#             "farmer_id":    farmer_id,
#             "field_id":     resolved_field or "",
#             "flight_id":    flight_id,
#             "lat":          gps["lat"],
#             "lng":          gps["lng"],
#             "health_score": stats["health_score"],
#             "severity":     severity,
#         }

#         async with httpx.AsyncClient() as http:
#             resp = await http.post(
#                 _ALERT_URL,
#                 json=alert_payload,
#                 timeout=_ALERT_TIMEOUT_SECS,
#             )
#             resp.raise_for_status()

#         logger.info(
#             "Alert triggered | image=%s | flight=%s | "
#             "health=%.1f%% | severity=%s",
#             image_id, flight_id, stats["health_score"], severity,
#         )

#     except Exception as e:
#         # Non-fatal — log and continue
#         logger.warning("Alert trigger failed for image %s: %s", image_id, e)


# # ── Core per-image processing ─────────────────────────────────────────────────

# async def _process_one_image(
#     *,
#     image_row: dict,
#     user_id: str,
#     force: bool,
#     tmp_dir: str,
# ) -> dict:
#     """
#     Download → segment → upload mask → persist → broadcast → (maybe) alert.
#     Returns the result payload. Never raises from the alert step.
#     """
#     image_id     = image_row["id"]
#     storage_path = image_row["storage_path"]
#     bucket       = image_row.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
#     flight_id    = image_row.get("flight_id")
#     field_id     = image_row.get("field_id")
#     drone_id     = image_row.get("drone_id")

#     # ── Return cached result unless forced ────────────────────────────────
#     if not force:
#         cached = await _fetch_cached(image_id)
#         if cached:
#             logger.info(f"Returning cached segmentation for image {image_id}")
#             return {
#                 "image_id":          image_id,
#                 "mask_url":          cached.get("heatmap_url"),
#                 "stress_class":      cached.get("stress_class"),
#                 "health_score":      cached.get("health_score"),
#                 "health_percentage": cached.get("health_percentage"),
#                 "label_counts":      {},
#                 "cached":            True,
#             }

#     # ── Download to temp file ─────────────────────────────────────────────
#     ext      = os.path.splitext(storage_path)[1].lower() or ".png"
#     tmp_path = os.path.join(tmp_dir, f"seg_{uuid.uuid4().hex}{ext}")

#     try:
#         await supabase_service.download_image(storage_path, bucket, tmp_path)

#         if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
#             raise RuntimeError(f"Downloaded file is empty: {storage_path}")

#         # GPS from EXIF
#         gps = extract_gps_from_exif(tmp_path)

#         # ── Run SegFormer ─────────────────────────────────────────────────
#         result = run_segformer(tmp_path)

#         stats = {
#             "stress_class":         result["stress_class"],
#             "confidence":           result["confidence"],
#             "health_score":         result["health_score"],
#             "health_percentage":    result["health_percentage"],
#             "healthy_pixel_count":  result["healthy_pixel_count"],
#             "stressed_pixel_count": result["stressed_pixel_count"],
#         }

#         # ── Upload colourised mask ────────────────────────────────────────
#         mask_url = await _upload_mask_image(
#             result["mask_image"], bucket, image_id, user_id, flight_id or "noflight"
#         )

#         # ── Persist segmentation record ───────────────────────────────────
#         saved = await _upsert_segmentation(
#             image_id=image_id,
#             flight_id=flight_id,
#             mask_url=mask_url,
#             label_counts=result["label_counts"],
#             stats=stats,
#             user_id=user_id,
#             field_id=field_id,
#             drone_id=drone_id,
#             gps=gps,
#         )

#         payload = {
#             "image_id":        image_id,
#             "segmentation_id": saved.get("id"),
#             "mask_url":        mask_url,
#             "label_counts":    result["label_counts"],
#             "gps":             gps,
#             "cached":          False,
#             **stats,
#         }

#         # ── WebSocket broadcast ───────────────────────────────────────────
#         await manager.broadcast(payload)
#         logger.info(
#             "Segmented image %s | stress=%s | health=%.1f%%",
#             image_id, stats["stress_class"], stats["health_score"],
#         )

#         # ── Auto-alert if stressed ────────────────────────────────────────
#         await _trigger_stress_alert(
#             image_id=image_id,
#             flight_id=flight_id,
#             field_id=field_id,
#             user_id=user_id,
#             stats=stats,
#             gps=gps,
#         )

#         return payload

#     finally:
#         try:
#             os.remove(tmp_path)
#         except OSError:
#             pass


# # ── Routes ────────────────────────────────────────────────────────────────────

# @router.post("/segment/flight/{flight_id}")
# async def segment_flight(
#     flight_id: str,
#     force: bool = False,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     """
#     Run SegFormer segmentation on all images attached to a flight.
#     Pass ?force=true to re-run even when a cached result exists.
#     Automatically triggers stress alerts for any stressed image found.
#     """
#     user_id = user["sub"]
#     logger.info("segment_flight | flight_id=%s | user_id=%s", flight_id, user_id)

#     client = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     # ── Fetch images ──────────────────────────────────────────────────────
#     img_res = (
#         client.table("images")
#         .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#         .eq("flight_id", flight_id)
#         .eq("user_id", user_id)
#         .execute()
#     )
#     flight_images: list[dict] = img_res.data or []
#     logger.info("Images found: %d for flight %s", len(flight_images), flight_id)

#     if not flight_images:
#         # Debug: check if flight exists under a different user
#         all_res = (
#             client.table("images")
#             .select("id, flight_id, user_id, storage_path")
#             .eq("flight_id", flight_id)
#             .limit(5)
#             .execute()
#         )
#         logger.warning(
#             "No images for flight_id=%s with user_id=%s. "
#             "Images with this flight_id (any user): %s",
#             flight_id, user_id, all_res.data,
#         )
#         raise HTTPException(404, f"No images found for flight {flight_id}.")

#     tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#     os.makedirs(tmp_dir, exist_ok=True)

#     results: list[dict] = []
#     errors:  list[dict] = []

#     for img_row in flight_images:
#         try:
#             result = await _process_one_image(
#                 image_row=img_row,
#                 user_id=user_id,
#                 force=force,
#                 tmp_dir=tmp_dir,
#             )
#             results.append(result)
#         except Exception as e:
#             logger.exception("Failed to segment image %s: %s", img_row.get("id"), e)
#             errors.append({"image_id": img_row.get("id"), "error": str(e)})

#     stressed_count = sum(1 for r in results if r.get("stress_class") == "stressed")

#     return {
#         "flight_id":      flight_id,
#         "processed":      len(results),
#         "failed":         len(errors),
#         "stressed_images": stressed_count,
#         "results":        results,
#         "errors":         errors,
#     }


# @router.get("/segment/flight/{flight_id}")
# async def get_flight_segmentations(
#     flight_id: str,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     """Return cached segmentation results for a flight. Returns empty list if none exist."""
#     client = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     try:
#         res = (
#             client.table("segmentations")
#             .select(
#                 "image_id, heatmap_url, stress_class, health_score, health_percentage, "
#                 "healthy_pixel_count, stressed_pixel_count, confidence, processed_at"
#             )
#             .eq("flight_id", flight_id)
#             .order("processed_at", desc=True)
#             .execute()
#         )
#         rows = res.data or []
#     except Exception as e:
#         logger.warning("GET segment/flight/%s: query error %s", flight_id, e)
#         rows = []

#     logger.info("GET segment/flight/%s: %d cached results", flight_id, len(rows))
#     return {
#         "flight_id": flight_id,
#         "count":     len(rows),
#         "results": [
#             {
#                 "image_id":             r["image_id"],
#                 "mask_url":             r["heatmap_url"],
#                 "stress_class":         r.get("stress_class"),
#                 "health_score":         r.get("health_score"),
#                 "health_percentage":    r.get("health_percentage"),
#                 "healthy_pixel_count":  r.get("healthy_pixel_count"),
#                 "stressed_pixel_count": r.get("stressed_pixel_count"),
#                 "confidence":           r.get("confidence"),
#                 "processed_at":         r.get("processed_at"),
#             }
#             for r in rows
#         ],
#     }


# @router.post("/segment/image/{image_id}")
# async def segment_single_image(
#     image_id: str,
#     force: bool = False,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     """
#     Run SegFormer on a single already-uploaded image (by image_id).
#     Also triggers a stress alert if the image is stressed.
#     """
#     user_id = user["sub"]
#     client  = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     res = (
#         client.table("images")
#         .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#         .eq("id", image_id)
#         .eq("user_id", user_id)
#         .limit(1)
#         .execute()
#     )
#     if not res.data:
#         raise HTTPException(404, f"Image {image_id} not found")

#     tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#     os.makedirs(tmp_dir, exist_ok=True)

#     result = await _process_one_image(
#         image_row=res.data[0],
#         user_id=user_id,
#         force=force,
#         tmp_dir=tmp_dir,
#     )
#     return {"status": "success", **result}


# async def auto_segment_flight(flight_id: str, user_id: str) -> None:
#     """
#     Called automatically after flight images are uploaded.
#     Silently runs segmentation and triggers alerts for stressed images.
#     Errors are logged but never raised.
#     """
#     logger.info("auto_segment_flight: starting | flight_id=%s user_id=%s", flight_id, user_id)
#     client = supabase_service.get_supabase()
#     if not client:
#         logger.warning("auto_segment_flight: Supabase unavailable, skipping")
#         return

#     try:
#         img_res = (
#             client.table("images")
#             .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#             .eq("flight_id", flight_id)
#             .eq("user_id", user_id)
#             .execute()
#         )
#         flight_images: list[dict] = img_res.data or []

#         if not flight_images:
#             logger.warning("auto_segment_flight: no images found for flight %s", flight_id)
#             return

#         tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#         os.makedirs(tmp_dir, exist_ok=True)

#         ok = 0
#         for img_row in flight_images:
#             try:
#                 await _process_one_image(
#                     image_row=img_row,
#                     user_id=user_id,
#                     force=False,
#                     tmp_dir=tmp_dir,
#                 )
#                 ok += 1
#             except Exception as e:
#                 logger.exception(
#                     "auto_segment_flight: failed on image %s: %s",
#                     img_row.get("id"), e,
#                 )

#         logger.info(
#             "auto_segment_flight: done | flight_id=%s | %d/%d succeeded",
#             flight_id, ok, len(flight_images),
#         )
#     except Exception as e:
#         logger.exception(
#             "auto_segment_flight: unexpected error for flight %s: %s", flight_id, e
#         )
# from __future__ import annotations

# import io
# import logging
# import os
# import uuid
# from typing import Any

# import httpx
# from fastapi import APIRouter, Depends, HTTPException

# from core.auth import get_current_user
# from core.config import settings
# from core.connection_manager import manager
# from services import supabase_service
# from services.calibration import extract_gps_from_exif
# from services.segformer_inference import run_segformer

# logger = logging.getLogger(__name__)
# router = APIRouter(tags=["Segmentation"])


# # ── Constants ─────────────────────────────────────────────────────────────────

# _HEALTHY_ALERT_THRESHOLD   = 70   # health_score >= 70 → healthy alert
# _SEVERITY_HIGH_THRESHOLD   = 40   # health_score < 40  → high severity
# _SEVERITY_MEDIUM_THRESHOLD = 70   # health_score < 70  → medium severity

# _ALERT_URL          = "http://localhost:8000/api/alerts/stress"
# _ALERT_TIMEOUT_SECS = 10.0


# # ── Storage helpers ───────────────────────────────────────────────────────────

# def _mask_bucket(source_bucket: str) -> str:
#     return f"{source_bucket}-masks"


# async def _upload_mask_image(
#     mask_image,
#     source_bucket: str,
#     image_id: str,
#     user_id: str,
#     flight_id: str,
# ) -> str:
#     buf = io.BytesIO()
#     mask_image.save(buf, format="PNG")
#     buf.seek(0)

#     mask_filename   = f"mask_{uuid.uuid4().hex[:8]}.png"
#     mask_storage    = f"{user_id}/{flight_id or 'noflight'}/{mask_filename}"
#     mask_local_path = os.path.join(settings.OUTPUT_FOLDER, mask_filename)
#     os.makedirs(settings.OUTPUT_FOLDER, exist_ok=True)

#     with open(mask_local_path, "wb") as f:
#         f.write(buf.getvalue())

#     try:
#         mask_url = await supabase_service.upload_image(
#             mask_local_path,
#             _mask_bucket(source_bucket),
#             mask_storage,
#         )
#     finally:
#         try:
#             os.remove(mask_local_path)
#         except OSError:
#             pass

#     return mask_url


# # ── DB helpers ────────────────────────────────────────────────────────────────

# async def _upsert_segmentation(
#     image_id: str,
#     flight_id: str | None,
#     mask_url: str,
#     label_counts: dict,
#     stats: dict,
#     user_id: str,
#     field_id: str | None = None,
#     drone_id: str | None = None,
#     gps: dict | None = None,
# ) -> dict:
#     record = {
#         "user_id":               user_id,
#         "image_id":              image_id,
#         "field_id":              field_id,
#         "flight_id":             flight_id,
#         "drone_id":              drone_id,
#         "heatmap_url":           mask_url,
#         "stress_class":          stats["stress_class"],
#         "confidence":            stats["confidence"],
#         "health_score":          stats["health_score"],
#         "health_percentage":     stats["health_percentage"],
#         "healthy_pixel_count":   stats["healthy_pixel_count"],
#         "stressed_pixel_count":  stats["stressed_pixel_count"],
#         "ndvi_mean":             None,
#         "gndvi_mean":            None,
#         "gps":                   gps,
#     }
#     return await supabase_service.save_segmentation(record)


# async def _fetch_cached(image_id: str) -> dict | None:
#     client = supabase_service.get_supabase()
#     if not client:
#         return None
#     try:
#         res = (
#             client.table("segmentations")
#             .select("*")
#             .eq("image_id", image_id)
#             .order("processed_at", desc=True)
#             .limit(1)
#             .execute()
#         )
#         return res.data[0] if res.data else None
#     except Exception as e:
#         logger.warning("Cache lookup failed for image %s: %s", image_id, e)
#         return None


# # ── GPS helpers ───────────────────────────────────────────────────────────────

# async def _resolve_gps(
#     gps: dict | None,
#     field_id: str | None,
#     client,
# ) -> dict | None:
#     # 1. EXIF GPS — use directly
#     if gps and gps.get("lat") and gps.get("lng"):
#         return gps

#     # 2. Field centroid fallback
#     if not field_id or not client:
#         logger.warning("GPS fallback skipped — no field_id or Supabase unavailable.")
#         return None

#     try:
#         res = (
#             client.table("fields")
#             .select("centroid_lat, centroid_lng, latitude, longitude")
#             .eq("id", field_id)
#             .limit(1)
#             .execute()
#         )
#         if res.data:
#             row = res.data[0]
#             lat = row.get("centroid_lat") or row.get("latitude")
#             lng = row.get("centroid_lng") or row.get("longitude")
#             if lat and lng:
#                 logger.info(
#                     "GPS fallback: using field location for field_id=%s (lat=%.6f, lng=%.6f)",
#                     field_id, lat, lng,
#                 )
#                 return {"lat": lat, "lng": lng}
#             else:
#                 logger.warning("GPS fallback: field %s has no location set.", field_id)
#     except Exception as e:
#         logger.warning("GPS fallback lookup failed for field %s: %s", field_id, e)

#     return None


# # ── Alert helpers ─────────────────────────────────────────────────────────────

# def _severity_from_score(health_score: float, stress_class: str) -> str:
#     """Severity based on stress_class and health_score."""
#     if stress_class == "healthy":
#         if health_score >= 90:
#             return "low"     # very healthy → routine good news
#         return "low"
#     else:
#         # stressed
#         if health_score < _SEVERITY_HIGH_THRESHOLD:
#             return "high"
#         if health_score < _SEVERITY_MEDIUM_THRESHOLD:
#             return "medium"
#         return "low"


# def _should_alert(stats: dict) -> bool:
#     """
#     Send alert for:
#       - healthy crops with health_score >= 70
#       - stressed crops always
#     """
#     stress_class = stats["stress_class"]
#     health_score = stats["health_score"]

#     if stress_class == "healthy" and health_score >= _HEALTHY_ALERT_THRESHOLD:
#         return True
#     if stress_class == "stressed":
#         return True
#     return False


# async def _trigger_alert(
#     *,
#     image_id: str,
#     flight_id: str | None,
#     field_id: str | None,
#     user_id: str,
#     stats: dict,
#     gps: dict | None,
# ) -> None:
#     """
#     Fire-and-forget alert for both healthy and stressed images.
#     Never raises — errors are logged only.
#     """
#     if not _should_alert(stats):
#         logger.info("No alert needed for image %s (class=%s, score=%.1f)",
#                     image_id, stats["stress_class"], stats["health_score"])
#         return

#     client = supabase_service.get_supabase()

#     resolved_gps = await _resolve_gps(gps, field_id, client)

#     if not resolved_gps or not resolved_gps.get("lat") or not resolved_gps.get("lng"):
#         logger.warning(
#             "Alert skipped for image %s — no GPS coordinates available. "
#             "Ensure the field has latitude/longitude or centroid_lat/centroid_lng set.",
#             image_id,
#         )
#         return

#     if not client:
#         logger.warning("Alert skipped — Supabase unavailable")
#         return

#     try:
#         farmer_id      = user_id
#         resolved_field = field_id

#         if flight_id:
#             flight_res = (
#                 client.table("flights")
#                 .select("user_id, field_id")
#                 .eq("id", flight_id)
#                 .limit(1)
#                 .execute()
#             )
#             if flight_res.data:
#                 farmer_id      = flight_res.data[0]["user_id"]
#                 resolved_field = flight_res.data[0]["field_id"] or field_id

#         severity = _severity_from_score(stats["health_score"], stats["stress_class"])

#         alert_payload = {
#             "farmer_id":    farmer_id,
#             "field_id":     resolved_field or "",
#             "flight_id":    flight_id,
#             "lat":          resolved_gps["lat"],
#             "lng":          resolved_gps["lng"],
#             "health_score": stats["health_score"],
#             "stress_class": stats["stress_class"],
#             "severity":     severity,
#         }

#         async with httpx.AsyncClient() as http:
#             resp = await http.post(
#                 _ALERT_URL,
#                 json=alert_payload,
#                 timeout=_ALERT_TIMEOUT_SECS,
#             )
#             resp.raise_for_status()

#         logger.info(
#             "Alert triggered | image=%s | flight=%s | class=%s | health=%.1f%% | severity=%s",
#             image_id, flight_id, stats["stress_class"], stats["health_score"], severity,
#         )

#     except Exception as e:
#         logger.warning("Alert trigger failed for image %s: %s", image_id, e)


# # ── Core per-image processing ─────────────────────────────────────────────────

# async def _process_one_image(
#     *,
#     image_row: dict,
#     user_id: str,
#     force: bool,
#     tmp_dir: str,
# ) -> dict:
#     image_id     = image_row["id"]
#     storage_path = image_row["storage_path"]
#     bucket       = image_row.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
#     flight_id    = image_row.get("flight_id")
#     field_id     = image_row.get("field_id")
#     drone_id     = image_row.get("drone_id")

#     # ── Cached result ─────────────────────────────────────────────────────
#     if not force:
#         cached = await _fetch_cached(image_id)
#         if cached:
#             logger.info("Returning cached segmentation for image %s", image_id)
#             return {
#                 "image_id":          image_id,
#                 "mask_url":          cached.get("heatmap_url"),
#                 "stress_class":      cached.get("stress_class"),
#                 "health_score":      cached.get("health_score"),
#                 "health_percentage": cached.get("health_percentage"),
#                 "label_counts":      {},
#                 "cached":            True,
#             }

#     # ── Download ──────────────────────────────────────────────────────────
#     ext      = os.path.splitext(storage_path)[1].lower() or ".png"
#     tmp_path = os.path.join(tmp_dir, f"seg_{uuid.uuid4().hex}{ext}")

#     try:
#         await supabase_service.download_image(storage_path, bucket, tmp_path)

#         if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
#             raise RuntimeError(f"Downloaded file is empty: {storage_path}")

#         gps    = extract_gps_from_exif(tmp_path)
#         result = run_segformer(tmp_path)

#         stats = {
#             "stress_class":         result["stress_class"],
#             "confidence":           result["confidence"],
#             "health_score":         result["health_score"],
#             "health_percentage":    result["health_percentage"],
#             "healthy_pixel_count":  result["healthy_pixel_count"],
#             "stressed_pixel_count": result["stressed_pixel_count"],
#         }

#         mask_url = await _upload_mask_image(
#             result["mask_image"], bucket, image_id, user_id, flight_id or "noflight"
#         )

#         saved = await _upsert_segmentation(
#             image_id=image_id,
#             flight_id=flight_id,
#             mask_url=mask_url,
#             label_counts=result["label_counts"],
#             stats=stats,
#             user_id=user_id,
#             field_id=field_id,
#             drone_id=drone_id,
#             gps=gps,
#         )

#         payload = {
#             "image_id":        image_id,
#             "segmentation_id": saved.get("id"),
#             "mask_url":        mask_url,
#             "label_counts":    result["label_counts"],
#             "gps":             gps,
#             "cached":          False,
#             **stats,
#         }

#         await manager.broadcast(payload)
#         logger.info(
#             "Segmented image %s | stress=%s | health=%.1f%%",
#             image_id, stats["stress_class"], stats["health_score"],
#         )

#         # ── Alert for BOTH healthy and stressed ───────────────────────────
#         await _trigger_alert(
#             image_id=image_id,
#             flight_id=flight_id,
#             field_id=field_id,
#             user_id=user_id,
#             stats=stats,
#             gps=gps,
#         )

#         return payload

#     finally:
#         try:
#             os.remove(tmp_path)
#         except OSError:
#             pass


# # ── Routes ────────────────────────────────────────────────────────────────────

# @router.post("/segment/flight/{flight_id}")
# async def segment_flight(
#     flight_id: str,
#     force: bool = False,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     user_id = user["sub"]
#     logger.info("segment_flight | flight_id=%s | user_id=%s", flight_id, user_id)

#     client = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     img_res = (
#         client.table("images")
#         .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#         .eq("flight_id", flight_id)
#         .eq("user_id", user_id)
#         .execute()
#     )
#     flight_images: list[dict] = img_res.data or []
#     logger.info("Images found: %d for flight %s", len(flight_images), flight_id)

#     if not flight_images:
#         all_res = (
#             client.table("images")
#             .select("id, flight_id, user_id, storage_path")
#             .eq("flight_id", flight_id)
#             .limit(5)
#             .execute()
#         )
#         logger.warning(
#             "No images for flight_id=%s with user_id=%s. Any user images: %s",
#             flight_id, user_id, all_res.data,
#         )
#         raise HTTPException(404, f"No images found for flight {flight_id}.")

#     tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#     os.makedirs(tmp_dir, exist_ok=True)

#     results: list[dict] = []
#     errors:  list[dict] = []

#     for img_row in flight_images:
#         try:
#             result = await _process_one_image(
#                 image_row=img_row,
#                 user_id=user_id,
#                 force=force,
#                 tmp_dir=tmp_dir,
#             )
#             results.append(result)
#         except Exception as e:
#             logger.exception("Failed to segment image %s: %s", img_row.get("id"), e)
#             errors.append({"image_id": img_row.get("id"), "error": str(e)})

#     healthy_count = sum(1 for r in results if r.get("stress_class") == "healthy")
#     stressed_count = sum(1 for r in results if r.get("stress_class") == "stressed")

#     return {
#         "flight_id":       flight_id,
#         "processed":       len(results),
#         "failed":          len(errors),
#         "healthy_images":  healthy_count,
#         "stressed_images": stressed_count,
#         "results":         results,
#         "errors":          errors,
#     }


# @router.get("/segment/flight/{flight_id}")
# async def get_flight_segmentations(
#     flight_id: str,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     client = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     try:
#         res = (
#             client.table("segmentations")
#             .select(
#                 "image_id, heatmap_url, stress_class, health_score, health_percentage, "
#                 "healthy_pixel_count, stressed_pixel_count, confidence, processed_at"
#             )
#             .eq("flight_id", flight_id)
#             .order("processed_at", desc=True)
#             .execute()
#         )
#         rows = res.data or []
#     except Exception as e:
#         logger.warning("GET segment/flight/%s: query error %s", flight_id, e)
#         rows = []

#     logger.info("GET segment/flight/%s: %d cached results", flight_id, len(rows))
#     return {
#         "flight_id": flight_id,
#         "count":     len(rows),
#         "results": [
#             {
#                 "image_id":             r["image_id"],
#                 "mask_url":             r["heatmap_url"],
#                 "stress_class":         r.get("stress_class"),
#                 "health_score":         r.get("health_score"),
#                 "health_percentage":    r.get("health_percentage"),
#                 "healthy_pixel_count":  r.get("healthy_pixel_count"),
#                 "stressed_pixel_count": r.get("stressed_pixel_count"),
#                 "confidence":           r.get("confidence"),
#                 "processed_at":         r.get("processed_at"),
#             }
#             for r in rows
#         ],
#     }


# @router.post("/segment/image/{image_id}")
# async def segment_single_image(
#     image_id: str,
#     force: bool = False,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     user_id = user["sub"]
#     client  = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     res = (
#         client.table("images")
#         .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#         .eq("id", image_id)
#         .eq("user_id", user_id)
#         .limit(1)
#         .execute()
#     )
#     if not res.data:
#         raise HTTPException(404, f"Image {image_id} not found")

#     tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#     os.makedirs(tmp_dir, exist_ok=True)

#     result = await _process_one_image(
#         image_row=res.data[0],
#         user_id=user_id,
#         force=force,
#         tmp_dir=tmp_dir,
#     )
#     return {"status": "success", **result}


# async def auto_segment_flight(flight_id: str, user_id: str) -> None:
#     logger.info("auto_segment_flight: starting | flight_id=%s user_id=%s", flight_id, user_id)
#     client = supabase_service.get_supabase()
#     if not client:
#         logger.warning("auto_segment_flight: Supabase unavailable, skipping")
#         return

#     try:
#         img_res = (
#             client.table("images")
#             .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#             .eq("flight_id", flight_id)
#             .eq("user_id", user_id)
#             .execute()
#         )
#         flight_images: list[dict] = img_res.data or []

#         if not flight_images:
#             logger.warning("auto_segment_flight: no images found for flight %s", flight_id)
#             return

#         tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#         os.makedirs(tmp_dir, exist_ok=True)

#         ok = 0
#         for img_row in flight_images:
#             try:
#                 await _process_one_image(
#                     image_row=img_row,
#                     user_id=user_id,
#                     force=False,
#                     tmp_dir=tmp_dir,
#                 )
#                 ok += 1
#             except Exception as e:
#                 logger.exception(
#                     "auto_segment_flight: failed on image %s: %s",
#                     img_row.get("id"), e,
#                 )

#         logger.info(
#             "auto_segment_flight: done | flight_id=%s | %d/%d succeeded",
#             flight_id, ok, len(flight_images),
#         )
#     except Exception as e:
#         logger.exception(
#             "auto_segment_flight: unexpected error for flight %s: %s", flight_id, e
#         )
# from __future__ import annotations

# import io
# import logging
# import os
# import uuid
# from typing import Any

# import httpx
# from fastapi import APIRouter, Depends, HTTPException

# from core.auth import get_current_user
# from core.config import settings
# from core.connection_manager import manager
# from services import supabase_service
# from services.calibration import extract_gps_from_exif
# from services.segformer_inference import run_segformer

# logger = logging.getLogger(__name__)
# router = APIRouter(tags=["Segmentation"])


# # ── Constants ─────────────────────────────────────────────────────────────────

# _HEALTHY_THRESHOLD         = 70   # health_score >= 70 → healthy alert
# _SEVERITY_HIGH_THRESHOLD   = 40   # health_score < 40  → high
# _SEVERITY_MEDIUM_THRESHOLD = 70   # health_score < 70  → medium

# _ALERT_URL          = "http://localhost:8000/api/alerts/stress"
# _ALERT_TIMEOUT_SECS = 10.0


# # ── Storage helpers ───────────────────────────────────────────────────────────

# def _mask_bucket(source_bucket: str) -> str:
#     return f"{source_bucket}-masks"


# async def _upload_mask_image(
#     mask_image,
#     source_bucket: str,
#     image_id: str,
#     user_id: str,
#     flight_id: str,
# ) -> str:
#     buf = io.BytesIO()
#     mask_image.save(buf, format="PNG")
#     buf.seek(0)

#     mask_filename   = f"mask_{uuid.uuid4().hex[:8]}.png"
#     mask_storage    = f"{user_id}/{flight_id or 'noflight'}/{mask_filename}"
#     mask_local_path = os.path.join(settings.OUTPUT_FOLDER, mask_filename)
#     os.makedirs(settings.OUTPUT_FOLDER, exist_ok=True)

#     with open(mask_local_path, "wb") as f:
#         f.write(buf.getvalue())

#     try:
#         mask_url = await supabase_service.upload_image(
#             mask_local_path,
#             _mask_bucket(source_bucket),
#             mask_storage,
#         )
#     finally:
#         try:
#             os.remove(mask_local_path)
#         except OSError:
#             pass

#     return mask_url


# # ── DB helpers ────────────────────────────────────────────────────────────────

# async def _upsert_segmentation(
#     image_id: str,
#     flight_id: str | None,
#     mask_url: str,
#     label_counts: dict,
#     stats: dict,
#     user_id: str,
#     field_id: str | None = None,
#     drone_id: str | None = None,
#     gps: dict | None = None,
# ) -> dict:
#     record = {
#         "user_id":               user_id,
#         "image_id":              image_id,
#         "field_id":              field_id,
#         "flight_id":             flight_id,
#         "drone_id":              drone_id,
#         "heatmap_url":           mask_url,
#         "stress_class":          stats["stress_class"],
#         "confidence":            stats["confidence"],
#         "health_score":          stats["health_score"],
#         "health_percentage":     stats["health_percentage"],
#         "healthy_pixel_count":   stats["healthy_pixel_count"],
#         "stressed_pixel_count":  stats["stressed_pixel_count"],
#         "ndvi_mean":             None,
#         "gndvi_mean":            None,
#         "gps":                   gps,
#     }
#     return await supabase_service.save_segmentation(record)


# async def _fetch_cached(image_id: str) -> dict | None:
#     client = supabase_service.get_supabase()
#     if not client:
#         return None
#     try:
#         res = (
#             client.table("segmentations")
#             .select("*")
#             .eq("image_id", image_id)
#             .order("processed_at", desc=True)
#             .limit(1)
#             .execute()
#         )
#         return res.data[0] if res.data else None
#     except Exception as e:
#         logger.warning("Cache lookup failed for image %s: %s", image_id, e)
#         return None


# # ── GPS helpers ───────────────────────────────────────────────────────────────

# async def _resolve_gps(
#     gps: dict | None,
#     field_id: str | None,
#     client,
# ) -> dict | None:
#     # 1. EXIF GPS — use directly
#     if gps and gps.get("lat") and gps.get("lng"):
#         return gps

#     # 2. Field centroid fallback
#     if not field_id or not client:
#         logger.warning("GPS fallback skipped — no field_id or Supabase unavailable.")
#         return None

#     try:
#         res = (
#             client.table("fields")
#             .select("centroid_lat, centroid_lng, latitude, longitude")
#             .eq("id", field_id)
#             .limit(1)
#             .execute()
#         )
#         if res.data:
#             row = res.data[0]
#             lat = row.get("centroid_lat") or row.get("latitude")
#             lng = row.get("centroid_lng") or row.get("longitude")
#             if lat and lng:
#                 logger.info(
#                     "GPS fallback: using field location for field_id=%s (lat=%.6f, lng=%.6f)",
#                     field_id, lat, lng,
#                 )
#                 return {"lat": lat, "lng": lng}
#             else:
#                 logger.warning("GPS fallback: field %s has no location set.", field_id)
#     except Exception as e:
#         logger.warning("GPS fallback lookup failed for field %s: %s", field_id, e)

#     return None


# # ── Alert helpers ─────────────────────────────────────────────────────────────

# def _severity_from_score(health_score: float) -> str:
#     if health_score < _SEVERITY_HIGH_THRESHOLD:
#         return "high"
#     if health_score < _SEVERITY_MEDIUM_THRESHOLD:
#         return "medium"
#     return "low"


# async def _trigger_alert(
#     *,
#     image_id: str,
#     flight_id: str | None,
#     field_id: str | None,
#     user_id: str,
#     stats: dict,
#     gps: dict | None,
# ) -> None:
#     """
#     Fire-and-forget alert. Only fires for HEALTHY crops (health_score >= 70).
#     Never raises — errors are logged only.
#     """
#     # ── Only alert for healthy crops ────────────────────────────────────
#     if stats["stress_class"] != "healthy":
#         logger.info(
#             "Alert skipped for image %s — stress_class=%s",
#             image_id, stats["stress_class"],
#         )
#         return

#     client = supabase_service.get_supabase()

#     resolved_gps = await _resolve_gps(gps, field_id, client)

#     if not resolved_gps or not resolved_gps.get("lat") or not resolved_gps.get("lng"):
#         logger.warning(
#             "Alert skipped for image %s — no GPS coordinates available. "
#             "Ensure the field has centroid_lat/centroid_lng set.",
#             image_id,
#         )
#         return

#     if not client:
#         logger.warning("Alert skipped — Supabase unavailable")
#         return

#     try:
#         farmer_id      = user_id
#         resolved_field = field_id

#         if flight_id:
#             flight_res = (
#                 client.table("flights")
#                 .select("user_id, field_id")
#                 .eq("id", flight_id)
#                 .limit(1)
#                 .execute()
#             )
#             if flight_res.data:
#                 farmer_id      = flight_res.data[0]["user_id"]
#                 resolved_field = flight_res.data[0]["field_id"] or field_id

#         severity = _severity_from_score(stats["health_score"])

#         alert_payload = {
#             "farmer_id":    farmer_id,
#             "field_id":     resolved_field or "",
#             "flight_id":    flight_id,
#             "lat":          resolved_gps["lat"],
#             "lng":          resolved_gps["lng"],
#             "health_score": stats["health_score"],
#             "severity":     severity,
#         }

#         async with httpx.AsyncClient() as http:
#             resp = await http.post(
#                 _ALERT_URL,
#                 json=alert_payload,
#                 timeout=_ALERT_TIMEOUT_SECS,
#             )
#             resp.raise_for_status()

#         logger.info(
#             "Alert triggered | image=%s | flight=%s | class=%s | health=%.1f%% | severity=%s",
#             image_id, flight_id, stats["stress_class"], stats["health_score"], severity,
#         )

#     except Exception as e:
#         logger.warning("Alert trigger failed for image %s: %s", image_id, e)


# # ── Core per-image processing ─────────────────────────────────────────────────

# async def _process_one_image(
#     *,
#     image_row: dict,
#     user_id: str,
#     force: bool,
#     tmp_dir: str,
# ) -> dict:
#     image_id     = image_row["id"]
#     storage_path = image_row["storage_path"]
#     bucket       = image_row.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
#     flight_id    = image_row.get("flight_id")
#     field_id     = image_row.get("field_id")
#     drone_id     = image_row.get("drone_id")

#     # ── Return cached result unless forced ────────────────────────────────
#     if not force:
#         cached = await _fetch_cached(image_id)
#         if cached:
#             logger.info("Returning cached segmentation for image %s", image_id)
#             return {
#                 "image_id":          image_id,
#                 "mask_url":          cached.get("heatmap_url"),
#                 "stress_class":      cached.get("stress_class"),
#                 "health_score":      cached.get("health_score"),
#                 "health_percentage": cached.get("health_percentage"),
#                 "label_counts":      {},
#                 "cached":            True,
#             }

#     ext      = os.path.splitext(storage_path)[1].lower() or ".png"
#     tmp_path = os.path.join(tmp_dir, f"seg_{uuid.uuid4().hex}{ext}")

#     try:
#         await supabase_service.download_image(storage_path, bucket, tmp_path)

#         if not os.path.exists(tmp_path) or os.path.getsize(tmp_path) == 0:
#             raise RuntimeError(f"Downloaded file is empty: {storage_path}")

#         gps    = extract_gps_from_exif(tmp_path)
#         result = run_segformer(tmp_path)

#         stats = {
#             "stress_class":         result["stress_class"],
#             "confidence":           result["confidence"],
#             "health_score":         result["health_score"],
#             "health_percentage":    result["health_percentage"],
#             "healthy_pixel_count":  result["healthy_pixel_count"],
#             "stressed_pixel_count": result["stressed_pixel_count"],
#         }

#         mask_url = await _upload_mask_image(
#             result["mask_image"], bucket, image_id, user_id, flight_id or "noflight"
#         )

#         saved = await _upsert_segmentation(
#             image_id=image_id,
#             flight_id=flight_id,
#             mask_url=mask_url,
#             label_counts=result["label_counts"],
#             stats=stats,
#             user_id=user_id,
#             field_id=field_id,
#             drone_id=drone_id,
#             gps=gps,
#         )

#         payload = {
#             "image_id":        image_id,
#             "segmentation_id": saved.get("id"),
#             "mask_url":        mask_url,
#             "label_counts":    result["label_counts"],
#             "gps":             gps,
#             "cached":          False,
#             **stats,
#         }

#         await manager.broadcast(payload)
#         logger.info(
#             "Segmented image %s | stress=%s | health=%.1f%%",
#             image_id, stats["stress_class"], stats["health_score"],
#         )

#         # ── Alert only for healthy crops ──────────────────────────────────
#         await _trigger_alert(
#             image_id=image_id,
#             flight_id=flight_id,
#             field_id=field_id,
#             user_id=user_id,
#             stats=stats,
#             gps=gps,
#         )

#         return payload

#     finally:
#         try:
#             os.remove(tmp_path)
#         except OSError:
#             pass


# # ── Routes ────────────────────────────────────────────────────────────────────

# @router.post("/segment/flight/{flight_id}")
# async def segment_flight(
#     flight_id: str,
#     force: bool = False,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     user_id = user["sub"]
#     logger.info("segment_flight | flight_id=%s | user_id=%s", flight_id, user_id)

#     client = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     img_res = (
#         client.table("images")
#         .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#         .eq("flight_id", flight_id)
#         .eq("user_id", user_id)
#         .execute()
#     )
#     flight_images: list[dict] = img_res.data or []
#     logger.info("Images found: %d for flight %s", len(flight_images), flight_id)

#     if not flight_images:
#         all_res = (
#             client.table("images")
#             .select("id, flight_id, user_id, storage_path")
#             .eq("flight_id", flight_id)
#             .limit(5)
#             .execute()
#         )
#         logger.warning(
#             "No images for flight_id=%s with user_id=%s. Any user images: %s",
#             flight_id, user_id, all_res.data,
#         )
#         raise HTTPException(404, f"No images found for flight {flight_id}.")

#     tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#     os.makedirs(tmp_dir, exist_ok=True)

#     results: list[dict] = []
#     errors:  list[dict] = []

#     for img_row in flight_images:
#         try:
#             result = await _process_one_image(
#                 image_row=img_row,
#                 user_id=user_id,
#                 force=force,
#                 tmp_dir=tmp_dir,
#             )
#             results.append(result)
#         except Exception as e:
#             logger.exception("Failed to segment image %s: %s", img_row.get("id"), e)
#             errors.append({"image_id": img_row.get("id"), "error": str(e)})

#     healthy_count  = sum(1 for r in results if r.get("stress_class") == "healthy")
#     stressed_count = sum(1 for r in results if r.get("stress_class") == "stressed")

#     return {
#         "flight_id":       flight_id,
#         "processed":       len(results),
#         "failed":          len(errors),
#         "healthy_images":  healthy_count,
#         "stressed_images": stressed_count,
#         "results":         results,
#         "errors":          errors,
#     }


# @router.get("/segment/flight/{flight_id}")
# async def get_flight_segmentations(
#     flight_id: str,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     client = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     try:
#         res = (
#             client.table("segmentations")
#             .select(
#                 "image_id, heatmap_url, stress_class, health_score, health_percentage, "
#                 "healthy_pixel_count, stressed_pixel_count, confidence, processed_at"
#             )
#             .eq("flight_id", flight_id)
#             .order("processed_at", desc=True)
#             .execute()
#         )
#         rows = res.data or []
#     except Exception as e:
#         logger.warning("GET segment/flight/%s: query error %s", flight_id, e)
#         rows = []

#     logger.info("GET segment/flight/%s: %d cached results", flight_id, len(rows))
#     return {
#         "flight_id": flight_id,
#         "count":     len(rows),
#         "results": [
#             {
#                 "image_id":             r["image_id"],
#                 "mask_url":             r["heatmap_url"],
#                 "stress_class":         r.get("stress_class"),
#                 "health_score":         r.get("health_score"),
#                 "health_percentage":    r.get("health_percentage"),
#                 "healthy_pixel_count":  r.get("healthy_pixel_count"),
#                 "stressed_pixel_count": r.get("stressed_pixel_count"),
#                 "confidence":           r.get("confidence"),
#                 "processed_at":         r.get("processed_at"),
#             }
#             for r in rows
#         ],
#     }


# @router.post("/segment/image/{image_id}")
# async def segment_single_image(
#     image_id: str,
#     force: bool = False,
#     user: Any = Depends(get_current_user),
# ) -> dict:
#     user_id = user["sub"]
#     client  = supabase_service.get_supabase()
#     if not client:
#         raise HTTPException(503, "Supabase unavailable")

#     res = (
#         client.table("images")
#         .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#         .eq("id", image_id)
#         .eq("user_id", user_id)
#         .limit(1)
#         .execute()
#     )
#     if not res.data:
#         raise HTTPException(404, f"Image {image_id} not found")

#     tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#     os.makedirs(tmp_dir, exist_ok=True)

#     result = await _process_one_image(
#         image_row=res.data[0],
#         user_id=user_id,
#         force=force,
#         tmp_dir=tmp_dir,
#     )
#     return {"status": "success", **result}


# async def auto_segment_flight(flight_id: str, user_id: str) -> None:
#     logger.info("auto_segment_flight: starting | flight_id=%s user_id=%s", flight_id, user_id)
#     client = supabase_service.get_supabase()
#     if not client:
#         logger.warning("auto_segment_flight: Supabase unavailable, skipping")
#         return

#     try:
#         img_res = (
#             client.table("images")
#             .select("id, storage_path, bucket_name, flight_id, field_id, drone_id")
#             .eq("flight_id", flight_id)
#             .eq("user_id", user_id)
#             .execute()
#         )
#         flight_images: list[dict] = img_res.data or []

#         if not flight_images:
#             logger.warning("auto_segment_flight: no images found for flight %s", flight_id)
#             return

#         tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "tmp")
#         os.makedirs(tmp_dir, exist_ok=True)

#         ok = 0
#         for img_row in flight_images:
#             try:
#                 await _process_one_image(
#                     image_row=img_row,
#                     user_id=user_id,
#                     force=False,
#                     tmp_dir=tmp_dir,
#                 )
#                 ok += 1
#             except Exception as e:
#                 logger.exception(
#                     "auto_segment_flight: failed on image %s: %s",
#                     img_row.get("id"), e,
#                 )

#         logger.info(
#             "auto_segment_flight: done | flight_id=%s | %d/%d succeeded",
#             flight_id, ok, len(flight_images),
#         )
#     except Exception as e:
#         logger.exception(
#             "auto_segment_flight: unexpected error for flight %s: %s", flight_id, e
#         )