#!/usr/bin/env node
// Autonomous policy climb that stops at a benchmark. Each round: score the live policy (evals/f1.mjs) on the tuning
// set (claims) and the check set (heldout), propose candidate edits to the semantic categories from the tuning set's
// mistakes only, apply each to the live department, and keep it only if the tuning score improves (fewer unsafe
// decisions first, then higher macro F1), the check score does not get worse and the organizers' tests still pass;
// otherwise revert. Stops at the target (unsafe 0 and F1 >= target on both sets), a plateau, or the budget.
// Never scores the locked set: run `node evals/f1.mjs --set=locked --save` once, after the climb.
//
// Proposers: "llm" asks BRANE's local model (nothing leaves the perimeter) for edits; "rules" derives keywords
// from leaked spans and tries dropping keywords that over-block; "both" (default) uses llm, then rules.
//
// Usage: node evals/autoclimb.mjs [--target=0.95] [--rounds=30] [--patience=5] [--minutes=60]
//          [--proposer=both|llm|rules] [--no-organizers] [--dry]
//   --dry proposes and prints candidates without applying anything.
// The live department changes while this runs: do not demo or test against it at the same time.
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";

const arg = (name, def) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1] ?? def;
const TARGET = Number(arg("target", 0.95));
const ROUNDS = Number(arg("rounds", 30));
const PATIENCE = Number(arg("patience", 5));
const DEADLINE = Date.now() + Number(arg("minutes", 60)) * 60_000;
const PROPOSER = arg("proposer", "both");
const ORGANIZERS = !process.argv.includes("--no-organizers");
const DRY = process.argv.includes("--dry");
const POLICY = "policy/brane.json";
const LOG = "evals/autoclimb-log.tsv";
// Tune on Omar's dev split; his val split is only a check that a kept change does not get worse on rows it never
// learned from. His locked test split is never scored here.
const TUNE = "omar-dev";
const CHECK = "omar-val";
const LOCAL_MODEL = arg("model", "vllm:deepseek-v4.1-flash");

const vars = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
if (!vars.BRANE_BASE_URL || !vars.BRANE_API_KEY) {
  console.error("Set BRANE_BASE_URL and BRANE_API_KEY in .dev.vars or the environment.");
  process.exit(2);
}
const base = vars.BRANE_BASE_URL.replace(/\/+$/, "");

const node = (args) => {
  try {
    return execFileSync("node", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 900_000,
    });
  } catch (e) {
    return String(e.stdout ?? "");
  }
};
const apply = () => node(["scripts/brane-policy.mjs", "apply"]);
const organizersOk = () => {
  if (!ORGANIZERS) return true;
  const m = /(\d+)\/(\d+) pass/.exec(node(["scripts/brane-cases.mjs"]));
  return Boolean(m && m[1] === m[2]);
};
function scoreSet(set) {
  const [r] = JSON.parse(node(["evals/f1.mjs", `--set=${set}`, "--json"]) || "[]");
  if (!r) return { unsafe: Infinity, macro: 0, mistakes: [] };
  const cases = Object.fromEntries(
    readFileSync(`evals/golden/${set}.jsonl`, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l))
      .map((c) => [c.id, c]),
  );
  const mistakes = r.rows
    .filter((x) => x.expect !== x.got || x.leaked)
    .map((x) => ({ ...x, text: cases[x.id]?.text ?? "" }));
  return { unsafe: r.unsafe, macro: r.macroF1, mistakes };
}
const score = () => ({ tune: scoreSet(TUNE), check: scoreSet(CHECK) });
const better = (a, b) => a.unsafe < b.unsafe || (a.unsafe === b.unsafe && a.macro > b.macro + 1e-9);
const notWorse = (a, b) => a.unsafe <= b.unsafe && a.macro >= b.macro - 1e-9;
const atTarget = (s) =>
  s.tune.unsafe === 0 && s.check.unsafe === 0 && s.tune.macro >= TARGET && s.check.macro >= TARGET;
const fmt1 = (s) => `unsafe=${s.unsafe} F1=${s.macro.toFixed(3)}`;
const fmt = (s) => `tune ${fmt1(s.tune)} | check ${fmt1(s.check)}`;

function applyCandidate(policy, c) {
  const cat = policy.semanticCategories.find((s) => s.code === c.category);
  if (!cat) return false;
  if (c.keywords?.length) cat.keywords = [...new Set([...(cat.keywords ?? []), ...c.keywords])];
  if (c.removeKeyword) cat.keywords = (cat.keywords ?? []).filter((k) => k !== c.removeKeyword);
  if (c.description) cat.description = `${cat.description} ${c.description}`.trim();
  return true;
}

// Rules proposer: leaked health wording becomes keywords of the health category (never identifiers or names: they
// are case-specific and would only memorise the tuning set); keywords that over-block are tried for removal.
const HEALTH_SPANS = new Set(["HEALTH", "HEALTH_PROVIDER"]);
function rulesProposer(s, policy) {
  const out = [];
  for (const m of s.mistakes) {
    if (m.expect === "local" && m.leakedSpans?.length) {
      const kw = m.leakedSpans
        .map((x) => ({ cat: x.split(":")[0], text: x.split(":").slice(1).join(":").toLowerCase() }))
        .filter((x) => HEALTH_SPANS.has(x.cat) && x.text.length >= 4 && !/\d/.test(x.text))
        .map((x) => x.text);
      if (kw.length)
        out.push({
          name: `keywords from ${m.id}: ${kw.join(", ")}`,
          category: "CLAIM_HEALTH_CONTEXT",
          keywords: kw,
        });
    }
    if (m.expect === "allow" && m.got !== "allow") {
      for (const sc of policy.semanticCategories)
        for (const k of sc.keywords ?? [])
          if (m.text.toLowerCase().includes(k.toLowerCase()))
            out.push({
              name: `drop keyword "${k}" (over-blocks ${m.id})`,
              category: sc.code,
              removeKeyword: k,
            });
    }
  }
  return out;
}

async function llmProposer(s, policy) {
  const examples = s.mistakes
    .filter((m) => m.expect !== "refuse")
    .slice(0, 8)
    .map(
      (m) =>
        `- [${m.id}] expected ${m.expect}, got ${m.got}${m.leaked ? ", leaked" : ""}: ${m.text}`,
    )
    .join("\n");
  if (!examples) return [];
  const cats = policy.semanticCategories.map((c) => ({
    code: c.code,
    description: c.description,
    keywords: c.keywords,
  }));
  const prompt = `You tune a data-protection policy for an insurance claims AI. Semantic categories (JSON):\n${JSON.stringify(cats)}\n\nThese synthetic test requests were routed wrongly:\n${examples}\n\nPropose up to 3 small edits that would fix them without blocking harmless requests. Each edit adds general keywords (not names or amounts) or one clarifying sentence to ONE category. Reply with only a JSON array: [{"name":"short reason","category":"CODE","keywords":["..."],"description":"optional sentence"}]`;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vars.BRANE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: LOCAL_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });
    if (res.headers.get("x-brane-routed-to") && res.headers.get("x-brane-routed-to") !== "local")
      return [];
    if (!res.ok) return [];
    const j = await res.json();
    const text = j.choices?.[0]?.message?.content ?? "";
    const arr = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
    return arr
      .filter((c) => c && typeof c.category === "string")
      .map((c) => ({
        name: `llm: ${c.name ?? "edit"}`,
        category: c.category,
        keywords: c.keywords,
        description: c.description,
      }));
  } catch {
    return [];
  }
}

if (!existsSync(LOG)) writeFileSync(LOG, "at\tround\tcandidate\tbefore\tafter\tverdict\n");
const startPolicy = readFileSync(POLICY, "utf8");
let best = score();
console.log(`start: ${fmt(best)} | target: unsafe 0 and F1 >= ${TARGET} on both sets`);
const tried = new Set();
let stale = 0;
let stop = "budget (rounds)";

for (let round = 1; round <= ROUNDS; round++) {
  if (atTarget(best)) {
    stop = "target reached";
    break;
  }
  if (stale >= PATIENCE) {
    stop = `plateau (${PATIENCE} rounds without a gain)`;
    break;
  }
  if (Date.now() > DEADLINE) {
    stop = "budget (time)";
    break;
  }
  const policy = JSON.parse(readFileSync(POLICY, "utf8"));
  let candidates = [];
  if (PROPOSER !== "rules") candidates.push(...(await llmProposer(best.tune, policy)));
  if (PROPOSER !== "llm") candidates.push(...rulesProposer(best.tune, policy));
  candidates = candidates.filter((c) => !tried.has(JSON.stringify(c)));
  if (!candidates.length) {
    stop = "no new candidates";
    break;
  }
  let gained = false;
  for (const c of candidates.slice(0, 4)) {
    tried.add(JSON.stringify(c));
    if (DRY) {
      console.log(`round ${round} candidate: ${JSON.stringify(c)}`);
      continue;
    }
    const original = readFileSync(POLICY, "utf8");
    const next = JSON.parse(original);
    if (!applyCandidate(next, c)) continue;
    next.version = `${String(next.version).replace(/\+auto\d+$/, "")}+auto${round}`;
    writeFileSync(POLICY, JSON.stringify(next, null, 2) + "\n");
    apply();
    const after = score();
    const keep =
      better(after.tune, best.tune) && notWorse(after.check, best.check) && organizersOk();
    if (!keep) {
      writeFileSync(POLICY, original);
      apply();
    }
    appendFileSync(
      LOG,
      `${new Date().toISOString()}\t${round}\t${c.name}\t${fmt(best)}\t${fmt(after)}\t${keep ? "kept" : "reverted"}\n`,
    );
    console.log(`round ${round} ${keep ? "kept    " : "reverted"} ${c.name} -> ${fmt(after)}`);
    if (keep) {
      best = after;
      gained = true;
      break;
    }
  }
  if (DRY) {
    stop = "dry run";
    break;
  }
  stale = gained ? 0 : stale + 1;
}
if (atTarget(best) && stop.startsWith("budget")) stop = "target reached";
console.log(`\nstopped: ${stop}\nfinal: ${fmt(best)}`);
console.log(
  readFileSync(POLICY, "utf8") === startPolicy
    ? "policy unchanged"
    : `policy changed: review ${POLICY} (git diff) before committing`,
);
console.log(
  "next: read the diff, then score the locked set once: node evals/f1.mjs --set=locked --save",
);
