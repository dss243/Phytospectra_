from fastapi import APIRouter, Depends, Query
from typing import Optional
from core.auth import get_current_user
from services import supabase_service

router = APIRouter(tags=["Images"])


@router.get("/images")
async def list_images(
    field_id:  Optional[str] = Query(None),
    flight_id: Optional[str] = Query(None),
    limit:     int           = Query(50, le=200),
    user=Depends(get_current_user),
):
    return await supabase_service.get_images(
        user_id=user["sub"],
        field_id=field_id,
        flight_id=flight_id,
        limit=limit,
    )


@router.get("/images/{image_id}")
async def get_image(image_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    result = client.table("images").select("*") \
        .eq("id", image_id) \
        .eq("user_id", user["sub"]) \
        .execute()
    if not result.data:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Image not found")
    return result.data[0]


@router.delete("/images/{image_id}")
async def delete_image(image_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    client.table("images").delete() \
        .eq("id", image_id) \
        .eq("user_id", user["sub"]) \
        .execute()
    return {"status": "deleted", "image_id": image_id}