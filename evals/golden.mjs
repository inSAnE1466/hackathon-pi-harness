#!/usr/bin/env node
// Grade the live BRANE policy against the golden set (evals/golden/claims.jsonl).
// Each claim names its expected outcome (allow, protect, local, refuse) and every span that must not leave.
// A span leaks when the route is cloud and the span appears in the outgoing payload.
// Dry runs only (POST /policy/test): no model call, no cost. Never prints the key.
// Usage: node evals/golden.mjs [--json]
import { existsSync, readFileSync } from "node:fs";

const vars = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
const base = vars.BRANE_BASE_URL.replace(/\/+$/, "");
const set = process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? "claims";
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

async function dryRun(prompt) {
  const res = await fetch(`${base}/policy/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${vars.BRANE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, executeCompletion: false }),
  });
  if (!res.ok) throw new Error(`BRANE ${res.status}`);
  return res.json();
}

const results = [];
for (const c of claims) {
  const j = await dryRun(c.text);
  const route = j.decision.route;
  const payload = route === "cloud" ? j.outgoingCloudPayloadPreview : "";
  const leaked = c.spans.filter((s) => payload.includes(s.text));
  const ok = routeOk[c.expect](route) && leaked.length === 0;
  results.push({
    id: c.id,
    kind: c.kind,
    expect: c.expect,
    route,
    ok,
    leaked: leaked.map((s) => `${s.cat}:${s.text}`),
    detected: j.detectedCategories.map((d) => d.label),
    semantic: j.matchedSemanticCategories.map((s) => s.code),
  });
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(
      `${r.ok ? "PASS" : "FAIL"} ${r.id} ${r.kind.padEnd(11)} expect=${r.expect.padEnd(7)} route=${r.route.padEnd(7)}${r.leaked.length ? ` LEAKED ${r.leaked.join(", ")}` : ""}`,
    );
  }
  const spans = claims.flatMap((c) => c.spans.map((s) => ({ ...s, id: c.id })));
  const leakedSpans = results.flatMap((r) => r.leaked);
  const byCat = {};
  for (const s of spans) {
    byCat[s.cat] ??= { total: 0, leaked: 0 };
    byCat[s.cat].total++;
  }
  for (const l of leakedSpans) byCat[l.split(":")[0]].leaked++;
  console.log("\nleaks by category (spans leaked / spans planted):");
  for (const [cat, v] of Object.entries(byCat).sort())
    console.log(`  ${cat.padEnd(16)} ${v.leaked}/${v.total}`);
  const overBlocked = results.filter((r) => r.expect === "allow" && r.route !== "cloud").length;
  const controls = results.filter((r) => r.expect === "allow").length;
  console.log(
    `\nclaims passed ${results.filter((r) => r.ok).length}/${results.length} | spans leaked ${leakedSpans.length}/${spans.length} | controls over-blocked ${overBlocked}/${controls}`,
  );
}
process.exitCode = results.every((r) => r.ok) ? 0 : 1;
