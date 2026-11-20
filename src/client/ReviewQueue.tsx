import { useState } from "react";
import {
  type AuditRow,
  type HumanDecision,
  decisionsByHandoff,
  handoffOf,
} from "./decision-log.ts";

const DECISION_LABEL: Record<HumanDecision, string> = {
  approved: "Approved",
  rejected: "Rejected",
  edited: "Edited",
};

interface ReviewQueueProps {
  readonly sessionId: string;
  /** The reviewer's display name, recorded as the actor of the decision. */
  readonly username: string;
  readonly rows: readonly AuditRow[];
  /** Called after a decision is stored, so the decision log reads it back. */
  readonly onRecorded: () => void;
}

/**
 * The human decision step: one card per handoff in the decision log. A decision is posted to the session's audit
 * log with the reviewer's name, so it is part of the hash-chained trail and survives a reload. No model is called.
 */
export function ReviewQueue({ sessionId, username, rows, onRecorded }: ReviewQueueProps) {
  const [drafts, setDrafts] = useState<Readonly<Record<number, string>>>({});
  const [pending, setPending] = useState<number | undefined>();
  const [error, setError] = useState<string | undefined>();
  const handoffs = rows.filter((row) => row.kind === "handoff");
  if (handoffs.length === 0) return null;
  const decided = decisionsByHandoff(rows);

  const record = async (handoffId: number, decision: HumanDecision, note = ""): Promise<void> => {
    setPending(handoffId);
    setError(undefined);
    try {
      const response = await fetch(`/api/sessions/${sessionId}/audit/human`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handoffId, decision, note, reviewer: username }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { readonly error?: string };
        throw new Error(body.error ?? `Not recorded (${response.status})`);
      }
      setDrafts(({ [handoffId]: _, ...rest }) => rest);
      onRecorded();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Not recorded");
    } finally {
      setPending(undefined);
    }
  };

  return (
    <section className="review-queue" aria-labelledby="review-queue-heading">
      <header>
        <h2 id="review-queue-heading">Review queue</h2>
        <p>A person decides. The assistant only prepares the case.</p>
      </header>
      {error === undefined ? null : (
        <p className="review-error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {handoffs.map((row) => {
          const handoff = handoffOf(row);
          const decision = decided.get(row.id);
          const draft = drafts[row.id];
          const busy = pending === row.id;
          return (
            <li key={row.id} className="review-card">
              <div className="review-card-text">
                <span className="state state--waiting">
                  <strong>{handoff.role}</strong>
                </span>
                <p>{handoff.sentence}</p>
              </div>
              {decision !== undefined ? (
                <p className="review-recorded" role="status">
                  <span
                    className={`state state--${decision.action === "rejected" ? "blocked" : "passed"}`}
                  >
                    {DECISION_LABEL[decision.action as HumanDecision] ?? decision.action}
                  </span>
                  {decision.detail === "" ? null : `: ${decision.detail}`}
                  <span className="review-recorded-note">
                    {" "}
                    by {decision.actor}, {new Date(decision.at).toLocaleTimeString()}. In the audit
                    trail.
                  </span>
                </p>
              ) : draft !== undefined ? (
                <form
                  className="review-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void record(row.id, "edited", draft.trim());
                  }}
                >
                  <label className="visually-hidden" htmlFor={`review-note-${row.id}`}>
                    Your change
                  </label>
                  <input
                    id={`review-note-${row.id}`}
                    value={draft}
                    placeholder="Your change, e.g. pay 6 of 9 sessions"
                    maxLength={500}
                    autoFocus
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setDrafts((current) => ({ ...current, [row.id]: value }));
                    }}
                  />
                  <button className="button-secondary" type="submit" disabled={busy}>
                    Save
                  </button>
                </form>
              ) : (
                <div className="review-actions">
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void record(row.id, "approved")}
                  >
                    Approve
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => setDrafts((current) => ({ ...current, [row.id]: "" }))}
                  >
                    Edit
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => void record(row.id, "rejected")}
                  >
                    Reject
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
