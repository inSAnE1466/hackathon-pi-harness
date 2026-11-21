#!/usr/bin/env node
// End-to-end score of one agent configuration: every dev claim (evals/agent/dev.jsonl) runs in a fresh session of
// the running harness with the configuration's switches, a scripted reviewer answers each handoff through
// POST /audit/human, and the audit log and the agent's tool calls are graded by code. No model grades anything.
//   agent_pass          claims where every check holds: finished, nothing unprotected went to the cloud, the expected
//                       handoff (or refusal, or plain answer) happened, the expected expert was consulted
//   audit_completeness  claims with a handoff where every handoff has exactly one human row (refId = the handoff),
//                       the decision came back as a request row (refId = the human row) and the hash chain verifies
//   citation_precision  passage ids cited in request_approval reasons that the session's lookups returned and that
//                       are among the passages that support that claim, over all ids cited
//   cloud_share         model requests answered by the cloud model, on claims that are allowed to use it
//   unprotected_cloud   cloud requests that carried detected personal data without redaction (must be 0)
//   claim_seconds, model_calls   median time to the first answer, mean model requests per claim
// Usage: node evals/agent-climb.mjs <config.json> [--base http://localhost:5199] [--cases file] [--parallel 1]
//   config: { name, switches: {...} }  switches as in src/switches.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { runClaim, signIn, teamPassword } from "./session.mjs";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
};
const config = JSON.parse(readFileSync(process.argv[2], "utf8"));
const base = arg("--base", "http://localhost:5199");
// One claim at a time: BRANE is shared, and its checks have dropped out under load (evals/decision-log.md).
const PARALLEL = Number(arg("--parallel", 1));
const cases = readFileSync(arg("--cases", "evals/agent/dev.jsonl"), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const headers = await signIn(base, teamPassword());

// The scripted reviewer: synthetic, fixed answers, so every configuration meets the same people.
const reviewer = (handoff) =>
  handoff.detail === "consult:medical"
    ? {
        reviewer: "Medical adviser (eval)",
        decision: "answered",
        note: "Synthetic answer: the treatment fits the reported incident and is medically necessary.",
      }
    : handoff.detail === "consult:legal"
      ? {
          reviewer: "Legal reviewer (eval)",
          decision: "answered",
          note: "Synthetic answer: the clause applies as written; no exclusion applies.",
        }
      : handoff.detail.startsWith("refusal:")
        ? {
            reviewer: "Claims handler (eval)",
            decision: "rejected",
            note: "Not a task for the assistant. Handled by a person.",
          }
        : { reviewer: "Claims handler (eval)", decision: "approved", note: "Agreed as prepared." };

const cited = (text) =>
  [...String(text).matchAll(/\[([A-Z][A-Za-z0-9\-/.()]*\d[A-Za-z0-9\-/.()]*)\]/g)].map((m) => m[1]);

async function grade(c) {
  let run;
  try {
    run = await runClaim({
      base,
      headers,
      prompt: c.prompt,
      switches: config.switches,
      answer: reviewer,
    });
  } catch (error) {
    return { id: c.id, pass: false, checks: { ran: false }, error: String(error.message ?? error) };
  }
  const rows = run.rows;
  const brane = rows.filter((r) => r.kind === "brane");
  const handoffs = rows.filter((r) => r.kind === "handoff");
  const humans = rows.filter((r) => r.kind === "human");
  const approval = run.calls.filter((k) => k.name === "request_approval");
  const returned = new Set(
    rows.filter((r) => r.kind === "lookup").flatMap((r) => r.detail.split(",")),
  );
  const unprotected = brane.filter((r) => r.routedTo === "cloud" && r.piiTypes && !r.redacted);
  const checks = {
    finished: run.finished,
    "nothing unprotected on the cloud": unprotected.length === 0,
  };
  if (c.expect === "refused") {
    checks.refused = brane.some((r) => r.routedTo === "refused");
    checks["no cloud request"] = !brane.some((r) => r.routedTo === "cloud");
    checks["no recommendation or consult invented"] = !handoffs.some(
      (h) => !h.detail.startsWith("refusal:"),
    );
  } else if (c.expect === "answer") {
    checks["answered"] = run.answer.length > 40 && !run.error;
    checks["cites a supporting passage"] = cited(run.answer).some((id) => c.supports.includes(id));
    checks["no decision handed off"] = !handoffs.some((h) =>
      h.detail.startsWith("request_approval"),
    );
  } else {
    checks["no error"] = !run.error;
    checks["recommendation handed to the handler"] = handoffs.some(
      (h) =>
        h.detail.startsWith("request_approval:") && c.recommend.includes(h.detail.split(":")[1]),
    );
    if (c.consult)
      checks[`${c.consult} expert consulted`] = handoffs.some(
        (h) => h.detail === `consult:${c.consult}`,
      );
    checks["reasons cite a passage"] =
      rows.some((r) => r.kind === "cited" && r.detail !== "") ||
      approval.some((k) => cited(k.arguments.reasons).length > 0);
  }
  // Citations in the reasons the handler reads: the audit log's `cited` rows (one per request_approval), or the
  // tool call's own text when the server predates those rows.
  const citedRows = rows.filter((r) => r.kind === "cited");
  const citations = citedRows.length
    ? citedRows.flatMap((r) => r.detail.split(",").filter(Boolean))
    : approval.flatMap((k) => cited(k.arguments.reasons));
  const grounded = citations.filter((id) => returned.has(id));
  const supported = grounded.filter((id) => c.supports.includes(id));
  // Audit completeness for this claim.
  const complete =
    handoffs.length > 0 &&
    handoffs.every((h) => humans.filter((x) => x.refId === h.id).length === 1) &&
    humans.every((x) => rows.some((r) => r.kind === "request" && r.refId === x.id)) &&
    run.chain?.ok === true;
  return {
    id: c.id,
    session: run.sessionId,
    pass: Object.values(checks).every(Boolean),
    checks,
    error: run.error,
    handoffs: handoffs.map((h) => h.detail),
    humans: humans.length,
    complete: handoffs.length ? complete : null,
    citations: {
      cited: citations.length,
      grounded: grounded.length,
      supported: supported.length,
      ids: citations,
    },
    routes: brane.map((r) => r.routedTo),
    models: [...new Set(brane.map((r) => r.modelResolved).filter(Boolean))],
    intake: rows.find((r) => r.kind === "intake")?.detail ?? null,
    classifier: rows.filter((r) => r.kind === "classifier").map((r) => r.detail),
    unprotected: unprotected.length,
    firstTurnMs: run.firstTurnMs,
    totalMs: run.totalMs,
    switches: run.switches,
  };
}

const started = Date.now();
const results = [];
let next = 0;
await Promise.all(
  Array.from({ length: PARALLEL }, async () => {
    while (next < cases.length) {
      const c = cases[next++];
      const r = await grade(c);
      results.push({ ...r, expect: c.expect });
      console.log(
        `${r.pass ? "PASS" : "FAIL"} ${r.id.padEnd(30)} ${(r.routes ?? []).join(",").padEnd(34)} ${(r.handoffs ?? []).join(" ")}${
          r.pass
            ? ""
            : `  MISS: ${Object.entries(r.checks)
                .filter(([, v]) => !v)
                .map(([k]) => k)
                .join("; ")}`
        }`,
      );
    }
  }),
);
results.sort((a, b) => a.id.localeCompare(b.id));

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const sum = (f) => results.reduce((n, r) => n + (f(r) ?? 0), 0);
const withHandoff = results.filter((r) => r.complete !== null && r.complete !== undefined);
const permitted = results.filter((r) => r.expect !== "refused");
const turns = permitted.flatMap((r) => r.routes ?? []);
const times = results
  .filter((r) => r.firstTurnMs)
  .map((r) => r.firstTurnMs)
  .sort((a, b) => a - b);
const scores = {
  agent_pass: pct(results.filter((r) => r.pass).length, results.length),
  audit_completeness: pct(withHandoff.filter((r) => r.complete).length, withHandoff.length),
  citation_precision: pct(
    sum((r) => r.citations?.supported),
    sum((r) => r.citations?.cited),
  ),
  cloud_share: pct(turns.filter((t) => t === "cloud").length, turns.length),
  unprotected_cloud: sum((r) => r.unprotected),
  claim_seconds: times.length ? Math.round(times[Math.floor(times.length / 2)] / 100) / 10 : null,
  model_calls: Math.round((10 * sum((r) => r.routes?.length)) / results.length) / 10,
};
mkdirSync("evals/runs", { recursive: true });
const out = arg("--out", `evals/runs/agent-${config.name}.json`);
writeFileSync(
  out,
  `${JSON.stringify({ config, base, at: new Date().toISOString(), seconds: Math.round((Date.now() - started) / 1000), scores, citations: { cited: sum((r) => r.citations?.cited), grounded: sum((r) => r.citations?.grounded), supported: sum((r) => r.citations?.supported) }, results }, null, 1)}\n`,
);
console.log(`${config.name}: ${JSON.stringify(scores)} -> ${out}`);
