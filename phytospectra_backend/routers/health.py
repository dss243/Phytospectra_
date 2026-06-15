from fastapi import APIRouter, Request, Depends
import httpx
import jwt as pyjwt
from jwt.algorithms import ECAlgorithm
import json

from core.config import settings
from core.auth import get_current_user
from services.supabase_service import get_supabase

router = APIRouter(tags=["Health"])


@router.get("/health")
async def health_check():
    from pathlib import Path
    backend_root = Path(__file__).resolve().parents[1]
    vit = backend_root / "models" / "vit_ndvi_leaf_health.pt"
    seg = backend_root / "models" / "segformer_b0_v5_1.pt"
    return {
        "status": "ok",
        "models": {
            "vit_ndvi_leaf_health.pt": vit.is_file(),
            "segformer_b0_v5_1.pt": seg.is_file(),
        },
    }


@router.get("/health/bridge")
async def health_bridge():
    """Public — is a field laptop connected for camera relay?"""
    from core.camera_bridge_registry import bridge_status
    from core.field_bridge_ws import field_ws_connected, field_ws_status

    st = {**bridge_status(), **field_ws_status()}
    ws = field_ws_connected()
    return {
        "status": "ok" if ws else "no_field_laptop",
        "field_laptop_ready": ws,
        "hint": (
            "User PC: run Install-Phytospectra-Camera.bat once (install only). "
            "Farmer then uses MAPIR Wi-Fi + USB internet — bridge auto-starts with Windows."
        )
        if not ws
        else None,
        **st,
    }


@router.post("/debug/token")
async def debug_token(request: Request):
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        return {"error": "No Bearer token found"}

    token = auth.split(" ", 1)[1]

    try:
        header = pyjwt.get_unverified_header(token)
    except Exception as e:
        return {"error": f"Cannot read token header: {e}"}

    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(
                f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json",
                timeout=10
            )
            jwks = res.json()
            key_data = jwks["keys"][0]
            public_key = ECAlgorithm.from_jwk(json.dumps(key_data))

        verified = pyjwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            options={"verify_aud": False}
        )
        return {"status": "✅ ES256 OK", "header": header, "claims": verified}

    except Exception as e:
        return {"status": "❌ FAILED", "error": str(e), "header": header}

@router.get("/debug/keys")
async def debug_keys():
    from services.supabase_service import get_supabase
    import jwt as pyjwt
    client = get_supabase()
    key = client.supabase_key
    claims = pyjwt.decode(key, options={"verify_signature": False})
    return {
        "role": claims.get("role"),  # should say "service_role" not "anon"
        "key_preview": key[:40] + "..."
    }
    
    
@router.get("/debug/bucket")
async def debug_bucket(user=Depends(get_current_user)):
    client = get_supabase()
    user_id = user.get("sub")

    root_files = client.storage.from_(settings.SUPABASE_BUCKET_RAW).list()
    user_files = client.storage.from_(settings.SUPABASE_BUCKET_RAW).list(user_id)

    return {
        "bucket": settings.SUPABASE_BUCKET_RAW,
        "root_files": root_files,
        "user_folder_files": user_files,
        "user_id": user_id,
        "looking_for": f"{user_id}/satellite.PNG"
    }