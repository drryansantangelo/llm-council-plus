"""Firebase Authentication middleware for FastAPI."""

from fastapi import Depends, HTTPException, Request
from firebase_admin import auth
from typing import Optional
from pydantic import BaseModel

from .firebase_config import get_app


class AuthUser(BaseModel):
    """Authenticated user extracted from Firebase ID token."""
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None


async def get_current_user(request: Request) -> AuthUser:
    """FastAPI dependency: extract and verify Firebase ID token.

    Usage in route:
        @app.get("/api/something")
        async def my_route(user: AuthUser = Depends(get_current_user)):
            ...
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Missing or invalid Authorization header",
        )

    token = auth_header.split("Bearer ", 1)[1]

    try:
        get_app()
        decoded = auth.verify_id_token(token)
        return AuthUser(
            uid=decoded["uid"],
            email=decoded.get("email"),
            name=decoded.get("name"),
        )
    except auth.ExpiredIdTokenError:
        raise HTTPException(status_code=401, detail="Token expired")
    except auth.InvalidIdTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Authentication failed: {e}")
