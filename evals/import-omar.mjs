#!/usr/bin/env node
// Convert Omar's evaluation material (omar/, by Omar Shalaby) into suites our graders run, without changing omar/.
//   evals/golden/omar-gate.jsonl   his 11 dry-run gate tests (T1-T4, E1-E6; T5 is a simulation), with expectations
//   evals/golden/omar-test.jsonl   his locked held-out test set (200 rows: unseen vocabulary, 65+ population)
// His routes map onto ours: cloud -> allow, cloud_redacted -> protect, local -> local, refused -> refuse.
// The locked set is graded on the route only (spans are not labelled per row); it is never used for tuning.
//   evals/golden/omar-dev.jsonl    his tuning set (800 rows)
//   evals/golden/omar-val.jsonl    his selection set (500 rows)
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

// The full tuning and selection sets for the climb: dev (800 rows, tune) and val (500 rows, choose). The pinned
// hashes are those of the files on origin/omar/gezira-harness, so every climb row is scored on the rows his table
// uses. Each row keeps his 14 labels, for the per-category score.
const LABELS = [
  "PERSON",
  "CONTACT",
  "IBAN",
  "BSN",
  "POLICY_ID",
  "HEALTH",
  "THIRD_PARTY_HEALTH",
  "MENTAL_HEALTH",
  "WORK_INCAPACITY",
  "CRIMINAL",
  "AUTO_DECISION",
  "DISCRIMINATORY",
  "BULK_EXPORT",
  "INJECTION",
];
const row = (r) => ({
  id: `omar-${r.id}`,
  kind: r.notes || r.gold_route,
  lang: r.lang,
  text: r.prompt,
  expect: route[r.gold_route],
  labels: LABELS.filter((l) => r[l] === "1"),
  spans: [],
});
const PINNED = {
  dev: "e8d6c6991bc5bbfe9370febe16495778f26c90d8dc04706cbc766b495031b81f",
  val: "2bd8164e2da280898cf1f9e74f2f10feaa33549ad83bf2abe19c4de7040461d6",
};
const counts = {};
for (const name of ["dev", "val"]) {
  const bytes = readFileSync(`omar/data/${name}.csv`);
  const got = createHash("sha256").update(bytes).digest("hex");
  if (got !== PINNED[name])
    throw new Error(`omar/data/${name}.csv hash ${got} differs from the pinned ${PINNED[name]}`);
  const rows = parseCsv(bytes.toString("utf8")).map(row);
  counts[name] = rows.length;
  writeFileSync(
    `evals/golden/omar-${name}.jsonl`,
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}
const test = parseCsv(raw.toString("utf8")).map(row);
writeFileSync("evals/golden/omar-test.jsonl", test.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(
  `omar-gate: ${gateRows.length} tests; omar-dev: ${counts.dev}; omar-val: ${counts.val}; omar-test: ${test.length} rows (all hashes match)`,
);
