import type {
  OrganizationMember,
  OrganizationRole,
  ProjectStatusFilter,
  TeamSummary,
} from "@hitman/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useDeferredValue, useState } from "react";
import { ApiClientError, createProject, listProjects } from "../api.js";
import { ProjectWorkspace } from "./ProjectWorkspace.js";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function ProjectsPage({
  organizationId,
  isAdmin,
  organizationRole,
  teams,
  organizationMembers,
}: {
  organizationId: string;
  isAdmin: boolean;
  organizationRole: OrganizationRole;
  teams: TeamSummary[];
  organizationMembers: OrganizationMember[];
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<ProjectStatusFilter>("active");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [ownerTeamId, setOwnerTeamId] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const deferredSearch = useDeferredValue(search);

  const projectsQuery = useQuery({
    queryKey: ["projects", organizationId, deferredSearch, status],
    queryFn: () =>
      listProjects(organizationId, {
        ...(deferredSearch ? { search: deferredSearch } : {}),
        status,
      }),
  });

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreateError(null);
    setCreating(true);
    try {
      const project = await createProject(organizationId, {
        name,
        slug: slug || slugify(name),
        ...(description.trim() ? { description } : {}),
        ...(ownerTeamId ? { ownerTeamId } : {}),
      });
      setName("");
      setSlug("");
      setSlugTouched(false);
      setDescription("");
      setOwnerTeamId("");
      await queryClient.invalidateQueries({ queryKey: ["projects", organizationId] });
      setSelectedProjectId(project.id);
    } catch (caught) {
      setCreateError(
        caught instanceof ApiClientError ? caught.message : "Unable to create project.",
      );
    } finally {
      setCreating(false);
    }
  }

  if (selectedProjectId) {
    return (
      <ProjectWorkspace
        projectId={selectedProjectId}
        isOrganizationAdmin={isAdmin}
        organizationRole={organizationRole}
        organizationMembers={organizationMembers}
        teams={teams}
        onBack={() => {
          setSelectedProjectId(null);
          void queryClient.invalidateQueries({ queryKey: ["projects", organizationId] });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Projects</h2>
            <p className="mt-1 text-sm text-slate-400">
              Projects are created without requiring a repository, OpenAPI document, or runner.
              Source and specification configuration are optional.
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            {projectsQuery.data?.projects.length ?? 0} shown
          </span>
        </div>

        <div className="mt-5 flex flex-wrap gap-3">
          <label className="min-w-[220px] flex-1 text-sm font-medium text-slate-300">
            Search
            <input
              className={inputClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Name, slug, or description"
            />
          </label>
          {isAdmin ? (
            <label className="text-sm font-medium text-slate-300">
              Status
              <select
                className={inputClass}
                value={status}
                onChange={(event) => setStatus(event.target.value as ProjectStatusFilter)}
              >
                <option value="active">Active</option>
                <option value="archived">Archived</option>
                <option value="all">All</option>
              </select>
            </label>
          ) : null}
        </div>

        {projectsQuery.error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
          >
            {projectsQuery.error instanceof Error
              ? projectsQuery.error.message
              : "Unable to load projects."}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projectsQuery.isPending ? (
            <p className="text-sm text-slate-400">Loading projects…</p>
          ) : null}
          {projectsQuery.data?.projects.map((project) => (
            <button
              key={project.id}
              type="button"
              onClick={() => setSelectedProjectId(project.id)}
              className="rounded-xl border border-white/10 bg-black/20 p-5 text-left transition hover:border-blue-400/40 hover:bg-blue-400/5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-100">{project.name}</p>
                  <p className="mt-1 font-mono text-xs text-slate-500">{project.slug}</p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${
                    project.status === "active"
                      ? "border-emerald-400/30 text-emerald-300"
                      : "border-amber-400/30 text-amber-300"
                  }`}
                >
                  {project.status}
                </span>
              </div>
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-slate-400">
                {project.description || "No description"}
              </p>
              <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-slate-500">
                <span>{project.role.replaceAll("_", " ")}</span>
                <span>
                  {project.memberCount} member{project.memberCount === 1 ? "" : "s"}
                </span>
                <span>{project.repositoryLinked ? "repository linked" : "no repository"}</span>
              </div>
            </button>
          ))}
          {projectsQuery.data?.projects.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-500">
              No projects match this view.
            </p>
          ) : null}
        </div>
      </section>

      {isAdmin ? (
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">Create project</h2>
          <p className="mt-1 text-sm text-slate-400">
            You become the initial project administrator. Source connections and API specifications
            can be added later.
          </p>
          <form className="mt-5 grid gap-4 md:grid-cols-2" onSubmit={handleCreate}>
            <label className="text-sm font-medium text-slate-300">
              Name
              <input
                className={inputClass}
                required
                maxLength={120}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slugTouched) setSlug(slugify(event.target.value));
                }}
                placeholder="Billing API"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Slug
              <input
                className={inputClass}
                required
                value={slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
                placeholder="billing-api"
              />
            </label>
            <label className="text-sm font-medium text-slate-300 md:col-span-2">
              Description
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                maxLength={2_000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Optional context for this project"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Owner team
              <select
                className={inputClass}
                value={ownerTeamId}
                onChange={(event) => setOwnerTeamId(event.target.value)}
              >
                <option value="">No owner team (metadata only)</option>
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
                disabled={creating}
                className="h-[42px] rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:opacity-60"
              >
                {creating ? "Creating…" : "Create project"}
              </button>
            </div>
            {createError ? (
              <p role="alert" className="text-sm text-rose-300 md:col-span-2">
                {createError}
              </p>
            ) : null}
          </form>
          <p className="mt-3 text-xs text-slate-500">
            Owner team is ownership metadata only; project access is granted through explicit
            project membership.
          </p>
        </section>
      ) : null}
    </div>
  );
}
