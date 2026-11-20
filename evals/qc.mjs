#!/usr/bin/env node
// QC gate: run every suite and compare with the accepted baseline (evals/baseline.json). Any regression fails.
// Use it after every change to the policy, a prompt, a primitive or the corpus; keep the change only on PASS.
//   node evals/qc.mjs              # BRANE suites only (dry runs, no model cost, about 1 minute)
//   node evals/qc.mjs --agent URL  # also the end-to-end agent eval against a running harness
//   node evals/qc.mjs --accept     # after a deliberate improvement, record the new numbers as the baseline
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const run = (args) => {
  try {
    return {
      out: execFileSync("node", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 900_000,
      }),
      ok: true,
    };
  } catch (error) {
    return { out: String(error.stdout ?? ""), ok: false };
  }
};
const num = (re, s) => {
  const m = re.exec(s);
  return m ? [Number(m[1]), Number(m[2])] : [NaN, NaN];
};

const results = {};
const golden = run(["evals/golden.mjs"]).out;
results.golden = {
  passed: num(/claims passed (\d+)\/(\d+)/, golden),
  leaked: num(/spans leaked (\d+)\/(\d+)/, golden),
  overBlocked: num(/over-blocked (\d+)\/(\d+)/, golden),
};
const heldout = run(["evals/golden.mjs", "--set=heldout"]).out;
results.heldout = {
  passed: num(/claims passed (\d+)\/(\d+)/, heldout),
  leaked: num(/spans leaked (\d+)\/(\d+)/, heldout),
  overBlocked: num(/over-blocked (\d+)\/(\d+)/, heldout),
};
const cases = run(["scripts/brane-cases.mjs"]).out;
results.organizers = { passed: num(/(\d+)\/(\d+) pass/, cases) };
const agentUrl = process.argv.includes("--agent")
  ? process.argv[process.argv.indexOf("--agent") + 1]
  : undefined;
if (agentUrl) {
  const agent = run(["evals/agent.mjs", agentUrl]).out;
  results.agent = { passed: num(/(\d+)\/(\d+) agent cases pass/, agent) };
}

// Higher is better for "passed"; lower is better for "leaked" and "overBlocked".
const lowerIsBetter = new Set(["leaked", "overBlocked"]);
const policy = JSON.parse(readFileSync("policy/brane.json", "utf8")).version;
console.log(`QC on policy ${policy}`);
if (process.argv.includes("--accept")) {
  writeFileSync(
    "evals/baseline.json",
    JSON.stringify({ policy, at: new Date().toISOString(), results }, null, 2) + "\n",
  );
  console.log("baseline recorded:", JSON.stringify(results));
  process.exit(0);
}
const baseline = existsSync("evals/baseline.json")
  ? JSON.parse(readFileSync("evals/baseline.json", "utf8")).results
  : {};
let regressions = 0;
for (const [suite, metrics] of Object.entries(results)) {
  for (const [metric, [value, total]] of Object.entries(metrics)) {
    const before = baseline[suite]?.[metric]?.[0];
    const worse =
      before !== undefined && (lowerIsBetter.has(metric) ? value > before : value < before);
    const broken = Number.isNaN(value);
    if (worse || broken) regressions++;
    console.log(
      `${worse || broken ? "REGRESSED" : "ok       "} ${suite.padEnd(10)} ${metric.padEnd(11)} ${value}/${total}${before !== undefined ? `  (baseline ${before})` : ""}`,
    );
  }
}
console.log(
  regressions ? `FAIL: ${regressions} regression(s); revert the change` : "PASS: no regressions",
);
process.exitCode = regressions ? 1 : 0;
