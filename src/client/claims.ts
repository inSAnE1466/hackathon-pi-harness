/**
 * What this browser remembers about the queue, in localStorage only: the session each claim opened. Decisions are
 * not kept here; they are human rows in each session's audit trail.
 */
const SESSIONS_KEY = "claims.sessions";

const read = (key: string): unknown => {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? undefined : JSON.parse(raw);
  } catch {
    return undefined;
  }
};

const write = (key: string, value: unknown): void => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable; the claim then opens a new session next time.
  }
};

/** Claim id to session id. */
export function loadSessions(): Record<string, string> {
  const stored = read(SESSIONS_KEY);
  if (typeof stored !== "object" || stored === null) return {};
  return Object.fromEntries(
    Object.entries(stored).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function saveSession(claimId: string, sessionId: string): Record<string, string> {
  const sessions = { ...loadSessions(), [claimId]: sessionId };
  write(SESSIONS_KEY, sessions);
  return sessions;
}
