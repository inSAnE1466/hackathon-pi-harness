import type { BraneDecision } from "./brane.ts";
import type { GateEvent } from "./primitives/gate.ts";

/**
 * The decision log: one row per decision, in the session Durable Object's own SQLite, beside Pi's tables. Two kinds:
 * BRANE's routing decision for each model request, and the gate's own events (identifiers masked, a handoff to a
 * person, the passages a lookup cited). It is served to the audit view over HTTP and never written into a
 * conversation, so no model reads it. Rows hold categories and ids, never prompt text.
 */
export type AuditRow = {
  readonly id: number;
  readonly at: string;
  readonly kind: "brane" | GateEvent["kind"];
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
};

const COLUMNS = `kind, status, routed_to, action, redacted, pii_types, semantic_matches, local_cause, refused_by, model_resolved, detail`;

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
  }

  #insert(values: readonly (string | number)[]): void {
    this.#sql.exec(
      `INSERT INTO audit_log (at, ${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      new Date().toISOString(),
      ...values,
    );
  }

  brane(d: BraneDecision): void {
    this.#insert([
      "brane",
      d.status,
      d.routedTo,
      d.action,
      d.redacted ? 1 : 0,
      d.piiTypes,
      d.semanticMatches,
      d.localCause,
      d.refusedBy,
      d.modelResolved,
      "",
    ]);
  }

  gate(e: GateEvent): void {
    const detail =
      e.kind === "masked" ? e.findings : e.kind === "handoff" ? `${e.tool}:${e.detail}` : e.ids;
    this.#insert([e.kind, 0, "", "", 0, "", "", "", "", "", detail]);
  }

  list(limit = 500): AuditRow[] {
    return this.#sql
      .exec(`SELECT * FROM audit_log ORDER BY id DESC LIMIT ?`, limit)
      .toArray()
      .map((r) => ({
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
      }));
  }
}
