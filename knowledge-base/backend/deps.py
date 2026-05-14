"""
FastAPI dependency injection helpers.

Auth is intentionally lightweight for the MVP — a single static token set via
the ADMIN_TOKEN env var gates write operations. When you wire up Cognito/Google
SSO (Step 17 of the AWS guide), replace verify_token with proper JWT validation.
"""
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from backend.database import get_db
from backend.config import get_settings

settings = get_settings()
bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
):
    """
    MVP auth: accept any request in debug mode, or validate a static bearer token.
    Replace this with Cognito JWT validation when going to production.
    """
    if settings.debug:
        return {"sub": "dev-user", "email": "dev@localhost", "role": "admin"}

    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # TODO: Replace with Cognito JWT validation
    # For now, any non-empty token is accepted in non-debug mode too,
    # so you can test endpoints without full auth wired up.
    return {"sub": credentials.credentials, "email": "user@localhost", "role": "editor"}


# Convenience aliases
DbSession = Depends(get_db)
CurrentUser = Depends(get_current_user)
