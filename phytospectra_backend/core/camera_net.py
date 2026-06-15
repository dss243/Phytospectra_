"""Reach MAPIR camera when PC has USB tethering + MAPIR Wi‑Fi (dual-homed Windows)."""

from __future__ import annotations

import logging
import socket
import subprocess
from typing import List, Optional
from urllib.parse import urlparse

import httpx

from core.config import settings

logger = logging.getLogger(__name__)

_BIND_MISS = object()
_BIND_CACHE: object = _BIND_MISS


def camera_host_from_url(base: str) -> str:
    return urlparse(base).hostname or "192.168.1.254"


def camera_subnet_prefix(host: str) -> Optional[str]:
    parts = host.split(".")
    if len(parts) == 4 and all(p.isdigit() and 0 <= int(p) <= 255 for p in parts):
        return ".".join(parts[:3]) + "."
    return None


def list_local_ipv4() -> List[str]:
    ips: List[str] = []
    try:
        result = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-NetIPAddress -AddressFamily IPv4 | "
                "Where-Object { $_.IPAddress -notlike '127.*' }).IPAddress -join ','",
            ],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            ips.extend(p.strip() for p in result.stdout.strip().split(",") if p.strip())
    except Exception as exc:
        logger.debug("Could not list IPv4 via PowerShell: %s", exc)

    if not ips:
        try:
            hostname = socket.gethostname()
            ips.extend(info[4][0] for info in socket.getaddrinfo(hostname, None, socket.AF_INET))
        except Exception:
            pass

    seen: set[str] = set()
    out: List[str] = []
    for ip in ips:
        if ip not in seen:
            seen.add(ip)
            out.append(ip)
    return out


def resolve_camera_bind_ip(force_refresh: bool = False) -> Optional[str]:
    """Local IP on the camera subnet (e.g. 192.168.1.x), for httpx local_address bind."""
    global _BIND_CACHE
    if not force_refresh and _BIND_CACHE is not _BIND_MISS:
        return _BIND_CACHE

    override = (getattr(settings, "CAMERA_BIND_IP", "") or "").strip()
    if override:
        local = list_local_ipv4()
        if override in local:
            _BIND_CACHE = override
            return override
        logger.warning(
            "CAMERA_BIND_IP=%s is not assigned on this PC (%s); ignoring bind",
            override,
            ", ".join(local) or "no IPv4",
        )

    host = camera_host_from_url(settings.CAMERA_IP)
    prefix = camera_subnet_prefix(host)
    if not prefix:
        _BIND_CACHE = None
        return None

    for ip in list_local_ipv4():
        if ip.startswith(prefix):
            logger.info("Camera HTTP bind: %s (subnet %s)", ip, prefix)
            _BIND_CACHE = ip
            return ip

    _BIND_CACHE = None
    return None


def camera_bind_diagnostics() -> dict:
    host = camera_host_from_url(settings.CAMERA_IP)
    prefix = camera_subnet_prefix(host) or ""
    local_ips = list_local_ipv4()
    bind_ip = resolve_camera_bind_ip()
    on_subnet = [ip for ip in local_ips if prefix and ip.startswith(prefix)]
    override = (getattr(settings, "CAMERA_BIND_IP", "") or "").strip()
    return {
        "server_hostname": socket.gethostname(),
        "camera_base": settings.CAMERA_IP.rstrip("/"),
        "camera_host": host,
        "local_ipv4": local_ips,
        "on_camera_subnet": on_subnet,
        "bind_ip": bind_ip,
        "camera_bind_ip_env": override or None,
    }


def camera_http_client(**kwargs) -> httpx.AsyncClient:
    """Async client that binds to MAPIR Wi‑Fi when USB tethering steals default route."""
    bind_ip = resolve_camera_bind_ip()
    client_kwargs = dict(kwargs)
    if bind_ip:
        transport = httpx.AsyncHTTPTransport(local_address=bind_ip)
        client_kwargs["transport"] = transport
    return httpx.AsyncClient(**client_kwargs)


def camera_unreachable_detail(last_err: Optional[str]) -> str:
    diag = camera_bind_diagnostics()
    base = diag["camera_base"]
    err = last_err or "timeout"
    host = diag.get("server_hostname") or "this PC"
    lines = [
        f"PC cannot reach camera at {base} (uvicorn on {host}).",
        f"Local IPv4 on that PC: {', '.join(diag['local_ipv4']) or 'none'}.",
    ]
    env_bind = diag.get("camera_bind_ip_env")
    if env_bind and env_bind not in diag["local_ipv4"]:
        lines.append(
            f"CAMERA_BIND_IP={env_bind} is set but that address is not on {host} — "
            "run uvicorn on the field PC next to the camera, not a different machine."
        )
    if diag["on_camera_subnet"]:
        bind = diag["bind_ip"] or diag["on_camera_subnet"][0]
        lines.append(
            f"Using MAPIR interface {bind}. If it still fails, open {base} in a browser on {host}."
        )
    else:
        lines.extend(
            [
                "No 192.168.1.x on the PC running uvicorn.",
            ]
        )
        if not (getattr(settings, "CAMERA_BRIDGE_URL", "") or "").strip():
            lines.append(
                "Home server (PC1): set CAMERA_BRIDGE_URL to the field PC ngrok URL in .env, "
                "then restart uvicorn — do not use CAMERA_BIND_IP on PC1."
            )
        else:
            lines.extend(
                [
                    "CAMERA_BRIDGE_URL is set but the field PC bridge did not respond — "
                    "start uvicorn + ngrok on PC2 (MAPIR Wi‑Fi + USB).",
                ]
            )
    lines.append(f"({err})")
    return " ".join(lines)


resolve_camera_bind_ip()
