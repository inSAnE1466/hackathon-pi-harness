import { useState } from "react";
import { type Decision, recordDecision, useDecision } from "./claims.ts";
import { type AuditRow, citedPassages, handoffOf, passageIds } from "./decision-log.ts";
import { Markdown } from "./Markdown.tsx";
import { RoutingDiagram } from "./RoutingDiagram.tsx";

const DECIDED = {
  approved: { label: "Approved", tone: "passed" },
  edited: { label: "Edited", tone: "passed" },
  rejected: { label: "Rejected", tone: "blocked" },
} as const;

interface DecisionCardProps {
  readonly sessionId: string;
  readonly rows: readonly AuditRow[];
  /** The reasons the assistant gave with its recommendation, if the transcript has them. */
  readonly reasons?: string;
}

/**
 * The end of a prepared claim: the assistant's recommendation and the passages behind it, and the claims handler's
 * decision. The decision is kept in this browser only; nothing is sent to a model.
 */
export function DecisionCard({ sessionId, rows, reasons }: DecisionCardProps) {
  const decision = useDecision(sessionId);
  const [note, setNote] = useState<string>();
  const approval = rows.find(
    (row) => row.kind === "handoff" && handoffOf(row).tool === "request_approval",
  );
  if (approval === undefined) return null;

  const recommendation = handoffOf(approval).sentence.replace(/^.*: /, "");
  // The ids the reasons cite, kept only where a lookup returned them, so a document number never reads as a passage.
  const looked = citedPassages(rows);
  const fromReasons =
    reasons === undefined ? [] : passageIds(reasons).filter((id) => looked.includes(id));
  const cited = fromReasons.length > 0 ? fromReasons : looked;
  const amounts = reasons === undefined ? [] : amountLines(reasons);
  const decide = (kind: Decision["kind"], text = ""): void => {
    setNote(undefined);
    recordDecision(sessionId, kind, text);
  };

  return (
    <article className="decision-card" aria-labelledby="decision-card-heading">
      <header>
        <p className="eyebrow">Prepared for the claims handler</p>
        <h3 id="decision-card-heading">Claims handler's decision</h3>
      </header>
      <dl className="decision-card-facts">
        <div>
          <dt>Recommendation</dt>
          <dd className="decision-card-recommendation">{recommendation}</dd>
        </div>
        <div>
          <dt>Cited passages</dt>
          <dd>
            {cited.length === 0 ? (
              "None"
            ) : (
              <ul className="chips">
                {cited.map((id) => (
                  <li key={id} className="chip">
                    {id}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {amounts.length === 0 ? null : (
          <div>
            <dt>Amounts</dt>
            <dd>
              <table className="decision-card-amounts">
                <tbody>
                  {amounts.map((line) => (
                    <tr
                      key={line.label}
                      className={/^(sub)?total/i.test(line.label) ? "is-total" : undefined}
                    >
                      <th scope="row">{line.label}</th>
                      <td>{line.amount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </dd>
          </div>
        )}
        {reasons === undefined || reasons.trim() === "" ? null : (
          <div>
            <dt>Reasons</dt>
            <dd>
              <details className="decision-card-reasons">
                <summary>Show the assistant's reasons</summary>
                <Markdown text={reasons} />
              </details>
            </dd>
          </div>
        )}
        <div>
          <dt>Where it went</dt>
          <dd>
            <RoutingDiagram rows={rows} />
          </dd>
        </div>
      </dl>
      {decision !== undefined ? (
        <p className="decision-card-recorded" role="status">
          <span className={`state state--${DECIDED[decision.kind].tone}`}>
            <strong>{DECIDED[decision.kind].label}</strong>
          </span>
          {decision.kind === "edited" && decision.note !== "" ? <span>{decision.note}</span> : null}
          <span className="decision-card-note">
            Recorded in this browser. Nothing was sent to a model.
          </span>
        </p>
      ) : note !== undefined ? (
        <form
          className="decision-card-edit"
          onSubmit={(event) => {
            event.preventDefault();
            decide("edited", note.trim());
          }}
        >
          <label htmlFor="decision-note">Your change</label>
          <input
            id="decision-note"
            value={note}
            placeholder="For example, pay 6 of 9 sessions"
            autoFocus
            onChange={(event) => setNote(event.currentTarget.value)}
          />
          <button className="button-primary" type="submit">
            Save
          </button>
          <button className="button-secondary" type="button" onClick={() => setNote(undefined)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="decision-card-actions">
          <button className="button-primary" type="button" onClick={() => decide("approved")}>
            Approve
          </button>
          <button className="button-secondary" type="button" onClick={() => setNote("")}>
            Edit
          </button>
          <button className="button-secondary" type="button" onClick={() => decide("rejected")}>
            Reject
          </button>
        </div>
      )}
    </article>
  );
}

export interface AmountLine {
  readonly label: string;
  readonly amount: string;
}

/** The lines of the reasons that read "item: EUR amount", one per item, in order. */
export function amountLines(reasons: string): AmountLine[] {
  return reasons
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
        .replace(/\*\*/g, "")
        .trim(),
    )
    .flatMap((line) => {
      const match = /^(.{1,90}?):\s*(EUR\s?\d[\d.,]*)\.?$/.exec(line);
      return match === null ? [] : [{ label: match[1], amount: match[2] }];
    });
}
