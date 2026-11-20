#!/usr/bin/env node
// QC gate: run every suite and compare with the accepted baseline (evals/baseline.json). Any regression fails.
// Use it after every change to the policy, a prompt, a primitive or the corpus; keep the change only on PASS.
// Golden and held-out sets run three times, the mutated set twice; each number is the worst of those runs
// (evals/suites.mjs), because BRANE's semantic categories vary run to run. Writes evals/qc-latest.json.
//   node evals/qc.mjs              # BRANE suites only (dry runs, no model cost, about 2 to 4 minutes)
//   node evals/qc.mjs --cache      # reuse cached dry runs of this exact policy (evals/golden.mjs --cache)
//   node evals/qc.mjs --agent URL  # also the end-to-end agent eval against a running harness
//   node evals/qc.mjs --accept     # record the new numbers as the baseline; refused if any span leaks that the
//                                  # baseline did not, or the organizers' tests fail
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { compare, scoreSuites } from "./suites.mjs";

const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
const agentUrl = process.argv.includes("--agent")
  ? process.argv[process.argv.indexOf("--agent") + 1]
  : undefined;
const policy = JSON.parse(readFileSync("policy/brane.json", "utf8")).version;
console.log(`QC on policy ${policy}`);

const cache = process.argv.includes("--cache");
const { results, details, seconds } = await scoreSuites({
  deadline: started + 1_500_000,
  agentUrl,
  cache,
});
writeFileSync(
  "evals/qc-latest.json",
  JSON.stringify({ policy, at: new Date().toISOString(), results, details }, null, 2) + "\n",
);
const baselineFile = existsSync("evals/baseline.json")
  ? JSON.parse(readFileSync("evals/baseline.json", "utf8"))
  : { results: {} };
const { rows, worse } = compare(results, baselineFile.results);
for (const r of rows)
  console.log(
    `${r.worse ? "REGRESSED" : "ok       "} ${r.suite.padEnd(10)} ${r.metric.padEnd(11)} ${r.value}/${r.total}${r.ref !== undefined ? `  (baseline ${r.ref})` : "  (new)"}`,
  );
console.log(
  `wall time: ${Object.entries(seconds)
    .map(([suite, s]) => `${suite} ${s} s`)
    .join(", ")}`,
);
for (const [suite, d] of Object.entries(details))
  if (d?.summary.flaky.length) console.log(`flaky ${suite}: ${d.summary.flaky.join(", ")}`);

if (process.argv.includes("--accept")) {
  // The spirit of the baseline: no span leaks that it did not, nothing unparsable, the organizers' tests all pass.
  const blocking = worse.filter((r) => r.metric === "leaked" || Number.isNaN(r.value));
  const org = results.organizers.passed;
  if (blocking.length || org[0] !== org[1]) {
    console.log(
      `NOT ACCEPTED: ${blocking.map((r) => `${r.suite} ${r.metric}`).join(", ") || `organizers ${org.join("/")}`} (${elapsed()})`,
    );
    process.exit(1);
  }
  writeFileSync(
    "evals/baseline.json",
    JSON.stringify({ policy, at: new Date().toISOString(), results }, null, 2) + "\n",
  );
  console.log(`baseline recorded (${elapsed()})`);
  process.exit(0);
}
console.log(
  worse.length
    ? `FAIL: ${worse.length} regression(s); revert the change (${elapsed()})`
    : `PASS: no regressions (${elapsed()})`,
);
process.exitCode = worse.length ? 1 : 0;
