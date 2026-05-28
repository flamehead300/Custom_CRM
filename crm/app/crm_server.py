"""
FieldOps Demo CRM â€” Production Backend
Port 5002 | systemd: crm.service

This is the production CRM runtime. It replaces the legacy server.py (port 5000)
after cutover. Do not run both at the same time against the same crm.db in
read-write mode.

Migration checklist before cutover:
  - CRM_PASSWORD_HASH set in environment (generate: python -c "from werkzeug.security
    import generate_password_hash; print(generate_password_hash('yourpassword'))")
  - SECRET_KEY set in environment
  - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET set in environment
  - GOOGLE_REDIRECT_URI set to https://<your-domain>/api/auth/google/callback
  - crm.db exists and is accessible at CRM_DB_PATH
  - Nginx configured for this process on port 5002
"""

import os
import json
import time
import uuid
import secrets
import sqlite3
import threading
import urllib.request
import urllib.parse
from contextlib import contextmanager
from functools import wraps

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from flask import Flask, redirect, request, jsonify, session, send_from_directory, has_request_context, g
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from werkzeug.security import check_password_hash, generate_password_hash

try:
    import googleapiclient  # noqa: F401
    _GOOGLE_AVAILABLE = True
except ImportError:
    _GOOGLE_AVAILABLE = False

from datetime import datetime, timezone, timedelta, date as date_cls, time as dt_time, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# ---------------------------------------------------------------------------
# Directory layout (resolved relative to this file so CWD doesn't matter)
# ---------------------------------------------------------------------------
_APP_DIR  = os.path.dirname(os.path.abspath(__file__))
_WEB_DIR  = os.path.join(_APP_DIR, '..', 'web')
_DATA_DIR = os.path.join(_APP_DIR, '..', 'data')
_CONFIG_DIR = os.path.join(_APP_DIR, '..', 'config')

# ---------------------------------------------------------------------------
# App setup
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)
limiter = Limiter(get_remote_address, app=app, default_limits=[])

_production = os.environ.get('FLASK_ENV') == 'production'
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['SESSION_COOKIE_SECURE'] = _production
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['PERMANENT_SESSION_LIFETIME'] = 28800  # 8 hours


@app.after_request
def set_security_headers(response):
    response.headers['Content-Security-Policy'] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https://*.tile.openstreetmap.org; "
        "connect-src 'self' https://nominatim.openstreetmap.org https://router.project-osrm.org; "
        "font-src 'self'; "
        "object-src 'none'; "
        "base-uri 'self'; "
        "frame-ancestors 'none';"
    )
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    return response


SECRET_KEY = os.environ.get('SECRET_KEY')
if not SECRET_KEY:
    raise RuntimeError(
        "SECRET_KEY environment variable is not set. "
        "Generate one with: python -c \"import secrets; print(secrets.token_hex(32))\""
    )
app.secret_key = SECRET_KEY

# ---------------------------------------------------------------------------
# Auth config
# ---------------------------------------------------------------------------

# Hashed password for admin login. Generate with:
#   python -c "from werkzeug.security import generate_password_hash; print(generate_password_hash('yourpassword'))"
CRM_PASSWORD_HASH = os.environ.get('CRM_PASSWORD_HASH', '')
CRM_USERNAME = os.environ.get('CRM_USERNAME', 'admin')

# Demo account (read-only). Set DEMO_ENABLED=false to disable.
DEMO_ENABLED = os.environ.get('DEMO_ENABLED', 'true').lower() not in ('false', '0', 'no')
DEMO_USERNAME = 'demo'
DEMO_PASSWORD = 'demo'

CRM_ROLE_ADMIN = 'admin'
CRM_ROLE_EMPLOYEE = 'employee'
CRM_ROLE_DEMO = 'demo'

PERMISSION_FLAGS = (
    'canViewCustomers',
    'canEditCustomers',
    'canViewJobs',
    'canEditJobs',
    'canViewRecurringJobs',
    'canEditRecurringJobs',
    'canViewEmployeeDirectory',
    'canManageEmployees',
    'canViewPayroll',
    'canViewIntake',
    'canManageIntake',
    'canUseGoogleAuth',
    'canUseCalendar',
    'canUseDrive',
    'canSendCustomerEmail',
    'canExportSheets',
    'canRequestDelete',
    'canExecuteDelete',
    'canUseAdminMessenger',
    'canManageUsers',
)

DEFAULT_TRAVEL_ROUTING_SETTINGS = {
    'homeBaseAddress': '100 Demo Way, Demo City, ST 00000',
    'workerPickupAddress': '200 Service Yard, Demo City, ST 00000',
}

PASSWORD_CHANGE_EXEMPT_API_PATHS = {
    '/api/auth/me',
    '/api/auth/change-password',
    '/api/csrf-token',
}

THREAD_TYPE_MESSAGE = 'message'
THREAD_TYPE_DELETION_REQUEST = 'deletion_request'
THREAD_TYPES = {THREAD_TYPE_MESSAGE, THREAD_TYPE_DELETION_REQUEST}

THREAD_STATUS_OPEN = 'open'
THREAD_STATUS_RESOLVED = 'resolved'
THREAD_STATUS_REJECTED = 'rejected'
THREAD_STATUS_EXECUTED = 'executed'
THREAD_STATUSES = {
    THREAD_STATUS_OPEN,
    THREAD_STATUS_RESOLVED,
    THREAD_STATUS_REJECTED,
    THREAD_STATUS_EXECUTED,
}

DELETE_TARGET_CUSTOMER = 'customer'
DELETE_TARGET_SERVICE_JOB = 'service_job'
DELETE_TARGET_CUSTOMER_JOB = 'customer_job'
DELETE_TARGET_KINDS = {
    DELETE_TARGET_CUSTOMER,
    DELETE_TARGET_SERVICE_JOB,
    DELETE_TARGET_CUSTOMER_JOB,
}

ADMIN_THREAD_MESSAGE_TYPE_USER = 'user'
ADMIN_THREAD_MESSAGE_TYPE_SYSTEM = 'system'


def _empty_permissions():
    return {flag: False for flag in PERMISSION_FLAGS}


def _normalize_user_role(value, default=CRM_ROLE_EMPLOYEE):
    raw = str(value or default).strip().lower()
    if raw not in {CRM_ROLE_ADMIN, CRM_ROLE_EMPLOYEE, CRM_ROLE_DEMO}:
        return default
    return raw


def build_permission_map(user):
    permissions = _empty_permissions()
    role = _normalize_user_role(user['role'] if user else CRM_ROLE_DEMO, CRM_ROLE_DEMO)

    if role == CRM_ROLE_ADMIN:
        for flag in permissions:
            permissions[flag] = True
        return permissions

    if role == CRM_ROLE_EMPLOYEE:
        for flag in (
            'canViewCustomers',
            'canEditCustomers',
            'canViewJobs',
            'canEditJobs',
            'canViewRecurringJobs',
            'canEditRecurringJobs',
            'canViewEmployeeDirectory',
            'canViewIntake',
            'canUseGoogleAuth',
            'canUseCalendar',
            'canUseDrive',
            'canSendCustomerEmail',
            'canRequestDelete',
            'canUseAdminMessenger',
        ):
            permissions[flag] = True
        return permissions

    for flag in (
        'canViewCustomers',
        'canViewJobs',
        'canViewRecurringJobs',
        'canViewEmployeeDirectory',
    ):
        permissions[flag] = True
    return permissions

if not CRM_PASSWORD_HASH:
    import warnings
    warnings.warn(
        "CRM_PASSWORD_HASH is not set. Admin login will be disabled until it is configured. "
        "Generate with: python -c \"from werkzeug.security import generate_password_hash; "
        "print(generate_password_hash('yourpassword'))\""
    )

# ---------------------------------------------------------------------------
# Auth decorators
# ---------------------------------------------------------------------------


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('crm_logged_in') or not getattr(g, 'current_user', None):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Authentication required'}), 401
            return redirect(f'/login?next={request.path}')
        return f(*args, **kwargs)
    return decorated


def csrf_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = session.get('csrf_token')
        if not token or request.headers.get('X-CSRFToken') != token:
            return jsonify({'error': 'CSRF validation failed'}), 403
        return f(*args, **kwargs)
    return decorated


def _current_permissions():
    return getattr(g, 'current_permissions', _empty_permissions())


def _has_permission(flag):
    return bool(_current_permissions().get(flag, False))


def permission_required(flag):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if not session.get('crm_logged_in') or not getattr(g, 'current_user', None):
                if request.path.startswith('/api/'):
                    return jsonify({'error': 'Authentication required'}), 401
                return redirect(f'/login?next={request.path}')
            if not _has_permission(flag):
                return jsonify({'error': 'Permission denied', 'requiredPermission': flag}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator


def admin_required(f):
    return permission_required('canExecuteDelete')(f)


# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

CRM_DB_PATH = os.environ.get('CRM_DB_PATH', os.path.join(_DATA_DIR, 'crm.db'))


@contextmanager
def get_db():
    conn = sqlite3.connect(CRM_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA journal_mode=WAL;')
    conn.execute('PRAGMA busy_timeout=5000;')
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _stable_user_id(username):
    normalized = str(username or '').strip().lower() or 'user'
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f'fieldopsdemo-crm-user::{normalized}'))


def _safe_check_password(password_hash, password):
    try:
        return bool(password_hash) and check_password_hash(password_hash, password or '')
    except Exception:
        return False


def init_db():
    with get_db() as db:
        # --- Core CRM tables ---
        db.executescript('''
            CREATE TABLE IF NOT EXISTS customers (
                id                 TEXT PRIMARY KEY,
                name               TEXT NOT NULL,
                address            TEXT DEFAULT '',
                phone              TEXT DEFAULT '',
                status             TEXT DEFAULT 'Lead',
                notes              TEXT DEFAULT '',
                ltv                REAL DEFAULT 0,
                lat                REAL,
                lng                REAL,
                customer_number    INTEGER,
                email              TEXT DEFAULT '',
                city_state_zip     TEXT DEFAULT '',
                marker_emoji       TEXT DEFAULT '',
                deleted_at         TEXT DEFAULT '',
                deleted_by_user_id TEXT DEFAULT '',
                delete_thread_id   INTEGER
            );
            CREATE TABLE IF NOT EXISTS customer_jobs (
                id                   TEXT PRIMARY KEY,
                customer_id          TEXT NOT NULL,
                service_label        TEXT DEFAULT '',
                price                REAL DEFAULT 0,
                interval_months      INTEGER DEFAULT 1,
                week_slot            INTEGER DEFAULT 1,
                start_month          INTEGER DEFAULT 1,
                start_year           INTEGER DEFAULT 2026,
                status               TEXT DEFAULT 'active',
                notes                TEXT DEFAULT '',
                selected_months_json TEXT DEFAULT '[]',
                snapshot_json        TEXT DEFAULT '{}',
                created_at           TEXT DEFAULT '',
                updated_at           TEXT DEFAULT '',
                deleted_at           TEXT DEFAULT '',
                deleted_by_user_id   TEXT DEFAULT '',
                delete_thread_id     INTEGER
            );
            CREATE TABLE IF NOT EXISTS customer_job_occurrences (
                id                TEXT PRIMARY KEY,
                job_id            TEXT NOT NULL,
                template_year     INTEGER NOT NULL,
                template_month    INTEGER NOT NULL,
                year              INTEGER NOT NULL,
                month             INTEGER NOT NULL,
                week_slot         INTEGER DEFAULT 1,
                status            TEXT DEFAULT 'scheduled',
                invoice_prepared  INTEGER DEFAULT 0,
                pushed            INTEGER DEFAULT 0,
                created_at        TEXT DEFAULT '',
                updated_at        TEXT DEFAULT '',
                UNIQUE(job_id, template_year, template_month)
            );
            CREATE TABLE IF NOT EXISTS service_jobs (
                id                    TEXT PRIMARY KEY,
                job_number            INTEGER,
                customer_id           TEXT DEFAULT '',
                address               TEXT DEFAULT '',
                service_type          TEXT DEFAULT '',
                service_category      TEXT DEFAULT '',
                frequency             TEXT DEFAULT '',
                quoted_amount         REAL DEFAULT 0,
                actual_amount         REAL DEFAULT 0,
                overhead_spent        REAL DEFAULT 0,
                status                TEXT DEFAULT 'Scheduled',
                payment_status        TEXT DEFAULT 'Unpaid',
                invoice_sent          INTEGER DEFAULT 0,
                scheduled_date        TEXT DEFAULT '',
                assigned_employee_ids TEXT DEFAULT '[]',
                notes                 TEXT DEFAULT '',
                gcal_event_id         TEXT DEFAULT '',
                deleted_at            TEXT DEFAULT '',
                deleted_by_user_id    TEXT DEFAULT '',
                delete_thread_id      INTEGER
            );
            CREATE TABLE IF NOT EXISTS employees (
                id                      TEXT PRIMARY KEY,
                name                    TEXT NOT NULL,
                team                    TEXT DEFAULT 'labor',
                active                  INTEGER DEFAULT 1,
                included_in_labor       INTEGER DEFAULT 0,
                gets_admin_override     INTEGER DEFAULT 0,
                gets_marketing_override INTEGER DEFAULT 0,
                labor_weight            REAL DEFAULT 1,
                admin_weight            REAL DEFAULT 1,
                marketing_weight        REAL DEFAULT 1
            );
            CREATE TABLE IF NOT EXISTS crm_users (
                id                   TEXT PRIMARY KEY,
                username             TEXT NOT NULL,
                password_hash        TEXT DEFAULT '',
                role                 TEXT NOT NULL DEFAULT 'employee',
                display_name         TEXT DEFAULT '',
                employee_id          TEXT,
                active               INTEGER NOT NULL DEFAULT 1,
                must_change_password INTEGER NOT NULL DEFAULT 0,
                created_at           TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
                last_login_at        TEXT DEFAULT ''
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_users_username_nocase
                ON crm_users (username COLLATE NOCASE);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_users_employee_id
                ON crm_users (employee_id);
            CREATE TABLE IF NOT EXISTS crm_settings (
                setting_key   TEXT PRIMARY KEY,
                setting_value TEXT NOT NULL DEFAULT '{}',
                updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );
        ''')

        # --- Integration: website intake imports ---
        db.executescript('''
            CREATE TABLE IF NOT EXISTS crm_intake_imports (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                website_submission_id INTEGER NOT NULL,
                submission_uuid      TEXT NOT NULL,
                schema_version       INTEGER NOT NULL DEFAULT 1,
                imported_at          TEXT NOT NULL DEFAULT (datetime('now')),
                raw_payload_json     TEXT NOT NULL,
                serialization_hash   TEXT,
                validation_status    TEXT NOT NULL DEFAULT 'valid',
                validation_errors_json TEXT,
                customer_match_status TEXT NOT NULL DEFAULT 'unmatched',
                matched_customer_id  TEXT,
                intake_status        TEXT NOT NULL DEFAULT 'imported',
                source_page          TEXT,
                form_type            TEXT,
                submitted_at         TEXT,
                created_by_importer  TEXT,
                converted_customer_id TEXT DEFAULT '',
                converted_job_id     TEXT DEFAULT '',
                converted_at         TEXT DEFAULT '',
                conversion_summary_json TEXT DEFAULT '{}',
                UNIQUE(submission_uuid),
                UNIQUE(website_submission_id)
            );

            CREATE TABLE IF NOT EXISTS crm_import_quarantine (
                id                   INTEGER PRIMARY KEY AUTOINCREMENT,
                website_submission_id INTEGER,
                submission_uuid      TEXT,
                received_at          TEXT NOT NULL DEFAULT (datetime('now')),
                raw_payload_json     TEXT,
                reason_code          TEXT NOT NULL,
                reason_detail        TEXT,
                schema_version       INTEGER,
                operator_notes       TEXT,
                resolved_at          TEXT,
                resolution_status    TEXT DEFAULT 'unresolved'
            );

            CREATE TABLE IF NOT EXISTS integration_cursors (
                source_system    TEXT PRIMARY KEY,
                last_submission_id INTEGER NOT NULL DEFAULT 0,
                last_attempt_at  TEXT,
                last_success_at  TEXT,
                last_error       TEXT
            );
        ''')

        # Safe SQLite migrations for legacy/new columns.
        for _migration in [
            "ALTER TABLE customers ADD COLUMN customer_number INTEGER",
            "ALTER TABLE customers ADD COLUMN email TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN city_state_zip TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN marker_emoji TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN deleted_at TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN deleted_by_user_id TEXT DEFAULT ''",
            "ALTER TABLE customers ADD COLUMN delete_thread_id INTEGER",
            "ALTER TABLE customer_jobs ADD COLUMN selected_months_json TEXT DEFAULT '[]'",
            "ALTER TABLE customer_jobs ADD COLUMN deleted_at TEXT DEFAULT ''",
            "ALTER TABLE customer_jobs ADD COLUMN deleted_by_user_id TEXT DEFAULT ''",
            "ALTER TABLE customer_jobs ADD COLUMN delete_thread_id INTEGER",
            "ALTER TABLE crm_intake_imports ADD COLUMN converted_customer_id TEXT DEFAULT ''",
            "ALTER TABLE crm_intake_imports ADD COLUMN converted_job_id TEXT DEFAULT ''",
            "ALTER TABLE crm_intake_imports ADD COLUMN converted_at TEXT DEFAULT ''",
            "ALTER TABLE crm_intake_imports ADD COLUMN conversion_summary_json TEXT DEFAULT '{}'",
            "ALTER TABLE service_jobs ADD COLUMN service_category TEXT DEFAULT ''",
            "ALTER TABLE service_jobs ADD COLUMN frequency TEXT DEFAULT ''",
            "ALTER TABLE service_jobs ADD COLUMN payment_status TEXT DEFAULT 'Unpaid'",
            "ALTER TABLE service_jobs ADD COLUMN invoice_sent INTEGER DEFAULT 0",
            "ALTER TABLE service_jobs ADD COLUMN deleted_at TEXT DEFAULT ''",
            "ALTER TABLE service_jobs ADD COLUMN deleted_by_user_id TEXT DEFAULT ''",
            "ALTER TABLE service_jobs ADD COLUMN delete_thread_id INTEGER",
            "ALTER TABLE crm_users ADD COLUMN password_hash TEXT DEFAULT ''",
            "ALTER TABLE crm_users ADD COLUMN role TEXT NOT NULL DEFAULT 'employee'",
            "ALTER TABLE crm_users ADD COLUMN display_name TEXT DEFAULT ''",
            "ALTER TABLE crm_users ADD COLUMN employee_id TEXT",
            "ALTER TABLE crm_users ADD COLUMN active INTEGER NOT NULL DEFAULT 1",
            "ALTER TABLE crm_users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE crm_users ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))",
            "ALTER TABLE crm_users ADD COLUMN updated_at TEXT NOT NULL DEFAULT (datetime('now'))",
            "ALTER TABLE crm_users ADD COLUMN last_login_at TEXT DEFAULT ''",
        ]:
            try:
                db.execute(_migration)
            except Exception:
                pass

        # Auto-assign customer numbers to existing records missing one
        unassigned = db.execute(
            'SELECT id FROM customers WHERE customer_number IS NULL ORDER BY name'
        ).fetchall()
        if unassigned:
            max_num = db.execute(
                'SELECT COALESCE(MAX(customer_number), 0) FROM customers'
            ).fetchone()[0]
            for i, row in enumerate(unassigned):
                db.execute('UPDATE customers SET customer_number=? WHERE id=?',
                           (max_num + i + 1, row['id']))

        # Seed default employees on first run
        if db.execute('SELECT COUNT(*) FROM employees').fetchone()[0] == 0:
            seeds = [
                (str(uuid.uuid4()), 'Demo Owner',            'owner',     1, 1, 1, 1, 43, 1, 1),
                (str(uuid.uuid4()), 'Lead Technician',    'labor',     1, 0, 0, 0, 57, 1, 1),
                (str(uuid.uuid4()), 'Operations Manager', 'admin',     1, 0, 0, 0,  1, 1, 1),
                (str(uuid.uuid4()), 'Marketing',          'marketing', 1, 0, 0, 0,  1, 1, 1),
            ]
            db.executemany(
                'INSERT INTO employees VALUES (?,?,?,?,?,?,?,?,?,?)', seeds
            )

        now_iso = datetime.now(timezone.utc).isoformat()

        def _upsert_bootstrap_user(username, role, password_hash, display_name, *, active=True):
            existing = db.execute(
                'SELECT * FROM crm_users WHERE lower(username)=lower(?)',
                (username,)
            ).fetchone()
            if not existing:
                db.execute(
                    'INSERT INTO crm_users '
                    '(id,username,password_hash,role,display_name,employee_id,active,must_change_password,created_at,updated_at,last_login_at) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    (
                        _stable_user_id(username),
                        username,
                        password_hash or '',
                        _normalize_user_role(role, CRM_ROLE_EMPLOYEE),
                        display_name or username,
                        None,
                        1 if active else 0,
                        0,
                        now_iso,
                        now_iso,
                        '',
                    )
                )
                return

            updates = ['role=?', 'display_name=?', 'active=?', 'updated_at=?']
            params = [
                _normalize_user_role(role, CRM_ROLE_EMPLOYEE),
                display_name or existing['display_name'] or username,
                1 if active else 0,
                now_iso,
            ]
            if password_hash and not str(existing['password_hash'] or '').strip():
                updates.append('password_hash=?')
                params.append(password_hash)
            params.append(existing['id'])
            db.execute(
                f'UPDATE crm_users SET {", ".join(updates)} WHERE id=?',
                params
            )

        _upsert_bootstrap_user(
            CRM_USERNAME,
            CRM_ROLE_ADMIN,
            CRM_PASSWORD_HASH,
            CRM_USERNAME,
            active=True,
        )
        if DEMO_ENABLED:
            _upsert_bootstrap_user(
                DEMO_USERNAME,
                CRM_ROLE_DEMO,
                generate_password_hash(DEMO_PASSWORD),
                DEMO_USERNAME,
                active=True,
            )
        else:
            db.execute(
                'UPDATE crm_users SET active=0, updated_at=? '
                'WHERE lower(username)=lower(?) AND role=?',
                (now_iso, DEMO_USERNAME, CRM_ROLE_DEMO)
            )

        # Seed integration cursor for website on first run
        db.execute(
            'INSERT OR IGNORE INTO integration_cursors (source_system, last_submission_id) '
            'VALUES (?, 0)',
            ('ccs_website',)
        )
        db.execute(
            'INSERT OR IGNORE INTO crm_settings (setting_key, setting_value, updated_at) '
            'VALUES (?, ?, ?)',
            (
                'travel_routing',
                json.dumps(DEFAULT_TRAVEL_ROUTING_SETTINGS),
                now_iso,
            )
        )

        # --- Google Workspace integration tables ---
        db.executescript('''
            CREATE TABLE IF NOT EXISTS google_linked_accounts (
                crm_user                TEXT PRIMARY KEY,
                crm_user_id             TEXT,
                google_email            TEXT DEFAULT '',
                google_subject_id       TEXT DEFAULT '',
                encrypted_access_token  TEXT DEFAULT '',
                encrypted_refresh_token TEXT DEFAULT '',
                token_expiry            TEXT DEFAULT '',
                scopes                  TEXT DEFAULT '',
                linked_at               TEXT NOT NULL DEFAULT (datetime('now')),
                last_refreshed_at       TEXT,
                is_active               INTEGER NOT NULL DEFAULT 1,
                reconnect_required      INTEGER NOT NULL DEFAULT 0,
                failure_reason          TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS google_oauth_states (
                state         TEXT PRIMARY KEY,
                crm_user      TEXT NOT NULL,
                crm_user_id   TEXT,
                code_verifier TEXT DEFAULT '',
                created_at    TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS google_oauth_audit_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                event      TEXT NOT NULL,
                crm_user   TEXT,
                crm_user_id TEXT,
                detail     TEXT,
                occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS customer_drive_folders (
                customer_id          TEXT PRIMARY KEY,
                customer_folder_id   TEXT NOT NULL,
                customer_folder_url  TEXT DEFAULT '',
                estimates_folder_id  TEXT DEFAULT '',
                photos_folder_id     TEXT DEFAULT '',
                created_at           TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS gmail_send_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                crm_user     TEXT NOT NULL,
                crm_user_id  TEXT,
                customer_id  TEXT,
                to_address   TEXT NOT NULL,
                subject      TEXT NOT NULL,
                message_id   TEXT,
                sent_at      TEXT NOT NULL DEFAULT (datetime('now')),
                status       TEXT NOT NULL DEFAULT 'sent',
                error_detail TEXT
            );
        ''')

        # Schema migration: add columns that may not exist in older DB instances.
        # SQLite raises OperationalError if the column already exists; that is expected.
        for _migration in [
            "ALTER TABLE google_linked_accounts ADD COLUMN crm_user_id TEXT",
            "ALTER TABLE google_linked_accounts ADD COLUMN google_subject_id TEXT DEFAULT ''",
            "ALTER TABLE google_linked_accounts ADD COLUMN reconnect_required INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE google_linked_accounts ADD COLUMN failure_reason TEXT DEFAULT ''",
            "ALTER TABLE google_oauth_states ADD COLUMN crm_user_id TEXT",
            "ALTER TABLE google_oauth_states ADD COLUMN code_verifier TEXT DEFAULT ''",
            "ALTER TABLE google_oauth_audit_log ADD COLUMN crm_user_id TEXT",
            "ALTER TABLE gmail_send_log ADD COLUMN crm_user_id TEXT",
        ]:
            try:
                db.execute(_migration)
            except Exception:
                pass

        username_map = {
            str(row['username'] or '').strip().lower(): row['id']
            for row in db.execute('SELECT id, username FROM crm_users').fetchall()
            if str(row['username'] or '').strip()
        }
        for row in db.execute(
            "SELECT rowid, crm_user FROM google_linked_accounts "
            "WHERE crm_user_id IS NULL AND COALESCE(crm_user, '') <> ''"
        ).fetchall():
            user_id = username_map.get(str(row['crm_user'] or '').strip().lower())
            if user_id:
                db.execute(
                    'UPDATE google_linked_accounts SET crm_user_id=? WHERE rowid=?',
                    (user_id, row['rowid'])
                )
        for row in db.execute(
            "SELECT state, crm_user FROM google_oauth_states "
            "WHERE crm_user_id IS NULL AND COALESCE(crm_user, '') <> ''"
        ).fetchall():
            user_id = username_map.get(str(row['crm_user'] or '').strip().lower())
            if user_id:
                db.execute(
                    'UPDATE google_oauth_states SET crm_user_id=? WHERE state=?',
                    (user_id, row['state'])
                )
        for row in db.execute(
            "SELECT id, crm_user FROM google_oauth_audit_log "
            "WHERE crm_user_id IS NULL AND COALESCE(crm_user, '') <> ''"
        ).fetchall():
            user_id = username_map.get(str(row['crm_user'] or '').strip().lower())
            if user_id:
                db.execute(
                    'UPDATE google_oauth_audit_log SET crm_user_id=? WHERE id=?',
                    (user_id, row['id'])
                )
        for row in db.execute(
            "SELECT id, crm_user FROM gmail_send_log "
            "WHERE crm_user_id IS NULL AND COALESCE(crm_user, '') <> ''"
        ).fetchall():
            user_id = username_map.get(str(row['crm_user'] or '').strip().lower())
            if user_id:
                db.execute(
                    'UPDATE gmail_send_log SET crm_user_id=? WHERE id=?',
                    (user_id, row['id'])
                )
        try:
            db.execute(
                'CREATE UNIQUE INDEX IF NOT EXISTS idx_google_linked_accounts_crm_user_id '
                'ON google_linked_accounts (crm_user_id)'
            )
        except Exception:
            pass
        for _index_sql in [
            'CREATE INDEX IF NOT EXISTS idx_google_oauth_states_crm_user_id '
            'ON google_oauth_states (crm_user_id)',
            'CREATE INDEX IF NOT EXISTS idx_google_oauth_audit_log_crm_user_id '
            'ON google_oauth_audit_log (crm_user_id, occurred_at DESC)',
            'CREATE INDEX IF NOT EXISTS idx_gmail_send_log_crm_user_id '
            'ON gmail_send_log (crm_user_id, sent_at DESC)',
        ]:
            try:
                db.execute(_index_sql)
            except Exception:
                pass

        # --- SMS / outbound communication tables ---
        db.executescript('''
            CREATE TABLE IF NOT EXISTS communication_queue (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                task_type       TEXT    NOT NULL DEFAULT 'sms',
                customer_id     TEXT    NOT NULL DEFAULT '',
                to_number       TEXT    NOT NULL DEFAULT '',
                message         TEXT    NOT NULL DEFAULT '',
                status          TEXT    NOT NULL DEFAULT 'pending',
                provider_sid    TEXT,
                retry_count     INTEGER NOT NULL DEFAULT 0,
                max_retries     INTEGER NOT NULL DEFAULT 3,
                next_retry_at   TEXT,
                error_detail    TEXT,
                locked_by       TEXT,
                locked_at       TEXT,
                claim_token     TEXT,
                created_at      TEXT    NOT NULL DEFAULT '',
                updated_at      TEXT    NOT NULL DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS sms_audit_log (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                task_id      INTEGER NOT NULL,
                status       TEXT    NOT NULL,
                provider_sid TEXT,
                error        TEXT,
                occurred_at  TEXT    NOT NULL DEFAULT ''
            );
        ''')

        # --- Customer communications ledger ---
        db.executescript('''
            CREATE TABLE IF NOT EXISTS customer_contact_events (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id   TEXT DEFAULT '',
                job_id        TEXT DEFAULT '',
                estimate_id   TEXT DEFAULT '',
                channel       TEXT NOT NULL DEFAULT 'manual',
                direction     TEXT NOT NULL DEFAULT 'system',
                event_type    TEXT NOT NULL DEFAULT 'note',
                subject       TEXT DEFAULT '',
                body_summary  TEXT DEFAULT '',
                occurred_at   TEXT NOT NULL DEFAULT (datetime('now')),
                user_id       TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS customer_followups (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                customer_id       TEXT NOT NULL,
                job_id            TEXT DEFAULT '',
                estimate_id       TEXT DEFAULT '',
                channel           TEXT NOT NULL DEFAULT 'phone',
                subject           TEXT DEFAULT '',
                body_summary      TEXT DEFAULT '',
                due_at            TEXT NOT NULL DEFAULT '',
                status            TEXT NOT NULL DEFAULT 'open',
                assigned_user_id  TEXT DEFAULT '',
                created_at        TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
                completed_at      TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS customer_contact_preferences (
                customer_id             TEXT PRIMARY KEY,
                phone_allowed           INTEGER NOT NULL DEFAULT 1,
                sms_allowed             INTEGER NOT NULL DEFAULT 1,
                email_allowed           INTEGER NOT NULL DEFAULT 1,
                do_not_contact          INTEGER NOT NULL DEFAULT 0,
                preferred_channel       TEXT DEFAULT '',
                preferred_time_window   TEXT DEFAULT '',
                notes                   TEXT DEFAULT '',
                updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE INDEX IF NOT EXISTS idx_customer_contact_events_customer_occurred
                ON customer_contact_events (customer_id, occurred_at DESC);
            CREATE INDEX IF NOT EXISTS idx_customer_contact_events_job
                ON customer_contact_events (job_id, occurred_at DESC);
            CREATE INDEX IF NOT EXISTS idx_customer_followups_customer_status_due
                ON customer_followups (customer_id, status, due_at);
        ''')

        db.executescript('''
            CREATE TABLE IF NOT EXISTS admin_threads (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_type         TEXT NOT NULL DEFAULT 'message',
                subject             TEXT DEFAULT '',
                status              TEXT NOT NULL DEFAULT 'open',
                created_by_user_id  TEXT NOT NULL DEFAULT '',
                customer_id         TEXT DEFAULT '',
                service_job_id      TEXT DEFAULT '',
                customer_job_id     TEXT DEFAULT '',
                target_kind         TEXT DEFAULT '',
                target_id           TEXT DEFAULT '',
                created_at          TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
                resolved_at         TEXT DEFAULT '',
                resolved_by_user_id TEXT DEFAULT ''
            );

            CREATE TABLE IF NOT EXISTS admin_messages (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                thread_id      INTEGER NOT NULL,
                author_user_id TEXT NOT NULL DEFAULT '',
                message        TEXT NOT NULL DEFAULT '',
                message_type   TEXT NOT NULL DEFAULT 'user',
                created_at     TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS admin_thread_participants (
                thread_id        INTEGER NOT NULL,
                user_id          TEXT NOT NULL,
                added_by_user_id TEXT DEFAULT '',
                added_at         TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (thread_id, user_id)
            );

            CREATE INDEX IF NOT EXISTS idx_admin_threads_status_updated
                ON admin_threads (status, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_admin_threads_creator
                ON admin_threads (created_by_user_id, updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_admin_messages_thread_created
                ON admin_messages (thread_id, created_at ASC);
            CREATE INDEX IF NOT EXISTS idx_admin_thread_participants_user
                ON admin_thread_participants (user_id, thread_id);
        ''')


init_db()

# ---------------------------------------------------------------------------
# Auth / identity helpers
# ---------------------------------------------------------------------------


def _serialize_crm_user(row):
    return {
        'id': row['id'],
        'username': row['username'],
        'displayName': row['display_name'] or row['username'],
        'role': _normalize_user_role(row['role'], CRM_ROLE_EMPLOYEE),
        'employeeId': row['employee_id'] or '',
        'active': bool(row['active']),
    }


def _employee_directory_entry(row):
    return {
        'id': row['id'],
        'name': row['name'] or '',
        'team': row['team'] or '',
        'active': bool(row['active']),
    }


def _session_identity_payload(user, permissions=None):
    permissions = permissions or build_permission_map(user)
    display_name = str(user['display_name'] or user['username'] or '').strip()
    return {
        'crm_logged_in': True,
        'crm_user_id': user['id'],
        'crm_username': user['username'],
        'crm_user': user['username'],
        'display_name': display_name,
        'role': _normalize_user_role(user['role'], CRM_ROLE_EMPLOYEE),
        'permissions': permissions,
    }


def _apply_user_session(user, permissions=None):
    payload = _session_identity_payload(user, permissions)
    session.permanent = True
    for key, value in payload.items():
        session[key] = value
    return payload


def _get_user_by_id(db, user_id):
    if not str(user_id or '').strip():
        return None
    return db.execute(
        'SELECT * FROM crm_users WHERE id=?',
        (str(user_id).strip(),)
    ).fetchone()


def _get_user_by_username(db, username):
    normalized = str(username or '').strip()
    if not normalized:
        return None
    return db.execute(
        'SELECT * FROM crm_users WHERE lower(username)=lower(?)',
        (normalized,)
    ).fetchone()


def _current_user():
    return getattr(g, 'current_user', None)


def _current_user_id(default=''):
    user = _current_user()
    if user:
        return user['id']
    return session.get('crm_user_id', default) if has_request_context() else default


def _current_username(default=''):
    user = _current_user()
    if user:
        return user['username']
    if has_request_context():
        return session.get('crm_username') or session.get('crm_user') or default
    return default


def _is_admin_user(user=None):
    user = user or _current_user()
    return bool(user) and _normalize_user_role(user['role'], CRM_ROLE_EMPLOYEE) == CRM_ROLE_ADMIN


def _normalize_travel_routing_settings(data, *, strict=False):
    payload = data if isinstance(data, dict) else {}
    home_base_address = str(
        payload.get('homeBaseAddress', DEFAULT_TRAVEL_ROUTING_SETTINGS['homeBaseAddress'])
    ).strip()
    worker_pickup_address = str(
        payload.get('workerPickupAddress', DEFAULT_TRAVEL_ROUTING_SETTINGS['workerPickupAddress'])
    ).strip()

    if strict:
        if not home_base_address:
            raise ValueError('Home base address is required.')
        if not worker_pickup_address:
            raise ValueError('Worker pickup address is required.')

    return {
        'homeBaseAddress': home_base_address or DEFAULT_TRAVEL_ROUTING_SETTINGS['homeBaseAddress'],
        'workerPickupAddress': worker_pickup_address or DEFAULT_TRAVEL_ROUTING_SETTINGS['workerPickupAddress'],
    }


def _get_travel_routing_settings(db):
    row = db.execute(
        'SELECT setting_value FROM crm_settings WHERE setting_key=?',
        ('travel_routing',)
    ).fetchone()
    if not row:
        return dict(DEFAULT_TRAVEL_ROUTING_SETTINGS)
    try:
        data = json.loads(row['setting_value'] or '{}')
    except Exception:
        return dict(DEFAULT_TRAVEL_ROUTING_SETTINGS)
    return _normalize_travel_routing_settings(data)


def _auth_me_payload(user=None):
    user = user or _current_user()
    permissions = build_permission_map(user) if user else _empty_permissions()
    return {
        'authenticated': bool(user),
        'user': _serialize_crm_user(user) if user else None,
        'permissions': permissions,
        'mustChangePassword': bool(user['must_change_password']) if user else False,
    }


def _user_password_matches(user, password):
    if not user:
        return False
    if _safe_check_password(user['password_hash'], password):
        return True
    return (
        str(user['username'] or '').strip().lower() == str(CRM_USERNAME or '').strip().lower()
        and bool(CRM_PASSWORD_HASH)
        and _safe_check_password(CRM_PASSWORD_HASH, password)
    )


def _truthy(value):
    return str(value or '').strip().lower() in {'1', 'true', 'yes', 'on'}


@app.before_request
def _load_current_user_from_session():
    g.current_user = None
    g.current_permissions = _empty_permissions()

    if not session.get('crm_logged_in'):
        return None

    user = None
    with get_db() as db:
        user = _get_user_by_id(db, session.get('crm_user_id'))
        if user is None:
            user = _get_user_by_username(db, session.get('crm_user') or session.get('crm_username'))

    if not user or not bool(user['active']):
        session.clear()
        return None

    permissions = build_permission_map(user)
    _apply_user_session(user, permissions)
    g.current_user = user
    g.current_permissions = permissions

    if (
        request.path.startswith('/api/')
        and bool(user['must_change_password'])
        and request.path not in PASSWORD_CHANGE_EXEMPT_API_PATHS
    ):
        return jsonify({'error': 'Password change required', 'mustChangePassword': True}), 403
    return None


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------


def _customer(row):
    return {
        'id': row['id'], 'name': row['name'],
        'address': row['address'] or '', 'phone': row['phone'] or '',
        'status': row['status'] or 'Lead', 'notes': row['notes'] or '',
        'ltv': row['ltv'] or 0, 'lat': row['lat'], 'lng': row['lng'],
        'customerNumber': row['customer_number'],
        'email': row['email'] or '', 'cityStateZip': row['city_state_zip'] or '',
        'markerEmoji': row['marker_emoji'] or '',
    }


def _job(row):
    return {
        'id': row['id'], 'jobNumber': row['job_number'],
        'customerId': row['customer_id'] or '', 'address': row['address'] or '',
        'serviceCategory': row['service_category'] or '', 'frequency': row['frequency'] or '',
        'serviceType': row['service_type'] or '', 'quotedAmount': row['quoted_amount'] or 0,
        'actualAmount': row['actual_amount'] or 0, 'overheadSpent': row['overhead_spent'] or 0,
        'status': row['status'] or 'Scheduled',
        'paymentStatus': normalize_payment_status(row['payment_status']),
        'invoiceSent': bool(normalize_invoice_sent(row['invoice_sent'])),
        'scheduledDate': row['scheduled_date'] or '',
        'assignedEmployeeIds': json.loads(row['assigned_employee_ids'] or '[]'),
        'notes': row['notes'] or '', 'gcalEventId': row['gcal_event_id'] or '',
    }


def _customer_job(row):
    try:
        snapshot = json.loads(row['snapshot_json'] or '{}')
    except Exception:
        snapshot = {}
    try:
        selected_months = _customer_job_selected_months(
            json.loads(row['selected_months_json'] or '[]')
        )
    except Exception:
        selected_months = []
    return {
        'id': row['id'],
        'customer_id': row['customer_id'],
        'service_label': row['service_label'] or '',
        'price': row['price'] or 0,
        'interval_months': row['interval_months'] or 1,
        'week_slot': row['week_slot'] or 1,
        'start_month': row['start_month'] or 1,
        'start_year': row['start_year'] or datetime.now().year,
        'status': row['status'] or 'active',
        'notes': row['notes'] or '',
        'selected_months': selected_months,
        'snapshot': snapshot if isinstance(snapshot, dict) else {},
    }


def _customer_job_occurrence(row):
    return {
        'id': row['id'],
        'job_id': row['job_id'],
        'year': row['year'],
        'month': row['month'],
        'week_slot': row['week_slot'],
        'status': row['status'] or 'scheduled',
        'invoice_prepared': bool(row['invoice_prepared']),
    }


def _utcnow_iso():
    return datetime.now(timezone.utc).isoformat()


def _crm_user_id(default='system'):
    return _current_user_id(default) if has_request_context() else default


def _trimmed_text(value, max_len=500):
    return str(value or '').strip()[:max_len]


def _coalesce_payload_value(data, *keys):
    for key in keys:
        if key in data and data.get(key) is not None:
            return data.get(key)
    return None


def _normalize_thread_type(value):
    raw = str(value or THREAD_TYPE_MESSAGE).strip().lower()
    return raw if raw in THREAD_TYPES else THREAD_TYPE_MESSAGE


def _normalize_thread_status(value, default=THREAD_STATUS_OPEN):
    raw = str(value or default).strip().lower()
    return raw if raw in THREAD_STATUSES else default


def _normalize_delete_target_kind(value):
    raw = str(value or '').strip().lower()
    return raw if raw in DELETE_TARGET_KINDS else ''


def _include_deleted_requested():
    return _truthy(request.args.get('include_deleted')) and _has_permission('canExecuteDelete')


def _select_customer_row(db, customer_id, *, include_deleted=False):
    if not str(customer_id or '').strip():
        return None
    query = 'SELECT * FROM customers WHERE id=?'
    params = [customer_id]
    if not include_deleted:
        query += " AND COALESCE(deleted_at, '')=''"
    return db.execute(query, params).fetchone()


def _select_service_job_row(db, job_id, *, include_deleted=False):
    if not str(job_id or '').strip():
        return None
    query = 'SELECT * FROM service_jobs WHERE id=?'
    params = [job_id]
    if not include_deleted:
        query += " AND COALESCE(deleted_at, '')=''"
    return db.execute(query, params).fetchone()


def _select_customer_job_row(db, job_id, *, include_deleted=False):
    if not str(job_id or '').strip():
        return None
    query = 'SELECT * FROM customer_jobs WHERE id=?'
    params = [job_id]
    if not include_deleted:
        query += " AND COALESCE(deleted_at, '')=''"
    return db.execute(query, params).fetchone()


class SoftDeleteError(Exception):
    status_code = 400

    def __init__(self, message, *, details=None):
        super().__init__(message)
        self.details = details or {}


class SoftDeleteNotFoundError(SoftDeleteError):
    status_code = 404


class SoftDeleteBlockedError(SoftDeleteError):
    status_code = 409


def _normalize_user_id_list(values):
    if not isinstance(values, list):
        return []
    deduped = []
    seen = set()
    for value in values:
        user_id = str(value or '').strip()
        if not user_id or user_id in seen:
            continue
        seen.add(user_id)
        deduped.append(user_id)
    return deduped


def _fetch_crm_users_by_ids(db, user_ids):
    normalized = _normalize_user_id_list(user_ids)
    if not normalized:
        return []
    rows = db.execute(
        'SELECT * FROM crm_users WHERE id IN ({}) ORDER BY lower(display_name), lower(username)'.format(
            ','.join('?' for _ in normalized)
        ),
        normalized
    ).fetchall()
    row_map = {row['id']: row for row in rows}
    return [row_map[user_id] for user_id in normalized if user_id in row_map]


def _thread_participants(db, thread_id):
    rows = db.execute(
        'SELECT u.* FROM admin_thread_participants p '
        'JOIN crm_users u ON u.id = p.user_id '
        'WHERE p.thread_id=? ORDER BY lower(u.display_name), lower(u.username)',
        (thread_id,)
    ).fetchall()
    return [_serialize_crm_user(row) for row in rows]


def _add_thread_participants(db, thread_id, user_ids, *, added_by_user_id=''):
    for user_id in _normalize_user_id_list(user_ids):
        db.execute(
            'INSERT OR IGNORE INTO admin_thread_participants (thread_id, user_id, added_by_user_id) VALUES (?,?,?)',
            (thread_id, user_id, added_by_user_id or '')
        )


def _create_admin_message(db, thread_id, author_user_id, message, *, message_type=ADMIN_THREAD_MESSAGE_TYPE_USER):
    created_at = _utcnow_iso()
    db.execute(
        'INSERT INTO admin_messages (thread_id, author_user_id, message, message_type, created_at) VALUES (?,?,?,?,?)',
        (thread_id, author_user_id or '', _trimmed_text(message, 5000), message_type, created_at)
    )
    message_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    db.execute(
        'UPDATE admin_threads SET updated_at=? WHERE id=?',
        (created_at, thread_id)
    )
    return db.execute(
        'SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, '
        'u.role AS author_role, u.employee_id AS author_employee_id, u.active AS author_active '
        'FROM admin_messages m '
        'LEFT JOIN crm_users u ON u.id = m.author_user_id '
        'WHERE m.id=?',
        (message_id,)
    ).fetchone()


def _serialize_admin_message(row):
    author = None
    if row['author_user_id']:
        author = {
            'id': row['author_user_id'],
            'username': row['author_username'] or '',
            'displayName': row['author_display_name'] or row['author_username'] or row['author_user_id'],
            'role': _normalize_user_role(row['author_role'], CRM_ROLE_EMPLOYEE),
            'employeeId': row['author_employee_id'] or '',
            'active': bool(row['author_active']) if row['author_active'] is not None else True,
        }
    return {
        'id': row['id'],
        'threadId': row['thread_id'],
        'authorUserId': row['author_user_id'] or '',
        'message': row['message'] or '',
        'messageType': row['message_type'] or ADMIN_THREAD_MESSAGE_TYPE_USER,
        'createdAt': row['created_at'] or '',
        'author': author,
    }


def _thread_messages(db, thread_id):
    rows = db.execute(
        'SELECT m.*, u.username AS author_username, u.display_name AS author_display_name, '
        'u.role AS author_role, u.employee_id AS author_employee_id, u.active AS author_active '
        'FROM admin_messages m '
        'LEFT JOIN crm_users u ON u.id = m.author_user_id '
        'WHERE m.thread_id=? ORDER BY m.created_at ASC, m.id ASC',
        (thread_id,)
    ).fetchall()
    return [_serialize_admin_message(row) for row in rows]


def _serialize_admin_thread_summary(db, row):
    latest_message = db.execute(
        'SELECT message, created_at FROM admin_messages WHERE thread_id=? ORDER BY created_at DESC, id DESC LIMIT 1',
        (row['id'],)
    ).fetchone()
    message_count = db.execute(
        'SELECT COUNT(*) FROM admin_messages WHERE thread_id=?',
        (row['id'],)
    ).fetchone()[0]
    return {
        'id': row['id'],
        'threadType': row['thread_type'] or THREAD_TYPE_MESSAGE,
        'subject': row['subject'] or '',
        'status': row['status'] or THREAD_STATUS_OPEN,
        'createdByUserId': row['created_by_user_id'] or '',
        'customerId': row['customer_id'] or '',
        'serviceJobId': row['service_job_id'] or '',
        'customerJobId': row['customer_job_id'] or '',
        'targetKind': row['target_kind'] or '',
        'targetId': row['target_id'] or '',
        'createdAt': row['created_at'] or '',
        'updatedAt': row['updated_at'] or '',
        'resolvedAt': row['resolved_at'] or '',
        'resolvedByUserId': row['resolved_by_user_id'] or '',
        'participants': _thread_participants(db, row['id']),
        'messageCount': message_count or 0,
        'latestMessagePreview': (latest_message['message'] or '') if latest_message else '',
        'latestMessageAt': (latest_message['created_at'] or '') if latest_message else '',
    }


def _serialize_admin_thread_detail(db, row):
    payload = _serialize_admin_thread_summary(db, row)
    payload['messages'] = _thread_messages(db, row['id'])
    return payload


def _get_visible_admin_thread(db, thread_id, *, user=None):
    user = user or _current_user()
    if not user:
        return None
    if _normalize_user_role(user['role'], CRM_ROLE_EMPLOYEE) == CRM_ROLE_ADMIN:
        return db.execute('SELECT * FROM admin_threads WHERE id=?', (thread_id,)).fetchone()
    return db.execute(
        'SELECT t.* FROM admin_threads t '
        'JOIN admin_thread_participants p ON p.thread_id = t.id '
        'WHERE t.id=? AND p.user_id=?',
        (thread_id, user['id'])
    ).fetchone()


def _resolve_thread_references(
    db,
    *,
    customer_id='',
    service_job_id='',
    customer_job_id='',
    target_kind='',
    target_id='',
):
    customer_id = _trimmed_text(customer_id, 80)
    service_job_id = _trimmed_text(service_job_id, 80)
    customer_job_id = _trimmed_text(customer_job_id, 80)
    target_kind = _normalize_delete_target_kind(target_kind)
    target_id = _trimmed_text(target_id, 80)

    if target_kind == DELETE_TARGET_CUSTOMER and not target_id:
        target_id = customer_id
    if target_kind == DELETE_TARGET_SERVICE_JOB and not target_id:
        target_id = service_job_id
    if target_kind == DELETE_TARGET_CUSTOMER_JOB and not target_id:
        target_id = customer_job_id

    if customer_id and not _select_customer_row(db, customer_id):
        return None, ('Customer not found', 404)
    if service_job_id and not _select_service_job_row(db, service_job_id):
        return None, ('Service job not found', 404)
    if customer_job_id and not _select_customer_job_row(db, customer_job_id):
        return None, ('Recurring job not found', 404)

    if target_kind:
        if not target_id:
            return None, ('targetId is required when targetKind is provided', 400)
        if target_kind == DELETE_TARGET_CUSTOMER:
            target_row = _select_customer_row(db, target_id)
            if not target_row:
                return None, ('Customer not found', 404)
            customer_id = customer_id or target_id
        elif target_kind == DELETE_TARGET_SERVICE_JOB:
            target_row = _select_service_job_row(db, target_id)
            if not target_row:
                return None, ('Service job not found', 404)
            service_job_id = service_job_id or target_id
            customer_id = customer_id or (target_row['customer_id'] or '')
        else:
            target_row = _select_customer_job_row(db, target_id)
            if not target_row:
                return None, ('Recurring job not found', 404)
            customer_job_id = customer_job_id or target_id
            customer_id = customer_id or (target_row['customer_id'] or '')

    return {
        'customer_id': customer_id,
        'service_job_id': service_job_id,
        'customer_job_id': customer_job_id,
        'target_kind': target_kind,
        'target_id': target_id,
    }, None


def _soft_delete_customer(db, customer_id, *, deleted_by_user_id='', delete_thread_id=None):
    row = _select_customer_row(db, customer_id)
    if not row:
        raise SoftDeleteNotFoundError('Customer not found')

    undeleted_service_jobs = db.execute(
        "SELECT COUNT(*) FROM service_jobs WHERE customer_id=? AND COALESCE(deleted_at, '')=''",
        (customer_id,)
    ).fetchone()[0]
    undeleted_customer_jobs = db.execute(
        "SELECT COUNT(*) FROM customer_jobs WHERE customer_id=? AND COALESCE(deleted_at, '')=''",
        (customer_id,)
    ).fetchone()[0]
    if undeleted_service_jobs or undeleted_customer_jobs:
        raise SoftDeleteBlockedError(
            'Customer has undeleted linked jobs',
            details={
                'serviceJobs': undeleted_service_jobs or 0,
                'customerJobs': undeleted_customer_jobs or 0,
            }
        )

    deleted_at = _utcnow_iso()
    db.execute(
        'UPDATE customers SET deleted_at=?, deleted_by_user_id=?, delete_thread_id=? WHERE id=?',
        (deleted_at, deleted_by_user_id or '', delete_thread_id, customer_id)
    )
    return db.execute('SELECT * FROM customers WHERE id=?', (customer_id,)).fetchone()


def _soft_delete_service_job(db, job_id, *, deleted_by_user_id='', delete_thread_id=None):
    row = _select_service_job_row(db, job_id)
    if not row:
        raise SoftDeleteNotFoundError('Service job not found')
    deleted_at = _utcnow_iso()
    db.execute(
        'UPDATE service_jobs SET deleted_at=?, deleted_by_user_id=?, delete_thread_id=? WHERE id=?',
        (deleted_at, deleted_by_user_id or '', delete_thread_id, job_id)
    )
    return db.execute('SELECT * FROM service_jobs WHERE id=?', (job_id,)).fetchone()


def _soft_delete_customer_job(db, job_id, *, deleted_by_user_id='', delete_thread_id=None):
    row = _select_customer_job_row(db, job_id)
    if not row:
        raise SoftDeleteNotFoundError('Recurring job not found')
    deleted_at = _utcnow_iso()
    db.execute(
        'UPDATE customer_jobs SET deleted_at=?, deleted_by_user_id=?, delete_thread_id=? WHERE id=?',
        (deleted_at, deleted_by_user_id or '', delete_thread_id, job_id)
    )
    return db.execute('SELECT * FROM customer_jobs WHERE id=?', (job_id,)).fetchone()


def _soft_delete_target(db, target_kind, target_id, *, deleted_by_user_id='', delete_thread_id=None):
    target_kind = _normalize_delete_target_kind(target_kind)
    if target_kind == DELETE_TARGET_CUSTOMER:
        return _soft_delete_customer(
            db,
            target_id,
            deleted_by_user_id=deleted_by_user_id,
            delete_thread_id=delete_thread_id,
        )
    if target_kind == DELETE_TARGET_SERVICE_JOB:
        return _soft_delete_service_job(
            db,
            target_id,
            deleted_by_user_id=deleted_by_user_id,
            delete_thread_id=delete_thread_id,
        )
    if target_kind == DELETE_TARGET_CUSTOMER_JOB:
        return _soft_delete_customer_job(
            db,
            target_id,
            deleted_by_user_id=deleted_by_user_id,
            delete_thread_id=delete_thread_id,
        )
    raise SoftDeleteError('Unsupported delete target')


def _create_contact_event(
    db,
    *,
    customer_id='',
    job_id='',
    estimate_id='',
    channel='manual',
    direction='system',
    event_type='note',
    subject='',
    body_summary='',
    occurred_at='',
    user_id='',
):
    db.execute(
        'INSERT INTO customer_contact_events '
        '(customer_id,job_id,estimate_id,channel,direction,event_type,subject,body_summary,occurred_at,user_id) '
        'VALUES (?,?,?,?,?,?,?,?,?,?)',
        (
            _trimmed_text(customer_id, 80),
            _trimmed_text(job_id, 80),
            _trimmed_text(estimate_id, 80),
            normalize_contact_channel(channel),
            normalize_contact_direction(direction),
            _trimmed_text(event_type or 'note', 120),
            _trimmed_text(subject, 240),
            _trimmed_text(body_summary, 2000),
            _trimmed_text(occurred_at, 64) or _utcnow_iso(),
            _trimmed_text(user_id, 120) or _crm_user_id(),
        )
    )
    event_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    return db.execute(
        'SELECT e.*, j.job_number, c.name AS customer_name FROM customer_contact_events e '
        'LEFT JOIN service_jobs j ON j.id = e.job_id '
        'LEFT JOIN customers c ON c.id = e.customer_id '
        'WHERE e.id=?',
        (event_id,)
    ).fetchone()


def _upsert_contact_preferences(db, customer_id, data):
    now = _utcnow_iso()
    db.execute(
        'INSERT INTO customer_contact_preferences '
        '(customer_id,phone_allowed,sms_allowed,email_allowed,do_not_contact,preferred_channel,preferred_time_window,notes,updated_at) '
        'VALUES (?,?,?,?,?,?,?,?,?) '
        'ON CONFLICT(customer_id) DO UPDATE SET '
        'phone_allowed=excluded.phone_allowed,'
        'sms_allowed=excluded.sms_allowed,'
        'email_allowed=excluded.email_allowed,'
        'do_not_contact=excluded.do_not_contact,'
        'preferred_channel=excluded.preferred_channel,'
        'preferred_time_window=excluded.preferred_time_window,'
        'notes=excluded.notes,'
        'updated_at=excluded.updated_at',
        (
            _trimmed_text(customer_id, 80),
            1 if bool(data.get('phoneAllowed', True)) else 0,
            1 if bool(data.get('smsAllowed', True)) else 0,
            1 if bool(data.get('emailAllowed', True)) else 0,
            1 if bool(data.get('doNotContact', False)) else 0,
            normalize_preferred_channel(data.get('preferredChannel')),
            _trimmed_text(data.get('preferredTimeWindow'), 120),
            _trimmed_text(data.get('notes'), 2000),
            now,
        )
    )
    return db.execute(
        'SELECT * FROM customer_contact_preferences WHERE customer_id=?',
        (customer_id,)
    ).fetchone()


def _create_followup(
    db,
    *,
    customer_id,
    due_at,
    channel='phone',
    subject='',
    body_summary='',
    job_id='',
    estimate_id='',
    assigned_user_id='',
    status='open',
):
    now = _utcnow_iso()
    db.execute(
        'INSERT INTO customer_followups '
        '(customer_id,job_id,estimate_id,channel,subject,body_summary,due_at,status,assigned_user_id,created_at,updated_at,completed_at) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        (
            _trimmed_text(customer_id, 80),
            _trimmed_text(job_id, 80),
            _trimmed_text(estimate_id, 80),
            normalize_contact_channel(channel),
            _trimmed_text(subject, 240),
            _trimmed_text(body_summary, 2000),
            _trimmed_text(due_at, 64),
            normalize_followup_status(status),
            _trimmed_text(assigned_user_id, 120) or _crm_user_id(),
            now,
            now,
            now if normalize_followup_status(status) == 'completed' else '',
        )
    )
    followup_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
    return db.execute(
        'SELECT f.*, j.job_number, c.name AS customer_name FROM customer_followups f '
        'LEFT JOIN service_jobs j ON j.id = f.job_id '
        'LEFT JOIN customers c ON c.id = f.customer_id '
        'WHERE f.id=?',
        (followup_id,)
    ).fetchone()


def _parse_json_object(value):
    try:
        parsed = json.loads(value or '{}')
    except Exception:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _parse_json_array(value):
    try:
        parsed = json.loads(value or '[]')
    except Exception:
        return []
    return parsed if isinstance(parsed, list) else []


def _parse_intake_payload_json(value):
    payload = _parse_json_object(value)
    return payload if isinstance(payload, dict) else {}


def _clean_text(value):
    return ' '.join(str(value or '').strip().split())


def _normalize_email_match(value):
    return _clean_text(value).lower()


def _normalize_phone_match(value):
    digits = ''.join(ch for ch in str(value or '') if ch.isdigit())
    return digits[-10:] if len(digits) >= 10 else digits


def _normalize_text_match(value):
    cleaned = ''.join(ch.lower() if ch.isalnum() else ' ' for ch in _clean_text(value))
    return ' '.join(cleaned.split())


def _float_or_zero(value):
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def _format_city_state_zip(city='', state='', zip_code=''):
    city = _clean_text(city)
    state = _clean_text(state)
    zip_code = _clean_text(zip_code)
    right = ' '.join(part for part in (state, zip_code) if part)
    if city and right:
        return f'{city}, {right}'
    return city or right


def _format_service_address(street='', city='', state='', zip_code=''):
    street = _clean_text(street)
    city_state_zip = _format_city_state_zip(city, state, zip_code)
    return ', '.join(part for part in (street, city_state_zip) if part)


def _extract_intake_lead_summary(payload, row=None):
    customer = payload.get('customer', {})
    location = payload.get('service_location', {})
    service_request = payload.get('service_request', {})
    estimate = payload.get('estimate') or {}

    if not isinstance(customer, dict):
        customer = {}
    if not isinstance(location, dict):
        location = {}
    if not isinstance(service_request, dict):
        service_request = {}
    if not isinstance(estimate, dict):
        estimate = {}

    service_category = service_request.get('service_category', '')
    if isinstance(service_category, list):
        service_category = ', '.join(str(item).strip() for item in service_category if str(item).strip())

    line_items = [
        {
            'label': _clean_text(item.get('label')),
            'amount': _float_or_zero(item.get('amount')),
            'quoteOnly': bool(item.get('quote_only')),
        }
        for item in estimate.get('line_items', [])
        if isinstance(item, dict) and _clean_text(item.get('label'))
    ]

    name = _clean_text(customer.get('full_name') or customer.get('name'))
    email = _clean_text(customer.get('email'))
    phone = _clean_text(customer.get('phone'))
    street = _clean_text(
        location.get('street')
        or customer.get('address')
        or customer.get('address_line1')
    )
    city = _clean_text(location.get('city') or customer.get('city'))
    state = _clean_text(location.get('state') or customer.get('state'))
    zip_code = _clean_text(location.get('postal_code') or customer.get('postal_code') or customer.get('zip'))

    return {
        'name': name,
        'email': email,
        'phone': phone,
        'preferredContactMethod': _clean_text(customer.get('preferred_contact_method')),
        'street': street,
        'city': city,
        'state': state,
        'zip': zip_code,
        'cityStateZip': _format_city_state_zip(city, state, zip_code),
        'address': _format_service_address(street, city, state, zip_code),
        'serviceCategory': _clean_text(service_category),
        'serviceContext': _clean_text(service_request.get('service_context')),
        'frequency': _clean_text(service_request.get('frequency')),
        'notes': str(service_request.get('notes') or '').strip(),
        'addons': service_request.get('addons') if isinstance(service_request.get('addons'), list) else [],
        'estimateTotal': _float_or_zero(estimate.get('estimated_total')),
        'windowCount': int(estimate.get('window_count') or 0),
        'floorCount': int(estimate.get('floor_count') or 0),
        'lineItems': line_items,
        'sourcePage': _clean_text((row['source_page'] if row else '') or payload.get('source_metadata', {}).get('source_page')),
        'formType': _clean_text((row['form_type'] if row else '') or payload.get('source_metadata', {}).get('form_type')),
        'submittedAt': _clean_text((row['submitted_at'] if row else '') or payload.get('submitted_at')),
    }


def _build_intake_estimate_summary(lead):
    parts = []
    if lead.get('estimateTotal', 0) > 0:
        parts.append(f"Website estimate total: ${lead['estimateTotal']:.2f}")
    if lead.get('frequency'):
        parts.append(f"Requested frequency: {lead['frequency']}")
    if lead.get('preferredContactMethod'):
        parts.append(f"Preferred contact: {lead['preferredContactMethod']}")
    if lead.get('lineItems'):
        line_labels = []
        for item in lead['lineItems'][:6]:
            amount_text = f"${item['amount']:.2f}" if item['amount'] else '$0.00'
            line_labels.append(f"{item['label']} ({amount_text})")
        parts.append('Estimate items: ' + '; '.join(line_labels))
    return parts


def _build_intake_customer_notes(intake_row, lead):
    parts = []
    if lead.get('notes'):
        parts.append(lead['notes'])
    parts.extend(_build_intake_estimate_summary(lead))
    origin_bits = [f"Website intake #{intake_row['website_submission_id']}"]
    if lead.get('formType'):
        origin_bits.append(lead['formType'])
    if lead.get('submittedAt'):
        origin_bits.append(lead['submittedAt'])
    parts.append(' | '.join(origin_bits))
    return '\n'.join(part for part in parts if part).strip()


def _build_intake_service_job_notes(intake_row, lead):
    parts = []
    if lead.get('notes'):
        parts.append(lead['notes'])
    parts.extend(_build_intake_estimate_summary(lead))
    metadata = [f"Website intake #{intake_row['website_submission_id']}"]
    if lead.get('sourcePage'):
        metadata.append(f"Source: {lead['sourcePage']}")
    if lead.get('formType'):
        metadata.append(f"Form: {lead['formType']}")
    if lead.get('submittedAt'):
        metadata.append(f"Submitted: {lead['submittedAt']}")
    parts.append(' | '.join(metadata))
    return '\n'.join(part for part in parts if part).strip()


def _contact_preferences_from_lead(lead):
    preferred = normalize_preferred_channel(lead.get('preferredContactMethod'))
    return {
        'phoneAllowed': True,
        'smsAllowed': True,
        'emailAllowed': True,
        'doNotContact': False,
        'preferredChannel': preferred,
        'preferredTimeWindow': '',
        'notes': f"Derived from website lead preference: {lead.get('preferredContactMethod')}" if preferred else '',
    }


def _next_customer_number(db):
    return (db.execute(
        'SELECT COALESCE(MAX(customer_number), 0) FROM customers'
    ).fetchone()[0] or 0) + 1


def _next_service_job_number(db):
    return (db.execute('SELECT COALESCE(MAX(job_number), 0) FROM service_jobs').fetchone()[0] or 0) + 1


def _insert_customer_record(db, data):
    customer_id = str(uuid.uuid4())
    customer_number = data.get('customerNumber') or None
    if not customer_number:
        customer_number = _next_customer_number(db)
    db.execute(
        'INSERT INTO customers (id,name,address,phone,status,notes,ltv,lat,lng,customer_number,email,city_state_zip,marker_emoji) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (
            customer_id,
            data['name'],
            data.get('address', ''),
            data.get('phone', ''),
            data.get('status', 'Lead'),
            data.get('notes', ''),
            data.get('ltv', 0),
            data.get('lat'),
            data.get('lng'),
            customer_number,
            data.get('email', ''),
            data.get('cityStateZip', ''),
            data.get('markerEmoji', ''),
        )
    )
    return db.execute('SELECT * FROM customers WHERE id=?', (customer_id,)).fetchone()


def _insert_service_job_record(db, data):
    job_id = str(uuid.uuid4())
    service_category = normalize_service_category(
        data.get('serviceCategory') or data.get('service_category')
    )
    frequency = normalize_frequency(data.get('frequency'))
    payment_status = normalize_payment_status(data.get('paymentStatus'))
    invoice_sent = normalize_invoice_sent(data.get('invoiceSent'))
    db.execute(
        'INSERT INTO service_jobs '
        '(id,job_number,customer_id,address,service_type,service_category,frequency,'
        'quoted_amount,actual_amount,overhead_spent,status,payment_status,invoice_sent,scheduled_date,'
        'assigned_employee_ids,notes,gcal_event_id) '
        'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        (
            job_id,
            _next_service_job_number(db),
            data.get('customerId', ''),
            data.get('address', ''),
            data.get('serviceType', ''),
            service_category,
            frequency,
            data.get('quotedAmount', 0),
            data.get('actualAmount', 0),
            data.get('overheadSpent', 0),
            data.get('status', 'Scheduled'),
            payment_status,
            invoice_sent,
            data.get('scheduledDate', ''),
            json.dumps(data.get('assignedEmployeeIds', [])),
            data.get('notes', ''),
            data.get('gcalEventId', ''),
        )
    )
    return db.execute('SELECT * FROM service_jobs WHERE id=?', (job_id,)).fetchone()


def _build_intake_customer_candidates(db, lead):
    lead_name = _normalize_text_match(lead.get('name'))
    lead_email = _normalize_email_match(lead.get('email'))
    lead_phone = _normalize_phone_match(lead.get('phone'))
    lead_address = _normalize_text_match(lead.get('address'))
    lead_city_state_zip = _normalize_text_match(lead.get('cityStateZip'))
    candidates = []

    rows = db.execute(
        "SELECT * FROM customers WHERE COALESCE(deleted_at, '')='' ORDER BY name"
    ).fetchall()
    for row in rows:
        score = 0
        reasons = []
        customer_name = _normalize_text_match(row['name'])
        customer_email = _normalize_email_match(row['email'])
        customer_phone = _normalize_phone_match(row['phone'])
        customer_address = _normalize_text_match(row['address'])
        customer_city_state_zip = _normalize_text_match(row['city_state_zip'])

        if lead_email and customer_email and lead_email == customer_email:
            score += 140
            reasons.append('Exact email match')
        if lead_phone and customer_phone and lead_phone == customer_phone:
            score += 130
            reasons.append('Exact phone match')
        if lead_address and customer_address and lead_address == customer_address:
            score += 80
            reasons.append('Exact address match')
        if lead_name and customer_name and lead_name == customer_name:
            score += 60
            reasons.append('Exact name match')
        elif lead_name and customer_name and (
            lead_name in customer_name or customer_name in lead_name
        ) and min(len(lead_name), len(customer_name)) >= 4:
            score += 25
            reasons.append('Similar name')
        if lead_city_state_zip and customer_city_state_zip and lead_city_state_zip == customer_city_state_zip:
            score += 20
            reasons.append('Same city/state/zip')

        if score <= 0:
            continue

        confidence = 'possible'
        if (
            'Exact email match' in reasons
            or 'Exact phone match' in reasons
            or ('Exact address match' in reasons and 'Exact name match' in reasons)
        ):
            confidence = 'exact'
        elif score >= 80:
            confidence = 'likely'

        customer = _customer(row)
        customer.update({
            'score': score,
            'confidence': confidence,
            'reasons': reasons,
        })
        candidates.append(customer)

    candidates.sort(key=lambda item: (-item['score'], item['name'].lower(), str(item['customerNumber'] or '')))
    return candidates[:8]


def _intake_match_status_from_candidates(candidates):
    if not candidates:
        return 'unmatched'
    exact_count = sum(1 for candidate in candidates if candidate['confidence'] == 'exact')
    if exact_count == 1 and len(candidates) == 1:
        return 'matched'
    if exact_count == 1 and (len(candidates) == 1 or candidates[0]['confidence'] == 'exact'):
        return 'matched'
    if exact_count > 1 or len(candidates) > 1:
        return 'ambiguous'
    if candidates[0]['confidence'] == 'likely':
        return 'likely_match'
    return 'possible_match'


def _build_intake_customer_payload(intake_row, lead):
    return {
        'name': lead.get('name') or 'Website Lead',
        'address': lead.get('address', ''),
        'phone': lead.get('phone', ''),
        'email': lead.get('email', ''),
        'cityStateZip': lead.get('cityStateZip', ''),
        'status': 'Lead',
        'notes': _build_intake_customer_notes(intake_row, lead),
        'ltv': 0,
        'markerEmoji': '',
    }


def _build_intake_service_job_payload(intake_row, lead, customer_row):
    service_type = lead.get('serviceCategory') or 'Website Estimate Request'
    if not any([
        service_type.strip(),
        lead.get('notes', '').strip(),
        lead.get('estimateTotal', 0) > 0,
        lead.get('lineItems'),
    ]):
        return None
    return {
        'customerId': customer_row['id'],
        'address': lead.get('address') or customer_row['address'] or '',
        'serviceType': service_type,
        'serviceCategory': normalize_service_category(service_type),
        'frequency': normalize_frequency(lead.get('frequency')),
        'quotedAmount': lead.get('estimateTotal', 0),
        'actualAmount': 0,
        'overheadSpent': 0,
        'status': 'Estimate',
        'paymentStatus': 'Unpaid',
        'invoiceSent': False,
        'scheduledDate': '',
        'assignedEmployeeIds': [],
        'notes': _build_intake_service_job_notes(intake_row, lead),
        'gcalEventId': '',
    }


def _month_index(year, month):
    return int(year) * 12 + (int(month) - 1)


def _index_to_year_month(index_value):
    year = index_value // 12
    month = (index_value % 12) + 1
    return year, month


def _customer_job_int(value, default, *, minimum=1, maximum=None):
    try:
        numeric = int(value)
    except Exception:
        numeric = default
    if minimum is not None:
        numeric = max(minimum, numeric)
    if maximum is not None:
        numeric = min(maximum, numeric)
    return numeric


def _customer_job_float(value, default=0):
    try:
        return float(value)
    except Exception:
        return float(default)


def _customer_job_selected_months(value):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except Exception:
            value = [part.strip() for part in value.split(',') if part.strip()]
    if not isinstance(value, (list, tuple, set)):
        return []
    seen = set()
    months = []
    for item in value:
        try:
            month_value = int(item)
        except Exception:
            continue
        if 1 <= month_value <= 12 and month_value not in seen:
            seen.add(month_value)
            months.append(month_value)
    return sorted(months)


def normalize_customer_job_status(value):
    return 'inactive' if str(value or '').strip().lower() == 'inactive' else 'active'


def _split_customer_address(customer_row):
    address = (customer_row['address'] or '').strip()
    city_state_zip = (customer_row['city_state_zip'] or '').strip()
    street = address
    if address and ',' in address and not city_state_zip:
        street, city_state_zip = [part.strip() for part in address.split(',', 1)]

    city = ''
    state = ''
    zip_code = ''
    if city_state_zip:
        if ',' in city_state_zip:
            city, rest = [part.strip() for part in city_state_zip.split(',', 1)]
        else:
            rest = city_state_zip.strip()
        rest_parts = rest.split()
        if rest_parts:
            state = rest_parts[0]
        if len(rest_parts) > 1:
            zip_code = ' '.join(rest_parts[1:])
    return {
        'street': street,
        'city': city,
        'state': state,
        'zip': zip_code,
    }


def _build_customer_job_snapshot(customer_row, raw_snapshot):
    parts = _split_customer_address(customer_row)
    snapshot = raw_snapshot if isinstance(raw_snapshot, dict) else {}
    return {
        'name': str(snapshot.get('name') or customer_row['name'] or '').strip(),
        'phone': str(snapshot.get('phone') or customer_row['phone'] or '').strip(),
        'email': str(snapshot.get('email') or customer_row['email'] or '').strip(),
        'street': str(snapshot.get('street') or parts['street'] or '').strip(),
        'city': str(snapshot.get('city') or parts['city'] or '').strip(),
        'state': str(snapshot.get('state') or parts['state'] or '').strip(),
        'zip': str(snapshot.get('zip') or parts['zip'] or '').strip(),
    }


def _normalize_customer_job_payload(data, customer_row, existing=None):
    existing_snapshot = {}
    existing_selected_months = []
    if existing:
        try:
            existing_snapshot = json.loads(existing['snapshot_json'] or '{}')
        except Exception:
            existing_snapshot = {}
        try:
            existing_selected_months = _customer_job_selected_months(
                json.loads(existing['selected_months_json'] or '[]')
            )
        except Exception:
            existing_selected_months = []

    raw_snapshot = _coalesce_payload_value(data, 'snapshot')
    if raw_snapshot is None and existing_snapshot:
        raw_snapshot = existing_snapshot

    selected_months = _coalesce_payload_value(data, 'selected_months', 'selectedMonths')
    if selected_months is None:
        selected_months = existing_selected_months

    return {
        'service_label': str(
            _coalesce_payload_value(data, 'service_label', 'serviceLabel')
            if _coalesce_payload_value(data, 'service_label', 'serviceLabel') is not None
            else (existing['service_label'] if existing else '')
        ).strip(),
        'price': _customer_job_float(
            _coalesce_payload_value(data, 'price'),
            existing['price'] if existing else 0
        ),
        'interval_months': _customer_job_int(
            _coalesce_payload_value(data, 'interval_months', 'intervalMonths'),
            existing['interval_months'] if existing else 1,
            minimum=1,
            maximum=12
        ),
        'week_slot': _customer_job_int(
            _coalesce_payload_value(data, 'week_slot', 'weekSlot'),
            existing['week_slot'] if existing else 1,
            minimum=1,
            maximum=5
        ),
        'start_month': _customer_job_int(
            _coalesce_payload_value(data, 'start_month', 'startMonth'),
            existing['start_month'] if existing else datetime.now().month,
            minimum=1,
            maximum=12
        ),
        'start_year': _customer_job_int(
            _coalesce_payload_value(data, 'start_year', 'startYear'),
            existing['start_year'] if existing else datetime.now().year,
            minimum=2000,
            maximum=2100
        ),
        'status': normalize_customer_job_status(
            _coalesce_payload_value(data, 'status') if _coalesce_payload_value(data, 'status') is not None else (existing['status'] if existing else 'active')
        ),
        'notes': str(
            _coalesce_payload_value(data, 'notes') if _coalesce_payload_value(data, 'notes') is not None else (existing['notes'] if existing else '')
        ).strip(),
        'selected_months_json': json.dumps(_customer_job_selected_months(selected_months)),
        'snapshot_json': json.dumps(_build_customer_job_snapshot(customer_row, raw_snapshot)),
    }


def _customer_job_template_slots(job_row, months_ahead=14):
    now = datetime.now()
    interval_months = _customer_job_int(job_row['interval_months'], 1, minimum=1, maximum=12)
    start_year = _customer_job_int(job_row['start_year'], now.year, minimum=2000, maximum=2100)
    start_month = _customer_job_int(job_row['start_month'], now.month, minimum=1, maximum=12)
    selected_months = _customer_job_selected_months(job_row['selected_months_json'] or '[]')
    template_start = _month_index(start_year, start_month)
    first_template = max(template_start, _month_index(now.year, now.month) - 1)
    last_template = _month_index(now.year, now.month) + months_ahead
    slots = []

    if selected_months:
        last_year = _index_to_year_month(last_template)[0]
        for year in range(start_year, last_year + 1):
            for month in selected_months:
                month_index = _month_index(year, month)
                if month_index < first_template or month_index > last_template:
                    continue
                if month_index < template_start:
                    continue
                slots.append((year, month))
        return slots

    for month_index in range(first_template, last_template + 1):
        offset = month_index - template_start
        if offset < 0 or offset % interval_months != 0:
            continue
        slots.append(_index_to_year_month(month_index))
    return slots


def _ensure_customer_job_occurrences(db, job_row, months_ahead=14):
    template_week_slot = _customer_job_int(job_row['week_slot'], 1, minimum=1, maximum=5)
    created_or_updated = False

    for template_year, template_month in _customer_job_template_slots(job_row, months_ahead=months_ahead):
        existing = db.execute(
            'SELECT * FROM customer_job_occurrences WHERE job_id=? AND template_year=? AND template_month=?',
            (job_row['id'], template_year, template_month)
        ).fetchone()
        if existing:
            if not existing['pushed']:
                db.execute(
                    'UPDATE customer_job_occurrences SET year=?,month=?,week_slot=?,updated_at=? WHERE id=?',
                    (template_year, template_month, template_week_slot, _utcnow_iso(), existing['id'])
                )
                created_or_updated = True
            continue
        db.execute(
            'INSERT INTO customer_job_occurrences '
            '(id,job_id,template_year,template_month,year,month,week_slot,status,invoice_prepared,pushed,created_at,updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
            (
                str(uuid.uuid4()), job_row['id'], template_year, template_month,
                template_year, template_month, template_week_slot, 'scheduled', 0, 0,
                _utcnow_iso(), _utcnow_iso()
            )
        )
        created_or_updated = True
    return created_or_updated


# Keep recurrence mechanics separate from route handlers so job CRUD and
# Google sync can reuse one normalization path.
SERVICE_CATEGORY_DEFAULT_FREQUENCIES = {
    'Inside/Outside': 'quarterly',
    'Exterior Only': 'monthly',
    'Power Washing': 'annual',
}

FREQUENCY_RRULES = {
    'monthly': 'RRULE:FREQ=MONTHLY;INTERVAL=1',
    'quarterly': 'RRULE:FREQ=MONTHLY;INTERVAL=3',
    'annual': 'RRULE:FREQ=YEARLY;INTERVAL=1',
}


def normalize_service_category(value):
    raw = str(value or '').strip()
    if not raw:
        return ''

    key = raw.lower().replace('&', 'and').replace('-', ' ').replace('_', ' ')
    key = ' '.join(key.split())
    if key in ('inside/outside', 'inside outside', 'inside and outside'):
        return 'Inside/Outside'
    if key in ('exterior only', 'exterior'):
        return 'Exterior Only'
    if key in ('power washing', 'pressure washing', 'soft washing'):
        return 'Power Washing'
    return raw


def normalize_frequency(value):
    raw = str(value or '').strip().lower().replace('-', ' ')
    raw = ' '.join(raw.split())
    if raw in ('', 'none', 'n/a'):
        return ''
    if raw in ('standalone', 'one time', 'one-time', 'single'):
        return 'standalone'
    if raw in ('default', 'auto', 'category default', 'category-default'):
        return 'default'
    if raw in ('monthly', 'month', 'every month'):
        return 'monthly'
    if raw in ('quarterly', 'quarter', 'every 3 months', 'every three months'):
        return 'quarterly'
    if raw in ('annual', 'annually', 'yearly', 'every year', 'every 1 year'):
        return 'annual'
    return raw


def normalize_payment_status(value):
    raw = str(value or '').strip().lower().replace('_', '-')
    raw = ' '.join(raw.split())
    if raw == 'paid':
        return 'Paid'
    if raw in ('net-30', 'net 30', 'net30'):
        return 'Net-30'
    return 'Unpaid'


def normalize_invoice_sent(value):
    if value in (True, 1):
        return 1
    if isinstance(value, str):
        return 1 if value.strip().lower() in {'1', 'true', 'yes', 'y'} else 0
    return 0


def normalize_contact_channel(value):
    raw = str(value or '').strip().lower().replace('_', '-')
    aliases = {
        'call': 'phone',
        'tel': 'phone',
        'text': 'sms',
        'message': 'sms',
        'mail': 'email',
        'web': 'website',
    }
    raw = aliases.get(raw, raw)
    if raw in {'phone', 'sms', 'email', 'website', 'calendar', 'invoice', 'manual'}:
        return raw
    return 'manual'


def normalize_contact_direction(value):
    raw = str(value or '').strip().lower().replace('_', '-')
    if raw in {'inbound', 'incoming'}:
        return 'inbound'
    if raw in {'outbound', 'outgoing'}:
        return 'outbound'
    return 'system'


def normalize_followup_status(value):
    raw = str(value or '').strip().lower().replace('_', '-')
    if raw in {'completed', 'complete', 'done', 'closed'}:
        return 'completed'
    if raw in {'cancelled', 'canceled'}:
        return 'cancelled'
    return 'open'


def normalize_preferred_channel(value):
    raw = str(value or '').strip().lower().replace('_', '-')
    if raw in {'', 'none'}:
        return ''
    return normalize_contact_channel(raw)


def resolve_job_frequency(service_category, frequency):
    normalized_frequency = normalize_frequency(frequency)
    if normalized_frequency in FREQUENCY_RRULES:
        return normalized_frequency
    if normalized_frequency in ('', 'default'):
        return SERVICE_CATEGORY_DEFAULT_FREQUENCIES.get(
            normalize_service_category(service_category),
            ''
        )
    return ''


def build_job_recurrence(service_category, frequency):
    resolved_frequency = resolve_job_frequency(service_category, frequency)
    rule = FREQUENCY_RRULES.get(resolved_frequency)
    return [rule] if rule else None


def _get_job_calendar_customer_row(db, customer_id):
    if not customer_id:
        return None
    row = _select_customer_row(db, customer_id)
    if not row:
        return None
    return row


def _build_job_calendar_sync_data(job_row, customer_row=None):
    customer_name = ''
    customer_address = ''
    if customer_row:
        customer_name = str(customer_row['name'] or '').strip()
        customer_address = str(customer_row['address'] or '').strip()

    service_type = str(job_row['service_type'] or '').strip() or 'Service Job'
    summary = service_type if not customer_name else f"{service_type} - {customer_name}"
    return {
        'summary': summary,
        'location': str(job_row['address'] or '').strip() or customer_address,
        'description': str(job_row['notes'] or '').strip(),
        'scheduled_date': str(job_row['scheduled_date'] or '').strip(),
        'recurrence': build_job_recurrence(job_row['service_category'], job_row['frequency']),
    }


def _job_calendar_fields_changed(existing_row, updated_row):
    tracked_fields = (
        'customer_id',
        'address',
        'service_type',
        'service_category',
        'frequency',
        'scheduled_date',
        'notes',
    )
    return any(
        str(existing_row[field] or '').strip() != str(updated_row[field] or '').strip()
        for field in tracked_fields
    )


def _sync_linked_job_calendar_event(job_row, customer_row=None):
    event_id = str(job_row.get('gcal_event_id') or '').strip()
    if not event_id:
        return '', ''
    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        return 'failed', 'Job saved, but Google Calendar is unavailable for automatic sync.'
    if not has_request_context():
        return 'failed', 'Job saved, but Google Calendar could not access the CRM session.'

    crm_user_id = _current_user_id()
    crm_username = _current_username()
    if not crm_user_id:
        return 'failed', 'Job saved, but Google Calendar could not identify the CRM user.'

    sync_data = _build_job_calendar_sync_data(job_row, customer_row)
    if not sync_data['scheduled_date']:
        return 'failed', 'Job saved, but Google Calendar was not updated because the scheduled date is blank.'

    try:
        _g_calendar.update_job_event(
            crm_user_id=crm_user_id,
            crm_username=crm_username,
            event_id=event_id,
            job_id=str(job_row.get('id') or ''),
            summary=sync_data['summary'],
            location=sync_data['location'],
            scheduled_date=sync_data['scheduled_date'],
            description=sync_data['description'],
            crm_base_url=CRM_BASE_URL,
            recurrence=sync_data['recurrence'],
        )
    except Exception as exc:
        return 'failed', f"Job saved, but Google Calendar update failed: {exc}"

    try:
        with get_db() as db:
            _create_contact_event(
                db,
                customer_id=job_row.get('customer_id', ''),
                job_id=job_row.get('id', ''),
                channel='calendar',
                direction='system',
                event_type='calendar_updated',
                subject=sync_data['summary'],
                body_summary=f"Google Calendar event updated for {sync_data['scheduled_date']}.",
                user_id=crm_user_id,
            )
    except Exception:
        pass
    return 'updated', ''


def _employee(row):
    return {
        'id': row['id'], 'name': row['name'], 'team': row['team'],
        'active': bool(row['active']), 'includedInLabor': bool(row['included_in_labor']),
        'getsAdminOverride': bool(row['gets_admin_override']),
        'getsMarketingOverride': bool(row['gets_marketing_override']),
        'laborWeight': row['labor_weight'], 'adminWeight': row['admin_weight'],
        'marketingWeight': row['marketing_weight'],
    }


def _contact_event(row):
    return {
        'id': row['id'],
        'customerId': row['customer_id'] or '',
        'jobId': row['job_id'] or '',
        'estimateId': row['estimate_id'] or '',
        'channel': row['channel'] or 'manual',
        'direction': row['direction'] or 'system',
        'eventType': row['event_type'] or 'note',
        'subject': row['subject'] or '',
        'bodySummary': row['body_summary'] or '',
        'occurredAt': row['occurred_at'] or '',
        'userId': row['user_id'] or '',
        'jobNumber': row['job_number'] if 'job_number' in row.keys() else None,
        'customerName': row['customer_name'] if 'customer_name' in row.keys() else '',
    }


def _customer_followup(row):
    return {
        'id': row['id'],
        'customerId': row['customer_id'] or '',
        'jobId': row['job_id'] or '',
        'estimateId': row['estimate_id'] or '',
        'channel': row['channel'] or 'phone',
        'subject': row['subject'] or '',
        'bodySummary': row['body_summary'] or '',
        'dueAt': row['due_at'] or '',
        'status': row['status'] or 'open',
        'assignedUserId': row['assigned_user_id'] or '',
        'createdAt': row['created_at'] or '',
        'updatedAt': row['updated_at'] or '',
        'completedAt': row['completed_at'] or '',
        'jobNumber': row['job_number'] if 'job_number' in row.keys() else None,
        'customerName': row['customer_name'] if 'customer_name' in row.keys() else '',
    }


def _default_contact_preferences(customer_id=''):
    return {
        'customerId': customer_id,
        'phoneAllowed': True,
        'smsAllowed': True,
        'emailAllowed': True,
        'doNotContact': False,
        'preferredChannel': '',
        'preferredTimeWindow': '',
        'notes': '',
        'updatedAt': '',
    }


def _customer_contact_preferences(row):
    if not row:
        return _default_contact_preferences()
    return {
        'customerId': row['customer_id'] or '',
        'phoneAllowed': bool(row['phone_allowed']),
        'smsAllowed': bool(row['sms_allowed']),
        'emailAllowed': bool(row['email_allowed']),
        'doNotContact': bool(row['do_not_contact']),
        'preferredChannel': row['preferred_channel'] or '',
        'preferredTimeWindow': row['preferred_time_window'] or '',
        'notes': row['notes'] or '',
        'updatedAt': row['updated_at'] or '',
    }


def _intake_import(row):
    payload = _parse_intake_payload_json(row['raw_payload_json'])
    conversion_summary = _parse_json_object(row['conversion_summary_json'])
    return {
        'id': row['id'],
        'websiteSubmissionId': row['website_submission_id'],
        'submissionUuid': row['submission_uuid'],
        'schemaVersion': row['schema_version'],
        'importedAt': row['imported_at'],
        'validationStatus': row['validation_status'],
        'customerMatchStatus': row['customer_match_status'],
        'matchedCustomerId': row['matched_customer_id'],
        'intakeStatus': row['intake_status'],
        'sourcePage': row['source_page'],
        'formType': row['form_type'],
        'submittedAt': row['submitted_at'],
        'customer': payload.get('customer', {}),
        'serviceLocation': payload.get('service_location', {}),
        'serviceRequest': payload.get('service_request', {}),
        'estimate': payload.get('estimate'),
        'leadSummary': _extract_intake_lead_summary(payload, row=row),
        'convertedCustomerId': row['converted_customer_id'] or '',
        'convertedJobId': row['converted_job_id'] or '',
        'convertedAt': row['converted_at'] or '',
        'conversionSummary': conversion_summary if isinstance(conversion_summary, dict) else {},
    }


# ---------------------------------------------------------------------------
# Manual paste intake helpers
# ---------------------------------------------------------------------------

def _extract_section_block(lines, header_label):
    """Return lines between '--- HEADER LABEL ---' and the next '--- ... ---' separator.
    header_label is matched case-insensitively without the surrounding dashes.
    """
    target = header_label.strip().upper()
    inside = False
    result = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('---') and stripped.endswith('---') and len(stripped) > 6:
            label = stripped.strip('-').strip().upper()
            if label == target:
                inside = True
                continue
            elif inside:
                break
        if inside:
            result.append(line)
    return result


def _collect_indented_bullet_lines(lines, start_index):
    """Starting at start_index in lines, collect '  - item' bullet entries.
    Stops at the first non-empty line that is not a bullet.
    Returns a list of stripped item strings.
    """
    items = []
    for line in lines[start_index:]:
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith('- '):
            items.append(stripped[2:].strip())
        else:
            break
    return items


def _looks_like_zip(s):
    s = s.strip()
    if len(s) == 5 and s.isdigit():
        return True
    if len(s) == 10 and s[5] == '-' and s[:5].isdigit() and s[6:].isdigit():
        return True
    return False


def _normalize_manual_paste_address(raw_address):
    """Normalize potentially duplicated address strings into structured parts.

    Handles patterns like:
      "100 Demo Way,, 100 Demo Way,, Demo City, 00000"
      "300 Demo Service Way, Demo City, 00000"

    Returns dict: { address_line1, city, postal_code }
    """
    raw = raw_address.strip()
    parts = [p.strip() for p in raw.split(',')]
    parts = [p for p in parts if p]

    # Deduplicate while preserving order
    seen = set()
    unique_parts = []
    for p in parts:
        key = p.lower()
        if key not in seen:
            seen.add(key)
            unique_parts.append(p)

    postal_code = ''
    city = ''
    street_parts = list(unique_parts)

    if street_parts and _looks_like_zip(street_parts[-1]):
        postal_code = street_parts.pop().strip()
    if street_parts:
        city = street_parts.pop().strip()

    address_line1 = ', '.join(street_parts)
    return {'address_line1': address_line1, 'city': city, 'postal_code': postal_code}


def _parse_manual_estimate_paste(raw_text):
    """Parse a manual paste in FieldOpsDemo estimate email format.

    Returns dict:
      canonicalPayload  â€“ matches crm_intake_imports raw_payload_json shape
      leadSummary       â€“ pre-built lead summary (same shape as _extract_intake_lead_summary)
      rawText           â€“ original input (pass-through)
      parseWarnings     â€“ list of warning strings for missing/ambiguous fields
    """
    lines = raw_text.splitlines()
    warnings = []

    def _kv(section_lines, key):
        key_upper = key.strip().upper()
        for line in section_lines:
            stripped = line.strip()
            colon_pos = stripped.find(':')
            if colon_pos != -1:
                k = stripped[:colon_pos].strip().upper()
                if k == key_upper:
                    return stripped[colon_pos + 1:].strip()
        return ''

    # Top-level fields (before first --- section ---)
    top_lines = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith('---') and stripped.endswith('---') and len(stripped) > 6:
            break
        top_lines.append(line)

    form_source = _kv(top_lines, 'FORM SOURCE')
    submitted_at = _kv(top_lines, 'SUBMITTED AT')

    # Customer Info section
    customer_lines = _extract_section_block(lines, 'CUSTOMER INFO')
    raw_address = _kv(customer_lines, 'ADDRESS')
    name = _kv(customer_lines, 'NAME')
    phone = _kv(customer_lines, 'PHONE')
    email = _kv(customer_lines, 'EMAIL')
    contact_via = _kv(customer_lines, 'CONTACT VIA')
    best_time = _kv(customer_lines, 'BEST TIME')

    if not name:
        warnings.append('NAME not found in Customer Info section')
    if not email and not phone:
        warnings.append('Neither EMAIL nor PHONE found in Customer Info section')
    if not raw_address:
        warnings.append('ADDRESS not found in Customer Info section')

    addr = _normalize_manual_paste_address(raw_address) if raw_address else {}
    address_line1 = addr.get('address_line1', '')
    city = addr.get('city', '')
    postal_code = addr.get('postal_code', '')

    # Property / Service Info section
    service_lines = _extract_section_block(lines, 'PROPERTY / SERVICE INFO')
    property_type = _kv(service_lines, 'PROPERTY TYPE')
    frequency = _kv(service_lines, 'SERVICE FREQUENCY')

    services = []
    for i, line in enumerate(service_lines):
        if 'SERVICES REQUESTED' in line.strip().upper():
            services = _collect_indented_bullet_lines(service_lines, i + 1)
            break

    # Notes section
    notes_lines = _extract_section_block(lines, 'NOTES')
    notes = '\n'.join(line.rstrip() for line in notes_lines).strip()

    canonical_payload = {
        'customer': {
            'full_name': name,
            'email': email,
            'phone': phone,
            'preferred_contact_method': contact_via,
            'best_time': best_time,
            'address': address_line1,
            'city': city,
            'postal_code': postal_code,
        },
        'service_location': {
            'street': address_line1,
            'city': city,
            'postal_code': postal_code,
        },
        'service_request': {
            'service_category': services,
            'service_context': property_type,
            'frequency': frequency,
            'notes': notes,
        },
        'source_metadata': {
            'source_page': form_source,
            'form_type': 'manual_paste',
        },
        'submitted_at': submitted_at,
    }

    lead_summary = _extract_intake_lead_summary(canonical_payload)

    return {
        'canonicalPayload': canonical_payload,
        'leadSummary': lead_summary,
        'rawText': raw_text,
        'parseWarnings': warnings,
    }


# ---------------------------------------------------------------------------
# Google service layer (DB-backed tokens)
# ---------------------------------------------------------------------------

# Config
GOOGLE_REDIRECT_URI = os.environ.get('GOOGLE_REDIRECT_URI', 'http://localhost:5002/api/auth/google/callback')
CRM_BASE_URL = os.environ.get('CRM_BASE_URL', '')

# Service singletons â€” populated after init_db() if google_services is importable
_g_cred_store     = None
_g_auth_manager   = None
_g_client_factory = None
_g_calendar       = None
_g_sheets         = None
_g_drive          = None
_g_gmail          = None
_GOOGLE_SERVICES_READY = False

if _GOOGLE_AVAILABLE:
    try:
        try:
            from google_services import (
                GoogleCredentialStore,
                GoogleAuthManager,
                GoogleApiClientFactory,
                CalendarService,
                SheetsService,
                DriveService,
                GmailSendService,
                format_all_day_event,
            )
        except ModuleNotFoundError as exc:
            if exc.name != 'google_services':
                raise
            from app.google_services import (
                GoogleCredentialStore,
                GoogleAuthManager,
                GoogleApiClientFactory,
                CalendarService,
                SheetsService,
                DriveService,
                GmailSendService,
                format_all_day_event,
            )
        _g_cred_store     = GoogleCredentialStore(CRM_DB_PATH, SECRET_KEY)
        _g_client_factory = GoogleApiClientFactory(_g_cred_store)
        _g_calendar       = CalendarService(_g_client_factory)
        _g_sheets         = SheetsService(_g_client_factory)
        _g_drive          = DriveService(_g_client_factory)
        _g_gmail          = GmailSendService(_g_client_factory, CRM_DB_PATH)
        _GOOGLE_SERVICES_READY = True
    except Exception as _gse:
        import warnings
        warnings.warn(f"Google service layer not available: {_gse}")


def _get_google_auth_manager():
    """Lazily initialise the auth manager (requires GOOGLE_CLIENT_ID env var)."""
    global _g_auth_manager
    if _g_auth_manager is not None:
        return _g_auth_manager
    if not _GOOGLE_SERVICES_READY or _g_cred_store is None:
        return None
    try:
        _g_auth_manager = GoogleAuthManager.from_env(_g_cred_store)
        return _g_auth_manager
    except Exception as exc:
        # GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not yet configured
        return None


PUBLIC_AVAILABILITY_TIMEZONE = 'America/Chicago'


class _AmericaChicagoFallback(tzinfo):
    """Fallback tzinfo for Windows environments without tzdata."""

    _std_offset = timedelta(hours=-6)
    _dst_offset = timedelta(hours=-5)

    @staticmethod
    def _first_sunday_on_or_after(value):
        days_to_go = (6 - value.weekday()) % 7
        if days_to_go:
            value += timedelta(days=days_to_go)
        return value

    @classmethod
    def _dst_start_end(cls, year):
        march_anchor = datetime(year, 3, 8, 2)
        november_anchor = datetime(year, 11, 1, 2)
        start = cls._first_sunday_on_or_after(march_anchor)
        end = cls._first_sunday_on_or_after(november_anchor)
        return start, end

    def dst(self, value):
        if value is None:
            return timedelta(0)
        naive = value.replace(tzinfo=None)
        start, end = self._dst_start_end(naive.year)
        return timedelta(hours=1) if start <= naive < end else timedelta(0)

    def utcoffset(self, value):
        return self._std_offset + self.dst(value)

    def tzname(self, value):
        return 'CDT' if self.dst(value) else 'CST'

    def fromutc(self, value):
        standard_time = (value + self._std_offset).replace(tzinfo=self)
        if self.dst(standard_time):
            return (value + self._dst_offset).replace(tzinfo=self)
        return standard_time


def _public_availability_zone():
    try:
        return ZoneInfo(PUBLIC_AVAILABILITY_TIMEZONE)
    except ZoneInfoNotFoundError:
        if PUBLIC_AVAILABILITY_TIMEZONE == 'America/Chicago':
            return _AmericaChicagoFallback()
        raise


def _internal_availability_token() -> str:
    return (os.environ.get('INTERNAL_AVAILABILITY_TOKEN') or '').strip()


def _parse_public_availability_request():
    start_str = (request.args.get('start') or '').strip()
    days_raw = (request.args.get('days') or '14').strip()
    try:
        days = int(days_raw)
    except ValueError as exc:
        raise ValueError('days') from exc
    days = max(1, min(days, 21))

    tz = _public_availability_zone()
    if start_str:
        try:
            start_date = date_cls.fromisoformat(start_str)
        except ValueError as exc:
            raise ValueError('start') from exc
    else:
        start_date = datetime.now(tz).date()

    return start_date, days, tz


def _parse_public_availability_month_summary_request():
    start_str = (request.args.get('start') or '').strip()
    months_raw = (request.args.get('months') or '12').strip()
    try:
        months = int(months_raw)
    except ValueError as exc:
        raise ValueError('months') from exc
    months = max(1, min(months, 12))

    tz = _public_availability_zone()
    if start_str:
        try:
            start_date = date_cls.fromisoformat(start_str)
        except ValueError as exc:
            raise ValueError('start') from exc
    else:
        start_date = datetime.now(tz).date()

    return start_date, months, tz


def _parse_busy_datetime(value):
    if not value:
        raise ValueError('missing datetime')
    normalized = str(value).replace('Z', '+00:00')
    return datetime.fromisoformat(normalized)


def _busy_overlaps(slot_start, slot_end, busy_start, busy_end):
    return busy_start < slot_end and busy_end > slot_start


def _slot_available_for_day(current_date, busy_intervals, tz):
    am_start = datetime.combine(current_date, dt_time(9, 0), tzinfo=tz)
    am_end = datetime.combine(current_date, dt_time(12, 0), tzinfo=tz)
    pm_start = datetime.combine(current_date, dt_time(12, 0), tzinfo=tz)
    pm_end = datetime.combine(current_date, dt_time(17, 0), tzinfo=tz)

    am_available = True
    pm_available = True
    for interval in busy_intervals:
        try:
            busy_start = _parse_busy_datetime(interval.get('start'))
            busy_end = _parse_busy_datetime(interval.get('end'))
        except Exception:
            continue
        if _busy_overlaps(am_start, am_end, busy_start, busy_end):
            am_available = False
        if _busy_overlaps(pm_start, pm_end, busy_start, busy_end):
            pm_available = False
        if not am_available and not pm_available:
            break

    display_value = current_date.strftime('%a, %b %d').replace(' 0', ' ')
    return {
        'date': current_date.isoformat(),
        'display': display_value,
        'slots': {
            'am': {'label': '9:00 AM', 'available': am_available},
            'pm': {'label': '12:00 PM', 'available': pm_available},
        },
    }


def _month_start_for(date_value):
    return date_value.replace(day=1)


def _add_months(date_value, months):
    total_month = (date_value.year * 12) + (date_value.month - 1) + months
    year = total_month // 12
    month = (total_month % 12) + 1
    return date_cls(year, month, 1)


def _month_end_for(date_value):
    return _add_months(_month_start_for(date_value), 1) - timedelta(days=1)


def _month_summary_windows(start_date, months):
    windows = []
    first_month = _month_start_for(start_date)
    for offset in range(months):
        month_anchor = _add_months(first_month, offset)
        window_start = start_date if offset == 0 else month_anchor
        window_end = _month_end_for(month_anchor)
        windows.append({
            'monthKey': f'{month_anchor.year:04d}-{month_anchor.month:02d}',
            'label': month_anchor.strftime('%B %Y'),
            'monthStart': window_start.isoformat(),
            'monthEnd': window_end.isoformat(),
            '_start_date': window_start,
            '_end_date': window_end,
        })
    return windows


def _first_available_weekday_in_window(start_date, end_date, busy_intervals, tz):
    current_date = start_date
    while current_date <= end_date:
        if current_date.weekday() < 5:
            day_payload = _slot_available_for_day(current_date, busy_intervals, tz)
            if day_payload['slots']['am']['available'] or day_payload['slots']['pm']['available']:
                return day_payload
        current_date += timedelta(days=1)
    return None


def _internal_availability_forbidden():
    return jsonify({'error': 'forbidden'}), 403


def _availability_unavailable_response():
    response = jsonify({
        'error': 'availability_unavailable',
        'availabilityReliable': False,
    })
    response.status_code = 503
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


# ---------------------------------------------------------------------------
# Static / auth routes
# ---------------------------------------------------------------------------


@app.route('/login', methods=['GET', 'POST'])
@limiter.limit("5 per minute")
def login():
    if session.get('crm_logged_in') and _current_user():
        return redirect('/')

    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')

        with get_db() as db:
            user = _get_user_by_username(db, username)
            if user is None and username.lower() == CRM_USERNAME.lower():
                now_iso = _utcnow_iso()
                db.execute(
                    'INSERT OR IGNORE INTO crm_users '
                    '(id,username,password_hash,role,display_name,employee_id,active,must_change_password,created_at,updated_at,last_login_at) '
                    'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                    (
                        _stable_user_id(CRM_USERNAME),
                        CRM_USERNAME,
                        CRM_PASSWORD_HASH or '',
                        CRM_ROLE_ADMIN,
                        CRM_USERNAME,
                        None,
                        1,
                        0,
                        now_iso,
                        now_iso,
                        '',
                    )
                )
                user = _get_user_by_username(db, username)

            if user and bool(user['active']) and _user_password_matches(user, password):
                now_iso = _utcnow_iso()
                db.execute(
                    'UPDATE crm_users SET last_login_at=?, updated_at=? WHERE id=?',
                    (now_iso, now_iso, user['id'])
                )
                user = _get_user_by_id(db, user['id'])
            else:
                user = None

        if user:
            session.clear()
            _apply_user_session(user)
            next_url = request.args.get('next') or request.form.get('next') or '/'
            return redirect(next_url)

        return redirect('/login?error=1')

    return send_from_directory(_WEB_DIR, 'login.html')


@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')


@app.route('/')
@login_required
def index():
    return send_from_directory(_WEB_DIR, 'crm.html')


@app.route('/robots.txt')
def robots():
    return send_from_directory(_WEB_DIR, 'robots.txt', mimetype='text/plain')


@app.route('/pricing.json')
def shared_pricing():
    return send_from_directory(_CONFIG_DIR, 'pricing.json', mimetype='application/json')


@app.route('/internal/public-availability', methods=['GET'])
def internal_public_availability():
    expected_token = _internal_availability_token()
    if not expected_token:
        app.logger.warning('Availability lookup failed')
        return _availability_unavailable_response()

    if request.remote_addr not in ('127.0.0.1', '::1'):
        return _internal_availability_forbidden()

    provided_token = request.headers.get('X-Internal-Availability-Token', '')
    if provided_token != expected_token:
        return _internal_availability_forbidden()

    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        app.logger.warning('Availability lookup failed')
        return _availability_unavailable_response()

    try:
        start_date, days, tz = _parse_public_availability_request()
        time_min = datetime.combine(start_date, dt_time.min, tzinfo=tz)
        time_max = datetime.combine(start_date + timedelta(days=days), dt_time.min, tzinfo=tz)
        busy_intervals = _g_calendar.get_busy_intervals(
            crm_user_id='admin',
            crm_username=CRM_USERNAME,
            time_min=time_min,
            time_max=time_max,
            timezone_name=PUBLIC_AVAILABILITY_TIMEZONE,
        )
        response_days = []
        for offset in range(days):
            current_date = start_date + timedelta(days=offset)
            response_days.append(_slot_available_for_day(current_date, busy_intervals, tz))
    except ValueError:
        return jsonify({'error': 'invalid_request'}), 400
    except Exception:
        app.logger.warning('Availability lookup failed')
        return _availability_unavailable_response()

    response = jsonify({
        'timezone': PUBLIC_AVAILABILITY_TIMEZONE,
        'availabilityReliable': True,
        'days': response_days,
    })
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


@app.route('/internal/public-availability/month-summary', methods=['GET'])
def internal_public_availability_month_summary():
    expected_token = _internal_availability_token()
    if not expected_token:
        app.logger.warning('Availability lookup failed')
        return _availability_unavailable_response()

    if request.remote_addr not in ('127.0.0.1', '::1'):
        return _internal_availability_forbidden()

    provided_token = request.headers.get('X-Internal-Availability-Token', '')
    if provided_token != expected_token:
        return _internal_availability_forbidden()

    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        app.logger.warning('Availability lookup failed')
        return _availability_unavailable_response()

    try:
        start_date, months, tz = _parse_public_availability_month_summary_request()
        month_windows = _month_summary_windows(start_date, months)
        overall_end = date_cls.fromisoformat(month_windows[-1]['monthEnd'])
        time_min = datetime.combine(start_date, dt_time.min, tzinfo=tz)
        time_max = datetime.combine(overall_end + timedelta(days=1), dt_time.min, tzinfo=tz)
        busy_intervals = _g_calendar.get_busy_intervals(
            crm_user_id='admin',
            crm_username=CRM_USERNAME,
            time_min=time_min,
            time_max=time_max,
            timezone_name=PUBLIC_AVAILABILITY_TIMEZONE,
        )

        response_months = []
        for window in month_windows:
            first_available = _first_available_weekday_in_window(
                window['_start_date'],
                window['_end_date'],
                busy_intervals,
                tz,
            )
            response_months.append({
                'monthKey': window['monthKey'],
                'label': window['label'],
                'monthStart': window['monthStart'],
                'monthEnd': window['monthEnd'],
                'firstAvailableDate': first_available['date'] if first_available else None,
                'firstAvailableDisplay': first_available['display'] if first_available else '',
                'hasAvailability': bool(first_available),
            })
    except ValueError:
        return jsonify({'error': 'invalid_request'}), 400
    except Exception:
        app.logger.warning('Availability lookup failed')
        return _availability_unavailable_response()

    response = jsonify({
        'timezone': PUBLIC_AVAILABILITY_TIMEZONE,
        'availabilityReliable': True,
        'months': response_months,
    })
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    return response


@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory(os.path.join(_APP_DIR, '..', 'static'), filename)


@app.route('/api/csrf-token')
@login_required
def get_csrf_token():
    if 'csrf_token' not in session:
        session['csrf_token'] = secrets.token_hex(32)
    return jsonify({'token': session['csrf_token']})


@app.route('/api/auth/me', methods=['GET'])
def auth_me():
    user = _current_user()
    payload = _auth_me_payload(user)
    if not user:
        return jsonify(payload), 401
    return jsonify(payload)


@app.route('/api/auth/change-password', methods=['POST'])
@login_required
def change_password():
    data = request.get_json(silent=True) or {}
    current_password = str(data.get('currentPassword') or data.get('current_password') or '')
    new_password = str(data.get('newPassword') or data.get('new_password') or '')

    if not current_password or not new_password:
        return jsonify({'error': 'currentPassword and newPassword are required'}), 400

    with get_db() as db:
        user = _get_user_by_id(db, _current_user_id())
        if not user or not bool(user['active']):
            session.clear()
            return jsonify({'error': 'Authentication required'}), 401
        if not _user_password_matches(user, current_password):
            return jsonify({'error': 'Current password is incorrect'}), 400
        now_iso = _utcnow_iso()
        db.execute(
            'UPDATE crm_users SET password_hash=?, must_change_password=0, updated_at=? WHERE id=?',
            (generate_password_hash(new_password), now_iso, user['id'])
        )
        updated_user = _get_user_by_id(db, user['id'])

    _apply_user_session(updated_user)
    g.current_user = updated_user
    g.current_permissions = build_permission_map(updated_user)
    return jsonify(_auth_me_payload(updated_user))


# ---------------------------------------------------------------------------
# Calendar API
# ---------------------------------------------------------------------------


@app.route('/api/calendar/events', methods=['GET'])
@login_required
@permission_required('canUseCalendar')
def get_events():
    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        return jsonify({'error': 'Not authenticated with Google Calendar'}), 401
    crm_user_id = _current_user_id()
    crm_username = _current_username()
    try:
        return jsonify(_g_calendar.list_upcoming(crm_user_id=crm_user_id, crm_username=crm_username))
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/calendar/events', methods=['POST'])
@login_required
@csrf_required
@permission_required('canUseCalendar')
def push_event():
    if not _GOOGLE_SERVICES_READY or not _g_client_factory:
        return jsonify({'error': 'Not authenticated with Google Calendar'}), 401
    crm_user_id = _current_user_id()
    crm_username = _current_username()
    svc = _g_client_factory.calendar(crm_user_id, crm_username=crm_username)
    if not svc:
        return jsonify({'error': 'Not authenticated with Google Calendar'}), 401
    data = request.get_json()
    event_body = {
        'summary': data.get('summary', 'Job'),
        'location': data.get('location', ''),
        'description': data.get('description', ''),
        **format_all_day_event(data['date']),
    }
    created = svc.events().insert(calendarId='primary', body=event_body).execute()
    return jsonify(created), 201


@app.route('/api/calendar/events/<event_id>', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canUseCalendar')
def delete_event(event_id):
    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        return jsonify({'error': 'Not authenticated with Google Calendar'}), 401
    crm_user_id = _current_user_id()
    crm_username = _current_username()
    try:
        _g_calendar.delete_event(crm_user_id=crm_user_id, crm_username=crm_username, event_id=event_id)
        return '', 204
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


# ---------------------------------------------------------------------------
# CRM API â€” Customers
# ---------------------------------------------------------------------------


@app.route('/api/v1/customers', methods=['GET'])
@login_required
def list_customers():
    include_deleted = _include_deleted_requested()
    query = 'SELECT * FROM customers'
    params = []
    if not include_deleted:
        query += " WHERE COALESCE(deleted_at, '')=''"
    query += ' ORDER BY name'
    with get_db() as db:
        rows = db.execute(query, params).fetchall()
    return jsonify([_customer(r) for r in rows])


@app.route('/api/v1/customers', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditCustomers')
def create_customer():
    data = request.get_json()
    with get_db() as db:
        row = _insert_customer_record(db, data)
    return jsonify(_customer(row)), 201


@app.route('/api/v1/customers/<cid>', methods=['PUT'])
@login_required
@csrf_required
@permission_required('canEditCustomers')
def update_customer(cid):
    data = request.get_json()
    with get_db() as db:
        existing = _select_customer_row(db, cid)
        if not existing:
            return jsonify({'error': 'Not found'}), 404
        db.execute(
            'UPDATE customers SET name=?,address=?,phone=?,status=?,notes=?,ltv=?,lat=?,lng=?,customer_number=?,email=?,city_state_zip=?,marker_emoji=? '
            'WHERE id=?',
            (data['name'], data.get('address', ''), data.get('phone', ''),
             data.get('status', 'Lead'), data.get('notes', ''), data.get('ltv', 0),
             data.get('lat'), data.get('lng'), data.get('customerNumber'),
             data.get('email', ''), data.get('cityStateZip', ''), data.get('markerEmoji', ''), cid)
        )
        row = _select_customer_row(db, cid)
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_customer(row))


@app.route('/api/v1/customers/<cid>', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canExecuteDelete')
def delete_customer(cid):
    with get_db() as db:
        try:
            _soft_delete_customer(db, cid, deleted_by_user_id=_current_user_id())
        except SoftDeleteError as exc:
            return jsonify({'error': str(exc), **exc.details}), exc.status_code
    return '', 204


# ---------------------------------------------------------------------------
# CRM API â€” Customer communications ledger
# ---------------------------------------------------------------------------


@app.route('/api/v1/customers/<cid>/contact-events', methods=['GET'])
@login_required
def list_customer_contact_events(cid):
    limit = min(int(request.args.get('limit', 50)), 200)
    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        rows = db.execute(
            'SELECT e.*, j.job_number FROM customer_contact_events e '
            'LEFT JOIN service_jobs j ON j.id = e.job_id '
            'WHERE e.customer_id=? ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?',
            (cid, limit)
        ).fetchall()
    return jsonify([_contact_event(row) for row in rows])


@app.route('/api/v1/contact-events', methods=['GET'])
@login_required
def list_contact_events():
    limit = min(int(request.args.get('limit', 50)), 200)
    customer_id = _trimmed_text(request.args.get('customer_id') or request.args.get('customerId'), 80)
    job_id = _trimmed_text(request.args.get('job_id') or request.args.get('jobId'), 80)
    has_job = str(request.args.get('has_job') or request.args.get('hasJob') or '').strip().lower()
    event_types = [value.strip() for value in str(request.args.get('event_types') or request.args.get('eventTypes') or '').split(',') if value.strip()]
    channels = [normalize_contact_channel(value) for value in str(request.args.get('channels') or '').split(',') if value.strip()]

    clauses = []
    params = []
    if customer_id:
        clauses.append('e.customer_id=?')
        params.append(customer_id)
    if job_id:
        clauses.append('e.job_id=?')
        params.append(job_id)
    if has_job in {'1', 'true', 'yes'}:
        clauses.append("COALESCE(e.job_id, '') <> ''")
    elif has_job in {'0', 'false', 'no'}:
        clauses.append("COALESCE(e.job_id, '') = ''")
    if event_types:
        clauses.append('e.event_type IN ({})'.format(','.join('?' for _ in event_types)))
        params.extend(event_types)
    if channels:
        clauses.append('e.channel IN ({})'.format(','.join('?' for _ in channels)))
        params.extend(channels)

    where_clause = ('WHERE ' + ' AND '.join(clauses)) if clauses else ''
    with get_db() as db:
        rows = db.execute(
            f'SELECT e.*, j.job_number, c.name AS customer_name FROM customer_contact_events e '
            'LEFT JOIN service_jobs j ON j.id = e.job_id '
            'LEFT JOIN customers c ON c.id = e.customer_id '
            f'{where_clause} ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?',
            [*params, limit]
        ).fetchall()
    return jsonify([_contact_event(row) for row in rows])


@app.route('/api/v1/contact-events', methods=['POST'])
@login_required
def create_contact_event():
    data = request.get_json(silent=True) or {}
    customer_id = _trimmed_text(data.get('customerId') or data.get('customer_id'), 80)
    job_id = _trimmed_text(data.get('jobId') or data.get('job_id'), 80)
    estimate_id = _trimmed_text(data.get('estimateId') or data.get('estimate_id'), 80)
    event_type = _trimmed_text(data.get('eventType') or data.get('event_type') or 'note', 120)

    if not event_type:
        return jsonify({'error': 'eventType is required'}), 400

    with get_db() as db:
        if customer_id:
            customer = _select_customer_row(db, customer_id)
            if not customer:
                return jsonify({'error': 'Customer not found'}), 404
        if job_id and not _select_service_job_row(db, job_id):
            return jsonify({'error': 'Job not found'}), 404
        row = _create_contact_event(
            db,
            customer_id=customer_id,
            job_id=job_id,
            estimate_id=estimate_id,
            channel=data.get('channel'),
            direction=data.get('direction'),
            event_type=event_type,
            subject=data.get('subject'),
            body_summary=data.get('bodySummary') or data.get('body_summary'),
            occurred_at=data.get('occurredAt') or data.get('occurred_at'),
            user_id=data.get('userId') or data.get('user_id'),
        )
    return jsonify(_contact_event(row)), 201


@app.route('/api/v1/customers/activity-summary', methods=['GET'])
@login_required
def list_customer_activity_summary():
    limit = min(int(request.args.get('limit', 500)), 1000)
    include_deleted = _include_deleted_requested()
    with get_db() as db:
        customers = db.execute(
            (
                'SELECT id, name, customer_number FROM customers '
                + ('' if include_deleted else "WHERE COALESCE(deleted_at, '')='' ")
                + 'ORDER BY name LIMIT ?'
            ),
            (limit,)
        ).fetchall()
        summaries = []
        for customer in customers:
            last_event = db.execute(
                'SELECT e.*, j.job_number, c.name AS customer_name FROM customer_contact_events e '
                'LEFT JOIN service_jobs j ON j.id = e.job_id '
                'LEFT JOIN customers c ON c.id = e.customer_id '
                'WHERE e.customer_id=? ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1',
                (customer['id'],)
            ).fetchone()
            next_followup = db.execute(
                'SELECT f.*, j.job_number, c.name AS customer_name FROM customer_followups f '
                'LEFT JOIN service_jobs j ON j.id = f.job_id '
                'LEFT JOIN customers c ON c.id = f.customer_id '
                'WHERE f.customer_id=? AND f.status=? '
                'ORDER BY CASE WHEN f.due_at="" THEN 1 ELSE 0 END, f.due_at, f.id DESC LIMIT 1',
                (customer['id'], 'open')
            ).fetchone()
            open_followup_count = db.execute(
                'SELECT COUNT(*) FROM customer_followups WHERE customer_id=? AND status=?',
                (customer['id'], 'open')
            ).fetchone()[0]
            summaries.append({
                'customerId': customer['id'],
                'customerName': customer['name'] or '',
                'customerNumber': customer['customer_number'],
                'lastContact': _contact_event(last_event) if last_event else None,
                'nextFollowup': _customer_followup(next_followup) if next_followup else None,
                'openFollowupCount': open_followup_count or 0,
            })
    return jsonify(summaries)


@app.route('/api/v1/customers/<cid>/followups', methods=['GET'])
@login_required
def list_customer_followups(cid):
    status_filter = normalize_followup_status(request.args.get('status', 'open'))
    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        rows = db.execute(
            'SELECT f.*, j.job_number FROM customer_followups f '
            'LEFT JOIN service_jobs j ON j.id = f.job_id '
            'WHERE f.customer_id=? AND f.status=? ORDER BY '
            'CASE WHEN f.due_at="" THEN 1 ELSE 0 END, f.due_at, f.id DESC',
            (cid, status_filter)
        ).fetchall()
    return jsonify([_customer_followup(row) for row in rows])


@app.route('/api/v1/customers/<cid>/followups', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditCustomers')
def create_customer_followup(cid):
    data = request.get_json() or {}
    due_at = _trimmed_text(data.get('dueAt') or data.get('due_at'), 64)
    if not due_at:
        return jsonify({'error': 'dueAt is required'}), 400

    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        row = _create_followup(
            db,
            customer_id=cid,
            job_id=data.get('jobId') or data.get('job_id'),
            estimate_id=data.get('estimateId') or data.get('estimate_id'),
            channel=data.get('channel'),
            subject=data.get('subject'),
            body_summary=data.get('bodySummary') or data.get('body_summary'),
            due_at=due_at,
            assigned_user_id=data.get('assignedUserId') or data.get('assigned_user_id'),
            status=data.get('status') or 'open',
        )
        _create_contact_event(
            db,
            customer_id=cid,
            job_id=data.get('jobId') or data.get('job_id'),
            estimate_id=data.get('estimateId') or data.get('estimate_id'),
            channel=data.get('channel') or 'manual',
            direction='system',
            event_type='followup_scheduled',
            subject=data.get('subject') or f"Follow-up scheduled for {customer['name']}",
            body_summary=f"Due {due_at}" + (f" | {data.get('bodySummary')}" if data.get('bodySummary') else ''),
        )
    return jsonify(_customer_followup(row)), 201


@app.route('/api/v1/customer-followups/<int:followup_id>', methods=['PATCH'])
@login_required
@csrf_required
@permission_required('canEditCustomers')
def update_customer_followup(followup_id):
    data = request.get_json() or {}
    with get_db() as db:
        existing = db.execute(
            'SELECT * FROM customer_followups WHERE id=?',
            (followup_id,)
        ).fetchone()
        if not existing:
            return jsonify({'error': 'Follow-up not found'}), 404
        if existing['customer_id'] and not _select_customer_row(db, existing['customer_id']):
            return jsonify({'error': 'Customer not found'}), 404

        status = normalize_followup_status(data.get('status') or existing['status'])
        due_at = _trimmed_text(data.get('dueAt') or data.get('due_at') or existing['due_at'], 64)
        channel = normalize_contact_channel(data.get('channel') or existing['channel'])
        subject = _trimmed_text(data.get('subject') or existing['subject'], 240)
        body_summary = _trimmed_text(data.get('bodySummary') or data.get('body_summary') or existing['body_summary'], 2000)
        assigned_user_id = _trimmed_text(data.get('assignedUserId') or data.get('assigned_user_id') or existing['assigned_user_id'], 120)
        completed_at = existing['completed_at'] or ''
        if status == 'completed' and not completed_at:
            completed_at = _utcnow_iso()
        elif status != 'completed':
            completed_at = ''

        db.execute(
            'UPDATE customer_followups SET channel=?,subject=?,body_summary=?,due_at=?,status=?,assigned_user_id=?,updated_at=?,completed_at=? '
            'WHERE id=?',
            (channel, subject, body_summary, due_at, status, assigned_user_id, _utcnow_iso(), completed_at, followup_id)
        )
        row = db.execute(
            'SELECT f.*, j.job_number FROM customer_followups f '
            'LEFT JOIN service_jobs j ON j.id = f.job_id WHERE f.id=?',
            (followup_id,)
        ).fetchone()
        if status == 'completed' and normalize_followup_status(existing['status']) != 'completed':
            _create_contact_event(
                db,
                customer_id=existing['customer_id'],
                job_id=existing['job_id'],
                estimate_id=existing['estimate_id'],
                channel=channel,
                direction='system',
                event_type='followup_completed',
                subject=subject or 'Follow-up completed',
                body_summary=body_summary or f"Completed follow-up due {existing['due_at']}",
            )
    return jsonify(_customer_followup(row))


@app.route('/api/v1/customers/<cid>/contact-preferences', methods=['GET'])
@login_required
def get_customer_contact_preferences(cid):
    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        row = db.execute(
            'SELECT * FROM customer_contact_preferences WHERE customer_id=?',
            (cid,)
        ).fetchone()
    payload = _customer_contact_preferences(row)
    payload['customerId'] = cid
    return jsonify(payload)


@app.route('/api/v1/customers/<cid>/contact-preferences', methods=['PUT'])
@login_required
@csrf_required
@permission_required('canEditCustomers')
def update_customer_contact_preferences(cid):
    data = request.get_json() or {}
    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        row = _upsert_contact_preferences(db, cid, data)
        _create_contact_event(
            db,
            customer_id=cid,
            channel='manual',
            direction='system',
            event_type='contact_preferences_updated',
            subject=f"Contact preferences updated for {customer['name']}",
            body_summary=(
                f"Preferred channel: {normalize_preferred_channel(data.get('preferredChannel')) or 'none'}"
                f" | DNC: {'yes' if bool(data.get('doNotContact', False)) else 'no'}"
            ),
        )
    return jsonify(_customer_contact_preferences(row))


# ---------------------------------------------------------------------------
# CRM API â€” Recurring Customer Jobs
# ---------------------------------------------------------------------------


@app.route('/api/v1/customers/<cid>/jobs', methods=['GET'])
@login_required
def list_customer_jobs(cid):
    include_deleted = _include_deleted_requested()
    with get_db() as db:
        customer_row = _select_customer_row(db, cid, include_deleted=include_deleted)
        if not customer_row:
            return jsonify({'error': 'Customer not found'}), 404
        rows = db.execute(
            (
                "SELECT * FROM customer_jobs WHERE customer_id=? "
                + ("" if include_deleted else "AND COALESCE(deleted_at, '')='' ")
                + "ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, service_label, created_at"
            ),
            (cid,)
        ).fetchall()
    return jsonify([_customer_job(r) for r in rows])


@app.route('/api/v1/customers/<cid>/jobs', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditRecurringJobs')
def create_customer_recurring_job(cid):
    data = request.get_json() or {}
    with get_db() as db:
        customer_row = _select_customer_row(db, cid)
        if not customer_row:
            return jsonify({'error': 'Customer not found'}), 404
        normalized = _normalize_customer_job_payload(data, customer_row)
        if not normalized['service_label']:
            return jsonify({'error': 'Service name is required'}), 400
        job_id = str(uuid.uuid4())
        db.execute(
            'INSERT INTO customer_jobs '
            '(id,customer_id,service_label,price,interval_months,week_slot,start_month,start_year,status,notes,selected_months_json,snapshot_json,created_at,updated_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (
                job_id,
                cid,
                normalized['service_label'],
                normalized['price'],
                normalized['interval_months'],
                normalized['week_slot'],
                normalized['start_month'],
                normalized['start_year'],
                normalized['status'],
                normalized['notes'],
                normalized['selected_months_json'],
                normalized['snapshot_json'],
                _utcnow_iso(),
                _utcnow_iso(),
            )
        )
        row = _select_customer_job_row(db, job_id)
        _ensure_customer_job_occurrences(db, row)
    return jsonify(_customer_job(row)), 201


@app.route('/api/v1/customers/<cid>/jobs/bulk', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditRecurringJobs')
def bulk_create_customer_recurring_jobs(cid):
    data = request.get_json() or {}
    raw_jobs = data.get('jobs')
    if not isinstance(raw_jobs, list) or len(raw_jobs) == 0:
        return jsonify({'error': 'At least one recurring job is required'}), 400

    with get_db() as db:
        customer_row = _select_customer_row(db, cid)
        if not customer_row:
            return jsonify({'error': 'Customer not found'}), 404

        prepared_jobs = []
        for index, raw_job in enumerate(raw_jobs, start=1):
            if not isinstance(raw_job, dict):
                return jsonify({'error': f'Job {index} is invalid'}), 400
            normalized = _normalize_customer_job_payload(raw_job, customer_row)
            if not normalized['service_label']:
                return jsonify({'error': f'Service name is required for job {index}'}), 400
            prepared_jobs.append((str(uuid.uuid4()), normalized))

        created_rows = []
        for job_id, normalized in prepared_jobs:
            db.execute(
                'INSERT INTO customer_jobs '
                '(id,customer_id,service_label,price,interval_months,week_slot,start_month,start_year,status,notes,selected_months_json,snapshot_json,created_at,updated_at) '
                'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                (
                    job_id,
                    cid,
                    normalized['service_label'],
                    normalized['price'],
                    normalized['interval_months'],
                    normalized['week_slot'],
                    normalized['start_month'],
                    normalized['start_year'],
                    normalized['status'],
                    normalized['notes'],
                    normalized['selected_months_json'],
                    normalized['snapshot_json'],
                    _utcnow_iso(),
                    _utcnow_iso(),
                )
            )
            row = _select_customer_job_row(db, job_id)
            _ensure_customer_job_occurrences(db, row)
            created_rows.append(_customer_job(row))

    return jsonify(created_rows), 201


@app.route('/api/v1/customer-jobs/<job_id>', methods=['PUT'])
@login_required
@csrf_required
@permission_required('canEditRecurringJobs')
def update_customer_recurring_job(job_id):
    data = request.get_json() or {}
    with get_db() as db:
        existing = _select_customer_job_row(db, job_id)
        if not existing:
            return jsonify({'error': 'Recurring job not found'}), 404
        customer_row = _select_customer_row(db, existing['customer_id'])
        if not customer_row:
            return jsonify({'error': 'Customer not found'}), 404
        normalized = _normalize_customer_job_payload(data, customer_row, existing=existing)
        if not normalized['service_label']:
            return jsonify({'error': 'Service name is required'}), 400
        db.execute(
            'UPDATE customer_jobs SET service_label=?,price=?,interval_months=?,week_slot=?,start_month=?,start_year=?,status=?,notes=?,selected_months_json=?,snapshot_json=?,updated_at=? '
            'WHERE id=?',
            (
                normalized['service_label'],
                normalized['price'],
                normalized['interval_months'],
                normalized['week_slot'],
                normalized['start_month'],
                normalized['start_year'],
                normalized['status'],
                normalized['notes'],
                normalized['selected_months_json'],
                normalized['snapshot_json'],
                _utcnow_iso(),
                job_id,
            )
        )
        row = _select_customer_job_row(db, job_id)
        _ensure_customer_job_occurrences(db, row)
    return jsonify(_customer_job(row))


@app.route('/api/v1/customer-jobs/<job_id>', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canExecuteDelete')
def delete_customer_recurring_job(job_id):
    with get_db() as db:
        try:
            _soft_delete_customer_job(db, job_id, deleted_by_user_id=_current_user_id())
        except SoftDeleteError as exc:
            return jsonify({'error': str(exc), **exc.details}), exc.status_code
    return '', 204


@app.route('/api/v1/customer-jobs/<job_id>/occurrences', methods=['GET'])
@login_required
def list_customer_job_occurrences(job_id):
    with get_db() as db:
        job_row = _select_customer_job_row(db, job_id)
        if not job_row:
            return jsonify({'error': 'Recurring job not found'}), 404
        _ensure_customer_job_occurrences(db, job_row)
        visible_templates = set(_customer_job_template_slots(job_row))
        rows = db.execute(
            'SELECT * FROM customer_job_occurrences WHERE job_id=? ORDER BY year, month, week_slot',
            (job_id,)
        ).fetchall()
    filtered_rows = [row for row in rows if (row['template_year'], row['template_month']) in visible_templates]
    return jsonify([_customer_job_occurrence(r) for r in filtered_rows])


@app.route('/api/v1/customer-jobs/<job_id>/occurrences/<occ_id>/push', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditRecurringJobs')
def push_customer_job_occurrence(job_id, occ_id):
    data = request.get_json() or {}
    with get_db() as db:
        customer_job = _select_customer_job_row(db, job_id)
        if not customer_job:
            return jsonify({'error': 'Recurring job not found'}), 404
        occurrence = db.execute(
            'SELECT * FROM customer_job_occurrences WHERE id=? AND job_id=?',
            (occ_id, job_id)
        ).fetchone()
        if not occurrence:
            return jsonify({'error': 'Occurrence not found'}), 404
        year = _customer_job_int(data.get('year'), occurrence['year'], minimum=2000, maximum=2100)
        month = _customer_job_int(data.get('month'), occurrence['month'], minimum=1, maximum=12)
        week_slot = _customer_job_int(data.get('week_slot'), occurrence['week_slot'], minimum=1, maximum=5)
        db.execute(
            'UPDATE customer_job_occurrences SET year=?,month=?,week_slot=?,pushed=1,updated_at=? WHERE id=?',
            (
                year,
                month,
                week_slot,
                _utcnow_iso(),
                occ_id,
            )
        )
        updated = db.execute('SELECT * FROM customer_job_occurrences WHERE id=?', (occ_id,)).fetchone()
        if customer_job:
            _create_contact_event(
                db,
                customer_id=customer_job['customer_id'],
                estimate_id=occ_id,
                channel='manual',
                direction='system',
                event_type='occurrence_pushed',
                subject=f"Occurrence pushed for {customer_job['service_label'] or 'recurring service'}",
                body_summary=f"Moved to {month}/{year} week {week_slot}.",
            )
    return jsonify(_customer_job_occurrence(updated))


@app.route('/api/v1/customer-jobs/<job_id>/occurrences/<occ_id>/prepare-invoice', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditRecurringJobs')
def prepare_customer_job_occurrence_invoice(job_id, occ_id):
    with get_db() as db:
        customer_job = _select_customer_job_row(db, job_id)
        if not customer_job:
            return jsonify({'error': 'Recurring job not found'}), 404
        occurrence = db.execute(
            'SELECT * FROM customer_job_occurrences WHERE id=? AND job_id=?',
            (occ_id, job_id)
        ).fetchone()
        if not occurrence:
            return jsonify({'error': 'Occurrence not found'}), 404
        db.execute(
            'UPDATE customer_job_occurrences SET invoice_prepared=1,status=?,updated_at=? WHERE id=?',
            ('invoice-ready', _utcnow_iso(), occ_id)
        )
        updated = db.execute('SELECT * FROM customer_job_occurrences WHERE id=?', (occ_id,)).fetchone()
        if not bool(occurrence['invoice_prepared']) and customer_job:
            _create_contact_event(
                db,
                customer_id=customer_job['customer_id'],
                estimate_id=occ_id,
                channel='invoice',
                direction='system',
                event_type='invoice_prepared',
                subject=f"Invoice prepared for {customer_job['service_label'] or 'recurring service'}",
                body_summary=f"Recurring occurrence {updated['month']}/{updated['year']} was marked invoice-ready.",
            )
    return jsonify(_customer_job_occurrence(updated))


# ---------------------------------------------------------------------------
# CRM API â€” Service Jobs
# ---------------------------------------------------------------------------


@app.route('/api/v1/jobs', methods=['GET'])
@login_required
def list_jobs():
    include_deleted = _include_deleted_requested()
    query = 'SELECT * FROM service_jobs'
    params = []
    if not include_deleted:
        query += " WHERE COALESCE(deleted_at, '')=''"
    query += ' ORDER BY job_number'
    with get_db() as db:
        rows = db.execute(query, params).fetchall()
    return jsonify([_job(r) for r in rows])


@app.route('/api/v1/jobs', methods=['POST'])
@login_required
@csrf_required
@permission_required('canEditJobs')
def create_job():
    data = request.get_json()
    with get_db() as db:
        customer_id = _trimmed_text((data or {}).get('customerId'), 80)
        if customer_id and not _select_customer_row(db, customer_id):
            return jsonify({'error': 'Customer not found'}), 404
        row = _insert_service_job_record(db, data)
        if normalize_invoice_sent(data.get('invoiceSent')):
            _create_contact_event(
                db,
                customer_id=row['customer_id'],
                job_id=row['id'],
                channel='invoice',
                direction='system',
                event_type='invoice_flagged_sent',
                subject=f"Invoice marked sent for job #{row['job_number'] or ''}".strip(),
                body_summary='Invoice status was marked sent when the job was created.',
            )
    return jsonify(_job(row)), 201


@app.route('/api/v1/jobs/<jid>', methods=['PUT'])
@login_required
@csrf_required
@permission_required('canEditJobs')
def update_job(jid):
    data = request.get_json()
    service_category = normalize_service_category(
        data.get('serviceCategory') or data.get('service_category')
    )
    frequency = normalize_frequency(data.get('frequency'))
    payment_status = normalize_payment_status(data.get('paymentStatus'))
    invoice_sent = normalize_invoice_sent(data.get('invoiceSent'))
    calendar_sync_needed = False
    row_data = None
    customer_data = None
    with get_db() as db:
        existing = _select_service_job_row(db, jid)
        if not existing:
            return jsonify({'error': 'Not found'}), 404
        target_customer_id = _trimmed_text(data.get('customerId'), 80)
        if target_customer_id and not _select_customer_row(db, target_customer_id):
            return jsonify({'error': 'Customer not found'}), 404
        db.execute(
            'UPDATE service_jobs SET customer_id=?,address=?,service_type=?,service_category=?,'
            'frequency=?,quoted_amount=?,actual_amount=?,overhead_spent=?,status=?,payment_status=?,invoice_sent=?,'
            'scheduled_date=?,assigned_employee_ids=?,notes=?,gcal_event_id=? WHERE id=?',
            (data.get('customerId', ''), data.get('address', ''), data.get('serviceType', ''),
             service_category, frequency, data.get('quotedAmount', 0), data.get('actualAmount', 0),
             data.get('overheadSpent', 0), data.get('status', 'Scheduled'), payment_status, invoice_sent,
             data.get('scheduledDate', ''),
             json.dumps(data.get('assignedEmployeeIds', [])), data.get('notes', ''),
             data.get('gcalEventId', ''), jid)
        )
        row = _select_service_job_row(db, jid)
        customer_row = _get_job_calendar_customer_row(db, row['customer_id'])
        calendar_sync_needed = bool(row['gcal_event_id']) and _job_calendar_fields_changed(existing, row)
        if (existing['status'] or '') != 'Completed' and (row['status'] or '') == 'Completed':
            _create_contact_event(
                db,
                customer_id=row['customer_id'],
                job_id=row['id'],
                channel='manual',
                direction='system',
                event_type='job_completed',
                subject=f"Job #{row['job_number'] or ''} marked completed".strip(),
                body_summary=f"{row['service_type'] or 'Service job'} completed.",
            )
        if normalize_payment_status(existing['payment_status']) != 'Paid' and normalize_payment_status(row['payment_status']) == 'Paid':
            _create_contact_event(
                db,
                customer_id=row['customer_id'],
                job_id=row['id'],
                channel='invoice',
                direction='system',
                event_type='payment_marked_paid',
                subject=f"Job #{row['job_number'] or ''} marked paid".strip(),
                body_summary=f"Payment status changed to Paid for {row['service_type'] or 'service job'}.",
            )
        if not normalize_invoice_sent(existing['invoice_sent']) and normalize_invoice_sent(row['invoice_sent']):
            _create_contact_event(
                db,
                customer_id=row['customer_id'],
                job_id=row['id'],
                channel='invoice',
                direction='system',
                event_type='invoice_flagged_sent',
                subject=f"Invoice marked sent for job #{row['job_number'] or ''}".strip(),
                body_summary=f"Invoice sent flag changed to true. Payment status: {normalize_payment_status(row['payment_status'])}.",
            )
        row_data = dict(row)
        customer_data = dict(customer_row) if customer_row else None

    response = _job(row_data)
    if calendar_sync_needed:
        calendar_sync_status, calendar_sync_warning = _sync_linked_job_calendar_event(row_data, customer_data)
        if calendar_sync_status:
            response['calendarSyncStatus'] = calendar_sync_status
        if calendar_sync_warning:
            response['calendarSyncWarning'] = calendar_sync_warning
    return jsonify(response)


@app.route('/api/v1/jobs/<jid>', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canExecuteDelete')
def delete_job(jid):
    with get_db() as db:
        try:
            _soft_delete_service_job(db, jid, deleted_by_user_id=_current_user_id())
        except SoftDeleteError as exc:
            return jsonify({'error': str(exc), **exc.details}), exc.status_code
    return '', 204


# ---------------------------------------------------------------------------
# CRM API â€” Employees
# ---------------------------------------------------------------------------


@app.route('/api/v1/employees', methods=['GET'])
@login_required
@permission_required('canManageEmployees')
def list_employees():
    with get_db() as db:
        rows = db.execute('SELECT * FROM employees').fetchall()
    return jsonify([_employee(r) for r in rows])


@app.route('/api/v1/employees/directory', methods=['GET'])
@login_required
@permission_required('canViewEmployeeDirectory')
def list_employee_directory():
    with get_db() as db:
        rows = db.execute('SELECT id, name, team, active FROM employees ORDER BY name').fetchall()
    return jsonify([_employee_directory_entry(row) for row in rows])


@app.route('/api/v1/employees', methods=['POST'])
@login_required
@csrf_required
@permission_required('canManageEmployees')
def create_employee():
    data = request.get_json()
    eid = str(uuid.uuid4())
    with get_db() as db:
        db.execute(
            'INSERT INTO employees '
            '(id,name,team,active,included_in_labor,gets_admin_override,'
            'gets_marketing_override,labor_weight,admin_weight,marketing_weight) '
            'VALUES (?,?,?,?,?,?,?,?,?,?)',
            (eid, data['name'], data.get('team', 'labor'), int(data.get('active', True)),
             int(data.get('includedInLabor', False)), int(data.get('getsAdminOverride', False)),
             int(data.get('getsMarketingOverride', False)), data.get('laborWeight', 1),
             data.get('adminWeight', 1), data.get('marketingWeight', 1))
        )
        row = db.execute('SELECT * FROM employees WHERE id=?', (eid,)).fetchone()
    return jsonify(_employee(row)), 201


@app.route('/api/v1/employees/<eid>', methods=['PUT'])
@login_required
@csrf_required
@permission_required('canManageEmployees')
def update_employee(eid):
    data = request.get_json()
    with get_db() as db:
        db.execute(
            'UPDATE employees SET name=?,team=?,active=?,included_in_labor=?,gets_admin_override=?,'
            'gets_marketing_override=?,labor_weight=?,admin_weight=?,marketing_weight=? WHERE id=?',
            (data['name'], data.get('team', 'labor'), int(data.get('active', True)),
             int(data.get('includedInLabor', False)), int(data.get('getsAdminOverride', False)),
             int(data.get('getsMarketingOverride', False)), data.get('laborWeight', 1),
             data.get('adminWeight', 1), data.get('marketingWeight', 1), eid)
        )
        row = db.execute('SELECT * FROM employees WHERE id=?', (eid,)).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_employee(row))


@app.route('/api/v1/employees/<eid>', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canManageEmployees')
def delete_employee(eid):
    with get_db() as db:
        db.execute('DELETE FROM employees WHERE id=?', (eid,))
    return '', 204


# ---------------------------------------------------------------------------
# CRM API - Shared settings
# ---------------------------------------------------------------------------


@app.route('/api/v1/settings/travel-routing', methods=['GET'])
@login_required
def get_travel_routing_settings():
    with get_db() as db:
        return jsonify(_get_travel_routing_settings(db))


@app.route('/api/v1/settings/travel-routing', methods=['PUT'])
@login_required
@csrf_required
def update_travel_routing_settings():
    if not _is_admin_user():
        return jsonify({'error': 'Permission denied'}), 403

    data = request.get_json(silent=True) or {}
    try:
        payload = _normalize_travel_routing_settings(data, strict=True)
    except ValueError as exc:
        return jsonify({'error': str(exc)}), 400

    updated_at = datetime.now(timezone.utc).isoformat()
    with get_db() as db:
        db.execute(
            'INSERT INTO crm_settings (setting_key, setting_value, updated_at) '
            'VALUES (?, ?, ?) '
            'ON CONFLICT(setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_at=excluded.updated_at',
            ('travel_routing', json.dumps(payload), updated_at)
        )
        saved = _get_travel_routing_settings(db)
    return jsonify(saved)


# ---------------------------------------------------------------------------
# CRM API - Internal admin messaging
# ---------------------------------------------------------------------------


@app.route('/api/v1/admin-threads', methods=['GET'])
@login_required
@permission_required('canUseAdminMessenger')
def list_admin_threads():
    current_user = _current_user()
    with get_db() as db:
        if _normalize_user_role(current_user['role'], CRM_ROLE_EMPLOYEE) == CRM_ROLE_ADMIN:
            rows = db.execute(
                'SELECT * FROM admin_threads ORDER BY updated_at DESC, id DESC'
            ).fetchall()
        else:
            rows = db.execute(
                'SELECT t.* FROM admin_threads t '
                'JOIN admin_thread_participants p ON p.thread_id = t.id '
                'WHERE p.user_id=? ORDER BY t.updated_at DESC, t.id DESC',
                (current_user['id'],)
            ).fetchall()
        payload = [_serialize_admin_thread_summary(db, row) for row in rows]
    return jsonify(payload)


@app.route('/api/v1/admin-threads', methods=['POST'])
@login_required
@csrf_required
@permission_required('canUseAdminMessenger')
def create_admin_thread():
    data = request.get_json(silent=True) or {}
    thread_type = _normalize_thread_type(data.get('threadType') or data.get('thread_type'))
    initial_message = _trimmed_text(data.get('initialMessage') or data.get('initial_message'), 5000)
    subject = _trimmed_text(data.get('subject'), 240)
    participant_user_ids = _normalize_user_id_list(
        data.get('participantUserIds') or data.get('participant_user_ids') or []
    )

    if not initial_message:
        return jsonify({'error': 'initialMessage is required'}), 400
    if thread_type == THREAD_TYPE_DELETION_REQUEST and not _has_permission('canRequestDelete'):
        return jsonify({'error': 'Permission denied', 'requiredPermission': 'canRequestDelete'}), 403
    if participant_user_ids and not _has_permission('canExecuteDelete'):
        return jsonify({'error': 'Permission denied', 'requiredPermission': 'canExecuteDelete'}), 403

    with get_db() as db:
        references, reference_error = _resolve_thread_references(
            db,
            customer_id=data.get('customerId') or data.get('customer_id'),
            service_job_id=data.get('serviceJobId') or data.get('service_job_id'),
            customer_job_id=data.get('customerJobId') or data.get('customer_job_id'),
            target_kind=data.get('targetKind') or data.get('target_kind'),
            target_id=data.get('targetId') or data.get('target_id'),
        )
        if reference_error:
            message, status_code = reference_error
            return jsonify({'error': message}), status_code

        if thread_type == THREAD_TYPE_DELETION_REQUEST and not references['target_kind']:
            inferred = []
            if references['customer_id']:
                inferred.append((DELETE_TARGET_CUSTOMER, references['customer_id']))
            if references['service_job_id']:
                inferred.append((DELETE_TARGET_SERVICE_JOB, references['service_job_id']))
            if references['customer_job_id']:
                inferred.append((DELETE_TARGET_CUSTOMER_JOB, references['customer_job_id']))
            if len(inferred) == 1:
                references['target_kind'], references['target_id'] = inferred[0]
            else:
                return jsonify({'error': 'Deletion requests require targetKind and targetId'}), 400

        if participant_user_ids:
            participant_rows = _fetch_crm_users_by_ids(db, participant_user_ids)
            if len(participant_rows) != len(participant_user_ids):
                return jsonify({'error': 'One or more participantUserIds are invalid'}), 400

        if not subject and thread_type == THREAD_TYPE_DELETION_REQUEST:
            target_label = references['target_kind'].replace('_', ' ') if references['target_kind'] else 'record'
            subject = f'Deletion request: {target_label}'

        created_at = _utcnow_iso()
        db.execute(
            'INSERT INTO admin_threads '
            '(thread_type, subject, status, created_by_user_id, customer_id, service_job_id, customer_job_id, '
            'target_kind, target_id, created_at, updated_at, resolved_at, resolved_by_user_id) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            (
                thread_type,
                subject,
                THREAD_STATUS_OPEN,
                _current_user_id(),
                references['customer_id'],
                references['service_job_id'],
                references['customer_job_id'],
                references['target_kind'],
                references['target_id'],
                created_at,
                created_at,
                '',
                '',
            )
        )
        thread_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]
        _add_thread_participants(
            db,
            thread_id,
            [_current_user_id(), *participant_user_ids],
            added_by_user_id=_current_user_id(),
        )
        _create_admin_message(
            db,
            thread_id,
            _current_user_id(),
            initial_message,
            message_type=ADMIN_THREAD_MESSAGE_TYPE_USER,
        )
        row = db.execute('SELECT * FROM admin_threads WHERE id=?', (thread_id,)).fetchone()
        payload = _serialize_admin_thread_detail(db, row)
    return jsonify(payload), 201


@app.route('/api/v1/admin-threads/<int:thread_id>', methods=['GET'])
@login_required
@permission_required('canUseAdminMessenger')
def get_admin_thread(thread_id):
    with get_db() as db:
        row = _get_visible_admin_thread(db, thread_id)
        if not row:
            return jsonify({'error': 'Not found'}), 404
        payload = _serialize_admin_thread_detail(db, row)
    return jsonify(payload)


@app.route('/api/v1/admin-threads/<int:thread_id>/messages', methods=['POST'])
@login_required
@csrf_required
@permission_required('canUseAdminMessenger')
def add_admin_thread_message(thread_id):
    data = request.get_json(silent=True) or {}
    message = _trimmed_text(data.get('message'), 5000)
    if not message:
        return jsonify({'error': 'message is required'}), 400

    with get_db() as db:
        row = _get_visible_admin_thread(db, thread_id)
        if not row:
            return jsonify({'error': 'Not found'}), 404
        _add_thread_participants(db, thread_id, [_current_user_id()], added_by_user_id=_current_user_id())
        _create_admin_message(
            db,
            thread_id,
            _current_user_id(),
            message,
            message_type=ADMIN_THREAD_MESSAGE_TYPE_USER,
        )
        updated = db.execute('SELECT * FROM admin_threads WHERE id=?', (thread_id,)).fetchone()
        payload = _serialize_admin_thread_detail(db, updated)
    return jsonify(payload), 201


@app.route('/api/v1/admin-threads/<int:thread_id>', methods=['PATCH'])
@login_required
@csrf_required
@permission_required('canUseAdminMessenger')
def update_admin_thread(thread_id):
    data = request.get_json(silent=True) or {}
    status_value = data.get('status')
    add_participant_user_ids = _normalize_user_id_list(
        data.get('addParticipantUserIds') or data.get('add_participant_user_ids') or []
    )

    if status_value is None and not add_participant_user_ids:
        return jsonify({'error': 'No valid thread updates provided'}), 400
    if not _has_permission('canExecuteDelete'):
        return jsonify({'error': 'Permission denied', 'requiredPermission': 'canExecuteDelete'}), 403

    with get_db() as db:
        row = _get_visible_admin_thread(db, thread_id)
        if not row:
            return jsonify({'error': 'Not found'}), 404

        if add_participant_user_ids:
            participant_rows = _fetch_crm_users_by_ids(db, add_participant_user_ids)
            if len(participant_rows) != len(add_participant_user_ids):
                return jsonify({'error': 'One or more addParticipantUserIds are invalid'}), 400
            _add_thread_participants(
                db,
                thread_id,
                add_participant_user_ids,
                added_by_user_id=_current_user_id(),
            )

        if status_value is not None:
            new_status = _normalize_thread_status(status_value, default='')
            if not new_status:
                return jsonify({'error': 'Invalid status'}), 400
            if new_status == THREAD_STATUS_EXECUTED:
                return jsonify({'error': 'Use execute-delete to mark a thread executed'}), 400
            resolved_at = ''
            resolved_by_user_id = ''
            if new_status in {THREAD_STATUS_RESOLVED, THREAD_STATUS_REJECTED}:
                resolved_at = _utcnow_iso()
                resolved_by_user_id = _current_user_id()
            db.execute(
                'UPDATE admin_threads SET status=?, resolved_at=?, resolved_by_user_id=?, updated_at=? WHERE id=?',
                (new_status, resolved_at, resolved_by_user_id, _utcnow_iso(), thread_id)
            )

        updated = db.execute('SELECT * FROM admin_threads WHERE id=?', (thread_id,)).fetchone()
        payload = _serialize_admin_thread_detail(db, updated)
    return jsonify(payload)


@app.route('/api/v1/admin-threads/<int:thread_id>/execute-delete', methods=['POST'])
@login_required
@csrf_required
@permission_required('canExecuteDelete')
def execute_admin_thread_delete(thread_id):
    with get_db() as db:
        row = _get_visible_admin_thread(db, thread_id)
        if not row:
            return jsonify({'error': 'Not found'}), 404
        if (row['thread_type'] or THREAD_TYPE_MESSAGE) != THREAD_TYPE_DELETION_REQUEST:
            return jsonify({'error': 'Only deletion_request threads can execute delete'}), 400
        if (row['status'] or '') == THREAD_STATUS_EXECUTED:
            return jsonify({'error': 'Delete already executed'}), 409

        target_kind = row['target_kind'] or ''
        target_id = row['target_id'] or ''
        if not target_kind or not target_id:
            return jsonify({'error': 'Deletion request is missing target metadata'}), 400

        try:
            _soft_delete_target(
                db,
                target_kind,
                target_id,
                deleted_by_user_id=_current_user_id(),
                delete_thread_id=thread_id,
            )
        except SoftDeleteError as exc:
            return jsonify({'error': str(exc), **exc.details}), exc.status_code

        _add_thread_participants(db, thread_id, [_current_user_id()], added_by_user_id=_current_user_id())
        _create_admin_message(
            db,
            thread_id,
            _current_user_id(),
            f'Executed soft delete for {target_kind} {target_id}.',
            message_type=ADMIN_THREAD_MESSAGE_TYPE_SYSTEM,
        )
        resolved_at = _utcnow_iso()
        db.execute(
            'UPDATE admin_threads SET status=?, resolved_at=?, resolved_by_user_id=?, updated_at=? WHERE id=?',
            (THREAD_STATUS_EXECUTED, resolved_at, _current_user_id(), resolved_at, thread_id)
        )
        updated = db.execute('SELECT * FROM admin_threads WHERE id=?', (thread_id,)).fetchone()
        payload = _serialize_admin_thread_detail(db, updated)
    return jsonify(payload)


# ---------------------------------------------------------------------------
# CRM API â€” Intake imports (website lead review)
# ---------------------------------------------------------------------------


@app.route('/api/v1/intake-imports', methods=['GET'])
@login_required
@permission_required('canViewIntake')
def list_intake_imports():
    """
    GET /api/v1/intake-imports
    Query params: intake_status, form_type, customer_match_status, limit (max 200), offset
    Returns imported website leads in reverse chronological order.
    """
    status_filter = request.args.get('intake_status', '')
    form_filter = request.args.get('form_type', '')
    match_filter = request.args.get('customer_match_status', '')
    limit = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))

    clauses, params = [], []
    if status_filter:
        clauses.append('intake_status = ?')
        params.append(status_filter)
    if form_filter:
        clauses.append('form_type = ?')
        params.append(form_filter)
    if match_filter:
        clauses.append('customer_match_status = ?')
        params.append(match_filter)

    where = ('WHERE ' + ' AND '.join(clauses)) if clauses else ''
    params.extend([limit, offset])

    with get_db() as db:
        rows = db.execute(
            f'SELECT * FROM crm_intake_imports {where} ORDER BY imported_at DESC LIMIT ? OFFSET ?',
            params
        ).fetchall()
        total = db.execute(
            f'SELECT COUNT(*) FROM crm_intake_imports {where}',
            params[:-2] if params[:-2] else []
        ).fetchone()[0]

    return jsonify({
        'total': total,
        'count': len(rows),
        'imports': [_intake_import(r) for r in rows],
    })


@app.route('/api/v1/intake-imports/manual', methods=['POST'])
@login_required
@permission_required('canManageIntake')
def create_manual_intake_import():
    data = request.get_json(force=True, silent=True) or {}
    raw_text = str(data.get('rawText') or '').strip()
    if not raw_text:
        return jsonify({'error': 'rawText is required'}), 400

    form_source_override = _clean_text(data.get('formSource') or '')
    submitted_at_override = _clean_text(data.get('submittedAt') or '')

    parsed = _parse_manual_estimate_paste(raw_text)
    canonical = parsed['canonicalPayload']
    lead = parsed['leadSummary']
    warnings = parsed['parseWarnings']

    if form_source_override:
        canonical['source_metadata']['source_page'] = form_source_override
        lead['sourcePage'] = form_source_override
    if submitted_at_override:
        canonical['submitted_at'] = submitted_at_override
        lead['submittedAt'] = submitted_at_override

    source_page = _clean_text(canonical['source_metadata'].get('source_page') or 'manual_paste')
    submitted_at_val = _clean_text(canonical.get('submitted_at') or '')
    now_iso = datetime.utcnow().strftime('%Y-%m-%dT%H:%M:%SZ')

    # Unique negative website_submission_id avoids UNIQUE constraint collisions
    # with real positive submission IDs from the website webhook.
    wsi = -(int.from_bytes(os.urandom(6), 'big') + 1)
    submission_uuid_val = str(uuid.uuid4())
    payload_json = json.dumps(canonical)

    with get_db() as db:
        cursor = db.execute(
            '''INSERT INTO crm_intake_imports
               (website_submission_id, submission_uuid, imported_at,
                validation_status, customer_match_status, intake_status,
                source_page, form_type, submitted_at, raw_payload_json, created_by_importer)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
            (
                wsi,
                submission_uuid_val,
                now_iso,
                'valid',
                'unmatched',
                'new',
                source_page,
                'manual_paste',
                submitted_at_val or now_iso,
                payload_json,
                _current_user_id(),
            )
        )
        new_id = cursor.lastrowid
        row = db.execute('SELECT * FROM crm_intake_imports WHERE id=?', (new_id,)).fetchone()

    return jsonify({
        'intakeImport': _intake_import(row),
        'leadSummary': lead,
        'parseWarnings': warnings,
    }), 201


@app.route('/api/v1/intake-imports/<int:import_id>', methods=['GET'])
@login_required
@permission_required('canViewIntake')
def get_intake_import(import_id):
    with get_db() as db:
        row = db.execute(
            'SELECT * FROM crm_intake_imports WHERE id=?', (import_id,)
        ).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_intake_import(row))


@app.route('/api/v1/intake-imports/<int:import_id>/match-candidates', methods=['GET'])
@login_required
@permission_required('canViewIntake')
def get_intake_import_match_candidates(import_id):
    with get_db() as db:
        row = db.execute(
            'SELECT * FROM crm_intake_imports WHERE id=?', (import_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        payload = _parse_intake_payload_json(row['raw_payload_json'])
        lead = _extract_intake_lead_summary(payload, row=row)
        candidates = _build_intake_customer_candidates(db, lead)
        computed_status = _intake_match_status_from_candidates(candidates)
        recommended_customer_id = (
            row['converted_customer_id']
            or row['matched_customer_id']
            or (candidates[0]['id'] if candidates else '')
        )

    return jsonify({
        'intakeImport': _intake_import(row),
        'leadSummary': lead,
        'candidates': candidates,
        'computedMatchStatus': computed_status,
        'recommendedCustomerId': recommended_customer_id,
        'blockNewCustomer': any(candidate['confidence'] == 'exact' for candidate in candidates),
    })


@app.route('/api/v1/intake-imports/<int:import_id>/convert', methods=['POST'])
@login_required
@csrf_required
@permission_required('canManageIntake')
def convert_intake_import(import_id):
    data = request.get_json() or {}
    existing_customer_id = str(data.get('existingCustomerId') or '').strip()
    action = str(
        data.get('action')
        or ('link_existing' if existing_customer_id else 'create_new')
    ).strip().lower()
    create_estimate_job = bool(data.get('createEstimateJob'))
    force_new_customer = bool(data.get('forceNewCustomer'))

    if action not in ('create_new', 'link_existing'):
        return jsonify({'error': 'Invalid conversion action'}), 400
    if action == 'link_existing' and not existing_customer_id:
        return jsonify({'error': 'existingCustomerId is required when linking'}), 400

    with get_db() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute(
            'SELECT * FROM crm_intake_imports WHERE id=?', (import_id,)
        ).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404

        payload = _parse_intake_payload_json(row['raw_payload_json'])
        lead = _extract_intake_lead_summary(payload, row=row)
        candidates = _build_intake_customer_candidates(db, lead)
        computed_status = _intake_match_status_from_candidates(candidates)

        if row['converted_at']:
            customer_row = None
            job_row = None
            if row['converted_customer_id']:
                customer_row = _select_customer_row(
                    db,
                    row['converted_customer_id'],
                    include_deleted=True,
                )
            if row['converted_job_id']:
                job_row = _select_service_job_row(
                    db,
                    row['converted_job_id'],
                    include_deleted=True,
                )
            return jsonify({
                'alreadyConverted': True,
                'intakeImport': _intake_import(row),
                'leadSummary': lead,
                'candidates': candidates,
                'computedMatchStatus': computed_status,
                'customer': _customer(customer_row) if customer_row else None,
                'serviceJob': _job(job_row) if job_row else None,
            })

        exact_candidates = [candidate for candidate in candidates if candidate['confidence'] == 'exact']
        customer_row = None
        customer_match_status = 'unmatched'

        if action == 'link_existing':
            customer_row = _select_customer_row(db, existing_customer_id)
            if not customer_row:
                return jsonify({'error': 'Customer not found'}), 404
            customer_match_status = 'matched'
        else:
            if exact_candidates and not force_new_customer:
                return jsonify({
                    'error': 'Potential duplicate customer found. Link the existing customer or force a new lead.',
                    'candidates': candidates,
                    'computedMatchStatus': computed_status,
                    'leadSummary': lead,
                }), 409

            customer_payload = _build_intake_customer_payload(row, lead)
            overrides = data.get('customerOverrides')
            if isinstance(overrides, dict):
                for key in ('name', 'address', 'phone', 'email', 'cityStateZip', 'notes', 'status'):
                    if overrides.get(key) is not None:
                        customer_payload[key] = str(overrides.get(key)).strip()
            customer_row = _insert_customer_record(db, customer_payload)
            customer_match_status = 'created_new'

        job_row = None
        if create_estimate_job:
            job_payload = _build_intake_service_job_payload(row, lead, customer_row)
            if job_payload:
                job_row = _insert_service_job_record(db, job_payload)

        existing_preferences = db.execute(
            'SELECT * FROM customer_contact_preferences WHERE customer_id=?',
            (customer_row['id'],)
        ).fetchone()
        if not existing_preferences and lead.get('preferredContactMethod'):
            _upsert_contact_preferences(db, customer_row['id'], _contact_preferences_from_lead(lead))

        lead_event_summary_bits = [
            f"Website intake #{row['website_submission_id']}",
            lead.get('formType') or row['form_type'] or 'website',
        ]
        if lead.get('serviceCategory'):
            lead_event_summary_bits.append(lead['serviceCategory'])
        if lead.get('estimateTotal', 0) > 0:
            lead_event_summary_bits.append(f"${lead['estimateTotal']:.2f}")
        if lead.get('preferredContactMethod'):
            lead_event_summary_bits.append(f"Preferred contact: {lead['preferredContactMethod']}")
        _create_contact_event(
            db,
            customer_id=customer_row['id'],
            job_id=job_row['id'] if job_row else '',
            channel='website',
            direction='inbound',
            event_type='lead_imported',
            subject=f"Website lead imported for {lead.get('name') or customer_row['name']}",
            body_summary=' | '.join(bit for bit in lead_event_summary_bits if bit),
            occurred_at=lead.get('submittedAt') or row['submitted_at'] or row['imported_at'],
            user_id=row['created_by_importer'] or _current_user_id(),
        )

        conversion_summary = {
            'action': action,
            'createdEstimateJob': bool(job_row),
            'recommendedMatchStatus': computed_status,
            'forceNewCustomer': force_new_customer,
            'convertedBy': _current_user_id(),
        }
        converted_at = _utcnow_iso()
        db.execute(
            'UPDATE crm_intake_imports '
            'SET customer_match_status=?, matched_customer_id=?, intake_status=?, '
            'converted_customer_id=?, converted_job_id=?, converted_at=?, conversion_summary_json=? '
            'WHERE id=?',
            (
                customer_match_status,
                customer_row['id'],
                'converted',
                customer_row['id'],
                job_row['id'] if job_row else '',
                converted_at,
                json.dumps(conversion_summary),
                import_id,
            )
        )
        updated = db.execute(
            'SELECT * FROM crm_intake_imports WHERE id=?', (import_id,)
        ).fetchone()

    return jsonify({
        'alreadyConverted': False,
        'intakeImport': _intake_import(updated),
        'leadSummary': lead,
        'candidates': candidates,
        'computedMatchStatus': computed_status,
        'customer': _customer(customer_row),
        'serviceJob': _job(job_row) if job_row else None,
    })


@app.route('/api/v1/intake-imports/<int:import_id>', methods=['PATCH'])
@login_required
@csrf_required
@permission_required('canManageIntake')
def update_intake_import(import_id):
    """
    PATCH /api/v1/intake-imports/<id>
    Allowed fields: intake_status, customer_match_status, matched_customer_id
    Used by staff to manually update lead review state.
    """
    data = request.get_json()
    allowed = ('intake_status', 'customer_match_status', 'matched_customer_id')
    updates = {k: v for k, v in data.items() if k in allowed}
    if not updates:
        return jsonify({'error': 'No valid fields provided'}), 400

    set_clause = ', '.join(f'{k}=?' for k in updates)
    params = list(updates.values()) + [import_id]

    with get_db() as db:
        db.execute(
            f'UPDATE crm_intake_imports SET {set_clause} WHERE id=?', params
        )
        row = db.execute(
            'SELECT * FROM crm_intake_imports WHERE id=?', (import_id,)
        ).fetchone()
    if not row:
        return jsonify({'error': 'Not found'}), 404
    return jsonify(_intake_import(row))


@app.route('/api/v1/intake-imports/quarantine', methods=['GET'])
@login_required
@permission_required('canViewIntake')
def list_quarantine():
    limit = min(int(request.args.get('limit', 50)), 200)
    offset = int(request.args.get('offset', 0))
    with get_db() as db:
        rows = db.execute(
            'SELECT * FROM crm_import_quarantine ORDER BY received_at DESC LIMIT ? OFFSET ?',
            (limit, offset)
        ).fetchall()
        total = db.execute('SELECT COUNT(*) FROM crm_import_quarantine').fetchone()[0]
    return jsonify({
        'total': total,
        'count': len(rows),
        'records': [dict(r) for r in rows],
    })


@app.route('/api/v1/integration/cursor', methods=['GET'])
@login_required
@permission_required('canManageIntake')
def get_cursor():
    """Returns the current import cursor state for the CRM poller."""
    with get_db() as db:
        row = db.execute(
            "SELECT * FROM integration_cursors WHERE source_system='ccs_website'"
        ).fetchone()
    if not row:
        return jsonify({'source_system': 'ccs_website', 'last_submission_id': 0})
    return jsonify(dict(row))


# ---------------------------------------------------------------------------
# Google Auth API â€” DB-backed OAuth routes
# ---------------------------------------------------------------------------


@app.route('/api/auth/google/login')
@login_required
@permission_required('canUseGoogleAuth')
def google_api_auth_login():
    """
    Initiate the Google OAuth flow using DB-backed state storage.
    Safe across multiple gunicorn workers.
    """
    if not _GOOGLE_SERVICES_READY:
        return jsonify({'error': 'Google libraries not installed'}), 501

    auth_manager = _get_google_auth_manager()
    if not auth_manager:
        return jsonify({
            'error': 'Google OAuth is not configured. '
                     'PLACEHOLDER: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env'
        }), 503

    try:
        crm_user_id = _current_user_id()
        crm_username = _current_username()
        auth_url, _state = auth_manager.build_authorization_url(
            crm_user_id,
            GOOGLE_REDIRECT_URI,
            crm_username=crm_username,
        )
        return redirect(auth_url)
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/auth/google/callback')
def google_api_auth_callback():
    """
    Handle the Google OAuth callback. State is verified against DB (multi-worker safe).
    On success, redirects to CRM root. On failure, returns a plain error page.
    """
    if not _GOOGLE_SERVICES_READY:
        return '<b>Google libraries not installed.</b>', 501

    auth_manager = _get_google_auth_manager()
    if not auth_manager:
        return '<b>Google OAuth not configured.</b>', 503

    state    = request.args.get('state', '')
    error    = request.args.get('error', '')
    if error:
        return f'<b>Google OAuth error: {error}</b>', 400

    auth_response = request.url
    if GOOGLE_REDIRECT_URI.startswith('https') and auth_response.startswith('http:'):
        auth_response = auth_response.replace('http:', 'https:', 1)

    try:
        auth_manager.handle_callback(state, auth_response, GOOGLE_REDIRECT_URI)
        return redirect('/')
    except ValueError as exc:
        return f'<b>OAuth Error: {exc}</b>', 400
    except Exception as exc:
        return f'<b>OAuth Error: {exc}</b>', 500


@app.route('/api/auth/google/status')
@login_required
@permission_required('canUseGoogleAuth')
def google_api_auth_status():
    """
    Return connection status for the authenticated CRM user.
    Also checks whether the stored token is still valid / refreshable.
    """
    if not _GOOGLE_SERVICES_READY:
        return jsonify({'linked': False, 'reason': 'google_libraries_missing'})

    crm_user_id = _current_user_id()
    crm_username = _current_username()
    status = _g_cred_store.get_status(crm_user_id, crm_username=crm_username) if _g_cred_store else {'linked': False}

    # Verify token is actually valid (triggers refresh if expired)
    if status.get('linked') and _g_client_factory:
        svc = _g_client_factory.calendar(crm_user_id, crm_username=crm_username)
        status['token_valid'] = svc is not None

    return jsonify(status)


@app.route('/api/auth/google/disconnect', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canUseGoogleAuth')
def google_api_auth_disconnect():
    """Revoke and remove stored Google credentials for the current CRM user."""
    if not _GOOGLE_SERVICES_READY or not _g_cred_store:
        return jsonify({'error': 'Google service layer not available'}), 503
    crm_user_id = _current_user_id()
    crm_username = _current_username()
    _g_cred_store.revoke(crm_user_id, crm_username=crm_username)
    return jsonify({'disconnected': True, 'crm_user': crm_username, 'crmUserId': crm_user_id})


# ---------------------------------------------------------------------------
# Google Calendar â€” job events and callback reminders
# ---------------------------------------------------------------------------


@app.route('/api/v1/jobs/<jid>/calendar-event', methods=['POST'])
@login_required
@csrf_required
@permission_required('canUseCalendar')
def create_job_calendar_event(jid):
    """
    Create a Google Calendar event for a job and store the event ID back in the job row.

    Body (JSON):
      summary        â€” event title (defaults to "Service Job â€” {service_type}")
      description    â€” optional notes
    """
    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        return jsonify({'error': 'Google Calendar not available'}), 503

    with get_db() as db:
        job = _select_service_job_row(db, jid)
        customer_row = _get_job_calendar_customer_row(db, job['customer_id']) if job else None
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    if job['gcal_event_id']:
        return jsonify({'error': 'Calendar event already exists', 'gcalEventId': job['gcal_event_id']}), 409

    data = request.get_json() or {}
    summary = data.get('summary') or f"Service Job â€” {job['service_type'] or 'CRM'}"
    description = data.get('description') or job['notes'] or ''
    scheduled_date = job['scheduled_date'] or datetime.now(timezone.utc).date().isoformat()
    recurrence = build_job_recurrence(job['service_category'], job['frequency'])

    # Look up customer address for location field
    location = job['address'] or ''
    if not location and job['customer_id']:
        with get_db() as db:
            cust = _select_customer_row(db, job['customer_id'])
            if cust:
                location = cust['address'] or ''

    sync_data = _build_job_calendar_sync_data(job, customer_row)
    summary = data.get('summary') or sync_data['summary']
    description = data.get('description') or sync_data['description']
    scheduled_date = sync_data['scheduled_date'] or scheduled_date
    recurrence = sync_data['recurrence']
    location = sync_data['location'] or location

    try:
        crm_user_id = _current_user_id()
        crm_username = _current_username()
        event = _g_calendar.create_job_event(
            crm_user_id=crm_user_id,
            crm_username=crm_username,
            job_id=jid,
            summary=summary,
            location=location,
            scheduled_date=scheduled_date,
            description=description,
            crm_base_url=CRM_BASE_URL,
            recurrence=recurrence,
        )
        event_id = event.get('id', '')
        # Store the event ID back in the job
        with get_db() as db:
            db.execute('UPDATE service_jobs SET gcal_event_id=? WHERE id=?', (event_id, jid))
            _create_contact_event(
                db,
                customer_id=job['customer_id'] or '',
                job_id=jid,
                channel='calendar',
                direction='system',
                event_type='calendar_synced',
                subject=summary,
                body_summary=f"Google Calendar event created for {scheduled_date}.",
                user_id=crm_user_id,
            )
        return jsonify({
            'gcalEventId': event_id,
            'eventLink': event.get('htmlLink', ''),
            'recurrence': recurrence or [],
        }), 201
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 401
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/v1/jobs/<jid>/calendar-event', methods=['DELETE'])
@login_required
@csrf_required
@permission_required('canUseCalendar')
def delete_job_calendar_event(jid):
    """Delete the Google Calendar event associated with a job and clear gcal_event_id."""
    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        return jsonify({'error': 'Google Calendar not available'}), 503

    with get_db() as db:
        job = db.execute(
            "SELECT gcal_event_id FROM service_jobs WHERE id=? AND COALESCE(deleted_at, '')=''",
            (jid,)
        ).fetchone()
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    if not job['gcal_event_id']:
        return jsonify({'error': 'No calendar event linked to this job'}), 404

    try:
        crm_user_id = _current_user_id()
        crm_username = _current_username()
        _g_calendar.delete_event(
            crm_user_id=crm_user_id,
            crm_username=crm_username,
            event_id=job['gcal_event_id'],
        )
        with get_db() as db:
            db.execute("UPDATE service_jobs SET gcal_event_id='' WHERE id=?", (jid,))
        return '', 204
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 401
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/v1/jobs/<jid>/callback-reminder', methods=['POST'])
@login_required
@csrf_required
@permission_required('canUseCalendar')
def create_callback_reminder(jid):
    """
    Create a callback reminder calendar event linked to the job's customer.

    Body (JSON):
      callback_date  â€” ISO date string (YYYY-MM-DD), required
      notes          â€” optional message
    """
    if not _GOOGLE_SERVICES_READY or not _g_calendar:
        return jsonify({'error': 'Google Calendar not available'}), 503

    data = request.get_json() or {}
    callback_date = data.get('callback_date', '')
    if not callback_date:
        return jsonify({'error': 'callback_date is required (YYYY-MM-DD)'}), 400

    with get_db() as db:
        job = _select_service_job_row(db, jid)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    customer_name, customer_phone, customer_id = '', '', job['customer_id'] or ''
    if customer_id:
        with get_db() as db:
            cust = _select_customer_row(db, customer_id)
            if cust:
                customer_name  = cust['name'] or ''
                customer_phone = cust['phone'] or ''

    try:
        crm_user_id = _current_user_id()
        crm_username = _current_username()
        event = _g_calendar.create_callback_reminder(
            crm_user_id=crm_user_id,
            crm_username=crm_username,
            customer_name=customer_name or 'Customer',
            callback_date=callback_date,
            customer_phone=customer_phone,
            notes=data.get('notes', ''),
            crm_base_url=CRM_BASE_URL,
            customer_id=customer_id,
        )
        if customer_id:
            with get_db() as db:
                _create_followup(
                    db,
                    customer_id=customer_id,
                    job_id=jid,
                    channel='phone',
                    subject=f"Callback reminder for {customer_name or 'customer'}",
                    body_summary=_trimmed_text(data.get('notes'), 2000),
                    due_at=callback_date,
                    assigned_user_id=crm_user_id,
                )
                _create_contact_event(
                    db,
                    customer_id=customer_id,
                    job_id=jid,
                    channel='calendar',
                    direction='system',
                    event_type='callback_reminder_created',
                    subject=f"Callback reminder scheduled for {callback_date}",
                    body_summary=_trimmed_text(data.get('notes'), 2000) or 'Callback reminder added to Google Calendar.',
                    user_id=crm_user_id,
                )
        return jsonify({'gcalEventId': event.get('id', ''), 'eventLink': event.get('htmlLink', '')}), 201
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 401
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


# ---------------------------------------------------------------------------
# Google Sheets â€” export endpoints
# ---------------------------------------------------------------------------


@app.route('/api/v1/export/sheets/leads', methods=['POST'])
@login_required
@csrf_required
@permission_required('canExportSheets')
def export_leads_to_sheets():
    """
    Append all unreviewed intake-import leads to the configured Google Sheet.

    Body (JSON):
      spreadsheet_id  â€” overrides GOOGLE_SHEETS_LEADS_SPREADSHEET_ID env var
      intake_status   â€” filter: 'imported' (default), 'reviewed', or '' for all
      limit           â€” max rows to export (default 100, max 500)

    PLACEHOLDER: Set GOOGLE_SHEETS_LEADS_SPREADSHEET_ID in /opt/crm/.env to the
    target spreadsheet ID. Create the 'Leads' tab with a header row first.
    """
    if not _GOOGLE_SERVICES_READY or not _g_sheets:
        return jsonify({'error': 'Google Sheets not available'}), 503

    data = request.get_json() or {}
    spreadsheet_id = (
        data.get('spreadsheet_id')
        or os.environ.get('GOOGLE_SHEETS_LEADS_SPREADSHEET_ID', '')
    )
    if not spreadsheet_id:
        return jsonify({
            'error': 'No spreadsheet_id provided. '
                     'PLACEHOLDER: set GOOGLE_SHEETS_LEADS_SPREADSHEET_ID in .env'
        }), 400

    status_filter = data.get('intake_status', 'imported')
    limit = min(int(data.get('limit', 100)), 500)

    query = 'SELECT * FROM crm_intake_imports ORDER BY imported_at DESC LIMIT ?'
    params = [limit]
    if status_filter:
        query = 'SELECT * FROM crm_intake_imports WHERE intake_status=? ORDER BY imported_at DESC LIMIT ?'
        params = [status_filter, limit]

    with get_db() as db:
        rows = db.execute(query, params).fetchall()

    exported, errors = 0, []
    crm_user_id = _current_user_id()
    crm_username = _current_username()
    for row in rows:
        payload = {}
        try:
            payload = json.loads(row['raw_payload_json'] or '{}')
        except Exception:
            pass
        customer = payload.get('customer', {})
        lead = {
            'name':         customer.get('name', ''),
            'phone':        customer.get('phone', ''),
            'address':      customer.get('address', ''),
            'status':       row['intake_status'],
            'source_page':  row['source_page'] or '',
            'form_type':    row['form_type'] or '',
            'submitted_at': row['submitted_at'] or '',
            'notes':        payload.get('service_request', {}).get('notes', ''),
        }
        try:
            _g_sheets.append_lead_row(
                crm_user_id=crm_user_id,
                crm_username=crm_username,
                spreadsheet_id=spreadsheet_id,
                lead=lead,
            )
            exported += 1
        except Exception as exc:
            errors.append({'id': row['id'], 'error': str(exc)})

    return jsonify({'exported': exported, 'errors': errors})


@app.route('/api/v1/export/sheets/estimates', methods=['POST'])
@login_required
@csrf_required
@permission_required('canExportSheets')
def export_estimates_to_sheets():
    """
    Append CRM jobs to the Estimates tab of the configured Google Sheet.

    Body (JSON):
      spreadsheet_id  â€” overrides GOOGLE_SHEETS_LEADS_SPREADSHEET_ID env var
      status          â€” filter by job status (optional)
      limit           â€” max rows (default 100, max 500)

    PLACEHOLDER: The target spreadsheet must have an 'Estimates' tab with a header row.
    """
    if not _GOOGLE_SERVICES_READY or not _g_sheets:
        return jsonify({'error': 'Google Sheets not available'}), 503

    data = request.get_json() or {}
    spreadsheet_id = (
        data.get('spreadsheet_id')
        or os.environ.get('GOOGLE_SHEETS_LEADS_SPREADSHEET_ID', '')
    )
    if not spreadsheet_id:
        return jsonify({
            'error': 'No spreadsheet_id provided. '
                     'PLACEHOLDER: set GOOGLE_SHEETS_LEADS_SPREADSHEET_ID in .env'
        }), 400

    status_filter = data.get('status', '')
    limit = min(int(data.get('limit', 100)), 500)

    if status_filter:
        query  = "SELECT j.*, c.name as customer_name FROM service_jobs j LEFT JOIN customers c ON j.customer_id=c.id WHERE j.status=? AND COALESCE(j.deleted_at, '')='' ORDER BY j.job_number DESC LIMIT ?"
        params = [status_filter, limit]
    else:
        query  = "SELECT j.*, c.name as customer_name FROM service_jobs j LEFT JOIN customers c ON j.customer_id=c.id WHERE COALESCE(j.deleted_at, '')='' ORDER BY j.job_number DESC LIMIT ?"
        params = [limit]

    with get_db() as db:
        rows = db.execute(query, params).fetchall()

    exported, errors = 0, []
    crm_user_id = _current_user_id()
    crm_username = _current_username()
    for row in rows:
        job = {
            'job_number':    row['job_number'],
            'customer_name': row['customer_name'] or '',
            'address':       row['address'] or '',
            'service_type':  row['service_type'] or '',
            'quoted_amount': row['quoted_amount'] or 0,
            'actual_amount': row['actual_amount'] or 0,
            'status':        row['status'] or '',
            'scheduled_date': row['scheduled_date'] or '',
            'notes':         row['notes'] or '',
        }
        try:
            _g_sheets.append_estimate_row(
                crm_user_id=crm_user_id,
                crm_username=crm_username,
                spreadsheet_id=spreadsheet_id,
                job=job,
            )
            exported += 1
        except Exception as exc:
            errors.append({'job_number': row['job_number'], 'error': str(exc)})

    return jsonify({'exported': exported, 'errors': errors})


@app.route('/api/v1/export/sheets/info', methods=['GET'])
@login_required
@permission_required('canExportSheets')
def sheets_info():
    """Return metadata for the configured spreadsheet (title, tab names)."""
    if not _GOOGLE_SERVICES_READY or not _g_sheets:
        return jsonify({'error': 'Google Sheets not available'}), 503

    spreadsheet_id = request.args.get('spreadsheet_id') or os.environ.get('GOOGLE_SHEETS_LEADS_SPREADSHEET_ID', '')
    if not spreadsheet_id:
        return jsonify({'error': 'No spreadsheet_id configured'}), 400

    try:
        crm_user_id = _current_user_id()
        crm_username = _current_username()
        return jsonify(
            _g_sheets.get_spreadsheet_info(
                crm_user_id=crm_user_id,
                crm_username=crm_username,
                spreadsheet_id=spreadsheet_id,
            )
        )
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 401
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


# ---------------------------------------------------------------------------
# Google Drive â€” per-customer folder management
# ---------------------------------------------------------------------------


@app.route('/api/v1/customers/<cid>/drive-folder', methods=['POST'])
@login_required
@csrf_required
@permission_required('canUseDrive')
def create_customer_drive_folder(cid):
    """
    Create a per-customer Drive folder structure and store the folder IDs in the DB.
    Returns 409 if a folder record already exists for this customer.

    PLACEHOLDER: Set GOOGLE_DRIVE_ROOT_FOLDER_ID in /opt/crm/.env to the ID of
    the top-level 'FieldOpsDemo' folder you created manually in Google Drive.
    """
    if not _GOOGLE_SERVICES_READY or not _g_drive:
        return jsonify({'error': 'Google Drive not available'}), 503

    root_folder_id = os.environ.get('GOOGLE_DRIVE_ROOT_FOLDER_ID', '')
    if not root_folder_id:
        return jsonify({
            'error': 'GOOGLE_DRIVE_ROOT_FOLDER_ID not set. '
                     'PLACEHOLDER: create a root folder in Google Drive and set its ID in .env'
        }), 503

    with get_db() as db:
        customer = _select_customer_row(db, cid)
    if not customer:
        return jsonify({'error': 'Customer not found'}), 404

    # Check if already created
    with get_db() as db:
        existing = db.execute(
            'SELECT * FROM customer_drive_folders WHERE customer_id=?', (cid,)
        ).fetchone()
    if existing:
        return jsonify({
            'error': 'Drive folder already exists for this customer',
            'folderInfo': dict(existing),
        }), 409

    try:
        crm_user_id = _current_user_id()
        crm_username = _current_username()
        folders = _g_drive.create_customer_folder(
            crm_user_id=crm_user_id,
            crm_username=crm_username,
            customer_number=customer['customer_number'] or 0,
            customer_name=customer['name'],
            root_folder_id=root_folder_id,
        )
        with get_db() as db:
            db.execute(
                'INSERT INTO customer_drive_folders '
                '(customer_id, customer_folder_id, customer_folder_url, '
                'estimates_folder_id, photos_folder_id) VALUES (?,?,?,?,?)',
                (cid, folders['customer_folder_id'], folders['customer_folder_url'],
                 folders['estimates_folder_id'], folders['photos_folder_id'])
            )
        return jsonify(folders), 201
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 401
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/v1/customers/<cid>/drive-folder', methods=['GET'])
@login_required
@permission_required('canUseDrive')
def get_customer_drive_folder(cid):
    """Return stored Drive folder info for a customer, or 404 if not yet created."""
    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        row = db.execute(
            'SELECT * FROM customer_drive_folders WHERE customer_id=?', (cid,)
        ).fetchone()
    if not row:
        return jsonify({'error': 'No Drive folder found for this customer'}), 404
    return jsonify(dict(row))


# ---------------------------------------------------------------------------
# Gmail â€” outbound email
# ---------------------------------------------------------------------------


@app.route('/api/v1/customers/<cid>/email', methods=['POST'])
@login_required
@csrf_required
@permission_required('canSendCustomerEmail')
def send_customer_email(cid):
    """
    Send an email to a customer via Gmail (send-only).
    Requires GMAIL_SEND_ENABLED=true in .env.

    Body (JSON):
      email_type   â€” 'quote' | 'followup' | 'custom'
      to           â€” recipient address (required for 'custom')
      subject      â€” required for 'custom'
      body         â€” required for 'custom'

      For 'quote':
        service_type, quoted_amount, scheduled_date (optional), notes (optional)
      For 'followup':
        message

    PLACEHOLDER: Set GMAIL_SEND_ENABLED=true in .env only after reviewing
    Google's restricted scope requirements for gmail.send.
    """
    if not _GOOGLE_SERVICES_READY or not _g_gmail:
        return jsonify({'error': 'Gmail service not available'}), 503

    with get_db() as db:
        customer = _select_customer_row(db, cid)
    if not customer:
        return jsonify({'error': 'Customer not found'}), 404

    data = request.get_json() or {}
    email_type = data.get('email_type', 'custom')
    crm_user_id = _current_user_id()
    crm_username = _current_username()

    try:
        if email_type == 'quote':
            result = _g_gmail.send_quote(
                crm_user_id=crm_user_id,
                crm_username=crm_username,
                customer_name=customer['name'],
                customer_email=data.get('to', ''),
                service_type=data.get('service_type', ''),
                quoted_amount=float(data.get('quoted_amount', 0)),
                scheduled_date=data.get('scheduled_date', ''),
                notes=data.get('notes', ''),
                customer_id=cid,
            )
        elif email_type == 'followup':
            result = _g_gmail.send_followup(
                crm_user_id=crm_user_id,
                crm_username=crm_username,
                customer_name=customer['name'],
                customer_email=data.get('to', ''),
                message=data.get('message', ''),
                customer_id=cid,
            )
        else:  # 'custom'
            to      = data.get('to', '')
            subject = data.get('subject', '')
            body    = data.get('body', '')
            if not to or not subject or not body:
                return jsonify({'error': "'to', 'subject', and 'body' are required for custom emails"}), 400
            result = _g_gmail.send(
                crm_user_id=crm_user_id,
                crm_username=crm_username,
                to=to,
                subject=subject,
                body_text=body,
                customer_id=cid,
            )

        if email_type == 'quote':
            event_subject = f"Quote email sent to {customer['name']}"
            event_summary = f"{data.get('service_type', '')} | ${float(data.get('quoted_amount', 0) or 0):.2f}"
        elif email_type == 'followup':
            event_subject = f"Follow-up email sent to {customer['name']}"
            event_summary = _trimmed_text(data.get('message'), 2000)
        else:
            event_subject = data.get('subject') or f"Custom email sent to {customer['name']}"
            event_summary = _trimmed_text(data.get('body'), 2000)

        with get_db() as db:
            _create_contact_event(
                db,
                customer_id=cid,
                channel='email',
                direction='outbound',
                event_type='email_sent',
                subject=event_subject,
                body_summary=event_summary,
                user_id=crm_user_id,
            )

        return jsonify({'sent': True, 'messageId': result.get('id', '')})
    except RuntimeError as exc:
        return jsonify({'error': str(exc)}), 400
    except Exception as exc:
        return jsonify({'error': str(exc)}), 500


@app.route('/api/v1/customers/<cid>/email/log', methods=['GET'])
@login_required
def get_customer_email_log(cid):
    """Return Gmail send history for a customer."""
    limit = min(int(request.args.get('limit', 50)), 200)
    with get_db() as db:
        customer = _select_customer_row(db, cid)
        if not customer:
            return jsonify({'error': 'Customer not found'}), 404
        rows = db.execute(
            'SELECT * FROM gmail_send_log WHERE customer_id=? ORDER BY sent_at DESC LIMIT ?',
            (cid, limit)
        ).fetchall()
    return jsonify([dict(r) for r in rows])


# ---------------------------------------------------------------------------
# Google Webhooks â€” inbound push notifications (future)
# ---------------------------------------------------------------------------


@app.route('/api/webhooks/google', methods=['POST'])
def google_webhook():
    """
    Stub endpoint for Google push notifications (Calendar, Drive, etc.).

    PLACEHOLDER: Google push notifications require you to:
      1. Register a watch on a resource via the API:
           service.events().watch(calendarId='primary', body={
               'id': '<unique-channel-id>',
               'type': 'web_hook',
               'address': 'https://<crm-domain>/api/webhooks/google',
               'token': '<your-channel-token>',
           }).execute()
      2. Verify incoming requests by checking the X-Goog-Channel-Token header
         matches the token you registered.
      3. Process the notification type from X-Goog-Resource-State header:
           'sync'    â€” initial handshake after watch registration
           'exists'  â€” a resource was created or updated
           'not_exists' â€” a resource was deleted

    This endpoint is public (no mTLS, no session auth) â€” verification is done
    at the application layer via the channel token.

    PLACEHOLDER: Update CRM Nginx config to allow this route without requiring
    client certificates (ssl_verify_client is already 'optional' server-wide,
    so this is a no-op unless you added strict enforcement to a location block).
    """
    channel_token    = request.headers.get('X-Goog-Channel-Token', '')
    resource_state   = request.headers.get('X-Goog-Resource-State', '')
    channel_id       = request.headers.get('X-Goog-Channel-ID', '')
    resource_id      = request.headers.get('X-Goog-Resource-ID', '')

    # PLACEHOLDER: Validate channel_token against a stored secret before acting.
    # For now, log and ack immediately.
    app.logger.info(
        "Google webhook: channel=%s state=%s resource=%s",
        channel_id, resource_state, resource_id
    )

    # Google requires a 200 response within 3 seconds.
    return '', 200


# ---------------------------------------------------------------------------
# Geocoding
# ---------------------------------------------------------------------------

GEOCODE_CACHE_FILE = os.environ.get('GEOCODE_CACHE_FILE', os.path.join(_DATA_DIR, 'geocode_cache.json'))
_geocode_cache: dict = {}
_geocode_lock = threading.Lock()
_last_geocode_call = 0.0


def _load_geocode_cache():
    global _geocode_cache
    if os.path.exists(GEOCODE_CACHE_FILE):
        try:
            with open(GEOCODE_CACHE_FILE) as f:
                _geocode_cache = json.load(f)
        except Exception:
            _geocode_cache = {}


def _save_geocode_cache():
    with open(GEOCODE_CACHE_FILE, 'w') as f:
        json.dump(_geocode_cache, f, indent=2)


_load_geocode_cache()


@app.route('/api/geocode')
@login_required
def geocode_address():
    global _last_geocode_call
    address = request.args.get('address', '').strip()
    if not address:
        return jsonify({'error': 'address parameter required'}), 400

    key = address.lower()
    with _geocode_lock:
        if key in _geocode_cache:
            return jsonify(_geocode_cache[key])

        elapsed = time.time() - _last_geocode_call
        if elapsed < 0.25:
            time.sleep(0.25 - elapsed)

        result = {'notFound': True}
        try:
            url = (
                'https://nominatim.openstreetmap.org/search'
                f'?format=jsonv2&limit=1&q={urllib.parse.quote(address)}'
            )
            req = urllib.request.Request(
                url, headers={'User-Agent': 'FieldOpsDemo/2.0 (production)'}
            )
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read())
            if data:
                result = {'lat': float(data[0]['lat']), 'lng': float(data[0]['lon'])}
        except Exception:
            pass

        _last_geocode_call = time.time()
        _geocode_cache[key] = result
        _save_geocode_cache()

    return jsonify(result)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    debug = os.environ.get('FLASK_DEBUG', '0') == '1'
    if debug:
        os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
    app.run(debug=debug, host='127.0.0.1', port=5002)
