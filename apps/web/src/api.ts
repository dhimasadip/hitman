import type {
  AddOrganizationMemberRequest,
  AddTeamMemberRequest,
  AuditEvent,
  ChangePasswordRequest,
  CreateTeamRequest,
  LoginRequest,
  OrganizationDetail,
  OrganizationMember,
  OrganizationRole,
  OrganizationSummary,
  SessionResponse,
  TeamDetail,
  TeamRole,
  TeamSummary,
  UpdateOrganizationRequest,
} from "@hitman/contracts";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) return decodeURIComponent(trimmed.slice(prefix.length));
  }
  return null;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers = new Headers({ accept: "application/json" });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (!["GET", "HEAD"].includes(method)) {
    const csrf = readCookie("hitman_csrf");
    if (csrf) headers.set("x-csrf-token", csrf);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: "include",
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  let payload: unknown;
  if (response.status !== 204) {
    const text = await response.text();
    if (text.length > 0) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = undefined;
      }
    }
  }

  if (!response.ok) {
    const error = payload as { error?: { message?: string; code?: string } } | undefined;
    throw new ApiClientError(
      error?.error?.message ?? `Request failed with HTTP ${response.status}`,
      response.status,
      error?.error?.code ?? null,
    );
  }

  return payload as T;
}

export function login(input: LoginRequest): Promise<SessionResponse> {
  return request("/api/v1/auth/login", { method: "POST", body: input });
}

export function getSession(): Promise<SessionResponse> {
  return request("/api/v1/auth/session");
}

export function logout(): Promise<void> {
  return request("/api/v1/auth/logout", { method: "POST" });
}

export function switchOrganization(organizationId: string): Promise<SessionResponse> {
  return request("/api/v1/auth/switch-organization", {
    method: "POST",
    body: { organizationId },
  });
}

export function changePassword(body: ChangePasswordRequest): Promise<void> {
  return request("/api/v1/auth/change-password", { method: "POST", body });
}

export function getOrganization(organizationId: string): Promise<OrganizationDetail> {
  return request(`/api/v1/organizations/${organizationId}`);
}

export function updateOrganization(
  organizationId: string,
  body: UpdateOrganizationRequest,
): Promise<OrganizationDetail> {
  return request(`/api/v1/organizations/${organizationId}`, { method: "PATCH", body });
}

export function listMembers(organizationId: string): Promise<{ members: OrganizationMember[] }> {
  return request(`/api/v1/organizations/${organizationId}/members`);
}

export function addMember(
  organizationId: string,
  body: AddOrganizationMemberRequest,
): Promise<OrganizationMember> {
  return request(`/api/v1/organizations/${organizationId}/members`, {
    method: "POST",
    body,
  });
}

export function updateMemberRole(
  organizationId: string,
  userId: string,
  role: OrganizationRole,
): Promise<void> {
  return request(`/api/v1/organizations/${organizationId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
  });
}

export function removeMember(organizationId: string, userId: string): Promise<void> {
  return request(`/api/v1/organizations/${organizationId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function listTeams(organizationId: string): Promise<{ teams: TeamSummary[] }> {
  return request(`/api/v1/organizations/${organizationId}/teams`);
}

export function createTeam(organizationId: string, body: CreateTeamRequest): Promise<TeamSummary> {
  return request(`/api/v1/organizations/${organizationId}/teams`, {
    method: "POST",
    body,
  });
}

export function getTeam(organizationId: string, teamId: string): Promise<TeamDetail> {
  return request(`/api/v1/organizations/${organizationId}/teams/${teamId}`);
}

export function deleteTeam(organizationId: string, teamId: string): Promise<void> {
  return request(`/api/v1/organizations/${organizationId}/teams/${teamId}`, {
    method: "DELETE",
  });
}

export function addTeamMember(
  organizationId: string,
  teamId: string,
  body: AddTeamMemberRequest,
): Promise<void> {
  return request(`/api/v1/organizations/${organizationId}/teams/${teamId}/members`, {
    method: "POST",
    body,
  });
}

export function updateTeamMemberRole(
  organizationId: string,
  teamId: string,
  userId: string,
  role: TeamRole,
): Promise<void> {
  return request(`/api/v1/organizations/${organizationId}/teams/${teamId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
  });
}

export function removeTeamMember(
  organizationId: string,
  teamId: string,
  userId: string,
): Promise<void> {
  return request(`/api/v1/organizations/${organizationId}/teams/${teamId}/members/${userId}`, {
    method: "DELETE",
  });
}

export function listAuditEvents(organizationId: string): Promise<{ events: AuditEvent[] }> {
  return request(`/api/v1/organizations/${organizationId}/audit-events?limit=50`);
}

export interface Readiness {
  status: "ok" | "degraded" | "error";
  version: string;
  uptimeSeconds: number;
}

export async function fetchReadiness(): Promise<Readiness> {
  const response = await fetch(`${API_BASE_URL}/health/ready`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok && response.status !== 503) {
    throw new Error(`Readiness request failed with HTTP ${response.status}`);
  }
  return (await response.json()) as Readiness;
}

export type { AuditEvent, OrganizationMember, OrganizationSummary, TeamDetail, TeamSummary };
