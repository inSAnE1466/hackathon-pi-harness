#!/usr/bin/env node
// One set of numbers everywhere. Reads `headline` from evals/climb-summary.json and fails when README.md,
// submission/README.md, docs/evals.md or docs/track.md states a different value for a headline metric.
//   1. Each document carries the headline table between the headline markers, and it must be exactly the table
//      evals/headline.mjs renders from the file (node evals/slopes.mjs --docs rewrites it).
//   2. Outside that table, a line that names a headline metric (leak rate, macro F1, over-block, recall@3, unsafe
//      decisions, or a count "N of M" / "N/M" whose M is a headline total) may only state headline values.
//   A line about another system (an older policy, a teammate's own run) carries the marker
//   <!-- numbers-check: other system --> and must say in words which system produced its number.
//   The climb table in docs/evals.md (between the climb-summary markers) is generated from the same file and lists
//   the steps on the way; it is not checked line by line.
// Usage: node scripts/numbers-check.mjs
import { readFileSync } from "node:fs";
import { HEADLINE_BEGIN, HEADLINE_DOCS, HEADLINE_END, renderHeadline } from "../evals/headline.mjs";

const { headline } = JSON.parse(readFileSync("evals/climb-summary.json", "utf8"));
if (!headline?.values) {
  console.error(
    "evals/climb-summary.json has no headline; run node evals/history.mjs && node evals/slopes.mjs",
  );
  process.exit(1);
}
const v = headline.values;
const table = renderHeadline(headline);
const nums = (...keys) =>
  new Set(
    keys
      .flatMap((k) => (v[k] ? [v[k].value, v[k].start] : []))
      .filter((x) => typeof x === "number"),
  );
// Metric families: a pattern that finds the stated number near the metric's name, and the values it may take.
const FAMILIES = [
  ["leak rate", /leak rate\D{0,60}?(\d+(?:\.\d+)?)\s?%/gi, nums("leak_rate", "locked_leak_rate")],
  ["macro F1", /macro[- ]F1\D{0,60}?(0\.\d+)/gi, nums("route_f1", "locked_route_f1")],
  [
    "over-block",
    /over-block(?: rate)?\D{0,60}?(\d+(?:\.\d+)?)\s?%/gi,
    nums("over_block", "locked_over_block"),
  ],
  ["recall@3", /recall@3\D{0,40}?(0\.\d+)/gi, nums("legal_recall_tuning", "legal_recall_unseen")],
  [
    "unsafe decisions",
    /(\d+) unsafe/gi,
    nums("compare_harness_unsafe", "compare_brane_unsafe", "compare_ask_llm_unsafe"),
  ],
];
// Counts: "N of M" or "N/M" where M is the total of a headline count. N must be a headline value with that total.
const totals = new Map();
for (const e of Object.values(v))
  if (e.unit === "of") totals.set(e.of, (totals.get(e.of) ?? new Set()).add(e.value));

const OTHER = "<!-- numbers-check: other system -->";
const strip = (doc, begin, end) => {
  let out = doc;
  while (out.includes(begin) && out.includes(end, out.indexOf(begin)))
    out =
      out.slice(0, out.indexOf(begin)) +
      out.slice(out.indexOf(end, out.indexOf(begin)) + end.length);
  return out;
};
// A table as its cells, so the formatter's column padding does not count as a difference.
const cells = (text) =>
  text
    .trim()
    .split("\n")
    .filter((line) => !/^\|[\s|:-]+\|$/.test(line.trim()))
    .map((line) =>
      line
        .split("|")
        .map((cell) => cell.trim())
        .join("|"),
    )
    .join("\n");
const problems = [];
for (const file of HEADLINE_DOCS) {
  const doc = readFileSync(file, "utf8");
  const a = doc.indexOf(HEADLINE_BEGIN);
  const b = doc.indexOf(HEADLINE_END);
  if (a === -1 || b === -1) {
    problems.push(`${file}: no headline table (markers missing)`);
    continue;
  }
  if (cells(doc.slice(a + HEADLINE_BEGIN.length, b)) !== cells(table))
    problems.push(
      `${file}: the headline table differs from evals/climb-summary.json (run node evals/slopes.mjs --docs)`,
    );
  const prose = strip(
    strip(doc, HEADLINE_BEGIN, HEADLINE_END),
    "<!-- climb-summary:begin",
    "<!-- climb-summary:end -->",
  );
  prose.split("\n").forEach((line, i) => {
    if (line.includes(OTHER)) return;
    for (const [name, pattern, allowed] of FAMILIES)
      for (const m of line.matchAll(pattern))
        if (!allowed.has(Number(m[1])))
          problems.push(
            `${file}: "${m[0].trim()}" states ${name} ${m[1]}; the headline has ${[...allowed].join(", ") || "no value"} (near line ${i + 1} of the prose)`,
          );
    for (const m of line.matchAll(/\b(\d+)(?:\/| of )(\d+)\b/g)) {
      const allowed = totals.get(Number(m[2]));
      // A date such as 20/11 or a count with a total the headline does not use is not a headline number.
      if (
        allowed &&
        !allowed.has(Number(m[1])) &&
        /pass|test|case|run|unsafe|correct|stable|claims|decision/i.test(line)
      )
        problems.push(
          `${file}: "${m[0]}" is not a headline count (allowed with total ${m[2]}: ${[...allowed].join(", ")})`,
        );
    }
  });
}
if (problems.length) {
  console.error(problems.join("\n"));
  console.error(
    `\n${problems.length} problems: a document states a number the headline does not have`,
  );
  process.exit(1);
}
console.log(
  `numbers-check: ${HEADLINE_DOCS.length} documents agree with ${Object.keys(v).length} headline values in evals/climb-summary.json`,
);
