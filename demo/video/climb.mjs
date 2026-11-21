#!/usr/bin/env node
// Writes the climb slopes' data into index.html (between the climb:begin and climb:end markers).
//
//   node climb.mjs     reads ../../evals/climb-summary.json: .metrics and .headline.values
//
// Six slopes, each start (baseline) to end (the complete system, classifier on), real data only: a metric that is
// missing is dropped, never filled in. Over-block goes up:
// it is shown as the price of the protection, not as a win. Legal recall shows the tuning questions and the unseen
// ones. The data is inlined because a composition may not fetch at render time.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const evals = join(here, "..", "..", "evals");
const summaryPath = join(evals, "climb-summary.json");
if (!existsSync(summaryPath))
  throw new Error("evals/climb-summary.json is missing; cut the slopes");
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
const metric = (k) =>
  (summary.metrics ?? []).find((m) => m.key === k && typeof m.start === "number");
const kept = (n) => (Array.isArray(n) ? n.length : Number(n ?? 0));

// The complete system's headline (classifier on): evals/climb-summary.json .headline.values.<key>.
const hv = summary.headline?.values ?? {};
const head = (k) => (typeof hv[k]?.value === "number" ? hv[k] : null);
const names =
  head("names_as_typed") && typeof hv.names_as_typed.start === "number"
    ? {
        key: "names_as_typed",
        label: "Names sent as typed",
        unit: "%",
        better: "down",
        start: hv.names_as_typed.start,
        end: hv.names_as_typed.value,
        steps: metric("leak_rate")?.steps ?? 0,
      }
    : null;
const security = head("security_cases");

const out = [];
const add = (m, extra) =>
  m &&
  out.push({
    key: m.key,
    label: m.label,
    unit: m.unit ?? "",
    better: m.better ?? "up",
    start: m.start,
    end: m.end,
    steps: kept(m.steps),
    ...extra,
  });
add(metric("leak_rate"), { note: "omar-val · complete system" });
add(names, { note: "omar-val · complete system" });
add(metric("route_f1"), { label: "Route F1", note: "omar-val" });
add(metric("mandatory_tests"), { note: "BRANE dry runs" });
const rec = metric("retrieval_recall_at_3");
add(rec, {
  label: "Legal lookup recall@3",
  note: "tuning questions",
  second:
    rec?.heldout && typeof rec.heldout.start === "number"
      ? { label: "unseen", start: rec.heldout.start, end: rec.heldout.end }
      : null,
});
add(metric("over_block"), {
  label: "Over-block",
  note: "the price of the protection",
  price: true,
});
if (out.length === 0) throw new Error("evals/climb-summary.json has no metrics");

const data = {
  source: "evals/climb-summary.json",
  metrics: out,
  security: security ? { value: security.value, of: security.of } : null,
};
const html = join(here, "index.html");
const s = readFileSync(html, "utf8");
const a = "/* climb:begin */";
const b = "/* climb:end */";
const i = s.indexOf(a);
const j = s.indexOf(b, i);
if (i < 0 || j < 0) throw new Error("index.html is missing the climb markers");
writeFileSync(html, s.slice(0, i + a.length) + " " + JSON.stringify(data) + " " + s.slice(j));
for (const m of out)
  console.log(
    `${m.label.padEnd(24)} ${m.start} -> ${m.end}${m.second ? ` (unseen ${m.second.start} -> ${m.second.end})` : ""}`,
  );
