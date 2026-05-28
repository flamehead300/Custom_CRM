"""
google_services.py â€” Google Workspace integration service layer for FieldOps Demo CRM.

Provides DB-backed token storage, OAuth flow management, and service-specific
clients for Calendar, Sheets, Drive, and Gmail.

PLACEHOLDER: Before any of this module can function you must complete all steps
in .codex/agents/google-integration-roadmap.md Â§ "Google Cloud Console setup
checklist". Specifically:
  1. Create a Google Cloud project and enable the required APIs
  2. Configure the OAuth consent screen (privacy policy, terms, scopes)
  3. Create an OAuth 2.0 Client ID (Web application type)
  4. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI in /opt/crm/.env
"""

import os
import json
import base64
import hashlib
import logging
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional dependency guards
# ---------------------------------------------------------------------------

try:
    from cryptography.fernet import Fernet
    _CRYPTO_AVAILABLE = True
except ImportError:
    _CRYPTO_AVAILABLE = False

try:
    from google.auth import exceptions as google_exceptions
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import Flow
    from googleapiclient.discovery import build
    from googleapiclient.errors import HttpError
    _GOOGLE_AVAILABLE = True
except ImportError:
    _GOOGLE_AVAILABLE = False

# ---------------------------------------------------------------------------
# Scopes
# ---------------------------------------------------------------------------
#
# PLACEHOLDER: Only include scopes for APIs you have enabled in Google Cloud
# Console. Requesting a scope for a disabled API causes an invalid_scope error
# on the consent screen. Comment out any scope not yet enabled.
#
# See: https://developers.google.com/identity/protocols/oauth2/scopes

SCOPES_CALENDAR = [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.events.freebusy',
]
SCOPES_SHEETS   = ['https://www.googleapis.com/auth/spreadsheets']
SCOPES_DRIVE    = ['https://www.googleapis.com/auth/drive.file']
SCOPES_GMAIL    = ['https://www.googleapis.com/auth/gmail.send']

# Combined set used by the OAuth flow.
# Keep the default scope set minimal so Calendar can be deployed independently.
# Additional product scopes can be reintroduced as those features are enabled.
# Gmail is conditionally appended at runtime when GMAIL_SEND_ENABLED=true.
_BASE_SCOPES = SCOPES_CALENDAR

CALENDAR_TIMEZONE = 'America/Chicago'
CHICAGO = ZoneInfo(CALENDAR_TIMEZONE)


def to_google_rfc3339(dt: datetime) -> str:
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError('datetime must be timezone-aware')
    return dt.isoformat(timespec='seconds')


def to_google_rfc3339_utc(dt: datetime) -> str:
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError('datetime must be timezone-aware')
    return (
        dt.astimezone(timezone.utc)
        .isoformat(timespec='seconds')
        .replace('+00:00', 'Z')
    )


def get_main_scheduling_calendar_id() -> str:
    return (os.environ.get('MAIN_SCHEDULING_CALENDAR_ID') or '').strip()


def _build_scopes() -> List[str]:
    """Return the active scope list based on environment config."""
    scopes = list(_BASE_SCOPES)
    if os.environ.get('GMAIL_SEND_ENABLED', 'false').lower() == 'true':
        scopes.extend(SCOPES_GMAIL)
    return scopes


def format_all_day_event(date_string: str) -> Dict[str, Dict[str, str]]:
    """
    Build an all-day Google Calendar payload fragment.

    Google Calendar treats all-day end dates as exclusive, so a one-day event
    must end on the following calendar day.
    """
    start_date = datetime.strptime(date_string, '%Y-%m-%d')
    end_date = start_date + timedelta(days=1)
    return {
        'start': {'date': start_date.strftime('%Y-%m-%d')},
        'end': {'date': end_date.strftime('%Y-%m-%d')},
    }


# ---------------------------------------------------------------------------
# Encryption helpers
# ---------------------------------------------------------------------------

def _make_fernet(secret_key: str) -> 'Fernet':
    """
    Derive a stable 256-bit Fernet key from SECRET_KEY via SHA-256.
    Changing SECRET_KEY invalidates all stored tokens â€” users must re-authenticate.
    """
    if not _CRYPTO_AVAILABLE:
        raise RuntimeError(
            "The 'cryptography' package is required for token encryption. "
            "Install it with: pip install cryptography>=41.0"
        )
    raw = hashlib.sha256(secret_key.encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(raw))


# ---------------------------------------------------------------------------
# GoogleCredentialStore
# ---------------------------------------------------------------------------

class GoogleCredentialStore:
    """
    Persists Google OAuth tokens in SQLite, encrypted at rest with Fernet (AES-128-CBC).

    One row per CRM user. Changing SECRET_KEY invalidates all stored tokens.
    The DB tables this class relies on are created by crm_server.py's init_db().
    """

    def __init__(self, db_path: str, secret_key: str):
        self._db_path = db_path
        self._fernet = _make_fernet(secret_key)

    # â”€â”€ internal DB context â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @contextmanager
    def _db(self):
        conn = sqlite3.connect(self._db_path)
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

    # â”€â”€ encryption â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _enc(self, value: str) -> str:
        return self._fernet.encrypt(value.encode('utf-8')).decode('utf-8')

    def _dec(self, value: str) -> str:
        return self._fernet.decrypt(value.encode('utf-8')).decode('utf-8')

    def _snapshot_username(self, crm_username: str) -> str:
        return str(crm_username or '').strip()

    def _linked_account_row(self, conn, crm_user_id: str, crm_username: str = ''):
        normalized_id = str(crm_user_id or '').strip()
        if normalized_id:
            row = conn.execute(
                'SELECT * FROM google_linked_accounts WHERE crm_user_id=? ORDER BY linked_at DESC LIMIT 1',
                (normalized_id,)
            ).fetchone()
            if row:
                return row
        snapshot = self._snapshot_username(crm_username)
        if snapshot:
            return conn.execute(
                'SELECT * FROM google_linked_accounts WHERE lower(crm_user)=lower(?) ORDER BY linked_at DESC LIMIT 1',
                (snapshot,)
            ).fetchone()
        return None

    # â”€â”€ token persistence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def save(self, crm_user_id: str, credentials: 'Credentials', crm_username: str = '') -> None:
        """Upsert OAuth credentials for a CRM user. Clears any reconnect-required state."""
        data = json.loads(credentials.to_json())
        enc_access  = self._enc(data.get('token', '') or '')
        enc_refresh = self._enc(data.get('refresh_token', '') or '')
        expiry = data.get('expiry', '') or ''
        scopes = ' '.join(credentials.scopes or [])
        snapshot = self._snapshot_username(crm_username) or str(crm_user_id or '').strip()
        with self._db() as conn:
            existing = self._linked_account_row(conn, crm_user_id, snapshot)
            if existing:
                conn.execute(
                    'UPDATE google_linked_accounts SET '
                    'crm_user=?, crm_user_id=?, encrypted_access_token=?, encrypted_refresh_token=?, '
                    'token_expiry=?, scopes=?, last_refreshed_at=datetime("now"), '
                    'is_active=1, reconnect_required=0, failure_reason=? '
                    'WHERE crm_user=?',
                    (
                        snapshot,
                        str(crm_user_id or '').strip(),
                        enc_access,
                        enc_refresh,
                        expiry,
                        scopes,
                        '',
                        existing['crm_user'],
                    )
                )
            else:
                conn.execute(
                    'INSERT INTO google_linked_accounts '
                    '(crm_user, crm_user_id, encrypted_access_token, encrypted_refresh_token, '
                    'token_expiry, scopes, linked_at, is_active, reconnect_required, failure_reason) '
                    'VALUES (?, ?, ?, ?, ?, ?, datetime("now"), 1, 0, ?)',
                    (
                        snapshot,
                        str(crm_user_id or '').strip(),
                        enc_access,
                        enc_refresh,
                        expiry,
                        scopes,
                        '',
                    )
                )
            self._audit(conn, 'connect', crm_user_id, 'Credentials saved', crm_username=snapshot)

    def load(self, crm_user_id: str, crm_username: str = '') -> Optional['Credentials']:
        """Load and decrypt credentials. Returns None if not found or decryption fails."""
        if not _GOOGLE_AVAILABLE:
            return None
        with self._db() as conn:
            row = self._linked_account_row(conn, crm_user_id, crm_username)
        if not row or not row['is_active']:
            return None
        try:
            access_token  = self._dec(row['encrypted_access_token'])
            refresh_token = self._dec(row['encrypted_refresh_token']) or None
            scopes = row['scopes'].split() if row['scopes'] else _build_scopes()
            creds = Credentials(
                token=access_token,
                refresh_token=refresh_token,
                token_uri='https://oauth2.googleapis.com/token',
                client_id=os.environ.get('GOOGLE_CLIENT_ID', ''),
                client_secret=os.environ.get('GOOGLE_CLIENT_SECRET', ''),
                scopes=scopes,
            )
            if row['token_expiry']:
                try:
                    expiry_str = row['token_expiry'].rstrip('Z')
                    # Credentials.expiry expects a naive UTC datetime
                    creds.expiry = datetime.fromisoformat(expiry_str).replace(tzinfo=None)
                except Exception:
                    pass
            return creds
        except Exception as exc:
            logger.error("Failed to decrypt Google credentials for %s: %s", crm_user_id or crm_username, exc)
            return None

    def update_after_refresh(self, crm_user_id: str, credentials: 'Credentials', crm_username: str = '') -> None:
        """Persist a refreshed access token without touching the refresh token."""
        try:
            data = json.loads(credentials.to_json())
            enc_access = self._enc(data.get('token', '') or '')
            expiry = data.get('expiry', '') or ''
            with self._db() as conn:
                row = self._linked_account_row(conn, crm_user_id, crm_username)
                if not row:
                    return
                conn.execute(
                    'UPDATE google_linked_accounts '
                    'SET crm_user=?, crm_user_id=?, encrypted_access_token=?, token_expiry=?, last_refreshed_at=datetime("now") '
                    'WHERE crm_user=? AND is_active=1',
                    (
                        self._snapshot_username(crm_username) or row['crm_user'],
                        str(crm_user_id or '').strip() or row['crm_user_id'],
                        enc_access,
                        expiry,
                        row['crm_user'],
                    )
                )
                self._audit(
                    conn,
                    'refresh',
                    crm_user_id,
                    'Access token refreshed',
                    crm_username=crm_username or row['crm_user'],
                )
        except Exception as exc:
            logger.warning("Could not persist refreshed token for %s: %s", crm_user_id or crm_username, exc)

    def revoke(self, crm_user_id: str, crm_username: str = '') -> None:
        """Soft-delete credentials (mark inactive)."""
        with self._db() as conn:
            row = self._linked_account_row(conn, crm_user_id, crm_username)
            if not row:
                return
            conn.execute(
                'UPDATE google_linked_accounts SET is_active=0, crm_user=?, crm_user_id=? WHERE crm_user=?',
                (
                    self._snapshot_username(crm_username) or row['crm_user'],
                    str(crm_user_id or '').strip() or row['crm_user_id'],
                    row['crm_user'],
                )
            )
            self._audit(conn, 'revoke', crm_user_id, 'Credentials revoked', crm_username=crm_username or row['crm_user'])

    def get_status(self, crm_user_id: str, crm_username: str = '') -> Dict:
        """Return connection metadata without decrypting tokens."""
        with self._db() as conn:
            row = self._linked_account_row(conn, crm_user_id, crm_username)
        if not row:
            return {'linked': False}
        if row['is_active']:
            return {
                'linked': True,
                'crm_user': row['crm_user'],
                'crmUserId': row['crm_user_id'] or crm_user_id,
                'google_email': row['google_email'],
                'google_subject_id': row['google_subject_id'],
                'scopes': row['scopes'].split() if row['scopes'] else [],
                'linked_at': row['linked_at'],
                'last_refreshed_at': row['last_refreshed_at'],
            }
        # Inactive â€” distinguish user-initiated disconnect from system failure
        if row['reconnect_required']:
            return {
                'linked': False,
                'crm_user': row['crm_user'],
                'crmUserId': row['crm_user_id'] or crm_user_id,
                'needs_reconnect': True,
                'failure_reason': row['failure_reason'],
            }
        return {'linked': False}

    def update_google_profile(self, crm_user_id: str, email: str, subject_id: str, crm_username: str = '') -> None:
        """Store the Google account email and stable subject ID (sub claim)."""
        with self._db() as conn:
            row = self._linked_account_row(conn, crm_user_id, crm_username)
            if not row:
                return
            conn.execute(
                'UPDATE google_linked_accounts '
                'SET crm_user=?, crm_user_id=?, google_email=?, google_subject_id=? WHERE crm_user=?',
                (
                    self._snapshot_username(crm_username) or row['crm_user'],
                    str(crm_user_id or '').strip() or row['crm_user_id'],
                    email,
                    subject_id,
                    row['crm_user'],
                )
            )

    def mark_needs_reconnect(self, crm_user_id: str, reason: str, crm_username: str = '') -> None:
        """
        Deactivate credentials and flag that re-authentication is required.
        Called automatically on unrecoverable refresh failures (e.g. invalid_grant).
        """
        with self._db() as conn:
            row = self._linked_account_row(conn, crm_user_id, crm_username)
            if not row:
                return
            conn.execute(
                'UPDATE google_linked_accounts '
                'SET crm_user=?, crm_user_id=?, is_active=0, reconnect_required=1, failure_reason=? '
                'WHERE crm_user=?',
                (
                    self._snapshot_username(crm_username) or row['crm_user'],
                    str(crm_user_id or '').strip() or row['crm_user_id'],
                    reason,
                    row['crm_user'],
                )
            )
            self._audit(
                conn,
                'auto_deactivate',
                crm_user_id,
                f'Permanent auth failure: {reason}',
                crm_username=crm_username or row['crm_user'],
            )

    # â”€â”€ OAuth state (multi-worker safe) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def save_oauth_state(self, state: str, crm_user_id: str, crm_username: str = '', code_verifier: Optional[str] = None) -> None:
        """Persist an OAuth state token to DB (survives across gunicorn workers)."""
        with self._db() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO google_oauth_states (state, crm_user, crm_user_id, code_verifier) VALUES (?, ?, ?, ?)",
                (state, self._snapshot_username(crm_username), str(crm_user_id or '').strip(), code_verifier)
            )
            # Expire states older than 15 minutes
            conn.execute(
                "DELETE FROM google_oauth_states "
                "WHERE created_at < datetime('now', '-15 minutes')"
            )

    def consume_oauth_state(self, state: str) -> Optional[tuple]:
        """Look up and delete a pending OAuth state. Returns (crm_user_id, crm_user, code_verifier) or None."""
        with self._db() as conn:
            row = conn.execute(
                'SELECT crm_user, crm_user_id, code_verifier FROM google_oauth_states WHERE state=?', (state,)
            ).fetchone()
            if row:
                conn.execute('DELETE FROM google_oauth_states WHERE state=?', (state,))
                crm_user_id = row['crm_user_id'] or ''
                if not crm_user_id and row['crm_user']:
                    user_row = conn.execute(
                        'SELECT id FROM crm_users WHERE lower(username)=lower(?)',
                        (row['crm_user'],)
                    ).fetchone()
                    if user_row:
                        crm_user_id = user_row['id']
                return crm_user_id, row['crm_user'], row['code_verifier']
        return None

    # â”€â”€ audit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    def _audit(self, conn, event: str, crm_user_id: str, detail: str, crm_username: str = '') -> None:
        conn.execute(
            'INSERT INTO google_oauth_audit_log (event, crm_user, crm_user_id, detail) VALUES (?,?,?,?)',
            (event, self._snapshot_username(crm_username), str(crm_user_id or '').strip(), detail)
        )


# ---------------------------------------------------------------------------
# GoogleAuthManager
# ---------------------------------------------------------------------------

class GoogleAuthManager:
    """
    Manages the Google OAuth 2.0 authorization code flow.

    Uses DB-backed state storage so auth initiations and callbacks can be
    handled by different gunicorn workers.

    PLACEHOLDER: The redirect URI registered in Google Cloud Console
    (APIs & Services â†’ Credentials â†’ OAuth 2.0 Client â†’ Authorized redirect URIs)
    must exactly match GOOGLE_REDIRECT_URI in /opt/crm/.env.
    Even a trailing slash difference will cause redirect_uri_mismatch errors.
    """

    def __init__(self, credential_store: GoogleCredentialStore, client_config: Dict):
        self._store = credential_store
        self._client_config = client_config

    @classmethod
    def from_env(cls, credential_store: GoogleCredentialStore) -> 'GoogleAuthManager':
        """
        Construct from environment variables.

        PLACEHOLDER: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be populated
        in /opt/crm/.env before this will work. Obtain them from:
          Google Cloud Console â†’ APIs & Services â†’ Credentials â†’
          OAuth 2.0 Client IDs â†’ Download JSON
        """
        client_id     = os.environ.get('GOOGLE_CLIENT_ID', '')
        client_secret = os.environ.get('GOOGLE_CLIENT_SECRET', '')
        redirect_uri  = os.environ.get('GOOGLE_REDIRECT_URI', '')
        project_id    = os.environ.get('GOOGLE_PROJECT_ID', '')

        if not client_id or not client_secret:
            raise RuntimeError(
                "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are not set. "
                "PLACEHOLDER: obtain these from Google Cloud Console â†’ "
                "APIs & Services â†’ Credentials â†’ OAuth 2.0 Client IDs."
            )

        client_config = {
            'web': {
                'client_id': client_id,
                'client_secret': client_secret,
                'project_id': project_id,
                'redirect_uris': [redirect_uri] if redirect_uri else [],
                'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
                'token_uri': 'https://oauth2.googleapis.com/token',
                'auth_provider_x509_cert_url': 'https://www.googleapis.com/oauth2/v1/certs',
            }
        }
        return cls(credential_store, client_config)

    def build_authorization_url(self, crm_user_id: str, redirect_uri: str, crm_username: str = '') -> Tuple[str, str]:
        """
        Initiate the OAuth flow. Returns (auth_url, state).
        The state is stored in the DB for multi-worker safety.
        """
        if not _GOOGLE_AVAILABLE:
            raise RuntimeError("google-auth-oauthlib is not installed")

        flow = Flow.from_client_config(
            self._client_config,
            scopes=_build_scopes(),
            redirect_uri=redirect_uri,
        )
        auth_url, state = flow.authorization_url(
            access_type='offline',
            prompt='consent',
            include_granted_scopes='true',
        )
        self._store.save_oauth_state(
            state,
            crm_user_id,
            crm_username=crm_username,
            code_verifier=getattr(flow, 'code_verifier', None),
        )
        return auth_url, state

    def handle_callback(
        self,
        state: str,
        authorization_response: str,
        redirect_uri: str,
    ) -> str:
        """
        Exchange the authorization code for tokens. Returns crm_user_id.
        Raises ValueError on state mismatch (CSRF guard).
        Raises RuntimeError on token exchange failure.
        """
        if not _GOOGLE_AVAILABLE:
            raise RuntimeError("google-auth-oauthlib is not installed")

        result = self._store.consume_oauth_state(state)
        if result is None:
            raise ValueError(
                "OAuth state not found â€” possible CSRF, expired flow, or worker mismatch"
            )
        crm_user_id, crm_username, code_verifier = result
        if not crm_user_id:
            raise ValueError("OAuth state missing CRM user id")

        flow = Flow.from_client_config(
            self._client_config,
            scopes=_build_scopes(),
            redirect_uri=redirect_uri,
            state=state,
        )
        fetch_kwargs = {'authorization_response': authorization_response}
        if code_verifier:
            fetch_kwargs['code_verifier'] = code_verifier
        flow.fetch_token(**fetch_kwargs)
        self._store.save(crm_user_id, flow.credentials, crm_username=crm_username)

        # Fetch the user's Google profile (email + stable subject ID) for display/auditing
        try:
            svc = build('oauth2', 'v2', credentials=flow.credentials)
            info = svc.userinfo().get().execute()
            self._store.update_google_profile(
                crm_user_id,
                email=info.get('email', ''),
                subject_id=info.get('id', ''),
                crm_username=crm_username,
            )
        except Exception:
            pass

        return crm_user_id


# ---------------------------------------------------------------------------
# GoogleApiClientFactory
# ---------------------------------------------------------------------------

class GoogleApiClientFactory:
    """
    Builds authenticated Google API clients with automatic token refresh.
    Returns None (instead of raising) when credentials are absent or invalid,
    so callers can respond with 401 rather than 500.
    """

    def __init__(self, credential_store: GoogleCredentialStore):
        self._store = credential_store

    # Permanent OAuth error codes â€” these mean the refresh token is invalidated
    # and the user must re-authenticate. Transient network failures should NOT
    # trigger account deactivation.
    _PERMANENT_REFRESH_ERRORS = ('invalid_grant', 'token_revoked', 'access_denied')

    def _get_fresh_credentials(self, crm_user_id: str, crm_username: str = '') -> Optional['Credentials']:
        if not _GOOGLE_AVAILABLE:
            return None
        creds = self._store.load(crm_user_id, crm_username=crm_username)
        if not creds:
            return None
        if creds.expired and creds.refresh_token:
            try:
                creds.refresh(Request())
                self._store.update_after_refresh(crm_user_id, creds, crm_username=crm_username)
            except google_exceptions.RefreshError as exc:
                # Detect permanent vs transient failures
                err_lower = str(exc).lower()
                permanent_reason = next(
                    (k for k in self._PERMANENT_REFRESH_ERRORS if k in err_lower), None
                )
                if permanent_reason:
                    logger.error(
                        "Permanent token failure for %s (%s) â€” marking reconnect required",
                        crm_user_id or crm_username, permanent_reason
                    )
                    self._store.mark_needs_reconnect(crm_user_id, permanent_reason, crm_username=crm_username)
                else:
                    logger.error("Token refresh failed for %s: %s", crm_user_id or crm_username, exc)
                return None
            except Exception as exc:
                logger.error("Token refresh failed for %s: %s", crm_user_id or crm_username, exc)
                return None
        return creds if creds.valid else None

    def calendar(self, crm_user_id: str = 'admin', crm_username: str = ''):
        creds = self._get_fresh_credentials(crm_user_id, crm_username=crm_username)
        return build('calendar', 'v3', credentials=creds) if creds else None

    def sheets(self, crm_user_id: str = 'admin', crm_username: str = ''):
        creds = self._get_fresh_credentials(crm_user_id, crm_username=crm_username)
        return build('sheets', 'v4', credentials=creds) if creds else None

    def drive(self, crm_user_id: str = 'admin', crm_username: str = ''):
        creds = self._get_fresh_credentials(crm_user_id, crm_username=crm_username)
        return build('drive', 'v3', credentials=creds) if creds else None

    def gmail(self, crm_user_id: str = 'admin', crm_username: str = ''):
        creds = self._get_fresh_credentials(crm_user_id, crm_username=crm_username)
        return build('gmail', 'v1', credentials=creds) if creds else None


# ---------------------------------------------------------------------------
# CalendarService
# ---------------------------------------------------------------------------

class CalendarService:
    """
    Google Calendar operations for the CRM.

    PLACEHOLDER: Enable the Google Calendar API before use:
      Google Cloud Console â†’ APIs & Services â†’ Library â†’
      "Google Calendar API" â†’ Enable
    """

    def __init__(self, client_factory: GoogleApiClientFactory):
        self._factory = client_factory

    def _svc(self, crm_user_id: str, crm_username: str = ''):
        svc = self._factory.calendar(crm_user_id, crm_username=crm_username)
        if not svc:
            raise RuntimeError(
                "Google Calendar not authenticated. "
                "Complete OAuth at /api/auth/google/login first."
            )
        return svc

    def _build_job_event_body(
        self,
        *,
        job_id: str,
        summary: str,
        location: str,
        scheduled_date: str,
        description: str = '',
        crm_base_url: str = '',
        recurrence: Optional[List[str]] = None,
        include_empty_recurrence: bool = False,
    ) -> Dict:
        full_desc = description
        if crm_base_url and job_id:
            full_desc = f"{description}\n\nCRM Record: {crm_base_url.rstrip('/')}/#jobs/{job_id}".strip()

        if 'T' in scheduled_date:
            start_end = {
                'start': {'dateTime': scheduled_date, 'timeZone': CALENDAR_TIMEZONE},
                'end':   {'dateTime': scheduled_date, 'timeZone': CALENDAR_TIMEZONE},
            }
        else:
            start_end = format_all_day_event(scheduled_date)

        event_body = {
            'summary': summary,
            'location': location,
            'description': full_desc,
            **start_end,
        }
        if recurrence or include_empty_recurrence:
            event_body['recurrence'] = recurrence or []
        return event_body

    def list_upcoming(self, crm_user_id: str = 'admin', max_results: int = 100, crm_username: str = '') -> List[Dict]:
        """Return upcoming primary calendar events."""
        svc = self._svc(crm_user_id, crm_username=crm_username)
        now = to_google_rfc3339_utc(datetime.now(timezone.utc))
        result = svc.events().list(
            calendarId='primary',
            timeMin=now,
            maxResults=max_results,
            singleEvents=True,
            orderBy='startTime',
        ).execute()
        return result.get('items', [])

    def get_busy_intervals(
        self,
        *,
        crm_user_id: str,
        time_min: datetime,
        time_max: datetime,
        timezone_name: str = CALENDAR_TIMEZONE,
        calendar_id: Optional[str] = None,
        crm_username: str = '',
    ) -> List[Dict]:
        svc = self._svc(crm_user_id, crm_username=crm_username)
        target_calendar_id = (calendar_id or get_main_scheduling_calendar_id()).strip()
        if not target_calendar_id:
            raise RuntimeError('Main scheduling calendar is not configured.')

        result = svc.freebusy().query(body={
            'timeMin': to_google_rfc3339(time_min),
            'timeMax': to_google_rfc3339(time_max),
            'timeZone': timezone_name,
            'items': [{'id': target_calendar_id}],
        }).execute()

        calendar_result = ((result.get('calendars') or {}).get(target_calendar_id) or {})
        if calendar_result.get('errors'):
            raise RuntimeError('Calendar freebusy lookup failed.')
        return calendar_result.get('busy') or []

    def create_job_event(
        self,
        crm_user_id: str,
        job_id: str,
        summary: str,
        location: str,
        scheduled_date: str,
        description: str = '',
        crm_base_url: str = '',
        recurrence: Optional[List[str]] = None,
        crm_username: str = '',
    ) -> Dict:
        """
        Create a calendar event for a CRM job (walkthrough, scheduled service, etc.).

        Args:
            scheduled_date: ISO date (YYYY-MM-DD) or datetime (YYYY-MM-DDTHH:MM:SS)
            crm_base_url: e.g. "https://crm.example.invalid" â€” linked in description

        Returns the created event dict. Store event['id'] as gcal_event_id in service_jobs.
        """
        svc = self._svc(crm_user_id, crm_username=crm_username)
        event_body = self._build_job_event_body(
            job_id=job_id,
            summary=summary,
            location=location,
            scheduled_date=scheduled_date,
            description=description,
            crm_base_url=crm_base_url,
            recurrence=recurrence,
        )
        created = svc.events().insert(calendarId='primary', body=event_body).execute()
        logger.info("Created calendar event %s for job %s", created.get('id'), job_id)
        return created

    def create_callback_reminder(
        self,
        crm_user_id: str,
        customer_name: str,
        callback_date: str,
        customer_phone: str = '',
        notes: str = '',
        crm_base_url: str = '',
        customer_id: str = '',
        crm_username: str = '',
    ) -> Dict:
        """Create a callback reminder event with a 1-hour popup and 24-hour email reminder."""
        svc = self._svc(crm_user_id, crm_username=crm_username)
        parts = [f"Call: {customer_phone}" if customer_phone else '', notes]
        if crm_base_url and customer_id:
            parts.append(f"CRM Record: {crm_base_url.rstrip('/')}/#customers/{customer_id}")
        description = '\n'.join(p for p in parts if p).strip()

        event_body = {
            'summary': f'Callback: {customer_name}',
            'description': description,
            **format_all_day_event(callback_date),
            'reminders': {
                'useDefault': False,
                'overrides': [
                    {'method': 'popup', 'minutes': 60},
                    {'method': 'email', 'minutes': 1440},
                ],
            },
        }
        created = svc.events().insert(calendarId='primary', body=event_body).execute()
        logger.info("Created callback reminder %s for %s", created.get('id'), customer_name)
        return created

    def update_event(self, crm_user_id: str, event_id: str, updates: Dict, crm_username: str = '') -> Dict:
        svc = self._svc(crm_user_id, crm_username=crm_username)
        return svc.events().patch(calendarId='primary', eventId=event_id, body=updates).execute()

    def update_job_event(
        self,
        crm_user_id: str,
        event_id: str,
        job_id: str,
        summary: str,
        location: str,
        scheduled_date: str,
        description: str = '',
        crm_base_url: str = '',
        recurrence: Optional[List[str]] = None,
        crm_username: str = '',
    ) -> Dict:
        svc = self._svc(crm_user_id, crm_username=crm_username)
        event_body = self._build_job_event_body(
            job_id=job_id,
            summary=summary,
            location=location,
            scheduled_date=scheduled_date,
            description=description,
            crm_base_url=crm_base_url,
            recurrence=recurrence,
            include_empty_recurrence=True,
        )
        updated = svc.events().patch(calendarId='primary', eventId=event_id, body=event_body).execute()
        logger.info("Updated calendar event %s for job %s", event_id, job_id)
        return updated

    def delete_event(self, crm_user_id: str, event_id: str, crm_username: str = '') -> None:
        svc = self._svc(crm_user_id, crm_username=crm_username)
        svc.events().delete(calendarId='primary', eventId=event_id).execute()
        logger.info("Deleted calendar event %s", event_id)


# ---------------------------------------------------------------------------
# SheetsService
# ---------------------------------------------------------------------------

class SheetsService:
    """
    Google Sheets export for CRM leads and estimates.

    PLACEHOLDER: Enable the Google Sheets API before use:
      Google Cloud Console â†’ APIs & Services â†’ Library â†’
      "Google Sheets API" â†’ Enable

    PLACEHOLDER: Create the spreadsheet manually in Google Sheets, then:
      - Add a tab named 'Leads' with header row:
          Name | Phone | Address | Status | Source | Form Type | Submitted At | Notes | Exported At
      - Add a tab named 'Estimates' with header row:
          Job # | Customer | Address | Service Type | Quoted | Actual | Status | Date | Notes | Exported At
      - Copy the spreadsheet ID from the URL and set GOOGLE_SHEETS_LEADS_SPREADSHEET_ID in .env
    """

    def __init__(self, client_factory: GoogleApiClientFactory):
        self._factory = client_factory

    def _svc(self, crm_user_id: str, crm_username: str = ''):
        svc = self._factory.sheets(crm_user_id, crm_username=crm_username)
        if not svc:
            raise RuntimeError(
                "Google Sheets not authenticated. "
                "Complete OAuth at /api/auth/google/login first."
            )
        return svc

    def append_lead_row(
        self,
        crm_user_id: str,
        spreadsheet_id: str,
        lead: Dict,
        sheet_name: str = 'Leads',
        crm_username: str = '',
    ) -> Dict:
        """
        Append one lead row to the Leads tab.

        Expected keys in lead: name, phone, address, status, source_page,
                                form_type, submitted_at, notes
        """
        svc = self._svc(crm_user_id, crm_username=crm_username)
        row = [
            lead.get('name', ''),
            lead.get('phone', ''),
            lead.get('address', ''),
            lead.get('status', ''),
            lead.get('source_page', ''),
            lead.get('form_type', ''),
            lead.get('submitted_at', ''),
            lead.get('notes', ''),
            to_google_rfc3339_utc(datetime.now(timezone.utc)),
        ]
        result = svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f'{sheet_name}!A1',
            valueInputOption='USER_ENTERED',
            insertDataOption='INSERT_ROWS',
            body={'values': [row]},
        ).execute()
        logger.info("Appended lead '%s' to sheet %s", lead.get('name'), spreadsheet_id)
        return result

    def append_estimate_row(
        self,
        crm_user_id: str,
        spreadsheet_id: str,
        job: Dict,
        sheet_name: str = 'Estimates',
        crm_username: str = '',
    ) -> Dict:
        """
        Append one job/estimate row to the Estimates tab.

        Expected keys in job: job_number, customer_name, address, service_type,
                               quoted_amount, actual_amount, status, scheduled_date, notes
        """
        svc = self._svc(crm_user_id, crm_username=crm_username)
        row = [
            job.get('job_number', ''),
            job.get('customer_name', ''),
            job.get('address', ''),
            job.get('service_type', ''),
            job.get('quoted_amount', 0),
            job.get('actual_amount', 0),
            job.get('status', ''),
            job.get('scheduled_date', ''),
            job.get('notes', ''),
            to_google_rfc3339_utc(datetime.now(timezone.utc)),
        ]
        result = svc.spreadsheets().values().append(
            spreadsheetId=spreadsheet_id,
            range=f'{sheet_name}!A1',
            valueInputOption='USER_ENTERED',
            insertDataOption='INSERT_ROWS',
            body={'values': [row]},
        ).execute()
        logger.info("Appended job #%s to sheet %s", job.get('job_number'), spreadsheet_id)
        return result

    def get_spreadsheet_info(self, crm_user_id: str, spreadsheet_id: str, crm_username: str = '') -> Dict:
        """Return spreadsheet title and tab names."""
        svc = self._svc(crm_user_id, crm_username=crm_username)
        meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
        return {
            'title': meta.get('properties', {}).get('title', ''),
            'sheets': [s['properties']['title'] for s in meta.get('sheets', [])],
            'url': meta.get('spreadsheetUrl', ''),
        }


# ---------------------------------------------------------------------------
# DriveService
# ---------------------------------------------------------------------------

class DriveService:
    """
    Google Drive folder and file management for the CRM.
    Uses drive.file scope â€” only files/folders created by this app are accessible.

    PLACEHOLDER: Enable the Google Drive API before use:
      Google Cloud Console â†’ APIs & Services â†’ Library â†’
      "Google Drive API" â†’ Enable

    PLACEHOLDER: Create a top-level folder named 'FieldOpsDemo' in Google Drive,
    then set its ID in GOOGLE_DRIVE_ROOT_FOLDER_ID in /opt/crm/.env.
    The service creates all sub-folders automatically under that root.

    Folder structure created per customer:
      FieldOpsDemo/
        â””â”€â”€ {####} - {Customer Name}/
              â”œâ”€â”€ Estimates/
              â””â”€â”€ Photos/
    """

    def __init__(self, client_factory: GoogleApiClientFactory):
        self._factory = client_factory

    def _svc(self, crm_user_id: str, crm_username: str = ''):
        svc = self._factory.drive(crm_user_id, crm_username=crm_username)
        if not svc:
            raise RuntimeError(
                "Google Drive not authenticated. "
                "Complete OAuth at /api/auth/google/login first."
            )
        return svc

    def create_folder(self, crm_user_id: str, name: str, parent_id: str = None, crm_username: str = '') -> Dict:
        """Create a Drive folder. Returns the folder resource (id, name, webViewLink)."""
        svc = self._svc(crm_user_id, crm_username=crm_username)
        metadata = {'name': name, 'mimeType': 'application/vnd.google-apps.folder'}
        if parent_id:
            metadata['parents'] = [parent_id]
        folder = svc.files().create(body=metadata, fields='id,name,webViewLink').execute()
        logger.info("Created Drive folder '%s' id=%s", name, folder.get('id'))
        return folder

    def create_customer_folder(
        self,
        crm_user_id: str,
        customer_number: int,
        customer_name: str,
        root_folder_id: str,
        crm_username: str = '',
    ) -> Dict:
        """
        Create the per-customer folder tree under root_folder_id.

        Returns:
            {customer_folder_id, customer_folder_url, estimates_folder_id, photos_folder_id}
        """
        folder_name = f"{customer_number:04d} - {customer_name}"
        customer = self.create_folder(crm_user_id, folder_name, root_folder_id, crm_username=crm_username)
        cid = customer['id']
        estimates = self.create_folder(crm_user_id, 'Estimates', cid, crm_username=crm_username)
        photos    = self.create_folder(crm_user_id, 'Photos',    cid, crm_username=crm_username)
        return {
            'customer_folder_id':  cid,
            'customer_folder_url': customer.get('webViewLink', ''),
            'estimates_folder_id': estimates['id'],
            'photos_folder_id':    photos['id'],
        }

    def upload_file(
        self,
        crm_user_id: str,
        filename: str,
        content: bytes,
        mime_type: str,
        parent_folder_id: str,
        crm_username: str = '',
    ) -> Dict:
        """Upload bytes to a Drive folder. Returns the file resource."""
        from googleapiclient.http import MediaInMemoryUpload
        svc = self._svc(crm_user_id, crm_username=crm_username)
        media = MediaInMemoryUpload(content, mimetype=mime_type, resumable=False)
        uploaded = svc.files().create(
            body={'name': filename, 'parents': [parent_folder_id]},
            media_body=media,
            fields='id,name,webViewLink,size',
        ).execute()
        logger.info("Uploaded '%s' (%d bytes) to Drive folder %s",
                    filename, len(content), parent_folder_id)
        return uploaded

    def list_files(self, crm_user_id: str, folder_id: str, crm_username: str = '') -> List[Dict]:
        """List non-trashed files in a Drive folder."""
        svc = self._svc(crm_user_id, crm_username=crm_username)
        result = svc.files().list(
            q=f"'{folder_id}' in parents and trashed=false",
            fields='files(id,name,mimeType,webViewLink,modifiedTime,size)',
        ).execute()
        return result.get('files', [])


# ---------------------------------------------------------------------------
# GmailSendService
# ---------------------------------------------------------------------------

class GmailSendService:
    """
    Gmail send-only integration. Feature-flagged via GMAIL_SEND_ENABLED.

    PLACEHOLDER: Enable the Gmail API before use:
      Google Cloud Console â†’ APIs & Services â†’ Library â†’
      "Gmail API" â†’ Enable

    PLACEHOLDER: gmail.send is a restricted OAuth scope and may require a
    Google verification review before external users can grant it.
    Review requirements at: https://support.google.com/cloud/answer/9110914

    This service never reads, modifies, or deletes messages â€” only sends.
    All attempts are logged to the gmail_send_log table.
    """

    def __init__(self, client_factory: GoogleApiClientFactory, db_path: str):
        self._factory = client_factory
        self._db_path = db_path
        self._enabled = os.environ.get('GMAIL_SEND_ENABLED', 'false').lower() == 'true'

    def _svc(self, crm_user_id: str, crm_username: str = ''):
        if not self._enabled:
            raise RuntimeError(
                "Gmail send is disabled. Set GMAIL_SEND_ENABLED=true in /opt/crm/.env to enable. "
                "PLACEHOLDER: review google.com/cloud/answer/9110914 before enabling."
            )
        svc = self._factory.gmail(crm_user_id, crm_username=crm_username)
        if not svc:
            raise RuntimeError(
                "Gmail not authenticated. "
                "Complete OAuth at /api/auth/google/login first."
            )
        return svc

    @contextmanager
    def _db(self):
        conn = sqlite3.connect(self._db_path)
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

    def send(
        self,
        crm_user_id: str,
        to: str,
        subject: str,
        body_text: str,
        body_html: str = '',
        customer_id: str = '',
        crm_username: str = '',
    ) -> Dict:
        """
        Send an email via Gmail API. Logs the attempt to gmail_send_log.

        Args:
            to:         Recipient email address
            subject:    Subject line
            body_text:  Plain-text body (always required)
            body_html:  Optional HTML body (creates multipart/alternative message)
            customer_id: CRM customer ID for the audit log (optional)
        """
        import email.mime.multipart
        import email.mime.text
        import base64

        if body_html:
            msg = email.mime.multipart.MIMEMultipart('alternative')
            msg.attach(email.mime.text.MIMEText(body_text, 'plain'))
            msg.attach(email.mime.text.MIMEText(body_html, 'html'))
        else:
            msg = email.mime.text.MIMEText(body_text, 'plain')

        msg['To'] = to
        msg['Subject'] = subject
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode('utf-8')

        svc = self._svc(crm_user_id, crm_username=crm_username)
        status, error_detail, message_id = 'sent', None, None
        try:
            result = svc.users().messages().send(userId='me', body={'raw': raw}).execute()
            message_id = result.get('id')
            logger.info("Gmail sent: to=%s subject='%s' id=%s", to, subject, message_id)
            return result
        except Exception as exc:
            status = 'error'
            error_detail = str(exc)
            logger.error("Gmail send failed: to=%s subject='%s' error=%s", to, subject, exc)
            raise
        finally:
            self._log_send(
                crm_user_id,
                customer_id,
                to,
                subject,
                message_id,
                status,
                error_detail,
                crm_username=crm_username,
            )

    def _log_send(
        self,
        crm_user_id: str,
        customer_id: str,
        to: str,
        subject: str,
        message_id: Optional[str],
        status: str,
        error_detail: Optional[str],
        crm_username: str = '',
    ) -> None:
        try:
            with self._db() as conn:
                conn.execute(
                    'INSERT INTO gmail_send_log '
                    '(crm_user, crm_user_id, customer_id, to_address, subject, message_id, status, error_detail) '
                    'VALUES (?,?,?,?,?,?,?,?)',
                    (
                        str(crm_username or '').strip(),
                        str(crm_user_id or '').strip(),
                        customer_id or None,
                        to,
                        subject,
                        message_id,
                        status,
                        error_detail,
                    )
                )
        except Exception as exc:
            logger.warning("Could not write to gmail_send_log: %s", exc)

    def send_quote(
        self,
        crm_user_id: str,
        customer_name: str,
        customer_email: str,
        service_type: str,
        quoted_amount: float,
        scheduled_date: str = '',
        notes: str = '',
        customer_id: str = '',
        crm_username: str = '',
    ) -> Dict:
        """Convenience: send a quote/estimate email."""
        subject = f"Your Quote from FieldOps Demo â€” {service_type}"
        lines = [
            f"Hi {customer_name},",
            "",
            "Thank you for reaching out to FieldOps Demo.",
            "",
            f"Service: {service_type}",
            f"Quoted Amount: ${quoted_amount:,.2f}",
        ]
        if scheduled_date:
            lines.append(f"Scheduled Date: {scheduled_date}")
        if notes:
            lines += ["", f"Notes: {notes}"]
        lines += [
            "",
            "If you have any questions, please don't hesitate to call us.",
            "",
            "Best regards,",
            "FieldOps Demo",
        ]
        return self.send(
            crm_user_id,
            customer_email,
            subject,
            '\n'.join(lines),
            customer_id=customer_id,
            crm_username=crm_username,
        )

    def send_followup(
        self,
        crm_user_id: str,
        customer_name: str,
        customer_email: str,
        message: str,
        customer_id: str = '',
        crm_username: str = '',
    ) -> Dict:
        """Convenience: send a follow-up email."""
        subject = "Follow-up from FieldOps Demo"
        body = f"Hi {customer_name},\n\n{message}\n\nBest regards,\nFieldOps Demo"
        return self.send(
            crm_user_id,
            customer_email,
            subject,
            body,
            customer_id=customer_id,
            crm_username=crm_username,
        )
