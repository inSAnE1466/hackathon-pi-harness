#!/usr/bin/env node
// Grade the live BRANE policy against the golden set (evals/golden/claims.jsonl).
// Each claim names its expected outcome (allow, protect, local, refuse) and every span that must not leave.
// A span leaks when the route is cloud and the span appears in the outgoing payload.
// BRANE's semantic categories vary run to run under load, so --runs N grades every claim N times and counts it as
// PASS only if all N runs pass (worst of N). A request that still fails after retries counts as FAIL, never as pass.
// Dry runs only (POST /policy/test): no model call, no cost. Never prints the key.
// --cache keeps each dry-run answer in /tmp/brane-dryrun-cache, keyed by a hash of the policy content (what
// brane-policy.mjs applies), the prompt and the run index, so rerunning an unchanged policy on unchanged cases costs
// nothing and the N runs stay N distinct samples. A changed policy never reads another policy's answers. It assumes
// the live department matches policy/brane.json (check with brane-policy.mjs diff); errors are never cached.
// Usage: node evals/golden.mjs [--set=claims|heldout|mutated] [--harness] [--runs N] [--cache] [--json]
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { findIdentifiers, mask } from "../src/primitives/detect.ts";

const vars = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
const base = vars.BRANE_BASE_URL.replace(/\/+$/, "");
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};
const started = Date.now();
const set = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? "claims";
const runs = Math.max(1, Number(arg("--runs") ?? 1));
// --harness grades what the agent actually sends: the gate masks identifiers before BRANE sees the text.
const harness = process.argv.includes("--harness");
const claims = readFileSync(`evals/golden/${set}.jsonl`, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

// What each expectation accepts. "protect" passes when nothing planted leaves, whatever the route.
const routeOk = {
  allow: (r) => r === "cloud",
  protect: (r) => r === "cloud" || r === "local",
  local: (r) => r === "local" || r === "refused",
  refuse: (r) => r === "refused",
};

const cacheDir = process.argv.includes("--cache")
  ? (() => {
      const p = JSON.parse(readFileSync("policy/brane.json", "utf8"));
      const live = [p.routingMode, p.piiSensitivity, p.categories, p.semanticCategories];
      const dir = `/tmp/brane-dryrun-cache/${createHash("sha256").update(JSON.stringify(live)).digest("hex").slice(0, 16)}`;
      mkdirSync(dir, { recursive: true });
      return dir;
    })()
  : undefined;
let cacheHits = 0;
async function cachedDryRun(prompt, run) {
  if (!cacheDir) return dryRun(prompt);
  const file = `${cacheDir}/${createHash("sha256").update(`${run}\n${prompt}`).digest("hex")}.json`;
  if (existsSync(file)) {
    cacheHits++;
    return JSON.parse(readFileSync(file, "utf8"));
  }
  const j = await dryRun(prompt);
  writeFileSync(file, JSON.stringify(j));
  return j;
}

// One dry run: 20 s per attempt, up to 2 retries on a 5xx, a timeout or a network error. Anything else throws.
const TIMEOUT_MS = 20_000;
const RETRIES = 2;
let retried = 0;
async function dryRun(prompt) {
  let last;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) retried++;
    try {
      const res = await fetch(`${base}/policy/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vars.BRANE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prompt, executeCompletion: false }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return await res.json();
      last = new Error(`BRANE ${res.status}`);
      if (res.status < 500) throw Object.assign(last, { final: true });
    } catch (error) {
      if (error.final) throw error;
      last = error.name === "TimeoutError" ? new Error(`timeout ${TIMEOUT_MS} ms`) : error;
    }
  }
  throw last;
}

async function gradeOnce(c, run) {
  const findings = harness ? findIdentifiers(c.text) : [];
  let j;
  try {
    j = await cachedDryRun(harness ? mask(c.text, findings) : c.text, run);
  } catch (error) {
    return { ok: false, route: "error", leaked: [], error: String(error.message ?? error) };
  }
  const masksNationalId = findings.some((f) => f.kind === "BSN" || f.kind === "PASSPORT");
  const route = masksNationalId && j.decision.route === "cloud" ? "local" : j.decision.route;
  const payload = j.decision.route === "cloud" ? (j.outgoingCloudPayloadPreview ?? "") : "";
  const leaked = c.spans
    .filter((s) => payload.includes(s.text) && !findings.some((f) => f.text === s.text))
    .map((s) => `${s.cat}:${s.text}`);
  return {
    ok: routeOk[c.expect](route) && leaked.length === 0,
    route,
    leaked,
    semantic: j.matchedSemanticCategories.map((s) => s.code),
  };
}

// Sixteen requests in flight across all claims and runs: a dry run takes a fixed ~5 s on BRANE's side and does
// not slow down with parallel calls, so a 150-claim run takes about 50 s.
const CONCURRENCY = 16;
const jobs = claims.flatMap((c, ci) => Array.from({ length: runs }, (_, run) => [ci, run]));
const perClaim = claims.map(() => []);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const [ci, run] = jobs[next++];
      perClaim[ci].push(await gradeOnce(claims[ci], run));
    }
  }),
);

const results = claims.map((c, i) => {
  const rs = perClaim[i];
  const routes = rs.map((r) => r.route);
  return {
    id: c.id,
    kind: c.kind,
    expect: c.expect,
    ok: rs.every((r) => r.ok),
    fails: rs.filter((r) => !r.ok).length,
    errors: rs.filter((r) => r.error).length,
    routes,
    flaky: new Set(routes).size > 1,
    // Worst of N: a span counts as leaked if any run leaked it.
    leaked: [...new Set(rs.flatMap((r) => r.leaked))],
    semantic: [...new Set(rs.flatMap((r) => r.semantic ?? []))],
    errorMessages: [...new Set(rs.flatMap((r) => (r.error ? [r.error] : [])))],
  };
});

const spans = claims.flatMap((c) => c.spans);
const leakedSpans = results.flatMap((r) => r.leaked);
const controls = results.filter((r) => r.expect === "allow");
const summary = {
  set,
  harness,
  runs,
  passed: [results.filter((r) => r.ok).length, results.length],
  leaked: [leakedSpans.length, spans.length],
  overBlocked: [
    controls.filter((r) => r.routes.some((x) => x !== "cloud")).length,
    controls.length,
  ],
  errors: [results.reduce((n, r) => n + r.errors, 0), jobs.length],
  retried,
  cacheHits,
  seconds: Math.round((Date.now() - started) / 1000),
  flaky: results.filter((r) => r.flaky).map((r) => r.id),
};

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ summary, claims: results }, null, 2));
} else {
  for (const r of results) {
    const flake = runs > 1 && r.fails ? ` fails=${r.fails}/${runs}` : "";
    const route = runs > 1 ? r.routes.join(",") : r.routes[0];
    console.log(
      `${r.ok ? "PASS" : "FAIL"} ${r.id} ${r.kind.padEnd(11)} expect=${r.expect.padEnd(7)} route=${route.padEnd(7)}${flake}${r.leaked.length ? ` LEAKED ${r.leaked.join(", ")}` : ""}${r.errorMessages.length ? ` ERROR ${r.errorMessages.join("; ")}` : ""}`,
    );
  }
  const byCat = {};
  for (const s of spans) {
    byCat[s.cat] ??= { total: 0, leaked: 0 };
    byCat[s.cat].total++;
  }
  for (const l of leakedSpans) byCat[l.split(":")[0]].leaked++;
  console.log(`\nleaks by category (spans leaked in any of ${runs} run(s) / spans planted):`);
  for (const [cat, v] of Object.entries(byCat).sort())
    console.log(`  ${cat.padEnd(16)} ${v.leaked}/${v.total}`);
  console.log(`flaky (route differed across runs): ${summary.flaky.join(", ") || "none"}`);
  console.log(
    `\nclaims passed ${summary.passed.join("/")} | spans leaked ${summary.leaked.join("/")} | controls over-blocked ${summary.overBlocked.join("/")} | errors ${summary.errors.join("/")} | runs ${runs} | ${summary.seconds} s${cacheDir ? ` | cache hits ${cacheHits}` : ""}`,
  );
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
