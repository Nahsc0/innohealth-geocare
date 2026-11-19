"""Partner signup with administrator-issued, single-use account activation."""
import re
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator

from .core import audit, digest, now, one, query, rows, seal, transaction, uid
from .registration_email import check_code, consume_code, request_code
from .registration_store import INDIVIDUAL_ORG, individual_id, registry_config, save_verifier
from .security import issue_session, limit, roles

router = APIRouter(prefix="/v1")
admin_only = Depends(roles("admin"))

class EmailAddress(BaseModel):
    email: str = Field(max_length=254)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r"[^@\s,;<>]+@[^@\s,;<>.]+(?:\.[^@\s,;<>.]+)+", value):
            raise ValueError("Enter a valid email")
        return value

class IndividualRegistration(EmailAddress):
    password: str = Field(min_length=14, max_length=256)
    challenge: str = Field(pattern=r"^[a-f0-9]{32}$")
    code: str = Field(pattern=r"^[0-9]{6}$")
    name: str = Field(min_length=2, max_length=120)
    age: int = Field(ge=0, le=120)
    gender: Literal["female", "male", "nonbinary", "another_identity", "prefer_not_to_say"]
    state: Literal["Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno", "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT", "Gombe", "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos", "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto", "Taraba", "Yobe", "Zamfara"]
    lga: str = Field(min_length=2, max_length=100)
    phone: str = Field(pattern=r"^\+?[0-9]{7,15}$")

    @field_validator("name", "lga", mode="before")
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator("phone", mode="before")
    @classmethod
    def normalize_phone(cls, value):
        return re.sub(r"[() -]", "", value) if isinstance(value, str) else value

@router.post("/register/code", status_code=202)
def send_registration_code(body: EmailAddress, request: Request):
    limit(request, "registration-email-ip", 8, 900)
    limit(request, "registration-email:" + digest(body.email), 4, 900, per_client=False)
    return {"challenge": request_code(body.email, registry_config()), "expires_in": 600}

@router.post("/register", status_code=201)
def register(body: IndividualRegistration, request: Request):
    limit(request, "individual-registration", 5, 900)
    config = registry_config()
    check_code(body.email, body.challenge, body.code)
    account = individual_id(body.email, config)
    with transaction() as db:
        consume_code(db, body.email, body.challenge)
        inserted = query(db, """INSERT INTO users (id,email,password_hash,role,org_id,active)
            VALUES (:id,:email,'pending','individual',:org,0) ON CONFLICT(email) DO NOTHING""",
            id=account, email=body.email, org=INDIVIDUAL_ORG)
        if not inserted.rowcount:
            raise HTTPException(409, "This email already has an account. Sign in to continue.")
        verifier = save_verifier(account, "individual", body.password, config)
        query(db, "UPDATE users SET password_hash=:verifier,active=1 WHERE id=:id", verifier=verifier, id=account)
        profile = body.model_dump(include={"name", "age", "gender", "state", "lga", "phone"})
        query(db, "INSERT INTO individual_profiles (user_id,demographics,email_verified_at) VALUES (:id,:profile,:now)",
              id=account, profile=seal(profile), now=now())
        audit(db, account, "individual.registered", account)
        token = issue_session(db, account)
    return {"token": token, "role": "individual"}

class Application(EmailAddress):
    organisation: str = Field(min_length=2, max_length=200)

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
        if body.org_id == INDIVIDUAL_ORG or not one(db, "SELECT id FROM organisations WHERE id=:id AND verified=1", id=body.org_id):
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
    config = registry_config()
    with transaction() as db:
        updated = one(db, """UPDATE partner_applications SET status='activated',activation_hash=NULL,expires=NULL
            WHERE activation_hash=:code AND expires>:now AND status='approved'
            AND EXISTS(SELECT 1 FROM organisations WHERE id=partner_applications.org_id AND verified=1)
            RETURNING id,email,role,org_id""", code=digest(body.code), now=now())
        if not updated:
            raise HTTPException(400, "Invalid or expired activation code")
        account = updated["id"]
        inserted = query(db, """INSERT INTO users (id,email,password_hash,role,org_id,active)
            VALUES (:id,:email,'pending',:role,:org,0) ON CONFLICT(email) DO NOTHING""",
            id=account, email=updated["email"],
            role=updated["role"], org=updated["org_id"])
        if not inserted.rowcount:
            raise HTTPException(409, "Account already exists")
        verifier = save_verifier(account, "partner", body.password, config)
        query(db, "UPDATE users SET password_hash=:verifier,active=1 WHERE id=:id", verifier=verifier, id=account)
        audit(db, account, "partner.activated", updated["id"])
    return {"message": "Your account is active. You can now sign in."}
