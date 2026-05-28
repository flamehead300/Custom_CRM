import importlib
from datetime import datetime

import pytest

from conftest import APP_DIR


def _google_services(monkeypatch):
    monkeypatch.syspath_prepend(str(APP_DIR))
    return importlib.import_module('google_services')


def test_google_rfc3339_helpers_format_chicago_timestamp(monkeypatch):
    google_services = _google_services(monkeypatch)
    dt = datetime(2026, 5, 6, 9, 0, 0, tzinfo=google_services.CHICAGO)

    assert google_services.to_google_rfc3339(dt) == '2026-05-06T09:00:00-05:00'
    assert google_services.to_google_rfc3339_utc(dt) == '2026-05-06T14:00:00Z'


def test_google_rfc3339_helpers_require_timezone_aware_datetime(monkeypatch):
    google_services = _google_services(monkeypatch)
    naive = datetime(2026, 5, 6, 9, 0, 0)

    with pytest.raises(ValueError, match='timezone-aware'):
        google_services.to_google_rfc3339(naive)

    with pytest.raises(ValueError, match='timezone-aware'):
        google_services.to_google_rfc3339_utc(naive)
