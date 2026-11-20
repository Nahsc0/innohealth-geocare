"""Use a private Apps Script registry for encrypted password verifiers."""
import hashlib
import hmac
import json
import os
import secrets
from urllib.parse import urlsplit

import httpx
from cryptography.fernet import InvalidToken
from fastapi import HTTPException

from .core import LOCAL, now, passwords, reveal, seal

SHEET_VERIFIER = "apps-script:v1"
INDIVIDUAL_ORG = "geocare-individuals"

def registry_config():
    url = os.getenv("APPS_SCRIPT_REGISTRY_URL", "").strip()
    secret = os.getenv("APPS_SCRIPT_REGISTRY_SECRET", "")
    if not url and not secret and LOCAL:
        return None
    try:
        endpoint = urlsplit(url)
    except ValueError as exc:
        raise HTTPException(503, "The registration service is unavailable. Try again later.") from exc
    if (endpoint.scheme != "https" or endpoint.netloc != "script.google.com"
            or not endpoint.path.startswith("/macros/s/") or not endpoint.path.endswith("/exec")
            or endpoint.query or endpoint.fragment or len(secret) < 32):
        raise HTTPException(503, "The registration service is unavailable. Try again later.")
    return url, secret.encode()

def registry_call(config, action, account, **fields):
    url, secret = config
    payload = json.dumps({"action": action, "account": account, "timestamp": now(),
                          "nonce": secrets.token_hex(16), **fields}, separators=(",", ":"))
    signature = hmac.digest(secret, payload.encode(), "sha256").hex()
    try:
        with httpx.Client(timeout=6) as client:
            response = client.post(url, json={"payload": payload, "signature": signature})
            if response.status_code in (302, 303):
                target = response.next_request.url if response.next_request else None
                if target is None or target.scheme != "https" or target.host != "script.googleusercontent.com":
                    raise ValueError("Unexpected Apps Script redirect")
                response = client.get(target)
        response.raise_for_status()
        result = response.json()
        if result.get("ok") is not True:
            raise ValueError("Registry rejected the request")
        return result
    except (httpx.HTTPError, AttributeError, ValueError) as exc:
        raise HTTPException(503, "The registration service is unavailable. Try again later.") from exc

def individual_id(email, config):
    if config is None:
        return secrets.token_hex(16)
    return hmac.new(config[1], f"individual:{email}".encode(), hashlib.sha256).hexdigest()[:32]

def save_verifier(account, kind, password, config):
    verifier = passwords.hash(password)
    if config is None:
        return verifier
    registry_call(config, "store", account, kind=kind, verifier=seal({"account":account, "hash":verifier}))
    return SHEET_VERIFIER

def login_verifier(account, stored):
    if stored != SHEET_VERIFIER:
        return stored
    try:
        config = registry_config()
        if config is None:
            raise ValueError("Missing registry")
        result = registry_call(config, "read", account)
        verifier = reveal(result["verifier"])
        if verifier["account"] != account or not verifier["hash"].startswith("$argon2id$"):
            raise ValueError("Invalid verifier")
        return verifier["hash"]
    except (InvalidToken, KeyError, TypeError, ValueError) as exc:
        raise HTTPException(503, "The registration service is unavailable. Try again later.") from exc
