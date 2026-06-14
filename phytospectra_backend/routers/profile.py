# routers/profile.py
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from core.auth import get_current_user
from services.supabase_service import get_supabase
import logging

router = APIRouter(tags=["Profile"])
logger = logging.getLogger(__name__)

class LocationPayload(BaseModel):
    lat: float
    lng: float


class ProfileUpdatePayload(BaseModel):
    display_name: str


@router.patch("/profile/me")
async def update_my_profile(
    body: ProfileUpdatePayload,
    user=Depends(get_current_user),
):
    client = get_supabase()
    if not client:
        raise HTTPException(503, "Supabase unavailable")

    user_id = user["sub"]
    display_name = body.display_name.strip()
    if not display_name:
        raise HTTPException(400, "Display name is required")

    try:
        res = client.table("profiles").upsert(
            {
                "user_id": user_id,
                "display_name": display_name,
            },
            on_conflict="user_id",
        ).execute()
    except Exception as e:
        logger.error("Profile update failed | user=%s | error=%s", user_id, e)
        raise HTTPException(500, "Failed to update profile")

    row = res.data[0] if res and res.data else {"user_id": user_id, "display_name": display_name}
    logger.info("Profile updated | user=%s | name=%s", user_id, display_name)
    return row


@router.patch("/profile/location")
async def update_location(
    body: LocationPayload,
    user=Depends(get_current_user)
):
    client = get_supabase()
    if not client:
        raise HTTPException(503, "Supabase unavailable")

    user_id = user["sub"]

    # Upsert into agronomist_locations
    client.table("agronomist_locations").upsert({
        "agronomist_id": user_id,
        "lat": body.lat,
        "lng": body.lng,
    }, on_conflict="agronomist_id").execute()

    # Also update profiles so location is part of the user profile
    client.table("profiles").update({
        "latitude":  body.lat,
        "longitude": body.lng,
        "updated_at": "now()",
    }).eq("user_id", user_id).execute()

    logger.info("Location updated | user=%s | lat=%.6f | lng=%.6f", user_id, body.lat, body.lng)
    return {"status": "ok"}


@router.get("/profile/me")
async def get_my_profile(user=Depends(get_current_user)):
    client = get_supabase()
    if not client:
        raise HTTPException(503, "Supabase unavailable")

    res = client.table("profiles").select("*").eq("user_id", user["sub"]).limit(1).execute()
    return res.data[0] if res.data else {}