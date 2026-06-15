import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from core.role import is_field_pc, machine_role
from core.camera_bridge import bridge_base_url, remote_camera_bridge_enabled
from core.field_bridge_ws import field_ws_connected, start_field_bridge_client
from core.watcher import start_watcher
from routers import websocket, flights, detections, health, analyze
from routers import uploads, fields, drones, images, camera, esp32
from routers import Segmentflight # ← ADD
from routers import Chat
from routers import alert
from routers import expert_chat   
from routers import profile  

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    log = logging.getLogger(__name__)
    role = machine_role()
    field = is_field_pc()
    log.info("Machine role: %s", role)

    if field:
        log.info("Field mode — skipping ML preload")
    else:
        try:
            from services.segformer_inference import preload_segformer
            await asyncio.to_thread(preload_segformer)
            log.info("SegFormer preloaded (%s)", settings.MODEL_WEIGHTS_PATH)
        except Exception as e:
            log.warning("SegFormer preload skipped: %s", e)

    if not field:
        try:
            from core.auth import get_supabase_public_key
            await get_supabase_public_key()
            log.info("Supabase JWKS preloaded for offline JWT checks")
        except Exception as e:
            log.warning("JWKS preload skipped (start backend with internet once): %s", e)

    if remote_camera_bridge_enabled():
        log.info("Home server — camera relay via %s", bridge_base_url())
    elif field:
        log.info("Field mode — camera at %s", settings.CAMERA_IP)
        if settings.HOME_SERVER_PUBLIC_URL:
            await start_field_bridge_client()
            log.info("Auto-connecting to %s", settings.HOME_SERVER_PUBLIC_URL)

    watcher_task = asyncio.create_task(start_watcher()) if not field else None
    yield
    if watcher_task:
        watcher_task.cancel()

app = FastAPI(
    title="Phytospectra API",
    description="Real-time crop stress monitoring backend",
    version="1.0.0",
    lifespan=lifespan
)

_cors = settings.cors_origins_list
_wildcard = len(_cors) == 1 and _cors[0] in ("*", "http://*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if _wildcard else _cors,
    allow_credentials=not _wildcard,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(websocket.router)
app.include_router(detections.router, prefix="/api/detections")
app.include_router(health.router,     prefix="/api")
app.include_router(fields.router,     prefix="/api")
app.include_router(flights.router,    prefix="/api")
app.include_router(uploads.router,    prefix="/api")
app.include_router(drones.router,     prefix="/api")
app.include_router(analyze.router,    prefix="/api")
app.include_router(images.router,     prefix="/api")
app.include_router(camera.router,     prefix="/api")
app.include_router(esp32.router,      prefix="/api")
app.include_router(Segmentflight.router, prefix="/api")  
app.include_router(Chat.router, prefix="/api")
app.include_router(alert.router, prefix="/api")       # add this
app.include_router(expert_chat.router, prefix="/api")
app.include_router(profile.router, prefix="/api")
