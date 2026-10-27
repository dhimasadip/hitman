import type {
  OrganizationMember,
  OrganizationRole,
  ProjectMember,
  ProjectRole,
  TeamSummary,
} from "@hitman/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import {
  ApiClientError,
  addProjectMember,
  archiveProject,
  getProject,
  getProjectRepository,
  linkRepository,
  listMockRepositories,
  listProjectMembers,
  removeProjectMember,
  restoreProject,
  unlinkRepository,
  updateProject,
  updateProjectMemberRole,
  updateRepository,
} from "../api.js";

type ProjectTab = "overview" | "members" | "source" | "settings";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

const roleLabels: Record<ProjectRole, string> = {
  project_admin: "Project admin",
  editor: "Editor",
  executor: "Executor",
  viewer: "Viewer",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleString();
}

export function ProjectWorkspace({
  projectId,
  isOrganizationAdmin,
  organizationRole,
  organizationMembers,
  teams,
  onBack,
}: {
  projectId: string;
  isOrganizationAdmin: boolean;
  organizationRole: OrganizationRole;
  organizationMembers: OrganizationMember[];
  teams: TeamSummary[];
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProjectTab>("overview");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ownerTeamId, setOwnerTeamId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<ProjectRole>("viewer");
  const [openapiPath, setOpenapiPath] = useState("");

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProject(projectId),
  });
  const membersQuery = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: () => listProjectMembers(projectId),
  });
  const repositoryQuery = useQuery({
    queryKey: ["project-repository", projectId],
    queryFn: () => getProjectRepository(projectId),
  });

  const project = projectQuery.data;
  const repository = repositoryQuery.data?.repository ?? null;
  const canManage = project?.role === "project_admin" && organizationRole !== "read_only";
  const isArchived = project?.status === "archived";
  const canEdit = Boolean(canManage && !isArchived);

  useEffect(() => {
    if (!project) return;
    setName(project.name);
    setDescription(project.description ?? "");
    setOwnerTeamId(project.ownerTeamId ?? "");
  }, [project]);

  useEffect(() => {
    setOpenapiPath(repository?.openapiFilePath ?? "");
  }, [repository]);

  const mockRepositoriesQuery = useQuery({
    queryKey: ["mock-repositories", projectId],
    queryFn: () => listMockRepositories(projectId),
    enabled: Boolean(
      project &&
        project.role === "project_admin" &&
        project.status === "active" &&
        repositoryQuery.isFetched &&
        !repository,
    ),
  });

  async function refreshProject(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-members", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project-repository", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["mock-repositories", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["projects"] }),
      queryClient.invalidateQueries({ queryKey: ["audit"] }),
    ]);
  }

  function clearNotices() {
    setError(null);
    setMessage(null);
  }

  async function handleArchiveToggle() {
    if (!project) return;
    clearNotices();
    if (
      !window.confirm(
        isArchived
          ? `Restore project "${project.name}"?`
          : `Archive project "${project.name}"? It becomes read-only.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      if (isArchived) {
        await restoreProject(projectId);
        setMessage("Project restored.");
      } else {
        await archiveProject(projectId);
        setMessage("Project archived. It is now read-only.");
      }
      await refreshProject();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to update project.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    try {
      await addProjectMember(projectId, {
        email: memberEmail,
        role: memberRole,
      });
      setMemberEmail("");
      setMemberRole("viewer");
      setMessage("Project member added.");
      await refreshProject();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to add member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleMemberRole(member: ProjectMember, role: ProjectRole) {
    clearNotices();
    setBusy(true);
    try {
      await updateProjectMemberRole(projectId, member.user.id, role);
      await refreshProject();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to update role.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(member: ProjectMember) {
    if (!window.confirm(`Remove ${member.user.displayName} from this project?`)) return;
    clearNotices();
    setBusy(true);
    try {
      await removeProjectMember(projectId, member.user.id);
      setMessage("Project member removed.");
      await refreshProject();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to remove member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLinkRepository(externalProjectId: string) {
    clearNotices();
    setBusy(true);
    try {
      await linkRepository(projectId, { externalProjectId });
      setMessage("Mock GitLab repository linked.");
      await refreshProject();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to link repository.");
    } finally {
      setBusy(false);
    }
  }

  async function handleOpenapiSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    try {
      await updateRepository(projectId, {
        openapiFilePath: openapiPath.trim() ? openapiPath.trim() : null,
      });
      setMessage("OpenAPI path updated.");
      await refreshProject();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Unable to update OpenAPI path.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleUnlinkRepository() {
    if (!window.confirm("Disconnect the repository from this project?")) return;
    clearNotices();
    setBusy(true);
    try {
      await unlinkRepository(projectId);
      setMessage("Repository disconnected.");
      await refreshProject();
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Unable to disconnect repository.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleSettingsSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    clearNotices();
    setBusy(true);
    try {
      await updateProject(projectId, {
        name,
        description: description.trim() ? description : null,
        ownerTeamId: ownerTeamId || null,
      });
      setMessage("Project settings updated.");
      await refreshProject();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to update project.");
    } finally {
      setBusy(false);
    }
  }

  if (projectQuery.isPending) {
    return <p className="text-sm text-slate-400">Loading project…</p>;
  }
  if (projectQuery.error || !project) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
        >
          ← Projects
        </button>
        <p
          role="alert"
          className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"
        >
          {projectQuery.error instanceof Error ? projectQuery.error.message : "Project not found."}
        </p>
      </div>
    );
  }

  const tabs: Array<{ id: ProjectTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "members", label: "Members" },
    { id: "source", label: "Source" },
    ...(isOrganizationAdmin || canManage ? [{ id: "settings" as const, label: "Settings" }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
          >
            ← Projects
          </button>
          <div>
            <h2 className="text-xl font-semibold text-white">{project.name}</h2>
            <p className="font-mono text-xs text-slate-500">{project.slug}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full border px-3 py-1 text-xs ${
              isArchived
                ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
                : "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
            }`}
          >
            {project.status}
          </span>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            {roleLabels[project.role]}
          </span>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : null}
      {message ? (
        <p
          role="status"
          className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200"
        >
          {message}
        </p>
      ) : null}

      <div className="flex gap-2 overflow-x-auto border-b border-white/10 pb-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === entry.id
                ? "bg-blue-500/15 text-blue-200"
                : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-base font-semibold text-white">Project overview</h3>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {project.description || "No description has been provided."}
            </p>
            <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <dt className="text-slate-500">Owner team</dt>
                <dd className="mt-1 text-slate-200">{project.ownerTeamName ?? "Not assigned"}</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <dt className="text-slate-500">Members</dt>
                <dd className="mt-1 text-slate-200">
                  {membersQuery.data?.members.length ?? project.memberCount}
                </dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <dt className="text-slate-500">Created by</dt>
                <dd className="mt-1 text-slate-200">{project.createdByName ?? "Unknown"}</dd>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <dt className="text-slate-500">Created</dt>
                <dd className="mt-1 text-slate-200">{formatDate(project.createdAt)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
            <h3 className="text-base font-semibold text-white">Onboarding checklist</h3>
            <ul className="mt-4 space-y-3 text-sm">
              <li className="flex items-start justify-between gap-3">
                <span className="text-slate-300">GitLab repository</span>
                <span className={repository ? "text-emerald-300" : "text-slate-500"}>
                  {repository
                    ? repository.mock
                      ? "Mock linked"
                      : "Linked"
                    : "Optional — not connected"}
                </span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span className="text-slate-300">OpenAPI document</span>
                <span
                  className={repository?.openapiFilePath ? "text-emerald-300" : "text-slate-500"}
                >
                  {repository?.openapiFilePath ?? "Optional — path not set"}
                </span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span className="text-slate-300">Environments</span>
                <span className="text-slate-500">Phase 8</span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span className="text-slate-300">MCP access</span>
                <span className="text-slate-500">Phase 9</span>
              </li>
              <li className="flex items-start justify-between gap-3">
                <span className="text-slate-300">Local runners</span>
                <span className="text-slate-500">Phase 11</span>
              </li>
            </ul>
            {canManage ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleArchiveToggle()}
                className={`mt-6 w-full rounded-lg border px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60 ${
                  isArchived
                    ? "border-emerald-400/30 text-emerald-200 hover:bg-emerald-400/10"
                    : "border-amber-400/30 text-amber-200 hover:bg-amber-400/10"
                }`}
              >
                {busy ? "Working…" : isArchived ? "Restore project" : "Archive project"}
              </button>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "members" ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-base font-semibold text-white">Project members</h3>
          <p className="mt-1 text-sm text-slate-400">
            Project access is explicit. Organization administrators can always manage the project.
            The last project administrator cannot be removed or demoted.
          </p>

          {canEdit ? (
            <form
              className="mt-5 grid gap-3 sm:grid-cols-[1fr_180px_auto]"
              onSubmit={handleAddMember}
            >
              <label className="text-sm font-medium text-slate-300">
                Organization member email
                <input
                  className={inputClass}
                  type="email"
                  list="organization-members"
                  required
                  value={memberEmail}
                  onChange={(event) => setMemberEmail(event.target.value)}
                  placeholder="member@company.com"
                />
                <datalist id="organization-members">
                  {organizationMembers.map((member) => (
                    <option key={member.user.id} value={member.user.email} />
                  ))}
                </datalist>
              </label>
              <label className="text-sm font-medium text-slate-300">
                Project role
                <select
                  className={inputClass}
                  value={memberRole}
                  onChange={(event) => setMemberRole(event.target.value as ProjectRole)}
                >
                  <option value="viewer">Viewer</option>
                  <option value="executor">Executor</option>
                  <option value="editor">Editor</option>
                  <option value="project_admin">Project admin</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={busy}
                className="mt-6 h-[42px] rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:opacity-60"
              >
                Add
              </button>
            </form>
          ) : null}

          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-xs tracking-wide text-slate-500 uppercase">
                  <th className="py-3 pr-4 font-medium">User</th>
                  <th className="py-3 pr-4 font-medium">Role</th>
                  <th className="py-3 pr-4 font-medium">Status</th>
                  {canEdit ? <th className="py-3 text-right font-medium">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {membersQuery.data?.members.map((member) => (
                  <tr key={member.user.id} className="border-b border-white/5">
                    <td className="py-3 pr-4">
                      <p className="text-slate-200">{member.user.displayName}</p>
                      <p className="text-xs text-slate-500">{member.user.email}</p>
                    </td>
                    <td className="py-3 pr-4">
                      {canEdit ? (
                        <select
                          className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-slate-200"
                          value={member.role}
                          disabled={busy}
                          onChange={(event) =>
                            void handleMemberRole(member, event.target.value as ProjectRole)
                          }
                        >
                          <option value="project_admin">Project admin</option>
                          <option value="editor">Editor</option>
                          <option value="executor">Executor</option>
                          <option value="viewer">Viewer</option>
                        </select>
                      ) : (
                        <span className="text-slate-300">{roleLabels[member.role]}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-slate-400">{member.user.status}</td>
                    {canEdit ? (
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void handleRemoveMember(member)}
                          className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/10 disabled:opacity-60"
                        >
                          Remove
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
                {membersQuery.data?.members.length === 0 ? (
                  <tr>
                    <td colSpan={canEdit ? 4 : 3} className="py-5 text-sm text-slate-500">
                      No project members.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {tab === "source" ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-white">Source repository</h3>
              <p className="mt-1 text-sm text-slate-400">
                Phase 5 uses a deterministic mock GitLab catalog. Live GitLab repository metadata
                and reconciliation arrive in Phase 15.
              </p>
            </div>
            <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">
              Mock GitLab
            </span>
          </div>

          {repositoryQuery.isPending ? (
            <p className="mt-5 text-sm text-slate-400">Loading source…</p>
          ) : repository ? (
            <div className="mt-5 grid gap-4 lg:grid-cols-[1.2fr_1fr]">
              <div className="rounded-xl border border-white/10 bg-black/20 p-5">
                <div className="flex items-center gap-2">
                  <p className="font-medium text-slate-100">
                    {repository.namespacePath}/{repository.repositoryName}
                  </p>
                  {repository.mock ? (
                    <span className="rounded-full border border-amber-400/30 px-2 py-0.5 text-[10px] text-amber-200">
                      MOCK
                    </span>
                  ) : null}
                </div>
                <p className="mt-2 break-all font-mono text-xs text-slate-500">
                  {repository.repositoryUrl}
                </p>
                <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-slate-500">Default branch</dt>
                    <dd className="text-slate-200">{repository.defaultBranch ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Webhook status</dt>
                    <dd className="text-slate-200">{repository.webhookStatus}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">GitLab external ID</dt>
                    <dd className="font-mono text-xs text-slate-300">
                      {repository.externalProjectId}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Last reconciled</dt>
                    <dd className="text-slate-300">
                      {repository.lastReconciledAt
                        ? formatDate(repository.lastReconciledAt)
                        : "Not yet"}
                    </dd>
                  </div>
                </dl>
                {canEdit ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleUnlinkRepository()}
                    className="mt-5 rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/10 disabled:opacity-60"
                  >
                    Disconnect repository
                  </button>
                ) : null}
              </div>

              <form
                className="rounded-xl border border-white/10 bg-black/20 p-5"
                onSubmit={handleOpenapiSave}
              >
                <h4 className="text-sm font-semibold text-slate-200">OpenAPI file path</h4>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Repository-relative path. Phase 5 stores the path only; parsing and import arrive
                  in Phase 6.
                </p>
                <input
                  className={inputClass}
                  value={openapiPath}
                  disabled={!canEdit}
                  onChange={(event) => setOpenapiPath(event.target.value)}
                  placeholder="openapi/openapi.yaml"
                />
                {canEdit ? (
                  <button
                    type="submit"
                    disabled={busy}
                    className="mt-3 rounded-lg bg-blue-500 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-400 disabled:opacity-60"
                  >
                    Save path
                  </button>
                ) : null}
              </form>
            </div>
          ) : canEdit ? (
            <div className="mt-5">
              <p className="text-sm text-slate-400">
                Choose a mock repository. Each repository can be linked to only one project.
              </p>
              {mockRepositoriesQuery.isPending ? (
                <p className="mt-4 text-sm text-slate-400">Loading mock repositories…</p>
              ) : mockRepositoriesQuery.error ? (
                <p role="alert" className="mt-4 text-sm text-rose-300">
                  {mockRepositoriesQuery.error instanceof Error
                    ? mockRepositoriesQuery.error.message
                    : "Unable to load mock repositories."}
                </p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  {mockRepositoriesQuery.data?.repositories.map((fixture) => (
                    <div
                      key={fixture.externalProjectId}
                      className="rounded-xl border border-white/10 bg-black/20 p-4"
                    >
                      <p className="font-medium text-slate-200">
                        {fixture.namespacePath}/{fixture.repositoryName}
                      </p>
                      <p className="mt-1 break-all text-xs text-slate-500">
                        {fixture.repositoryUrl}
                      </p>
                      <p className="mt-2 text-xs text-slate-500">
                        Branch: {fixture.defaultBranch ?? "—"} · OpenAPI:{" "}
                        {fixture.openapiFilePath ?? "not set"}
                      </p>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleLinkRepository(fixture.externalProjectId)}
                        className="mt-3 rounded-lg border border-blue-400/30 px-3 py-1.5 text-xs text-blue-200 hover:bg-blue-400/10 disabled:opacity-60"
                      >
                        Link repository
                      </button>
                    </div>
                  ))}
                  {mockRepositoriesQuery.data?.repositories.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">
                      All mock repositories are already linked in this organization.
                    </p>
                  ) : null}
                </div>
              )}
            </div>
          ) : (
            <p className="mt-5 rounded-lg border border-dashed border-white/10 p-4 text-sm text-slate-500">
              No repository is connected. Ask a project administrator to link one.
            </p>
          )}
        </section>
      ) : null}

      {tab === "settings" && canManage ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h3 className="text-base font-semibold text-white">Project settings</h3>
          <p className="mt-1 text-sm text-slate-400">
            The slug is immutable after creation. Changing metadata is audited.
          </p>
          <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleSettingsSave}>
            <label className="text-sm font-medium text-slate-300">
              Name
              <input
                className={inputClass}
                required
                maxLength={120}
                value={name}
                disabled={!canEdit}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Slug
              <input className={inputClass} value={project.slug} disabled />
            </label>
            <label className="text-sm font-medium text-slate-300 md:col-span-2">
              Description
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                maxLength={2_000}
                value={description}
                disabled={!canEdit}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Owner team
              <select
                className={inputClass}
                value={ownerTeamId}
                disabled={!canEdit}
                onChange={(event) => setOwnerTeamId(event.target.value)}
              >
                <option value="">No owner team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy || !canEdit}
                className="h-[42px] rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:opacity-60"
              >
                {busy ? "Saving…" : "Save settings"}
              </button>
            </div>
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Owner team is metadata only; project access remains explicit.
          </p>
          <div className="mt-6 border-t border-white/10 pt-5">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleArchiveToggle()}
              className={`rounded-lg border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${
                isArchived
                  ? "border-emerald-400/30 text-emerald-200 hover:bg-emerald-400/10"
                  : "border-amber-400/30 text-amber-200 hover:bg-amber-400/10"
              }`}
            >
              {isArchived ? "Restore project" : "Archive project"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
