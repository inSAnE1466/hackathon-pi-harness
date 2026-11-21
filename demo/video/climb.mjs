#!/usr/bin/env node
// Writes the climb slopes' data into index.html (between the climb:begin and climb:end markers).
//
//   node climb.mjs     reads ../../evals/climb-summary.json (written by gz-climb), or
//                      assets/climb-placeholder.json, same shape, when it does not exist
//
// The data is inlined because a composition may not fetch at render time. A placeholder shows "placeholder data" on
// screen, so it cannot ship unnoticed.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const real = join(here, "..", "..", "evals", "climb-summary.json");
const src = existsSync(real) ? real : join(here, "assets", "climb-placeholder.json");
const raw = JSON.parse(readFileSync(src, "utf8"));
const want = ["leak_rate", "route_f1", "over_block", "mandatory_tests"];
const all = Array.isArray(raw.metrics) ? raw.metrics : [];
// The four headline metrics when present; until they land, whatever real metrics the file holds (at most four).
const head = want.map((k) => all.find((m) => m.key === k)).filter(Boolean);
const metrics = head.length > 0 ? head : all.slice(0, 4);
if (metrics.length === 0) throw new Error(`${src} has no metrics`);
for (const m of metrics)
  if (typeof m.start !== "number" || typeof m.end !== "number")
    throw new Error(`${m.key} needs numeric start and end`);
const data = {
  source: src === real ? "evals/climb-summary.json" : "placeholder",
  metrics: metrics.map(({ key, label, unit, better, start, end, steps }) => ({
    key,
    label,
    unit: unit ?? "",
    better: better ?? "up",
    start,
    end,
    steps: Array.isArray(steps) ? steps.length : Number(steps ?? 0),
  })),
};
const html = join(here, "index.html");
const s = readFileSync(html, "utf8");
const a = "/* climb:begin */";
const b = "/* climb:end */";
const i = s.indexOf(a);
const j = s.indexOf(b, i);
if (i < 0 || j < 0) throw new Error("index.html is missing the climb markers");
writeFileSync(html, s.slice(0, i + a.length) + " " + JSON.stringify(data) + " " + s.slice(j));
console.log(`${data.metrics.length} metrics from ${data.source}`);
