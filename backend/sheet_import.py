"""Import a private Google Sheets CSV snapshot into the facility directory."""
import csv
import io
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import text

from .core import audit, transaction
from .directory import Facility
from .security import roles

router = APIRouter(prefix="/v1")
FIELDS = tuple(key for key in Facility.model_fields if key != "org_id")
REQUIRED = {"id", "name", "state", "lga", "category", "source", "verified_at"}

class Snapshot(BaseModel):
    csv: str = Field(min_length=1, max_length=500_000)

def snapshot_records(text):
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff"), newline=""), strict=True)
    headers = reader.fieldnames or []
    if not REQUIRED.issubset(headers) or len(set(headers)) != len(headers) or set(headers) - set(FIELDS) - {"id"}:
        raise HTTPException(422, "Unexpected CSV headers. Use the GeoCare Facilities tab format.")
    seen = set()
    records = []
    for row in reader:
        if len(records) >= 1000:
            raise HTTPException(422, "Import at most 1,000 facilities at a time")
        if None in row:
            raise HTTPException(422, f"Row {reader.line_num} has extra columns")
        identifier = (row.pop("id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", identifier) or identifier in seen:
            raise HTTPException(422, f"Row {reader.line_num} needs a unique facility ID")
        seen.add(identifier)
        values = {key: (value or "").strip() or None for key, value in row.items()}
        try:
            model = Facility.model_validate(values)
        except ValidationError as exc:
            raise HTTPException(422, f"Check the facility details in row {reader.line_num}") from exc
        if not model.verified_at or model.lat is None:
            raise HTTPException(422, f"Row {reader.line_num} needs a verification date and both coordinates")
        records.append({"id": identifier, **model.model_dump(mode="json", exclude={"org_id"})})
    if not records:
        raise HTTPException(422, "The CSV has no facility records")
    return records

@router.post("/admin/facility-snapshot")
def import_snapshot(body: Snapshot, user=Depends(roles("admin"))):
    try:
        records = snapshot_records(body.csv)
    except csv.Error as exc:
        raise HTTPException(422, "The file is not a valid CSV export") from exc
    columns = ("id", *FIELDS)
    names = ",".join(columns)
    bindings = ",".join(":"+field for field in columns)
    updates = ",".join(field+"=excluded."+field for field in FIELDS)
    with transaction() as db:
        db.execute(text(f"INSERT INTO facilities ({names}) VALUES ({bindings}) ON CONFLICT(id) DO UPDATE SET {updates}"), records)
        for record in records:
            audit(db, user["id"], "facility.sheet_imported", record["id"])
    return {"imported": len(records)}
