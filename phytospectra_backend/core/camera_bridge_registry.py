"""Any field laptop can register its ngrok URL with the home server."""

from __future__ import annotations

import json
import logging
import socket
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from core.config import settings

logger = logging.getLogger(__name__)

_REGISTRY_FILE = Path(__file__).resolve().parent.parent / "field_bridge_registry.json"

_active: Dict[str, Any] = {
    "bridge_url": "",
    "registered_at": None,
    "registered_by": None,
    "field_hostname": None,
}


def _normalize_url(url: str) -> str:
    return url.strip().rstrip("/")


def _save_registry() -> None:
    try:
        _REGISTRY_FILE.write_text(json.dumps(_active, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("Could not save field bridge registry: %s", exc)


def _load_registry() -> None:
    global _active
    if not _REGISTRY_FILE.exists():
        return
    try:
        data = json.loads(_REGISTRY_FILE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            _active.update(data)
            if _active.get("bridge_url") and _is_home_server_url(_active["bridge_url"]):
                logger.warning("Clearing invalid field bridge URL (same as home server)")
                clear_field_bridge()
            elif _active.get("bridge_url"):
                logger.info("Loaded field bridge: %s", _active["bridge_url"])
    except Exception as exc:
        logger.warning("Could not load field bridge registry: %s", exc)


def _is_home_server_url(url: str) -> bool:
    home = (getattr(settings, "HOME_SERVER_PUBLIC_URL", "") or "").strip().rstrip("/")
    if home and _normalize_url(url) == home:
        return True
    return False


def register_field_bridge(
    bridge_url: str,
    *,
    registered_by: Optional[str] = None,
    field_hostname: Optional[str] = None,
) -> Dict[str, Any]:
    normalized = _normalize_url(bridge_url)
    if not normalized.startswith("https://"):
        raise ValueError("bridge_url must start with https://")
    if _is_home_server_url(normalized):
        raise ValueError(
            "That URL is the home server, not the field laptop. "
            "Field PC auto-connects via WebSocket — no second ngrok needed."
        )
    _active["bridge_url"] = normalized
    _active["registered_at"] = datetime.now(timezone.utc).isoformat()
    _active["registered_by"] = registered_by
    _active["field_hostname"] = field_hostname or socket.gethostname()
    _save_registry()
    return bridge_status()


def clear_field_bridge() -> None:
    _active["bridge_url"] = ""
    _active["registered_at"] = None
    _active["registered_by"] = None
    _active["field_hostname"] = None
    _save_registry()


def registered_bridge_url() -> str:
    return _active.get("bridge_url") or ""


def bridge_status() -> Dict[str, Any]:
    env_url = _normalize_url(settings.CAMERA_BRIDGE_URL) if settings.CAMERA_BRIDGE_URL else ""
    reg_url = registered_bridge_url()
    effective = reg_url or env_url
    return {
        "registered_bridge_url": reg_url or None,
        "env_bridge_url": env_url or None,
        "effective_bridge_url": effective or None,
        "registered_at": _active.get("registered_at"),
        "field_hostname": _active.get("field_hostname"),
        "registered_by": _active.get("registered_by"),
    }


_load_registry()
