"""Nearest-PHC estimates using published community centroids."""
from datetime import date
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import Field, HttpUrl

from .core import POSTGIS, audit, one, query, rows, transaction
from .directory import Point, distance, road_estimate
from .security import limit, roles

router = APIRouter(prefix="/v1")
Admin = Depends(roles("admin"))
Analyst = Depends(roles("analyst", "admin"))

class Community(Point):
    name: str = Field(min_length=2,max_length=120)
    state: str = Field(min_length=2,max_length=80)
    lga: str = Field(min_length=2,max_length=80)
    population: int | None = Field(default=None, ge=0)
    source: HttpUrl
    verified_at: date

@router.post("/admin/communities/{record_id}")
def add_community(record_id: str, body: Community, user=Admin):
    if len(record_id)>64 or body.verified_at>date.today():
        raise HTTPException(422,"Check the community ID and verification date")
    with transaction() as db:
        query(db, """INSERT INTO communities VALUES (:id,:name,:state,:lga,:lat,:lon,:population,:source,:verified_at)
              ON CONFLICT(id) DO UPDATE SET name=excluded.name,state=excluded.state,lga=excluded.lga,
              lat=excluded.lat,lon=excluded.lon,population=excluded.population,source=excluded.source,verified_at=excluded.verified_at""",
              id=record_id,**body.model_dump(mode="json"))
        audit(db,user["id"],"community.verified",record_id)
    return {"id":record_id}

def accessibility(db, state, threshold):
    if POSTGIS:
        point="ST_SetSRID(ST_MakePoint(c.lon,c.lat),4326)::geography"
        return rows(db,f"""SELECT c.*,f.id AS facility_id,f.name AS facility,
            ST_Distance(f.geog,{point},false)/1000 AS distance_km,
            ST_Distance(f.geog,{point},false) > :threshold * 1000 AS beyond_threshold
            FROM communities c LEFT JOIN LATERAL (
              SELECT id,name,geog FROM facilities WHERE lower(state)=lower(:state)
              AND category='phc' AND verified_at IS NOT NULL AND geog IS NOT NULL
              ORDER BY geog <-> {point},id LIMIT 1
            ) f ON true WHERE lower(c.state)=lower(:state) ORDER BY c.lga,c.name,c.id LIMIT 500""",
            state=state,threshold=threshold)
    communities=rows(db,"SELECT * FROM communities WHERE lower(state)=lower(:state) ORDER BY lga,name,id LIMIT 500",state=state)
    providers=rows(db,"""SELECT id,name,lat,lon FROM facilities WHERE lower(state)=lower(:state)
        AND category='phc' AND verified_at IS NOT NULL AND lat IS NOT NULL ORDER BY id""",state=state)
    for place in communities:
        km, nearest=min(((distance(place["lat"],place["lon"],f["lat"],f["lon"]),f) for f in providers),
                        key=lambda item:item[0],default=(None,None))
        place.update(facility_id=nearest["id"] if nearest else None,facility=nearest["name"] if nearest else None,
                     distance_km=km,beyond_threshold=km>threshold if km is not None else None)
    return communities

@router.get("/analytics/access")
def access(state: str=Query("Kaduna",max_length=80), threshold_km: float=Query(5,gt=0,le=100),user=Analyst):
    with transaction() as db:
        return {"threshold_km":threshold_km,"communities":accessibility(db,state,threshold_km)}

@router.post("/analytics/access/{community_id}/{facility_id}/route")
async def access_route(community_id: str,facility_id: str,request: Request,user=Analyst):
    limit(request,"access-route",25)
    with transaction() as db:
        start=one(db,"SELECT lat,lon FROM communities WHERE id=:id",id=community_id)
        finish=one(db,"SELECT lat,lon FROM facilities WHERE id=:id AND category='phc' AND verified_at IS NOT NULL",id=facility_id)
    if not start or not finish or finish["lat"] is None:
        raise HTTPException(404,"Verified routing points are unavailable")
    return await road_estimate(Point(**start),finish)

@router.get("/referral-destinations")
def destinations(state: str=Query("Kaduna",max_length=80),user=Depends(roles("clinician"))):
    with transaction() as db:
        return rows(db,"""SELECT f.id,f.name,f.lga,f.category,f.services,f.phone
             FROM facilities f JOIN organisations o ON f.org_id=o.id
             WHERE f.verified_at IS NOT NULL AND o.verified=1 AND f.org_id<>:org
             AND lower(f.state)=lower(:state) ORDER BY f.name,f.id LIMIT 100""",org=user["org_id"],state=state)
