import logging
from typing import Dict, Optional
import httpx
import jwt as pyjwt
from jwt import ExpiredSignatureError, InvalidTokenError
from jwt.algorithms import ECAlgorithm
import json

from fastapi import Depends, HTTPException, WebSocket, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from core.config import settings

logger = logging.getLogger(__name__)

security = HTTPBearer()
optional_security = HTTPBearer(auto_error=False)

# Store all keys by kid, not just the first one
_cached_keys: Dict = {}


async def get_supabase_public_key(kid: str = None):
    global _cached_keys

    # Return cached key if we have it
    if kid and kid in _cached_keys:
        return _cached_keys[kid]

    # Fetch fresh JWKS
    jwks_url = f"{settings.SUPABASE_URL}/auth/v1/.well-known/jwks.json"
    logger.info(f"Fetching JWKS from {jwks_url}")

    async with httpx.AsyncClient() as client:
        res = await client.get(jwks_url, timeout=10)
        res.raise_for_status()
        jwks = res.json()

    logger.info(f"JWKS response: {jwks}")

    # Cache all keys by kid
    for key_data in jwks.get("keys", []):
        k = key_data.get("kid")
        _cached_keys[k] = ECAlgorithm.from_jwk(json.dumps(key_data))
        logger.info(f"Cached key: kid={k}")

    # Return the matching key or first available
    if kid and kid in _cached_keys:
        return _cached_keys[kid]
    elif _cached_keys:
        return next(iter(_cached_keys.values()))
    else:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No public keys available",
        )


async def verify_token(token: str) -> Dict:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="No token provided",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        # Extract kid from token header to fetch the right key
        header = pyjwt.get_unverified_header(token)
        kid = header.get("kid")
        logger.debug(f"Token kid: {kid}")

        public_key = await get_supabase_public_key(kid)

        payload = pyjwt.decode(
            token,
            public_key,
            algorithms=["ES256"],
            options={"verify_aud": False},
            leeway=300
        )

        if not payload.get("sub"):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing subject claim",
            )

        logger.debug(f"Token verified: user={payload.get('sub')}")
        return payload

    except ExpiredSignatureError as e:
        logger.warning(f"JWT expired: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except InvalidTokenError as e:
        logger.warning(f"JWT invalid: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Auth error: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Authentication failed: {e}",
            headers={"WWW-Authenticate": "Bearer"},
        )


def _extract_user_id(payload: Dict, context: str = "token") -> str:
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"User ID missing from {context}",
        )
    return user_id


# =====================================================
# REST DEPENDENCIES
# =====================================================

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> Dict:
    return await verify_token(credentials.credentials)


def get_current_user_id(
    user: Dict = Depends(get_current_user),
) -> str:
    return _extract_user_id(user)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(optional_security),
) -> Optional[Dict]:
    if not credentials:
        return None
    try:
        return await verify_token(credentials.credentials)
    except HTTPException:
        return None


def require_role(required_role: str):
    def _check(user: Dict = Depends(get_current_user)) -> Dict:
        role = (
            user.get("role")
            or user.get("user_metadata", {}).get("role")
            or user.get("app_metadata", {}).get("role")
        )
        if role != required_role:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires role: {required_role}",
            )
        return user
    return _check


# =====================================================
# WEBSOCKET DEPENDENCIES
# =====================================================

async def verify_websocket_token(websocket: WebSocket) -> Optional[Dict]:
    token = websocket.query_params.get("token")
    if not token:
        return None
    try:
        payload = await verify_token(token)
        logger.debug(f"WebSocket authenticated: user={payload.get('sub')}")
        return payload
    except HTTPException:
        return None


async def get_websocket_user_id(websocket: WebSocket) -> str:
    payload = await verify_websocket_token(websocket)
    return _extract_user_id(payload, context="WebSocket token")