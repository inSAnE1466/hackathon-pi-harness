#!/usr/bin/env node
// Read evals/climb-history.json and write evals/climb-summary.json. For each headline metric it records the value
// before the first change, the value after the last kept change and the kept steps between them, on omar-val, with
// the locked omar-test result apart. The README, the video (demo/video/climb.mjs) and docs/evals.md all read this one file;
// --docs rewrites the table between the markers in docs/evals.md from it, and the headline table between the
// headline markers in README.md, submission/README.md, docs/evals.md and docs/track.md.
// A legal metric is included only if it moved.
// Usage: node evals/slopes.mjs [--docs]
import { readFileSync, writeFileSync } from "node:fs";
import {
  buildHeadline,
  HEADLINE_BEGIN,
  HEADLINE_DOCS,
  HEADLINE_END,
  renderHeadline,
} from "./headline.mjs";

const history = JSON.parse(readFileSync("evals/climb-history.json", "utf8"));
const HEADLINE = [
  {
    key: "leak_rate",
    from: "leak_rate",
    track: "routing",
    label: "Leak rate",
    unit: "%",
    better: "down",
  },
  {
    key: "route_f1",
    from: "macro_f1",
    track: "routing",
    label: "Route macro F1",
    unit: "0-1",
    better: "up",
  },
  {
    key: "over_block",
    from: "over_block",
    track: "routing",
    label: "Over-block rate",
    unit: "%",
    better: "down",
  },
  {
    key: "mandatory_tests",
    from: "mandatory_tests",
    track: "routing",
    label: "Mandatory tests passed",
    unit: "of 5",
    better: "up",
  },
  {
    key: "retrieval_recall_at_3",
    from: "retrieval_recall_at_3",
    track: "legal",
    label: "Legal lookup recall@3",
    unit: "0-1",
    better: "up",
    onlyIfMoved: true,
  },
];
const short = (row) => row.short ?? row.change;

const metrics = [];
for (const m of HEADLINE) {
  const rows = history.rows.filter(
    (r) => r.track === m.track && r.scores[m.from] !== null && r.scores[m.from] !== undefined,
  );
  const kept = rows.filter((r) => r.kept);
  if (kept.length === 0) continue;
  const start = kept[0].scores[m.from];
  const end = kept.at(-1).scores[m.from];
  if (m.onlyIfMoved && start === end) continue;
  const lockedKey = m.from;
  metrics.push({
    key: m.key,
    label: m.label,
    unit: m.unit,
    better: m.better,
    start,
    end,
    // The kept changes after the baseline, in order.
    steps: kept.slice(1).map(short),
    points: kept.map((r) => ({ iter: r.iter, value: r.scores[m.from], change: r.change })),
    tried: rows.length - 1,
    reverted: rows.filter((r) => !r.kept).length,
    split:
      m.track === "routing"
        ? m.key === "mandatory_tests"
          ? "T1 to T5 as BRANE dry runs, worst of 5 in sequence (live evidence: submission/test_evidence_run.csv)"
          : "omar-val"
        : "evals/legal/dev.jsonl (54 questions)",
    // The same metric on questions that were never tuned on (legal track only).
    heldout:
      m.track === "legal" && history.legal_heldout
        ? {
            start: history.legal_heldout.start[m.from],
            end: history.legal_heldout.end[m.from],
            split: history.legal_heldout.split,
          }
        : null,
    locked:
      m.track === "routing" && history.locked?.scores
        ? (history.locked.scores[lockedKey] ?? null)
        : null,
  });
}
// With the lookup tool and without it: the same 12 dev claims end to end, everything else equal.
const agentRow = (name) => history.rows.find((r) => r.run === name);
const withLookup = agentRow("agent-a0-default");
const withoutLookup = agentRow("agent-a9-tools-no-lookup");
const pickScores = (r) =>
  Object.fromEntries(
    [
      "agent_pass",
      "citation_precision",
      "audit_completeness",
      "unprotected_cloud",
      "claim_seconds",
    ].map((k) => [k, r.scores[k]]),
  );
const comparisons =
  withLookup && withoutLookup
    ? [
        {
          key: "lookup_tool",
          label: "Agent with the lookup tool and without it",
          split:
            "evals/agent/dev.jsonl (12 claims, one run each, a scripted reviewer answers every handoff)",
          with: pickScores(withLookup),
          without: pickScores(withoutLookup),
        },
      ]
    : [];
const summary = {
  source:
    "evals/climb-history.json: real runs of evals/hill.mjs against BRANE (draft policies, POST /policy/test) on Omar Shalaby's selection split omar-val, and of evals/legal.mjs on the hard legal questions. start is the baseline before the first change, end is after the last kept change.",
  generated: history.generated,
  // The one set of numbers every document and the video quote (evals/headline.mjs).
  headline: buildHeadline(history),
  iterations: { total: history.rows.length, kept: history.rows.filter((r) => r.kept).length },
  locked: history.locked,
  reference: history.reference,
  metrics,
  comparisons,
  not_run: history.not_run,
};
writeFileSync("evals/climb-summary.json", `${JSON.stringify(summary, null, 1)}\n`);

const show = (m, v) =>
  v === null || v === undefined
    ? "not run yet"
    : m.unit === "%"
      ? `${v}%`
      : m.unit === "of 5"
        ? `${v} of 5`
        : String(v);
const table = [
  "| Metric | Start | End | On unseen data (locked test, one run) | Kept steps | Tried | Measured on |",
  "| ------ | ----- | --- | ------------------------------------- | ---------- | ----- | ----------- |",
  ...metrics.map(
    (m) =>
      `| ${m.label} (${m.better === "down" ? "lower" : "higher"} is better) | ${show(m, m.start)} | ${show(m, m.end)} | ${m.heldout ? `${show(m, m.heldout.start)} to ${show(m, m.heldout.end)} (18 held-out questions)` : m.split === "omar-val" ? show(m, m.locked) : "n/a"} | ${m.steps.join("; ") || "none"} | ${m.tried} (${m.reverted} reverted) | ${m.split} |`,
  ),
].join("\n");
if (process.argv.includes("--docs")) {
  const file = "docs/evals.md";
  const doc = readFileSync(file, "utf8");
  const begin = "<!-- climb-summary:begin (generated by node evals/slopes.mjs --docs) -->";
  const end = "<!-- climb-summary:end -->";
  if (!doc.includes(begin) || !doc.includes(end))
    throw new Error(`${file} lacks the climb-summary markers`);
  writeFileSync(
    file,
    `${doc.slice(0, doc.indexOf(begin) + begin.length)}\n\n${table}\n\n${doc.slice(doc.indexOf(end))}`,
  );
}
if (process.argv.includes("--docs"))
  for (const file of HEADLINE_DOCS) {
    const doc = readFileSync(file, "utf8");
    if (!doc.includes(HEADLINE_BEGIN) || !doc.includes(HEADLINE_END))
      throw new Error(`${file} lacks the headline markers`);
    writeFileSync(
      file,
      `${doc.slice(0, doc.indexOf(HEADLINE_BEGIN) + HEADLINE_BEGIN.length)}\n\n${renderHeadline(summary.headline)}\n\n${doc.slice(doc.indexOf(HEADLINE_END))}`,
    );
  }
for (const c of comparisons)
  console.log(`${c.label}: with ${JSON.stringify(c.with)} | without ${JSON.stringify(c.without)}`);
console.log(table);
console.log(`\n${metrics.length} metrics -> evals/climb-summary.json`);
