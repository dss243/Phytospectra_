from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from core.auth import verify_websocket_token, get_current_user
from services import supabase_service
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# { conversation_id: [WebSocket, ...] }
chat_rooms: dict[str, list[WebSocket]] = {}


# ── Room helpers ──────────────────────────────────────────────────────────────

def get_role(user: dict) -> str:
    # Check app_metadata first (set server-side, most reliable)
    role = user.get("app_metadata", {}).get("role")
    if role in ("farmer", "agronomist"):
        return role

    # Then user_metadata (set during signup)
    role = user.get("user_metadata", {}).get("role")
    if role in ("farmer", "agronomist"):
        return role

    # Direct "role" key (some JWT configs put it here)
    role = user.get("role")
    if role in ("farmer", "agronomist"):
        return role

    # "authenticated" is Supabase's default JWT role — not an app role.
    # Fall back to farmer since only farmers send messages from the Expert page.
    return "farmer"

def room_connect(conv_id: str, ws: WebSocket):
    chat_rooms.setdefault(conv_id, []).append(ws)

def room_disconnect(conv_id: str, ws: WebSocket):
    room = chat_rooms.get(conv_id, [])
    if ws in room:
        room.remove(ws)
    if not room:
        chat_rooms.pop(conv_id, None)

async def room_broadcast(conv_id: str, payload: dict, exclude: WebSocket):
    for ws in chat_rooms.get(conv_id, []):
        if ws is not exclude:
            try:
                await ws.send_json(payload)
            except Exception:
                pass

async def notify_agronomists(conversation: dict):
    """Push a new_request event to all connected agronomists."""
    for ws in chat_rooms.get("__agronomist_feed__", []):
        try:
            await ws.send_json({"type": "new_request", "conversation": conversation})
        except Exception:
            pass


# ── WebSocket: per-room chat ──────────────────────────────────────────────────

@router.get("/conversations/{conv_id}/messages")
async def get_conversation_messages(conv_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    if client is None:
        raise HTTPException(status_code=500, detail="Database client unavailable")

    try:
        res = client.table("chat_messages") \
            .select("*") \
            .eq("conversation_id", conv_id) \
            .order("created_at") \
            .execute()
    except Exception as e:
        logger.error(f"[Chat] Failed to fetch messages for {conv_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch messages")

    return res.data or []


class NewMessage(BaseModel):
    body: str

@router.post("/conversations/{conv_id}/messages")
async def post_message(conv_id: str, payload: NewMessage, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    if client is None:
        raise HTTPException(status_code=500, detail="Database client unavailable")

    # Try both "sub" and "id" — JWT libraries differ on which key holds the user UUID
    user_id = user.get("sub") or user.get("id") or user.get("user_id")
    role    = get_role(user)
    text    = payload.body.strip()

    logger.info(f"[Chat] post_message conv={conv_id} user_id={user_id} role={role}")  # add this

    if not user_id:
        raise HTTPException(status_code=400, detail="Could not resolve user ID from token")

    if not text:
        raise HTTPException(status_code=400, detail="Message body is empty")

    try:
        res = client.table("chat_messages").insert({
            "conversation_id": conv_id,
            "sender_id":       user_id,
            "sender_role":     role,
            "body":            text,
        }).execute()
    except Exception as e:
        logger.error(f"[Chat] Failed to save message — user_id={user_id} role={role} error={e}")  # now shows real cause
        raise HTTPException(status_code=500, detail=f"Failed to save message: {e}")

    if not res or not res.data:
        raise HTTPException(status_code=500, detail="Message not saved")

    return res.data[0]

@router.websocket("/ws/chat-requests")
async def chat_requests_feed(websocket: WebSocket):
    """Agronomist connects here to receive live new-request notifications."""
    await websocket.accept()

    user = await verify_websocket_token(websocket)
    if not user:
        await websocket.close(code=4401)
        return

    role = get_role(user)
    if role != "agronomist":
        await websocket.send_json({"type": "error", "message": "Agronomists only"})
        await websocket.close(code=4403)
        return

    room_connect("__agronomist_feed__", websocket)
    logger.info(f"[Chat] agronomist {user['sub']} connected to request feed")

    try:
        while True:
            await websocket.receive_text()  # keep-alive
    except WebSocketDisconnect:
        logger.info(f"[Chat] agronomist {user['sub']} left request feed")
    finally:
        room_disconnect("__agronomist_feed__", websocket)


# ── HTTP endpoints ────────────────────────────────────────────────────────────

class NewConversation(BaseModel):
    agronomist_id: str
    zone: str
    issue: str


@router.post("/conversations")
async def create_conversation(body: NewConversation, user=Depends(get_current_user)):
    user_id = user["sub"]

    client = supabase_service.get_supabase()
    if client is None:
        logger.error("[Chat] Supabase client is None in create_conversation")
        raise HTTPException(status_code=500, detail="Database client unavailable")

    # Reuse an existing open thread between the same pair
    try:
        existing = client.table("conversations") \
            .select("id") \
            .eq("farmer_id", user_id) \
            .eq("agronomist_id", body.agronomist_id) \
            .eq("status", "open") \
            .execute()
    except Exception as e:
        logger.error(f"[Chat] Failed to query existing conversations: {e}")
        existing = None

    if existing and existing.data:
        return existing.data[0]

    # Create a new conversation
    try:
        res = client.table("conversations").insert({
            "farmer_id":     user_id,
            "agronomist_id": body.agronomist_id,
            "zone":          body.zone,
            "issue":         body.issue,
        }).execute()
    except Exception as e:
        logger.error(f"[Chat] Failed to insert conversation: {e}")
        raise HTTPException(status_code=500, detail="Failed to create conversation")

    if not res or not res.data:
        logger.error("[Chat] Insert returned no data")
        raise HTTPException(status_code=500, detail="Failed to create conversation")

    conv = res.data[0]

    # Notify any online agronomists instantly
    await notify_agronomists(conv)
    return conv


@router.get("/conversations")
async def list_conversations(user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    if client is None:
        raise HTTPException(status_code=500, detail="Database client unavailable")

    role    = get_role(user)
    user_id = user.get("sub") or user.get("id") or user.get("user_id")

    logger.info(f"[Chat] list_conversations user_id={user_id} role={role}")

    try:
        # NO JOIN — just plain conversations first
        if role == "agronomist":
            res = client.table("conversations") \
                .select("*") \
                .eq("agronomist_id", user_id) \
                .eq("status", "open") \
                .order("created_at", desc=True) \
                .execute()
        else:
            res = client.table("conversations") \
                .select("*") \
                .eq("farmer_id", user_id) \
                .order("created_at", desc=True) \
                .execute()

        logger.info(f"[Chat] Got {len(res.data)} conversations for {role} {user_id}")
        return res.data if res and res.data else []

    except Exception as e:
        logger.error(f"[Chat] list_conversations failed: {type(e).__name__}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to fetch conversations: {str(e)}")

@router.post("/conversations/{conv_id}/resolve")
async def resolve_conversation(conv_id: str, user=Depends(get_current_user)):
    client = supabase_service.get_supabase()
    if client is None:
        raise HTTPException(status_code=500, detail="Database client unavailable")

    try:
        client.table("conversations") \
            .update({"status": "resolved"}) \
            .eq("id", conv_id) \
            .execute()
    except Exception as e:
        logger.error(f"[Chat] Failed to resolve conversation {conv_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to resolve conversation")

    return {"ok": True}