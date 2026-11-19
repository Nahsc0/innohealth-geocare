"""GeoCare staging API. Every incident and referral is a simulation."""
from collections import Counter
from contextlib import asynccontextmanager
import os
import secrets
from typing import Literal

from argon2.exceptions import VerificationError
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from .core import LOCAL, audit, bootstrap, digest, migrate, now, one, passwords, query, rows, transaction, uid
from .directory import router as directory
from .access import router as access
from .coverage import router as coverage
from .workflows import router as workflows
from .security import Account, roles
from .postcodes import lookup

@asynccontextmanager
async def lifespan(_):
    if LOCAL:
        migrate()
        bootstrap()
    yield

app = FastAPI(title="InnoHealth GeoCare", version="0.1.0", lifespan=lifespan)
origins = os.getenv("FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PATCH"],
                   allow_headers=["Authorization", "Content-Type", "X-Tracking-Key"])

request_counts = Counter()

@app.middleware("http")
async def headers(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception:
        request_counts["5xx"] += 1
        raise
    request_counts[f"{response.status_code // 100}xx"] += 1
    response.headers.update({"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
                             "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY"})
    return response

@app.get("/health")
def health():
    with transaction() as db:
        query(db, "SELECT 1")
    return {"ready": True, "dispatch_enabled": False, "mode": "sandbox"}

class Postcode(BaseModel):
    postcode: str = Field(min_length=1, max_length=32)

@app.post("/v1/postcodes/lookup")
async def postcode(body: Postcode, request: Request):
    from .security import limit
    limit(request, "postcode", 30)
    return await lookup(body.postcode)

app.include_router(directory)
app.include_router(access)
app.include_router(coverage)
app.include_router(workflows)

class Login(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)

DUMMY_HASH = passwords.hash(secrets.token_urlsafe(24))

@app.post("/v1/login")
def login(body: Login, request: Request):
    from .security import limit
    limit(request, "login", 8, 300)
    email_tag = digest(body.email.lower().strip())
    limit(request, "account:" + email_tag, 8, 300, per_client=False)
    token = secrets.token_urlsafe(32)
    with transaction() as db:
        user = one(db, """SELECT u.* FROM users u JOIN organisations o ON u.org_id=o.id
                           WHERE u.email=:email AND u.active=1 AND o.verified=1""", email=body.email.lower().strip())
        try:
            if not passwords.verify(user["password_hash"] if user else DUMMY_HASH, body.password) or not user:
                raise HTTPException(401, "Invalid credentials")
        except VerificationError as exc:
            raise HTTPException(401, "Invalid credentials") from exc
        query(db, "INSERT INTO sessions VALUES (:token,:user,:expires)",
              token=digest(token), user=user["id"], expires=now() + 28800)
        audit(db, user["id"], "session.created", user["id"])
    return {"token": token, "role": user["role"]}

@app.get("/v1/me")
def me(user: Account):
    return user

@app.post("/v1/logout", status_code=204)
def logout(user: Account, credential: HTTPAuthorizationCredentials = Depends(HTTPBearer())):
    with transaction() as db:
        query(db, "DELETE FROM sessions WHERE token_hash=:token", token=digest(credential.credentials))
        audit(db, user["id"], "session.revoked", user["id"])
    return Response(status_code=204)

Admin = Depends(roles("admin"))

class Organisation(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    verified: bool = False

@app.get("/v1/admin/organisations")
def organisations(user=Admin):
    with transaction() as db:
        return rows(db, "SELECT * FROM organisations ORDER BY name LIMIT 500")

@app.post("/v1/admin/organisations", status_code=201)
def create_organisation(body: Organisation, user=Admin):
    record_id = uid()
    with transaction() as db:
        query(db, "INSERT INTO organisations VALUES (:id,:name,:verified)",
              id=record_id, name=body.name, verified=int(body.verified))
        audit(db, user["id"], "organisation.created", record_id)
    return {"id": record_id}

@app.patch("/v1/admin/organisations/{record_id}")
def update_organisation(record_id: str, body: Organisation, user=Admin):
    if record_id == user["org_id"] and not body.verified:
        raise HTTPException(409, "Your own organisation must remain verified")
    with transaction() as db:
        if not query(db, "UPDATE organisations SET name=:name,verified=:verified WHERE id=:id",
                     id=record_id, name=body.name, verified=int(body.verified)).rowcount:
            raise HTTPException(404, "Organisation not found")
        if not body.verified:
            query(db, "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE org_id=:id)", id=record_id)
        audit(db, user["id"], "organisation.updated", record_id)
    return {"id": record_id}

class NewUser(Login):
    password: str = Field(min_length=14, max_length=256)
    role: Literal["admin", "dispatcher", "responder", "clinician", "analyst"]
    org_id: str = Field(min_length=1, max_length=64)

@app.get("/v1/admin/users")
def users(user=Admin):
    with transaction() as db:
        return rows(db, "SELECT id,email,role,org_id,active FROM users ORDER BY email LIMIT 500")

@app.post("/v1/admin/users", status_code=201)
def create_user(body: NewUser, user=Admin):
    from sqlalchemy.exc import IntegrityError
    email = body.email.lower().strip()
    if "@" not in email or any(char.isspace() for char in email):
        raise HTTPException(422, "Enter a valid email")
    account_id = uid()
    try:
        with transaction() as db:
            if not one(db, "SELECT id FROM organisations WHERE id=:id", id=body.org_id):
                raise HTTPException(404, "Organisation not found")
            query(db, "INSERT INTO users VALUES (:id,:email,:password,:role,:org,1)",
                  id=account_id, email=email, password=passwords.hash(body.password), role=body.role, org=body.org_id)
            audit(db, user["id"], "user.created", account_id)
    except IntegrityError as exc:
        raise HTTPException(409, "Account already exists") from exc
    return {"id": account_id}

class Availability(BaseModel):
    active: bool

@app.patch("/v1/admin/users/{account_id}")
def set_account(account_id: str, body: Availability, user=Admin):
    if account_id == user["id"]:
        raise HTTPException(409, "Cannot change your own account")
    with transaction() as db:
        if not query(db, "UPDATE users SET active=:active WHERE id=:id", id=account_id, active=int(body.active)).rowcount:
            raise HTTPException(404, "Account not found")
        query(db, "DELETE FROM sessions WHERE user_id=:id", id=account_id)
        audit(db, user["id"], "user.status_changed", account_id)
    return {"id": account_id, "active": body.active}

@app.get("/v1/admin/audit")
def audit_log(user=Admin):
    with transaction() as db:
        return rows(db, "SELECT * FROM audit ORDER BY created DESC,id DESC LIMIT 200")

class Settings(BaseModel):
    retention_days: int = Field(ge=1, le=365)

@app.get("/v1/admin/settings")
def get_settings(user=Admin):
    with transaction() as db:
        row = one(db, "SELECT value FROM settings WHERE name='retention_days'")
    return {"retention_days": row["value"] if row else 30, "dispatch_enabled": False}

@app.patch("/v1/admin/settings")
def update_settings(body: Settings, user=Admin):
    with transaction() as db:
        query(db, """INSERT INTO settings VALUES ('retention_days',:days)
                     ON CONFLICT(name) DO UPDATE SET value=excluded.value""", days=body.retention_days)
        audit(db, user["id"], "settings.retention", "retention_days")
    return body


@app.get("/v1/admin/monitoring")
def monitoring(user=Admin):
    return {"process_http_status_counts": dict(request_counts), "dispatch_enabled": False}