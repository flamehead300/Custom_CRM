"""
FieldOps Demo CRM â€” Website Submission Poller
systemd: crm-poller.service

Standalone daemon. Does NOT run inside Flask. Polls the website export endpoint
on a configurable interval, validates each record, and writes valid records into
crm_intake_imports. Malformed records go to crm_import_quarantine.

Environment variables (required):
  CRM_DB_PATH          â€” path to crm.db (default: crm.db)
  WEBSITE_EXPORT_URL   â€” full URL of the export endpoint
                         e.g. https://example.invalid/api/export/pending
  CRM_CLIENT_CERT      â€” path to client certificate (PEM) for mTLS
  CRM_CLIENT_KEY       â€” path to client private key (PEM) for mTLS
  CRM_SERVER_CA        â€” path to server CA cert for verifying the website TLS cert

Environment variables (optional):
  POLL_INTERVAL_SECONDS   â€” seconds between polls (default: 30)
  POLL_BATCH_LIMIT        â€” records per request (default: 50, max: 100)
  IMPORTER_VERSION        â€” label stored in created_by_importer (default: crm_poller/1.0)
  POLLER_NODE_ID          â€” stable worker identity for SMS task claims
  POLLER_LOCK_PATH        â€” override process lock path
  TWILIO_SID             \
  TWILIO_AUTH_TOKEN       > enable outbound SMS queue draining when all are set
  TWILIO_PHONE_NUMBER    /
  SMS_BATCH_LIMIT         â€” max queued SMS tasks claimed per cycle (default: 20)
"""

import hashlib
import json
import logging
import os
import signal
import socket
import sqlite3
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
import ssl
from contextlib import contextmanager
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import fcntl as _fcntl
    _HAS_FCNTL = True
except ImportError:
    _HAS_FCNTL = False  # Not Linux â€” process lock skipped (dev/Windows only)

try:
    from sms import (
        release_stale_claims,
        claim_pending_sms_tasks,
        send_sms_sync,
        mark_task_completed,
        mark_task_dead_letter,
        schedule_retry,
        TWILIO_SID,
        TWILIO_AUTH_TOKEN,
        TWILIO_PHONE_NUMBER,
    )
    _SMS_AVAILABLE = True
except ImportError:
    try:
        from app.sms import (
            release_stale_claims,
            claim_pending_sms_tasks,
            send_sms_sync,
            mark_task_completed,
            mark_task_dead_letter,
            schedule_retry,
            TWILIO_SID,
            TWILIO_AUTH_TOKEN,
            TWILIO_PHONE_NUMBER,
        )
        _SMS_AVAILABLE = True
    except ImportError:
        _SMS_AVAILABLE = False
        TWILIO_SID = ""
        TWILIO_AUTH_TOKEN = ""
        TWILIO_PHONE_NUMBER = ""

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s â€” %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("crm_poller")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

CRM_DB_PATH          = os.environ.get("CRM_DB_PATH", "crm.db")
WEBSITE_EXPORT_URL   = os.environ.get("WEBSITE_EXPORT_URL", "")
CRM_CLIENT_CERT      = os.environ.get("CRM_CLIENT_CERT", "")
CRM_CLIENT_KEY       = os.environ.get("CRM_CLIENT_KEY", "")
CRM_SERVER_CA        = os.environ.get("CRM_SERVER_CA", "")
POLL_INTERVAL        = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
POLL_BATCH_LIMIT     = min(int(os.environ.get("POLL_BATCH_LIMIT", "50")), 100)
IMPORTER_VERSION     = os.environ.get("IMPORTER_VERSION", "crm_poller/1.0")
SOURCE_SYSTEM        = "ccs_website"
SUPPORTED_SCHEMA_VERSION = 1

POLLER_NODE_ID  = os.environ.get("POLLER_NODE_ID") or socket.gethostname()
POLLER_LOCK_PATH = os.environ.get(
    "POLLER_LOCK_PATH",
    os.environ.get("POLLER_LOCK_FILE", os.path.join(tempfile.gettempdir(), "crm_poller.lock")),
)

REQUIRED_RECORD_FIELDS = {
    "website_submission_id",
    "submission_uuid",
    "submitted_at",
    "customer",
    "service_request",
    "integrity",
}

REQUIRED_CUSTOMER_FIELDS = {"full_name", "email", "phone"}


def sms_configured() -> bool:
    return bool(_SMS_AVAILABLE and TWILIO_SID and TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER)

# ---------------------------------------------------------------------------
# Preflight checks
# ---------------------------------------------------------------------------


def preflight_check():
    """Halt startup if required configuration is missing."""
    errors = []

    if not WEBSITE_EXPORT_URL:
        errors.append("WEBSITE_EXPORT_URL is not set")

    if not os.path.exists(CRM_DB_PATH):
        errors.append(f"CRM_DB_PATH={CRM_DB_PATH} does not exist")

    if CRM_CLIENT_CERT and not os.path.exists(CRM_CLIENT_CERT):
        errors.append(f"CRM_CLIENT_CERT={CRM_CLIENT_CERT} does not exist")

    if CRM_CLIENT_KEY and not os.path.exists(CRM_CLIENT_KEY):
        errors.append(f"CRM_CLIENT_KEY={CRM_CLIENT_KEY} does not exist")

    if CRM_SERVER_CA and not os.path.exists(CRM_SERVER_CA):
        errors.append(f"CRM_SERVER_CA={CRM_SERVER_CA} does not exist")

    if errors:
        for e in errors:
            log.critical("Preflight failed: %s", e)
        sys.exit(1)

    log.info("Preflight OK â€” db=%s url=%s interval=%ds batch=%d",
             CRM_DB_PATH, WEBSITE_EXPORT_URL, POLL_INTERVAL, POLL_BATCH_LIMIT)


# ---------------------------------------------------------------------------
# Process lock â€” prevents accidental double-start
# ---------------------------------------------------------------------------

_lock_fh = None  # held open for the lifetime of the process


def acquire_process_lock(lock_file: str = POLLER_LOCK_PATH) -> None:
    """
    Acquire an exclusive advisory lock on `lock_file`.

    Exits immediately if another crm_poller process already holds the lock.
    No-op on non-Linux platforms (fcntl unavailable) â€” dev machines only.
    """
    global _lock_fh
    if not _HAS_FCNTL:
        log.warning("fcntl not available â€” process lock skipped (non-Linux platform)")
        return
    try:
        _lock_fh = open(lock_file, "w")
        _fcntl.lockf(_lock_fh, _fcntl.LOCK_EX | _fcntl.LOCK_NB)
        _lock_fh.write(str(os.getpid()))
        _lock_fh.flush()
        log.info("Process lock acquired: %s (pid=%d)", lock_file, os.getpid())
    except OSError:
        log.critical(
            "Another crm_poller instance is already running (lock: %s). Exiting.",
            lock_file,
        )
        sys.exit(1)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------


@contextmanager
def get_db():
    conn = sqlite3.connect(CRM_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=10000;")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# ImportCursorStore
# ---------------------------------------------------------------------------


class ImportCursorStore:
    """Reads and writes the high-water mark for ccs_website in integration_cursors."""

    def read(self) -> int:
        with get_db() as db:
            row = db.execute(
                "SELECT last_submission_id FROM integration_cursors WHERE source_system=?",
                (SOURCE_SYSTEM,)
            ).fetchone()
        return row["last_submission_id"] if row else 0

    def advance(self, db, new_cursor: int, error: str = None):
        """
        Update cursor inside an existing db transaction.
        Called atomically with the row inserts â€” same transaction.
        """
        now = datetime.now(timezone.utc).isoformat()
        if error:
            db.execute(
                "UPDATE integration_cursors SET last_submission_id=?, last_attempt_at=?, last_error=? "
                "WHERE source_system=?",
                (new_cursor, now, error, SOURCE_SYSTEM)
            )
        else:
            db.execute(
                "UPDATE integration_cursors SET last_submission_id=?, last_attempt_at=?, "
                "last_success_at=?, last_error=NULL WHERE source_system=?",
                (new_cursor, now, now, SOURCE_SYSTEM)
            )


# ---------------------------------------------------------------------------
# WebsiteExportClient
# ---------------------------------------------------------------------------


def _build_ssl_context() -> ssl.SSLContext:
    """Build SSL context with mTLS client cert and server CA verification."""
    ctx = ssl.create_default_context()

    if CRM_SERVER_CA:
        ctx.load_verify_locations(cafile=CRM_SERVER_CA)

    if CRM_CLIENT_CERT and CRM_CLIENT_KEY:
        ctx.load_cert_chain(certfile=CRM_CLIENT_CERT, keyfile=CRM_CLIENT_KEY)
    elif CRM_CLIENT_CERT:
        ctx.load_cert_chain(certfile=CRM_CLIENT_CERT)

    return ctx


class WebsiteExportClient:
    """
    HTTP client for the website export endpoint.
    Handles mTLS, retries, and exponential backoff on transient errors.
    """

    MAX_RETRIES = 3
    BACKOFF_BASE = 2.0

    def __init__(self):
        self._ssl_ctx = _build_ssl_context()

    def fetch_batch(self, after_id: int, limit: int) -> dict | None:
        """
        Fetch one batch from the export endpoint.
        Returns parsed JSON dict on success, None on non-retryable failure.
        Raises on transient error after exhausting retries.
        """
        params = urllib.parse.urlencode({"after_id": after_id, "limit": limit})
        url = f"{WEBSITE_EXPORT_URL}?{params}"

        last_exc = None
        for attempt in range(self.MAX_RETRIES):
            try:
                req = urllib.request.Request(url, method="GET")
                req.add_header("Accept", "application/json")
                req.add_header("User-Agent", f"FieldOpsDemo/{IMPORTER_VERSION}")

                with urllib.request.urlopen(req, context=self._ssl_ctx, timeout=30) as resp:
                    if resp.status == 200:
                        return json.loads(resp.read().decode())
                    log.error("export fetch: unexpected status %d for %s", resp.status, url)
                    return None

            except urllib.error.HTTPError as exc:
                if exc.code in (400, 401, 403, 404):
                    log.error("export fetch: non-retryable HTTP %d: %s", exc.code, exc.reason)
                    return None
                log.warning("export fetch attempt %d/%d: HTTP %d: %s",
                            attempt + 1, self.MAX_RETRIES, exc.code, exc.reason)
                last_exc = exc

            except (urllib.error.URLError, OSError) as exc:
                log.warning("export fetch attempt %d/%d: connection error: %s",
                            attempt + 1, self.MAX_RETRIES, exc)
                last_exc = exc

            except json.JSONDecodeError as exc:
                log.error("export fetch: invalid JSON response: %s", exc)
                return None

            if attempt < self.MAX_RETRIES - 1:
                sleep_time = self.BACKOFF_BASE ** attempt
                log.info("export fetch: retrying in %.1fs", sleep_time)
                time.sleep(sleep_time)

        raise RuntimeError(f"export fetch failed after {self.MAX_RETRIES} attempts: {last_exc}")


# ---------------------------------------------------------------------------
# LeadMapper
# ---------------------------------------------------------------------------


class LeadMapper:
    """
    Validates and reshapes a raw export record into a form suitable for
    crm_intake_imports. Acts as the anti-corruption layer.
    """

    def map(self, record: dict) -> dict:
        """
        Returns a dict ready for DB insert, or raises ValueError with reason.
        """
        self._validate_required_fields(record)
        self._validate_schema_version(record)
        self._validate_integrity(record)
        self._validate_customer(record.get("customer", {}))
        return self._build_row(record)

    def _validate_required_fields(self, record: dict):
        missing = REQUIRED_RECORD_FIELDS - set(record.keys())
        if missing:
            raise ValueError(f"missing_required_fields: {sorted(missing)}")

    def _validate_schema_version(self, record: dict):
        version = record.get("schema_version")
        if version != SUPPORTED_SCHEMA_VERSION:
            raise ValueError(
                f"unsupported_schema_version: got {version}, expected {SUPPORTED_SCHEMA_VERSION}"
            )

    def _validate_integrity(self, record: dict):
        integrity = record.get("integrity", {})
        exported_hash = integrity.get("serialization_hash", "")
        if not exported_hash.startswith("sha256:"):
            raise ValueError("integrity_hash_missing_or_invalid_format")

        # Recompute hash over the record without the integrity field
        record_for_hash = {k: v for k, v in record.items() if k != "integrity"}
        canonical_bytes = json.dumps(
            record_for_hash, sort_keys=True, separators=(",", ":")
        ).encode()
        expected = "sha256:" + hashlib.sha256(canonical_bytes).hexdigest()

        if expected != exported_hash:
            raise ValueError(
                f"serialization_hash_mismatch: expected={expected} got={exported_hash}"
            )

    def _validate_customer(self, customer: dict):
        missing = [f for f in REQUIRED_CUSTOMER_FIELDS if not customer.get(f, "").strip()]
        if missing:
            raise ValueError(f"missing_customer_fields: {missing}")

    def _build_row(self, record: dict) -> dict:
        source_meta = record.get("source_metadata") or {}
        return {
            "website_submission_id": int(record["website_submission_id"]),
            "submission_uuid":       str(record["submission_uuid"]),
            "schema_version":        int(record.get("schema_version", 1)),
            "raw_payload_json":      json.dumps(record, sort_keys=True),
            "serialization_hash":    record.get("integrity", {}).get("serialization_hash", ""),
            "source_page":           str(source_meta.get("source_page", ""))[:500],
            "form_type":             str(source_meta.get("form_type", ""))[:100],
            "submitted_at":          str(record.get("submitted_at", "")),
            "created_by_importer":   IMPORTER_VERSION,
        }


# ---------------------------------------------------------------------------
# IntakeQuarantineService
# ---------------------------------------------------------------------------


class IntakeQuarantineService:
    """Persists malformed or unsupported records to crm_import_quarantine."""

    def record(self, db, raw_record: dict, reason_code: str, reason_detail: str):
        now = datetime.now(timezone.utc).isoformat()
        db.execute(
            """
            INSERT INTO crm_import_quarantine
                (website_submission_id, submission_uuid, received_at,
                 raw_payload_json, reason_code, reason_detail, schema_version)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                raw_record.get("website_submission_id"),
                raw_record.get("submission_uuid"),
                now,
                json.dumps(raw_record, sort_keys=True),
                reason_code,
                reason_detail[:2000] if reason_detail else "",
                raw_record.get("schema_version"),
            )
        )
        log.warning(
            "quarantine: submission_id=%s uuid=%s reason=%s detail=%s",
            raw_record.get("website_submission_id"),
            raw_record.get("submission_uuid"),
            reason_code,
            reason_detail,
        )


# ---------------------------------------------------------------------------
# IntakeImportService
# ---------------------------------------------------------------------------


class IntakeImportService:
    """
    Orchestrates the import of a single validated record into crm_intake_imports.
    Handles idempotency via the UNIQUE constraint on submission_uuid.
    """

    def insert(self, db, row: dict) -> str:
        """
        Returns 'inserted', 'duplicate', or raises on unexpected error.
        """
        try:
            db.execute(
                """
                INSERT INTO crm_intake_imports
                    (website_submission_id, submission_uuid, schema_version,
                     raw_payload_json, serialization_hash, source_page, form_type,
                     submitted_at, created_by_importer)
                VALUES
                    (:website_submission_id, :submission_uuid, :schema_version,
                     :raw_payload_json, :serialization_hash, :source_page, :form_type,
                     :submitted_at, :created_by_importer)
                """,
                row,
            )
            log.info(
                "import: inserted submission_id=%d uuid=%s",
                row["website_submission_id"],
                row["submission_uuid"],
            )
            return "inserted"

        except sqlite3.IntegrityError:
            # Unique constraint on submission_uuid â€” safe idempotent replay
            log.info(
                "import: duplicate submission_id=%d uuid=%s â€” skipped",
                row["website_submission_id"],
                row["submission_uuid"],
            )
            return "duplicate"


# ---------------------------------------------------------------------------
# WebsiteSubmissionImporter (main orchestrator)
# ---------------------------------------------------------------------------


class WebsiteSubmissionImporter:
    """
    Main poll loop. Coordinates client, cursor, mapper, import, and quarantine.
    Runs until shutdown is signalled.
    """

    def __init__(self):
        self.client    = WebsiteExportClient()
        self.cursor    = ImportCursorStore()
        self.mapper    = LeadMapper()
        self.importer  = IntakeImportService()
        self.quarantine = IntakeQuarantineService()
        self._running  = True
        self._sms_unavailable_logged = False
        self._sms_unconfigured_logged = False

    def shutdown(self, *_):
        log.info("Shutdown signal received â€” stopping after current batch")
        self._running = False

    def run(self):
        log.info("Poller started â€” source=%s interval=%ds", SOURCE_SYSTEM, POLL_INTERVAL)
        while self._running:
            try:
                self._poll_once()
            except Exception as exc:
                log.error("poll cycle error: %s", exc, exc_info=True)
            if self._running:
                try:
                    self._poll_sms_once()
                except Exception as exc:
                    log.error("sms poll cycle error: %s", exc, exc_info=True)
            if self._running:
                time.sleep(POLL_INTERVAL)
        log.info("Poller stopped cleanly")

    def _poll_sms_once(self):
        """Drain the pending SMS queue for one cycle."""
        if not _SMS_AVAILABLE:
            if not self._sms_unavailable_logged:
                log.warning("sms: queue integration unavailable because sms.py could not be imported")
                self._sms_unavailable_logged = True
            return
        if not sms_configured():
            if not self._sms_unconfigured_logged:
                log.info("sms: queue drain paused; Twilio credentials are not configured")
                self._sms_unconfigured_logged = True
            return
        self._sms_unconfigured_logged = False

        with get_db() as db:
            release_stale_claims(db)
            tasks = claim_pending_sms_tasks(db, POLLER_NODE_ID)

        if not tasks:
            return

        log.info("sms: claimed %d task(s) on node=%s", len(tasks), POLLER_NODE_ID)

        sent_count = 0
        retry_count = 0
        dead_letter_count = 0
        completed_from_sid = 0

        for task in tasks:
            task_id = task["id"]
            to = (task["to_number"] or "").strip()
            message = task["message"] or ""
            provider_sid = (task["provider_sid"] or "").strip()

            if provider_sid:
                with get_db() as db:
                    mark_task_completed(db, task_id, provider_sid=provider_sid)
                completed_from_sid += 1
                continue

            if not to or not message:
                with get_db() as db:
                    mark_task_dead_letter(db, task_id, error="Missing to_number or message")
                dead_letter_count += 1
                continue

            with get_db() as db:
                outcome, sid, error = send_sms_sync(db, task_id, to, message)
                if outcome == "sent":
                    mark_task_completed(db, task_id, provider_sid=sid)
                    sent_count += 1
                elif outcome == "failed":
                    mark_task_dead_letter(db, task_id, error=error or "Permanent provider failure")
                    dead_letter_count += 1
                else:
                    schedule_retry(db, task_id, error=error or "Transient send failure")
                    retry_count += 1

        log.info(
            "sms: cycle complete sent=%d completed_from_sid=%d retried=%d dead_letter=%d",
            sent_count,
            completed_from_sid,
            retry_count,
            dead_letter_count,
        )

    def _poll_once(self):
        after_id = self.cursor.read()
        log.info("poll: after_id=%d", after_id)

        try:
            response = self.client.fetch_batch(after_id, POLL_BATCH_LIMIT)
        except RuntimeError as exc:
            log.error("poll: export fetch failed: %s", exc)
            return

        if response is None:
            log.warning("poll: no response from export endpoint")
            return

        records = response.get("records", [])
        has_more = response.get("has_more", False)

        if not records:
            log.info("poll: no new records (after_id=%d)", after_id)
            return

        log.info("poll: fetched %d records has_more=%s", len(records), has_more)

        inserted = 0
        duplicates = 0
        quarantined = 0
        highest_id = after_id

        with get_db() as db:
            for raw in records:
                sid = raw.get("website_submission_id", "?")
                try:
                    mapped_row = self.mapper.map(raw)
                except ValueError as exc:
                    reason_str = str(exc)
                    reason_code = reason_str.split(":")[0]
                    self.quarantine.record(db, raw, reason_code, reason_str)
                    quarantined += 1
                    # Advance past quarantined records â€” one bad record must not
                    # block the stream forever. The quarantine table preserves
                    # the raw payload for operator review.
                    if isinstance(sid, int) and sid > highest_id:
                        highest_id = sid
                    continue

                result = self.importer.insert(db, mapped_row)
                if result == "inserted":
                    inserted += 1
                else:
                    duplicates += 1

                if isinstance(sid, int) and sid > highest_id:
                    highest_id = sid

            # Cursor and inserts are in the same transaction
            if highest_id > after_id:
                self.cursor.advance(db, highest_id)

        log.info(
            "poll done: inserted=%d duplicates=%d quarantined=%d cursor=%dâ†’%d",
            inserted, duplicates, quarantined, after_id, highest_id,
        )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main():
    preflight_check()
    acquire_process_lock()

    importer = WebsiteSubmissionImporter()

    signal.signal(signal.SIGTERM, importer.shutdown)
    signal.signal(signal.SIGINT,  importer.shutdown)

    importer.run()


if __name__ == "__main__":
    main()
