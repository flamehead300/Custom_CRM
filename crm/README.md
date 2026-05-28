# FieldOps Demo CRM

This folder is a sanitized local demo slice of the CRM. It keeps the selected backend, frontend, pricing, and test files while excluding runtime data, deployment files, and real credentials.

## Included

- `app/` selected CRM backend modules
- `web/` login and shell templates
- `static/` CRM frontend and vendor bundles
- `config/pricing.json`
- `config/.env.example`
- selected `tests/`

## Quick start

1. Create and activate a virtual environment.
2. Install dependencies with `python -m pip install -r requirements.txt`.
3. Set environment variables from `config/.env.example`.
4. Start the app using the copied CRM entrypoint you normally use for local Flask execution in this workspace.

## Validation

- Run `pytest tests/test_public_availability.py tests/test_google_services.py tests/test_backend_users.py`
- Use placeholder credentials and URLs only.
- Keep `.env`, databases, tokens, exports, and generated receipts out of git.
