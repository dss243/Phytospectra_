from fastapi import APIRouter, HTTPException, Depends, Query
from pydantic import BaseModel
from typing import Optional
from services import supabase_service
from core.auth import get_current_user

router = APIRouter(tags=["Flights"])


class FlightCreate(BaseModel):
    field_id:  str
    drone_id:  Optional[str] = None
    altitude:  Optional[float] = None
    weather:   Optional[str] = None


@router.get("/flights")
async def list_flights(
    field_id: Optional[str] = Query(None),
    user=Depends(get_current_user)
):
    return await supabase_service.get_flights(user["sub"], field_id)


@router.post("/flights")
async def create_flight(data: FlightCreate, user=Depends(get_current_user)):
    result = await supabase_service.create_flight(
        user_id=user["sub"],
        field_id=data.field_id,
        drone_id=data.drone_id,
        altitude=data.altitude,
        weather=data.weather,
    )
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create flight")
    row = result if isinstance(result, dict) else result
    return row


@router.get("/flights/esp32/active")
async def get_esp32_active_flight(user=Depends(get_current_user)):
    """Which flight the shared ESP32 will upload to."""
    client = supabase_service.get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")

    device_id = supabase_service.resolve_esp32_device_id(client, user["sub"], None)
    if not device_id:
        return {"device_id": None, "flight_id": None, "field_id": None, "field_name": None}

    flight_id = supabase_service.get_esp32_active_flight_id(client, device_id)
    if not flight_id:
        return {"device_id": device_id, "flight_id": None, "field_id": None, "field_name": None}

    flight_res = (
        client.table("flights")
        .select("id, field_id, fields(field_name)")
        .eq("id", flight_id)
        .eq("user_id", user["sub"])
        .limit(1)
        .execute()
    )
    if not flight_res.data:
        return {"device_id": device_id, "flight_id": flight_id, "field_id": None, "field_name": None}

    row = flight_res.data[0]
    field_name = None
    fields_rel = row.get("fields")
    if isinstance(fields_rel, dict):
        field_name = fields_rel.get("field_name")
    return {
        "device_id": device_id,
        "flight_id": flight_id,
        "field_id": row.get("field_id"),
        "field_name": field_name,
    }


@router.post("/flights/{flight_id}/activate-esp32")
async def activate_flight_for_esp32(flight_id: str, user=Depends(get_current_user)):
    """
    Mark this flight as the ESP32 upload target (one shared ESP32, many fields).
    Called automatically on flight create; use this to re-activate an older flight.
    """
    client = supabase_service.get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")

    flight_res = (
        client.table("flights")
        .select("id, drone_id, user_id, field_id")
        .eq("id", flight_id)
        .eq("user_id", user["sub"])
        .limit(1)
        .execute()
    )
    if not flight_res.data:
        raise HTTPException(status_code=404, detail="Flight not found")

    flight = flight_res.data[0]
    drone_id = flight.get("drone_id")

    supabase_service.set_esp32_active_flight(client, user["sub"], drone_id, flight_id)
    return {
        "status": "active",
        "flight_id": flight_id,
        "field_id": flight.get("field_id"),
        "message": "ESP32 will sync to this flight on next upload",
    }


@router.get("/flights/{flight_id}")
async def get_flight(flight_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    result = client.table("flights").select("*, fields(field_name), drones(drone_name)") \
        .eq("id", flight_id) \
        .eq("user_id", user["sub"]) \
        .execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Flight not found")
    return result.data[0]


@router.get("/flights/{flight_id}/images")
async def get_flight_images(flight_id: str, user=Depends(get_current_user)):
    """All images for one flight (Gallery uses this per flight)."""
    return await supabase_service.get_images(
        user_id=user["sub"],
        flight_id=flight_id,
        limit=200,
    )


@router.get("/flights/{flight_id}/segmentations")
async def get_flight_segmentations(flight_id: str, user=Depends(get_current_user)):
    return await supabase_service.get_flight_segmentation_rows(
        flight_id=flight_id,
        user_id=user["sub"],
        limit=500,
    )


@router.delete("/flights/{flight_id}")
async def delete_flight(flight_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    client.table("flights").delete() \
        .eq("id", flight_id) \
        .eq("user_id", user["sub"]) \
        .execute()
    return {"status": "deleted", "flight_id": flight_id}