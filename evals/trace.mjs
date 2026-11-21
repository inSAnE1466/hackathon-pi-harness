#!/usr/bin/env node
// Policy-to-source coverage. Does every rule the harness enforces trace to a source a juror can check?
// Units: the 25 built-in categories and every semantic category in policy/brane.json, and every row of
// submission/MAIN_Policy_Matrix.csv. A unit is covered when all three links hold:
//   1. rule      a category is named by a matrix row; a semantic category carries a legalBasis and is named by a row
//   2. verified  that row has a line in docs/legal-verification.md section B with a verdict (a NEEDS REWORDING or
//                WRONG verdict counts only because the line records the fix that was applied)
//   3. passage   at least one provision the row cites is a passage in corpus/passages.json, so the agent's lookup
//                tool can return it and an answer can cite it by id
// It also reports the provision level: of all provisions the matrix rows cite, the share held as passages.
// Usage: node evals/trace.mjs [--json] [--corpus file]
import { readFileSync } from "node:fs";

const policy = JSON.parse(readFileSync("policy/brane.json", "utf8"));
const corpusFile = process.argv.includes("--corpus")
  ? process.argv[process.argv.indexOf("--corpus") + 1]
  : "corpus/passages.json";
const corpus = JSON.parse(readFileSync(corpusFile, "utf8"));
const ids = new Set(corpus.map((p) => p.id));

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
  return rows;
}
const [, ...matrix] = parseCsv(readFileSync("submission/MAIN_Policy_Matrix.csv", "utf8"));
const rules = matrix
  .filter((r) => /^R\d+$/.test(r[0]))
  .map((r) => ({ id: r[0], category: r[1], source: r[3], enforced: r[5] }));

// Section B of the verification: "| R6 | ... | VERIFIED | ...".
const verdicts = {};
for (const line of readFileSync("docs/legal-verification.md", "utf8").split("\n")) {
  const m = /^\|\s*(R\d+)\s*\|.*\|\s*(VERIFIED|NEEDS REWORDING|WRONG)\s*\|\s*(.*?)\s*\|\s*$/.exec(
    line,
  );
  if (m) verdicts[m[1]] = { verdict: m[2], fix: m[3] };
}

/** Corpus passage ids a source cell cites. Bare "Art. N" belongs to the instrument named last. */
export function citedPassages(source) {
  const found = new Set();
  const unresolved = new Set();
  // "GDPR-5(1)(c)" resolves to the paragraph passage "GDPR-5(1)", then to the article, then to its first paragraph.
  const lookFor = (id) => {
    const para = /^(.*?\d+(?:\(\d+\))?)/.exec(id)?.[1];
    const art = /^(.*?\d+(?:\.\d+)*)/.exec(id)?.[1];
    for (const candidate of [id, para, art]) {
      if (candidate && ids.has(candidate)) return found.add(candidate);
    }
    for (const known of ids) if (art && known.startsWith(`${art}(`)) return found.add(known);
    return false;
  };
  const add = (id) => {
    if (lookFor(id)) return;
    // A bare "Art. N" after a national law often returns to the GDPR ("UAVG Art. 30(4) ... under Art. 28(3)"):
    // if the instrument named last has no such article, try the GDPR before calling the citation unresolved.
    const bare = /^(?:UAVG|GVPV|ZVW|BDSG|VVG)-(\d.*)$/.exec(id);
    if (bare && lookFor(`GDPR-${bare[1]}`)) return;
    // One passage can quote several articles of a short instrument ("Directive 2000/43/EC, Art. 2 and Art. 3(1)(h)").
    const quoted = /^(RED-2000\/43-)(\d+\S*)$/.exec(id);
    const holder =
      quoted &&
      corpus.find((p) => p.id.startsWith(quoted[1]) && p.title.includes(`Art. ${quoted[2]}`));
    if (holder) return void found.add(holder.id);
    unresolved.add(id);
  };
  const prefix = {
    GDPR: "GDPR-",
    "AI Act": "AIA-Art",
    UAVG: "UAVG-",
    Zorgverzekeringswet: "ZVW-",
    Zvw: "ZVW-",
    GVPV: "GVPV-",
    BDSG: "BDSG-",
    VVG: "VVG-",
    "Directive 2000/43/EC": "RED-2000/43-",
    Charter: "CHARTER-",
  };
  let instrument = "GDPR";
  const tokens = source.matchAll(
    /(GDPR|AI Act|UAVG|Zorgverzekeringswet|Zvw|GVPV|BDSG|VVG|Directive 2000\/43\/EC|Charter)|Recital (\d+)|C-(\d+\/\d+)\s?(P)?|(WP251)|OWASP (LLM\d+)|(EIOPA)|EDPB (?:Guidelines )?(\d+\/\d+)|(Annex III)|[Aa]rts?\.\s?(\d+(?:\.\d+)*)((?:\(\d+\))?)|§\s?(\d+)/g,
  );
  for (const t of tokens) {
    if (t[1]) instrument = t[1];
    else if (t[2]) add(`GDPR-R${t[2]}`);
    else if (t[3]) add(`CJEU-C-${t[3]}${t[4] ?? ""}`);
    else if (t[5]) add("WP251");
    else if (t[6]) add(`OWASP-${t[6]}`);
    else if (t[7]) add("EIOPA-AI-2025");
    else if (t[8]) add(`EDPB-${t[8]}`);
    else if (t[9]) add("AIA-Annex3(5)");
    else if (t[10]) add(`${prefix[instrument]}${t[10]}${t[11] ?? ""}`);
    else if (t[12]) add(`${prefix[instrument]}${t[12]}`);
  }
  citedPassages.unresolved = [...unresolved];
  return [...found];
}

const ruleFor = (code) =>
  rules.find((r) => new RegExp(`\\b${code}\\b`).test(`${r.enforced} ${r.category}`));
const check = (unit, kind, rule, hasBasis = true) => {
  const passages = rule ? citedPassages(rule.source) : [];
  const unresolved = rule ? citedPassages.unresolved : [];
  const links = {
    rule: Boolean(rule) && hasBasis,
    verified: Boolean(rule && verdicts[rule.id]),
    passage: passages.length > 0,
  };
  return {
    unit,
    kind,
    rule: rule?.id ?? null,
    verdict: rule ? (verdicts[rule.id]?.verdict ?? null) : null,
    passages,
    unresolved,
    links,
    covered: links.rule && links.verified && links.passage,
  };
};
const units = [
  ...Object.keys(policy.categories).map((c) => check(c, "category", ruleFor(c))),
  ...policy.semanticCategories.map((s) =>
    check(s.code, "semantic", ruleFor(s.code), Boolean(s.legalBasis?.trim())),
  ),
  ...rules.map((r) => check(r.id, "matrix row", r)),
];
const covered = units.filter((u) => u.covered).length;
// Provision level, over the matrix rows: of the provisions the rows cite, the share the corpus holds as a passage.
const rowUnits = units.filter((u) => u.kind === "matrix row");
const cited = rowUnits.reduce((n, u) => n + u.passages.length + u.unresolved.length, 0);
const held = rowUnits.reduce((n, u) => n + u.passages.length, 0);
const result = {
  policy: policy.version,
  provisions: { cited, held, coverage: Math.round((1000 * held) / cited) / 10 },
  units: units.length,
  covered,
  coverage: Math.round((1000 * covered) / units.length) / 10,
  missing: units.filter((u) => !u.covered),
  rows: units,
};
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 1));
  else {
    for (const u of units)
      console.log(
        `${u.covered ? "ok  " : "MISS"} ${u.kind.padEnd(10)} ${u.unit.padEnd(26)} ${String(u.rule ?? "-").padEnd(4)} ${String(u.verdict ?? "-").padEnd(15)} ${u.passages.slice(0, 5).join(", ")}${
          u.covered
            ? ""
            : `  missing: ${Object.entries(u.links)
                .filter(([, v]) => !v)
                .map(([k]) => k)
                .join(", ")}`
        }`,
      );
    for (const u of rowUnits.filter((x) => x.unresolved.length))
      console.log(`not in corpus: ${u.unit} cites ${u.unresolved.join(", ")}`);
    console.log(
      `provisions cited by the matrix and held as passages ${held}/${cited} (${result.provisions.coverage}%)`,
    );
    console.log(
      `\npolicy-to-source coverage ${covered}/${units.length} (${result.coverage}%) on ${policy.version}`,
    );
  }
}
