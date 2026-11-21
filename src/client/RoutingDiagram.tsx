import { type AuditRow, handoffOf, routeOf } from "./decision-log.ts";

interface Lane {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly count: number;
  readonly tone: "ink" | "blocked";
}

/** Where this claim's work went, counted from the audit rows. */
export function lanesOf(rows: readonly AuditRow[]): Lane[] {
  const brane = rows.filter((row) => row.kind === "brane");
  const model = (route: string): string =>
    brane
      .find((row) => routeOf(row) === route && row.modelResolved !== "")
      ?.modelResolved.split(/[:/]/)
      .at(-1) ?? "";
  const count = (route: string): number => brane.filter((row) => routeOf(row) === route).length;
  const people = [
    ...new Set(rows.filter((row) => row.kind === "handoff").map((row) => handoffOf(row).role)),
  ];
  const lanes: Lane[] = [
    {
      key: "local",
      label: "Local model",
      detail: model("local") || "Inside the perimeter",
      count: count("local"),
      tone: "ink",
    },
    {
      key: "cloud",
      label: "Frontier model, protected",
      detail: model("cloud") || "Placeholders only",
      count: count("cloud"),
      tone: "ink",
    },
    {
      key: "person",
      label: "Person",
      detail: people.length === 0 ? "No handoff" : people.join(", "),
      count: rows.filter((row) => row.kind === "handoff").length,
      tone: "ink",
    },
  ];
  const refused = count("refused");
  return refused === 0
    ? lanes
    : [
        ...lanes,
        {
          key: "refused",
          label: "Refused by BRANE",
          detail: "Not sent",
          count: refused,
          tone: "blocked",
        },
      ];
}

const ROW = 44;

/** A small diagram: the claim on the left, a line to each place its work went, with the number of requests. */
export function RoutingDiagram({ rows }: { readonly rows: readonly AuditRow[] }) {
  const lanes = lanesOf(rows);
  const height = lanes.length * ROW;
  const origin = { x: 12, y: height / 2 };
  return (
    <figure className="routing">
      <svg
        viewBox={`0 0 360 ${height}`}
        role="img"
        aria-label={lanes.map((lane) => `${lane.label}: ${lane.count}`).join(", ")}
      >
        <circle cx={origin.x} cy={origin.y} r="5" className="routing-origin" />
        {lanes.map((lane, index) => {
          const y = index * ROW + ROW / 2;
          const used = lane.count > 0;
          return (
            <g
              key={lane.key}
              className={`routing-lane${used ? " routing-lane--used" : ""} routing-lane--${lane.tone}`}
            >
              <path d={`M ${origin.x + 5} ${origin.y} C 70 ${origin.y}, 70 ${y}, 120 ${y}`} />
              <circle cx="124" cy={y} r="4" />
              <text x="138" y={y - 3} className="routing-label">
                {lane.label}
              </text>
              <text x="138" y={y + 12} className="routing-detail">
                {lane.detail}
              </text>
              <text x="352" y={y + 4} className="routing-count" textAnchor="end">
                {lane.count}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
