import type { AuditEvent } from "@hitman/contracts";

function summarizeMetadata(metadata: Record<string, unknown>): string {
  const text = JSON.stringify(metadata);
  return text === "{}" ? "—" : text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export function AuditPage({ events }: { events: AuditEvent[] }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Audit events</h2>
          <p className="mt-1 text-sm text-slate-400">
            Recent privileged actions for this organization. Metadata excludes passwords, session
            tokens, and request bodies.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-3 py-1 text-xs text-slate-400">
          {events.length} recent
        </span>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-xs tracking-wide text-slate-500 uppercase">
              <th className="py-3 pr-4 font-medium">Time</th>
              <th className="py-3 pr-4 font-medium">Action</th>
              <th className="py-3 pr-4 font-medium">Actor</th>
              <th className="py-3 pr-4 font-medium">Resource</th>
              <th className="py-3 pr-4 font-medium">Outcome</th>
              <th className="py-3 font-medium">Metadata</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b border-white/5 align-top">
                <td className="py-3 pr-4 text-xs whitespace-nowrap text-slate-400">
                  {new Date(event.createdAt).toLocaleString()}
                </td>
                <td className="py-3 pr-4">
                  <p className="font-mono text-xs text-slate-200">{event.action}</p>
                  {event.correlationId ? (
                    <p className="mt-1 font-mono text-[10px] text-slate-600">
                      {event.correlationId}
                    </p>
                  ) : null}
                </td>
                <td className="py-3 pr-4 text-slate-300">
                  {event.actorDisplayName ?? (event.actorType === "system" ? "System" : "Unknown")}
                </td>
                <td className="py-3 pr-4 text-xs text-slate-400">
                  {event.resourceType}
                  {event.resourceId ? (
                    <span className="block font-mono text-[10px] text-slate-600">
                      {event.resourceId}
                    </span>
                  ) : null}
                </td>
                <td className="py-3 pr-4">
                  <span
                    className={event.outcome === "success" ? "text-emerald-300" : "text-rose-300"}
                  >
                    {event.outcome}
                  </span>
                </td>
                <td className="max-w-[260px] py-3 font-mono text-[10px] break-all text-slate-500">
                  {summarizeMetadata(event.metadata)}
                </td>
              </tr>
            ))}
            {events.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-6 text-sm text-slate-500">
                  No audit events yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
