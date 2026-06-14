from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from core.auth import get_current_user
from services.supabase_service import get_supabase

router = APIRouter(tags=["Drones"])


# ─── Schemas ──────────────────────────────────────────────────────────────────

class DroneCreate(BaseModel):
    drone_name:           str
    drone_model:          Optional[str] = None
    esp32_device_id:      Optional[str] = None
    multispectral_camera: Optional[str] = "MAPIR Survey3W"
    field_id:             Optional[str] = None   # auto-assign to a field on creation


class DroneUpdate(BaseModel):
    drone_name:           Optional[str] = None
    drone_model:          Optional[str] = None
    esp32_device_id:      Optional[str] = None
    multispectral_camera: Optional[str] = None
    field_id:             Optional[str] = None   # reassign or unassign (pass None explicitly)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_client():
    client = get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")
    return client


def _require_drone(client, drone_id: str, user_id: str) -> dict:
    """Fetch a single drone that belongs to this user, or raise 404."""
    result = (
        client.table("drones")
        .select("*")
        .eq("id", drone_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Drone not found")
    return result.data[0]


# ─── Routes ───────────────────────────────────────────────────────────────────

@router.post("/drones", status_code=201)
async def create_drone(data: DroneCreate, user=Depends(get_current_user)):
    """
    Create a new drone.
    If `field_id` is provided the drone is immediately assigned to that field,
    which lets the Flights page auto-resolve the drone without a separate step.
    """
    client = _get_client()

    # Validate field ownership when field_id is supplied
    if data.field_id:
        field_check = (
            client.table("fields")
            .select("id")
            .eq("id", data.field_id)
            .eq("user_id", user["sub"])
            .execute()
        )
        if not field_check.data:
            raise HTTPException(
                status_code=404,
                detail="Field not found or does not belong to you",
            )

    result = client.table("drones").insert({
        "user_id":              user["sub"],
        "drone_name":           data.drone_name,
        "drone_model":          data.drone_model,
        "esp32_device_id":      data.esp32_device_id,
        "multispectral_camera": data.multispectral_camera,
        "field_id":             data.field_id,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create drone")

    return result.data[0]


@router.get("/drones")
async def list_drones(
    field_id: Optional[str] = Query(None, description="Filter drones by assigned field"),
    user=Depends(get_current_user),
):
    """
    List all drones for the current user.
    Optionally filter by `field_id` to get the drone(s) assigned to a specific field.
    """
    client = _get_client()

    query = (
        client.table("drones")
        .select("*")
        .eq("user_id", user["sub"])
        .order("created_at", desc=True)
    )

    if field_id:
        query = query.eq("field_id", field_id)

    result = query.execute()
    return result.data


@router.get("/drones/{drone_id}")
async def get_drone(drone_id: str, user=Depends(get_current_user)):
    """Fetch a single drone by ID."""
    client = _get_client()
    return _require_drone(client, drone_id, user["sub"])


@router.patch("/drones/{drone_id}")
async def update_drone(
    drone_id: str,
    data: DroneUpdate,
    user=Depends(get_current_user),
):
    """
    Partially update a drone (name, model, camera, esp32 id, or field assignment).
    Pass `field_id: null` to unassign the drone from its current field.
    """
    client = _get_client()

    # Ensure drone exists and belongs to user
    _require_drone(client, drone_id, user["sub"])

    # Validate new field ownership when field_id is being changed
    if data.field_id is not None:
        field_check = (
            client.table("fields")
            .select("id")
            .eq("id", data.field_id)
            .eq("user_id", user["sub"])
            .execute()
        )
        if not field_check.data:
            raise HTTPException(
                status_code=404,
                detail="Field not found or does not belong to you",
            )

    # Build patch payload — only include fields that were explicitly set
    payload = {k: v for k, v in data.model_dump().items() if v is not None}

    # Allow explicit unassign: if the caller sent field_id=null we still want to write None
    if "field_id" in data.model_fields_set and data.field_id is None:
        payload["field_id"] = None

    if not payload:
        raise HTTPException(status_code=400, detail="No fields provided for update")

    result = (
        client.table("drones")
        .update(payload)
        .eq("id", drone_id)
        .eq("user_id", user["sub"])
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to update drone")

    return result.data[0]


@router.delete("/drones/{drone_id}", status_code=200)
async def delete_drone(drone_id: str, user=Depends(get_current_user)):
    """Delete a drone. Raises 404 if it doesn't exist or doesn't belong to the user."""
    client = _get_client()

    # Confirm it exists first so we can return a meaningful error
    _require_drone(client, drone_id, user["sub"])

    client.table("drones").delete().eq("id", drone_id).eq("user_id", user["sub"]).execute()

    return {"status": "deleted", "drone_id": drone_id}