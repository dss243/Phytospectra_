from fastapi import APIRouter, Query, Depends
from services import supabase_service
from core.auth import get_current_user          # ← ADD

router = APIRouter(tags=["Detections"])


@router.get("/")
async def list_detections(
    flight_id: str = Query(None),
    limit: int = Query(50, le=200),
    user=Depends(get_current_user)                           # ← PROTECTED
):
    return await supabase_service.get_detections(flight_id, limit)


@router.get("/latest")
async def latest_detections(user=Depends(get_current_user)): # ← PROTECTED
    return await supabase_service.get_detections(limit=10)