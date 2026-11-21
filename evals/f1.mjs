#!/usr/bin/env node
// Score the live BRANE policy as a classifier: per-outcome precision, recall and F1, macro F1, unsafe decisions
// and spans leaked. Reads the same golden-format sets as golden.mjs. It makes dry runs only (POST /policy/test), so
// there is no model call and no cost. Never prints the key.
// Sets are Omar Shalaby's splits (evals/import-omar.mjs): omar-dev to tune, omar-val to choose (the default),
// omar-test locked for one final run. At most four requests are in flight, because the whole team shares BRANE.
// Usage: node evals/f1.mjs [--set=omar-val,omar-dev,claims] [--json] [--save]
//   --save writes evals/f1-latest.json. Run --set=locked only for the final number, never while tuning.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CLASSES, metrics, outcome } from "./metrics.mjs";

const vars = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
if (!vars.BRANE_BASE_URL || !vars.BRANE_API_KEY) {
  console.error("Set BRANE_BASE_URL and BRANE_API_KEY in .dev.vars or the environment.");
  process.exit(2);
}
const base = vars.BRANE_BASE_URL.replace(/\/+$/, "");
const sets = (process.argv.find((a) => a.startsWith("--set="))?.slice(6) ?? "omar-val").split(",");

async function dryRun(prompt) {
  const res = await fetch(`${base}/policy/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${vars.BRANE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, executeCompletion: false }),
  });
  if (!res.ok) throw new Error(`BRANE ${res.status}`);
  return res.json();
}

async function score(set) {
  const cases = readFileSync(`evals/golden/${set}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  const rows = [];
  for (let i = 0; i < cases.length; i += 4) {
    const batch = cases.slice(i, i + 4);
    const answers = await Promise.all(batch.map((c) => dryRun(c.text)));
    batch.forEach((c, k) => {
      const j = answers[k];
      const route = j.decision?.route;
      const payload = route === "cloud" ? (j.outgoingCloudPayloadPreview ?? "") : "";
      const got = outcome(route, c.text, payload, j.decision?.action);
      const leaked = (c.spans ?? [])
        .filter((s) => payload.includes(s.text))
        .map((s) => `${s.cat}:${s.text}`);
      rows.push({
        id: c.id,
        kind: c.kind,
        expect: c.expect,
        got,
        leaked: leaked.length,
        leakedSpans: leaked,
      });
    });
  }
  return { set, rows, ...metrics(rows) };
}

const pct = (x) => `${(x * 100).toFixed(0)}%`.padStart(5);
const results = [];
for (const s of sets) results.push(await score(s));

if (process.argv.includes("--save"))
  writeFileSync("evals/f1-latest.json", `${JSON.stringify(results, null, 2)}\n`);
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(results, null, 2));
} else {
  for (const r of results) {
    console.log(`\n== ${r.set} (${r.n} cases) ==`);
    console.log("outcome   support  precision  recall    F1");
    for (const c of CLASSES) {
      const p = r.perClass[c];
      if (p.support)
        console.log(
          `${c.padEnd(9)} ${String(p.support).padStart(7)}  ${pct(p.precision).padStart(9)}  ${pct(p.recall).padStart(6)}  ${p.f1.toFixed(2).padStart(5)}`,
        );
    }
    console.log(`\nconfusion (rows = expected, columns = got): ${CLASSES.join(" ")}`);
    for (const e of CLASSES)
      if (r.perClass[e].support)
        console.log(
          `  ${e.padEnd(8)} ${CLASSES.map((g) => String(r.confusion[e][g]).padStart(5)).join("")}`,
        );
    for (const row of r.rows.filter((x) => x.expect !== x.got || x.leaked))
      console.log(
        `  ${row.id} expect=${row.expect} got=${row.got}${row.leaked ? ` LEAKED ${row.leakedSpans.join(", ")}` : ""}`,
      );
    console.log(
      `\nmacro F1 ${r.macroF1.toFixed(3)} | accuracy ${pct(r.accuracy)} | unsafe ${r.unsafe} | over-strict ${r.overStrict} | spans leaked ${r.leaks}`,
    );
  }
}
process.exitCode = results.every((r) => r.unsafe === 0) ? 0 : 1;
