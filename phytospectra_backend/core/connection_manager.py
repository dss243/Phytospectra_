from fastapi import WebSocket
from typing import List, Dict, Optional
import json
import logging

logger = logging.getLogger(__name__)

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []
        self.user_connections: Dict[str, WebSocket] = {}  # user_id → websocket

    async def connect(self, websocket: WebSocket, user_id: Optional[str] = None):
        await websocket.accept()
        self.active_connections.append(websocket)
        if user_id:
            # If user reconnects, drop the old socket reference
            old_ws = self.user_connections.get(user_id)
            if old_ws and old_ws in self.active_connections:
                self.active_connections.remove(old_ws)
            self.user_connections[user_id] = websocket
            logger.info(f"User {user_id} connected. Total: {len(self.active_connections)}")
        else:
            logger.info(f"Anonymous client connected. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket, user_id: Optional[str] = None):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        if user_id and self.user_connections.get(user_id) == websocket:
            del self.user_connections[user_id]
        logger.info(f"Client disconnected. Total: {len(self.active_connections)}")

    async def broadcast(self, data: dict):
        """Send to all connected clients (existing behaviour, unchanged)."""
        message = json.dumps(data, default=str)
        dead = []
        for connection in self.active_connections:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to send to client: {e}")
                dead.append(connection)
        for d in dead:
            self.active_connections.remove(d)
            # Clean up user_connections too if the dead socket was registered
            for uid, ws in list(self.user_connections.items()):
                if ws == d:
                    del self.user_connections[uid]

    async def send_to_user(self, user_id: str, data: dict) -> bool:
        """
        Send a message to a specific user by their user_id.
        Returns True if delivered, False if user is not connected.
        """
        ws = self.user_connections.get(user_id)
        if not ws:
            logger.debug(f"User {user_id} is not connected — message not delivered via WS.")
            return False
        try:
            await ws.send_text(json.dumps(data, default=str))
            logger.info(f"Message delivered to user {user_id}")
            return True
        except Exception as e:
            logger.warning(f"Failed to send to user {user_id}: {e}")
            # Clean up stale connection
            self.active_connections.remove(ws) if ws in self.active_connections else None
            del self.user_connections[user_id]
            return False

    @property
    def client_count(self) -> int:
        return len(self.active_connections)

manager = ConnectionManager()