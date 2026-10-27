import type { OrganizationMember, OrganizationRole } from "@hitman/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ApiClientError, addMember, removeMember, updateMemberRole } from "../api.js";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

const roleLabels: Record<OrganizationRole, string> = {
  org_admin: "Organization admin",
  member: "Member",
  read_only: "Read only",
};

export function MembersPage({
  organizationId,
  members,
  isAdmin,
}: {
  organizationId: string;
  members: OrganizationMember[];
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<OrganizationRole>("member");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: ["members", organizationId] });
    await queryClient.invalidateQueries({ queryKey: ["audit", organizationId] });
    await queryClient.invalidateQueries({ queryKey: ["organization", organizationId] });
  }

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await addMember(organizationId, { email, role });
      setEmail("");
      setRole("member");
      setMessage("Member added.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to add member.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRoleChange(member: OrganizationMember, nextRole: OrganizationRole) {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await updateMemberRole(organizationId, member.user.id, nextRole);
      setMessage(`Role updated for ${member.user.displayName}.`);
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to update role.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(member: OrganizationMember) {
    if (
      !window.confirm(
        `Remove ${member.user.displayName} from this organization? Their sessions will lose organization access.`,
      )
    ) {
      return;
    }
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await removeMember(organizationId, member.user.id);
      setMessage("Member removed.");
      await refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "Unable to remove member.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Members</h2>
            <p className="mt-1 text-sm text-slate-400">
              Organization roles are enforced server-side. The last administrator cannot be removed
              or demoted.
            </p>
          </div>
          <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
            {members.length} member{members.length === 1 ? "" : "s"}
          </span>
        </div>

        {isAdmin ? (
          <form className="mt-6 grid gap-3 sm:grid-cols-[1fr_180px_auto]" onSubmit={handleAdd}>
            <label className="text-sm font-medium text-slate-300">
              Existing user email
              <input
                className={inputClass}
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@company.com"
              />
            </label>
            <label className="text-sm font-medium text-slate-300">
              Role
              <select
                className={inputClass}
                value={role}
                onChange={(event) => setRole(event.target.value as OrganizationRole)}
              >
                <option value="member">Member</option>
                <option value="read_only">Read only</option>
                <option value="org_admin">Organization admin</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-6 h-[42px] rounded-lg bg-blue-500 px-4 text-sm font-semibold text-white transition hover:bg-blue-400 disabled:opacity-60"
            >
              {busy ? "Working…" : "Add member"}
            </button>
          </form>
        ) : null}

        {isAdmin ? (
          <p className="mt-3 text-xs text-slate-500">
            New users must first be provisioned with{" "}
            <code className="text-slate-300">pnpm admin add-member</code>.
          </p>
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

        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-white/10 text-xs tracking-wide text-slate-500 uppercase">
                <th className="py-3 pr-4 font-medium">User</th>
                <th className="py-3 pr-4 font-medium">Role</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                {isAdmin ? <th className="py-3 text-right font-medium">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.user.id} className="border-b border-white/5">
                  <td className="py-4 pr-4">
                    <p className="font-medium text-slate-200">{member.user.displayName}</p>
                    <p className="text-xs text-slate-500">{member.user.email}</p>
                  </td>
                  <td className="py-4 pr-4">
                    {isAdmin ? (
                      <select
                        className="rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-xs text-slate-200"
                        value={member.role}
                        disabled={busy}
                        onChange={(event) =>
                          void handleRoleChange(member, event.target.value as OrganizationRole)
                        }
                      >
                        <option value="org_admin">Organization admin</option>
                        <option value="member">Member</option>
                        <option value="read_only">Read only</option>
                      </select>
                    ) : (
                      <span className="text-slate-300">{roleLabels[member.role]}</span>
                    )}
                  </td>
                  <td className="py-4 pr-4">
                    <span
                      className={
                        member.user.status === "active"
                          ? "text-emerald-300"
                          : member.user.status === "pending"
                            ? "text-amber-300"
                            : "text-rose-300"
                      }
                    >
                      {member.user.status}
                    </span>
                  </td>
                  {isAdmin ? (
                    <td className="py-4 text-right">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void handleRemove(member)}
                        className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs text-rose-200 transition hover:bg-rose-400/10 disabled:opacity-60"
                      >
                        Remove
                      </button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
