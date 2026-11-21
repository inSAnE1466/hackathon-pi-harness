#!/usr/bin/env node
// Score one harness configuration on the dev sets. One run of this file is one iteration of the climb.
// A configuration (evals/variants/cfg-*.json) names what the harness does around the fixed models:
//   { name, policy: "open" | <policy file>, gate: bool | [kinds], classifier: null | { spec: <file>, labels?: [..] } }
//   policy      scored as a BRANE draft (POST /policy/test, draftPolicy), so the live department is never touched
//   gate        the pre-mask (src/primitives/detect.ts) before BRANE sees the text: true for everything it finds, or
//               a list of kinds, e.g. ["BSN","POLICY_ID"]
//   classifier  a second classifier on BRANE's local model (local-only draft, nothing leaves); the stricter of its
//               route and BRANE's wins. labels limits which of its labels count.
// Every row is graded N times (--runs, default 1) and takes its least strict outcome, so a route that flips to the
// cloud once counts as cloud. Answers are cached in /tmp/gz-climb-cache by request body and run index, so an unchanged
// layer is not paid for twice, and a rerun of an unchanged configuration reproduces its numbers.
// Sets, one dataset for every climb (Omar Shalaby's splits, evals/import-omar.mjs):
//   omar-dev (800)   tune: read its mistakes to write the next candidate (--sets omar-dev --runs 1)
//   omar-val (500)   choose: a candidate is kept or reverted on this score (default)
//   omar-test (200)  locked: one run of the final configuration, never used to choose
// Beside it, by default: health (39 varied health claims with 228 labelled must-not-leave spans, from
// evals/generate-health.mjs), mutated (150 adversarial variants, robustness), omar-gate (11 gate tests) and claims
// (our own 30 rows, a smoke check only), and passages: every corpus passage as the lookup tool returns it. A passage
// holds no personal data, so each one kept off the cloud is an agent turn the frontier model loses after a lookup.
// Metric definitions are his (omar/eval/metrics.py), so the numbers compare with his locked table:
//   macro_f1                route macro F1 over cloud, cloud with placeholders, local, refused
//   leak_rate               rows that should stay local or be refused but reached the cloud
//   identifier_leak_rate    rows that should be pseudonymised but reached the cloud as typed
//   over_block              harmless rows kept local or refused
// Usage: node evals/hill.mjs <config.json> [--sets a,b] [--runs N] [--per-route N] [--concurrency N] [--out file] [--no-cache]
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
const sets = arg("--sets", "omar-val,health,passages,mutated,omar-gate,claims").split(",");
const RUNS = Number(arg("--runs", 1));
const out = arg("--out", `evals/runs/${config.name}.json`);
const useCache = !process.argv.includes("--no-cache");
// A BRANE dry run takes about 5.3 s whatever the load, so the run is bounded by this number. It stays low on purpose:
// with many requests in flight on one team key BRANE answers some with no detection and no semantic match at all
// (measured 21 Nov: 48 in flight sent 22 to 39 of 48 sensitive rows to the cloud; 4 in flight was stable). The team
// rule is at most 4 in flight per pane, so 3 here leaves one for an agent run.
const CONCURRENCY = Number(arg("--concurrency", 3));
const CACHE = "/tmp/gz-climb-cache-3";
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
// "open" is BRANE as handed out, with every category allowed and no semantic rule.
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
          detected: [...new Set((j.detectedCategories ?? []).map((d) => d.label))],
          semantic: (j.matchedSemanticCategories ?? []).map((m) => m.code),
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
  // What detect.ts finds is computed either way, so a run without the pre-mask shows which identifiers reach the
  // cloud.
  const found = findIdentifiers(c.text);
  // gate: true masks everything the pre-mask finds; a list masks only those kinds (the pre-mask as it once was).
  const findings = Array.isArray(config.gate)
    ? found.filter((f) => config.gate.includes(f.kind))
    : config.gate
      ? found
      : [];
  const sent = mask(c.text, findings);
  // One after the other, so a worker never has two BRANE requests in flight.
  const b = await policyTest({ prompt: sent, executeCompletion: false, draftPolicy }, run);
  const k = spec
    ? await policyTest(
        {
          prompt: classifierPrompt(spec, sent),
          executeCompletion: true,
          draftPolicy: classifierDraft,
        },
        run,
      )
    : null;
  const payload = b.route === "cloud" ? (b.payload ?? "") : "";
  // Our own sets expect "local" for a national id, and golden.mjs counts a masked one as kept local (the value never
  // leaves). Omar's answer key expects "cloud with placeholders" for it, which is what the request really is.
  const nationalId =
    !c.set.startsWith("omar-") && findings.some((f) => f.kind === "BSN" || f.kind === "PASSPORT");
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
    // The harness cannot redact by itself, so an identifier the classifier sees and BRANE passed as typed stays local.
    if (route === "protect" && brane === "allow") route = "local";
    got = stricter(brane, route);
  }
  const spanLeaks =
    got === "allow" || got === "protect"
      ? c.spans
          .filter((s) => payload.includes(s.text) && !findings.some((f) => f.text === s.text))
          .map((s) => `${s.cat}:${s.text}`)
      : [];
  const cloud = got === "allow" || got === "protect";
  const identifiers = [...new Map(found.map((f) => [f.text, f])).values()].map((f) => ({
    kind: f.kind,
    left: cloud && payload.includes(f.text),
  }));
  // A name left as typed: the row names a person, the request went to the cloud, and the name is in the payload
  // (our rows label the span; Omar's rows label the row, so there it is "cloud and BRANE detected no PERSON").
  const names = c.spans.filter((s) => s.cat === "PERSON");
  const named = names.length > 0 || (c.labels ?? []).includes("PERSON");
  // The pre-mask replaces a name before BRANE sees it, so then BRANE reports no PERSON and nothing was missed.
  const preMasked = findings.some((f) => f.kind === "NAME");
  const nameLeft =
    named &&
    cloud &&
    (names.length
      ? names.some((s) => payload.includes(s.text))
      : !preMasked &&
        (!b.detected.includes("PERSON") || draftPolicy.categories.PERSON === "allow"));
  // BRANE answered with no detection and no semantic match on text the pre-mask had not already emptied of
  // identifiers. On a sensitive row that means its checks did not run.
  const blank = b.detected.length === 0 && b.semantic.length === 0 && findings.length === 0;
  return {
    got,
    brane,
    labels,
    spanLeaks,
    identifiers,
    named,
    nameLeft,
    blank,
    semantic: b.semantic,
    ms: b.ms + (k?.ms ?? 0),
  };
}

const cases = sets.flatMap((set) =>
  readFileSync(`evals/golden/${set}.jsonl`, "utf8")
    .trim()
    .split("\n")
    .map((l) => ({ ...JSON.parse(l), set })),
);
// --per-route N keeps every k-th row per expected route of the large sets (omar-dev, omar-val, mutated): a fixed
// sample, the same rows for every configuration. --with-identifiers KINDS keeps only rows that hold one of
// those pre-mask kinds, for the policy-first pass.
const perRoute = Number(arg("--per-route", 0));
if (perRoute) {
  const kept = [];
  for (const set of sets) {
    // Only the large sets are sampled; the small ones always run whole.
    if (!["omar-dev", "omar-val", "mutated"].includes(set)) {
      kept.push(...cases.filter((c) => c.set === set));
      continue;
    }
    for (const route of ["allow", "protect", "local", "refuse"]) {
      const group = cases.filter((c) => c.set === set && c.expect === route);
      const step = Math.max(1, group.length / perRoute);
      for (let i = 0; i < Math.min(perRoute, group.length); i++)
        kept.push(group[Math.floor(i * step)]);
    }
  }
  cases.splice(0, cases.length, ...kept);
}
const onlyKinds = arg("--with-identifiers");
if (onlyKinds) {
  // e.g. --with-identifiers BSN,PASSPORT,POLICY_ID,CLAIM_ID,PLATE
  const kinds = onlyKinds.split(",");
  const kept = cases.filter((c) => findIdentifiers(c.text).some((f) => kinds.includes(f.kind)));
  cases.splice(0, cases.length, ...kept);
}
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
      rowLabels: c.labels,
      spanLeaks,
      named: rs[0].named,
      nameLeft: rs.some((r) => r.nameLeft),
      blank: rs.filter((r) => r.blank).length,
      semantic: [...new Set(rs.flatMap((r) => r.semantic))],
      // Identifiers detect.ts knows, by kind: how many the row holds and how many reached the cloud in any run.
      identifiers: rs[0].identifiers.map((f, n) => ({
        kind: f.kind,
        left: rs.some((r) => r.identifiers[n]?.left),
      })),
      leak,
      // A pass means nothing impermissible left and a forbidden request was refused, not answered.
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
const labelRoute = spec
  ? Object.fromEntries(Object.entries(spec.labels).map(([l, v]) => [l, v.route]))
  : JSON.parse(readFileSync("policy/classifier.json", "utf8")).labels;
const needed = (l) => labelRoute[l]?.route ?? labelRoute[l];
function score(subset) {
  const m = metrics(subset.map((r) => ({ expect: r.expect, got: r.got, leaked: 0 })));
  const special = subset.filter((r) => r.expect === "local" || r.expect === "refuse");
  const ident = subset.filter((r) => r.expect === "protect");
  const benign = subset.filter((r) => r.expect === "allow");
  const leaks = special.filter((r) => RANK[r.got] < RANK.local);
  const identLeaks = ident.filter((r) => r.got === "allow");
  // Per data category (the 14 labels on Omar's rows): rows carrying the label that were routed at least as strictly
  // as the label requires.
  const byLabel = {};
  for (const r of subset)
    for (const l of r.rowLabels ?? []) {
      byLabel[l] ??= [0, 0];
      byLabel[l][1]++;
      if (RANK[r.got] >= RANK[needed(l)]) byLabel[l][0]++;
    }
  const shares = Object.values(byLabel).map(([a, b]) => a / b);
  return {
    n: subset.length,
    macro_f1: Math.round(m.macroF1 * 1000) / 1000,
    accuracy: pct(subset.filter((r) => r.expect === r.got).length, subset.length),
    leak_rate: pct(leaks.length, special.length),
    leaks: leaks.length,
    identifier_leak_rate: pct(identLeaks.length, ident.length),
    name_leak_rate: pct(
      subset.filter((r) => r.nameLeft).length,
      subset.filter((r) => r.named).length,
    ),
    // Rows that only needed placeholders but lost the cloud model.
    protect_kept_local: pct(ident.filter((r) => RANK[r.got] > RANK.protect).length, ident.length),
    // Sensitive rows where at least one BRANE answer came back with no detection and no semantic match.
    blank_answers: pct(
      subset.filter((r) => r.expect !== "allow" && r.blank > 0).length,
      subset.filter((r) => r.expect !== "allow").length,
    ),
    over_block: pct(benign.filter((r) => RANK[r.got] > RANK.protect).length, benign.length),
    category_recall: shares.length
      ? Math.round((1000 * shares.reduce((a, x) => a + x, 0)) / shares.length) / 10
      : null,
    span_leaks: subset.reduce((n, r) => n + r.spanLeaks.length, 0),
    stability: pct(subset.filter((r) => new Set(r.runs).size === 1).length, subset.length),
    pass: pct(subset.filter((r) => r.pass).length, subset.length),
    ms_per_row: Math.round(subset.reduce((a, r) => a + r.ms, 0) / Math.max(1, subset.length)),
    byLabel,
    confusion: m.confusion,
  };
}
// Per identifier kind: [values that reached the cloud as typed, values present]. With the pre-mask off this shows
// which of its patterns the policy alone already covers.
const identifiers = {};
for (const r of rows)
  for (const f of r.identifiers) {
    identifiers[f.kind] ??= [0, 0];
    identifiers[f.kind][1]++;
    if (f.left) identifiers[f.kind][0]++;
  }
const of = (...names) => rows.filter((r) => names.includes(r.set));
const bySet = Object.fromEntries(sets.map((s) => [s, score(of(s))]));
// The headline numbers come from the selection set, unless the run names only another of Omar's splits.
const split = ["omar-val", "omar-test", "omar-dev"].find((s) => sets.includes(s)) ?? sets[0];
const main = bySet[split];
const result = {
  config,
  configFile,
  at: new Date().toISOString(),
  runs: RUNS,
  split,
  rows: rows.length,
  dropped: cases.length - rows.length,
  errors,
  calls,
  cacheHits,
  seconds: Math.round((Date.now() - started) / 1000),
  scores: {
    leak_rate: main.leak_rate,
    identifier_leak_rate: main.identifier_leak_rate,
    name_leak_rate: main.name_leak_rate,
    macro_f1: main.macro_f1,
    over_block: main.over_block,
    category_recall: main.category_recall,
    robustness: bySet.mutated?.pass ?? null,
    gate_pass: bySet["omar-gate"]?.pass ?? null,
    health_pass: bySet.health?.pass ?? null,
    context_over_block: bySet.passages?.over_block ?? null,
    span_leaks: ["claims", "mutated", "health"].some((x) => sets.includes(x))
      ? (bySet.claims?.span_leaks ?? 0) +
        (bySet.mutated?.span_leaks ?? 0) +
        (bySet.health?.span_leaks ?? 0)
      : null,
    // Rows that took the same route on every run; needs --runs 2 or more.
    stability: RUNS > 1 ? score(rows).stability : null,
    latency_ms: main.ms_per_row,
    calls_per_request: 1 + (spec ? 1 : 0),
  },
  identifiers,
  bySet,
  cases: rows,
};
writeFileSync(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(
  `${config.name}: ${JSON.stringify(result.scores)}\n  rows ${rows.length}/${cases.length} | errors ${errors} | calls ${calls} | cache hits ${cacheHits} | ${result.seconds} s -> ${out}`,
);
console.log(`  identifiers left/present: ${JSON.stringify(identifiers)}`);
for (const [s, v] of Object.entries(bySet))
  console.log(
    `  ${s.padEnd(10)} n=${v.n} macroF1=${v.macro_f1} leak=${v.leak_rate}% (${v.leaks}) idLeak=${v.identifier_leak_rate}% nameLeak=${v.name_leak_rate}% blank=${v.blank_answers}% protect->local=${v.protect_kept_local}% overBlock=${v.over_block}% spans=${v.span_leaks} pass=${v.pass}%`,
  );
process.exitCode = errors ? 1 : 0;
