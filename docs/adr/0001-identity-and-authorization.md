# ADR 0001 — Identity and authorization

- **Status:** Accepted
- **Date:** 2026-10-27
- **Owners:** Product owner, engineering lead, security
- **PRD references:** §4, §8.1, §9.1, §15.1, §22 open decisions 1

## Context

Hitman is a company-wide API hub for humans and AI agents. Web users and MCP
clients need one authorization model. The product owner chose a self-hosted,
Hitman-native login with a later move to SAML federation, rather than depending
on an external identity product. The PRD requires remote MCP authorization to
follow current MCP behavior rather than a static-token-only custom flow.

## Decision

1. **Hitman owns the identity layer.** It stores users, organization
   memberships, teams, project memberships, sessions, and audit events. Login
   credentials are never stored in project/request tables.
2. **Hitman acts as an OAuth 2.1 authorization server** for first-party web and
   MCP clients. It exposes authorization-server metadata, dynamic client
   registration, authorization-code + PKCE, token, refresh, and revocation
   endpoints. The MCP endpoint is an OAuth resource server and validates access
   tokens on every request.
3. **Web sessions** use secure, HttpOnly, SameSite cookies. CSRF protection is
   required for state-changing browser requests. Access tokens are short-lived;
   refresh tokens are rotated and revocable.
4. **SAML is added later as federated login**, mapping assertions to the same
   Hitman user and membership records. It does not replace organization/project
   authorization, and it does not bypass MCP token validation. A break-glass
   native admin path may be retained only if security explicitly approves it.
5. **Authorization is centralized** in an authorization service called by both
   REST handlers and MCP tools. No route or tool may implement its own role
   check.
6. **Roles** follow the PRD:
   - Organization: `org_admin`, `member`, `read_only`.
   - Project: `project_admin`, `editor`, `executor`, `viewer`.
   - Team: `team_admin`, `member`, `viewer`; organization admins may manage
     teams regardless of team role.
   - Teams and environment/device policy can further restrict actions.
7. **Resource lookup never proves access.** Knowing a project, request, job, or
   device ID grants nothing; every lookup is scoped by the authenticated
   principal's membership and policy.
8. **Audit events** capture actor, action, resource, outcome, correlation ID,
   and safe metadata. They never contain passwords, tokens, or raw secrets.
9. **Device credentials are separate** from user and MCP credentials (ADR 0003).

The login factor (password + Argon2id, WebAuthn, or magic link) is a Phase 4
user-experience/security implementation detail and does not change these
component boundaries. It must be selected before implementing the login form.

## Consequences

- Phase 4 and Phase 9 together must implement OAuth discovery and MCP
  resource-server validation. Phase 4 delivers native session identity; Phase 9
  adds the authorization-server endpoints with the MCP route.
- MCP clients that support OAuth can use discovery/PKCE; clients that only
  support explicit headers remain testable in the Phase 2 disposable spike but
  are not the production authentication story.
- SAML federation is an additive identity-provider integration, not a schema
  rewrite.
- Security review must cover token audience/resource binding, PKCE, redirect URI
  validation, session fixation, CSRF, and refresh-token rotation.

## Implementation sequencing note (2026-10-27)

Phase 4 delivered the native credential, session, CSRF, organization/team,
authorization, audit, and administrator-provisioning foundation. The Hitman
OAuth 2.1 authorization-server endpoints and MCP resource-server validation are
implemented together with the hosted MCP endpoint in Phase 9, because no MCP
route exists before then. This is a delivery-order clarification, not a change
to the authentication architecture. No static-token-only production flow is
permitted.
