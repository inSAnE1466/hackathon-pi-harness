import { useState } from "react";
import {
  type AuditRow,
  citedPassages,
  DECISIONS,
  decisionOf,
  type HumanDecision,
  handoffOf,
  passageIds,
  recordHuman,
} from "./decision-log.ts";
import { Markdown } from "./Markdown.tsx";
import { RoutingDiagram } from "./RoutingDiagram.tsx";

/** The card's own state. Whether a decision exists is read from the audit rows, never kept here. */
type Draft =
  | { readonly step: "idle" }
  | { readonly step: "writing"; readonly note: string }
  | { readonly step: "sending"; readonly decision: HumanDecision; readonly note: string }
  | { readonly step: "failed"; readonly error: string; readonly note: string }
  | { readonly step: "recorded"; readonly row: AuditRow };

interface DecisionCardProps {
  readonly sessionId: string;
  /** The handoff this card answers. */
  readonly handoff: AuditRow;
  readonly rows: readonly AuditRow[];
  /** The reasons the assistant gave with its recommendation, if the transcript has them. */
  readonly reasons?: string;
  /** Called once the server has the human row, so the log and the chat read it back. */
  readonly onRecorded: () => void;
}

/**
 * A person's answer to one handoff. For a recommendation: the amounts, the cited passages, where the work went, and
 * Approve, Edit or Reject. For a consult: the expert's answer. Either posts a human row to the audit trail, and the
 * server passes the decision back into the conversation, through BRANE like every other model request.
 */
export function DecisionCard({ sessionId, handoff, rows, reasons, onRecorded }: DecisionCardProps) {
  const [draft, setDraft] = useState<Draft>({ step: "idle" });
  const { tool, role, sentence } = handoffOf(handoff);
  const consult = tool === "consult";

  const decide = async (decision: HumanDecision, note = ""): Promise<void> => {
    setDraft({ step: "sending", decision, note });
    try {
      const row = await recordHuman(sessionId, {
        handoffId: handoff.id,
        decision,
        note,
        reviewer: role,
      });
      setDraft({ step: "recorded", row });
      onRecorded();
    } catch (cause) {
      setDraft({
        step: "failed",
        error: cause instanceof Error ? cause.message : "Not recorded",
        note,
      });
    }
  };

  const heading = consult ? `Question for the ${role.toLowerCase()}` : "Claims handler's decision";
  const id = `decision-${handoff.id}`;
  const sending = draft.step === "sending";
  const note = draft.step === "writing" || draft.step === "failed" ? draft.note : "";

  return (
    <article className="decision-card" aria-labelledby={`${id}-heading`} data-handoff={handoff.id}>
      <header>
        <p className="eyebrow">Handoff #{handoff.id}</p>
        <h3 id={`${id}-heading`}>{heading}</h3>
      </header>
      {consult ? (
        <p className="decision-card-question">{sentence}. The assistant waits for the answer.</p>
      ) : (
        <Recommendation
          handoff={handoff}
          rows={rows}
          {...(reasons === undefined ? {} : { reasons })}
        />
      )}

      {draft.step === "recorded" ? (
        <Recorded row={draft.row} />
      ) : consult ||
        draft.step === "writing" ||
        draft.step === "failed" ||
        (sending && draft.note !== "") ? (
        <form
          className="decision-card-edit"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim() === "") return;
            void decide(consult ? "answered" : "edited", note.trim());
          }}
        >
          <label htmlFor={`${id}-note`}>{consult ? "Your answer" : "Your change"}</label>
          <textarea
            id={`${id}-note`}
            rows={2}
            maxLength={500}
            value={sending ? draft.note : note}
            disabled={sending}
            placeholder={
              consult
                ? "For example, the fracture is consistent with the fall"
                : "For example, pay 6 of 9 sessions"
            }
            onChange={(event) => setDraft({ step: "writing", note: event.currentTarget.value })}
          />
          <div className="decision-card-actions">
            <button
              className="button-primary"
              type="submit"
              disabled={sending || note.trim() === ""}
            >
              {sending ? "Recording…" : consult ? "Send answer" : "Save change"}
            </button>
            {consult ? null : (
              <button
                className="button-secondary"
                type="button"
                disabled={sending}
                onClick={() => setDraft({ step: "idle" })}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      ) : (
        <div className="decision-card-actions">
          <button
            className="button-primary"
            type="button"
            disabled={sending}
            onClick={() => void decide("approved")}
          >
            {sending && draft.decision === "approved" ? "Recording…" : "Approve"}
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={sending}
            onClick={() => setDraft({ step: "writing", note: "" })}
          >
            Edit
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={sending}
            onClick={() => void decide("rejected")}
          >
            {sending && draft.decision === "rejected" ? "Recording…" : "Reject"}
          </button>
        </div>
      )}
      {draft.step === "failed" ? (
        <p className="inline-error" role="alert">
          Not recorded: {draft.error}. Nothing was sent to the assistant.
        </p>
      ) : null}
    </article>
  );
}

/** The decision as the audit trail holds it. */
function Recorded({ row }: { readonly row: AuditRow }) {
  const decision = decisionOf(row);
  const label = decision === undefined ? row.action : DECISIONS[decision].label;
  return (
    <p className="decision-card-recorded" role="status">
      <span
        className={`state state--${decision === undefined ? "waiting" : DECISIONS[decision].tone}`}
      >
        <strong>{label}</strong>
      </span>
      <span>
        by {row.actor},{" "}
        {new Date(row.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
      </span>
      <span className="decision-card-note">Audit row #{row.id}. Sending it to the assistant…</span>
    </p>
  );
}

function Recommendation({
  handoff,
  rows,
  reasons,
}: {
  readonly handoff: AuditRow;
  readonly rows: readonly AuditRow[];
  readonly reasons?: string;
}) {
  const recommendation = handoffOf(handoff).sentence.replace(/^.*: /, "");
  // The ids the reasons cite, kept only where a lookup returned them, so a document number never reads as a passage.
  const looked = citedPassages(rows);
  const fromReasons =
    reasons === undefined ? [] : passageIds(reasons).filter((id) => looked.includes(id));
  const cited = fromReasons.length > 0 ? fromReasons : looked;
  const amounts = reasons === undefined ? [] : amountLines(reasons);
  return (
    <dl className="decision-card-facts">
      <div>
        <dt>Recommendation</dt>
        <dd className="decision-card-recommendation">{recommendation}</dd>
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
      <div>
        <dt>Cited</dt>
        <dd>
          {cited.length === 0 ? (
            "None"
          ) : (
            <ul className="chips">
              {cited.map((passage) => (
                <li key={passage} className="chip">
                  {passage}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </div>
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
