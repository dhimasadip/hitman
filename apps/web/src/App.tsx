import type { SessionResponse } from "@hitman/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiClientError, getSession } from "./api.js";
import { AppShell } from "./components/AppShell.js";
import { LoginPage } from "./components/LoginPage.js";

export function App() {
  const queryClient = useQueryClient();
  const [loggedOut, setLoggedOut] = useState(false);
  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: getSession,
    retry: false,
    staleTime: 30_000,
  });

  function handleLoggedIn(session: SessionResponse) {
    setLoggedOut(false);
    queryClient.setQueryData(["session"], session);
  }

  function handleLoggedOut() {
    setLoggedOut(true);
    queryClient.setQueryData(["session"], undefined);
  }

  if (sessionQuery.isPending && !loggedOut) {
    return (
      <main className="flex min-h-screen items-center justify-center px-6">
        <div className="text-center">
          <div className="mx-auto size-8 animate-spin rounded-full border-2 border-blue-400/30 border-t-blue-400" />
          <p className="mt-4 text-sm text-slate-400">Checking your session…</p>
        </div>
      </main>
    );
  }

  if (sessionQuery.data && !loggedOut) {
    return <AppShell session={sessionQuery.data} onLoggedOut={handleLoggedOut} />;
  }

  if (
    sessionQuery.error &&
    !(sessionQuery.error instanceof ApiClientError && sessionQuery.error.status === 401)
  ) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold text-white">Hitman is unreachable</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          {sessionQuery.error instanceof Error
            ? sessionQuery.error.message
            : "The API did not respond."}
        </p>
        <button
          type="button"
          onClick={() => void sessionQuery.refetch()}
          className="mt-6 rounded-lg border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
        >
          Retry
        </button>
      </main>
    );
  }

  return <LoginPage onLoggedIn={handleLoggedIn} />;
}
