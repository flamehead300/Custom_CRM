"""
FieldOps Demo CRM â€” SMS Layer
============================

Zero-dependency SMS sending via Twilio REST API (urllib.request only).
Provides queue management, SID-based idempotency, exponential backoff,
and a full audit trail.

Designed to run from crm_poller.py. All functions accept an open SQLite
connection. The poller claims work in short transactions, then each send
flushes its "attempting" audit row before the network call so SQLite does
not stay write-locked while Twilio responds.

Flask routes can call enqueue_sms() to add tasks to communication_queue.
The poller drains the queue on each poll cycle.

Environment variables (all optional â€” SMS polling is a no-op if unset)
-----------------------------------------------------------------------
    TWILIO_SID           â€” Twilio Account SID
    TWILIO_AUTH_TOKEN    â€” Twilio Auth Token
    TWILIO_PHONE_NUMBER  â€” Outbound number in E.164 format (+15550100000)
    SMS_BATCH_LIMIT      â€” Max tasks claimed per poll cycle (default: 20)
"""

import base64
import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

TWILIO_SID          = os.environ.get("TWILIO_SID", "")
TWILIO_AUTH_TOKEN   = os.environ.get("TWILIO_AUTH_TOKEN", "")
TWILIO_PHONE_NUMBER = os.environ.get("TWILIO_PHONE_NUMBER", "")
SMS_BATCH_LIMIT     = int(os.environ.get("SMS_BATCH_LIMIT", "20"))

_MAX_SEND_ATTEMPTS  = 3
_BACKOFF_BASE_SEC   = 2.0
_REQUEST_TIMEOUT    = 10

# Minutes to wait before retry 1, 2, 3+
_RETRY_DELAYS_MINUTES = [5, 15, 60]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def _credentials_configured() -> bool:
    return bool(TWILIO_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER)


def _commit_if_possible(db) -> None:
    commit = getattr(db, "commit", None)
    if callable(commit):
        commit()


# ---------------------------------------------------------------------------
# Audit trail
# ---------------------------------------------------------------------------

def log_audit_trail(db, task_id: int, *, status: str,
                    provider_sid: str = None, error: str = None) -> None:
    """Insert one row into sms_audit_log.  Does not commit."""
    db.execute(
        "INSERT INTO sms_audit_log (task_id, status, provider_sid, error, occurred_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (task_id, status, provider_sid, error, _utcnow()),
    )


# ---------------------------------------------------------------------------
# send_sms_sync
# ---------------------------------------------------------------------------

def send_sms_sync(db, task_id: int, to_number: str, message: str):
    """
    Send one SMS via the Twilio REST API.

    Returns (outcome: str, provider_sid: str | None, error: str | None).

    Outcomes:
      - "sent": delivered to Twilio successfully
      - "retry": transient failure; caller should schedule_retry()
      - "failed": permanent failure; caller should dead-letter the task

    On a Twilio 4xx the task is treated as a permanent failure (bad number,
    bad credentials, etc.). On a 5xx or network error the caller should retry.
    """
    if not _credentials_configured():
        log.error(
            "SMS task %s: Twilio credentials not configured â€” "
            "set TWILIO_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER",
            task_id,
        )
        log_audit_trail(db, task_id, status="config_error",
                        error="Missing Twilio credentials")
        return "failed", None, "Missing Twilio credentials"

    url = (
        f"https://api.twilio.com/2010-04-01/Accounts/"
        f"{TWILIO_SID}/Messages.json"
    )
    data = urllib.parse.urlencode({
        "To":   to_number,
        "From": TWILIO_PHONE_NUMBER,
        "Body": message,
    }).encode()

    b64_auth = base64.b64encode(
        f"{TWILIO_SID}:{TWILIO_AUTH_TOKEN}".encode()
    ).decode()

    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Authorization", f"Basic {b64_auth}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    log_audit_trail(db, task_id, status="attempting")
    _commit_if_possible(db)

    last_error: str | None = None

    for attempt in range(_MAX_SEND_ATTEMPTS):
        try:
            with urllib.request.urlopen(req, timeout=_REQUEST_TIMEOUT) as resp:
                result = json.loads(resp.read().decode())
                sid = result.get("sid")
                log_audit_trail(db, task_id, status="success", provider_sid=sid)
                log.info("SMS sent â€” task_id=%s sid=%s to=%s", task_id, sid, to_number)
                return "sent", sid, None

        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            error_detail = f"HTTP {exc.code}: {body}"

            # 4xx = permanent failure (bad credentials, invalid number, etc.)
            if 400 <= exc.code < 500:
                log_audit_trail(db, task_id, status="failed",
                                error=error_detail)
                log.error("SMS permanent failure â€” task_id=%s HTTP %d: %s",
                          task_id, exc.code, body)
                return "failed", None, error_detail

            # 5xx = transient, retry
            last_error = error_detail
            log.warning("SMS attempt %d/%d â€” task_id=%s HTTP %d",
                        attempt + 1, _MAX_SEND_ATTEMPTS, task_id, exc.code)

        except (urllib.error.URLError, OSError) as exc:
            last_error = str(exc)
            log.warning("SMS attempt %d/%d â€” task_id=%s network error: %s",
                        attempt + 1, _MAX_SEND_ATTEMPTS, task_id, exc)

        if attempt < _MAX_SEND_ATTEMPTS - 1:
            time.sleep(_BACKOFF_BASE_SEC ** attempt)

    log_audit_trail(db, task_id, status="network_error", error=last_error)
    return "retry", None, last_error


# ---------------------------------------------------------------------------
# Queue management
# ---------------------------------------------------------------------------

def enqueue_sms(db, to_number: str, message: str, *,
                customer_id: str = "", task_type: str = "sms") -> int:
    """
    Add one SMS task to communication_queue.  Returns the new row id.

    Flask routes call this to schedule an outbound SMS.  The poller drains
    the queue on the next poll cycle.

    Example:
        with get_db() as db:
            enqueue_sms(db, customer.phone, "We're on our way!", customer_id=customer.id)
    """
    now = _utcnow()
    cur = db.execute(
        "INSERT INTO communication_queue "
        "  (task_type, customer_id, to_number, message, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, 'pending', ?, ?)",
        (task_type, customer_id, to_number, message, now, now),
    )
    return cur.lastrowid


def claim_pending_sms_tasks(db, node_id: str, limit: int = SMS_BATCH_LIMIT):
    """
    Atomically claim up to `limit` pending tasks for this poller node.

    Uses a claim_token (UUID) so only tasks claimed in this specific batch
    are returned, even when multiple pollers share a database.

    Returns a list of sqlite3.Row objects.
    """
    claim_token = str(uuid.uuid4())
    now = _utcnow()

    db.execute(
        """
        UPDATE communication_queue
        SET    status      = 'processing',
               locked_by   = ?,
               locked_at   = ?,
               claim_token = ?
        WHERE  id IN (
            SELECT id
            FROM   communication_queue
            WHERE  status = 'pending'
              AND  (next_retry_at IS NULL OR next_retry_at <= ?)
              AND  (locked_at IS NULL
                    OR locked_at < datetime('now', '-5 minutes'))
            ORDER  BY created_at ASC
            LIMIT  ?
        )
        """,
        (node_id, now, claim_token, now, limit),
    )

    return db.execute(
        "SELECT * FROM communication_queue WHERE claim_token = ?",
        (claim_token,),
    ).fetchall()


def mark_task_completed(db, task_id: int, *, provider_sid: str = None) -> None:
    """Mark a task as completed and store the Twilio Message SID."""
    db.execute(
        "UPDATE communication_queue "
        "SET status='completed', provider_sid=?, updated_at=?, "
        "    locked_by=NULL, locked_at=NULL, claim_token=NULL "
        "WHERE id=?",
        (provider_sid, _utcnow(), task_id),
    )


def mark_task_dead_letter(db, task_id: int, *, error: str = None) -> None:
    """Mark a task as permanently failed and release its lease state."""
    db.execute(
        "UPDATE communication_queue "
        "SET status='dead_letter', updated_at=?, error_detail=?, "
        "    locked_by=NULL, locked_at=NULL, claim_token=NULL "
        "WHERE id=?",
        (_utcnow(), error, task_id),
    )


def schedule_retry(db, task_id: int, *, error: str = None) -> None:
    """
    Increment retry_count and schedule the next attempt.

    Retry backoff: 5 min â†’ 15 min â†’ 60 min.
    When retry_count reaches max_retries the task moves to 'dead_letter'
    and is never retried again.  Operators can reset it manually if needed.
    """
    row = db.execute(
        "SELECT retry_count, max_retries FROM communication_queue WHERE id=?",
        (task_id,),
    ).fetchone()
    if not row:
        return

    new_count = row["retry_count"] + 1
    now = _utcnow()

    if new_count >= row["max_retries"]:
        db.execute(
            "UPDATE communication_queue "
            "SET status='dead_letter', retry_count=?, updated_at=?, error_detail=?, "
            "    locked_by=NULL, locked_at=NULL, claim_token=NULL "
            "WHERE id=?",
            (new_count, now, error, task_id),
        )
        log.warning("SMS task %s â†’ dead_letter after %d attempts", task_id, new_count)
        return

    delay_idx = min(new_count - 1, len(_RETRY_DELAYS_MINUTES) - 1)
    delay_min = _RETRY_DELAYS_MINUTES[delay_idx]
    next_retry = (
        datetime.now(timezone.utc) + timedelta(minutes=delay_min)
    ).isoformat()

    db.execute(
        "UPDATE communication_queue "
        "SET status='pending', retry_count=?, next_retry_at=?, updated_at=?, "
        "    error_detail=?, locked_by=NULL, locked_at=NULL, claim_token=NULL "
        "WHERE id=?",
        (new_count, next_retry, now, error, task_id),
    )
    log.info("SMS task %s scheduled for retry %d in %d min", task_id, new_count, delay_min)


def release_stale_claims(db, stale_minutes: int = 5) -> int:
    """
    Reset tasks that have been stuck in 'processing' for longer than
    stale_minutes back to 'pending' so they can be reclaimed.

    Returns the number of rows reset.  Call at the start of each poll cycle.
    """
    db.execute(
        """
        UPDATE communication_queue
        SET    status      = 'pending',
               locked_by   = NULL,
               locked_at   = NULL,
               claim_token = NULL,
               updated_at  = ?
        WHERE  status    = 'processing'
          AND  locked_at < datetime('now', ?)
        """,
        (_utcnow(), f"-{stale_minutes} minutes"),
    )
    count = db.execute(
        "SELECT changes()"
    ).fetchone()[0]
    if count:
        log.info("sms: released %d stale claim(s)", count)
    return count
