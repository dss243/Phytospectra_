"""Aggregate SegFormer/ViT segmentations and flight GPS verification."""
from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import Any, Optional

from core.config import settings
from services import supabase_service
from services.supabase_service import FLIGHTS_ORDER_COLUMN, normalize_flight_row
from services.gps_utils import (
    extract_gps_from_exif_strict,
    health_bucket,
    normalize_gps,
    point_in_boundary,
)

logger = logging.getLogger(__name__)


def _require_flight(client, flight_id: str, user_id: str) -> dict:
    res = (
        client.table("flights")
        .select("*, fields(field_name, boundary, latitude, longitude)")
        .eq("id", flight_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        return None
    row = res.data[0]
    fields = row.pop("fields", None) or {}
    if isinstance(fields, dict):
        row["field_name"] = fields.get("field_name")
        row["boundary"] = fields.get("boundary")
        row["field_latitude"] = fields.get("latitude")
        row["field_longitude"] = fields.get("longitude")
    return row


def _latest_segmentation_per_image(segs: list[dict]) -> dict[str, dict]:
    """Keep newest segmentation row per image_id."""
    by_image: dict[str, dict] = {}
    for s in segs:
        iid = s.get("image_id")
        if not iid:
            continue
        prev = by_image.get(iid)
        if not prev:
            by_image[iid] = s
            continue
        prev_ts = prev.get("processed_at") or ""
        cur_ts = s.get("processed_at") or ""
        if cur_ts >= prev_ts:
            by_image[iid] = s
    return by_image


def _model_source(seg: dict) -> str:
    """ViT pipeline sets ndvi_mean; SegFormer flight path leaves it null."""
    if seg.get("ndvi_mean") is not None:
        return "vit"
    return "segformer"


async def get_flight_segmentation_points(flight_id: str, user_id: str) -> list[dict]:
    client = supabase_service.get_supabase()
    if not client:
        return []
    segs = await supabase_service.get_segmentations(user_id=user_id, flight_id=flight_id, limit=500)
    by_image = _latest_segmentation_per_image(segs)
    points = []
    for image_id, seg in by_image.items():
        img = seg.get("images") or {}
        gps = normalize_gps(seg.get("gps")) or normalize_gps(img.get("gps"))
        if not gps:
            continue
        points.append({
            "image_id": image_id,
            "segmentation_id": seg.get("id"),
            "lat": gps["lat"],
            "lng": gps["lng"],
            "health_score": seg.get("health_score"),
            "stress_class": seg.get("stress_class"),
            "confidence": seg.get("confidence"),
            "heatmap_url": seg.get("heatmap_url"),
            "ndvi_mean": seg.get("ndvi_mean"),
            "model": _model_source(seg),
            "storage_path": img.get("storage_path"),
            "processed_at": seg.get("processed_at"),
        })
    return points


async def get_field_analytics(user_id: str, field_id: str, limit_flights: int = 12) -> dict:
    client = supabase_service.get_supabase()
    if not client:
        return {"trends": [], "stress_by_flight": [], "summary": {}}

    flights_res = (
        client.table("flights")
        .select(f"id, field_id, {FLIGHTS_ORDER_COLUMN}")
        .eq("user_id", user_id)
        .eq("field_id", field_id)
        .order(FLIGHTS_ORDER_COLUMN, desc=True)
        .limit(limit_flights)
        .execute()
    )
    flights = [normalize_flight_row(f) for f in reversed(flights_res.data or [])]

    segs = await supabase_service.get_segmentations(user_id=user_id, field_id=field_id, limit=2000)
    by_flight: dict[str, list] = {}
    for s in segs:
        fid = s.get("flight_id")
        if fid:
            by_flight.setdefault(fid, []).append(s)

    trends = []
    stress_by_flight = []
    all_scores = []

    for fl in flights:
        fid = fl["id"]
        latest = _latest_segmentation_per_image(by_flight.get(fid, []))
        scores = [x.get("health_score") for x in latest.values() if x.get("health_score") is not None]
        if not scores:
            continue
        avg = round(sum(scores) / len(scores), 1)
        all_scores.extend(scores)
        date_label = (fl.get("flight_date") or "")[:10] or fid[:8]
        trends.append({"date": date_label, "health": avg, "flight_id": fid, "images": len(scores)})

        buckets = {"healthy": 0, "mild": 0, "moderate": 0, "severe": 0}
        for seg in latest.values():
            b = health_bucket(seg.get("health_score"))
            if b in buckets:
                buckets[b] += 1
        stress_by_flight.append({
            "flight": date_label,
            "flight_id": fid,
            **buckets,
        })

    summary = {
        "avg_health": round(sum(all_scores) / len(all_scores), 1) if all_scores else None,
        "total_images_analyzed": len(all_scores),
        "flights_with_data": len(trends),
    }
    return {"trends": trends, "stress_by_flight": stress_by_flight, "summary": summary}


async def verify_flight_gps(flight_id: str, user_id: str) -> dict:
    client = supabase_service.get_supabase()
    if not client:
        raise RuntimeError("Supabase not available")

    flight = _require_flight(client, flight_id, user_id)
    if not flight:
        raise ValueError("Flight not found")

    boundary = flight.get("boundary")
    images_res = (
        client.table("images")
        .select("*")
        .eq("flight_id", flight_id)
        .eq("user_id", user_id)
        .execute()
    )
    images = images_res.data or []
    tmp_dir = os.path.join(settings.OUTPUT_FOLDER, "gps_verify")
    os.makedirs(tmp_dir, exist_ok=True)

    results = []
    ok_count = 0

    for img in images:
        image_id = img["id"]
        storage_path = img.get("storage_path")
        bucket = img.get("bucket_name") or settings.SUPABASE_BUCKET_RAW
        stored = normalize_gps(img.get("gps"))
        ext = os.path.splitext(storage_path or "")[1].lower() or ".jpg"
        tmp_path = os.path.join(tmp_dir, f"gps_{uuid.uuid4().hex}{ext}")

        exif_gps = None
        status = "missing_exif"
        inside_field = None

        try:
            if storage_path:
                await supabase_service.download_image(storage_path, bucket, tmp_path)
                if os.path.exists(tmp_path) and os.path.getsize(tmp_path) > 0:
                    exif_gps = extract_gps_from_exif_strict(tmp_path)
        except Exception as e:
            logger.warning(f"GPS verify download failed for {image_id}: {e}")
        finally:
            if os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

        final_gps = exif_gps or stored
        if exif_gps:
            if stored and (
                abs(stored["lat"] - exif_gps["lat"]) > 0.0001
                or abs(stored["lng"] - exif_gps["lng"]) > 0.0001
            ):
                status = "corrected"
            else:
                status = "verified"
            gps_source = "EXIF_VERIFIED"
        elif stored:
            status = "stored_only"
            gps_source = img.get("gps_source") or "UNKNOWN"
        else:
            status = "missing_exif"
            gps_source = "MISSING"

        if final_gps:
            inside_field = point_in_boundary(final_gps["lat"], final_gps["lng"], boundary)
            if inside_field is False:
                status = "outside_field"
                gps_source = "OUTSIDE_FIELD"
            elif status == "verified":
                ok_count += 1

        if final_gps and exif_gps:
            client.table("images").update({
                "gps": final_gps,
                "gps_source": gps_source,
            }).eq("id", image_id).eq("user_id", user_id).execute()
            client.table("segmentations").update({
                "gps": final_gps,
            }).eq("image_id", image_id).eq("user_id", user_id).execute()

        results.append({
            "image_id": image_id,
            "storage_path": storage_path,
            "status": status,
            "gps": final_gps,
            "inside_field": inside_field,
            "had_stored_gps": stored is not None,
        })

    return {
        "flight_id": flight_id,
        "field_id": flight.get("field_id"),
        "total_images": len(images),
        "verified_count": ok_count,
        "all_ok": ok_count == len(images) and len(images) > 0,
        "images": results,
    }
