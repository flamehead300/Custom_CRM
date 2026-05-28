import json

import pytest


class FakeCalendar:
    def __init__(self, busy_intervals=None, error=None):
        self._busy_intervals = list(busy_intervals or [])
        self._error = error

    def get_busy_intervals(self, **kwargs):
        if self._error:
            raise self._error
        return list(self._busy_intervals)


def _auth_headers():
    return {
        'X-Internal-Availability-Token': 'test-availability-token',
    }


def _local_request(client, path, **kwargs):
    return client.get(path, environ_overrides={'REMOTE_ADDR': '127.0.0.1'}, **kwargs)


def _setup_calendar(crm_app, monkeypatch, busy_intervals=None, error=None):
    monkeypatch.setenv('INTERNAL_AVAILABILITY_TOKEN', 'test-availability-token')
    monkeypatch.setenv('MAIN_SCHEDULING_CALENDAR_ID', 'schedule@example.invalid')
    crm_app._GOOGLE_SERVICES_READY = True
    crm_app._g_calendar = FakeCalendar(busy_intervals=busy_intervals, error=error)


def test_internal_public_availability_requires_internal_token(crm_app, monkeypatch):
    _setup_calendar(crm_app, monkeypatch, busy_intervals=[])
    client = crm_app.app.test_client()

    response = _local_request(client, '/internal/public-availability?start=2026-04-30&days=1')

    assert response.status_code == 403
    assert response.get_json()['error'] == 'forbidden'


@pytest.mark.parametrize(
    ('busy_intervals', 'expected_am', 'expected_pm'),
    [
        ([{'start': '2026-04-30T09:30:00-05:00', 'end': '2026-04-30T10:30:00-05:00'}], False, True),
        ([{'start': '2026-04-30T12:00:00-05:00', 'end': '2026-04-30T13:00:00-05:00'}], True, False),
        ([{'start': '2026-04-30T11:00:00-05:00', 'end': '2026-04-30T13:00:00-05:00'}], False, False),
        ([{'start': '2026-04-30T00:00:00-05:00', 'end': '2026-05-01T00:00:00-05:00'}], False, False),
    ],
)
def test_internal_public_availability_slot_overlap_rules(crm_app, monkeypatch, busy_intervals, expected_am, expected_pm):
    _setup_calendar(crm_app, monkeypatch, busy_intervals=busy_intervals)
    client = crm_app.app.test_client()

    response = _local_request(
        client,
        '/internal/public-availability?start=2026-04-30&days=1',
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['timezone'] == 'America/Chicago'
    assert payload['availabilityReliable'] is True
    assert payload['days'][0]['date'] == '2026-04-30'
    assert payload['days'][0]['slots']['am']['label'] == '9:00 AM'
    assert payload['days'][0]['slots']['pm']['label'] == '12:00 PM'
    assert payload['days'][0]['slots']['am']['available'] is expected_am
    assert payload['days'][0]['slots']['pm']['available'] is expected_pm
    assert response.headers['Cache-Control'] == 'no-store, no-cache, must-revalidate, max-age=0'
    assert response.headers['Pragma'] == 'no-cache'


def test_internal_public_availability_response_is_sanitized(crm_app, monkeypatch):
    _setup_calendar(
        crm_app,
        monkeypatch,
        busy_intervals=[{'start': '2026-04-30T09:30:00-05:00', 'end': '2026-04-30T10:30:00-05:00'}],
    )
    client = crm_app.app.test_client()

    response = _local_request(
        client,
        '/internal/public-availability?start=2026-04-30&days=2',
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert sorted(payload.keys()) == ['availabilityReliable', 'days', 'timezone']
    text = json.dumps(payload).lower()
    for forbidden in ('summary', 'description', 'attendees', 'location', 'eventid', 'token', 'calendarid'):
        assert forbidden not in text


def test_internal_public_availability_failure_is_generic(crm_app, monkeypatch):
    _setup_calendar(crm_app, monkeypatch, error=RuntimeError('boom'))
    client = crm_app.app.test_client()

    response = _local_request(
        client,
        '/internal/public-availability?start=2026-04-30&days=1',
        headers=_auth_headers(),
    )

    assert response.status_code == 503
    assert response.get_json() == {
        'error': 'availability_unavailable',
        'availabilityReliable': False,
    }


def test_internal_public_availability_month_summary_requires_internal_token(crm_app, monkeypatch):
    _setup_calendar(crm_app, monkeypatch, busy_intervals=[])
    client = crm_app.app.test_client()

    response = _local_request(client, '/internal/public-availability/month-summary?start=2026-05-15&months=12')

    assert response.status_code == 403
    assert response.get_json()['error'] == 'forbidden'


def test_internal_public_availability_month_summary_returns_twelve_months(crm_app, monkeypatch):
    _setup_calendar(crm_app, monkeypatch, busy_intervals=[])
    client = crm_app.app.test_client()

    response = _local_request(
        client,
        '/internal/public-availability/month-summary?start=2026-05-15&months=12',
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['timezone'] == 'America/Chicago'
    assert payload['availabilityReliable'] is True
    assert len(payload['months']) == 12
    assert payload['months'][0] == {
        'monthKey': '2026-05',
        'label': 'May 2026',
        'monthStart': '2026-05-15',
        'monthEnd': '2026-05-31',
        'firstAvailableDate': '2026-05-15',
        'firstAvailableDisplay': 'Fri, May 15',
        'hasAvailability': True,
    }
    assert payload['months'][-1]['monthKey'] == '2027-04'
    assert payload['months'][-1]['monthStart'] == '2027-04-01'
    assert payload['months'][-1]['monthEnd'] == '2027-04-30'
    assert response.headers['Cache-Control'] == 'no-store, no-cache, must-revalidate, max-age=0'
    assert response.headers['Pragma'] == 'no-cache'


def test_internal_public_availability_month_summary_skips_weekends_for_first_available_date(crm_app, monkeypatch):
    _setup_calendar(crm_app, monkeypatch, busy_intervals=[])
    client = crm_app.app.test_client()

    response = _local_request(
        client,
        '/internal/public-availability/month-summary?start=2026-08-01&months=1',
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['months'][0]['firstAvailableDate'] == '2026-08-03'
    assert payload['months'][0]['firstAvailableDisplay'] == 'Mon, Aug 3'
    assert payload['months'][0]['hasAvailability'] is True


def test_internal_public_availability_month_summary_returns_null_when_month_has_no_weekday_availability(crm_app, monkeypatch):
    _setup_calendar(
        crm_app,
        monkeypatch,
        busy_intervals=[{'start': '2026-05-01T00:00:00-05:00', 'end': '2026-06-01T00:00:00-05:00'}],
    )
    client = crm_app.app.test_client()

    response = _local_request(
        client,
        '/internal/public-availability/month-summary?start=2026-05-01&months=1',
        headers=_auth_headers(),
    )

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['months'][0] == {
        'monthKey': '2026-05',
        'label': 'May 2026',
        'monthStart': '2026-05-01',
        'monthEnd': '2026-05-31',
        'firstAvailableDate': None,
        'firstAvailableDisplay': '',
        'hasAvailability': False,
    }
