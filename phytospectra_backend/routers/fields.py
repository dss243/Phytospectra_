from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from core.auth import get_current_user
from services import supabase_service
from routers.flight_insights import get_field_stress_map_data

router = APIRouter(tags=["Fields"])


class FieldCreate(BaseModel):
    field_name:     str
    crop_type:      Optional[str] = "potato"
    latitude:       Optional[float] = None
    longitude:      Optional[float] = None
    area_hectares:  Optional[float] = None
    boundary:       Optional[dict] = None


@router.post("/fields")
async def create_field(data: FieldCreate, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    if not client:
        raise HTTPException(status_code=500, detail="Supabase not available")

    result = client.table("fields").insert({
        "user_id":       user["sub"],
        "field_name":    data.field_name,
        "crop_type":     data.crop_type,
        "latitude":      data.latitude,
        "longitude":     data.longitude,
        "area_hectares": data.area_hectares,
        "boundary":      data.boundary,
    }).execute()

    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create field")

    return result.data[0]


@router.get("/fields")
async def list_fields(user=Depends(get_current_user)):
    return await supabase_service.get_fields(user["sub"])


@router.get("/fields/{field_id}")
async def get_field(field_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    result = client.table("fields").select("*")\
        .eq("id", field_id)\
        .eq("user_id", user["sub"])\
        .execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Field not found")

    return result.data[0]


@router.get("/fields/{field_id}/stress-map")
async def field_stress_map(field_id: str, user=Depends(get_current_user)):
    """GPS stress pins for Field Analytics map (SegFormer + ViT segmentations)."""
    data = await get_field_stress_map_data(user["sub"], field_id)
    if data is None:
        raise HTTPException(status_code=404, detail="Field not found")
    return data


@router.delete("/fields/{field_id}")
async def delete_field(field_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    result = client.table("fields").delete()\
        .eq("id", field_id)\
        .eq("user_id", user["sub"])\
        .execute()

    return {"status": "deleted", "field_id": field_id}