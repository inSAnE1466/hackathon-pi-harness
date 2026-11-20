#!/usr/bin/env node
// Autonomous hill-climb over the BRANE policy. For each candidate in evals/candidates.json (a semantic category plus
// keywords or description text, written by evals/propose.mjs): apply it to the live department, score every suite
// worst of N (evals/suites.mjs), and keep it only on a strict improvement: no metric worse, at least one better, and
// the improvement confirmed by a second scoring (worst of both). Anything else is reverted.
// The live department is shared: on any exit, normal or interrupted, policy/brane.json and the live policy end
// identical. Normal end: the best policy found. Interrupted (SIGINT, SIGTERM, crash): the original policy.
// Writes evals/climb-latest.md (committed) and appends to evals/climb-log.tsv (gitignored).
// Usage: node evals/climb.mjs [--candidate-minutes N]   (default 20 minutes per candidate, scoring included)
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { compare, fmt, killChildren, node, scoreSuites, worstOf } from "./suites.mjs";

const POLICY = "policy/brane.json";
const started = Date.now();
const elapsed = () => `${Math.round((Date.now() - started) / 1000)} s`;
const minutesArg = process.argv.indexOf("--candidate-minutes");
const CANDIDATE_MS = (minutesArg === -1 ? 20 : Number(process.argv[minutesArg + 1])) * 60_000;
const APPLY_MS = 60_000;

const original = readFileSync(POLICY, "utf8");
let finished = false;
let restoring;

// Write a policy text to the file and push it to the live department. Throws if the push fails.
// Once a restore has begun, only the restore may write: the main loop resumes when its children are killed.
async function applyPolicy(text, { restore = false } = {}) {
  if (restoring && !restore) throw new Error("interrupted");
  writeFileSync(POLICY, text);
  const r = await node(["scripts/brane-policy.mjs", "apply"], APPLY_MS);
  if (!r.ok) throw new Error("brane-policy apply failed");
}
async function restoreOriginal(reason) {
  restoring ??= (async () => {
    killChildren();
    console.log(`${reason}: restoring the original policy`);
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await applyPolicy(original, { restore: true });
        console.log("original policy restored and applied");
        return;
      } catch (error) {
        console.log(`restore attempt ${attempt} failed: ${error.message}`);
      }
    }
    console.log("RESTORE FAILED: run node scripts/brane-policy.mjs apply by hand");
    process.exitCode = 2;
  })();
  return restoring;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, async () => {
    await restoreOriginal(signal);
    process.exit(130);
  });
}

const rows = [];
let startScore;
let best;
try {
  if (!existsSync("evals/climb-log.tsv")) {
    writeFileSync("evals/climb-log.tsv", "at\tcandidate\tbefore\tafter\tverdict\n");
  }
  const candidates = JSON.parse(readFileSync("evals/candidates.json", "utf8"));
  // Start from a known state: the live department gets exactly the file.
  await applyPolicy(original);
  ({ results: startScore } = await scoreSuites({ deadline: Date.now() + CANDIDATE_MS }));
  best = startScore;
  let bestText = original;
  console.log(`start (${elapsed()}): ${fmt(best)}`);
  if (compare(best, {}).worse.length)
    throw new Error("start score incomplete (BRANE unreachable or slow)");

  for (const c of candidates) {
    const policy = JSON.parse(bestText);
    const cat = policy.semanticCategories.find((s) => s.code === c.category);
    if (!cat) {
      rows.push({ name: c.name, verdict: "skipped (no such category)" });
      continue;
    }
    if (c.keywords) cat.keywords = [...new Set([...cat.keywords, ...c.keywords])];
    if (c.description) cat.description = `${cat.description} ${c.description}`;
    const text = JSON.stringify(policy, null, 2) + "\n";
    const deadline = Date.now() + CANDIDATE_MS;
    let after;
    let verdict;
    try {
      await applyPolicy(text);
      after = (await scoreSuites({ deadline })).results;
      let cmp = compare(after, best);
      if (!cmp.worse.length && cmp.better.length) {
        // Confirm: BRANE varies run to run, so a win must survive a second scoring.
        after = worstOf(after, (await scoreSuites({ deadline })).results);
        cmp = compare(after, best);
      }
      const keep = !cmp.worse.length && cmp.better.length > 0;
      verdict = keep
        ? `kept (better: ${cmp.better.map((r) => `${r.suite} ${r.metric} ${r.ref}->${r.value}`).join(", ")})`
        : cmp.worse.length
          ? `reverted (worse: ${cmp.worse.map((r) => `${r.suite} ${r.metric} ${r.ref}->${r.value}`).join(", ")})`
          : "reverted (no improvement)";
      if (keep) {
        best = after;
        bestText = text;
      }
    } catch (error) {
      verdict = `reverted (${error.message})`;
    }
    if (!verdict.startsWith("kept")) await applyPolicy(bestText);
    rows.push({ name: c.name, after, verdict });
    appendFileSync(
      "evals/climb-log.tsv",
      `${new Date().toISOString()}\t${c.name}\t${JSON.stringify(best)}\t${JSON.stringify(after ?? null)}\t${verdict}\n`,
    );
    console.log(`${verdict} | ${c.name} (${elapsed()})${after ? `\n  ${fmt(after)}` : ""}`);
  }
  // The file and the live department end on the best policy found.
  await applyPolicy(bestText);
  finished = true;
} finally {
  if (!finished) await restoreOriginal("climb did not finish");
}

const version = JSON.parse(readFileSync(POLICY, "utf8")).version;
const changed = readFileSync(POLICY, "utf8") !== original;
const md = [
  "# Latest climb",
  "",
  `Written by \`node evals/climb.mjs\` at ${new Date().toISOString()} on policy ${version}, in ${elapsed()}. Each`,
  "score is the worst of N runs (golden and held-out 3, mutated 2); a candidate is kept only on a strict",
  "improvement confirmed by a second scoring.",
  "",
  `- Start: ${fmt(startScore)}`,
  `- End: ${fmt(best)}`,
  `- Policy file changed: ${changed ? "yes" : "no"}`,
  "",
  "| Candidate | Verdict |",
  "| --------- | ------- |",
  ...rows.map((r) => `| ${r.name.replace(/\|/g, "/")} | ${r.verdict.replace(/\|/g, "/")} |`),
  "",
].join("\n");
writeFileSync("evals/climb-latest.md", md);
console.log(`end (${elapsed()}): ${fmt(best)}; policy file ${changed ? "changed" : "unchanged"}`);
