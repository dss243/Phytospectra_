# core/config.py - Inference-only configuration

from pydantic_settings import BaseSettings
from typing import List

class Settings(BaseSettings):
    # Supabase Configuration
    SUPABASE_URL: str = "https://vzmtbpdnnbrmhshhtaru.supabase.co"
    SUPABASE_KEY: str = ""
    SUPABASE_JWT_SECRET: str = ""
    
    # Storage Buckets
    SUPABASE_BUCKET_RAW: str = "multispectral"
    SUPABASE_BUCKET_HEATMAPS: str = "heatmap-images"
    # Set false when the multispectral bucket is private (default for this project).
    SUPABASE_STORAGE_PUBLIC: bool = False
    
    # Cloud deploy: weights pulled from Supabase Storage on startup (see scripts/)
    MODELS_BUCKET: str = "multispectral"
    MODELS_STORAGE_PREFIX: str = "_deploy/models"

    # Model Configuration
    MODEL_WEIGHTS_PATH: str = "./models/segformer_b0_v5_1.pt"
    MODEL_NAME: str = "nvidia/mit-b0"
    
    # Paths for testing
    WATCHED_FOLDER: str = "./test_images"
    OUTPUT_FOLDER: str = "./test_results"
    
    # ESP32 device auth
    ESP32_DEVICE_KEY: str = "esp32-dev-key"

    # MAPIR camera on local hotspot (backend fetches photos from here)
    CAMERA_IP: str = "http://192.168.1.254"
    # Optional: force httpx to use MAPIR Wi‑Fi when USB tethering is default route (Windows)
    CAMERA_BIND_IP: str = ""
    # Home server (PC1): forward camera calls to field PC ngrok URL (PC2 near camera)
    CAMERA_BRIDGE_URL: str = ""
    # Shared secret PC1 → PC2 (set same value on both)
    CAMERA_BRIDGE_KEY: str = ""
    # Field PC (PC2): skip ML preload — only run camera bridge + ngrok
    CAMERA_BRIDGE_ONLY: bool = False
    # Auto: 192.168.1.x = field laptop, otherwise home server (same .env everywhere)
    CAMERA_BRIDGE_AUTO: bool = True
    # Fixed home server URL (field PC connects here via WebSocket — one ngrok for users)
    HOME_SERVER_PUBLIC_URL: str = "https://unseeing-purity-reluctant.ngrok-free.dev"

    # Server Configuration
    CORS_ORIGINS: str = "http://0.0.0.0:8080,http://0.0.0.0:5173,http://0.0.0.0:3000"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    
    # Inference settings
    DEVICE: str = "cpu"
    IMG_SIZE: int = 512
    # SegFormer speed (CPU): downscale long edge, fewer tiles, batch patches
    SEGFORMER_MAX_SIDE: int = 1536
    SEGFORMER_TILE_OVERLAP: int = 128
    SEGFORMER_TILE_BATCH: int = 4

    # Groq AI — set in .env file, never hardcode here
    GROQ_API_KEY: str = ""

    # Gmail — set in .env file, never hardcode here
    GMAIL_SENDER: str = ""
    GMAIL_APP_PASSWORD: str = ""

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]
    
    class Config:
        env_file = ".env"

settings = Settings()