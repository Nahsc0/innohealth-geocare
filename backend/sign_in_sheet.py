"""Retry a durable queue of successful hosted sign-ins."""
import asyncio
import logging

from fastapi import HTTPException
from sqlalchemy import text

from .core import rows, transaction
from .registration_store import registry_call, registry_config

logger = logging.getLogger(__name__)

def sync_sign_ins():
    config = registry_config()
    if config is None:
        return
    with transaction() as db:
        events = rows(db, """SELECT event_id,account_id,account_role,signed_in FROM sign_in_sheet_queue
            ORDER BY signed_in,event_id LIMIT 16""")
    if not events:
        return
    registry_call(config, "record_sign_ins", events[0]["account_id"], events=events)
    with transaction() as db:
        db.execute(text("DELETE FROM sign_in_sheet_queue WHERE event_id=:id"),
                   [{"id": event["event_id"]} for event in events])

async def sign_in_sheet_worker():
    while True:
        try:
            await asyncio.to_thread(sync_sign_ins)
        except HTTPException:
            logger.warning("Google Sheets sign-in export unavailable. Pending events will be retried.")
        except Exception:
            logger.exception("Sign-in export worker encountered a database error.")
        await asyncio.sleep(30)
