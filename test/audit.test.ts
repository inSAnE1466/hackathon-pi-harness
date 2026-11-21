import { runInDurableObject } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import policy from "../policy/brane.json";
import { AuditLog, CSV_COLUMNS } from "../src/audit.ts";
import type { BraneDecision } from "../src/brane.ts";

const base = "https://example.com/api/sessions";

const refusal: BraneDecision = {
  status: 422,
  routedTo: "refused",
  action: "refuse",
  redacted: false,
  piiTypes: "PERSON",
  semanticMatches: "CLAIM_OUTCOME_DECISION",
  localCause: "",
  refusedBy: "semantic:CLAIM_OUTCOME_DECISION->refuse",
  modelResolved: "",
};

/** Writes rows into a session's own audit table, the way the session does, and returns their ids. */
async function seed(sessionId: string): Promise<{ handoffId: number }> {
  const stub = env.SESSIONS.getByName(sessionId);
  return runInDurableObject(stub, (_instance, state) => {
    const log = new AuditLog(state.storage.sql);
    log.request("Alice", "1");
    log.brane(refusal);
    log.gate({ kind: "handoff", tool: "request_approval", detail: "reject" });
    const handoff = log.list().find((row) => row.kind === "handoff")!;
    return { handoffId: handoff.id };
  });
}

const postDecision = (sessionId: string, body: unknown): Promise<Response> =>
  exports.default.fetch(`${base}/${sessionId}/audit/human`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("audit trail", () => {
  it("records who acted and which policy version decided", async () => {
    await seed("audit-actors");
    const response = await exports.default.fetch(`${base}/audit-actors/audit`);
    const body = (await response.json()) as {
      decisions: { kind: string; actor: string; policyVersion: string }[];
    };
    const byKind = Object.fromEntries(body.decisions.map((row) => [row.kind, row]));
    expect(byKind.request).toMatchObject({ actor: "Alice", policyVersion: "" });
    expect(byKind.brane).toMatchObject({ actor: "brane", policyVersion: policy.version });
    expect(byKind.handoff).toMatchObject({ actor: "agent", policyVersion: policy.version });
  });

  it("stores a person's decision on a handoff with the reviewer as actor, once", async () => {
    const { handoffId } = await seed("audit-human");
    const created = await postDecision("audit-human", {
      handoffId,
      decision: "edited",
      note: "pay 6 of 9 sessions",
      reviewer: "Lisa",
    });
    expect(created.status).toBe(201);

    const read = await exports.default.fetch(`${base}/audit-human/audit`);
    const body = (await read.json()) as {
      decisions: { kind: string; actor: string; action: string; detail: string; refId: number }[];
      chain: { ok: boolean };
    };
    expect(body.decisions[0]).toMatchObject({
      kind: "human",
      actor: "Lisa",
      action: "edited",
      detail: "pay 6 of 9 sessions",
      refId: handoffId,
    });
    expect(body.chain.ok).toBe(true);

    const again = await postDecision("audit-human", {
      handoffId,
      decision: "approved",
      reviewer: "Bob",
    });
    expect(again.status).toBe(409);
  });

  it("rejects a decision without a reviewer, on a row that is not a handoff, or by GET", async () => {
    const { handoffId } = await seed("audit-invalid");
    expect(
      (await postDecision("audit-invalid", { handoffId, decision: "approved", reviewer: "" }))
        .status,
    ).toBe(400);
    expect(
      (
        await postDecision("audit-invalid", {
          handoffId: 1,
          decision: "approved",
          reviewer: "Lisa",
        })
      ).status,
    ).toBe(404);
    expect((await exports.default.fetch(`${base}/audit-invalid/audit/human`)).status).toBe(405);
  });

  it("verifies the hash chain and detects a changed or deleted row", async () => {
    await seed("audit-chain");
    const stub = env.SESSIONS.getByName("audit-chain");
    const checks = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      const log = new AuditLog(sql);
      const intact = log.verify();
      sql.exec(`UPDATE audit_log SET actor = 'Mallory' WHERE kind = 'request'`);
      const edited = log.verify();
      sql.exec(`UPDATE audit_log SET actor = 'Alice' WHERE kind = 'request'`);
      const restored = log.verify();
      sql.exec(`DELETE FROM audit_log WHERE kind = 'brane'`);
      const deleted = log.verify();
      return { intact, edited, restored, deleted };
    });
    expect(checks.intact).toEqual({ ok: true, rows: 3 });
    expect(checks.edited).toMatchObject({ ok: false, brokenAt: 1 });
    expect(checks.restored.ok).toBe(true);
    expect(checks.deleted).toMatchObject({ ok: false, brokenAt: 3 });

    const verify = await exports.default.fetch(`${base}/audit-chain/audit/verify`);
    expect(((await verify.json()) as { chain: { ok: boolean } }).chain.ok).toBe(false);
  });

  it("upgrades a table from before the chain and seals its rows", async () => {
    const stub = env.SESSIONS.getByName("audit-upgrade");
    const check = await runInDurableObject(stub, (_instance, state) => {
      const sql = state.storage.sql;
      sql.exec(`DROP TABLE IF EXISTS audit_log`);
      sql.exec(`CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, kind TEXT NOT NULL,
        status INTEGER NOT NULL DEFAULT 0, routed_to TEXT NOT NULL DEFAULT '', action TEXT NOT NULL DEFAULT '',
        redacted INTEGER NOT NULL DEFAULT 0, pii_types TEXT NOT NULL DEFAULT '',
        semantic_matches TEXT NOT NULL DEFAULT '', local_cause TEXT NOT NULL DEFAULT '',
        refused_by TEXT NOT NULL DEFAULT '', model_resolved TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT ''
      )`);
      sql.exec(
        `INSERT INTO audit_log (at, kind, detail) VALUES ('2026-11-20T10:00:00Z', 'masked', 'BSN')`,
      );
      const log = new AuditLog(sql);
      log.brane(refusal);
      return log.verify();
    });
    expect(check).toEqual({ ok: true, rows: 2 });
  });

  it("exports the whole trail as CSV, oldest first, with actor and hashes", async () => {
    await seed("audit-csv");
    const response = await exports.default.fetch(`${base}/audit-csv/audit?format=csv`);
    expect(response.headers.get("Content-Type")).toContain("text/csv");
    const lines = (await response.text()).split("\n");
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
    expect(lines[0]).toContain("actor");
    expect(lines[0]).toContain("hash");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("request");
    expect(lines[1]).toContain("Alice");
  });
});
