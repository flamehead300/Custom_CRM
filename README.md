# github_safe

GitHub-safe combined repo seed for a field-service CRM demo and a self-contained public estimate page.

## Layout

- `crm/` contains the copied CRM slice with sanitized branding, placeholder contact details, demo-safe config, and selected tests.
- `site/clear-choice/` contains the copied estimate flow with local placeholder assets and neutralized contact links.
- `verify_github_safe.ps1` is the blocking safety check for secrets, old branding, live media references, and suspicious customer-looking data.

## Local validation

1. Run `pwsh ./verify_github_safe.ps1` from this folder.
2. Create git only in this folder when you are ready to stage files.
3. Follow `PUBLISH_CHECKLIST.md` before any publish step.

## Notes

- This seed intentionally excludes runtime data, databases, tokens, live exports, and deployment files.
- Branding, contact details, and placeholder assets were replaced only inside this copied repo.
- Original source repos were not modified and no git history was copied here.
