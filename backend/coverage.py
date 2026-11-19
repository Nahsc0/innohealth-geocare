"""Aggregate pilot coverage and timing reports."""
from datetime import date
import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy.exc import IntegrityError

from .core import audit, query, rows, transaction
from .security import roles

router=APIRouter(prefix="/v1")
Admin=Depends(roles("admin"))
Analyst=Depends(roles("analyst","admin"))

class Area(BaseModel):
    state: str=Field(min_length=2,max_length=80)
    lga: str=Field(min_length=2,max_length=80)
    population: int=Field(gt=0,le=1_000_000_000)
    area_km2: float=Field(gt=0,le=1_000_000)
    source: HttpUrl
    verified_at: date

@router.post("/admin/areas/{record_id}")
def save_area(record_id: str,body: Area,user=Admin):
    data=body.model_dump(mode="json")
    data.update(state=body.state.strip().casefold(),lga=body.lga.strip().casefold())
    if len(record_id)>64 or body.verified_at>date.today() or not all([data["state"],data["lga"]]):
        raise HTTPException(422,"Check the area ID, state, LGA and verification date")
    try:
        with transaction() as db:
            query(db,"""INSERT INTO area_profiles VALUES (:id,:state,:lga,:population,:area_km2,:source,:verified_at)
                ON CONFLICT(id) DO UPDATE SET state=excluded.state,lga=excluded.lga,population=excluded.population,
                area_km2=excluded.area_km2,source=excluded.source,verified_at=excluded.verified_at""",id=record_id,**data)
            audit(db,user["id"],"area.verified",record_id)
    except IntegrityError as exc:
        raise HTTPException(409,"An area profile already exists for this state and LGA") from exc
    return {"id":record_id}

def coverage(db,state):
    areas=rows(db,"""SELECT a.id,a.lga,a.population,a.area_km2,a.source,a.verified_at, COUNT(f.id) AS facility_count,
        COALESCE(SUM(CASE WHEN f.category='phc' THEN 1 ELSE 0 END),0) AS phc_count
        FROM area_profiles a LEFT JOIN facilities f ON lower(trim(f.state))=a.state AND lower(trim(f.lga))=a.lga
        AND f.verified_at IS NOT NULL WHERE a.state=:state
        GROUP BY a.id,a.lga,a.population,a.area_km2,a.source,a.verified_at ORDER BY a.lga LIMIT 100""",state=state.strip().casefold())
    for area in areas:
        area["facilities_per_100_km2"]=round(100*area["facility_count"]/area["area_km2"],2)
        area["phcs_per_10000_people"]=round(10000*area["phc_count"]/area["population"],2)
    return areas

@router.get("/analytics/coverage")
def coverage_report(state: str=Query("Kaduna", max_length=80),user=Analyst):
    with transaction() as db:
        areas=coverage(db,state)
        timings=rows(db,"""SELECT a.action AS stage,COUNT(*) AS total,AVG(a.created-r.created) AS mean_seconds
            FROM audit a JOIN referrals r ON a.entity=r.id
            WHERE a.action IN ('referral.acknowledged','referral.handed_over','referral.completed')
            GROUP BY a.action HAVING COUNT(*)>=5
            UNION ALL
            SELECT a.action,COUNT(*),AVG(a.created-i.created)
            FROM audit a JOIN incidents i ON a.entity=i.id
            WHERE a.action IN ('incident.acknowledged','incident.assigned','incident.arrived','incident.completed')
            GROUP BY a.action HAVING COUNT(*)>=5 ORDER BY 1""")
    return {"areas":areas,"timings":timings}

@router.get("/analytics/coverage/export")
def export_coverage(state: str=Query("Kaduna", max_length=80),user=Analyst):
    output=io.StringIO()
    keys=["lga","population","area_km2","facility_count","phc_count","facilities_per_100_km2",
          "phcs_per_10000_people","verified_at","source"]
    writer=csv.DictWriter(output,keys,extrasaction="ignore")
    writer.writeheader()
    with transaction() as db:
        for record in coverage(db,state):
            if record["lga"].lstrip().startswith(("=","+","-","@")):
                record["lga"]="'"+record["lga"]
            writer.writerow(record)
        audit(db,user["id"],"coverage.export","aggregate")
    return Response(output.getvalue(),media_type="text/csv",headers={"Content-Disposition":"attachment; filename=geocare-lga-coverage.csv"})
