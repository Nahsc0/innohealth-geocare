"""Verified facility catalog, configurable routing and aggregate reports."""
import csv
import io
import math
import os
from datetime import date
from typing import Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, Field, HttpUrl, model_validator

from .core import POSTGIS, audit, one, query, rows, transaction
from .postcodes import normalize
from .security import limit, roles

router = APIRouter(prefix="/v1")
Category = Literal["phc","general","specialist","maternity","emergency","pharmacy","laboratory"]
Admin = Depends(roles("admin"))
Analyst = Depends(roles("analyst", "admin"))
PUBLIC = "id,name,state,lga,ward,postcode,lat,lon,category,ownership,services,hours,phone,source,verified_at"

class Point(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)

class Facility(BaseModel):
    name: str = Field(min_length=2, max_length=200)
    state: str = Field(min_length=2, max_length=80)
    lga: str = Field(min_length=2, max_length=80)
    ward: str | None = Field(default=None, max_length=80)
    postcode: str | None = Field(default=None, max_length=32)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    category: Category
    ownership: str | None = Field(default=None, max_length=80)
    services: str | None = Field(default=None, max_length=1500)
    hours: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, pattern=r"^\+?[0-9 ()-]{6,30}$")
    source: HttpUrl
    verified_at: date | None = None
    org_id: str | None = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def evidence(self):
        if (self.lat is None) != (self.lon is None):
            raise ValueError("Provide both coordinates or neither")
        if self.verified_at and self.verified_at > date.today():
            raise ValueError("Verification date cannot be in the future")
        if self.postcode:
            self.postcode = normalize(self.postcode)
        return self

def distance(a, b, lat, lon):
    x = math.sin(math.radians(lat-a)/2)**2 + math.cos(math.radians(a))*math.cos(math.radians(lat))*math.sin(math.radians(lon-b)/2)**2
    return 12742 * math.asin(math.sqrt(min(1, x)))

@router.get("/facilities")
def facilities(state: str = Query("Kaduna", max_length=80), category: Category | None = None,
               q: str = Query("", max_length=100), lat: float | None = Query(None, ge=-90, le=90),
               lon: float | None = Query(None, ge=-180, le=180), radius: int = Query(50, ge=1, le=300)):
    if (lat is None) != (lon is None):
        raise HTTPException(422, "Provide both coordinates")
    if not state and lat is None:
        raise HTTPException(422, "Select a state or provide a location")
    conditions = """verified_at IS NOT NULL AND (:state='' OR lower(state)=lower(:state))
        AND (CAST(:category AS VARCHAR) IS NULL OR category=:category)
        AND (lower(name) LIKE :q OR lower(lga) LIKE :q)"""
    params = dict(state=state, category=category, q="%"+q.lower()+"%", lat=lat, lon=lon, radius=radius)
    with transaction() as db:
        if lat is not None and POSTGIS:
            origin = "ST_SetSRID(ST_MakePoint(:lon,:lat),4326)::geography"
            return rows(db, f"""SELECT {PUBLIC}, ST_Distance(geog,{origin})/1000 AS distance_km
                         FROM facilities WHERE {conditions} AND ST_DWithin(geog,{origin},:radius*1000)
                         ORDER BY distance_km,id LIMIT 100""", **params)
        if lat is None:
            return rows(db, f"SELECT {PUBLIC} FROM facilities WHERE {conditions} ORDER BY name,id LIMIT 100", **params)
        records = rows(db, f"SELECT {PUBLIC} FROM facilities WHERE {conditions} AND lat IS NOT NULL", **params)
    for record in records:
        record["distance_km"] = distance(lat, lon, record["lat"], record["lon"])
    return sorted((item for item in records if item["distance_km"] <= radius), key=lambda item: item["distance_km"])[:100]

@router.get("/facilities/{record_id}")
def facility(record_id: str):
    with transaction() as db:
        record = one(db, f"SELECT {PUBLIC} FROM facilities WHERE id=:id AND verified_at IS NOT NULL", id=record_id)
    if record is None:
        raise HTTPException(404, "Facility not found")
    return record

@router.get("/admin/facilities")
def list_drafts(user=Admin):
    with transaction() as db:
        return rows(db, f"SELECT {PUBLIC},org_id FROM facilities ORDER BY name LIMIT 500")

@router.post("/admin/facilities/{record_id}")
def verify(record_id: str, body: Facility, user=Admin):
    if not record_id or len(record_id) > 64:
        raise HTTPException(422, "Facility ID must be 1–64 characters")
    data = body.model_dump(mode="json")
    keys = list(data)
    with transaction() as db:
        if body.org_id and not one(db, "SELECT id FROM organisations WHERE id=:id", id=body.org_id):
            raise HTTPException(404, "Organisation not found")
        columns = ",".join(keys)
        values = ",".join(":"+key for key in keys)
        changes = ",".join(key+"=excluded."+key for key in keys)
        query(db, f"INSERT INTO facilities (id,{columns}) VALUES (:id,{values}) ON CONFLICT(id) DO UPDATE SET {changes}",
              id=record_id, **data)
        audit(db, user["id"], "facility.verified" if body.verified_at else "facility.draft", record_id)
    return {"id": record_id, "published": body.verified_at is not None}

@router.post("/facilities/{record_id}/route")
async def route(record_id: str, point: Point, request: Request):
    limit(request, "route", 25)
    return await road_estimate(point, facility(record_id))

async def road_estimate(point, target):
    base = os.getenv("OSRM_BASE_URL", "").rstrip("/")
    if not base or target["lat"] is None:
        raise HTTPException(503, "Road routing is unavailable")
    try:
        async with httpx.AsyncClient(timeout=6) as client:
            response = await client.get(f"{base}/route/v1/driving/{point.lon},{point.lat};{target['lon']},{target['lat']}",
                                        params={"overview": "false", "alternatives": "false", "steps": "false"})
        response.raise_for_status()
        result = response.json()["routes"][0]
        seconds, meters = float(result["duration"]), float(result["distance"])
        if not all(math.isfinite(x) and x >= 0 for x in (seconds, meters)):
            raise ValueError("Invalid route")
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        raise HTTPException(503, "Road routing is unavailable") from exc
    return {"minutes": round(seconds/60, 1), "km": round(meters/1000, 1)}

def aggregates(db):
    return rows(db, """SELECT 'facility' AS dataset, state || ' / ' || lga AS area,
        category AS label, COUNT(*) AS total FROM facilities WHERE verified_at IS NOT NULL
        GROUP BY state,lga,category HAVING COUNT(*)>=5
        UNION ALL SELECT 'incident','Sandbox',category,COUNT(*) FROM incidents GROUP BY category HAVING COUNT(*)>=5
        UNION ALL SELECT 'referral','Sandbox',status,COUNT(*) FROM referrals GROUP BY status HAVING COUNT(*)>=5
        ORDER BY 1,2,3""")

@router.get("/analytics")
def analytics(user=Analyst):
    with transaction() as db:
        return {"minimum_count": 5, "cells": aggregates(db)}

@router.get("/analytics/export")
def export(user=Analyst):
    keys = ["dataset", "area", "label", "total"]
    output = io.StringIO()
    writer = csv.DictWriter(output, keys)
    writer.writeheader()
    with transaction() as db:
        for record in aggregates(db):
            writer.writerow({k: "'"+v if isinstance(v,str) and v.lstrip().startswith(("=","+","-","@")) else v
                             for k,v in record.items()})
        audit(db,user["id"],"analytics.export","aggregate")
    return Response(output.getvalue(), media_type="text/csv", headers={"Content-Disposition": "attachment; filename=geocare-aggregates.csv"})
