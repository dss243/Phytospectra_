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
    chart_zone_bucket,
    normalize_gps,
    point_in_boundary,
    stress_zone_bucket,
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
    empty_zones = [
        {"name": "Healthy", "value": 0},
        {"name": "Mild", "value": 0},
        {"name": "Moderate", "value": 0},
        {"name": "Severe", "value": 0},
        {"name": "Not analyzed", "value": 0},
    ]
    if not client:
        return {
            "trends": [],
            "stress_by_flight": [],
            "zone_distribution": empty_zones,
            "summary": {},
        }

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
    images = await supabase_service.get_images(user_id=user_id, field_id=field_id, limit=2000)

    images_by_flight: dict[str, list] = {}
    for img in images:
        fid = img.get("flight_id")
        if fid:
            images_by_flight.setdefault(fid, []).append(img)

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
        flight_images = images_by_flight.get(fid, [])
        latest = _latest_segmentation_per_image(by_flight.get(fid, []))
        analyzed_ids = set(latest.keys())

        buckets = {"healthy": 0, "mild": 0, "moderate": 0, "severe": 0, "not_analyzed": 0}
        for seg in latest.values():
            b = chart_zone_bucket(seg.get("health_score"), seg.get("stress_class"))
            if b in buckets:
                buckets[b] += 1
        buckets["not_analyzed"] = sum(
            1 for img in flight_images if img.get("id") not in analyzed_ids
        )

        scores = [
            x.get("health_score")
            for x in latest.values()
            if x.get("health_score") is not None
        ]
        date_label = (fl.get("flight_date") or "")[:10] or fid[:8]

        if scores:
            avg = round(sum(scores) / len(scores), 1)
            all_scores.extend(scores)
            trends.append({
                "date": date_label,
                "health": avg,
                "flight_id": fid,
                "images": len(flight_images) or len(latest),
                "analyzed": len(latest),
            })

        if latest or flight_images:
            stress_by_flight.append({
                "flight": date_label,
                "flight_id": fid,
                **buckets,
            })

    summary = {
        "avg_health": round(sum(all_scores) / len(all_scores), 1) if all_scores else None,
        "total_images_analyzed": len(all_scores),
        "total_images_uploaded": len(images),
        "flights_with_data": len(trends),
    }

    by_image = _latest_segmentation_per_image(segs)
    segmented_ids = set(by_image.keys())
    zone_buckets = {"healthy": 0, "mild": 0, "moderate": 0, "severe": 0, "not_analyzed": 0}
    for seg in by_image.values():
        b = chart_zone_bucket(seg.get("health_score"), seg.get("stress_class"))
        if b in zone_buckets:
            zone_buckets[b] += 1
    zone_buckets["not_analyzed"] = sum(
        1 for img in images if img.get("id") not in segmented_ids
    )

    zone_distribution = [
        {"name": "Healthy", "value": zone_buckets["healthy"]},
        {"name": "Mild", "value": zone_buckets["mild"]},
        {"name": "Moderate", "value": zone_buckets["moderate"]},
        {"name": "Severe", "value": zone_buckets["severe"]},
        {"name": "Not analyzed", "value": zone_buckets["not_analyzed"]},
    ]

    return {
        "trends": trends,
        "stress_by_flight": stress_by_flight,
        "zone_distribution": zone_distribution,
        "summary": summary,
    }


async def get_field_stress_map_data(user_id: str, field_id: str) -> dict | None:
    """Latest SegFormer/ViT point per image for a field — for Field Analytics map."""
    client = supabase_service.get_supabase()
    if not client:
        return None

    field_res = (
        client.table("fields")
        .select("id, field_name, latitude, longitude, boundary")
        .eq("id", field_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    )
    if not field_res.data:
        return None

    field = field_res.data[0]
    segs = await supabase_service.get_segmentations(
        user_id=user_id, field_id=field_id, limit=2000,
    )
    images = await supabase_service.get_images(
        user_id=user_id, field_id=field_id, limit=2000,
    )
    by_image = _latest_segmentation_per_image(segs)
    image_ids = list(by_image.keys())

    gps_by_image: dict[str, dict] = {}
    all_image_ids = {img.get("id") for img in images if img.get("id")}
    all_image_ids.update(image_ids)
    if all_image_ids:
        try:
            img_res = (
                client.table("images")
                .select("id, gps, gps_source, upload_source")
                .in_("id", list(all_image_ids))
                .execute()
            )
            for img in img_res.data or []:
                g = normalize_gps(img.get("gps"))
                if g:
                    gps_by_image[img["id"]] = {
                        "gps": g,
                        "gps_source": img.get("gps_source"),
                        "upload_source": img.get("upload_source"),
                    }
        except Exception as e:
            logger.warning("stress-map image GPS lookup failed: %s", e)

    field_gps = normalize_gps(
        {"lat": field.get("latitude"), "lng": field.get("longitude")},
    )

    segmentation_points: list[dict] = []
    segmented_ids: set[str] = set()
    for image_id, seg in by_image.items():
        img = seg.get("images") if isinstance(seg.get("images"), dict) else {}
        gps = None
        gps_source = "missing"
        meta = gps_by_image.get(image_id) or {}
        seg_gps = normalize_gps(seg.get("gps"))
        img_gps = meta.get("gps") or normalize_gps(img.get("gps"))
        if seg_gps:
            gps = seg_gps
            gps_source = "segmentation"
        elif img_gps:
            gps = img_gps
            gps_source = meta.get("gps_source") or "image"
        if not gps:
            continue
        segmented_ids.add(image_id)
        segmentation_points.append({
            "image_id": image_id,
            "lat": gps["lat"],
            "lng": gps["lng"],
            "gps_source": gps_source,
            "health_score": seg.get("health_score"),
            "stress_class": seg.get("stress_class"),
            "confidence": seg.get("confidence"),
            "flight_id": seg.get("flight_id"),
            "model": _model_source(seg),
            "pin_kind": "segmented",
        })

    uploaded_points: list[dict] = []
    for img in images:
        iid = img.get("id")
        if not iid or iid in segmented_ids:
            continue
        meta = gps_by_image.get(iid) or {}
        gps = meta.get("gps") or normalize_gps(img.get("gps"))
        if not gps:
            continue
        uploaded_points.append({
            "image_id": iid,
            "lat": gps["lat"],
            "lng": gps["lng"],
            "gps_source": meta.get("gps_source") or img.get("gps_source") or "upload",
            "upload_source": meta.get("upload_source") or img.get("upload_source"),
            "flight_id": img.get("flight_id"),
            "pin_kind": "uploaded",
        })

    return {
        "field": {
            "id": field["id"],
            "field_name": field.get("field_name"),
            "latitude": field.get("latitude"),
            "longitude": field.get("longitude"),
            "boundary": field.get("boundary"),
        },
        "field_gps": field_gps,
        "points": segmentation_points,
        "uploaded_points": uploaded_points,
        "count": len(segmentation_points),
        "uploaded_count": len(uploaded_points),
    }


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
