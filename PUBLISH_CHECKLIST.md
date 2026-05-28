# Publish Checklist

1. Confirm .env is not tracked:
   `git status`

2. Confirm database files are not tracked:
   `git ls-files | grep -E "\.db|\.sqlite|\.sqlite3|data/|instance/"`

3. Confirm secrets are not tracked:
   `git grep -n "SECRET_KEY\|CRM_PASSWORD_HASH\|GOOGLE_CLIENT_SECRET\|refresh_token\|access_token"`

4. Confirm no real customer data is tracked:
   `git grep -n "phone\|email\|address\|customer\|gmail\|calendar"`

5. If any real secret was ever committed, rotate it before publishing.

The broad customer/email/address/calendar/gmail grep is informational, not automatically blocking, because those terms legitimately appear in source code.
