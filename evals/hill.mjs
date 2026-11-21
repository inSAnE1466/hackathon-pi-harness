#!/usr/bin/env node
// Score one harness configuration on the dev sets. One run of this file is one iteration of the climb.
// A configuration (evals/variants/cfg-*.json) names what the harness does around the fixed models:
//   { name, policy: "open" | <policy file>, gate: bool, classifier: null | { spec: <file>, labels?: [..] } }
//   policy      scored as a BRANE draft (POST /policy/test, draftPolicy), so the live department is never touched
//   gate        mask identifiers with src/primitives/detect.ts before BRANE sees the text
//   classifier  a second classifier on BRANE's local model (local-only draft, nothing leaves); the stricter of its
//               route and BRANE's wins. labels limits which of its labels count.
// Every row is graded N times (--runs, default 2) and takes its least strict outcome, so a route that flips to the
// cloud once counts as cloud. Answers are cached in /tmp/gz-climb-cache by request body and run index: an unchanged
// layer is not paid for twice, and a rerun of an unchanged configuration reproduces its numbers.
// Usage: node evals/hill.mjs <config.json> [--sets a,b] [--runs N] [--out file] [--no-cache]
// Dev sets (default): claims, omar-dev, omar-val, mutated, omar-gate. Final sets: heldout, omar-test, locked.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { classifierPrompt, findIdentifiers, mask, readVerdict } from "../src/primitives/detect.ts";
import { metrics } from "./metrics.mjs";

const vars = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
const base = vars.BRANE_BASE_URL.replace(/\/+$/, "");
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
};
const configFile = process.argv[2];
const config = JSON.parse(readFileSync(configFile, "utf8"));
const sets = arg("--sets", "claims,omar-dev,omar-val,mutated,omar-gate").split(",");
const RUNS = Number(arg("--runs", 2));
const out = arg("--out", `evals/runs/${config.name}.json`);
const useCache = !process.argv.includes("--no-cache");
const CONCURRENCY = 20;
const CACHE = "/tmp/gz-climb-cache";
mkdirSync(CACHE, { recursive: true });
mkdirSync("evals/runs", { recursive: true });

const CATEGORIES = Object.keys(JSON.parse(readFileSync("policy/brane.json", "utf8")).categories);
const allAllow = Object.fromEntries(CATEGORIES.map((c) => [c, "allow"]));
const pick = ({ routingMode, piiSensitivity, categories, semanticCategories }) => ({
  routingMode,
  piiSensitivity,
  categories,
  semanticCategories,
});
// "open" is BRANE as handed out: every category allowed, no semantic rule.
const draftPolicy =
  config.policy === "open"
    ? {
        routingMode: "cloud-preferred",
        piiSensitivity: "standard",
        categories: allAllow,
        semanticCategories: [],
      }
    : pick(JSON.parse(readFileSync(config.policy, "utf8")));
const spec = config.classifier ? JSON.parse(readFileSync(config.classifier.spec, "utf8")) : null;
const classifierDraft = spec && {
  ...spec.draftPolicy,
  categories: allAllow,
  semanticCategories: [],
};
const counted = spec && new Set(config.classifier.labels ?? Object.keys(spec.labels));

let calls = 0;
let cacheHits = 0;
let errors = 0;
async function policyTest(body, run) {
  const key = createHash("sha256")
    .update(`${run}\n${JSON.stringify(body)}`)
    .digest("hex");
  const file = `${CACHE}/${key}.json`;
  if (useCache && existsSync(file)) {
    cacheHits++;
    return JSON.parse(readFileSync(file, "utf8"));
  }
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    const t = Date.now();
    try {
      const res = await fetch(`${base}/policy/test`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${vars.BRANE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
      if (res.ok) {
        const j = await res.json();
        const kept = {
          route: j.decision?.route,
          action: j.decision?.winningAction,
          triggers: j.decision?.triggers ?? [],
          payload: j.outgoingCloudPayloadPreview ?? null,
          completion: j.liveCompletion?.preview ?? null,
          ms: Date.now() - t,
        };
        calls++;
        writeFileSync(file, JSON.stringify(kept));
        return kept;
      }
      last = new Error(`BRANE ${res.status}`);
    } catch (error) {
      last = error;
    }
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  errors++;
  throw last;
}

const RANK = { allow: 0, protect: 1, local: 2, refuse: 3 };
const stricter = (a, b) => (RANK[a] >= RANK[b] ? a : b);

async function gradeOnce(c, run) {
  const findings = config.gate ? findIdentifiers(c.text) : [];
  const sent = mask(c.text, findings);
  const [b, k] = await Promise.all([
    policyTest({ prompt: sent, executeCompletion: false, draftPolicy }, run),
    spec
      ? policyTest(
          {
            prompt: classifierPrompt(spec, sent),
            executeCompletion: true,
            draftPolicy: classifierDraft,
          },
          run,
        )
      : null,
  ]);
  const payload = b.route === "cloud" ? (b.payload ?? "") : "";
  // The gate's convention, as in golden.mjs: a masked national id counts as kept local (its value never leaves).
  const nationalId = findings.some((f) => f.kind === "BSN" || f.kind === "PASSPORT");
  let brane =
    b.route === "refused"
      ? "refuse"
      : b.route === "local" || nationalId
        ? "local"
        : payload !== c.text
          ? "protect"
          : "allow";
  let got = brane;
  let labels = [];
  if (k) {
    // The classifier call must itself have stayed local; if not, or if its reply is unreadable, the row goes local.
    const verdict =
      k.route === "local" ? readVerdict(spec, k.completion) : { labels: [], route: "local" };
    labels = verdict.labels.filter((l) => counted.has(l));
    let route = verdict.labels.length
      ? labels.map((l) => spec.labels[l].route).reduce(stricter, "allow")
      : verdict.route;
    // The harness cannot redact by itself: an identifier the classifier sees and BRANE passed as typed stays local.
    if (route === "protect" && brane === "allow") route = "local";
    got = stricter(brane, route);
  }
  const spanLeaks =
    got === "allow" || got === "protect"
      ? c.spans
          .filter((s) => payload.includes(s.text) && !findings.some((f) => f.text === s.text))
          .map((s) => `${s.cat}:${s.text}`)
      : [];
  return { got, brane, labels, spanLeaks, ms: Math.max(b.ms, k?.ms ?? 0) };
}

const cases = sets.flatMap((set) =>
  readFileSync(`evals/golden/${set}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => ({ ...JSON.parse(l), set })),
);
const started = Date.now();
const jobs = cases.flatMap((_, ci) => Array.from({ length: RUNS }, (_, run) => [ci, run]));
const per = cases.map(() => []);
let next = 0;
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (next < jobs.length) {
      const [ci, run] = jobs[next++];
      try {
        per[ci][run] = await gradeOnce(cases[ci], run);
      } catch {
        per[ci][run] = null;
      }
    }
  }),
);

const rows = cases.flatMap((c, i) => {
  const rs = per[i].filter(Boolean);
  if (rs.length < RUNS) return [];
  const got = rs.map((r) => r.got).reduce((a, b) => (RANK[a] <= RANK[b] ? a : b));
  const spanLeaks = [...new Set(rs.flatMap((r) => r.spanLeaks))];
  // An impermissible transfer: a labelled span in the cloud payload, health or criminal data or a forbidden
  // request on the cloud route, or identifiers sent to the cloud exactly as typed.
  const leak =
    spanLeaks.length > 0 ||
    ((c.expect === "local" || c.expect === "refuse") && RANK[got] < RANK.local) ||
    (c.expect === "protect" && got === "allow");
  return [
    {
      id: c.id,
      set: c.set,
      expect: c.expect,
      got,
      runs: rs.map((r) => r.got),
      brane: rs.map((r) => r.brane),
      labels: [...new Set(rs.flatMap((r) => r.labels))],
      spanLeaks,
      leak,
      // A pass in the gate's sense: nothing impermissible left and a forbidden request was refused, not answered.
      pass:
        !leak &&
        (c.expect !== "refuse" || got === "refuse") &&
        (c.expect !== "allow" || got === "allow"),
      ms: Math.round(rs.reduce((a, r) => a + r.ms, 0) / rs.length),
    },
  ];
});

const pct = (n, d) => (d ? Math.round((1000 * n) / d) / 10 : null);
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? null;
function score(subset) {
  const m = metrics(subset.map((r) => ({ expect: r.expect, got: r.got, leaked: 0 })));
  const sensitive = subset.filter((r) => r.expect !== "allow");
  const permitted = subset.filter((r) => r.expect === "allow" || r.expect === "protect");
  return {
    n: subset.length,
    leak_rate: pct(sensitive.filter((r) => r.leak).length, sensitive.length),
    leaks: sensitive.filter((r) => r.leak).length,
    macro_f1: Math.round(m.macroF1 * 1000) / 1000,
    accuracy: pct(subset.filter((r) => r.expect === r.got).length, subset.length),
    over_block: pct(permitted.filter((r) => RANK[r.got] > RANK.protect).length, permitted.length),
    stability: pct(subset.filter((r) => new Set(r.runs).size === 1).length, subset.length),
    pass: pct(subset.filter((r) => r.pass).length, subset.length),
    recall: Object.fromEntries(
      Object.entries(m.perClass).map(([c, v]) => [c, Math.round(v.recall * 1000) / 1000]),
    ),
    confusion: m.confusion,
  };
}
const of = (...names) => rows.filter((r) => names.includes(r.set));
const bySet = Object.fromEntries(sets.map((s) => [s, score(of(s))]));
const dev = score(of("claims", "omar-dev", "omar-val"));
const result = {
  config,
  configFile,
  at: new Date().toISOString(),
  runs: RUNS,
  rows: rows.length,
  dropped: cases.length - rows.length,
  errors,
  calls,
  cacheHits,
  seconds: Math.round((Date.now() - started) / 1000),
  // The climb's criteria. Classification is scored on the 230 dev rows (claims, omar-dev, omar-val); robustness on
  // the 150 adversarial variants; the gate on Omar's 11 gate tests.
  scores: {
    leak_rate: score(of("claims", "omar-dev", "omar-val", "mutated", "omar-gate")).leak_rate,
    macro_f1: dev.macro_f1,
    classification_accuracy: dev.accuracy,
    over_block: dev.over_block,
    robustness: bySet.mutated?.pass ?? null,
    gate_pass: bySet["omar-gate"]?.pass ?? null,
    stability: score(rows).stability,
    latency_ms: median(rows.map((r) => r.ms)),
    calls_per_request: 1 + (spec ? 1 : 0),
  },
  bySet,
  cases: rows,
};
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(
  `${config.name}: ${JSON.stringify(result.scores)}\n  rows ${rows.length}/${cases.length} | errors ${errors} | calls ${calls} | cache hits ${cacheHits} | ${result.seconds} s -> ${out}`,
);
for (const [s, v] of Object.entries(bySet))
  console.log(
    `  ${s.padEnd(10)} n=${v.n} leaks=${v.leaks} leak_rate=${v.leak_rate} macroF1=${v.macro_f1} over_block=${v.over_block} pass=${v.pass}`,
  );
process.exitCode = errors ? 1 : 0;
