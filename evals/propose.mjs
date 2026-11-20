#!/usr/bin/env node
// Propose policy candidates from the latest failures, deterministically and without a model call.
// Reads the per-claim results that qc.mjs saved in evals/qc-latest.json (or golden.mjs --json files given as
// arguments), groups leaked spans and wrong routes by the semantic category that owns them and by variant, and writes
// evals/candidates.json for climb.mjs: per category, the leaked phrases as keywords, and one description sentence
// that names them. Held-out failures are reported but never proposed from, so the held-out set stays a fair test.
// Usage: node evals/propose.mjs [golden.json ...]
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// Which semantic category owns a planted span category, and which owns a claim kind whose route was wrong.
const OWNER_BY_SPAN = { HEALTH: "CLAIM_HEALTH_CONTEXT", HEALTH_PROVIDER: "CLAIM_HEALTH_CONTEXT" };
const OWNER_BY_KIND = {
  health: "CLAIM_HEALTH_CONTEXT",
  decision: "CLAIM_OUTCOME_DECISION",
  linkage: "CROSS_CLAIMANT_COMPARISON",
  profiling: "PROTECTED_TRAIT_PROFILING",
  injection: "RULE_OVERRIDE_ATTEMPT",
};
// The variant wording a sentence names when a category fails only inside a wrapper.
const VARIANT_WORDING = {
  lower: "written in lower case",
  padded: "preceded by a long covering note",
  linebreaks: "split across lines",
  polite: "wrapped in polite phrasing",
  embedded: "accompanied by a note saying the file was pre-cleared",
};

const sources = process.argv.slice(2);
const sets = {};
if (sources.length) {
  for (const f of sources) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    sets[j.summary.set] = j;
  }
} else if (existsSync("evals/qc-latest.json")) {
  Object.assign(sets, JSON.parse(readFileSync("evals/qc-latest.json", "utf8")).details);
} else {
  console.error(
    "no failures to read: run node evals/qc.mjs first, or pass golden.mjs --json files",
  );
  process.exit(2);
}

const policy = JSON.parse(readFileSync("policy/brane.json", "utf8"));
const existing = new Map(
  policy.semanticCategories.map((s) => [s.code, new Set(s.keywords.map((k) => k.toLowerCase()))]),
);

// failures[category] = { phrases: Map(phrase -> claim ids), variants: Set, claims: Set }
const failures = {};
const unowned = [];
const heldout = [];
for (const [suite, data] of Object.entries(sets)) {
  if (!data) continue;
  for (const c of data.claims.filter((x) => !x.ok)) {
    if (suite === "heldout") {
      heldout.push(c.id);
      continue;
    }
    const [baseKind, variant = "plain"] = c.kind.split("/");
    const owned = c.leaked.filter((l) => OWNER_BY_SPAN[l.split(":")[0]]);
    const other = c.leaked.filter((l) => !OWNER_BY_SPAN[l.split(":")[0]]);
    for (const l of other) unowned.push(`${c.id} ${l}`);
    const routeWrong = !c.leaked.length && OWNER_BY_KIND[baseKind] && c.expect !== "protect";
    if (!owned.length && !routeWrong) {
      if (!other.length) unowned.push(`${c.id} expect=${c.expect} routes=${c.routes.join(",")}`);
      continue;
    }
    const code = owned.length ? OWNER_BY_SPAN[owned[0].split(":")[0]] : OWNER_BY_KIND[baseKind];
    const f = (failures[code] ??= { phrases: new Map(), variants: new Set(), claims: new Set() });
    f.variants.add(variant);
    f.claims.add(c.id);
    for (const l of owned) {
      const phrase = l.slice(l.indexOf(":") + 1).toLowerCase();
      if (!f.phrases.has(phrase)) f.phrases.set(phrase, new Set());
      f.phrases.get(phrase).add(c.id);
    }
  }
}

const candidates = [];
for (const code of Object.keys(failures).sort()) {
  const f = failures[code];
  if (!existing.has(code)) continue;
  const phrases = [...f.phrases.keys()].filter((p) => !existing.get(code).has(p)).sort();
  const variants = [...f.variants].sort();
  const where = variants
    .map((v) => VARIANT_WORDING[v])
    .filter(Boolean)
    .join(" or ");
  if (phrases.length) {
    candidates.push({
      name: `${code} keywords: ${phrases.join(", ")}`,
      category: code,
      keywords: phrases,
      from: [...f.claims].sort(),
    });
  }
  const sentence = phrases.length
    ? `Mentions such as ${phrases.join(", ")} count${where ? `, also when the request is ${where}` : ""}.`
    : where
      ? `This applies equally when the request is ${where}.`
      : undefined;
  if (sentence) {
    candidates.push({
      name: `${code} description: ${sentence}`,
      category: code,
      description: sentence,
      from: [...f.claims].sort(),
    });
  }
}

writeFileSync("evals/candidates.json", JSON.stringify(candidates, null, 2) + "\n");
for (const [code, f] of Object.entries(failures))
  console.log(
    `${code}: ${f.claims.size} claim(s), variants ${[...f.variants].sort().join(", ")}, phrases ${[...f.phrases.keys()].join(", ") || "none"}`,
  );
console.log(`no semantic category owns: ${unowned.join("; ") || "none"}`);
console.log(`held-out failures (not proposed from): ${heldout.join(", ") || "none"}`);
console.log(`wrote ${candidates.length} candidate(s) to evals/candidates.json`);
