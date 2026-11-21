import policy from "../policy/brane.json";
import type { BraneDecision } from "./brane.ts";
import { normalizeUsername } from "./identity.ts";
import type { Classification } from "./primitives/classify.ts";
import type { GateEvent } from "./primitives/gate.ts";
import { sha256 } from "./sha256.ts";

/**
 * The decision log: one row per decision, in the session Durable Object's own SQLite, beside Pi's tables. Kinds:
 * BRANE's routing decision for each model request, the events our own code writes around BRANE (identifiers the
 * pre-mask replaced, a handoff to a person, the passages a lookup cited, intake), a person's request, a person's
 * decision on a handoff, and a change of the harness switches.
 *
 * Every row names its actor (`brane`, `pre-mask`, `intake`, `classifier`, `gate`, `agent`, `operator`, or the
 * person's display name) and, for automated rows, the policy version that decided it. Rows form a hash chain. Each
 * stores the previous row's hash and the SHA-256 of that hash plus its own fields, so editing or deleting a row
 * breaks every later hash. It is served to the audit
 * view over HTTP and never written into a conversation, so no model reads it. Rows hold categories, ids and a
 * reviewer's own note, never prompt text.
 */
export type AuditRow = {
  readonly id: number;
  readonly at: string;
  readonly kind: "brane" | GateEvent["kind"] | "request" | "human" | "config" | "classify";
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
  /** The policy version that decided an automated row; empty for a person's row. */
  readonly policyVersion: string;
  /**
   * The row this one answers. For a `human` row it is the handoff. For the `request` row that carries a person's
   * decision back into the conversation, it is the `human` row.
   */
  readonly refId: number;
  /** The conversation a handoff was made in and its decision returns to; 0 when not recorded. */
  readonly conversationId: number;
  readonly prevHash: string;
  readonly hash: string;
};

/** A claims handler approves, rejects or edits a recommendation; an expert answers a consult. */
export type HumanDecision = "approved" | "rejected" | "edited" | "answered";

export type ChainCheck =
  | { readonly ok: true; readonly rows: number }
  | { readonly ok: false; readonly rows: number; readonly brokenAt: number };

export type RecordResult =
  | { readonly ok: true; readonly row: AuditRow }
  | { readonly ok: false; readonly status: 400 | 404 | 409; readonly error: string };

const POLICY_VERSION = String(policy.version);
const MAX_NOTE_CHARACTERS = 500;
const DECISIONS: readonly HumanDecision[] = ["approved", "rejected", "edited", "answered"];

const FIELDS = [
  ["at", "TEXT NOT NULL", ""],
  ["kind", "TEXT NOT NULL", ""],
  ["status", "INTEGER NOT NULL DEFAULT 0", 0],
  ["routed_to", "TEXT NOT NULL DEFAULT ''", ""],
  ["action", "TEXT NOT NULL DEFAULT ''", ""],
  ["redacted", "INTEGER NOT NULL DEFAULT 0", 0],
  ["pii_types", "TEXT NOT NULL DEFAULT ''", ""],
  ["semantic_matches", "TEXT NOT NULL DEFAULT ''", ""],
  ["local_cause", "TEXT NOT NULL DEFAULT ''", ""],
  ["refused_by", "TEXT NOT NULL DEFAULT ''", ""],
  ["model_resolved", "TEXT NOT NULL DEFAULT ''", ""],
  ["detail", "TEXT NOT NULL DEFAULT ''", ""],
  ["actor", "TEXT NOT NULL DEFAULT ''", ""],
  ["policy_version", "TEXT NOT NULL DEFAULT ''", ""],
  ["ref_id", "INTEGER NOT NULL DEFAULT 0", 0],
  ["conversation_id", "INTEGER NOT NULL DEFAULT 0", 0],
] as const;
type Field = (typeof FIELDS)[number][0];
type Values = Readonly<Partial<Record<Field, string | number>>>;
const NAMES = FIELDS.map(([name]) => name);

/** Columns added after the first deploy; existing tables gain them with their defaults. */
const ADDED = [
  "actor",
  "policy_version",
  "ref_id",
  "conversation_id",
  "prev_hash",
  "hash",
] as const;

/**
 * A row's hash covers the previous hash, then every recorded field in a fixed order. `conversation_id`, the last
 * field, is hashed only when set, so rows sealed before it existed still verify.
 */
const rowHash = (prevHash: string, values: readonly (string | number)[]): string =>
  sha256(`${prevHash}\n${JSON.stringify(values.at(-1) === 0 ? values.slice(0, -1) : values)}`);

export class AuditLog {
  readonly #sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.#sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      kind TEXT NOT NULL,
      status INTEGER NOT NULL DEFAULT 0,
      routed_to TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL DEFAULT '',
      redacted INTEGER NOT NULL DEFAULT 0,
      pii_types TEXT NOT NULL DEFAULT '',
      semantic_matches TEXT NOT NULL DEFAULT '',
      local_cause TEXT NOT NULL DEFAULT '',
      refused_by TEXT NOT NULL DEFAULT '',
      model_resolved TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT ''
    )`);
    const present = new Set(
      sql
        .exec(`PRAGMA table_info(audit_log)`)
        .toArray()
        .map((c) => String(c.name)),
    );
    for (const column of ADDED) {
      if (present.has(column)) continue;
      const type =
        column === "ref_id" || column === "conversation_id"
          ? "INTEGER NOT NULL DEFAULT 0"
          : "TEXT NOT NULL DEFAULT ''";
      sql.exec(`ALTER TABLE audit_log ADD COLUMN ${column} ${type}`);
    }
    this.#sealUnhashed();
  }

  /** Rows written before the chain existed are hashed in id order when the table is upgraded. */
  #sealUnhashed(): void {
    const unhashed = this.#sql
      .exec(`SELECT * FROM audit_log WHERE hash = '' ORDER BY id`)
      .toArray();
    for (const row of unhashed) {
      const prevHash = this.#lastHashBefore(Number(row.id));
      const values = NAMES.map((name) => row[name] as string | number);
      this.#sql.exec(
        `UPDATE audit_log SET prev_hash = ?, hash = ? WHERE id = ?`,
        prevHash,
        rowHash(prevHash, values),
        Number(row.id),
      );
    }
  }

  #lastHashBefore(id: number): string {
    const row = this.#sql
      .exec(`SELECT hash FROM audit_log WHERE id < ? ORDER BY id DESC LIMIT 1`, id)
      .toArray()[0];
    return row === undefined ? "" : String(row.hash);
  }

  #insert(values: Values): AuditRow {
    const row = NAMES.map((name) => values[name] ?? FIELDS.find(([n]) => n === name)![2]);
    row[0] = new Date().toISOString();
    const last = this.#sql.exec(`SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1`).toArray()[0];
    const prevHash = last === undefined ? "" : String(last.hash);
    const id = this.#sql
      .exec(
        `INSERT INTO audit_log (${NAMES.join(", ")}, prev_hash, hash)
         VALUES (${NAMES.map(() => "?").join(", ")}, ?, ?) RETURNING id`,
        ...row,
        prevHash,
        rowHash(prevHash, row),
      )
      .one().id;
    return this.#get(Number(id))!;
  }

  brane(d: BraneDecision): void {
    this.#insert({
      kind: "brane",
      status: d.status,
      routed_to: d.routedTo,
      action: d.action,
      redacted: d.redacted ? 1 : 0,
      pii_types: d.piiTypes,
      semantic_matches: d.semanticMatches,
      local_cause: d.localCause,
      refused_by: d.refusedBy,
      model_resolved: d.modelResolved,
      actor: "brane",
      policy_version: POLICY_VERSION,
    });
  }

  gate(e: GateEvent): void {
    const detail =
      e.kind === "masked"
        ? e.findings
        : e.kind === "handoff"
          ? `${e.tool}:${e.detail}`
          : e.kind === "intake"
            ? e.result
            : e.ids;
    // A refusal's handoff names the row that refused, BRANE's 422 or the classifier's verdict, and its rule.
    const refusal =
      e.kind === "handoff" && e.tool === "refusal"
        ? this.#sql
            .exec(
              `SELECT id, CASE kind WHEN 'brane' THEN refused_by ELSE 'classifier:' || detail END AS refused_by
               FROM audit_log
               WHERE (kind = 'brane' AND status = 422) OR (kind = 'classify' AND action = 'refuse')
               ORDER BY id DESC LIMIT 1`,
            )
            .toArray()[0]
        : undefined;
    // The agent chose to hand off or to cite passages. Our own code masked identifiers (the pre-mask in detect.ts),
    // split the claim at intake, or handed off a refusal; a refusal keeps the actor name `gate`.
    const actor =
      (e.kind === "handoff" && e.tool !== "refusal") || e.kind === "lookup" || e.kind === "cited"
        ? "agent"
        : e.kind === "masked"
          ? "pre-mask"
          : e.kind === "intake"
            ? "intake"
            : "gate";
    // A `cited` row names the recommendation it belongs to, which is the handoff written just before it.
    const handoff =
      e.kind === "cited"
        ? this.#sql
            .exec(`SELECT id FROM audit_log WHERE kind = 'handoff' ORDER BY id DESC LIMIT 1`)
            .toArray()[0]
        : undefined;
    this.#insert({
      kind: e.kind,
      detail: refusal === undefined ? detail : `refusal:${String(refusal.refused_by)}`,
      ...(refusal === undefined ? {} : { ref_id: Number(refusal.id) }),
      ...(handoff === undefined ? {} : { ref_id: Number(handoff.id) }),
      actor,
      policy_version: POLICY_VERSION,
      ...(e.kind === "handoff" ? { conversation_id: e.conversationId } : {}),
    });
  }

  /**
   * A person sent a request. Records who and in which conversation, never the text. `answers` is the `human` row
   * when the request carries that person's decision back to the agent.
   */
  request(username: string, conversationId: number, answers = 0): AuditRow {
    return this.#insert({
      kind: "request",
      actor: username,
      detail: `conversation:${conversationId}`,
      ref_id: answers,
      conversation_id: conversationId,
    });
  }

  /**
   * The second classifier's verdict on a person's text: `action` is the route it asks for, `detail` the labels it
   * found, `routed_to` and `model_resolved` where BRANE ran the classifier itself, `local_cause` why it fell back.
   */
  classify(c: Classification, conversationId: number): void {
    this.#insert({
      kind: "classify",
      action: c.route,
      detail: c.labels.join(","),
      routed_to: c.ranOn === "" ? "withheld" : "local",
      model_resolved: c.ranOn,
      local_cause: c.failure,
      actor: "classifier",
      policy_version: c.version,
      conversation_id: conversationId,
    });
  }

  /** The harness switches were set for this session; `detail` is the full resolved set as JSON. */
  config(detail: string): void {
    this.#insert({ kind: "config", actor: "operator", detail, policy_version: POLICY_VERSION });
  }

  /**
   * A person's decision on a handoff. One decision per handoff; the first one recorded is final. A recommendation
   * (`request_approval`) is approved, rejected or edited; a consult is answered, and the note is the answer.
   */
  human(input: {
    readonly handoffId: unknown;
    readonly decision: unknown;
    readonly note?: unknown;
    readonly reviewer: unknown;
  }): RecordResult {
    const handoffId = Number(input.handoffId);
    const reviewer = normalizeUsername(typeof input.reviewer === "string" ? input.reviewer : "");
    const note = typeof input.note === "string" ? input.note.trim() : "";
    if (!Number.isInteger(handoffId) || handoffId <= 0)
      return { ok: false, status: 400, error: "handoffId must be a row id" };
    if (!DECISIONS.includes(input.decision as HumanDecision))
      return {
        ok: false,
        status: 400,
        error: "decision must be approved, rejected, edited or answered",
      };
    if (reviewer === "") return { ok: false, status: 400, error: "reviewer name required" };
    if (note.length > MAX_NOTE_CHARACTERS)
      return {
        ok: false,
        status: 400,
        error: `note longer than ${MAX_NOTE_CHARACTERS} characters`,
      };
    const handoff = this.#get(handoffId);
    if (handoff === undefined || handoff.kind !== "handoff")
      return { ok: false, status: 404, error: "no handoff with that id" };
    const consult = handoffTool(handoff) === "consult";
    if (consult !== (input.decision === "answered"))
      return {
        ok: false,
        status: 400,
        error: consult
          ? "a consult takes the decision answered"
          : "a recommendation takes approved, rejected or edited",
      };
    if (consult && note === "")
      return { ok: false, status: 400, error: "an answer needs a note: the note is the answer" };
    const existing = this.#sql
      .exec(`SELECT id FROM audit_log WHERE kind = 'human' AND ref_id = ? LIMIT 1`, handoffId)
      .toArray()[0];
    if (existing !== undefined)
      return { ok: false, status: 409, error: "this handoff already has a decision" };
    const row = this.#insert({
      kind: "human",
      action: input.decision as HumanDecision,
      detail: note,
      actor: reviewer,
      ref_id: handoffId,
      conversation_id: handoff.conversationId,
    });
    return { ok: true, row };
  }

  /** Recomputes every hash in id order; the first row whose link or hash does not match breaks the chain. */
  verify(): ChainCheck {
    const rows = this.#sql.exec(`SELECT * FROM audit_log ORDER BY id`).toArray();
    let prevHash = "";
    for (const row of rows) {
      const values = NAMES.map((name) => row[name] as string | number);
      if (String(row.prev_hash) !== prevHash || String(row.hash) !== rowHash(prevHash, values))
        return { ok: false, rows: rows.length, brokenAt: Number(row.id) };
      prevHash = String(row.hash);
    }
    return { ok: true, rows: rows.length };
  }

  get(id: number): AuditRow | undefined {
    return this.#get(id);
  }

  #get(id: number): AuditRow | undefined {
    const row = this.#sql.exec(`SELECT * FROM audit_log WHERE id = ?`, id).toArray()[0];
    return row === undefined ? undefined : toRow(row);
  }

  list(limit = 500): AuditRow[] {
    return this.#sql
      .exec(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, limit)
      .toArray()
      .map(toRow);
  }

  /** The whole trail oldest first, one line per row, for the regulator or the test protocol. */
  csv(): string {
    const rows = this.#sql.exec(`SELECT * FROM audit_log ORDER BY id`).toArray().map(toRow);
    return [
      CSV_COLUMNS.join(","),
      ...rows.map((row) => CSV_COLUMNS.map((column) => csvCell(row[column])).join(",")),
    ].join("\n");
  }
}

/** Which tool made a handoff row: `consult` or `request_approval`. */
export const handoffTool = (handoff: AuditRow): string => handoff.detail.split(":", 1)[0] ?? "";

export const CSV_COLUMNS = [
  "id",
  "at",
  "kind",
  "actor",
  "policyVersion",
  "refId",
  "conversationId",
  "status",
  "routedTo",
  "action",
  "redacted",
  "piiTypes",
  "semanticMatches",
  "localCause",
  "refusedBy",
  "modelResolved",
  "detail",
  "prevHash",
  "hash",
] as const satisfies readonly (keyof AuditRow)[];

const csvCell = (value: string | number | boolean): string => {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const toRow = (r: Record<string, SqlStorageValue>): AuditRow => ({
  id: Number(r.id),
  at: String(r.at),
  kind: String(r.kind) as AuditRow["kind"],
  status: Number(r.status),
  routedTo: String(r.routed_to),
  action: String(r.action),
  redacted: Number(r.redacted) === 1,
  piiTypes: String(r.pii_types),
  semanticMatches: String(r.semantic_matches),
  localCause: String(r.local_cause),
  refusedBy: String(r.refused_by),
  modelResolved: String(r.model_resolved),
  detail: String(r.detail),
  actor: String(r.actor ?? ""),
  policyVersion: String(r.policy_version ?? ""),
  refId: Number(r.ref_id ?? 0),
  conversationId: Number(r.conversation_id ?? 0),
  prevHash: String(r.prev_hash ?? ""),
  hash: String(r.hash ?? ""),
});
