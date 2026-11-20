import { useState } from "react";
import { ChatSession } from "./ChatSession.tsx";
import { loadUsername, saveUsername } from "./identity.ts";
import { SAMPLE_CLAIMS, stashDraft } from "./samples.ts";

const sessionRoute = /^\/sessions\/([^/]+)\/?$/;

/**
 * Everyone in the workspace speaks as a role, not a name: the harness prefixes each prompt with the speaker, and a
 * personal name there would be one more piece of personal data in every request.
 */
const DEFAULT_SPEAKER = "Claims handler";

const speaker = (): string => loadUsername() ?? saveUsername(DEFAULT_SPEAKER);

export function App() {
  const pathname = window.location.pathname;
  if (pathname === "/") return <LandingPage />;

  const match = sessionRoute.exec(pathname);
  if (match !== null && match[1].length > 0) {
    // Keep the session ID as the opaque encoded path segment PartySocket will reuse.
    return <ChatSession sessionId={match[1]} username={speaker()} />;
  }

  return (
    <main className="landing">
      <h1>Page not found</h1>
      <p>
        <a href="/">Back to the claims assistant</a>
      </p>
    </main>
  );
}

function LandingPage() {
  const [creating, setCreating] = useState<string>();
  const [error, setError] = useState<string>();

  const open = async (key: string, draft: string): Promise<void> => {
    setCreating(key);
    setError(undefined);
    try {
      speaker();
      const response = await fetch("/api/sessions", { method: "POST" });
      if (!response.ok) throw new Error(`Could not open a session (${response.status})`);
      const result = (await response.json()) as {
        readonly sessionId?: unknown;
        readonly url?: unknown;
      };
      if (typeof result.url !== "string" || typeof result.sessionId !== "string")
        throw new Error("The server returned an invalid session");
      if (draft !== "") stashDraft(result.sessionId, draft);
      window.location.assign(result.url);
    } catch (error) {
      setCreating(undefined);
      setError(error instanceof Error ? error.message : "Could not open a session");
    }
  };

  return (
    <main className="landing">
      <header className="landing-header">
        <p className="eyebrow">Gezira · AI-Z Challenge</p>
        <h1>Claims assistant</h1>
        <p className="landing-lede">
          The assistant prepares health and travel claims. BRANE decides what may leave for a model.
          People decide the claims.
        </p>
      </header>

      <section aria-labelledby="samples-heading">
        <h2 id="samples-heading">Try a sample claim</h2>
        <ul className="sample-grid">
          {SAMPLE_CLAIMS.map((sample) => (
            <li key={sample.id}>
              <button
                className="sample-tile"
                type="button"
                disabled={creating !== undefined}
                onClick={() => void open(sample.id, sample.text)}
              >
                <span className="sample-title">{sample.title}</span>
                <span className="sample-text">{sample.text}</span>
                <span className="sample-expected">
                  {creating === sample.id ? "Opening…" : sample.expected}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <p>
        <button
          className="button-primary"
          type="button"
          disabled={creating !== undefined}
          onClick={() => void open("blank", "")}
        >
          {creating === "blank" ? "Opening…" : "Start an empty session"}
        </button>
      </p>
      {error === undefined ? null : (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <p className="landing-note">All claims here are synthetic.</p>
    </main>
  );
}
