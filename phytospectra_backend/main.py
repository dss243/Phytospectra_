import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
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
    # Pre-load SegFormer so the first gallery job skips ~10s model load.
    try:
        from services.segformer_inference import preload_segformer
        await asyncio.to_thread(preload_segformer)
        logging.getLogger(__name__).info("SegFormer preloaded (%s)", settings.MODEL_WEIGHTS_PATH)
    except Exception as e:
        logging.getLogger(__name__).warning("SegFormer preload skipped: %s", e)

    watcher_task = asyncio.create_task(start_watcher())
    yield
    watcher_task.cancel()

app = FastAPI(
    title="Phytospectra API",
    description="Real-time crop stress monitoring backend",
    version="1.0.0",
    lifespan=lifespan
)

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # or ["http://10.0.31.38:8080"] to be specific
    allow_credentials=True,
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
