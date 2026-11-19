"""Deliver short-lived signup codes and store only their keyed verifiers."""
import hmac
import json
import os
import secrets
from pathlib import Path

from fastapi import HTTPException

from .core import LOCAL, now, one, query, transaction, uid
from .registration_store import registry_call

_local_key = secrets.token_bytes(32)

def verification_key():
    return os.environ["DATA_KEY"].encode() if "DATA_KEY" in os.environ else _local_key

def sign_value(label, value):
    return hmac.digest(verification_key(), f"geocare:{label}:{value}".encode(), "sha256").hex()

def deliver_code(config, challenge, email, code):
    if config is not None:
        registry_call(config, "send_code", challenge, recipient=email, code=code)
        return
    mailbox = os.getenv("GEOCARE_DEV_MAILBOX") if LOCAL else None
    if not mailbox:
        raise HTTPException(503, "Email verification is unavailable. Try again later.")
    try:
        with Path(mailbox).open("a", encoding="utf-8") as out:
            out.write(json.dumps({"challenge":challenge, "recipient":email, "code":code}) + "\n")
    except OSError as exc:
        raise HTTPException(503, "The local test mailbox is unavailable.") from exc

def request_code(email, config):
    key = sign_value("email", email)
    challenge = uid()
    code = f"{secrets.randbelow(1_000_000):06d}"
    timestamp = now()
    with transaction() as db:
        query(db, "DELETE FROM registration_codes WHERE expires<=:now", now=timestamp)
        saved = query(db, """INSERT INTO registration_codes (email_hash,id,verifier,created,expires)
          VALUES (:email,:id,:verifier,:now,:expires)
          ON CONFLICT (email_hash) DO UPDATE SET id=excluded.id,verifier=excluded.verifier,
          created=excluded.created,expires=excluded.expires,attempts=0
          WHERE registration_codes.created<=:resend""",
          email=key, id=challenge, verifier=sign_value("otp", f"{challenge}:{code}"),
          now=timestamp, expires=timestamp + 600, resend=timestamp - 60)
        if not saved.rowcount:
            raise HTTPException(429, "Wait a minute before requesting another code.")
    try:
        deliver_code(config, challenge, email, code)
    except HTTPException:
        with transaction() as db:
            query(db, "DELETE FROM registration_codes WHERE id=:id", id=challenge)
        raise
    return challenge

def check_code(email, challenge, code):
    with transaction() as db:
        match = one(db, """UPDATE registration_codes SET attempts=attempts+1
          WHERE email_hash=:email AND id=:id AND expires>:now AND attempts<5 RETURNING verifier""",
          email=sign_value("email", email), id=challenge, now=now())
    if not match or not hmac.compare_digest(match["verifier"], sign_value("otp", f"{challenge}:{code}")):
        raise HTTPException(400, "That verification code is incorrect or expired. Check the code or request a new one.")

def consume_code(db, email, challenge):
    removed = query(db, "DELETE FROM registration_codes WHERE email_hash=:email AND id=:id AND expires>:now",
                    email=sign_value("email", email), id=challenge, now=now())
    if not removed.rowcount:
        raise HTTPException(400, "That verification code is no longer available. Request a new one.")
