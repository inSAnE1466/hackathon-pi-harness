import { useEffect, useState } from "react";
/**
 * What this browser remembers about the queue, in localStorage only: the session each claim opened, and the claims
 * handler's decision on it. Nothing here is sent to the server or to a model.
 */
export type DecisionKind = "approved" | "rejected" | "edited";

export interface Decision {
  readonly kind: DecisionKind;
  readonly note: string;
  readonly at: string;
}

const SESSIONS_KEY = "claims.sessions";
const DECISION_KEY = (sessionId: string) => `claims.decision.${sessionId}`;

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

export function loadDecision(sessionId: string): Decision | undefined {
  const v = read(DECISION_KEY(sessionId)) as Partial<Decision> | undefined;
  return typeof v === "object" &&
    v !== null &&
    (v.kind === "approved" || v.kind === "rejected" || v.kind === "edited") &&
    typeof v.note === "string" &&
    typeof v.at === "string"
    ? { kind: v.kind, note: v.note, at: v.at }
    : undefined;
}

function saveDecision(sessionId: string, kind: DecisionKind, note = ""): Decision {
  const decision = { kind, note, at: new Date().toISOString() };
  write(DECISION_KEY(sessionId), decision);
  return decision;
}

const DECISION_EVENT = "claims:decision";

/** Records the decision and tells every view of this session in the page. */
export function recordDecision(sessionId: string, kind: DecisionKind, note = ""): Decision {
  const decision = saveDecision(sessionId, kind, note);
  window.dispatchEvent(new CustomEvent(DECISION_EVENT, { detail: sessionId }));
  return decision;
}

/** The claims handler's decision on a session, kept in step with `recordDecision`. */
export function useDecision(sessionId: string | undefined): Decision | undefined {
  const [decision, setDecision] = useState(() =>
    sessionId === undefined ? undefined : loadDecision(sessionId),
  );
  useEffect(() => {
    const sync = (): void =>
      setDecision(sessionId === undefined ? undefined : loadDecision(sessionId));
    sync();
    window.addEventListener(DECISION_EVENT, sync);
    return () => window.removeEventListener(DECISION_EVENT, sync);
  }, [sessionId]);
  return decision;
}

/** Re-renders the caller whenever any decision is recorded. */
export function useDecisionVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((current) => current + 1);
    window.addEventListener(DECISION_EVENT, bump);
    return () => window.removeEventListener(DECISION_EVENT, bump);
  }, []);
  return version;
}
