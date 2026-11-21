#!/usr/bin/env node
// Convert Omar's evaluation material (omar/, by Omar Shalaby) into suites our graders run, without changing omar/.
//   evals/golden/omar-gate.jsonl   his 11 dry-run gate tests (T1-T4, E1-E6; T5 is a simulation), with expectations
//   evals/golden/omar-test.jsonl   his locked held-out test set (200 rows: unseen vocabulary, 65+ population)
// His routes map onto ours: cloud -> allow, cloud_redacted -> protect, local -> local, refused -> refuse.
// The locked set is graded on the route only (spans are not labelled per row); it is never used for tuning.
//   evals/golden/omar-dev.jsonl, omar-val.jsonl   100 rows each from his tuning and selection sets, for the climb
// Usage: node evals/import-omar.mjs
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const route = { cloud: "allow", cloud_redacted: "protect", local: "local", refused: "refuse" };

// Gate tests: expectations from his "expected" text and his own tier mapping.
const gate = JSON.parse(readFileSync("omar/tests/gate_tests.json", "utf8")).tests;
const gateExpect = {
  T1: "allow",
  T2a: "protect",
  T2b: "local",
  T3: "protect",
  T4: "refuse",
  E1: "local",
  E2: "local",
  E3: "local",
  E4: "protect",
  E5: "refuse",
  E6: "refuse",
};
const gateRows = gate
  .filter((t) => gateExpect[t.id])
  .map((t) => ({
    id: `omar-${t.id}`,
    kind: t.type,
    text: t.prompt,
    expect: gateExpect[t.id],
    spans: [],
  }));
writeFileSync(
  "evals/golden/omar-gate.jsonl",
  gateRows.map((r) => JSON.stringify(r)).join("\n") + "\n",
);

// Locked test set: verify his recorded hash first, so we know we grade the file he locked.
const raw = readFileSync("omar/data/test.csv");
const sha = createHash("sha256").update(raw).digest("hex");
const LOCKED = "42b87bc53972df681983214a5bad1ce63ece328574fa44794b6be213ff75380d";
if (sha !== LOCKED)
  throw new Error(`omar/data/test.csv hash ${sha} differs from the locked ${LOCKED}`);

// Minimal CSV parser (quoted fields with commas and newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') ((field += '"'), i++);
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") (row.push(field), (field = ""));
    else if (c === "\n") (row.push(field), rows.push(row), (row = []), (field = ""));
    else if (c !== "\r") field += c;
  }
  if (field || row.length) (row.push(field), rows.push(row));
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}
const test = parseCsv(raw.toString("utf8")).map((r) => ({
  id: `omar-${r.id}`,
  kind: r.notes || r.gold_route,
  text: r.prompt,
  expect: route[r.gold_route],
  spans: [],
}));
writeFileSync("evals/golden/omar-test.jsonl", test.map((r) => JSON.stringify(r)).join("\n") + "\n");

// Dev suites for the climb: a fixed, route-stratified sample of his dev (tuning) and val (selection) rows, every
// k-th row per route in file order, so the sample never changes between runs. Neither file is locked.
for (const [name, n] of [
  ["dev", 100],
  ["val", 100],
]) {
  const rows = parseCsv(readFileSync(`omar/data/${name}.csv`, "utf8"));
  const out = [];
  for (const r of Object.keys(route)) {
    const group = rows.filter((x) => x.gold_route === r);
    const step = group.length / (n / 4);
    for (let i = 0; i < n / 4; i++) out.push(group[Math.floor(i * step)]);
  }
  writeFileSync(
    `evals/golden/omar-${name}.jsonl`,
    out
      .map((r) =>
        JSON.stringify({
          id: `omar-${r.id}`,
          kind: r.notes || r.gold_route,
          text: r.prompt,
          expect: route[r.gold_route],
          spans: [],
        }),
      )
      .join("\n") + "\n",
  );
}
console.log(
  `omar-gate: ${gateRows.length} tests; omar-test: ${test.length} rows (sha256 matches the locked hash)`,
);
