import importlib
import json

from conftest import authenticate_client, create_user, csrf_token, get_user, json_headers


def test_auth_me_identity_permissions(crm_app):
    user = create_user(crm_app, 'worker', 'worker-pass', role='employee', display_name='Worker One')
    client = crm_app.app.test_client()

    response = client.post('/login', data={'username': 'worker', 'password': 'worker-pass'})
    assert response.status_code == 302

    response = client.get('/api/auth/me')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['authenticated'] is True
    assert payload['mustChangePassword'] is False
    assert payload['user']['id'] == user['id']
    assert payload['user']['username'] == 'worker'
    assert payload['user']['displayName'] == 'Worker One'
    assert payload['permissions']['canEditCustomers'] is True
    assert payload['permissions']['canManageEmployees'] is False
    assert payload['permissions']['canManageUsers'] is False


def test_password_change_flow_backend_behavior(crm_app):
    create_user(crm_app, 'resetme', 'old-pass', role='employee', must_change_password=True)
    client = crm_app.app.test_client()

    response = client.post('/login', data={'username': 'resetme', 'password': 'old-pass'})
    assert response.status_code == 302

    response = client.get('/api/auth/me')
    assert response.status_code == 200
    assert response.get_json()['mustChangePassword'] is True

    response = client.get('/api/v1/customers')
    assert response.status_code == 403
    assert response.get_json()['mustChangePassword'] is True

    response = client.post(
        '/api/auth/change-password',
        json={'currentPassword': 'old-pass', 'newPassword': 'new-pass'},
    )
    assert response.status_code == 200
    assert response.get_json()['mustChangePassword'] is False

    response = client.get('/api/v1/customers')
    assert response.status_code == 200


def test_employee_can_create_and_update_operational_records(crm_app):
    employee = create_user(crm_app, 'ops', 'ops-pass', role='employee')
    client = crm_app.app.test_client()
    authenticate_client(client, crm_app, employee)
    token = csrf_token(client)
    headers = json_headers(token)

    response = client.post(
        '/api/v1/customers',
        headers=headers,
        json={
            'name': 'Demo Customer',
            'address': '100 Demo Way',
            'phone': '555-010-0001',
            'status': 'Lead',
        },
    )
    assert response.status_code == 201
    customer = response.get_json()

    response = client.put(
        f"/api/v1/customers/{customer['id']}",
        headers=headers,
        json={
            'name': 'Demo Customer Updated',
            'address': '100 Demo Way',
            'phone': '555-010-0002',
            'status': 'Customer',
            'notes': 'Updated',
            'ltv': 0,
            'customerNumber': customer['customerNumber'],
            'email': 'demo-customer@example.invalid',
            'cityStateZip': '',
            'markerEmoji': '',
        },
    )
    assert response.status_code == 200
    assert response.get_json()['name'] == 'Demo Customer Updated'

    response = client.post(
        '/api/v1/contact-events',
        json={
            'customerId': customer['id'],
            'eventType': 'note',
            'subject': 'Called customer',
            'bodySummary': 'Operational note',
        },
    )
    assert response.status_code == 201

    response = client.put(
        f"/api/v1/customers/{customer['id']}/contact-preferences",
        headers=headers,
        json={
            'phoneAllowed': True,
            'smsAllowed': True,
            'emailAllowed': True,
            'doNotContact': False,
            'preferredChannel': 'email',
            'preferredTimeWindow': '',
            'notes': 'Evenings',
        },
    )
    assert response.status_code == 200
    assert response.get_json()['preferredChannel'] == 'email'

    response = client.post(
        f"/api/v1/customers/{customer['id']}/followups",
        headers=headers,
        json={
            'dueAt': '2026-04-10',
            'subject': 'Call back',
        },
    )
    assert response.status_code == 201

    response = client.post(
        '/api/v1/jobs',
        headers=headers,
        json={
            'customerId': customer['id'],
            'address': '100 Demo Way',
            'serviceType': 'Window Cleaning',
            'serviceCategory': 'Window Cleaning',
            'frequency': 'One-Time',
            'quotedAmount': 125.0,
            'actualAmount': 0,
            'overheadSpent': 0,
            'status': 'Scheduled',
            'paymentStatus': 'Unpaid',
            'invoiceSent': False,
            'scheduledDate': '2026-04-20',
            'assignedEmployeeIds': [],
            'notes': 'Morning',
        },
    )
    assert response.status_code == 201
    job = response.get_json()

    response = client.put(
        f"/api/v1/jobs/{job['id']}",
        headers=headers,
        json={
            'customerId': customer['id'],
            'address': '100 Demo Way',
            'serviceType': 'Window Cleaning',
            'serviceCategory': 'Window Cleaning',
            'frequency': 'Quarterly',
            'quotedAmount': 125.0,
            'actualAmount': 120.0,
            'overheadSpent': 10.0,
            'status': 'Completed',
            'paymentStatus': 'Paid',
            'invoiceSent': True,
            'scheduledDate': '2026-04-20',
            'assignedEmployeeIds': [],
            'notes': 'Done',
            'gcalEventId': '',
        },
    )
    assert response.status_code == 200
    assert response.get_json()['status'] == 'Completed'

    response = client.post(
        f"/api/v1/customers/{customer['id']}/jobs",
        headers=headers,
        json={
            'serviceLabel': 'Quarterly Screens',
            'price': 200,
            'intervalMonths': 3,
            'weekSlot': 2,
            'startMonth': 4,
            'startYear': 2026,
            'status': 'active',
            'notes': 'Recurring',
        },
    )
    assert response.status_code == 201
    recurring = response.get_json()

    response = client.put(
        f"/api/v1/customer-jobs/{recurring['id']}",
        headers=headers,
        json={
            'serviceLabel': 'Quarterly Screens Updated',
            'price': 225,
            'intervalMonths': 3,
            'weekSlot': 3,
            'startMonth': 4,
            'startYear': 2026,
            'status': 'active',
            'notes': 'Updated recurring',
        },
    )
    assert response.status_code == 200
    assert response.get_json()['service_label'] == 'Quarterly Screens Updated'


def test_employee_blocked_from_admin_only_routes(crm_app):
    employee = create_user(crm_app, 'limited', 'limited-pass', role='employee')
    client = crm_app.app.test_client()
    authenticate_client(client, crm_app, employee)
    token = csrf_token(client)
    headers = json_headers(token)

    with crm_app.get_db() as db:
        customer = crm_app._insert_customer_record(db, {'name': 'Delete Me'})
        db.execute(
            '''INSERT INTO crm_intake_imports
               (website_submission_id, submission_uuid, imported_at, validation_status,
                customer_match_status, intake_status, source_page, form_type, submitted_at, raw_payload_json)
               VALUES (?,?,?,?,?,?,?,?,?,?)''',
            (
                1001,
                'submission-1',
                crm_app._utcnow_iso(),
                'valid',
                'unmatched',
                'new',
                'manual',
                'manual_paste',
                crm_app._utcnow_iso(),
                json.dumps({'customer': {}, 'service_request': {}, 'source_metadata': {}}),
            ),
        )
        intake_id = db.execute('SELECT last_insert_rowid()').fetchone()[0]

    response = client.get('/api/v1/employees')
    assert response.status_code == 403
    assert response.get_json()['requiredPermission'] == 'canManageEmployees'

    response = client.post('/api/v1/employees', headers=headers, json={'name': 'Nope'})
    assert response.status_code == 403

    response = client.post('/api/v1/intake-imports/manual', json={'rawText': 'sample'})
    assert response.status_code == 403

    response = client.post(
        f'/api/v1/intake-imports/{intake_id}/convert',
        headers=headers,
        json={'action': 'create_new'},
    )
    assert response.status_code == 403

    response = client.post('/api/v1/export/sheets/leads', headers=headers, json={})
    assert response.status_code == 403

    response = client.delete(f"/api/v1/customers/{customer['id']}", headers=headers)
    assert response.status_code == 403
    assert response.get_json()['requiredPermission'] == 'canExecuteDelete'

    response = client.get('/api/auth/me')
    payload = response.get_json()
    assert payload['permissions']['canManageUsers'] is False
    assert payload['permissions']['canExportSheets'] is False
    assert payload['permissions']['canExecuteDelete'] is False


def test_employee_directory_payload_is_safe(crm_app):
    employee = create_user(crm_app, 'directory-user', 'directory-pass', role='employee')
    client = crm_app.app.test_client()
    authenticate_client(client, crm_app, employee)

    with crm_app.get_db() as db:
        db.execute(
            'INSERT INTO employees (id,name,team,active,included_in_labor,gets_admin_override,gets_marketing_override,labor_weight,admin_weight,marketing_weight) '
            'VALUES (?,?,?,?,?,?,?,?,?,?)',
            ('emp-active', 'Active Employee', 'labor', 1, 1, 0, 0, 1.0, 1.0, 1.0)
        )
        db.execute(
            'INSERT INTO employees (id,name,team,active,included_in_labor,gets_admin_override,gets_marketing_override,labor_weight,admin_weight,marketing_weight) '
            'VALUES (?,?,?,?,?,?,?,?,?,?)',
            ('emp-inactive', 'Inactive Employee', 'admin', 0, 0, 0, 0, 1.0, 1.0, 1.0)
        )

    response = client.get('/api/v1/employees/directory')
    assert response.status_code == 200
    payload = response.get_json()
    row = next(item for item in payload if item['id'] == 'emp-active')
    assert set(row.keys()) == {'id', 'name', 'team', 'active'}
    assert any(item['id'] == 'emp-inactive' and item['active'] is False for item in payload)


def test_admin_thread_visibility_for_admin_and_participants(crm_app):
    admin = get_user(crm_app, 'admin')
    employee_one = create_user(crm_app, 'thread-one', 'pass-one', role='employee')
    employee_two = create_user(crm_app, 'thread-two', 'pass-two', role='employee')

    employee_client = crm_app.app.test_client()
    authenticate_client(employee_client, crm_app, employee_one)
    employee_headers = json_headers(csrf_token(employee_client))
    response = employee_client.post(
        '/api/v1/admin-threads',
        headers=employee_headers,
        json={
            'threadType': 'message',
            'subject': 'Need help',
            'initialMessage': 'Please review job details.',
        },
    )
    assert response.status_code == 201
    thread_one = response.get_json()

    second_client = crm_app.app.test_client()
    authenticate_client(second_client, crm_app, employee_two)
    second_headers = json_headers(csrf_token(second_client))
    response = second_client.post(
        '/api/v1/admin-threads',
        headers=second_headers,
        json={
            'threadType': 'message',
            'subject': 'Another thread',
            'initialMessage': 'Separate request.',
        },
    )
    assert response.status_code == 201
    thread_two = response.get_json()

    response = employee_client.get('/api/v1/admin-threads')
    assert response.status_code == 200
    assert [item['id'] for item in response.get_json()] == [thread_one['id']]

    response = employee_client.get(f"/api/v1/admin-threads/{thread_two['id']}")
    assert response.status_code == 404

    admin_client = crm_app.app.test_client()
    authenticate_client(admin_client, crm_app, admin)
    admin_headers = json_headers(csrf_token(admin_client))
    response = admin_client.get('/api/v1/admin-threads')
    assert response.status_code == 200
    thread_ids = {item['id'] for item in response.get_json()}
    assert thread_one['id'] in thread_ids
    assert thread_two['id'] in thread_ids

    response = admin_client.patch(
        f"/api/v1/admin-threads/{thread_two['id']}",
        headers=admin_headers,
        json={'addParticipantUserIds': [employee_one['id']]},
    )
    assert response.status_code == 200

    response = employee_client.get(f"/api/v1/admin-threads/{thread_two['id']}")
    assert response.status_code == 200


def test_deletion_request_execution_soft_deletes_only(crm_app):
    admin = get_user(crm_app, 'admin')
    client = crm_app.app.test_client()
    authenticate_client(client, crm_app, admin)
    headers = json_headers(csrf_token(client))

    with crm_app.get_db() as db:
        customer = crm_app._insert_customer_record(db, {'name': 'Delete Later'})

    response = client.post(
        '/api/v1/admin-threads',
        headers=headers,
        json={
            'threadType': 'deletion_request',
            'subject': 'Delete customer',
            'initialMessage': 'Approved for deletion.',
            'targetKind': 'customer',
            'targetId': customer['id'],
            'customerId': customer['id'],
        },
    )
    assert response.status_code == 201
    thread = response.get_json()

    response = client.post(
        f"/api/v1/admin-threads/{thread['id']}/execute-delete",
        headers=headers,
        json={},
    )
    assert response.status_code == 200
    assert response.get_json()['status'] == 'executed'

    with crm_app.get_db() as db:
        deleted_row = db.execute('SELECT * FROM customers WHERE id=?', (customer['id'],)).fetchone()
    assert deleted_row is not None
    assert deleted_row['deleted_at']

    response = client.get('/api/v1/customers')
    assert customer['id'] not in {item['id'] for item in response.get_json()}

    response = client.get('/api/v1/customers?include_deleted=1')
    assert customer['id'] in {item['id'] for item in response.get_json()}


def test_customer_soft_delete_blocked_when_jobs_exist(crm_app):
    admin = get_user(crm_app, 'admin')
    client = crm_app.app.test_client()
    authenticate_client(client, crm_app, admin)
    headers = json_headers(csrf_token(client))

    with crm_app.get_db() as db:
        customer = crm_app._insert_customer_record(db, {'name': 'Has Jobs'})
        crm_app._insert_service_job_record(
            db,
            {
                'customerId': customer['id'],
                'address': '300 Demo Service Way',
                'serviceType': 'Window Cleaning',
                'serviceCategory': 'Window Cleaning',
                'frequency': 'One-Time',
                'scheduledDate': '2026-05-01',
            },
        )

    response = client.delete(f"/api/v1/customers/{customer['id']}", headers=headers)
    assert response.status_code == 409
    payload = response.get_json()
    assert payload['serviceJobs'] == 1

    with crm_app.get_db() as db:
        row = db.execute('SELECT * FROM customers WHERE id=?', (customer['id'],)).fetchone()
    assert row['deleted_at'] == ''


def test_google_linkage_backfill_and_state_storage_use_crm_user_id(crm_app):
    user = create_user(crm_app, 'google-worker', 'google-pass', role='employee')

    with crm_app.get_db() as db:
        db.execute(
            'INSERT INTO google_linked_accounts (crm_user, crm_user_id) VALUES (?, ?)',
            ('google-worker', None),
        )

    crm_app.init_db()

    with crm_app.get_db() as db:
        row = db.execute(
            'SELECT crm_user_id FROM google_linked_accounts WHERE crm_user=?',
            ('google-worker',)
        ).fetchone()
    assert row['crm_user_id'] == user['id']

    google_services = importlib.import_module('google_services')
    store = object.__new__(google_services.GoogleCredentialStore)
    store._db_path = str(crm_app.CRM_DB_PATH)
    store.save_oauth_state('state-123', user['id'], crm_username='google-worker', code_verifier='verifier-1')

    with crm_app.get_db() as db:
        state_row = db.execute(
            'SELECT crm_user, crm_user_id, code_verifier FROM google_oauth_states WHERE state=?',
            ('state-123',)
        ).fetchone()
    assert state_row['crm_user'] == 'google-worker'
    assert state_row['crm_user_id'] == user['id']
    assert state_row['code_verifier'] == 'verifier-1'

    consumed = store.consume_oauth_state('state-123')
    assert consumed == (user['id'], 'google-worker', 'verifier-1')
