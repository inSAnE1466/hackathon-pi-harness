import { useEffect, useRef, useState } from "react";
import type { AuditRow } from "./decision-log.ts";

const POLL_MS = 2_000;

export interface DecisionLogState {
  /** Newest first, as the server sends them. */
  readonly rows: readonly AuditRow[];
  readonly loaded: boolean;
  readonly error?: string;
}

/**
 * Reads the session's decision log. Fetches once on open, every 2 s while a turn runs, and once more when it ends.
 */
export function useDecisionLog(sessionId: string, running: boolean): DecisionLogState {
  const [state, setState] = useState<DecisionLogState>({ rows: [], loaded: false });
  const wasRunning = useRef(running);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/audit`);
        if (!response.ok) throw new Error(`Decision log unavailable (${response.status})`);
        const body = (await response.json()) as { readonly decisions?: AuditRow[] };
        if (!cancelled) setState({ rows: body.decisions ?? [], loaded: true });
      } catch (error) {
        if (!cancelled)
          setState((current) => ({
            ...current,
            loaded: true,
            error: error instanceof Error ? error.message : "Decision log unavailable",
          }));
      }
    };

    const ended = wasRunning.current && !running;
    wasRunning.current = running;
    void load();
    if (!running) {
      // One more read shortly after a turn ends, for rows written as the run settles.
      const settle = ended ? setTimeout(() => void load(), POLL_MS) : undefined;
      return () => {
        cancelled = true;
        if (settle !== undefined) clearTimeout(settle);
      };
    }
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionId, running]);

  return state;
}
