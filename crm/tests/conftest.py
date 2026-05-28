import importlib.util
import sys
import uuid
from pathlib import Path

import pytest


CRM_ROOT = Path(__file__).resolve().parents[1]
APP_DIR = CRM_ROOT / 'app'
VENV_SITE_PACKAGES = CRM_ROOT / '.venv' / 'Lib' / 'site-packages'


@pytest.fixture
def crm_app(tmp_path, monkeypatch):
    monkeypatch.syspath_prepend(str(APP_DIR))
    monkeypatch.syspath_prepend(str(VENV_SITE_PACKAGES))
    monkeypatch.setenv('SECRET_KEY', 'test-secret-key')
    monkeypatch.setenv('CRM_PASSWORD_HASH', '')
    monkeypatch.setenv('CRM_USERNAME', 'admin')
    monkeypatch.setenv('CRM_DB_PATH', str(tmp_path / 'crm.db'))
    monkeypatch.setenv('DEMO_ENABLED', 'false')
    module_name = f'crm_server_test_{uuid.uuid4().hex}'
    spec = importlib.util.spec_from_file_location(module_name, APP_DIR / 'crm_server.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    yield module
    sys.modules.pop(module_name, None)


def create_user(module, username, password, *, role='employee', display_name=None, active=True, must_change_password=False, employee_id=None):
    now_iso = module._utcnow_iso()
    with module.get_db() as db:
        db.execute(
            'INSERT INTO crm_users '
            '(id, username, password_hash, role, display_name, employee_id, active, must_change_password, created_at, updated_at, last_login_at) '
            'VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            (
                module._stable_user_id(username),
                username,
                module.generate_password_hash(password),
                role,
                display_name or username,
                employee_id,
                1 if active else 0,
                1 if must_change_password else 0,
                now_iso,
                now_iso,
                '',
            )
        )
        return db.execute(
            'SELECT * FROM crm_users WHERE lower(username)=lower(?)',
            (username,)
        ).fetchone()


def get_user(module, username):
    with module.get_db() as db:
        return db.execute(
            'SELECT * FROM crm_users WHERE lower(username)=lower(?)',
            (username,)
        ).fetchone()


def authenticate_client(client, module, user_row):
    with client.session_transaction() as sess:
        sess.clear()
        for key, value in module._session_identity_payload(user_row).items():
            sess[key] = value


def csrf_token(client):
    response = client.get('/api/csrf-token')
    assert response.status_code == 200
    return response.get_json()['token']


def json_headers(token):
    return {
        'Content-Type': 'application/json',
        'X-CSRFToken': token,
    }
