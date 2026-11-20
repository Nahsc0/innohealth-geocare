"""Synthetic operational workflows. No interface to external dispatch exists."""
import secrets
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, Field

from .core import audit, digest, now, one, query, reveal, rows, seal, transaction, uid
from .directory import Point
from .postcodes import normalize
from .security import current_user, limit, roles

router = APIRouter(prefix="/v1")
Dispatcher = Depends(roles("dispatcher", "admin"))
Operations = Depends(roles("dispatcher", "responder", "admin"))
Clinician = Depends(roles("clinician"))
ReferralReader = Depends(roles("clinician", "admin"))
STEPS = {"submitted":"awaiting_acknowledgement", "awaiting_acknowledgement":"acknowledged",
         "acknowledged":"assigned", "assigned":"en_route", "en_route":"arrived", "arrived":"completed"}

class Incident(BaseModel):
    category: Literal["maternal", "traffic", "acute", "other"]
    point: Point | None = None
    postcode: str | None = Field(default=None, max_length=32)
    callback: str | None = Field(default=None, pattern=r"^\+?[0-9 ()-]{6,30}$")
    landmark: str | None = Field(default=None, max_length=280)
    synthetic: Literal[True]

@router.post("/incidents", status_code=201, dependencies=[Depends(current_user)])
def submit(body: Incident, request: Request, retry_key: str | None = Header(None, alias="X-Tracking-Key", pattern=r"^[A-Za-z0-9_-]{36,64}$")):
    limit(request, "incident", 10)
    data = body.model_dump(exclude={"category", "synthetic"})
    if body.postcode:
        try:
            data["postcode"] = normalize(body.postcode)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    if not (body.point or body.postcode or (body.landmark and body.landmark.strip())):
        raise HTTPException(422, "Provide a simulated location")
    record_id, key, timestamp = uid(), retry_key or secrets.token_urlsafe(32), now()
    with transaction() as db:
        created = query(db, """INSERT INTO incidents(id,secret_hash,category,status,location,created,updated)
                     VALUES (:id,:key,:category,'submitted',:location,:time,:time) ON CONFLICT(secret_hash) DO NOTHING""",
              id=record_id, key=digest(key), category=body.category, location=seal(data), time=timestamp)
        if not created.rowcount:
            previous = one(db, "SELECT id,category,status,location FROM incidents WHERE secret_hash=:key", key=digest(key))
            if previous["category"] != body.category or reveal(previous["location"]) != data:
                raise HTTPException(409, "Tracking key was already used for another submission")
            return {"id": previous["id"], "tracking_key": key, "status": previous["status"], "dispatch_enabled": False}
        audit(db, None, "incident.submitted", record_id)
    return {"id": record_id, "tracking_key": key, "status": "submitted", "dispatch_enabled": False}

@router.post("/incidents/{record_id}/track", dependencies=[Depends(current_user)])
def track(record_id: str, request: Request, tracking_key: str = Header("", alias="X-Tracking-Key", max_length=100)):
    limit(request, "track", 45)
    with transaction() as db:
        record = one(db, """SELECT id,status,created,updated FROM incidents
                              WHERE id=:id AND secret_hash=:key""", id=record_id, key=digest(tracking_key))
    if not record:
        raise HTTPException(404, "Tracking record not found")
    return {**record, "dispatch_enabled": False}

def can_access(record, user):
    if not record:
        return False
    if user["role"] == "admin":
        return True
    if user["role"] == "responder":
        return record["responder_id"] == user["id"]
    return record["org_id"] in (None, user["org_id"])

JOIN = " FROM incidents i LEFT JOIN ambulances a ON i.ambulance_id=a.id "
FIELDS = "i.id,i.category,i.status,i.location,i.created,i.updated,i.escalated,a.org_id,a.responder_id,a.label"

def incident(db, record_id, user):
    record = one(db, "SELECT "+FIELDS+JOIN+"WHERE i.id=:id", id=record_id)
    if not can_access(record,user):
        raise HTTPException(404, "Incident not found")
    return record

@router.get("/ops/incidents")
def queue(user=Operations):
    condition = {"responder":"a.responder_id=:actor", "dispatcher":"(a.org_id IS NULL OR a.org_id=:org)",
                 "admin":"1=1"}[user["role"]]
    with transaction() as db:
        result = rows(db, "SELECT "+FIELDS+JOIN+"WHERE "+condition+" ORDER BY i.created DESC LIMIT 100",
                      actor=user["id"], org=user["org_id"])
    for row in result:
        row["location"] = reveal(row["location"])
    return result

class Ambulance(BaseModel):
    label: str = Field(min_length=2, max_length=100)
    responder_id: str = Field(min_length=1, max_length=64)
    available: bool = True

@router.get("/ops/ambulances")
def fleet(user=Dispatcher):
    with transaction() as db:
        return rows(db, "SELECT * FROM ambulances WHERE org_id=:org OR :admin=1 ORDER BY label LIMIT 100",
                    org=user["org_id"],admin=int(user["role"]=="admin"))

@router.post("/ops/ambulances/{record_id}")
def save_ambulance(record_id: str, body: Ambulance, user=Dispatcher):
    if len(record_id)>64:
        raise HTTPException(422, "Invalid ambulance ID")
    with transaction() as db:
        responder = one(db, "SELECT org_id FROM users WHERE id=:id AND active=1 AND role='responder'", id=body.responder_id)
        if not responder or (user["role"] != "admin" and responder["org_id"] != user["org_id"]):
            raise HTTPException(404, "Responder not found")
        changed = query(db, """INSERT INTO ambulances VALUES (:id,:org,:label,:responder,:available)
            ON CONFLICT(id) DO UPDATE SET label=excluded.label,responder_id=excluded.responder_id,available=excluded.available
            WHERE ambulances.org_id=excluded.org_id AND NOT EXISTS
            (SELECT 1 FROM incidents WHERE ambulance_id=:id AND status IN ('assigned','en_route','arrived'))""",
            id=record_id, org=responder["org_id"], label=body.label, responder=body.responder_id, available=int(body.available))
        if not changed.rowcount:
            raise HTTPException(409, "Ambulance ID is unavailable for editing")
        audit(db, user["id"], "ambulance.updated", record_id)
    return {"id": record_id}

class Transition(BaseModel):
    status: Literal["awaiting_acknowledgement","acknowledged","assigned","en_route","arrived","completed","cancelled"]
    ambulance_id: str | None = Field(default=None, max_length=64)

@router.patch("/ops/incidents/{record_id}")
def transition(record_id: str, body: Transition, user=Operations):
    dispatcher = user["role"] != "responder"
    with transaction() as db:
        record = incident(db, record_id, user)
        before = record["status"]
        if body.status != STEPS.get(before) and not (body.status=="cancelled" and before in STEPS):
            raise HTTPException(409, "Invalid status transition")
        if not dispatcher and body.status not in {"en_route","arrived","completed"}:
            raise HTTPException(403, "Dispatcher required")
        if body.status=="assigned":
            if not body.ambulance_id:
                raise HTTPException(422, "Choose an available ambulance")
            changed = query(db, """UPDATE ambulances SET available=0 WHERE id=:id AND available=1
                AND (org_id=:org OR :admin=1) AND EXISTS(SELECT 1 FROM users u JOIN organisations o ON o.id=u.org_id
                WHERE u.id=ambulances.responder_id AND u.active=1 AND o.verified=1)""",
                id=body.ambulance_id, org=user["org_id"], admin=int(user["role"]=="admin"))
            if not changed.rowcount:
                raise HTTPException(409, "Ambulance is unavailable")
        changed = query(db, """UPDATE incidents SET status=:status,updated=:time,
            ambulance_id=COALESCE(:ambulance,ambulance_id) WHERE id=:id AND status=:before""",
            status=body.status,time=now(),id=record_id,before=before,
            ambulance=body.ambulance_id if body.status=="assigned" else None)
        if not changed.rowcount:
            raise HTTPException(409, "Incident status changed concurrently")
        if body.status in {"completed","cancelled"}:
            query(db, "UPDATE ambulances SET available=1 WHERE id=(SELECT ambulance_id FROM incidents WHERE id=:id)", id=record_id)
        audit(db, user["id"], "incident."+body.status, record_id)
    return {"id": record_id, "status":body.status,"dispatch_enabled":False}

@router.post("/ops/incidents/{record_id}/escalate")
def escalate(record_id: str,user=Dispatcher):
    with transaction() as db:
        incident(db,record_id,user)
        if not query(db,"UPDATE incidents SET escalated=1 WHERE id=:id AND escalated=0 AND status NOT IN ('completed','cancelled')",
                     id=record_id).rowcount:
            raise HTTPException(409,"Incident cannot be escalated")
        audit(db,user["id"],"incident.escalated",record_id)
    return {"id":record_id,"escalated":True}

class Message(BaseModel):
    message: str = Field(min_length=1,max_length=500)

@router.get("/ops/incidents/{record_id}/messages")
def messages(record_id: str,user=Operations):
    with transaction() as db:
        incident(db,record_id,user)
        result = rows(db,"SELECT author,message,created FROM incident_messages WHERE incident_id=:id ORDER BY created DESC LIMIT 100",id=record_id)
    return [{**item,"message":reveal(item["message"])} for item in result]

@router.post("/ops/incidents/{record_id}/messages",status_code=201)
def message(record_id: str,body: Message,user=Operations):
    with transaction() as db:
        record = incident(db,record_id,user)
        if not record["responder_id"]:
            raise HTTPException(409,"Assign a sandbox responder first")
        query(db,"INSERT INTO incident_messages VALUES (:id,:incident,:author,:message,:created)",
              id=uid(),incident=record_id,author=user["id"],message=seal(body.message),created=now())
        audit(db,user["id"],"incident.message",record_id)
    return {"saved":True}

class Referral(BaseModel):
    facility_id: str = Field(min_length=1,max_length=64)
    patient_reference: str = Field(min_length=1,max_length=80)
    reason: str = Field(min_length=2,max_length=500)
    basis: Literal["consent", "documented_other_basis"]
    synthetic: Literal[True]

@router.post("/referrals",status_code=201)
def create_referral(body: Referral,user=Clinician):
    record_id = uid()
    with transaction() as db:
        target = one(db,"""SELECT f.org_id FROM facilities f JOIN organisations o ON o.id=f.org_id
            WHERE f.id=:id AND f.verified_at IS NOT NULL AND o.verified=1""",id=body.facility_id)
        if not target or target["org_id"]==user["org_id"]:
            raise HTTPException(422,"Select a verified receiving facility in another partner organisation")
        query(db,"INSERT INTO referrals VALUES (:id,:sender,:receiver,:facility,:details,'requested',:time,:time)",
              id=record_id,sender=user["org_id"],receiver=target["org_id"],facility=body.facility_id,
              details=seal(body.model_dump(exclude={"facility_id","synthetic"})),time=now())
        audit(db,user["id"],"referral.requested",record_id)
    return {"id":record_id,"status":"requested"}

@router.get("/referrals")
def referrals(user=ReferralReader):
    with transaction() as db:
        result = rows(db,"""SELECT * FROM referrals WHERE sender=:org OR receiver=:org
                            OR :admin=1 ORDER BY created DESC LIMIT 100""",org=user["org_id"],admin=int(user["role"]=="admin"))
    for row in result:
        row["details"] = reveal(row["details"]) if user["role"]=="clinician" else None
    return result

class ReferralStep(BaseModel):
    status: Literal["acknowledged","handed_over","completed","cancelled"]

@router.patch("/referrals/{record_id}")
def referral_step(record_id: str,body: ReferralStep,user=Clinician):
    sequences = {"acknowledged":("requested","receiver"),"handed_over":("acknowledged","receiver"),
                 "completed":("handed_over","receiver"),"cancelled":("requested","sender")}
    previous, role = sequences[body.status]
    with transaction() as db:
        record = one(db,"SELECT * FROM referrals WHERE id=:id AND (sender=:org OR receiver=:org)",
                     id=record_id,org=user["org_id"])
        if not record:
            raise HTTPException(404,"Referral not found")
        if not query(db,f"UPDATE referrals SET status=:status,updated=:time WHERE id=:id AND status=:previous AND {role}=:org",
                     status=body.status,time=now(),id=record_id,previous=previous,org=user["org_id"]).rowcount:
            raise HTTPException(409,"This organisation or referral status does not allow the transition")
        audit(db,user["id"],"referral."+body.status,record_id)
    return {"status":body.status}
