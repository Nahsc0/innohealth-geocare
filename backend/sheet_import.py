"""Import and refresh verified facility listings from Google Sheets."""
import csv
import io
import os
import re
from datetime import date, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from google.auth import default as google_credentials
from google.auth.exceptions import GoogleAuthError
from google.auth.transport.requests import AuthorizedSession
from pydantic import BaseModel, Field, ValidationError
from requests import RequestException
from sqlalchemy import bindparam, text

from .core import POSTGIS, audit, query, transaction
from .directory import Facility
from .security import roles

router = APIRouter(prefix="/v1")
FIELDS = tuple(key for key in Facility.model_fields if key != "org_id")
REQUIRED = {"id", "name", "state", "lga", "category", "source", "verified_at"}
SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"
GOOGLE_DATE_EPOCH = date(1899, 12, 30)

class Snapshot(BaseModel):
    csv: str = Field(min_length=1, max_length=500_000)

def snapshot_records(text):
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff"), newline=""), strict=True)
    records = validate_records(reader.fieldnames or [], ((reader.line_num, row) for row in reader), True)
    if not records:
        raise HTTPException(422, "The CSV has no facility records")
    return records

def validate_records(headers, input_rows, require_coordinates):
    if not REQUIRED.issubset(headers) or len(set(headers)) != len(headers) or set(headers) - set(FIELDS) - {"id"}:
        raise HTTPException(422, "Unexpected headers. Use the GeoCare Facilities tab format.")
    seen = set()
    records = []
    for row_number, row in input_rows:
        if len(records) >= 1000:
            raise HTTPException(422, "Import at most 1,000 facilities at a time")
        if None in row:
            raise HTTPException(422, f"Row {row_number} has extra columns")
        identifier = (row.pop("id") or "").strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", identifier) or identifier in seen:
            raise HTTPException(422, f"Row {row_number} needs a unique facility ID")
        seen.add(identifier)
        values = {key: (value or "").strip() or None for key, value in row.items()}
        try:
            model = Facility.model_validate(values)
        except ValidationError as exc:
            raise HTTPException(422, f"Check the facility details in row {row_number}") from exc
        if not model.verified_at:
            raise HTTPException(422, f"Row {row_number} needs a verification date")
        if require_coordinates and model.lat is None:
            raise HTTPException(422, f"Row {row_number} needs both coordinates")
        records.append({"id": identifier, **model.model_dump(mode="json", exclude={"org_id"})})
    return records

def save_records(db, records, actor):
    if not records:
        return
    columns = ("id", *FIELDS)
    names = ",".join(columns)
    bindings = ",".join(":"+field for field in columns)
    updates = ",".join(field+"=excluded."+field for field in FIELDS)
    db.execute(text(f"INSERT INTO facilities ({names}) VALUES ({bindings}) ON CONFLICT(id) DO UPDATE SET {updates}"), records)
    for record in records:
        audit(db, actor, "facility.sheet_imported", record["id"])

@router.post("/admin/facility-snapshot")
def import_snapshot(body: Snapshot, user=Depends(roles("admin"))):
    try:
        records = snapshot_records(body.csv)
    except csv.Error as exc:
        raise HTTPException(422, "The file is not a valid CSV export") from exc
    with transaction() as db:
        save_records(db, records, user["id"])
    return {"imported": len(records)}

def read_sheet(spreadsheet_id):
    try:
        credentials, _ = google_credentials(scopes=[SHEETS_SCOPE])
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{quote(spreadsheet_id, safe='')}/values/Facilities"
        with AuthorizedSession(credentials, refresh_timeout=5) as session:
            response = session.get(url, params={"valueRenderOption": "UNFORMATTED_VALUE"}, timeout=5)
            response.raise_for_status()
            return response.json().get("values", [])
    except (GoogleAuthError, RequestException, ValueError) as exc:
        raise HTTPException(503, "Could not read the Facilities tab. Check GeoCare's Google credentials and Viewer access.") from exc

def sheet_rows(values, headers):
    for row_number, cells in enumerate(values, start=2):
        if not any(str(value).strip() for value in cells):
            continue
        row = dict(zip(headers, cells))
        if len(cells) > len(headers):
            row[None] = None
        verified = row.get("verified_at")
        if type(verified) in (int, float):
            try:
                row["verified_at"] = GOOGLE_DATE_EPOCH + timedelta(days=verified)
            except (OverflowError, ValueError) as exc:
                raise HTTPException(422, f"Check the verification date in row {row_number}") from exc
        yield row_number, {key: str(value) for key, value in row.items()}

@router.post("/admin/facility-sheet/refresh")
def refresh_sheet(user=Depends(roles("admin"))):
    spreadsheet_id = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", "").strip()
    if not spreadsheet_id:
        raise HTTPException(503, "Google Sheets refresh is not configured on this backend.")
    values = read_sheet(spreadsheet_id)
    headers = [str(value).strip() for value in values[0]] if values else []
    records = validate_records(headers, sheet_rows(values[1:], headers), False)
    ids = [record["id"] for record in records]
    with transaction() as db:
        if POSTGIS:
            query(db, "SELECT pg_advisory_xact_lock(21670512)")
        removed = db.execute(text("""DELETE FROM facility_sheet_entries
            WHERE facility_id NOT IN :ids RETURNING facility_id""").bindparams(bindparam("ids", expanding=True)), {"ids": ids}).scalars().all()
        for facility_id in removed:
            query(db, "UPDATE facilities SET verified_at=NULL WHERE id=:id", id=facility_id)
            audit(db, user["id"], "facility.sheet_unpublished", facility_id)
        save_records(db, records, user["id"])
        if records:
            db.execute(text("""INSERT INTO facility_sheet_entries (facility_id) VALUES (:id)
                ON CONFLICT DO NOTHING"""), [{"id": facility_id} for facility_id in ids])
    return {"imported": len(records), "unpublished": len(removed)}
