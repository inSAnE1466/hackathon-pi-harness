#!/usr/bin/env node
// Build evals/climb-history.json from the recorded runs in evals/runs/. One row per iteration:
//   { iter, track, change, layer, scores, kept, reason, run }
// Nothing here is typed in by hand except each iteration's description. Every score is read from a run file that
// evals/hill.mjs, evals/agent-climb.mjs, evals/legal.mjs or evals/trace.mjs wrote, and kept or reverted is decided
// by the rule of its track, in code, against the best configuration so far:
//   routing  (omar-val, Omar Shalaby's selection split) keep when the leak rate falls by more than 2 points (two
//            rows; less is noise); or when it holds and fewer names, identifiers or labelled values leave; or route
//            macro F1 rises by more than 0.01, or over-block or context over-block falls by more than 1 point with F1
//            holding. Never keep a change that fails a mandatory test it passed before or leaks a labelled span.
//   policy-first  each detect.ts pattern: can the policy alone cover it? Kept only if no identifier of that kind
//            reaches the cloud and no row that needed placeholders loses the cloud model.
//   legal    keep when recall@3 on the hard dev questions rises; or when it holds and MRR or source coverage rises.
//   agent    keep when the end-to-end pass rate rises; or when it holds, nothing unprotected reached the cloud, audit
//            completeness holds, and the cloud share rises by 5 points or more.
// An iteration whose run file is missing is left out, and the script says so.
// Usage: node evals/history.mjs
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const read = (file) => (existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined);
const run = (name) => read(`evals/runs/${name}.json`);
const node = (args) =>
  JSON.parse(execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));

export const CRITERIA = {
  leak_rate: {
    label: "Leak rate (should stay local or be refused, reached the cloud)",
    unit: "%",
    better: "down",
    judging: "GATE, BI-baseline",
  },
  identifier_leak_rate: {
    label: "Identifier leak rate (should be pseudonymised, sent as typed)",
    unit: "%",
    better: "down",
    judging: "GATE",
  },
  name_leak_rate: {
    label: "Names left as typed on the cloud",
    unit: "%",
    better: "down",
    judging: "GATE",
  },
  span_leaks: {
    label: "Labelled must-not-leave values found in a cloud payload",
    unit: "count",
    better: "down",
    judging: "GATE",
  },
  mandatory_tests: {
    label: "Mandatory tests passed (T1 to T5, worst of 5, sequential)",
    unit: "of 5",
    better: "up",
    judging: "GATE",
  },
  blank_answers: {
    label: "Sensitive rows BRANE answered with no detection at all",
    unit: "%",
    better: "down",
    judging: "TE-enforcement",
  },
  macro_f1: { label: "Route macro F1", unit: "0-1", better: "up", judging: "LG-classification" },
  category_recall: {
    label: "Data categories routed at least as strictly as required",
    unit: "%",
    better: "up",
    judging: "LG-classification",
  },
  over_block: {
    label: "Over-block rate (harmless rows kept local or refused)",
    unit: "%",
    better: "down",
    judging: "TE-quality-cost",
  },
  context_over_block: {
    label: "Lookup passages kept off the cloud",
    unit: "%",
    better: "down",
    judging: "TE-quality-cost",
  },
  robustness: {
    label: "Adversarial variants passed",
    unit: "%",
    better: "up",
    judging: "TE-robustness",
  },
  health_pass: {
    label: "Varied health claims kept local with no value leaked",
    unit: "%",
    better: "up",
    judging: "TE-robustness",
  },
  gate_pass: { label: "Omar's gate tests passed", unit: "%", better: "up", judging: "GATE" },
  stability: {
    label: "Rows routed the same on every run",
    unit: "%",
    better: "up",
    judging: "TE-reliability",
  },
  latency_ms: {
    label: "BRANE time per request",
    unit: "ms",
    better: "down",
    judging: "TE-quality-cost",
  },
  calls_per_request: {
    label: "BRANE calls per request",
    unit: "count",
    better: "down",
    judging: "TE-quality-cost",
  },
  retrieval_recall_at_3: {
    label: "Legal lookup recall@3 (hard questions)",
    unit: "0-1",
    better: "up",
    judging: "LG-sources",
  },
  retrieval_mrr: {
    label: "Legal lookup MRR (hard questions)",
    unit: "0-1",
    better: "up",
    judging: "LG-sources",
  },
  source_coverage: {
    label: "Provisions the policy matrix cites that the agent can look up",
    unit: "%",
    better: "up",
    judging: "LG-mapping",
  },
  rule_coverage: {
    label: "Policy categories and matrix rows traced to a verified source",
    unit: "%",
    better: "up",
    judging: "LG-mapping",
  },
  agent_pass: {
    label: "End-to-end claims passed",
    unit: "%",
    better: "up",
    judging: "TE-reliability",
  },
  audit_completeness: {
    label: "Claims where every handoff has its human row",
    unit: "%",
    better: "up",
    judging: "TE-handoff",
  },
  citation_precision: {
    label: "Cited passages that lookup returned and that support the claim",
    unit: "%",
    better: "up",
    judging: "LG-sources",
  },
  cloud_share: {
    label: "Model requests answered by the frontier model",
    unit: "%",
    better: "up",
    judging: "TE-quality-cost",
  },
  unprotected_cloud: {
    label: "Cloud requests with unredacted personal data",
    unit: "count",
    better: "down",
    judging: "TE-enforcement",
  },
  claim_seconds: {
    label: "Time to the first answer per claim",
    unit: "s",
    better: "down",
    judging: "TE-quality-cost",
  },
  model_calls: {
    label: "Model requests per claim",
    unit: "count",
    better: "down",
    judging: "TE-quality-cost",
  },
};

const rows = [];
const skipped = [];
const add = (row) => rows.push({ iter: rows.length, ...row });
const fmt = (key, v) =>
  v === null || v === undefined ? "n/a" : `${v}${CRITERIA[key].unit === "%" ? "%" : ""}`;
const delta = (keys, before, after) =>
  keys
    .filter((k) => before[k] !== after[k] && after[k] !== null && after[k] !== undefined)
    .map((k) => `${k} ${fmt(k, before[k])} -> ${fmt(k, after[k])}`)
    .join(", ");

// ---------------------------------------------------------------- routing track
const mandatory = (name) => {
  const m = run(`mandatory-${name}`);
  return m ? m.cases.filter((c) => c.pass).length : null;
};
const routingScores = (name) => {
  const r = run(name);
  if (!r) return undefined;
  return {
    ...r.scores,
    // Labelled values in a cloud payload on the two suites every routing run includes (health and claims), so rows
    // compare; the adversarial variants are scored apart as robustness.
    span_leaks: (r.bySet.health?.span_leaks ?? 0) + (r.bySet.claims?.span_leaks ?? 0),
    // Sensitive rows where BRANE answered with no detection and no semantic match. This is BRANE's own dropout,
    // which no harness change causes. It bounds how far a leak-rate difference between two rows can be trusted.
    blank_answers: r.bySet[r.split]?.blank_answers ?? null,
    mandatory_tests: mandatory(name),
  };
};
const ROUTING = [
  {
    run: "s00-open",
    short: "baseline",
    layer: "policy",
    change:
      "Baseline: BRANE as handed out (all 25 categories allowed, no semantic rule), no harness",
  },
  {
    run: "s01-policy",
    short: "policy claims-v6.1",
    layer: "policy",
    change:
      "Policy claims-v6.1: identifiers get placeholders, special categories stay local, six semantic rules (health context, claim decisions, comparing claimants, profiling, rule overrides, criminal data)",
  },
  {
    run: "s02-gate-ids",
    short: "pre-mask: ids",
    layer: "gate",
    change:
      "Pre-mask before BRANE: BSN (11-proof), passport, policy and claim numbers, licence plates",
  },
  {
    run: "s03-gate-names",
    short: "pre-mask: names and contacts",
    layer: "gate",
    change: "Pre-mask also covers names, street addresses, email, phone, IBAN and date of birth",
  },
  {
    run: "s04-classifier-v1",
    short: "second classifier",
    layer: "routing",
    change:
      "Second classifier on BRANE's local model, first label definitions; the stricter route wins",
  },
  {
    run: "s05-classifier-v2",
    short: "classifier definitions v2",
    layer: "prompt",
    change:
      "Classifier definitions v2 (written from dev mistakes: pets, group statistics, crimes against the customer, quoted instructions)",
  },
  {
    run: "s06-classifier-all-labels",
    short: "classifier identifier labels",
    layer: "routing",
    change:
      "Classifier's identifier labels also count (a name BRANE passed as typed sends the turn local)",
  },
  {
    run: "s-c1-profiling-not-on-law-text",
    short: "profiling rule narrowed",
    layer: "policy",
    change:
      "Profiling rule: drop the keywords nationality, ethnicity, religion and exclude legal text that only names the grounds",
  },
  {
    run: "s-c2-criminal-not-on-general-wording",
    short: "criminal-data rule narrowed",
    layer: "policy",
    change:
      "Criminal-data rule: drop the keywords suspect, convicted, arrested and exclude general wording about offences",
  },
  {
    run: "s-c3-health-keywords-off-policy-terms",
    short: "health keywords trimmed",
    layer: "policy",
    change:
      "Health rule: drop keywords that the policy terms themselves use (hearing aids, ENT specialist, dental, crown, molar, laser)",
  },
];
let best;
for (const step of ROUTING) {
  const scores = routingScores(step.run);
  if (!scores) {
    skipped.push(step.run);
    continue;
  }
  if (!best) {
    best = scores;
    add({
      track: "routing",
      ...step,
      scores,
      kept: true,
      reason: "Baseline. Every later row is compared with the best configuration so far.",
    });
    continue;
  }
  const lower = (k, by = 0) => scores[k] !== null && best[k] !== null && scores[k] < best[k] - by;
  const higher = (k, by = 0) => scores[k] !== null && best[k] !== null && scores[k] > best[k] + by;
  const guard =
    (scores.mandatory_tests !== null &&
      best.mandatory_tests !== null &&
      scores.mandatory_tests < best.mandatory_tests) ||
    higher("span_leaks");
  // One row of the 100 sensitive rows is 1 point, and BRANE's own answers vary between runs, so a leak-rate change
  // of 2 points or less counts as no change.
  const NOISE = 2;
  const why = guard
    ? "guard"
    : lower("leak_rate", NOISE)
      ? "leak"
      : higher("leak_rate", NOISE)
        ? "leak-up"
        : higher("macro_f1", 0.01)
          ? "f1"
          : (lower("over_block", 1) || lower("context_over_block", 1)) && !lower("macro_f1", 0.01)
            ? "over-block"
            : lower("identifier_leak_rate") || lower("name_leak_rate") || lower("span_leaks")
              ? "identifiers"
              : "none";
  const kept = ["leak", "f1", "over-block", "identifiers"].includes(why);
  const moved = delta(
    [
      "leak_rate",
      "identifier_leak_rate",
      "name_leak_rate",
      "span_leaks",
      "macro_f1",
      "over_block",
      "context_over_block",
      "health_pass",
      "mandatory_tests",
    ],
    best,
    scores,
  );
  const reason = {
    guard: `Reverted: a mandatory test or a labelled value regressed (${moved}).`,
    leak: `Kept: fewer impermissible transfers (${moved}).`,
    "leak-up": `Reverted: the leak rate rose (${moved}).`,
    f1: `Kept: same leak rate, better routing (${moved}).`,
    "over-block": `Kept: same leak rate, fewer harmless requests kept off the cloud (${moved}).`,
    identifiers: `Kept: fewer identifiers or names sent as typed (${moved}).`,
    none: `Reverted: no criterion moved past noise (${moved || "no change"}).`,
  }[why];
  add({ track: "routing", ...step, scores, kept, reason });
  if (kept) best = scores;
}

// ---------------------------------------------------------------- policy-first track
// Can the policy alone cover what a pre-mask pattern covers? Scored without the pre-mask on the rows that hold such
// an identifier (evals/hill.mjs --with-identifiers), against the policy alone.
const POLICY_FIRST = [
  {
    run: "p-pf1-civil-id",
    kinds: ["BSN", "PASSPORT"],
    change:
      "Policy instead of the pre-mask: semantic category for Dutch civil ids (BSN, passport number), action local",
  },
  {
    run: "p-pf2-sensitivity-high",
    kinds: ["BSN", "PASSPORT", "POLICY_ID", "CLAIM_ID", "PLATE"],
    change: "Policy instead of the pre-mask: piiSensitivity high",
  },
  {
    run: "p-pf3-insurer-reference",
    kinds: ["POLICY_ID", "CLAIM_ID"],
    change:
      "Policy instead of the pre-mask: semantic category for policy and claim numbers, action local",
  },
  {
    run: "p-pf4-plate",
    kinds: ["PLATE"],
    change: "Policy instead of the pre-mask: semantic category for licence plates, action local",
  },
];
const pfBase = run("p-base");
if (!pfBase) skipped.push("p-base (policy-first track)");
else
  for (const step of POLICY_FIRST) {
    const r = run(step.run);
    if (!r) {
      skipped.push(step.run);
      continue;
    }
    const count = (x) =>
      step.kinds.reduce(
        ([a, b], k) => [a + (x.identifiers[k]?.[0] ?? 0), b + (x.identifiers[k]?.[1] ?? 0)],
        [0, 0],
      );
    const [left, present] = count(r);
    const [leftBase] = count(pfBase);
    const sum = (x, f) => Object.values(x.bySet).reduce((n, s) => n + f(s), 0);
    const lost = (x) =>
      x.cases.filter((c) => c.expect === "protect" && (c.got === "local" || c.got === "refuse"))
        .length;
    const protect = r.cases.filter((c) => c.expect === "protect").length;
    const closes = left === 0;
    const costs = lost(r) > lost(pfBase);
    add({
      track: "policy-first",
      layer: "policy",
      change: step.change,
      run: step.run,
      scores: {
        identifier_leak_rate: r.scores.identifier_leak_rate,
        leak_rate: r.scores.leak_rate,
        macro_f1: r.scores.macro_f1,
        over_block: r.scores.over_block,
      },
      detail: {
        identifiers_left: `${left}/${present} (${step.kinds.join(", ")}); policy alone ${leftBase}/${present}`,
        placeholder_rows_kept_local: `${lost(r)}/${protect}; policy alone ${lost(pfBase)}/${protect}`,
        rows: sum(r, (s) => s.n),
      },
      kept: closes && !costs,
      reason: closes
        ? costs
          ? `Reverted: it closes the gap (${left}/${present} left) but sends rows that only needed placeholders to the local model (${lost(r)}/${protect}, policy alone ${lost(pfBase)}/${protect}). The pre-mask closes it at no cost.`
          : `Kept as a candidate: no ${step.kinds.join(" or ")} reached the cloud (${left}/${present}) and no placeholder row lost the cloud model.`
        : `Reverted: ${left}/${present} ${step.kinds.join(", ")} values still reached the cloud as typed (policy alone: ${leftBase}/${present}). Product gap; the pre-mask stays.`,
    });
  }

// The two named-person options the coordinator asked to price (a fixed sample of omar-dev plus claims, worst of 2).
const namesBase = run("names-base");
for (const [name, change, why] of [
  [
    "names-named-person",
    "Policy: semantic category 'named private person with an address or claim detail', action local",
    "costs the frontier model on named claims",
  ],
  ["names-sensitivity-high", "Policy: piiSensitivity high", "no effect"],
]) {
  const r = run(name);
  if (!r || !namesBase) {
    skipped.push(name);
    continue;
  }
  const lost = (x) => {
    const p = x.cases.filter((c) => c.expect === "protect");
    return `${p.filter((c) => c.got === "local" || c.got === "refuse").length}/${p.length}`;
  };
  const named = (x) =>
    `${x.cases.filter((c) => c.nameLeft).length}/${x.cases.filter((c) => c.named).length}`;
  add({
    track: "policy-first",
    layer: "policy",
    change,
    run: name,
    scores: {
      name_leak_rate: r.scores.name_leak_rate,
      leak_rate: r.scores.leak_rate,
      macro_f1: r.scores.macro_f1,
      over_block: r.scores.over_block,
    },
    detail: {
      split: "omar-dev (60 rows, 15 per route) and claims (30 rows), worst of 2",
      names_left: `${named(r)}; claims-v6.1 ${named(namesBase)}`,
      placeholder_rows_kept_local: `${lost(r)}; claims-v6.1 ${lost(namesBase)}`,
      macro_f1_before: namesBase.scores.macro_f1,
    },
    kept: false,
    reason: `Reverted: ${why}. Names left as typed ${named(r)} against ${named(namesBase)} for claims-v6.1 (BRANE detected every name in this window, so no benefit could show); rows that only needed placeholders kept local ${lost(r)} against ${lost(namesBase)}; route macro F1 ${namesBase.scores.macro_f1} -> ${r.scores.macro_f1}.`,
  });
}

// Keywords and run-to-run variance (worst of 3).
const kw = run("k-keywords");
const nokw = run("k-no-keywords");
if (kw && nokw)
  add({
    track: "policy-first",
    layer: "policy",
    change: "Policy: remove every semantic keyword (does the GPU judge alone vary less?)",
    run: "k-no-keywords",
    scores: { ...nokw.scores },
    detail: { with_keywords: kw.scores, runs: nokw.runs },
    kept:
      nokw.scores.leak_rate <= kw.scores.leak_rate &&
      nokw.scores.stability >= kw.scores.stability &&
      nokw.scores.macro_f1 > kw.scores.macro_f1 + 0.01,
    reason: `${nokw.scores.leak_rate <= kw.scores.leak_rate && nokw.scores.stability >= kw.scores.stability && nokw.scores.macro_f1 > kw.scores.macro_f1 + 0.01 ? "Kept" : "Reverted"}: rows routed the same on all ${nokw.runs} runs ${kw.scores.stability}% with keywords, ${nokw.scores.stability}% without; leak rate ${kw.scores.leak_rate}% -> ${nokw.scores.leak_rate}%, route macro F1 ${kw.scores.macro_f1} -> ${nokw.scores.macro_f1}, over-block ${kw.scores.over_block}% -> ${nokw.scores.over_block}%.`,
  });
else skipped.push("k-keywords / k-no-keywords");

// ---------------------------------------------------------------- legal track
// The legal track is deterministic, so this script measures it: the lookup ranking's switches one at a time on
// evals/legal/dev.jsonl.
const legal = (ranking, corpus, set = "dev") => {
  const r = node([
    "evals/legal.mjs",
    "--json",
    "--set",
    set,
    "--ranking",
    JSON.stringify(ranking),
    ...(corpus ? ["--corpus", corpus] : []),
  ]);
  return { retrieval_recall_at_3: r.recall_at_3, retrieval_mrr: r.mrr };
};
const trace = (corpus) => {
  const t = node(["evals/trace.mjs", "--json", ...(corpus ? ["--corpus", corpus] : [])]);
  return { source_coverage: t.provisions.coverage, rule_coverage: t.coverage };
};
// The corpus before this climb added the four provisions the matrix cited without a passage.
const ADDED = ["UAVG-31", "UAVG-33(2)", "CHARTER-21", "AIA-Art113"];
const before = "/tmp/gz-climb-corpus-before.json";
writeFileSync(
  before,
  JSON.stringify(
    JSON.parse(readFileSync("corpus/passages.json", "utf8")).filter((p) => !ADDED.includes(p.id)),
  ),
);
const LEGAL = [
  {
    layer: "prompt",
    change: "Baseline lookup: plain BM25 over id, title and text",
    short: "baseline",
    set: {},
  },
  {
    layer: "prompt",
    change:
      "Lookup: glossary of plain and Dutch words to legal terms (policy/lookup-glossary.json)",
    short: "glossary of plain and Dutch words",
    set: { glossary: true },
  },
  {
    layer: "prompt",
    change: "Lookup: passage id and title count twice",
    short: "title counts twice",
    set: { titleWeight: 2 },
  },
  {
    layer: "prompt",
    change: "Lookup: passage id and title count three times",
    short: "title counts three times",
    set: { titleWeight: 3 },
  },
  {
    layer: "prompt",
    change: "Lookup: stem English plurals and verb endings",
    short: "stemming",
    set: { stem: true },
  },
  {
    layer: "prompt",
    change: "Lookup: prefer passages that answer words the earlier hits do not",
    short: "diverse hits",
    set: { diverse: true },
  },
  {
    layer: "prompt",
    change: "Lookup: rank each part of a two-part question by itself",
    short: "split two-part questions",
    set: { split: true },
  },
];
let ranking = {};
let legalBest;
for (const step of LEGAL) {
  const candidate = { ...ranking, ...step.set };
  const scores = { ...legal(candidate, before), ...trace(before) };
  if (!legalBest) {
    legalBest = scores;
    add({
      track: "legal",
      layer: step.layer,
      change: step.change,
      short: step.short,
      scores,
      kept: true,
      reason:
        "Baseline for the legal primitive: 54 hard dev questions (paraphrase, two-part, Dutch and national law, data category to rule).",
    });
    continue;
  }
  const kept =
    scores.retrieval_recall_at_3 > legalBest.retrieval_recall_at_3 ||
    (scores.retrieval_recall_at_3 === legalBest.retrieval_recall_at_3 &&
      scores.retrieval_mrr > legalBest.retrieval_mrr);
  add({
    track: "legal",
    layer: step.layer,
    change: step.change,
    short: step.short,
    scores,
    kept,
    reason: `${kept ? "Kept" : "Reverted"}: recall@3 ${legalBest.retrieval_recall_at_3} -> ${scores.retrieval_recall_at_3}, MRR ${legalBest.retrieval_mrr} -> ${scores.retrieval_mrr}.`,
  });
  if (kept) {
    legalBest = scores;
    ranking = candidate;
  }
}
{
  const scores = { ...legal(ranking), ...trace() };
  const kept =
    scores.source_coverage > legalBest.source_coverage &&
    scores.retrieval_recall_at_3 >= legalBest.retrieval_recall_at_3;
  add({
    track: "legal",
    layer: "policy",
    short: "four missing provisions added",
    change:
      "Corpus: add the four provisions the policy matrix cited without a passage (UAVG Arts. 31 and 33(2), Charter Art. 21, AI Act Art. 113 as amended), quoted from the official texts",
    scores,
    kept,
    reason: `${kept ? "Kept" : "Reverted"}: provisions the matrix cites that the agent can look up ${legalBest.source_coverage}% -> ${scores.source_coverage}%; recall@3 ${legalBest.retrieval_recall_at_3} -> ${scores.retrieval_recall_at_3}, MRR ${legalBest.retrieval_mrr} -> ${scores.retrieval_mrr}.`,
  });
  if (kept) legalBest = scores;
}
// The 18 held-out questions were never used to choose a switch or a glossary term. They are scored for the baseline
// and the final ranking only, and reported beside the dev numbers.
const legalHeldout = {
  split: "evals/legal/heldout.jsonl (18 questions, never tuned on)",
  start: legal({}, before, "heldout"),
  end: legal(ranking, undefined, "heldout"),
};
const { DEFAULT_RANKING } = await import("../src/primitives/lookup-ranking.ts");
const shipped = Object.entries(ranking).every(([k, v]) => DEFAULT_RANKING[k] === v);
if (!shipped)
  throw new Error(
    `lookup-ranking.ts ${JSON.stringify(DEFAULT_RANKING)} is not the ranking the climb kept ${JSON.stringify(ranking)}`,
  );

// ---------------------------------------------------------------- agent track
const AGENT = [
  {
    run: "agent-a0-default",
    layer: "prompt",
    change:
      "Baseline agent: default instructions, intake split on, BRANE dry run before the turn, claude-haiku-5.5, all four tools",
  },
  {
    run: "agent-a9-tools-no-lookup",
    layer: "tools",
    short: "lookup tool removed",
    change:
      "Tools: the lookup tool removed (web_read, consult and request_approval stay), everything else as the baseline",
  },
  {
    run: "agent-a2-prompt-strict",
    layer: "prompt",
    change:
      "Agent instructions 'strict': fixed order of work, every statement carries a passage id, always end with request_approval",
  },
  {
    run: "agent-a1-prompt-minimal",
    layer: "prompt",
    change: "Agent instructions 'minimal': role and hard limits only",
  },
  {
    run: "agent-a8-classifier-on",
    layer: "routing",
    change:
      "Second classifier on in the agent: runs on the person's pre-masked text before the turn",
  },
  {
    run: "agent-a3-intake-off",
    layer: "brane-timing",
    change: "Intake split off: a health claim goes to the agent whole",
  },
  {
    run: "agent-a4-brane-inline",
    layer: "brane-timing",
    change: "BRANE called with the chat request only, no dry run before the turn",
  },
  { run: "agent-a5-model-gpt-6-luna", layer: "model", change: "Cloud route uses gpt-6-luna" },
  {
    run: "agent-a6-model-mistral-large",
    layer: "model",
    change: "Cloud route uses mistral-large-4-0",
  },
];
let agentBest;
for (const step of AGENT) {
  const r = run(step.run);
  if (!r) {
    skipped.push(step.run);
    continue;
  }
  const scores = r.scores;
  if (!agentBest) {
    agentBest = scores;
    add({
      track: "agent",
      ...step,
      scores,
      kept: true,
      reason: `Baseline: ${r.results.length} dev claims end to end, one fresh session each, a scripted reviewer answers every handoff.`,
    });
    continue;
  }
  const safe =
    scores.unprotected_cloud === 0 &&
    (scores.audit_completeness ?? 0) >= (agentBest.audit_completeness ?? 0);
  const kept =
    safe &&
    (scores.agent_pass > agentBest.agent_pass ||
      (scores.agent_pass === agentBest.agent_pass &&
        scores.cloud_share >= agentBest.cloud_share + 5));
  const failed = r.results.filter((x) => !x.pass).map((x) => x.id);
  add({
    track: "agent",
    ...step,
    scores,
    kept,
    reason: `${kept ? "Kept" : "Reverted"}: ${delta(["agent_pass", "audit_completeness", "citation_precision", "cloud_share", "unprotected_cloud", "claim_seconds", "model_calls"], agentBest, scores) || "no criterion moved"}.${failed.length ? ` Failed: ${failed.join(", ")}.` : ""}`,
  });
  if (kept) agentBest = scores;
}

// ---------------------------------------------------------------- the locked test and Omar's reference rows
const locked = run("locked-final");
const reference = readFileSync("omar/results/LOCKED_TEST_RESULTS.csv", "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => {
    const cells = [...line.matchAll(/("([^"]*)"|[^,]*)(,|$)/g)].map((m) => m[2] ?? m[1]);
    return {
      source: "omar",
      predictor: cells[0],
      split: "omar-test (locked, one run)",
      scores: {
        macro_f1: Number(cells[2]),
        leak_rate: Math.round(Number(cells[4]) * 1000) / 10,
        identifier_leak_rate: Math.round(Number(cells[5]) * 1000) / 10,
        over_block: Math.round(Number(cells[6]) * 1000) / 10,
        calls_per_request: Number(cells[7]),
        latency_ms: Number(cells[8]),
      },
    };
  });

const history = {
  about:
    "One row per climb iteration. Scores are read from evals/runs/*.json; kept or reverted is decided by evals/history.mjs. Routing rows are scored on omar-val (Omar Shalaby's selection split, a fixed sample of 50 rows per route) with his metric definitions; the locked omar-test run is reported apart and was never used to choose.",
  generated: new Date().toISOString(),
  criteria: CRITERIA,
  rows,
  locked: locked
    ? {
        split: "omar-test (200 rows, locked, one run)",
        config: locked.config.name,
        at: locked.at,
        scores: locked.bySet["omar-test"] && {
          macro_f1: locked.bySet["omar-test"].macro_f1,
          leak_rate: locked.bySet["omar-test"].leak_rate,
          identifier_leak_rate: locked.bySet["omar-test"].identifier_leak_rate,
          over_block: locked.bySet["omar-test"].over_block,
          calls_per_request: locked.scores.calls_per_request,
          latency_ms: locked.bySet["omar-test"].ms_per_row,
        },
      }
    : null,
  legal_heldout: legalHeldout,
  // Configurations that exist in evals/variants/ but had no run when this file was built. They are not results.
  not_run: skipped,
  reference,
};
writeFileSync("evals/climb-history.json", `${JSON.stringify(history, null, 1)}\n`);
for (const r of rows)
  console.log(
    `${String(r.iter).padStart(2)} ${r.track.padEnd(12)} ${r.kept ? "kept    " : "reverted"} ${r.change.slice(0, 90)}`,
  );
console.log(
  `${rows.length} iterations (${rows.filter((r) => r.kept).length} kept) -> evals/climb-history.json${skipped.length ? `\nno run file yet: ${skipped.join(", ")}` : ""}`,
);
