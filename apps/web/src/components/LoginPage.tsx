import type { SessionResponse } from "@hitman/contracts";
import { type FormEvent, useState } from "react";
import { ApiClientError, login as loginRequest } from "../api.js";

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-blue-400/60 focus:ring-2 focus:ring-blue-400/20";

export function LoginPage({ onLoggedIn }: { onLoggedIn: (session: SessionResponse) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const session = await loginRequest({ email, password });
      onLoggedIn(session);
    } catch (caught) {
      setError(
        caught instanceof ApiClientError
          ? caught.message
          : "Unable to reach Hitman. Check that the API and database are running.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl items-center px-6 py-10 sm:px-10">
      <div className="grid w-full gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:gap-16">
        <section className="flex flex-col justify-center">
          <p className="text-xs font-semibold tracking-[0.24em] text-blue-300 uppercase">
            Hitman · Internal API Hub
          </p>
          <h1 className="mt-4 max-w-xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            One truthful place for API requests, context, and evidence.
          </h1>
          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-400">
            Sign in with your internal Hitman account. Authentication is password-based with
            Argon2id hashing and secure server-side sessions. Organization access is checked on
            every request.
          </p>
          <div className="mt-8 grid gap-3 text-sm text-slate-400 sm:grid-cols-3">
            {[
              ["Phase 4", "Identity foundation"],
              ["Org scoped", "RBAC enforced"],
              ["Audited", "Privileged actions"],
            ].map(([label, detail]) => (
              <div key={label} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <p className="font-medium text-slate-200">{label}</p>
                <p className="mt-1 text-xs">{detail}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="self-center rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 sm:p-8">
          <h2 className="text-xl font-semibold text-white">Sign in</h2>
          <p className="mt-2 text-sm text-slate-400">
            Use the account provisioned by your organization administrator.
          </p>

          <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
            <label className="block text-sm font-medium text-slate-300">
              Email
              <input
                className={inputClass}
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@company.com"
              />
            </label>
            <label className="block text-sm font-medium text-slate-300">
              Password
              <input
                className={inputClass}
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Your password"
              />
            </label>

            {error ? (
              <p
                role="alert"
                className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-200"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-5 text-xs leading-5 text-slate-500">
            No self-registration. Ask an organization administrator to provision your account
            through the administrator CLI.
          </p>
        </section>
      </div>
    </main>
  );
}
