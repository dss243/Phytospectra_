"""Outbound WebSocket: field laptop connects to home server (one ngrok URL only)."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import socket
import uuid
from typing import Any, Dict, Optional

import httpx
from fastapi import WebSocket, WebSocketDisconnect

from core.config import settings

logger = logging.getLogger(__name__)

BRIDGE_KEY_HEADER = "x-camera-bridge-key"
_pending: Dict[str, asyncio.Future] = {}
_ws: Optional[WebSocket] = None
_ws_hostname: Optional[str] = None
_ws_lock = asyncio.Lock()


def field_ws_connected() -> bool:
    return _ws is not None


def field_ws_status() -> Dict[str, Any]:
    return {
        "websocket_connected": field_ws_connected(),
        "field_hostname": _ws_hostname,
        "mode": "websocket" if field_ws_connected() else None,
    }


async def accept_field_bridge_ws(websocket: WebSocket) -> None:
    global _ws, _ws_hostname
    key = websocket.query_params.get("key") or websocket.headers.get(BRIDGE_KEY_HEADER)
    hostname = websocket.query_params.get("hostname") or "unknown"
    if not settings.CAMERA_BRIDGE_KEY:
        logger.warning("Field WS rejected (%s): CAMERA_BRIDGE_KEY not set on home server .env", hostname)
        await websocket.close(code=4401, reason="Bridge key not configured on server")
        return
    if key != settings.CAMERA_BRIDGE_KEY:
        logger.warning("Field WS rejected (%s): invalid bridge key", hostname)
        await websocket.close(code=4401, reason="Invalid bridge key")
        return

    await websocket.accept()
    hostname = hostname if hostname != "unknown" else socket.gethostname()
    async with _ws_lock:
        _ws = websocket
        _ws_hostname = hostname
    logger.info("Field PC connected via WebSocket (%s)", hostname)

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            req_id = msg.get("id")
            if req_id and req_id in _pending:
                fut = _pending.pop(req_id)
                if not fut.done():
                    fut.set_result(msg)
    except WebSocketDisconnect:
        pass
    finally:
        async with _ws_lock:
            if _ws is websocket:
                _ws = None
                _ws_hostname = None
        logger.info("Field PC WebSocket disconnected (%s)", hostname)


async def _send_to_field(payload: Dict[str, Any], timeout: float = 45.0) -> Dict[str, Any]:
    async with _ws_lock:
        ws = _ws
    if ws is None:
        raise ConnectionError("No field PC connected via WebSocket")

    req_id = str(uuid.uuid4())
    payload = {**payload, "id": req_id}
    loop = asyncio.get_running_loop()
    fut: asyncio.Future = loop.create_future()
    _pending[req_id] = fut
    try:
        await ws.send_text(json.dumps(payload))
        msg = await asyncio.wait_for(fut, timeout=timeout)
        if msg.get("error"):
            raise RuntimeError(str(msg["error"]))
        return msg
    except asyncio.TimeoutError:
        _pending.pop(req_id, None)
        raise TimeoutError("Field PC WebSocket request timed out")
    finally:
        _pending.pop(req_id, None)


async def field_ws_camera_ping() -> Dict[str, Any]:
    msg = await _send_to_field({"op": "ping"}, timeout=25.0)
    data = msg.get("data")
    if not isinstance(data, dict):
        raise RuntimeError("Invalid ping response from field PC")
    return data


async def field_ws_camera_proxy(
    method: str,
    path: str,
    query: str = "",
    body: bytes = b"",
    headers: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    msg = await _send_to_field(
        {
            "op": "proxy",
            "method": method,
            "path": path,
            "query": query,
            "body_b64": base64.b64encode(body).decode("ascii") if body else "",
            "headers": headers or {},
        },
        timeout=90.0,
    )
    return msg


def _home_ws_url() -> str:
    base = (settings.HOME_SERVER_PUBLIC_URL or "").strip().rstrip("/")
    if not base:
        raise RuntimeError("HOME_SERVER_PUBLIC_URL is not set on field PC")
    return base.replace("https://", "wss://").replace("http://", "ws://") + "/api/camera/bridge/ws"


async def _execute_field_op(msg: Dict[str, Any]) -> Dict[str, Any]:
    from core.camera_local import ping_local_camera, PROBE_PATHS, probe_camera_path
    from core.camera_net import camera_http_client

    op = msg.get("op")
    if op == "ping":
        try:
            data = await ping_local_camera()
            return {"id": msg.get("id"), "data": data}
        except Exception as e:
            return {"id": msg.get("id"), "error": str(e)}

    if op == "proxy":
        rel = (msg.get("path") or "").lstrip("/")
        url = f"{settings.CAMERA_IP.rstrip('/')}/{rel}"
        query = msg.get("query") or ""
        if query:
            url = f"{url}?{query.lstrip('?')}"
        body_b64 = msg.get("body_b64") or ""
        body = base64.b64decode(body_b64) if body_b64 else b""
        req_headers = msg.get("headers") or {}
        try:
            async with camera_http_client(timeout=45.0, follow_redirects=True) as client:
                r = await client.request(
                    msg.get("method") or "GET",
                    url,
                    content=body or None,
                    headers=req_headers,
                )
            return {
                "id": msg.get("id"),
                "status": r.status_code,
                "body_b64": base64.b64encode(r.content).decode("ascii"),
                "headers": dict(r.headers),
            }
        except Exception as e:
            return {"id": msg.get("id"), "error": str(e)}

    return {"id": msg.get("id"), "error": f"unknown op {op}"}


async def run_field_bridge_client_loop() -> None:
    """Field PC: keep outbound WebSocket open to home server."""
    from websockets.asyncio.client import connect

    ws_url = _home_ws_url()
    params = f"key={settings.CAMERA_BRIDGE_KEY}&hostname={socket.gethostname()}"
    uri = f"{ws_url}?{params}"
    headers = {"ngrok-skip-browser-warning": "true"} if "ngrok" in ws_url else None

    logger.info("Field bridge client connecting to %s", ws_url)
    while True:
        try:
            async with connect(uri, additional_headers=headers, ping_interval=20, ping_timeout=20) as ws:
                logger.info("Field bridge WebSocket connected to home server")
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    resp = await _execute_field_op(msg)
                    await ws.send(json.dumps(resp))
        except Exception as e:
            logger.warning("Field bridge WebSocket lost (%s), retry in 5s", e)
            await asyncio.sleep(5)


async def start_field_bridge_client() -> None:
    asyncio.create_task(run_field_bridge_client_loop())
