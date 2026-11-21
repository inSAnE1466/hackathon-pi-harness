#!/usr/bin/env node
// Writes the climb graphs' data into index.html (between the climb:begin and climb:end markers).
//
//   node climb.mjs     reads ../../evals/climb-history.json, or assets/climb-placeholder.json when it does not exist
//
// The data is inlined because a composition may not fetch at render time. A placeholder shows "placeholder data" on
// screen, so it cannot ship unnoticed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const real = join(here, "..", "..", "evals", "climb-history.json");
const src = existsSync(real) ? real : join(here, "assets", "climb-placeholder.json");
const raw = JSON.parse(readFileSync(src, "utf8"));
const rows = Array.isArray(raw) ? raw : raw.rows;
if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${src} has no rows`);
const criteria = raw.criteria ?? Object.fromEntries(Object.keys(rows[0].scores).map((k) => [k, { label: k, unit: "", better: "up" }]));
const data = {
  source: src === real ? "evals/climb-history.json" : "placeholder",
  criteria,
  rows: rows
    .map((r) => ({ iter: r.iter, change: r.change, layer: r.layer, kept: Boolean(r.kept), scores: r.scores }))
    .sort((a, b) => a.iter - b.iter),
};
const html = join(here, "index.html");
const s = readFileSync(html, "utf8");
const a = "/* climb:begin */";
const b = "/* climb:end */";
const i = s.indexOf(a);
const j = s.indexOf(b, i);
if (i < 0 || j < 0) throw new Error("index.html is missing the climb markers");
writeFileSync(html, s.slice(0, i + a.length) + " " + JSON.stringify(data) + " " + s.slice(j));
console.log(`${data.rows.length} iterations, ${Object.keys(criteria).length} criteria, from ${data.source}`);
