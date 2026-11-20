import type { BraneDecision } from "./brane.ts";

/**
 * The decision log: one row per BRANE decision, in the session Durable Object's own SQLite, beside Pi's tables.
 * It is served to the audit view over HTTP and never written into a conversation, so no model reads it.
 * Rows hold BRANE's categories and routing, never the prompt text.
 */
export type AuditRow = BraneDecision & { readonly id: number; readonly at: string };

export class AuditLog {
  readonly #sql: SqlStorage;

  constructor(sql: SqlStorage) {
    this.#sql = sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS audit_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      status INTEGER NOT NULL,
      routed_to TEXT NOT NULL,
      action TEXT NOT NULL,
      redacted INTEGER NOT NULL,
      pii_types TEXT NOT NULL,
      semantic_matches TEXT NOT NULL,
      local_cause TEXT NOT NULL,
      refused_by TEXT NOT NULL,
      model_resolved TEXT NOT NULL
    )`);
  }

  record(d: BraneDecision): void {
    this.#sql.exec(
      `INSERT INTO audit_decisions (at, status, routed_to, action, redacted, pii_types, semantic_matches, local_cause, refused_by, model_resolved)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      new Date().toISOString(),
      d.status,
      d.routedTo,
      d.action,
      d.redacted ? 1 : 0,
      d.piiTypes,
      d.semanticMatches,
      d.localCause,
      d.refusedBy,
      d.modelResolved,
    );
  }

  list(limit = 200): AuditRow[] {
    return this.#sql
      .exec(`SELECT * FROM audit_decisions ORDER BY id DESC LIMIT ?`, limit)
      .toArray()
      .map((r) => ({
        id: Number(r.id),
        at: String(r.at),
        status: Number(r.status),
        routedTo: String(r.routed_to),
        action: String(r.action),
        redacted: Number(r.redacted) === 1,
        piiTypes: String(r.pii_types),
        semanticMatches: String(r.semantic_matches),
        localCause: String(r.local_cause),
        refusedBy: String(r.refused_by),
        modelResolved: String(r.model_resolved),
      }));
  }
}
