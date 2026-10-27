# Phase 5 — Projects and repository registration

**Date:** 2026-10-27
**Status:** Complete for the agreed Phase 5 scope.

## Decisions applied

- Organization admins are the only users who can create projects.
- Project access is **explicit project membership only**. `owner_team_id` is
  ownership metadata and never grants access.
- Organization admins implicitly have project-admin access to every project in
  their organization; regular members see only projects they belong to.
- Project members must already belong to the organization.
- A project always retains at least one `project_admin`. Organization admins can
  recover by assigning a new admin.
- One GitLab repository can be linked to one project in an organization.
- One project can have one repository in the MVP.
- GitLab is **mocked in Phase 5**. Live API, OAuth/PAT verification, webhooks,
  and reconciliation are Phase 15 work.
- OpenAPI file path is stored only; parsing/import starts in Phase 6.
- Projects are archived, not hard-deleted. Archived projects are read-only and
  hidden from the default active list.

## Data model

Migration `0002_projects_and_gitlab.sql` adds:

- `projects` — organization-scoped name/slug, optional owner team, description,
  active/archived status, settings, creator, timestamps.
- `project_memberships` — explicit `project_admin`, `editor`, `executor`, or
  `viewer` roles.
- `gitlab_connections` — organization connection metadata; Phase 5 uses
  `auth_mode='mock'` and `credential_secret_ref='env://GITLAB_MOCK_TOKEN'`.
- `gitlab_repositories` — stable external project ID, namespace/name/URL,
  default branch, OpenAPI path, mock webhook status.
- `audit_events.project_id` foreign key.
- Indexes/constraints for organization slug uniqueness, project membership,
  repository-per-project uniqueness, and repository-per-organization uniqueness.

No plaintext GitLab token is stored. Mock mode does not call GitLab.

## API

- `GET/POST /api/v1/organizations/:organizationId/projects`
- `GET/PATCH /api/v1/projects/:projectId`
- `POST /api/v1/projects/:projectId/archive`
- `POST /api/v1/projects/:projectId/restore`
- `GET/POST /api/v1/projects/:projectId/members`
- `PATCH/DELETE /api/v1/projects/:projectId/members/:userId`
- `GET /api/v1/projects/:projectId/repository`
- `GET /api/v1/projects/:projectId/gitlab/repositories` — mock fixture catalog
- `POST/PATCH/DELETE /api/v1/projects/:projectId/repository`

Project creation, member changes, repository changes, archive/restore, and
location-changing actions produce audit events. Cross-organization project IDs
return 404; known projects without the required role return 403.

## Mock GitLab

The fixture provider exposes:

- `acme/app-a` (`1001`) — default branch `main`, OpenAPI `openapi/openapi.yaml`
- `acme/app-b` (`1002`) — default branch `main`
- `platform/shared-api` (`1003`) — default branch `develop`, OpenAPI
  `api/openapi.yaml`

The first repository-list/link action lazily creates one mock connection per
organization. Mock repositories already linked in that organization are hidden
from other projects. The UI labels the source tab and repository as **Mock
GitLab**.

## Frontend

- Projects navigation, search, status filtering for organization admins.
- Create project form with optional owner team.
- Project workspace with Overview, Members, Source, and Settings.
- Project onboarding checklist clearly separates configured, optional, and
  later-phase items.
- Member add/role/remove management with last-admin errors.
- Mock repository picker and link flow.
- Repository details: namespace/name, URL, branch, external ID, mock webhook
  status, OpenAPI path editing, disconnect.
- Project metadata editing, archive/restore, read-only archived state.
- Loading, empty, error, and permission states.

## Verification

`apps/server/tests/projects.integration.test.ts` has 14 PostgreSQL-backed tests
covering:

- project creation without repository/specification/runner;
- organization-admin-only creation;
- organization-wide admin listing vs explicit member listing;
- search and owner-team metadata;
- last project administrator protection;
- cross-organization 404;
- archive/restore and archived mutation blocking;
- mock repository listing/link/update/unlink;
- one-repository-per-project/one-project-per-repository conflict;
- unsafe OpenAPI path rejection;
- project-admin and organization-admin management;
- organization read-only users cannot use project write access;
- organization-member removal cascading project membership;
- blocking organization removal of a project's last administrator;
- non-organization-member rejection.

`pnpm verify` covers the full suite, typecheck, builds, Go tests, and audit.

## Known limitations / Phase 6+ follow-ups

- No live GitLab API; the provider boundary is `GitLabProvider` and will be
  replaced/extended in Phase 15.
- No OpenAPI parsing/import; only the repository-relative path is stored.
- `editor`, `executor`, and `viewer` roles are enforced for project access, but
  request editing/execution permissions become meaningful in Phases 6–14.
- Project list has a bounded limit/search but no cursor pagination yet.
- No project deletion, transfer between organizations, or project templates.
- Owner teams are metadata only by decision.
- Project-level audit is available through the organization audit view.
