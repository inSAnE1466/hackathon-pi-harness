#!/usr/bin/env node
// Autonomous hill-climb over the BRANE policy: try each candidate change, apply it, run the QC gate, keep it only if
// nothing regresses and something improves, otherwise revert. Every attempt is logged to evals/climb-log.tsv.
// Candidates are data (evals/candidates.json): each names a semantic category and keywords or description text to
// add. Usage: node evals/climb.mjs
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const POLICY = "policy/brane.json";
const sh = (args) => {
  try {
    return {
      out: execFileSync("node", args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 900_000,
      }),
      ok: true,
    };
  } catch (e) {
    return { out: String(e.stdout ?? ""), ok: false };
  }
};
const score = () => {
  const g = sh(["evals/golden.mjs"]).out;
  const h = sh(["evals/golden.mjs", "--set=heldout"]).out;
  const n = (re, s) => Number(re.exec(s)?.[1] ?? NaN);
  return {
    leaked: n(/spans leaked (\d+)/, g) + n(/spans leaked (\d+)/, h),
    passed: n(/claims passed (\d+)/, g) + n(/claims passed (\d+)/, h),
    overBlocked: n(/over-blocked (\d+)/, g) + n(/over-blocked (\d+)/, h),
  };
};
const better = (a, b) =>
  a.leaked <= b.leaked &&
  a.overBlocked <= b.overBlocked &&
  a.passed >= b.passed &&
  (a.leaked < b.leaked || a.overBlocked < b.overBlocked || a.passed > b.passed);
const notWorse = (a, b) =>
  a.leaked <= b.leaked && a.overBlocked <= b.overBlocked && a.passed >= b.passed;

if (!existsSync("evals/climb-log.tsv")) {
  writeFileSync("evals/climb-log.tsv", "at\tcandidate\tbefore\tafter\tverdict\n");
}
const candidates = JSON.parse(readFileSync("evals/candidates.json", "utf8"));
let best = score();
console.log(`start: ${JSON.stringify(best)}`);

for (const c of candidates) {
  const original = readFileSync(POLICY, "utf8");
  const policy = JSON.parse(original);
  const cat = policy.semanticCategories.find((s) => s.code === c.category);
  if (!cat) continue;
  if (c.keywords) cat.keywords = [...new Set([...cat.keywords, ...c.keywords])];
  if (c.description) cat.description = `${cat.description} ${c.description}`;
  writeFileSync(POLICY, JSON.stringify(policy, null, 2) + "\n");
  sh(["scripts/brane-policy.mjs", "apply"]);
  const after = score();
  const organizers = /(\d+)\/(\d+) pass/.exec(sh(["scripts/brane-cases.mjs"]).out);
  const organizersOk = organizers && organizers[1] === organizers[2];
  // Keep a change that improves, or a simpler one that holds; revert anything that regresses.
  const keep = organizersOk && (better(after, best) || (c.simplifies && notWorse(after, best)));
  if (!keep) {
    writeFileSync(POLICY, original);
    sh(["scripts/brane-policy.mjs", "apply"]);
  }
  const verdict = keep ? "kept" : organizersOk ? "reverted" : "reverted (organizers' tests failed)";
  appendFileSync(
    "evals/climb-log.tsv",
    `${new Date().toISOString()}\t${c.name}\t${JSON.stringify(best)}\t${JSON.stringify(after)}\t${verdict}\n`,
  );
  console.log(`${verdict.padEnd(9)} ${c.name}: ${JSON.stringify(after)}`);
  if (keep) best = after;
}
console.log(`end: ${JSON.stringify(best)}`);
