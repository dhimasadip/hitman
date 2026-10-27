import type {
  AddOrganizationMemberRequest,
  AddProjectMemberRequest,
  AddTeamMemberRequest,
  ApiOperationSummary,
  ApiRequestDetail,
  ApiRequestSummary,
  ApiRequestVersion,
  ApiRequestVersionSummary,
  ApiSpecificationDetail,
  ApiSpecificationSummary,
  ApiSpecificationVersionSummary,
  AuditEvent,
  ChangePasswordRequest,
  CollectionDetail,
  CollectionFolderSummary,
  CollectionSummary,
  CreateCollectionFolderRequest,
  CreateCollectionRequest,
  CreateProjectRequest,
  CreateRequestRequest,
  CreateTeamRequest,
  ImportSpecificationRequest,
  ImportSpecificationResponse,
  LinkRepositoryRequest,
  LoginRequest,
  MockRepository,
  OrganizationDetail,
  OrganizationMember,
  OrganizationRole,
  OrganizationSummary,
  ProjectDetail,
  ProjectMember,
  ProjectRepository,
  ProjectRole,
  ProjectStatusFilter,
  ProjectSummary,
  SessionResponse,
  TeamDetail,
  TeamRole,
  TeamSummary,
  UpdateCollectionFolderRequest,
  UpdateCollectionRequest,
  UpdateOrganizationRequest,
  UpdateProjectRequest,
  UpdateRepositoryRequest,
  UpdateRequestRequest,
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

export function listProjects(
  organizationId: string,
  options: { search?: string; status?: ProjectStatusFilter; limit?: number } = {},
): Promise<{ projects: ProjectSummary[] }> {
  const params = new URLSearchParams();
  if (options.search) params.set("q", options.search);
  if (options.status) params.set("status", options.status);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request(`/api/v1/organizations/${organizationId}/projects${query}`);
}

export function createProject(
  organizationId: string,
  body: CreateProjectRequest,
): Promise<ProjectDetail> {
  return request(`/api/v1/organizations/${organizationId}/projects`, {
    method: "POST",
    body,
  });
}

export function getProject(projectId: string): Promise<ProjectDetail> {
  return request(`/api/v1/projects/${projectId}`);
}

export function updateProject(
  projectId: string,
  body: UpdateProjectRequest,
): Promise<ProjectDetail> {
  return request(`/api/v1/projects/${projectId}`, { method: "PATCH", body });
}

export function archiveProject(projectId: string): Promise<ProjectDetail> {
  return request(`/api/v1/projects/${projectId}/archive`, { method: "POST" });
}

export function restoreProject(projectId: string): Promise<ProjectDetail> {
  return request(`/api/v1/projects/${projectId}/restore`, { method: "POST" });
}

export function listProjectMembers(projectId: string): Promise<{ members: ProjectMember[] }> {
  return request(`/api/v1/projects/${projectId}/members`);
}

export function addProjectMember(
  projectId: string,
  body: AddProjectMemberRequest,
): Promise<ProjectMember> {
  return request(`/api/v1/projects/${projectId}/members`, { method: "POST", body });
}

export function updateProjectMemberRole(
  projectId: string,
  userId: string,
  role: ProjectRole,
): Promise<void> {
  return request(`/api/v1/projects/${projectId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
  });
}

export function removeProjectMember(projectId: string, userId: string): Promise<void> {
  return request(`/api/v1/projects/${projectId}/members/${userId}`, { method: "DELETE" });
}

export function getProjectRepository(
  projectId: string,
): Promise<{ repository: ProjectRepository | null }> {
  return request(`/api/v1/projects/${projectId}/repository`);
}

export function listMockRepositories(
  projectId: string,
): Promise<{ repositories: MockRepository[] }> {
  return request(`/api/v1/projects/${projectId}/gitlab/repositories`);
}

export function linkRepository(
  projectId: string,
  body: LinkRepositoryRequest,
): Promise<ProjectRepository> {
  return request(`/api/v1/projects/${projectId}/repository`, { method: "POST", body });
}

export function updateRepository(
  projectId: string,
  body: UpdateRepositoryRequest,
): Promise<ProjectRepository> {
  return request(`/api/v1/projects/${projectId}/repository`, { method: "PATCH", body });
}

export function unlinkRepository(projectId: string): Promise<void> {
  return request(`/api/v1/projects/${projectId}/repository`, { method: "DELETE" });
}

export type { MockRepository, ProjectDetail, ProjectMember, ProjectRepository, ProjectSummary };

export function listSpecifications(
  projectId: string,
): Promise<{ specifications: ApiSpecificationSummary[] }> {
  return request(`/api/v1/projects/${projectId}/specifications`);
}

export function importSpecification(
  projectId: string,
  body: ImportSpecificationRequest,
): Promise<ImportSpecificationResponse> {
  return request(`/api/v1/projects/${projectId}/specifications/import`, {
    method: "POST",
    body,
  });
}

export function getSpecification(
  projectId: string,
  specificationId: string,
): Promise<ApiSpecificationDetail> {
  return request(`/api/v1/projects/${projectId}/specifications/${specificationId}`);
}

export function listOperations(
  projectId: string,
  options: { specificationId?: string; q?: string; method?: string } = {},
): Promise<{ operations: ApiOperationSummary[] }> {
  const params = new URLSearchParams();
  if (options.specificationId) params.set("specificationId", options.specificationId);
  if (options.q) params.set("q", options.q);
  if (options.method) params.set("method", options.method);
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request(`/api/v1/projects/${projectId}/operations${query}`);
}

export function listCollections(projectId: string): Promise<{ collections: CollectionDetail[] }> {
  return request(`/api/v1/projects/${projectId}/collections`);
}

export function createCollection(
  projectId: string,
  body: CreateCollectionRequest,
): Promise<CollectionSummary> {
  return request(`/api/v1/projects/${projectId}/collections`, { method: "POST", body });
}

export function updateCollection(
  projectId: string,
  collectionId: string,
  body: UpdateCollectionRequest,
): Promise<CollectionSummary> {
  return request(`/api/v1/projects/${projectId}/collections/${collectionId}`, {
    method: "PATCH",
    body,
  });
}

export function deleteCollection(projectId: string, collectionId: string): Promise<void> {
  return request(`/api/v1/projects/${projectId}/collections/${collectionId}`, {
    method: "DELETE",
  });
}

export function createFolder(
  projectId: string,
  collectionId: string,
  body: CreateCollectionFolderRequest,
): Promise<CollectionFolderSummary> {
  return request(`/api/v1/projects/${projectId}/collections/${collectionId}/folders`, {
    method: "POST",
    body,
  });
}

export function updateFolder(
  projectId: string,
  collectionId: string,
  folderId: string,
  body: UpdateCollectionFolderRequest,
): Promise<CollectionFolderSummary> {
  return request(`/api/v1/projects/${projectId}/collections/${collectionId}/folders/${folderId}`, {
    method: "PATCH",
    body,
  });
}

export function deleteFolder(
  projectId: string,
  collectionId: string,
  folderId: string,
): Promise<void> {
  return request(`/api/v1/projects/${projectId}/collections/${collectionId}/folders/${folderId}`, {
    method: "DELETE",
  });
}

export function listRequests(
  projectId: string,
  options: {
    q?: string;
    method?: string;
    path?: string;
    lifecycle?: string;
    collectionId?: string;
    folderId?: string;
    tag?: string;
    limit?: number;
  } = {},
): Promise<{ requests: ApiRequestSummary[] }> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return request(`/api/v1/projects/${projectId}/requests${query}`);
}

export function createRequest(
  projectId: string,
  body: CreateRequestRequest,
): Promise<ApiRequestDetail> {
  return request(`/api/v1/projects/${projectId}/requests`, { method: "POST", body });
}

export function getRequest(requestId: string): Promise<ApiRequestDetail> {
  return request(`/api/v1/requests/${requestId}`);
}

export function updateRequest(
  requestId: string,
  body: UpdateRequestRequest,
): Promise<ApiRequestDetail> {
  return request(`/api/v1/requests/${requestId}`, { method: "PATCH", body });
}

export function archiveRequest(requestId: string): Promise<ApiRequestDetail> {
  return request(`/api/v1/requests/${requestId}/archive`, { method: "POST" });
}

export function listRequestVersions(
  requestId: string,
): Promise<{ versions: ApiRequestVersionSummary[] }> {
  return request(`/api/v1/requests/${requestId}/versions`);
}

export function getRequestVersion(
  requestId: string,
  versionId: string,
): Promise<ApiRequestVersion> {
  return request(`/api/v1/requests/${requestId}/versions/${versionId}`);
}

export type {
  ApiOperationSummary,
  ApiRequestDetail,
  ApiRequestSummary,
  ApiRequestVersion,
  ApiRequestVersionSummary,
  ApiSpecificationDetail,
  ApiSpecificationSummary,
  ApiSpecificationVersionSummary,
  CollectionDetail,
  CollectionFolderSummary,
  CollectionSummary,
  ImportSpecificationRequest,
  ImportSpecificationResponse,
};
