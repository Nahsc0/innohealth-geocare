"""Storage, account security and staging configuration."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import time
from contextlib import contextmanager

from argon2 import PasswordHasher
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, event, text

ROOT = Path(__file__).resolve().parent
LOCAL = os.getenv("APP_ENV", "local") == "local"
DATABASE = os.getenv("DATABASE_URL", "sqlite:///geocare.sqlite")
if DATABASE.startswith("postgresql://"):
    DATABASE = DATABASE.replace("postgresql://", "postgresql+psycopg://", 1)
POSTGIS = DATABASE.startswith("postgresql")
if not LOCAL and (not POSTGIS or not os.getenv("DATA_KEY")):
    raise RuntimeError("Hosted mode requires PostgreSQL/PostGIS and DATA_KEY")
engine = create_engine(DATABASE, pool_pre_ping=True)
if not POSTGIS:
    @event.listens_for(engine, "connect")
    def sqlite_foreign_keys(connection, _):
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("PRAGMA journal_mode=WAL")

cipher = Fernet(os.environ["DATA_KEY"].encode() if "DATA_KEY" in os.environ else Fernet.generate_key())
passwords = PasswordHasher()

def now():
    return int(time.time())

def uid():
    return secrets.token_hex(16)

def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()

def seal(data):
    return cipher.encrypt(json.dumps(data).encode()).decode()

def reveal(data):
    return json.loads(cipher.decrypt(data.encode())) if data else None

def query(db, sql, **params):
    return db.execute(text(sql), params)

def rows(db, sql, **params):
    return [dict(row) for row in query(db, sql, **params).mappings()]

def one(db, sql, **params):
    result = query(db, sql, **params).mappings().first()
    return dict(result) if result else None

def audit(db, actor, action, entity):
    query(db, "INSERT INTO audit VALUES (:id,:actor,:action,:entity,:created)",
          id=uid(), actor=actor, action=action, entity=entity, created=now())

def migrate():
    with engine.begin() as db:
        if POSTGIS:
            query(db, "SELECT pg_advisory_xact_lock(21670495)")
        for filename in ["001_schema.sql"] + (["002_postgis.sql"] if POSTGIS else []) + ["003_access.sql", "004_incident_retry.sql", "005_coverage.sql", "006_partner_signup.sql"]:
            for statement in (ROOT / "migrations" / filename).read_text().split(";"):
                if statement.strip():
                    query(db, statement)

def bootstrap():
    email = os.getenv("BOOTSTRAP_EMAIL")
    password = os.getenv("BOOTSTRAP_PASSWORD")
    if not email and not password:
        return
    if not email or not password or len(password) < 14:
        raise RuntimeError("Bootstrap requires an email and a password of at least 14 characters")
    with engine.begin() as db:
        query(db, "INSERT INTO organisations VALUES ('pilot','GeoCare pilot operators',1) ON CONFLICT DO NOTHING")
        query(db, """INSERT INTO users VALUES (:id,:email,:password,'admin','pilot',1)
                     ON CONFLICT(email) DO NOTHING""",
              id=uid(), email=email.lower().strip(), password=passwords.hash(password))

@contextmanager
def transaction():
    with engine.begin() as db:
        yield db

def purge(db):
    timestamp = now()
    setting = one(db, "SELECT value FROM settings WHERE name='retention_days'")
    cutoff = timestamp - 86400 * (setting["value"] if setting else 30)
    query(db, "DELETE FROM sessions WHERE expires < :now", now=timestamp)
    query(db, "DELETE FROM rate_windows WHERE expires < :now", now=timestamp)
    query(db, "DELETE FROM incident_messages WHERE created < :cutoff", cutoff=cutoff)
    query(db, "UPDATE incidents SET location=NULL WHERE updated < :cutoff AND location IS NOT NULL", cutoff=cutoff)
    query(db, "UPDATE referrals SET details=NULL WHERE updated < :cutoff AND details IS NOT NULL", cutoff=cutoff)

if __name__ == "__main__":
    import sys
    if sys.argv[1:] == ["purge"]:
        with transaction() as connection:
            purge(connection)
    else:
        migrate()
        bootstrap()
