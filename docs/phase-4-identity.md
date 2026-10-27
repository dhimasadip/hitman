# Phase 4 — Identity, organizations, teams, and authorization

**Date:** 2026-10-27
**Status:** Complete for the approved native-auth scope. MCP OAuth authorization-server
endpoints are sequenced with the MCP endpoint in Phase 9.

## Decisions applied

- Native Hitman accounts use **password + Argon2id** (19 MiB memory, 2 passes,
  parallelism 1, 32-byte output). Password length is 12–128 characters.
- **No break-glass login** is enabled. Recovery is an administrator CLI password
  reset while the database is available. SAML federation remains a later
  additive login path.
- Web sessions are opaque 256-bit random tokens, stored only as SHA-256 hashes.
  Cookies are HttpOnly/SameSite=Lax/Secure (in staging/production) with a
  7-day default lifetime.
- CSRF uses a separate readable cookie plus `x-csrf-token` header, bound to the
  server-side session hash.
- Every organization/team operation goes through a centralized
  `AuthorizationService`; missing membership returns 404 to avoid resource
  existence disclosure, insufficient role within a known organization returns 403.
- The last organization administrator cannot be removed or demoted.

## Data model

Migration `0001_identity_foundation.sql` adds:

- `organizations`
- `users` (native credentials + future identity-link fields)
- `organization_memberships`
- `teams`, `team_memberships`
- `sessions`
- `audit_events`

`project_id` on `audit_events` is present for Phase 5 but intentionally has no
foreign key until the `projects` table exists. `external_subject` is currently
`native:<normalized email>`; SAML identity linking remains a future additive
model.

## Backend surface

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/session`
- `POST /api/v1/auth/logout`
- `POST /api/v1/auth/switch-organization`
- `POST /api/v1/auth/change-password`
- `GET /api/v1/organizations`
- `GET/PATCH /api/v1/organizations/:organizationId`
- `GET/POST /api/v1/organizations/:organizationId/members`
- `PATCH/DELETE /api/v1/organizations/:organizationId/members/:userId`
- `GET/POST /api/v1/organizations/:organizationId/teams`
- `GET/PATCH/DELETE /api/v1/organizations/:organizationId/teams/:teamId`
- `POST /api/v1/organizations/:organizationId/teams/:teamId/members`
- `PATCH/DELETE .../teams/:teamId/members/:userId`
- `GET /api/v1/organizations/:organizationId/audit-events`

Login is rate-limited per client IP (10 attempts per 60 seconds by default).
Unknown email and wrong password return the same generic message. Failed known
logins and all privileged changes are audited without passwords/tokens.

## Administrator provisioning

There is deliberately no self-registration or public user-creation endpoint.

```bash
HITMAN_BOOTSTRAP_PASSWORD='...' pnpm admin bootstrap \
  --org-name "Acme" --org-slug acme \
  --email admin@example.com --display-name "Admin"

HITMAN_USER_PASSWORD='...' pnpm admin add-member \
  --org-slug acme --email user@example.com \
  --display-name "User" --role member

pnpm admin create-team --org-slug acme --name "Platform" --slug platform
pnpm admin add-team-member --org-slug acme --team-slug platform \
  --email user@example.com --role member

HITMAN_NEW_PASSWORD='...' pnpm admin reset-password --email user@example.com
pnpm admin set-status --email user@example.com --status disabled
```

`set-status` disables/pends a user and revokes all their sessions; re-enabling
requires `--status active`.

Passwords are read from environment variables, never command-line arguments,
and are never printed. Prefer injecting the environment value from a secret
manager or a quiet prompt rather than typing it into shell history. New users
created through the UI's "add member" flow must first exist via the CLI; the UI
clearly explains that requirement.

## Frontend

- Login page with generic error handling.
- Authenticated app shell with organization switcher, user identity, sign-out.
- Overview with organization settings, readiness, session/session-security facts.
- Members management for organization admins.
- Team list/create/detail/member management.
- Audit view for organization admins.
- Inline password change.
- Loading, empty, error, forbidden, and no-organization states.

## Verification

`apps/server/tests/auth.integration.test.ts` (13 tests) runs against PostgreSQL and covers:

- login + cookie/session + logout;
- generic failure + login-failure audit;
- CSRF requirements;
- cross-organization ID guessing returns 404;
- member read vs admin write authorization;
- last-admin protection;
- team lifecycle and audit;
- session expiry and disabled accounts;
- password change revoking other sessions;
- adding an existing user from another organization;
- multi-organization switching;
- login rate limiting.

`pnpm verify` must pass all TypeScript/Go tests, type checks, and builds.
Local manual smoke: login with an unknown account returned `401` with the
generic envelope; web and session endpoints returned as expected.

## Known limitations / follow-ups

- Hitman OAuth 2.1 authorization-server endpoints and MCP bearer-resource
  validation are implemented with the MCP endpoint in Phase 9.
- No SAML/OIDC federation yet; no MFA or WebAuthn; no self-service invitations
  or email delivery; no break-glass account.
- Login rate limiting is in-memory per API process. Multi-replica deployments
  need a shared limiter (Phase 17) or sticky limits.
- No user session-management UI (view/revoke individual sessions); logout and
  password change revocation are implemented. Administrators can revoke all
  sessions with a password reset or `set-status`.
- No self-service account disable UI; the administrator CLI owns global user
  status.
- Password hashes use fixed policy parameters; automatic rehash-on-login is a
  later hardening task.
- Audit entries for unknown-email login attempts are not stored because the
  audit schema requires an organization ID; the structured log records the
  request without the submitted password.
