"""Role checks and shared database-backed request budgets."""
import os
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .core import digest, now, one, transaction

bearer = HTTPBearer(auto_error=False)

def limit(request: Request, group: str, maximum: int, period=60, per_client=True):
    timestamp = now()
    client = request.client.host if request.client else "unknown"
    bucket = digest(f"{group}:{client if per_client else 'all'}")
    with transaction() as db:
        row = one(db, """INSERT INTO rate_windows VALUES (:bucket,1,:expires)
            ON CONFLICT(bucket) DO UPDATE SET
              hits=CASE WHEN rate_windows.expires<=:now THEN 1 ELSE rate_windows.hits+1 END,
              expires=CASE WHEN rate_windows.expires<=:now THEN excluded.expires ELSE rate_windows.expires END
            RETURNING hits,expires""", bucket=bucket, expires=timestamp+period, now=timestamp)
    if row["hits"] > maximum:
        raise HTTPException(429, "Too many requests", headers={"Retry-After": str(row["expires"]-timestamp)})

def current_user(credential: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    if credential is None or len(credential.credentials) != 43:
        raise HTTPException(401, "Sign in required")
    with transaction() as db:
        user = one(db, """SELECT u.id,u.email,u.role,u.org_id FROM users u
            JOIN sessions s ON s.user_id=u.id JOIN organisations o ON o.id=u.org_id
            WHERE s.token_hash=:token AND s.expires>:now AND u.active=1 AND o.verified=1""",
            token=digest(credential.credentials), now=now())
    if user is None:
        raise HTTPException(401, "Sign in required")
    return user

Account = Annotated[dict, Depends(current_user)]

def roles(*allowed):
    def require(user: Account):
        if user["role"] not in allowed:
            raise HTTPException(403, "This action requires a different partner role")
        return user
    return require
