/**
 * The decision log as the client reads it from `GET /api/sessions/:id/audit`, and the pure functions the workspace
 * derives from it: the route of each BRANE row, a claim's status, handoff wording, refusal wording, the decision a
 * person recorded on each handoff, and CSV.
 * Mirrors `AuditRow` in `src/audit.ts`; the server type is not imported because it pulls in Worker-only types.
 */
export interface AuditRow {
  readonly id: number;
  readonly at: string;
  readonly kind:
    | "brane"
    | "masked"
    | "handoff"
    | "lookup"
    | "intake"
    | "request"
    | "human"
    | "cited"
    | "classify"
    | "config";
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
  /** Who acted: `brane`, `pre-mask` or the older `gate` (see `actorLabel`), `agent`, or a person's display name. */
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

/** A person's answer to a handoff: approved, rejected or edited for a recommendation, answered for a consult. */
export type HumanDecision = "approved" | "rejected" | "edited" | "answered";

/** Each decision's label and the state colour beside it. */
export const DECISIONS: Record<HumanDecision, { readonly label: string; readonly tone: Tone }> = {
  approved: { label: "Approved", tone: "passed" },
  edited: { label: "Edited", tone: "passed" },
  rejected: { label: "Rejected", tone: "blocked" },
  answered: { label: "Answered", tone: "passed" },
};

export const decisionOf = (row: AuditRow): HumanDecision | undefined =>
  row.action in DECISIONS ? (row.action as HumanDecision) : undefined;

/**
 * The follow-up the server puts into the conversation after a person decides. Its first two lines are fixed:
 * `[<reviewer>]` and `Human decision on handoff #<id> (<tool>): <decision>`, then an optional `Note: <note>`.
 */
export interface HumanMessage {
  readonly reviewer: string;
  readonly handoffId: number;
  readonly tool: string;
  readonly decision: HumanDecision;
  readonly note: string;
}

const HUMAN_MESSAGE =
  /^\[([^\]]+)\]\nHuman decision on handoff #(\d+) \((\w+)\): (\w+)(?:\nNote: ([^\n]*))?/;

export function humanMessageOf(text: string): HumanMessage | undefined {
  const match = HUMAN_MESSAGE.exec(text);
  if (match === null || !(match[4] in DECISIONS)) return undefined;
  return {
    reviewer: match[1],
    handoffId: Number(match[2]),
    tool: match[3],
    decision: match[4] as HumanDecision,
    note: match[5]?.trim() ?? "",
  };
}

/** Posts a person's decision on a handoff to the audit trail. Resolves with the human row, or throws the reason. */
export async function recordHuman(
  sessionId: string,
  input: {
    readonly handoffId: number;
    readonly decision: HumanDecision;
    readonly note: string;
    readonly reviewer: string;
  },
): Promise<AuditRow> {
  const response = await fetch(`/api/sessions/${sessionId}/audit/human`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => ({}))) as {
    readonly decision?: AuditRow;
    readonly error?: string;
  };
  if (!response.ok || body.decision === undefined)
    throw new Error(body.error ?? `Not recorded (${response.status})`);
  return body.decision;
}

/** The decision a person recorded on each handoff, keyed by the handoff's row id. */
export function decisionsByHandoff(rows: readonly AuditRow[]): ReadonlyMap<number, AuditRow> {
  const decisions = new Map<number, AuditRow>();
  for (const row of rows) if (row.kind === "human") decisions.set(row.refId, row);
  return decisions;
}

/**
 * Who acted, in words. BRANE is the only gate. The server's actor `pre-mask` (older rows: `gate`) is our own code:
 * the pre-mask (regex, no model) for a `masked` row, the intake step, which runs BRANE's local model, for an `intake`
 * row, and the handoff our code writes when BRANE refuses a request.
 */
export function actorLabel(row: AuditRow): string {
  switch (row.actor) {
    case "brane":
      return "BRANE";
    case "pre-mask":
    case "gate":
      return row.kind === "intake"
        ? "Intake (local model)"
        : row.kind === "handoff"
          ? "BRANE refusal"
          : "Pre-mask (regex)";
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

/** Comma-separated header values as a list, without blanks or repeats. */
export const list = (value: string): string[] => [
  ...new Set(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  ),
];

/** A `classify` row's detail is `<labels>:<route>`, the labels comma-separated. */
export function classifyOf(row: AuditRow): { readonly labels: string[]; readonly route: string } {
  const split = row.detail.lastIndexOf(":");
  return split < 0
    ? { labels: list(row.detail), route: "" }
    : { labels: list(row.detail.slice(0, split)), route: row.detail.slice(split + 1) };
}

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

/**
 * A handoff row's detail is `tool:value`, e.g. `consult:medical`, `request_approval:reduce` or, for a request BRANE
 * refused, `refusal:semantic:CLAIM_OUTCOME_DECISION->refuse`.
 */
export function handoffOf(row: AuditRow): Handoff {
  const split = row.detail.indexOf(":");
  const tool = split < 0 ? row.detail : row.detail.slice(0, split);
  const value = split < 0 ? "" : row.detail.slice(split + 1);
  return handoffFor(tool, value);
}

/**
 * The wording for a `consult` (value: the expert), `request_approval` (value: the recommendation) or `refusal`
 * (value: the BRANE rule) handoff.
 */
export function handoffFor(tool: string, value: string): Handoff {
  if (tool === "refusal") {
    return {
      tool,
      value,
      role: "Claims handler",
      sentence: `BRANE refused a request under ${ruleName(value)}, the claims handler decides`,
    };
  }
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

/** Passage ids as the corpus writes them, e.g. `POL-2.1` or `GDPR-22(1)`. */
const PASSAGE_ID = /\b[A-Z][A-Z0-9]*-\d[\w.]*(?:\(\d+\))*/g;

/** The distinct passage ids in a text, in order of first mention. */
export const passageIds = (text: string): string[] => [...new Set(text.match(PASSAGE_ID) ?? [])];

/** Every passage a lookup returned in this session, oldest first, without repeats. */
export function citedPassages(rows: readonly AuditRow[]): string[] {
  const lookups = rows.filter((row) => row.kind === "lookup").sort((a, b) => a.id - b.id);
  return [...new Set(lookups.flatMap((row) => list(row.detail)))];
}

export type ClaimStatus =
  | "new"
  | "in-progress"
  | "waiting"
  | "prepared"
  | "refused"
  | "approved"
  | "edited"
  | "rejected";

/**
 * Where a claim stands, from its session's decision log: nothing sent yet, a recommendation is with the claims
 * handler or decided, a question is with an expert, BRANE refused a request, or the assistant is still working.
 */
export function claimStatus(rows: readonly AuditRow[]): ClaimStatus {
  if (rows.length === 0) return "new";
  const open = openHandoffs(rows);
  if (open.some((row) => handoffOf(row).tool === "consult")) return "waiting";
  if (open.some((row) => handoffOf(row).tool === "refusal")) return "refused";
  if (open.length > 0) return "prepared";
  const settled = latestApprovalDecision(rows);
  const decision = settled === undefined ? undefined : decisionOf(settled);
  if (decision !== undefined && decision !== "answered") return decision;
  if (rows.some((row) => row.kind === "brane" && routeOf(row) === "refused")) return "refused";
  return "in-progress";
}

const isApproval = (row: AuditRow): boolean =>
  row.kind === "handoff" && handoffOf(row).tool === "request_approval";

/** The newest human row that answers a recommendation. */
function latestApprovalDecision(rows: readonly AuditRow[]): AuditRow | undefined {
  const approvals = new Set(rows.filter(isApproval).map((row) => row.id));
  return rows
    .filter((row) => row.kind === "human" && approvals.has(row.refId))
    .reduce<AuditRow | undefined>(
      (latest, row) => (latest === undefined || row.id > latest.id ? row : latest),
      undefined,
    );
}

/**
 * The handoffs that wait on a person, oldest first: every consult and refusal without an answer, and the newest recommendation
 * unless a person has decided on a recommendation since it was made. The agent may restate its recommendation; one
 * decision settles every earlier one.
 */
export function openHandoffs(rows: readonly AuditRow[]): AuditRow[] {
  const answered = new Set(rows.filter((row) => row.kind === "human").map((row) => row.refId));
  const consults = rows.filter(
    (row) => row.kind === "handoff" && !isApproval(row) && !answered.has(row.id),
  );
  const newest = rows
    .filter(isApproval)
    .reduce<AuditRow | undefined>(
      (latest, row) => (latest === undefined || row.id > latest.id ? row : latest),
      undefined,
    );
  const settledAt = latestApprovalDecision(rows)?.id ?? 0;
  const approval =
    newest !== undefined && newest.id > settledAt && !answered.has(newest.id) ? [newest] : [];
  return [...consults, ...approval].sort((a, b) => a.id - b.id);
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
