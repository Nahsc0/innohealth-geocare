"""Role checks and shared database-backed request budgets."""
import os
import secrets
from datetime import datetime, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .core import audit, digest, now, one, query, transaction

bearer = HTTPBearer(auto_error=False)

def activity_month(timestamp):
    return datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m")

def record_activity(db, account, month):
    query(db, "INSERT INTO account_monthly_activity (month,user_id) VALUES (:month,:account) ON CONFLICT DO NOTHING",
          month=month, account=account)

def issue_session(db, account):
    token = secrets.token_urlsafe(32)
    timestamp = now()
    result = query(db, """INSERT INTO sessions (token_hash,user_id,expires)
        SELECT :token,u.id,:expires FROM users u JOIN organisations o ON o.id=u.org_id
        WHERE u.id=:account AND u.active=1 AND o.verified=1""",
        token=digest(token), expires=timestamp + 28800, account=account)
    if not result.rowcount:
        raise HTTPException(401, "Sign in required")
    record_activity(db, account, activity_month(timestamp))
    audit(db, account, "session.created", account)
    return token

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
    timestamp = now()
    month = activity_month(timestamp)
    with transaction() as db:
        user = one(db, """SELECT u.id,u.email,u.role,u.org_id,a.month AS activity_month FROM users u
            JOIN sessions s ON s.user_id=u.id JOIN organisations o ON o.id=u.org_id
            LEFT JOIN account_monthly_activity a ON a.user_id=u.id AND a.month=:month
            WHERE s.token_hash=:token AND s.expires>:now AND u.active=1 AND o.verified=1""",
            token=digest(credential.credentials), now=timestamp, month=month)
    if user is None:
        raise HTTPException(401, "Sign in required")
    if user.pop("activity_month") is None:
        with transaction() as db:
            record_activity(db, user["id"], month)
    return user

Account = Annotated[dict, Depends(current_user)]

def roles(*allowed):
    def require(user: Account):
        if user["role"] not in allowed:
            raise HTTPException(403, "This action requires a different partner role")
        return user
    return require
