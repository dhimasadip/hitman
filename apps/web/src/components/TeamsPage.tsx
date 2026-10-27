import type { OrganizationMember, TeamDetail, TeamRole, TeamSummary } from "@hitman/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import {
  ApiClientError,
  addTeamMember,
  createTeam,
  deleteTeam,
  getTeam,
  removeTeamMember,
  updateTeamMemberRole,
} from "../api.js";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

const teamRoleLabels: Record<TeamRole, string> = {
  team_admin: "Team admin",
  member: "Member",
  viewer: "Viewer",
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function TeamsPage({
  organizationId,
  teams,
  members,
  isAdmin,
}: {
  organizationId: string;
  teams: TeamSummary[];
  members: OrganizationMember[];
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<TeamRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const detailQuery = useQuery({
    queryKey: ["team", organizationId, selectedTeamId],
    queryFn: () => getTeam(organizationId, selectedTeamId as string),
    enabled: selectedTeamId !== null,
  });

  async function refresh(teamId?: string) {
    await queryClient.invalidateQueries({ queryKey: ["teams", organizationId] });
    await queryClient.invalidateQueries({ queryKey: ["audit", organizationId] });
    if (teamId) {
      await queryClient.invalidateQueries({ queryKey: ["team", organizationId, teamId] });
    }
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      const team = await createTeam(organizationId, { name, slug: slug || slugify(name) });
      setName("");
      setSlug("");
      setMessage("Team created.");
      setSelectedTeamId(team.id);
      await refresh(team.id);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to create team.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddMember(event: FormEvent<HTMLFormElement>, teamId: string) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await addTeamMember(organizationId, teamId, { email: memberEmail, role: memberRole });
      setMemberEmail("");
      setMessage("Team member added.");
      await refresh(teamId);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to add team member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(teamId: string, userId: string, role: TeamRole): Promise<void> {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await updateTeamMemberRole(organizationId, teamId, userId, role);
      await refresh(teamId);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to update role.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(teamId: string, userId: string, displayName: string) {
    if (!window.confirm(`Remove ${displayName} from this team?`)) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await removeTeamMember(organizationId, teamId, userId);
      setMessage("Team member removed.");
      await refresh(teamId);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to remove team member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTeam(team: TeamSummary) {
    if (!window.confirm(`Delete team "${team.name}"? This cannot be undone.`)) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await deleteTeam(organizationId, team.id);
      setSelectedTeamId(null);
      setMessage("Team deleted.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to delete team.");
    } finally {
      setBusy(false);
    }
  }

  const detail = detailQuery.data as TeamDetail | undefined;

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Teams</h2>
            <p className="mt-1 text-sm text-slate-400">
              Teams group organization members. Project and device access policies arrive in later
              phases.
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            {teams.length} team{teams.length === 1 ? "" : "s"}
          </span>
        </div>

        {isAdmin ? (
          <form className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={handleCreate}>
            <label className="text-sm font-medium text-slate-300">
              Team name
              <input
                className={inputClass}
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (!slug) setSlug(slugify(event.target.value));
                }}
                placeholder="Platform"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Slug
              <input
                className={inputClass}
                required
                value={slug}
                onChange={(event) => setSlug(event.target.value)}
                placeholder="platform"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-6 h-[42px] rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:opacity-60"
            >
              {busy ? "Working…" : "Create team"}
            </button>
          </form>
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
          >
            {error}
          </p>
        ) : null}
        {message ? (
          <p
            role="status"
            className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-200"
          >
            {message}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {teams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() => setSelectedTeamId(team.id)}
              className={`rounded-xl border p-4 text-left transition ${
                selectedTeamId === team.id
                  ? "border-blue-400/50 bg-blue-400/10"
                  : "border-white/10 bg-black/20 hover:border-white/20"
              }`}
            >
              <p className="font-medium text-slate-200">{team.name}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">{team.slug}</p>
              <p className="mt-3 text-xs text-slate-400">
                {team.memberCount} member{team.memberCount === 1 ? "" : "s"}
              </p>
            </button>
          ))}
          {teams.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-slate-500">
              No teams yet. {isAdmin ? "Create one above." : "Ask an administrator to create one."}
            </p>
          ) : null}
        </div>

        {selectedTeamId ? (
          <div className="mt-8 rounded-2xl border border-white/10 bg-black/20 p-5">
            {detailQuery.isPending ? (
              <p className="text-sm text-slate-400">Loading team…</p>
            ) : detailQuery.error ? (
              <p role="alert" className="text-sm text-rose-300">
                {detailQuery.error instanceof Error
                  ? detailQuery.error.message
                  : "Unable to load team."}
              </p>
            ) : detail ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-base font-semibold text-white">{detail.name}</h3>
                    <p className="font-mono text-xs text-slate-500">{detail.slug}</p>
                  </div>
                  <div className="flex gap-2">
                    {isAdmin ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleDeleteTeam(detail)}
                        className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/10 disabled:opacity-60"
                      >
                        Delete team
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setSelectedTeamId(null)}
                      className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
                    >
                      Close
                    </button>
                  </div>
                </div>

                {isAdmin ? (
                  <form
                    className="mt-5 grid gap-3 sm:grid-cols-[1fr_160px_auto]"
                    onSubmit={(event) => void handleAddMember(event, detail.id)}
                  >
                    <label className="text-sm font-medium text-slate-300">
                      Organization member email
                      <input
                        className={inputClass}
                        type="email"
                        list={`org-members-${organizationId}`}
                        required
                        value={memberEmail}
                        onChange={(event) => setMemberEmail(event.target.value)}
                        placeholder="member@company.com"
                      />
                      <datalist id={`org-members-${organizationId}`}>
                        {members.map((member) => (
                          <option key={member.user.id} value={member.user.email} />
                        ))}
                      </datalist>
                    </label>
                    <label className="text-sm font-medium text-slate-300">
                      Team role
                      <select
                        className={inputClass}
                        value={memberRole}
                        onChange={(event) => setMemberRole(event.target.value as TeamRole)}
                      >
                        <option value="member">Member</option>
                        <option value="team_admin">Team admin</option>
                        <option value="viewer">Viewer</option>
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

                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[560px] text-left text-sm">
                    <thead>
                      <tr className="border-b border-white/10 text-xs tracking-wide text-slate-500 uppercase">
                        <th className="py-2 pr-4 font-medium">Member</th>
                        <th className="py-2 pr-4 font-medium">Team role</th>
                        {isAdmin ? <th className="py-2 text-right font-medium">Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.members.map((member) => (
                        <tr key={member.user.id} className="border-b border-white/5">
                          <td className="py-3 pr-4">
                            <p className="text-slate-200">{member.user.displayName}</p>
                            <p className="text-xs text-slate-500">{member.user.email}</p>
                          </td>
                          <td className="py-3 pr-4">
                            {isAdmin ? (
                              <select
                                className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-slate-200"
                                value={member.role}
                                disabled={busy}
                                onChange={(event) =>
                                  void handleRoleChange(
                                    detail.id,
                                    member.user.id,
                                    event.target.value as TeamRole,
                                  )
                                }
                              >
                                <option value="member">Member</option>
                                <option value="team_admin">Team admin</option>
                                <option value="viewer">Viewer</option>
                              </select>
                            ) : (
                              <span className="text-slate-300">{teamRoleLabels[member.role]}</span>
                            )}
                          </td>
                          {isAdmin ? (
                            <td className="py-3 text-right">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() =>
                                  void handleRemoveMember(
                                    detail.id,
                                    member.user.id,
                                    member.user.displayName,
                                  )
                                }
                                className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 hover:bg-rose-400/10 disabled:opacity-60"
                              >
                                Remove
                              </button>
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {detail.members.length === 0 ? (
                        <tr>
                          <td colSpan={isAdmin ? 3 : 2} className="py-5 text-sm text-slate-500">
                            No team members yet.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
