"""NIPOST adapter. Level 1 validates existence and does not return coordinates."""
import os
import re

import httpx
from fastapi import HTTPException

PATTERN = re.compile(r"([A-Z]{2})([0-9]{2})([A-Z0-9]{3})([A-Z]{2})([0-9]{2})")
MOCK_POSTCODE = "ZZ-01-A01-ZZ-01"

def normalize(value):
    match = PATTERN.fullmatch(re.sub(r"[ -]", "", value.strip().upper()))
    if not match or "00" in (match[2], match[5]):
        raise ValueError("Enter a full digital postcode, for example AA-01-A01-AA-01.")
    return "-".join(match.groups())

async def lookup(raw):
    try:
        code = normalize(raw)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc

    key = os.getenv("NIPOST_API_KEY", "")
    if not key:
        if os.getenv("APP_ENV", "local") != "local" and os.getenv("POSTCODE_MODE") != "mock":
            raise HTTPException(503, "Postcode verification is unavailable. Use GPS or the map.")
        matched = code == MOCK_POSTCODE
        return {"postcode": code, "valid": matched, "source": "local_mock",
                "location": {"lat": 10.52, "lon": 7.44} if matched else None}

    if not key.startswith(("nipost_test_", "nipost_live_")):
        raise HTTPException(503, "Postcode verification is unavailable.")
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get("https://api.postcode.gov.ng/v1/lookup",
                                        params={"code": code, "level": 1}, headers={"X-API-Key": key})
        response.raise_for_status()
        valid = response.json()["data"]["valid"]
        if type(valid) is not bool:
            raise ValueError("Unexpected validity")
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as exc:
        raise HTTPException(503, "Postcode verification is unavailable. Use GPS or the map.") from exc
    return {"postcode": code, "valid": valid,
            "source": "nipost_test" if key.startswith("nipost_test_") else "nipost_live",
            "location": None}
