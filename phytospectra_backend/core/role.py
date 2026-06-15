"""Detect home server vs field laptop automatically (same .env on every PC)."""

from __future__ import annotations

from core.camera_net import camera_host_from_url, camera_subnet_prefix, list_local_ipv4
from core.config import settings


def on_mapir_subnet() -> bool:
    prefix = camera_subnet_prefix(camera_host_from_url(settings.CAMERA_IP))
    if not prefix:
        return False
    return any(ip.startswith(prefix) for ip in list_local_ipv4())


def is_field_pc() -> bool:
    if settings.CAMERA_BRIDGE_ONLY:
        return True
    if settings.CAMERA_BRIDGE_AUTO:
        return on_mapir_subnet()
    return False


def machine_role() -> str:
    return "field" if is_field_pc() else "home"
