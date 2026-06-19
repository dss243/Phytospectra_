from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
import asyncio
import logging

from core.connection_manager import manager
from services.supabase_service import get_supabase
from services.email_service import notify_stress_alert_emails
from core.auth import get_current_user

router = APIRouter()
logger = logging.getLogger(__name__)


class LocationPayload(BaseModel):
    lat: float
    lng: float


class StressAlertPayload(BaseModel):
    farmer_id: str
    field_id: str
    flight_id: Optional[str] = None
    lat: float
    lng: float
    health_score: float
    severity: str = "medium"
    message: Optional[str] = None


@router.post("/alerts/stress")
async def send_stress_alert(payload: StressAlertPayload):
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase client not available")

    # ── DEBUG: check agronomist_locations table ─────────────────────────
    try:
        loc_check = supabase.table("agronomist_locations").select("*").execute()
        logger.info("agronomist_locations rows: %s", loc_check.data)
    except Exception as e:
        logger.error("agronomist_locations check failed: %s", e)

    # ── Resolve field centroid for better agronomist matching ───────────
    field_lat = payload.lat
    field_lng = payload.lng

    if payload.field_id:
        try:
            field_res = supabase.table("fields") \
                .select("centroid_lat, centroid_lng, latitude, longitude") \
                .eq("id", payload.field_id) \
                .limit(1).execute()
            if field_res.data:
                row = field_res.data[0]
                lat = row.get("centroid_lat") or row.get("latitude")
                lng = row.get("centroid_lng") or row.get("longitude")
                if lat and lng:
                    field_lat = lat
                    field_lng = lng
                    logger.info("Using field location: %.6f, %.6f", field_lat, field_lng)
                else:
                    logger.warning("Field %s has no location set", payload.field_id)
        except Exception as e:
            logger.warning("Field location lookup failed: %s", e)

    # ── Find nearest agronomist ─────────────────────────────────────────
    agronomist_id = None
    agro_name     = None
    agro_dist_km  = None

    try:
        agro_res = supabase.rpc(
            "find_nearest_agronomist",
            {"farm_lat": field_lat, "farm_lng": field_lng}
        ).execute()
        logger.info("RPC result: %s", agro_res.data)

        if agro_res.data:
            agronomist_id = agro_res.data[0]["agronomist_id"]
            agro_name     = agro_res.data[0]["display_name"]
            agro_dist_km  = agro_res.data[0]["distance_km"]
            logger.info("Nearest agronomist: %s (%.1f km)", agro_name, agro_dist_km)
        else:
            logger.warning("RPC returned empty — no agronomist has location set")

    except Exception as e:
        logger.error("find_nearest_agronomist RPC failed: %s", e)

    # ── DIAGNOSTIC: confirm values before insert ────────────────────────
    logger.info(
        "PRE-INSERT | farmer_id=%s | agronomist_id=%s",
        payload.farmer_id,
        agronomist_id,
    )

    # ── Build message ───────────────────────────────────────────────────
    if payload.message:
        auto_message = payload.message
    elif agronomist_id:
        stressed_note = ""
        if payload.health_score <= 70:
            stressed_note = f" (~{100 - payload.health_score:.0f}% stressed)"
        auto_message = (
            f"⚠️ Crop stress detected — health score {payload.health_score:.0f}%"
            f"{stressed_note}. "
            f"Nearest agronomist ({agro_name}, {agro_dist_km:.1f} km) has been notified."
        )
    else:
        stressed_note = ""
        if payload.health_score <= 70:
            stressed_note = f" (~{100 - payload.health_score:.0f}% stressed)"
        auto_message = (
            f"⚠️ Crop stress detected — health score {payload.health_score:.0f}%"
            f"{stressed_note}. "
            "No agronomist currently available nearby."
        )

    # ── Insert alert ────────────────────────────────────────────────────
    try:
        insert_res = supabase.table("alerts").insert({
            "farmer_id":     payload.farmer_id,
            "agronomist_id": agronomist_id,        # None if no agronomist found
            "field_id":      payload.field_id,
            "flight_id":     payload.flight_id,
            "alert_type":    "stress",
            "severity":      payload.severity,
            "message":       auto_message,
            "health_score":  payload.health_score,
            "lat":           payload.lat,
            "lng":           payload.lng,
        }).execute()

        if not insert_res.data:
            raise HTTPException(status_code=500, detail="Alert insert returned no data")

        alert_id = insert_res.data[0]["id"]
        logger.info(
            "Alert inserted | id=%s | farmer=%s | agronomist=%s",
            alert_id, payload.farmer_id, agronomist_id
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to insert alert: %s", e)
        raise HTTPException(status_code=500, detail=f"Failed to insert alert: {e}")

    # ── WebSocket broadcast ─────────────────────────────────────────────
    ws_payload = {
        "type":          "stress_alert",
        "alert_id":      alert_id,
        "farmer_id":     payload.farmer_id,
        "agronomist_id": agronomist_id,
        "field_id":      payload.field_id,
        "severity":      payload.severity,
        "health_score":  payload.health_score,
        "message":       auto_message,
        "lat":           payload.lat,
        "lng":           payload.lng,
    }

    farmer_reached = await manager.send_to_user(payload.farmer_id, ws_payload)
    agro_reached   = False
    if agronomist_id:
        agro_reached = await manager.send_to_user(agronomist_id, ws_payload)

    logger.info(
        "Alert %s dispatched | farmer_ws=%s | agro_ws=%s",
        alert_id, farmer_reached, agro_reached
    )

    # ── Email farmer + agronomist (phytospectra@gmail.com via Gmail SMTP) ───
    emailed = await asyncio.to_thread(
        notify_stress_alert_emails,
        supabase,
        farmer_id=payload.farmer_id,
        agronomist_id=agronomist_id,
        field_id=payload.field_id,
        health_score=payload.health_score,
        severity=payload.severity,
        message=auto_message,
        lat=payload.lat,
        lng=payload.lng,
    )
    if emailed:
        logger.info("Alert %s emailed to: %s", alert_id, ", ".join(emailed))

    return {
        "alert_id":       alert_id,
        "agronomist_id":  agronomist_id,
        "message":        auto_message,
        "farmer_reached": farmer_reached,
        "agro_reached":   agro_reached,
        "emailed_to":     emailed,
    }


@router.get("/alerts")
async def get_alerts(user=Depends(get_current_user)):
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase client not available")

    user_id = user.get("sub") or user.get("id")

    # ── Use user_roles table (CropSense source of truth) ─────────────────
    try:
        role_res = supabase.table("user_roles") \
            .select("role") \
            .eq("user_id", user_id) \
            .limit(1).execute()
        role = role_res.data[0]["role"] if role_res.data else "farmer"
    except Exception:
        role = "farmer"

    logger.info("GET /alerts | user=%s | role=%s", user_id, role)

    try:
        if role == "agronomist":
            res = supabase.table("alerts") \
                .select("*") \
                .eq("agronomist_id", user_id) \
                .order("created_at", desc=True) \
                .limit(50).execute()
        else:
            res = supabase.table("alerts") \
                .select("*") \
                .eq("farmer_id", user_id) \
                .order("created_at", desc=True) \
                .limit(50).execute()

        logger.info("Alerts found: %d for user=%s role=%s", len(res.data or []), user_id, role)
        return res.data or []

    except Exception as e:
        logger.error("Failed to fetch alerts: %s", e)
        raise HTTPException(status_code=500, detail="Failed to fetch alerts")


@router.patch("/profile/location")
async def update_agronomist_location(
    body: LocationPayload,
    user=Depends(get_current_user)
):
    supabase = get_supabase()
    if not supabase:
        raise HTTPException(status_code=503, detail="Supabase unavailable")

    user_id = user.get("sub") or user.get("id")

    # ── Guard: only agronomists should update their location ────────────
    try:
        role_res = supabase.table("user_roles") \
            .select("role") \
            .eq("user_id", user_id) \
            .limit(1).execute()
        role = role_res.data[0]["role"] if role_res.data else None
    except Exception:
        role = None

    if role != "agronomist":
        raise HTTPException(status_code=403, detail="Only agronomists can update location")

    supabase.table("agronomist_locations").upsert({
        "agronomist_id": user_id,
        "lat":           body.lat,
        "lng":           body.lng,
    }, on_conflict="agronomist_id").execute()

    logger.info(
        "Location updated | agronomist=%s | lat=%.6f | lng=%.6f",
        user_id, body.lat, body.lng
    )
    return {"status": "ok"}