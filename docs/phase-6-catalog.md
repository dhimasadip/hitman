# Phase 6 — API specifications, catalog, collections, and request versions

**Date:** 2026-10-27
**Status:** Complete for the agreed Phase 6 scope.

## Decisions applied

- A project can have **multiple logical OpenAPI specifications**.
- Each logical specification has immutable versions and a current-version pointer.
- OpenAPI **3.0.x/3.1.x** are supported; **3.2.x is rejected**.
- Parser/validator: `@redocly/openapi-core` with the `struct` rule.
- Import sources: raw/file upload and the linked mock repository path. Remote
  HTTPS URL import is deferred to Phase 15.
- External/remote `$ref` values are rejected before parsing.
- Request bodies: none, JSON, text/raw, URL-encoded, and multipart metadata.
  Binary/object-storage bodies are deferred.
- Auth config: none, bearer, basic, and API-key header/query with **secret
  references only**. No secret resolution in Phase 6.
- Manual/API-created requests start as `draft`.
- `project_admin` and `editor` write catalog/resources; `executor` and `viewer`
  read; organization read-only users cannot write; organization admins manage
  all projects.
- Source observation/link tables exist, but full MCP/provenance/idempotency
  workflow remains Phase 10.
- Phase 6 UI is catalog-only; the full request editor is Phase 7.

## Data model

Migration `0003_api_catalog.sql` adds:

- `api_specifications` — logical project specification, label, optional
  description, current version.
- `api_specification_versions` — immutable raw/parsed document versions,
  source kinds, content hash, validation status/report, creator.
- `api_operations` — version-scoped parsed operations with method/path,
  operation key, summary, tags, and operation JSONB.
- `collections` and nested `collection_folders`.
- `api_requests` — project/collection/folder/operation links, tags, lifecycle,
  execution scope, current version.
- `api_request_versions` — immutable method/path/query/header/auth/body/options
  snapshots.
- `api_request_source_observations` and `api_request_source_links` — provenance
  tables ready for Phase 10/15.
- Circular current-version pointers are created first, then set inside the same
  transaction after version insertion.

Raw OpenAPI content is stored in PostgreSQL with a **5 MiB** limit until object
storage exists. Identical normalized content hashes are deduplicated per
logical specification.

## OpenAPI behavior

- A project can import a new logical spec or add a version to an existing spec.
- Label defaults to `info.title`; importers may override it.
- 3.2.x returns a validation error and is not stored.
- Invalid 3.0/3.1 documents or documents with external refs are stored as
  failed versions; the last valid current version is preserved.
- Mock repository fixtures currently expose:
  - `acme/app-a` → `openapi/openapi.yaml` (3.0)
  - `platform/shared-api` → `api/openapi.yaml` (3.1)
- Parsed operations are replaced per version; old version operations remain
  intact for history.
- Operation links on requests point to version-specific operations and are not
  silently rewritten when a new spec version is imported.

## API

- `GET/POST /api/v1/projects/:projectId/specifications[/import]`
- `GET /api/v1/projects/:projectId/specifications/:specificationId`
- `GET /api/v1/projects/:projectId/operations`
- `GET/POST /api/v1/projects/:projectId/collections`
- `PATCH/DELETE /api/v1/projects/:projectId/collections/:collectionId`
- `POST /api/v1/projects/:projectId/collections/:collectionId/folders`
- `PATCH/DELETE .../folders/:folderId`
- `GET/POST /api/v1/projects/:projectId/requests`
- `GET/PATCH /api/v1/requests/:requestId`
- `POST /api/v1/requests/:requestId/archive`
- `GET /api/v1/requests/:requestId/versions`
- `GET /api/v1/requests/:requestId/versions/:versionId`

Request updates create a new immutable version when the executable definition
changes. `expectedVersionNumber` provides optimistic concurrency. Metadata-only
updates do not create a version.

## UI

Project workspace **Catalog** tab:

- Logical specifications, current version, validation status, version history.
- File upload and mock repository-path import.
- Validation errors/warnings display.
- Operations browser with search and method filter.
- Collections and nested folder display; create/delete-empty actions.
- Request list with method/path/lifecycle/tags/search filters.
- Read-only request detail and version history.
- No request editor or request creation form; Phase 7.

## Verification

`apps/server/tests/catalog.integration.test.ts` contains 10 PostgreSQL-backed
tests covering:

- 3.0 import and operation extraction;
- multiple logical specs, new versions, and content deduplication;
- 3.2 rejection without creating a spec;
- invalid import preservation of the last valid current version;
- mock repository-path import;
- collection/folder creation and empty-only deletion;
- draft request creation, immutable versions, ordered duplicate entries,
  optimistic concurrency, and old-version retrieval;
- tag/method/search filters and archive read-only behavior;
- editor write vs viewer read permissions;
- plaintext auth references and unknown collection IDs rejected.

`pnpm verify` covers the full suite, typecheck, builds, Go tests, and audit.

## Known limitations / next phases

- Remote OpenAPI URL import and spec diffing are Phase 15.
- Full request editor, URL preview, response panel, and request creation UI are
  Phase 7.
- Source observations/source links and MCP idempotent creation are Phase 10.
- Environments, target resolution, secrets resolution, and execution are later.
- Binary/object-storage bodies are deferred.
- Request restore after archive and collection reassignment UI are later.
