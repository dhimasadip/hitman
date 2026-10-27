import type { OrganizationDetail } from "@hitman/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { ApiClientError, changePassword, type Readiness, updateOrganization } from "../api.js";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

function ReadinessPill({ readiness }: { readiness: Readiness | undefined }) {
  const status = readiness?.status ?? "error";
  const label =
    readiness === undefined
      ? "Checking API"
      : status === "ok"
        ? "API operational"
        : status === "degraded"
          ? "API degraded"
          : "API unavailable";
  const style =
    status === "ok"
      ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
      : status === "degraded"
        ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
        : "border-rose-400/30 bg-rose-400/10 text-rose-200";
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs ${style}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

export function OverviewPage({
  organization,
  memberCount,
  teamCount,
  readiness,
}: {
  organization: OrganizationDetail;
  memberCount: number;
  teamCount: number;
  readiness: Readiness | undefined;
}) {
  const queryClient = useQueryClient();
  const isAdmin = organization.role === "org_admin";
  const [organizationName, setOrganizationName] = useState(organization.name);
  const [organizationMessage, setOrganizationMessage] = useState<string | null>(null);
  const [organizationError, setOrganizationError] = useState<string | null>(null);
  const [savingOrganization, setSavingOrganization] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    setOrganizationName(organization.name);
  }, [organization.name]);

  async function handleOrganizationSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrganizationError(null);
    setOrganizationMessage(null);
    setSavingOrganization(true);
    try {
      await updateOrganization(organization.id, { name: organizationName });
      setOrganizationMessage("Organization name updated.");
      await queryClient.invalidateQueries({ queryKey: ["organization", organization.id] });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch (caught) {
      setOrganizationError(
        caught instanceof ApiClientError ? caught.message : "Unable to update organization.",
      );
    } finally {
      setSavingOrganization(false);
    }
  }

  async function handlePasswordChange(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setPasswordMessage("Password changed. Other sessions have been revoked.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (caught) {
      setPasswordError(
        caught instanceof ApiClientError ? caught.message : "Unable to change password.",
      );
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Organization", organization.name, organization.slug],
          ["Your role", organization.role.replaceAll("_", " "), "Server-enforced"],
          ["Members", String(memberCount), "Organization access"],
          ["Teams", String(teamCount), "Optional grouping"],
        ].map(([label, value, detail]) => (
          <article key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <p className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</p>
            <p className="mt-2 text-xl font-semibold text-white">{value}</p>
            <p className="mt-1 text-xs text-slate-500">{detail}</p>
          </article>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Organization workspace</h2>
              <p className="mt-1 text-sm text-slate-400">
                Identity, memberships, projects, and audit trails are live. Requests and execution
                arrive in later phases.
              </p>
            </div>
            <ReadinessPill readiness={readiness} />
          </div>

          <dl className="mt-6 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <dt className="text-slate-500">Created</dt>
              <dd className="mt-1 text-slate-200">
                {new Date(organization.createdAt).toLocaleString()}
              </dd>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-4">
              <dt className="text-slate-500">Last updated</dt>
              <dd className="mt-1 text-slate-200">
                {new Date(organization.updatedAt).toLocaleString()}
              </dd>
            </div>
          </dl>

          <div className="mt-6 rounded-xl border border-blue-400/20 bg-blue-400/5 p-4 text-sm leading-6 text-slate-300">
            <p className="font-medium text-blue-200">Truthful state</p>
            <p className="mt-1 text-slate-400">
              Authentication and organization access do not imply project access, request execution,
              merge, deployment, or verification. Those states stay separate.
            </p>
          </div>

          {isAdmin ? (
            <form className="mt-6 border-t border-white/10 pt-6" onSubmit={handleOrganizationSave}>
              <h3 className="text-sm font-semibold text-slate-200">Organization settings</h3>
              <div className="mt-3 flex flex-wrap items-end gap-3">
                <label className="min-w-[240px] flex-1 text-sm font-medium text-slate-300">
                  Display name
                  <input
                    className={inputClass}
                    required
                    maxLength={120}
                    value={organizationName}
                    onChange={(event) => setOrganizationName(event.target.value)}
                  />
                </label>
                <button
                  type="submit"
                  disabled={savingOrganization}
                  className="h-[42px] rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
                >
                  {savingOrganization ? "Saving…" : "Save name"}
                </button>
              </div>
              {organizationError ? (
                <p role="alert" className="mt-2 text-sm text-rose-300">
                  {organizationError}
                </p>
              ) : null}
              {organizationMessage ? (
                <p role="status" className="mt-2 text-sm text-emerald-300">
                  {organizationMessage}
                </p>
              ) : null}
            </form>
          ) : null}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-lg font-semibold text-white">Change password</h2>
          <p className="mt-1 text-sm text-slate-400">
            Other sessions are revoked. Your current session remains valid.
          </p>
          <form className="mt-5 space-y-4" onSubmit={handlePasswordChange}>
            <label className="block text-sm font-medium text-slate-300">
              Current password
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-slate-300">
              New password
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium text-slate-300">
              Confirm new password
              <input
                className={inputClass}
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {passwordError ? (
              <p role="alert" className="text-sm text-rose-300">
                {passwordError}
              </p>
            ) : null}
            {passwordMessage ? (
              <p role="status" className="text-sm text-emerald-300">
                {passwordMessage}
              </p>
            ) : null}
            <button
              type="submit"
              disabled={savingPassword}
              className="w-full rounded-lg border border-white/15 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/15 disabled:opacity-60"
            >
              {savingPassword ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
