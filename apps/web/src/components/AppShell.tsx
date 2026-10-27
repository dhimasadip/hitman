import type { SessionResponse } from "@hitman/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  ApiClientError,
  fetchReadiness,
  getOrganization,
  listAuditEvents,
  listMembers,
  listTeams,
  logout as logoutRequest,
  switchOrganization,
} from "../api.js";
import { AuditPage } from "./AuditPage.js";
import { MembersPage } from "./MembersPage.js";
import { OverviewPage } from "./OverviewPage.js";
import { TeamsPage } from "./TeamsPage.js";

type Tab = "overview" | "members" | "teams" | "audit";

export function AppShell({
  session,
  onLoggedOut,
}: {
  session: SessionResponse;
  onLoggedOut: () => void;
}) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("overview");
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeOrganization = session.organizations.find(
    (organization) => organization.id === session.activeOrganizationId,
  );
  const activeOrganizationId = activeOrganization?.id ?? null;
  const isAdmin = activeOrganization?.role === "org_admin";

  const organizationQuery = useQuery({
    queryKey: ["organization", activeOrganizationId],
    queryFn: () => getOrganization(activeOrganizationId as string),
    enabled: activeOrganizationId !== null,
  });
  const membersQuery = useQuery({
    queryKey: ["members", activeOrganizationId],
    queryFn: () => listMembers(activeOrganizationId as string),
    enabled: activeOrganizationId !== null,
  });
  const teamsQuery = useQuery({
    queryKey: ["teams", activeOrganizationId],
    queryFn: () => listTeams(activeOrganizationId as string),
    enabled: activeOrganizationId !== null,
  });
  const auditQuery = useQuery({
    queryKey: ["audit", activeOrganizationId],
    queryFn: () => listAuditEvents(activeOrganizationId as string),
    enabled: activeOrganizationId !== null && isAdmin && tab === "audit",
  });
  const readinessQuery = useQuery({
    queryKey: ["readiness"],
    queryFn: fetchReadiness,
    refetchInterval: 30_000,
  });

  async function handleSwitch(organizationId: string) {
    setError(null);
    setSwitching(true);
    try {
      const updated = await switchOrganization(organizationId);
      queryClient.setQueryData(["session"], updated);
      setTab("overview");
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "Unable to switch organization.",
      );
    } finally {
      setSwitching(false);
    }
  }

  async function handleLogout() {
    setError(null);
    try {
      await logoutRequest();
    } finally {
      queryClient.clear();
      onLoggedOut();
    }
  }

  const tabs: Array<{ id: Tab; label: string; visible: boolean }> = [
    { id: "overview", label: "Overview", visible: true },
    { id: "members", label: "Members", visible: true },
    { id: "teams", label: "Teams", visible: true },
    { id: "audit", label: "Audit", visible: isAdmin },
  ];

  if (!activeOrganization || !activeOrganizationId) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-white">No organization access</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Your account is authenticated but is not a member of an organization. Ask an administrator
          to add you before using Hitman.
        </p>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="mt-6 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
        >
          Sign out
        </button>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      <header className="border-b border-white/10 bg-black/20 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4 sm:px-10">
          <div className="flex items-center gap-4">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.24em] text-blue-300 uppercase">
                Internal API Hub
              </p>
              <p className="text-lg font-semibold tracking-tight text-white">Hitman</p>
            </div>
            <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
              Phase 4 · Identity
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {session.organizations.length > 1 ? (
              <label className="text-xs text-slate-500">
                <span className="sr-only">Active organization</span>
                <select
                  className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-200"
                  value={activeOrganizationId}
                  disabled={switching}
                  onChange={(event) => void handleSwitch(event.target.value)}
                >
                  {session.organizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span className="text-sm text-slate-300">{activeOrganization.name}</span>
            )}
            <div className="text-right">
              <p className="text-sm font-medium text-slate-200">{session.user.displayName}</p>
              <p className="text-xs text-slate-500">{session.user.email}</p>
            </div>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 transition hover:bg-white/5"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-8 sm:px-10 lg:grid-cols-[200px_1fr]">
        <nav aria-label="Workspace" className="flex gap-2 overflow-x-auto lg:flex-col">
          {tabs
            .filter((entry) => entry.visible)
            .map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={tab === entry.id ? "page" : undefined}
                className={`rounded-lg px-4 py-2.5 text-left text-sm font-medium transition ${
                  tab === entry.id
                    ? "bg-blue-500/15 text-blue-200"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {entry.label}
              </button>
            ))}
        </nav>

        <div className="min-w-0">
          {error ? (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
            >
              {error}
            </p>
          ) : null}

          {organizationQuery.isPending ? (
            <p className="text-sm text-slate-400">Loading organization…</p>
          ) : organizationQuery.error ? (
            <p
              role="alert"
              className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"
            >
              {organizationQuery.error instanceof Error
                ? organizationQuery.error.message
                : "Unable to load organization."}
            </p>
          ) : organizationQuery.data ? (
            <>
              {tab === "overview" ? (
                <OverviewPage
                  organization={organizationQuery.data}
                  memberCount={membersQuery.data?.members.length ?? 0}
                  teamCount={teamsQuery.data?.teams.length ?? 0}
                  readiness={readinessQuery.data}
                />
              ) : null}
              {tab === "members" ? (
                membersQuery.error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"
                  >
                    {membersQuery.error instanceof Error
                      ? membersQuery.error.message
                      : "Unable to load members."}
                  </p>
                ) : (
                  <MembersPage
                    organizationId={activeOrganizationId}
                    members={membersQuery.data?.members ?? []}
                    isAdmin={isAdmin}
                  />
                )
              ) : null}
              {tab === "teams" ? (
                teamsQuery.error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"
                  >
                    {teamsQuery.error instanceof Error
                      ? teamsQuery.error.message
                      : "Unable to load teams."}
                  </p>
                ) : (
                  <TeamsPage
                    organizationId={activeOrganizationId}
                    teams={teamsQuery.data?.teams ?? []}
                    members={membersQuery.data?.members ?? []}
                    isAdmin={isAdmin}
                  />
                )
              ) : null}
              {tab === "audit" && isAdmin ? (
                auditQuery.error ? (
                  <p
                    role="alert"
                    className="rounded-lg border border-rose-400/30 bg-rose-400/10 p-4 text-sm text-rose-200"
                  >
                    {auditQuery.error instanceof Error
                      ? auditQuery.error.message
                      : "Unable to load audit events."}
                  </p>
                ) : (
                  <AuditPage events={auditQuery.data?.events ?? []} />
                )
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}
