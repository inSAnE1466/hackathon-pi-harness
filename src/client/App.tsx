import { useEffect, useState } from "react";
import policy from "../../policy/brane.json";
import { ClaimSession } from "./ClaimSession.tsx";
import { loadSessions, saveSession } from "./claims.ts";
import { loadUsername, saveUsername } from "./identity.ts";
import { ClaimsQueue } from "./ClaimsQueue.tsx";
import { QUEUE } from "./queue.ts";

/**
 * Everyone in the workspace speaks as a role, not a name: the harness prefixes each prompt with the speaker, and a
 * personal name there would be one more piece of personal data in every request.
 */
const DEFAULT_SPEAKER = "Claims handler";

const speaker = (): string => loadUsername() ?? saveUsername(DEFAULT_SPEAKER);

/** At this width and below the queue starts folded to icons. */
const FOLD_QUEUE_BELOW = 1281;

const claimFromLocation = (): string =>
  new URLSearchParams(window.location.search).get("claim") ?? QUEUE[0].id;

/** The one screen: header, the claims queue, and the selected claim's chat and harness panel. */
export function App() {
  const [claimId, setClaimId] = useState(claimFromLocation);
  const [sessions, setSessions] = useState(loadSessions);
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [queueOpen, setQueueOpen] = useState(() => window.innerWidth >= FOLD_QUEUE_BELOW);
  const claim = QUEUE.find((candidate) => candidate.id === claimId) ?? QUEUE[0];
  const sessionId = sessions[claim.id];

  useEffect(() => {
    const follow = (): void => setClaimId(claimFromLocation());
    window.addEventListener("popstate", follow);
    return () => window.removeEventListener("popstate", follow);
  }, []);

  // Each claim has one session, created the first time it is opened.
  useEffect(() => {
    if (sessionId !== undefined) return;
    let cancelled = false;
    setError(undefined);
    void (async () => {
      try {
        const response = await fetch("/api/sessions", { method: "POST" });
        if (!response.ok) throw new Error(`Could not open the claim (${response.status})`);
        const result = (await response.json()) as { readonly sessionId?: unknown };
        if (typeof result.sessionId !== "string") throw new Error("The server sent no session");
        if (!cancelled) setSessions(saveSession(claim.id, result.sessionId));
      } catch (cause) {
        if (!cancelled)
          setError(cause instanceof Error ? cause.message : "Could not open the claim");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [claim.id, sessionId, attempt]);

  const select = (id: string): void => {
    if (id === claim.id) return;
    window.history.pushState(null, "", `/?claim=${id}`);
    setClaimId(id);
  };

  return (
    <div className={`app${queueOpen ? "" : " app--queue-folded"}`}>
      <header className="app-header">
        <div className="app-title">
          <h1>Claims assistant</h1>
          <p>Prepares health, travel and motor claims. BRANE checks every model request.</p>
        </div>
        <dl className="app-meta">
          <div>
            <dt>Policy</dt>
            <dd>{policy.version}</dd>
          </div>
        </dl>
        <p className="app-note">All claims are synthetic</p>
      </header>

      <ClaimsQueue
        sessions={sessions}
        selectedId={claim.id}
        open={queueOpen}
        onToggle={() => setQueueOpen((current) => !current)}
        onSelect={select}
      />

      {sessionId === undefined ? (
        <main className="chat chat--placeholder" aria-busy={error === undefined}>
          {error === undefined ? (
            <p className="quiet">Opening {claim.title.toLowerCase()}…</p>
          ) : (
            <div className="inline-error" role="alert">
              <p>{error}</p>
              <button
                className="button-secondary"
                type="button"
                onClick={() => setAttempt((current) => current + 1)}
              >
                Try again
              </button>
            </div>
          )}
        </main>
      ) : (
        <ClaimSession key={sessionId} claim={claim} sessionId={sessionId} username={speaker()} />
      )}
    </div>
  );
}
