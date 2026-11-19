"""Partner signup with administrator-issued, single-use account activation."""
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from .core import audit, digest, now, one, passwords, query, rows, transaction, uid
from .security import limit, roles

router = APIRouter(prefix="/v1")
admin_only = Depends(roles("admin"))

class Application(BaseModel):
    email: str = Field(max_length=254)
    organisation: str = Field(min_length=2, max_length=200)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+", value):
            raise ValueError("Enter a valid email")
        return value

@router.post("/partner/signup", status_code=202)
def apply(body: Application, request: Request):
    limit(request, "partner-signup", 5, 900)
    organisation = body.organisation.strip()
    if len(organisation) < 2:
        raise HTTPException(422, "Enter your organisation")
    identifier = uid()
    with transaction() as db:
        added = query(db, """INSERT INTO partner_applications(id,email,organisation,created)
            SELECT :id,:email,:org,:created WHERE NOT EXISTS(SELECT 1 FROM users WHERE email=:email)
            ON CONFLICT(email) DO NOTHING""", id=identifier, email=body.email, org=organisation, created=now())
        if added.rowcount:
            audit(db, None, "partner.applied", identifier)
    return {"message": "If eligible, your access request will be reviewed by an administrator."}

@router.get("/admin/partner-applications")
def list_applications(user=admin_only):
    with transaction() as db:
        return rows(db, """SELECT id,email,organisation,status,expires FROM partner_applications
            WHERE status IN ('pending','approved') ORDER BY created DESC LIMIT 200""")

class Approval(BaseModel):
    org_id: str = Field(min_length=1, max_length=64)
    role: Literal["dispatcher", "responder", "clinician", "analyst"]

@router.post("/admin/partner-applications/{identifier}/approve")
def approve(identifier: str, body: Approval, user=admin_only):
    code = secrets.token_urlsafe(32)
    timestamp = now()
    with transaction() as db:
        if not one(db, "SELECT id FROM organisations WHERE id=:id AND verified=1", id=body.org_id):
            raise HTTPException(422, "Select a verified organisation")
        changed = query(db, """UPDATE partner_applications
            SET status='approved', org_id=:org, role=:role, activation_hash=:code, expires=:expires
            WHERE id=:id AND status IN ('pending','approved')
            AND NOT EXISTS(SELECT 1 FROM users WHERE email=partner_applications.email)""",
            org=body.org_id, role=body.role, code=digest(code), expires=timestamp+86400, id=identifier)
        if not changed.rowcount:
            raise HTTPException(409, "This request can no longer be approved")
        audit(db, user["id"], "partner.approved", identifier)
    return {"activation_code": code}

class Activation(BaseModel):
    code: str = Field(pattern=r"^[A-Za-z0-9_-]{43}$")
    password: str = Field(min_length=14, max_length=256)

@router.post("/partner/activate", status_code=201)
def activate(body: Activation, request: Request):
    limit(request, "partner-activation", 8, 900)
    with transaction() as db:
        updated = one(db, """UPDATE partner_applications SET status='activated',activation_hash=NULL,expires=NULL
            WHERE activation_hash=:code AND expires>:now AND status='approved'
            AND EXISTS(SELECT 1 FROM organisations WHERE id=partner_applications.org_id AND verified=1)
            RETURNING id,email,role,org_id""", code=digest(body.code), now=now())
        if not updated:
            raise HTTPException(400, "Invalid or expired activation code")
        account = uid()
        inserted = query(db, """INSERT INTO users (id,email,password_hash,role,org_id,active)
            VALUES (:id,:email,:password,:role,:org,1) ON CONFLICT(email) DO NOTHING""",
            id=account, email=updated["email"], password=passwords.hash(body.password),
            role=updated["role"], org=updated["org_id"])
        if not inserted.rowcount:
            raise HTTPException(409, "Account already exists")
        audit(db, account, "partner.activated", updated["id"])
    return {"message": "Your account is active. You can now sign in."}
