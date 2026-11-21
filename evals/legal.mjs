#!/usr/bin/env node
// Retrieval eval for the legal primitive on the hard question sets (evals/legal/dev.jsonl for tuning,
// heldout.jsonl for the final number): paraphrases with none of the statute's words, two-part questions, Dutch and
// national-law questions, and questions that go from a data category to its rule.
// Each question lists one group of acceptable passage ids per part. Scores, over the lookup tool's own ranking code
// (src/primitives/rank.ts) and corpus/passages.json:
//   recall@3  share of parts with an acceptable passage in the top 3, averaged over questions
//   MRR       1 / rank of the first acceptable passage (top 10), averaged over questions
// Usage: node evals/legal.mjs [--set dev|heldout] [--ranking '<json>'] [--corpus file] [--json] [--verbose]
import { readFileSync } from "node:fs";
import { BASELINE_RANKING, buildIndex } from "../src/primitives/rank.ts";
import { DEFAULT_RANKING } from "../src/primitives/lookup-ranking.ts";

const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i === -1 ? def : process.argv[i + 1];
};
const set = arg("--set", "dev");
const override = arg("--ranking");
const ranking = override ? { ...BASELINE_RANKING, ...JSON.parse(override) } : DEFAULT_RANKING;
const passages = JSON.parse(readFileSync(arg("--corpus", "corpus/passages.json"), "utf8"));
const glossary = JSON.parse(readFileSync("policy/lookup-glossary.json", "utf8")).terms;
const search = buildIndex(passages, ranking, glossary);
const cases = readFileSync(`evals/legal/${set}.jsonl`, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

const rows = cases.map((c) => {
  const top = search(c.q, 10).map((i) => passages[i].id);
  const top3 = top.slice(0, 3);
  const recall = c.want.filter((g) => g.some((id) => top3.includes(id))).length / c.want.length;
  const first = top.findIndex((id) => c.want.some((g) => g.includes(id)));
  return { id: c.id, kind: c.kind, q: c.q, recall, rr: first === -1 ? 0 : 1 / (first + 1), top3 };
});
const mean = (xs) =>
  xs.length ? Math.round((1000 * xs.reduce((a, x) => a + x, 0)) / xs.length) / 1000 : null;
const kinds = [...new Set(rows.map((r) => r.kind))];
const result = {
  set,
  ranking,
  n: rows.length,
  recall_at_3: mean(rows.map((r) => r.recall)),
  mrr: mean(rows.map((r) => r.rr)),
  byKind: Object.fromEntries(
    kinds.map((k) => {
      const rs = rows.filter((r) => r.kind === k);
      return [
        k,
        {
          n: rs.length,
          recall_at_3: mean(rs.map((r) => r.recall)),
          mrr: mean(rs.map((r) => r.rr)),
        },
      ];
    }),
  ),
  rows,
};
if (process.argv.includes("--json")) console.log(JSON.stringify(result, null, 1));
else {
  if (process.argv.includes("--verbose"))
    for (const r of rows)
      console.log(
        `${r.recall === 1 ? "HIT " : r.recall ? "PART" : "MISS"} ${r.id} ${r.q.slice(0, 70).padEnd(70)} ${r.top3.join(", ")}`,
      );
  for (const [k, v] of Object.entries(result.byKind))
    console.log(
      `${k.padEnd(18)} n=${String(v.n).padEnd(3)} recall@3 ${v.recall_at_3}  MRR ${v.mrr}`,
    );
  console.log(
    `${set}: ${rows.length} questions | recall@3 ${result.recall_at_3} | MRR ${result.mrr} | ${JSON.stringify(ranking)}`,
  );
}
