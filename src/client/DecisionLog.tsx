import type { ReactNode } from "react";
import {
  type AuditRow,
  actionLabel,
  handoffOf,
  headline,
  list,
  localCauseLabel,
  ROUTES,
  routeOf,
  ruleName,
  toCsv,
} from "./decision-log.ts";

interface DecisionLogProps {
  readonly sessionId: string;
  readonly rows: readonly AuditRow[];
  readonly loaded: boolean;
  readonly error?: string;
}

/** Every BRANE decision and gate event of this session, newest first, with headline counts and a CSV export. */
export function DecisionLog({ sessionId, rows, loaded, error }: DecisionLogProps) {
  const counts = headline(rows);

  const exportCsv = (): void => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `decision-log-${sessionId.slice(0, 8)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <aside className="decision-log" aria-labelledby="decision-log-heading">
      <header className="decision-log-header">
        <div>
          <h2 id="decision-log-heading">Decision log</h2>
          <p>What BRANE decided for every model request in this session.</p>
        </div>
        <button
          className="button-secondary"
          type="button"
          onClick={exportCsv}
          disabled={rows.length === 0}
        >
          Export CSV
        </button>
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
  const time = <RowTime at={row.at} />;
  switch (row.kind) {
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
