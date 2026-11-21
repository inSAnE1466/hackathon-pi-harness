import { type KeyboardEvent, useRef, useState } from "react";
import { policy, at, results } from "../../evals/baseline.json";
import { summary } from "../../evals/compare-latest.json";
import {
  type AuditRow,
  type ChainCheck,
  actionLabel,
  actorLabel,
  DECISIONS,
  decisionOf,
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
  /** The server's check of the hash chain. */
  readonly chain?: ChainCheck;
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
  chain,
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
          <Trace steps={traceOf(rows, running)} loaded={loaded} empty={rows.length === 0} />
        ) : (
          <AuditLog
            sessionId={sessionId}
            rows={rows}
            loaded={loaded}
            {...(chain === undefined ? {} : { chain })}
          />
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
          <li
            key={step.id}
            className={`trace-step trace-step--${step.state} trace-step--${step.id}`}
          >
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
  chain,
}: {
  readonly sessionId: string;
  readonly rows: readonly AuditRow[];
  readonly loaded: boolean;
  readonly chain?: ChainCheck;
}) {
  return (
    <div className="audit">
      <div className="audit-intro">
        <div>
          <h3>Audit log</h3>
          <p>
            Every step and every person's decision, hash-chained. Ids and routes, never prompt text.
          </p>
        </div>
        <a
          className="button-secondary"
          href={`/api/sessions/${sessionId}/audit?format=csv`}
          download={`audit-trail-${sessionId.slice(0, 8)}.csv`}
          aria-disabled={rows.length === 0}
        >
          Download trail
        </a>
      </div>
      {chain === undefined ? null : (
        <p className="audit-chain" role="status">
          {chain.ok ? (
            <span className="state state--passed">
              <strong>Chain verified</strong>
            </span>
          ) : (
            <span className="state state--blocked">
              <strong>Chain broken at row #{chain.brokenAt}</strong>
            </span>
          )}
          <span>
            {chain.rows} {chain.rows === 1 ? "row" : "rows"}, SHA-256
          </span>
        </p>
      )}
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
                <th scope="col">#</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Route</th>
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
      <EvalStrip />
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
  config: "Config",
};

const EMPTY = <span className="audit-empty">None</span>;

/** One row: who acted, what happened, and for a BRANE row the route, model, categories and rule. */
function AuditLine({ row }: { readonly row: AuditRow }) {
  const time = new Date(row.at);
  const brane = row.kind === "brane";
  const route = brane ? ROUTES[routeOf(row)] : undefined;
  const categories = brane
    ? [...list(row.piiTypes), ...list(row.semanticMatches)]
    : row.kind === "masked"
      ? list(row.detail)
      : [];
  const model = row.modelResolved.split(/[:/]/).at(-1) ?? "";
  const rule = row.refusedBy === "" ? "" : ruleName(row.refusedBy);
  return (
    <tr className={row.kind === "human" ? "audit-row--human" : undefined}>
      <td className="mono audit-id">
        <time dateTime={row.at} title={time.toLocaleString()}>
          {row.id}
        </time>
      </td>
      <td className="audit-actor">{actorLabel(row)}</td>
      <td>
        <span className="audit-kind">{KIND_LABEL[row.kind] ?? row.kind}</span>
        <span className="audit-detail">{auditDetail(row)}</span>
        {categories.length === 0 ? null : <Chips values={categories} />}
      </td>
      <td>
        {route === undefined ? (
          EMPTY
        ) : (
          <>
            <span className={`state state--${route.tone}`}>{route.label}</span>
            <span className="audit-detail mono" title={row.modelResolved}>
              {rule !== "" ? rule : model === "" ? "Not sent" : model}
            </span>
          </>
        )}
      </td>
    </tr>
  );
}

function auditDetail(row: AuditRow): string {
  switch (row.kind) {
    case "brane":
      return row.localCause === ""
        ? actionLabel(row)
        : `Kept local: ${localCauseLabel(row.localCause)}`;
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
    case "human": {
      const decision = decisionOf(row);
      const label = decision === undefined ? row.action : DECISIONS[decision].label;
      return `${label} handoff #${row.refId}${row.detail === "" ? "" : `: ${row.detail}`}`;
    }
    case "config":
      return row.detail;
    case "request":
      return row.refId > 0 ? `Decision #${row.refId} sent to the assistant` : "Sent a message";
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
