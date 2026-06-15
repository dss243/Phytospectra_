#!/usr/bin/env python3
"""
Phytospectra camera bridge (background service).

Farmers: install once via Install-Phytospectra-Camera.bat — never run this file manually.
Started automatically by scripts/user_pc_bridge.ps1 at Windows login.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import socket
import sys
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import urlparse

import httpx

try:
    from websockets.asyncio.client import connect
except ImportError:
    print("Install: pip install httpx websockets")
    sys.exit(1)

# --- Config (same values as home server .env) ---
HOME_SERVER_URL = os.environ.get(
    "HOME_SERVER_PUBLIC_URL", "https://unseeing-purity-reluctant.ngrok-free.dev"
).rstrip("/")
BRIDGE_KEY = os.environ.get("CAMERA_BRIDGE_KEY", "phytospectra-field-bridge-2026")
CAMERA_IP = os.environ.get("CAMERA_IP", "http://192.168.1.254").rstrip("/")
CAMERA_BIND_IP = os.environ.get("CAMERA_BIND_IP", "").strip()
PROBE_PATHS = ["/", "/get_params.cgi?param=camera_clock", "/DCIM/PHOTO"]


def local_ips() -> list[str]:
    try:
        import subprocess

        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' }).IPAddress -join ','",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        if r.returncode == 0 and r.stdout.strip():
            return [x.strip() for x in r.stdout.strip().split(",") if x.strip()]
    except Exception:
        pass
    return []


def resolve_bind_ip() -> Optional[str]:
    if CAMERA_BIND_IP:
        return CAMERA_BIND_IP
    host = urlparse(CAMERA_IP).hostname or "192.168.1.254"
    prefix = ".".join(host.split(".")[:3]) + "."
    for ip in local_ips():
        if ip.startswith(prefix):
            return ip
    return None


def camera_client(**kwargs) -> httpx.AsyncClient:
    bind = resolve_bind_ip()
    if bind:
        return httpx.AsyncClient(
            transport=httpx.AsyncHTTPTransport(local_address=bind), **kwargs
        )
    return httpx.AsyncClient(**kwargs)


async def ping_camera() -> Dict[str, Any]:
    async with camera_client(timeout=6.0, follow_redirects=True) as client:
        for path in PROBE_PATHS:
            try:
                r = await client.get(f"{CAMERA_IP}{path}")
                if r.status_code < 500:
                    return {"reachable": True, "status": r.status_code, "path": path}
            except Exception:
                continue
    raise RuntimeError(f"Cannot reach camera at {CAMERA_IP}")


async def proxy_camera(msg: Dict[str, Any]) -> Dict[str, Any]:
    rel = (msg.get("path") or "").lstrip("/")
    url = f"{CAMERA_IP}/{rel}"
    query = msg.get("query") or ""
    if query:
        url = f"{url}?{query.lstrip('?')}"
    body_b64 = msg.get("body_b64") or ""
    body = base64.b64decode(body_b64) if body_b64 else b""
    headers = msg.get("headers") or {}
    async with camera_client(timeout=45.0, follow_redirects=True) as client:
        r = await client.request(msg.get("method") or "GET", url, content=body or None, headers=headers)
    return {
        "id": msg.get("id"),
        "status": r.status_code,
        "body_b64": base64.b64encode(r.content).decode("ascii"),
        "headers": dict(r.headers),
    }


async def handle(msg: Dict[str, Any]) -> Dict[str, Any]:
    op = msg.get("op")
    if op == "ping":
        try:
            return {"id": msg.get("id"), "data": await ping_camera()}
        except Exception as e:
            return {"id": msg.get("id"), "error": str(e)}
    if op == "proxy":
        try:
            return await proxy_camera(msg)
        except Exception as e:
            return {"id": msg.get("id"), "error": str(e)}
    return {"id": msg.get("id"), "error": f"unknown op {op}"}


def internet_route_hint() -> str:
    """Warn when default route may not reach ngrok (common with MAPIR Wi-Fi + USB ethernet)."""
    try:
        import subprocess

        r = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-Command",
                "Get-NetRoute -DestinationPrefix '0.0.0.0/0' | "
                "Sort-Object RouteMetric | Select-Object -First 1 -ExpandProperty InterfaceAlias",
            ],
            capture_output=True,
            text=True,
            timeout=8,
        )
        iface = (r.stdout or "").strip()
        if iface and "wi-fi" in iface.lower() and "mapir" in iface.lower():
            return (
                f"Default internet route is '{iface}' (MAPIR?) — ngrok may fail. "
                "Use USB ethernet for internet; MAPIR Wi-Fi for camera only."
            )
        if iface:
            return f"Default internet route: {iface}"
    except Exception:
        pass
    return ""


async def verify_home_server() -> None:
    headers = {"ngrok-skip-browser-warning": "true"} if "ngrok" in HOME_SERVER_URL else None
    async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
        r = await client.get(f"{HOME_SERVER_URL}/api/health", headers=headers)
        r.raise_for_status()


async def main() -> None:
    bind = resolve_bind_ip()
    ws_base = HOME_SERVER_URL.replace("https://", "wss://").replace("http://", "ws://")
    hostname = socket.gethostname()
    uri = f"{ws_base}/api/camera/bridge/ws?key={BRIDGE_KEY}&hostname={hostname}"
    headers = {"ngrok-skip-browser-warning": "true"} if "ngrok" in ws_base else None

    print(f"Phytospectra field agent -> {HOME_SERVER_URL}")
    print(f"Camera: {CAMERA_IP}  bind: {bind or 'MISSING'}  host: {hostname}")
    route = internet_route_hint()
    if route:
        print(route)
    if not bind:
        print("ERROR: no 192.168.1.x IP — join MAPIR Wi-Fi first, then re-run.")
    print(f"WebSocket: {ws_base}/api/camera/bridge/ws?key=***&hostname={hostname}")

    try:
        await verify_home_server()
        print("Home server reachable (HTTP /api/health OK).")
    except Exception as e:
        print(f"WARNING: cannot reach home server yet ({e})")
        print("  Fix USB ethernet / internet before WebSocket can connect.")

    while True:
        try:
            async with connect(uri, additional_headers=headers, ping_interval=20) as ws:
                print("Connected to home server.")
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    resp = await handle(msg)
                    await ws.send(json.dumps(resp))
        except Exception as e:
            print(f"Disconnected ({e}) — retry in 5s")
            await asyncio.sleep(5)


if __name__ == "__main__":
    env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip().strip('"')
            os.environ.setdefault(k, v)
        HOME_SERVER_URL = os.environ.get("HOME_SERVER_PUBLIC_URL", HOME_SERVER_URL).rstrip("/")
        BRIDGE_KEY = os.environ.get("CAMERA_BRIDGE_KEY", BRIDGE_KEY)
    asyncio.run(main())
