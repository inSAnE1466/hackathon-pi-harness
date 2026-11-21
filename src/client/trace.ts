import {
  type AuditRow,
  DECISIONS,
  decisionOf,
  handoffOf,
  list,
  openHandoffs,
  routeOf,
  ruleName,
} from "./decision-log.ts";

/**
 * A claim's path through the harness, derived from its decision log (rows newest first): intake, the pre-mask, BRANE,
 * tools, person. The steps never move; they only fill in, so the diagram does not shift while a turn runs. BRANE is
 * the only gate. The pre-mask is pattern matching in our own code (`src/primitives/detect.ts`), drawn as a small
 * step on the edge into BRANE. A local classifier step has a slot that shows only once its audit rows exist.
 */
export type StepId = "intake" | "classifier" | "premask" | "brane" | "tools" | "person";

/** A full node for a step that decides or acts, a small mark on the line for a deterministic rule. */
export type StepWeight = "node" | "rule";

export type StepState = "idle" | "done" | "active" | "refused";

export interface Step {
  readonly id: StepId;
  readonly weight: StepWeight;
  readonly title: string;
  readonly state: StepState;
  /** One line on what happened, or what the step does while not reached. */
  readonly summary: string;
  readonly chips: readonly string[];
}

const IDLE: Record<StepId, { readonly title: string; readonly summary: string }> = {
  intake: {
    title: "Intake (local model, inside BRANE)",
    summary: "Splits health facts from the claim",
  },
  classifier: { title: "Classifier (local model)", summary: "Labels the request before BRANE" },
  premask: {
    title: "Pre-mask (regex)",
    summary:
      "Pattern rules in our code: BSN checksum, policy, claim and passport numbers, plates. No model.",
  },
  brane: { title: "BRANE (the gate)", summary: "Decides the route for each request" },
  tools: { title: "Tools", summary: "Policy and law lookups, handoffs" },
  person: { title: "Person", summary: "An adviser or the claims handler" },
};

const unique = (values: readonly string[]): string[] => [...new Set(values)];

function intakeSummary(detail: string): string {
  if (detail === "split") return "Split, health facts kept local";
  if (detail === "unchanged") return "Unchanged, no health data to split";
  if (detail.startsWith("kept local")) return "Kept local as a whole";
  return detail;
}

export function traceOf(rows: readonly AuditRow[], running: boolean): Step[] {
  const oldest = [...rows].sort((a, b) => a.id - b.id);
  const of = (kind: AuditRow["kind"]) => oldest.filter((row) => row.kind === kind);
  const intake = of("intake");
  const masked = of("masked");
  // The server writes no classifier rows yet; the step stays hidden until it does.
  const classified = oldest.filter((row) => (row.kind as string) === "classifier");
  const brane = of("brane");
  const lookups = of("lookup");
  const handoffRows = of("handoff");
  const handoffs = handoffRows.map(handoffOf);
  const humans = of("human");
  const open = openHandoffs(rows).map(handoffOf);
  const refused = brane.filter((row) => routeOf(row) === "refused");

  const steps: Step[] = [];
  const push = (id: StepId, reached: boolean, summary: string, chips: string[] = []): void => {
    steps.push({
      id,
      weight: id === "premask" ? "rule" : "node",
      title: IDLE[id].title,
      state: reached ? "done" : "idle",
      summary: reached ? summary : IDLE[id].summary,
      chips: reached ? chips : [],
    });
  };

  const lastIntake = intake.at(-1);
  push("intake", lastIntake !== undefined, intakeSummary(lastIntake?.detail ?? ""));

  if (classified.length > 0) {
    const labels = unique(classified.flatMap((row) => list(row.detail)));
    push("classifier", true, `${classified.length} labelled`, labels);
  }

  // The findings are the pattern kinds that fired, e.g. BSN or POLICY_ID; the values never reach the log.
  const fired = unique(masked.flatMap((row) => list(row.detail)));
  push(
    "premask",
    masked.length > 0 || brane.length > 0,
    fired.length > 0
      ? `Masked before BRANE: ${fired.length} ${fired.length === 1 ? "pattern" : "patterns"} fired`
      : "No pattern fired, nothing to mask",
    fired,
  );

  const routes = { cloud: 0, local: 0 };
  for (const row of brane) {
    const route = routeOf(row);
    if (route === "cloud") routes.cloud += 1;
    else if (route === "local") routes.local += 1;
  }
  const routeParts = [
    routes.cloud > 0 ? `${routes.cloud} cloud, protected` : "",
    routes.local > 0 ? `${routes.local} local` : "",
    refused.length > 0 ? `${refused.length} refused` : "",
  ].filter(Boolean);
  const categories = unique(
    brane.flatMap((row) => [...list(row.piiTypes), ...list(row.semanticMatches)]),
  );
  push(
    "brane",
    brane.length > 0,
    `${brane.length} ${brane.length === 1 ? "request" : "requests"}: ${routeParts.join(", ")}`,
    refused.length > 0 ? unique(refused.map((row) => ruleName(row.refusedBy))) : categories,
  );
  const braneIndex = steps.findIndex((step) => step.id === "brane");
  if (refused.length > 0) steps[braneIndex] = { ...steps[braneIndex], state: "refused" };

  const cited = unique(lookups.flatMap((row) => list(row.detail)));
  const toolParts = [
    lookups.length > 0 ? `lookup ${lookups.length}x` : "",
    ...unique(handoffs.map((handoff) => handoff.tool)),
  ].filter(Boolean);
  push("tools", toolParts.length > 0, toolParts.join(", "), cited);

  const lastHuman = humans.at(-1);
  const lastDecision = lastHuman === undefined ? undefined : decisionOf(lastHuman);
  const personSummary =
    open.length > 0
      ? `With the ${unique(open.map((handoff) => handoff.role.toLowerCase())).join(" and the ")}`
      : lastHuman !== undefined && lastDecision !== undefined
        ? `${lastHuman.actor}: ${DECISIONS[lastDecision].label.toLowerCase()}`
        : refused.length > 0
          ? "Needs a person, nothing was sent"
          : "";
  push(
    "person",
    personSummary !== "",
    personSummary,
    humans.map((row) => `#${row.id} ${row.actor}`),
  );

  // The yellow step is where the claim is now: the furthest step reached while a turn runs, or a person it waits on.
  const reached = steps.map((step) => step.state !== "idle");
  const furthest = reached.lastIndexOf(true);
  const activeIndex = running ? Math.max(furthest, 0) : open.length > 0 ? steps.length - 1 : -1;
  if (activeIndex >= 0 && steps[activeIndex].state !== "refused")
    steps[activeIndex] = { ...steps[activeIndex], state: "active" };
  return steps;
}
