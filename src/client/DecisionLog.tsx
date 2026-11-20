import type { ReactNode } from "react";
import {
  type AuditRow,
  type ChainCheck,
  actionLabel,
  actorLabel,
  handoffOf,
  headline,
  list,
  localCauseLabel,
  ROUTES,
  routeOf,
  ruleName,
} from "./decision-log.ts";

interface DecisionLogProps {
  readonly sessionId: string;
  readonly rows: readonly AuditRow[];
  readonly chain?: ChainCheck;
  readonly loaded: boolean;
  readonly error?: string;
}

/**
 * Every decision of this session, newest first: BRANE's routes, the gate's events, who asked and who decided. Shows
 * whether the hash chain verifies and links the whole trail as CSV.
 */
export function DecisionLog({ sessionId, rows, chain, loaded, error }: DecisionLogProps) {
  const counts = headline(rows);

  return (
    <aside className="decision-log" aria-labelledby="decision-log-heading">
      <header className="decision-log-header">
        <div>
          <h2 id="decision-log-heading">Decision log</h2>
          <p>Who did what, for every request in this session.</p>
          {chain === undefined ? null : chain.ok ? (
            <p className="chain chain--ok" role="status">
              <span className="state state--passed">Chain verified</span> {chain.rows} rows, none
              changed
            </p>
          ) : (
            <p className="chain chain--broken" role="alert">
              <span className="state state--blocked">Chain broken</span> at row {chain.brokenAt}
            </p>
          )}
        </div>
        <a
          className="button-secondary"
          href={`/api/sessions/${sessionId}/audit?format=csv`}
          download
          aria-disabled={rows.length === 0}
        >
          Download trail
        </a>
      </header>

      <dl className="headline" aria-label="Totals">
        <Count label="Requests" value={counts.requests} />
        <Count label="Cloud, protected" value={counts.cloud} />
        <Count label="Kept local" value={counts.local} />
        <Count label="Refused" value={counts.refused} />
        <Count label="Handoffs" value={counts.handoffs} />
      </dl>

      <div className="decision-log-rows">
        {error === undefined ? null : (
          <p className="decision-log-empty" role="alert">
            {error}
          </p>
        )}
        {!loaded ? (
          <p className="decision-log-empty">Loading the decision log…</p>
        ) : rows.length === 0 ? (
          <p className="decision-log-empty">
            No decisions yet. Each model request appears here as BRANE decides it.
          </p>
        ) : (
          <ol aria-label="Decisions, newest first">
            {rows.map((row) => (
              <li key={row.id}>
                <DecisionRow row={row} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </aside>
  );
}

function Count({ label, value }: { readonly label: string; readonly value: number }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

export function DecisionRow({ row }: { readonly row: AuditRow }) {
  const time = (
    <span className="decision-meta">
      <span className="decision-actor">{actorLabel(row)}</span>
      <RowTime at={row.at} />
    </span>
  );
  switch (row.kind) {
    case "request":
      return (
        <article className="decision decision--gate">
          <header>
            <strong>{row.actor} sent a request</strong>
            {time}
          </header>
        </article>
      );
    case "intake":
      return (
        <article className="decision decision--gate">
          <header>
            <strong>Intake on the local model</strong>
            {time}
          </header>
          <Chips values={list(row.detail)} />
        </article>
      );
    case "human":
      return (
        <article className="decision decision--handoff">
          <header>
            <span className={`state state--${row.action === "rejected" ? "blocked" : "passed"}`}>
              <strong>
                {row.actor} {row.action} the case (row {row.refId})
              </strong>
            </span>
            {time}
          </header>
          {row.detail === "" ? null : <p className="decision-note">{row.detail}</p>}
        </article>
      );
    case "brane":
      return <BraneRow row={row} time={time} />;
    case "masked":
      return (
        <article className="decision decision--gate">
          <header>
            <strong>Identifiers masked before BRANE</strong>
            {time}
          </header>
          <Chips values={list(row.detail)} />
        </article>
      );
    case "lookup":
      return (
        <article className="decision decision--gate">
          <header>
            <strong>Passages cited</strong>
            {time}
          </header>
          <Chips values={list(row.detail)} />
        </article>
      );
    case "handoff":
      return (
        <article className="decision decision--handoff">
          <header>
            <span className="state state--waiting">
              <strong>{handoffOf(row).sentence}</strong>
            </span>
            {time}
          </header>
        </article>
      );
  }
}

function BraneRow({ row, time }: { readonly row: AuditRow; readonly time: ReactNode }) {
  const route = ROUTES[routeOf(row)];
  const detected = list(row.piiTypes);
  const semantic = list(row.semanticMatches);
  return (
    <article className="decision">
      <header>
        <span className={`route route--${route.tone}`}>{route.label}</span>
        {time}
      </header>
      <dl className="decision-facts">
        <div>
          <dt>Detected</dt>
          <dd>{detected.length === 0 ? "Nothing" : <Chips values={detected} />}</dd>
        </div>
        {semantic.length === 0 ? null : (
          <div>
            <dt>Semantic match</dt>
            <dd>
              <Chips values={semantic} />
            </dd>
          </div>
        )}
        <div>
          <dt>Payload</dt>
          <dd>{actionLabel(row)}</dd>
        </div>
        {row.localCause === "" ? null : (
          <div>
            <dt>Kept local because</dt>
            <dd>{localCauseLabel(row.localCause)}</dd>
          </div>
        )}
        {row.refusedBy === "" ? null : (
          <div>
            <dt>Rule</dt>
            <dd>{ruleName(row.refusedBy)}</dd>
          </div>
        )}
        <div>
          <dt>Model</dt>
          <dd>{row.modelResolved === "" ? "None, nothing was sent" : row.modelResolved}</dd>
        </div>
      </dl>
    </article>
  );
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

function RowTime({ at }: { readonly at: string }) {
  const date = new Date(at);
  return (
    <time dateTime={at} title={date.toLocaleString()}>
      {date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })}
    </time>
  );
}
