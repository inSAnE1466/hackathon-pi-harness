import { useCallback, useEffect, useRef, useState } from "react";
import type { AuditRow, ChainCheck } from "./decision-log.ts";

const POLL_MS = 2_000;

export interface DecisionLogState {
  /** Newest first, as the server sends them. */
  readonly rows: readonly AuditRow[];
  /** The server's check of the hash chain, when the log has loaded. */
  readonly chain?: ChainCheck;
  readonly loaded: boolean;
  readonly error?: string;
  /** Reads the log again now, e.g. after a person records a decision. */
  readonly reload: () => void;
}

type Loaded = Omit<DecisionLogState, "reload">;

/**
 * Reads the session's decision log. Fetches once on open, every 2 s while a turn runs, once more when it ends, and
 * whenever `reload` is called.
 */
export function useDecisionLog(sessionId: string, running: boolean): DecisionLogState {
  const [state, setState] = useState<Loaded>({ rows: [], loaded: false });
  const [nonce, setNonce] = useState(0);
  const wasRunning = useRef(running);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/sessions/${sessionId}/audit`);
        if (!response.ok) throw new Error(`Decision log unavailable (${response.status})`);
        const body = (await response.json()) as {
          readonly decisions?: AuditRow[];
          readonly chain?: ChainCheck;
        };
        if (!cancelled)
          setState({
            rows: body.decisions ?? [],
            loaded: true,
            ...(body.chain === undefined ? {} : { chain: body.chain }),
          });
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
  }, [sessionId, running, nonce]);

  return { ...state, reload };
}
