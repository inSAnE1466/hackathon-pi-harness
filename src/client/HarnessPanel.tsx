import { type KeyboardEvent, useRef, useState } from "react";
import { policy, at, results } from "../../evals/baseline.json";
import { summary } from "../../evals/compare-latest.json";
import type { DecisionKind } from "./claims.ts";
import {
  type AuditRow,
  actionLabel,
  handoffOf,
  list,
  localCauseLabel,
  ROUTES,
  routeOf,
  ruleName,
} from "./decision-log.ts";
import { type Step, traceOf } from "./trace.ts";

interface HarnessPanelProps {
  readonly sessionId: string;
  readonly rows: readonly AuditRow[];
  readonly loaded: boolean;
  readonly running: boolean;
  readonly decision?: DecisionKind;
  readonly error?: string;
}

const TABS = [
  { id: "trace", label: "Trace" },
  { id: "audit", label: "Audit log" },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** "How the harness decided" for the selected claim: its path as a diagram, and every audit row. */
export function HarnessPanel({
  sessionId,
  rows,
  loaded,
  running,
  decision,
  error,
}: HarnessPanelProps) {
  const [tab, setTab] = useState<TabId>("trace");
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({ trace: null, audit: null });

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>): void => {
    const index = TABS.findIndex((candidate) => candidate.id === tab);
    const next =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? (index + 1) % TABS.length
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? (index - 1 + TABS.length) % TABS.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? TABS.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    setTab(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  };

  return (
    <aside className="harness" aria-labelledby="harness-heading">
      <header className="harness-header">
        <h2 id="harness-heading">How the harness decided</h2>
        <div className="tabs" role="tablist" aria-label="View" onKeyDown={moveFocus}>
          {TABS.map((candidate) => (
            <button
              key={candidate.id}
              ref={(element) => {
                tabRefs.current[candidate.id] = element;
              }}
              id={`tab-${candidate.id}`}
              className="tab"
              type="button"
              role="tab"
              aria-selected={tab === candidate.id}
              aria-controls={`panel-${candidate.id}`}
              tabIndex={tab === candidate.id ? 0 : -1}
              onClick={() => setTab(candidate.id)}
            >
              {candidate.label}
              {candidate.id === "audit" && rows.length > 0 ? (
                <span className="count">{rows.length}</span>
              ) : null}
            </button>
          ))}
        </div>
      </header>

      {error === undefined ? null : (
        <p className="inline-error harness-error" role="alert">
          {error}
        </p>
      )}

      <div
        id={`panel-${tab}`}
        className="harness-body"
        role="tabpanel"
        aria-labelledby={`tab-${tab}`}
        tabIndex={0}
      >
        {tab === "trace" ? (
          <Trace
            steps={traceOf(rows, running, decision)}
            loaded={loaded}
            empty={rows.length === 0}
          />
        ) : (
          <AuditLog sessionId={sessionId} rows={rows} loaded={loaded} />
        )}
      </div>
    </aside>
  );
}

const STEP_STATE: Record<Step["state"], string> = {
  idle: "Not reached",
  done: "Done",
  active: "Now",
  refused: "Refused",
};

/** Chips per step, so each step keeps one fixed height; the audit log lists the rest. */
const TRACE_CHIPS = 3;

function Trace({
  steps,
  loaded,
  empty,
}: {
  readonly steps: readonly Step[];
  readonly loaded: boolean;
  readonly empty: boolean;
}) {
  return (
    <div className="trace-wrap">
      <p className="quiet trace-lede">
        {!loaded
          ? "Loading the audit log…"
          : empty
            ? "Nothing has run yet. The steps fill in as the claim is processed."
            : "The path of this claim, from the audit log."}
      </p>
      <ol className="trace" aria-label="Claim path">
        {steps.map((step) => (
          <li key={step.id} className={`trace-step trace-step--${step.state}`}>
            <span className="trace-node" aria-hidden="true" />
            <div className="trace-text">
              <div className="trace-title">
                <strong>{step.title}</strong>
                <span className="trace-state">{STEP_STATE[step.state]}</span>
              </div>
              <p>{step.summary}</p>
              <ul className="chips trace-chips">
                {step.chips.slice(0, TRACE_CHIPS).map((chip) => (
                  <li key={chip} className="chip">
                    {chip}
                  </li>
                ))}
                {step.chips.length > TRACE_CHIPS ? (
                  <li className="chip chip--more">+{step.chips.length - TRACE_CHIPS} more</li>
                ) : null}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AuditLog({
  sessionId,
  rows,
  loaded,
}: {
  readonly sessionId: string;
  readonly rows: readonly AuditRow[];
  readonly loaded: boolean;
}) {
  const exportCsv = (): void => {
    // The server's export: the whole trail with actors and the hash chain.
    const link = document.createElement("a");
    link.href = `/api/sessions/${sessionId}/audit?format=csv`;
    link.download = `audit-trail-${sessionId.slice(0, 8)}.csv`;
    link.click();
  };

  return (
    <div className="audit">
      <EvalStrip />
      <div className="audit-intro">
        <div>
          <h3>Audit log</h3>
          <p>
            A record of every automated step for this claim, so each one can be traced. It stores
            routes, categories and ids. It never stores prompt text.
          </p>
        </div>
        <button
          className="button-secondary"
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          Export CSV
        </button>
      </div>
      <p className="audit-basis">
        Basis: EU AI Act Art. 12 (record-keeping), Art. 26(6) (deployers keep logs), GDPR Art. 5(2)
        (accountability).
      </p>
      {!loaded ? (
        <p className="quiet">Loading the audit log…</p>
      ) : rows.length === 0 ? (
        <p className="quiet">No rows yet. Each model request and gate step adds one.</p>
      ) : (
        <div className="audit-scroll">
          <table className="audit-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Kind</th>
                <th scope="col">Route</th>
                <th scope="col">Categories</th>
                <th scope="col">Rule</th>
                <th scope="col">Model</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <AuditLine key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const pair = ([a, b]: readonly number[]): string => `${a}/${b}`;

/** The latest QC run (evals/baseline.json) and the routing comparison (evals/compare-latest.json), as shipped. */
function EvalStrip() {
  const ran = new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const items = [
    {
      label: "Golden set",
      value: pair(results.golden.passed),
      note: `${pair(results.golden.leaked)} leaked`,
    },
    {
      label: "Held out",
      value: pair(results.heldout.passed),
      note: `${pair(results.heldout.leaked)} leaked`,
    },
    { label: "Organisers", value: pair(results.organizers.passed), note: "track tests" },
    {
      label: "Unsafe routes",
      value: `${summary.harness.unsafe}/${summary.harness.decisions}`,
      note: `LLM alone ${summary["ask-llm"].unsafe}/${summary["ask-llm"].decisions}`,
    },
  ];
  return (
    <section className="evals" aria-labelledby="evals-heading">
      <h3 id="evals-heading" className="evals-heading">
        Latest QC run <span className="mono">{policy}</span> <span>{ran}</span>
      </h3>
      <dl className="evals-grid">
        {items.map((item) => (
          <div key={item.label}>
            <dt>{item.label}</dt>
            <dd>{item.value}</dd>
            <dd className="evals-note">{item.note}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const KIND_LABEL: Record<AuditRow["kind"], string> = {
  brane: "BRANE",
  masked: "Gate",
  lookup: "Lookup",
  handoff: "Handoff",
  intake: "Intake",
  request: "Request",
  human: "Person",
};

const EMPTY = <span className="audit-empty">None</span>;

function AuditLine({ row }: { readonly row: AuditRow }) {
  const time = new Date(row.at);
  const brane = row.kind === "brane";
  const route = brane ? ROUTES[routeOf(row)] : undefined;
  const categories = brane
    ? [...list(row.piiTypes), ...list(row.semanticMatches)]
    : row.kind === "masked"
      ? list(row.detail)
      : [];
  const model = row.modelResolved.split("/").at(-1) ?? "";
  return (
    <tr>
      <td className="audit-time">
        <time dateTime={row.at} title={time.toLocaleString()}>
          {time.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </time>
      </td>
      <td>{KIND_LABEL[row.kind] ?? row.kind}</td>
      <td>
        {route === undefined ? (
          EMPTY
        ) : (
          <span className={`state state--${route.tone}`}>{route.label}</span>
        )}
      </td>
      <td>{categories.length === 0 ? EMPTY : <Chips values={categories} />}</td>
      <td className="mono">{row.refusedBy === "" ? EMPTY : ruleName(row.refusedBy)}</td>
      <td className="mono" title={row.modelResolved}>
        {brane ? (model === "" ? "Not sent" : model) : EMPTY}
      </td>
      <td>{auditDetail(row)}</td>
    </tr>
  );
}

function auditDetail(row: AuditRow): string {
  switch (row.kind) {
    case "brane":
      return row.localCause === ""
        ? actionLabel(row)
        : `${actionLabel(row)}, local because ${localCauseLabel(row.localCause)}`;
    case "masked":
      return "Identifiers masked before BRANE";
    case "lookup":
      return `Cited ${list(row.detail).join(", ")}`;
    case "handoff":
      return handoffOf(row).sentence;
    case "intake":
      return row.detail === "split"
        ? "Split, health facts kept local"
        : row.detail === "unchanged"
          ? "Unchanged"
          : row.detail;
    default:
      return row.detail;
  }
}

function Chips({ values }: { readonly values: readonly string[] }) {
  return (
    <ul className="chips">
      {values.map((value) => (
        <li key={value} className="chip">
          {value}
        </li>
      ))}
    </ul>
  );
}
