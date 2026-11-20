/**
 * The decision log as the client reads it from `GET /api/sessions/:id/audit`, and the pure functions the workspace
 * derives from it: the route of each BRANE row, the headline counts, handoff wording, refusal wording and the
 * decision a person recorded on each handoff. The CSV export is the server's (`GET /audit?format=csv`).
 * Mirrors `AuditRow` in `src/audit.ts`; the server type is not imported because it pulls in Worker-only types.
 */
export interface AuditRow {
  readonly id: number;
  readonly at: string;
  readonly kind: "brane" | "masked" | "handoff" | "lookup" | "intake" | "request" | "human";
  readonly status: number;
  readonly routedTo: string;
  readonly action: string;
  readonly redacted: boolean;
  readonly piiTypes: string;
  readonly semanticMatches: string;
  readonly localCause: string;
  readonly refusedBy: string;
  readonly modelResolved: string;
  readonly detail: string;
  /** Who acted: `brane`, `gate`, `agent`, or a person's display name. */
  readonly actor: string;
  readonly policyVersion: string;
  /** For a `human` row, the handoff it answers. */
  readonly refId: number;
  readonly prevHash: string;
  readonly hash: string;
}

/** The server's check of the hash chain over every row. */
export type ChainCheck =
  | { readonly ok: true; readonly rows: number }
  | { readonly ok: false; readonly rows: number; readonly brokenAt: number };

export type HumanDecision = "approved" | "rejected" | "edited";

/** The decision a person recorded on each handoff, keyed by the handoff's row id. */
export function decisionsByHandoff(rows: readonly AuditRow[]): ReadonlyMap<number, AuditRow> {
  const decisions = new Map<number, AuditRow>();
  for (const row of rows) if (row.kind === "human") decisions.set(row.refId, row);
  return decisions;
}

/** Who acted, in words. */
export function actorLabel(row: AuditRow): string {
  switch (row.actor) {
    case "brane":
      return "BRANE";
    case "gate":
      return "Our gate";
    case "agent":
      return "The assistant";
    case "":
      return "Unrecorded";
    default:
      return row.actor;
  }
}

export type Route = "cloud" | "local" | "refused" | "unknown";

/** Each route's chip label and the state colour beside it. */
export const ROUTES: Record<Route, { readonly label: string; readonly tone: Tone }> = {
  cloud: { label: "Cloud, protected", tone: "passed" },
  local: { label: "Local model", tone: "passed" },
  refused: { label: "Refused", tone: "blocked" },
  unknown: { label: "No decision", tone: "blocked" },
};

export type Tone = "passed" | "waiting" | "blocked";

export function routeOf(row: AuditRow): Route {
  if (row.routedTo === "refused" || row.status === 422) return "refused";
  if (row.routedTo === "cloud") return "cloud";
  if (row.routedTo === "local") return "local";
  return "unknown";
}

/** Comma-separated header values as a list, without blanks. */
export const list = (value: string): string[] =>
  value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

/** What BRANE did to the payload, in words. */
export function actionLabel(row: AuditRow): string {
  switch (row.action) {
    case "placeholder":
      return "Replaced with placeholders";
    case "redact":
      return "Redacted";
    case "refuse":
      return "Not sent";
    case "allow":
      return row.piiTypes === "" ? "Nothing to protect" : "Allowed by policy";
    default:
      return row.action;
  }
}

const LOCAL_CAUSES: Record<string, string> = {
  data_category_local: "a data category is set to local",
  semantic_category_local: "a semantic category is set to local",
  prompt_injection_local: "possible prompt injection",
};

export const localCauseLabel = (cause: string): string => LOCAL_CAUSES[cause] ?? cause;

export interface Headline {
  readonly requests: number;
  readonly cloud: number;
  readonly local: number;
  readonly refused: number;
  readonly handoffs: number;
}

export function headline(rows: readonly AuditRow[]): Headline {
  const counts = { requests: 0, cloud: 0, local: 0, refused: 0, handoffs: 0 };
  for (const row of rows) {
    if (row.kind === "handoff") counts.handoffs += 1;
    if (row.kind !== "brane") continue;
    counts.requests += 1;
    const route = routeOf(row);
    if (route === "cloud") counts.cloud += 1;
    else if (route === "local") counts.local += 1;
    else if (route === "refused") counts.refused += 1;
  }
  return counts;
}

export interface Handoff {
  readonly tool: string;
  readonly value: string;
  /** Who the case is with. */
  readonly role: string;
  /** One sentence for the log. */
  readonly sentence: string;
}

const RECOMMENDATIONS: Record<string, string> = {
  pay: "pay",
  reduce: "reduce",
  reject: "reject",
  request_documents: "request documents",
};

/** A handoff row's detail is `tool:value`, e.g. `consult:medical` or `request_approval:reduce`. */
export function handoffOf(row: AuditRow): Handoff {
  const split = row.detail.indexOf(":");
  const tool = split < 0 ? row.detail : row.detail.slice(0, split);
  const value = split < 0 ? "" : row.detail.slice(split + 1);
  if (tool === "consult") {
    const role =
      value === "medical" ? "Medical adviser" : value === "legal" ? "Legal reviewer" : "Expert";
    return { tool, value, role, sentence: `Sent to the ${role.toLowerCase()}` };
  }
  const recommendation = RECOMMENDATIONS[value] ?? value;
  return {
    tool,
    value,
    role: "Claims handler",
    sentence: `Recommendation to the claims handler: ${recommendation}`,
  };
}

/** `semantic:CLAIM_OUTCOME_DECISION->refuse` becomes `CLAIM_OUTCOME_DECISION`. */
export function ruleName(refusedBy: string): string {
  return refusedBy.replace(/^(semantic|category):/, "").replace(/->\w+$/, "");
}

export interface Refusal {
  readonly rule: string;
  readonly description?: string;
  readonly legalBasis?: string;
}

/**
 * A model call BRANE refused ends with an error text `422: {json}`. Returns the rule it names, falling back to the
 * latest refused BRANE row in the log, or undefined when the text is not a BRANE refusal.
 */
export function refusalOf(errorText: string, rows: readonly AuditRow[]): Refusal | undefined {
  const match = /(?:^|\s)422: (\{[\s\S]*\})\s*$/.exec(errorText);
  if (match === null) return undefined;
  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (typeof parsed === "object" && parsed !== null) body = parsed as Record<string, unknown>;
  } catch {
    body = {};
  }
  const latest = rows.find((row) => row.kind === "brane" && row.refusedBy !== "");
  const refusedBy = typeof body.rule === "string" ? body.rule : (latest?.refusedBy ?? "");
  const message = typeof body.message === "string" ? body.message : "";
  const description = /\(([^)]+)\)/.exec(message)?.[1];
  const legalBasis = typeof body.legal_basis === "string" ? body.legal_basis : undefined;
  return {
    rule: refusedBy === "" ? "its policy" : ruleName(refusedBy),
    ...(description === undefined ? {} : { description }),
    ...(legalBasis === undefined ? {} : { legalBasis }),
  };
}
