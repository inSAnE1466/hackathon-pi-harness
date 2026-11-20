import { useState } from "react";
import { type AuditRow, handoffOf } from "./decision-log.ts";

type Choice =
  | { readonly kind: "approved" }
  | { readonly kind: "rejected" }
  | { readonly kind: "editing"; readonly note: string }
  | { readonly kind: "edited"; readonly note: string };

const CHOICE_LABEL = { approved: "Approved", rejected: "Rejected", edited: "Edited" } as const;

/**
 * The human decision step: one card per handoff in the decision log. A choice is recorded only in this browser for
 * the demo; no model is called and nothing is sent.
 */
export function ReviewQueue({ rows }: { readonly rows: readonly AuditRow[] }) {
  const [choices, setChoices] = useState<Readonly<Record<number, Choice>>>({});
  const handoffs = rows.filter((row) => row.kind === "handoff");
  if (handoffs.length === 0) return null;

  const choose = (id: number, choice: Choice): void =>
    setChoices((current) => ({ ...current, [id]: choice }));

  return (
    <section className="review-queue" aria-labelledby="review-queue-heading">
      <header>
        <h2 id="review-queue-heading">Review queue</h2>
        <p>A person decides. The assistant only prepares the case.</p>
      </header>
      <ul>
        {handoffs.map((row) => {
          const handoff = handoffOf(row);
          const choice = choices[row.id];
          return (
            <li key={row.id} className="review-card">
              <div className="review-card-text">
                <span className="state state--waiting">
                  <strong>{handoff.role}</strong>
                </span>
                <p>{handoff.sentence}</p>
              </div>
              {choice?.kind === "editing" ? (
                <form
                  className="review-edit"
                  onSubmit={(event) => {
                    event.preventDefault();
                    choose(row.id, { kind: "edited", note: choice.note.trim() });
                  }}
                >
                  <label className="visually-hidden" htmlFor={`review-note-${row.id}`}>
                    Your change
                  </label>
                  <input
                    id={`review-note-${row.id}`}
                    value={choice.note}
                    placeholder="Your change, e.g. pay 6 of 9 sessions"
                    autoFocus
                    onChange={(event) =>
                      choose(row.id, { kind: "editing", note: event.currentTarget.value })
                    }
                  />
                  <button className="button-secondary" type="submit">
                    Save
                  </button>
                </form>
              ) : choice === undefined ? (
                <div className="review-actions">
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => choose(row.id, { kind: "approved" })}
                  >
                    Approve
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => choose(row.id, { kind: "editing", note: "" })}
                  >
                    Edit
                  </button>
                  <button
                    className="button-secondary"
                    type="button"
                    onClick={() => choose(row.id, { kind: "rejected" })}
                  >
                    Reject
                  </button>
                </div>
              ) : (
                <p className="review-recorded" role="status">
                  <span
                    className={`state state--${choice.kind === "rejected" ? "blocked" : "passed"}`}
                  >
                    {CHOICE_LABEL[choice.kind]}
                  </span>
                  {choice.kind === "edited" && choice.note !== "" ? `: ${choice.note}` : null}
                  <span className="review-recorded-note"> Recorded in this browser only.</span>
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
