#!/usr/bin/env node
// Retrieval eval for the lookup tool: does a claims question find the passage that answers it?
// Each case lists acceptable passage ids; a case passes when one of them is in the top K. The lookup tool's own ranking
// (src/primitives/rank.ts with DEFAULT_RANKING), run over corpus/passages.json. The harder sets are in evals/legal.mjs. Usage: node evals/retrieval.mjs [K]
import { readFileSync } from "node:fs";
import { DEFAULT_RANKING } from "../src/primitives/lookup-ranking.ts";
import { buildIndex } from "../src/primitives/rank.ts";

const K = Number(process.argv[2] ?? 3);
const passages = JSON.parse(readFileSync("corpus/passages.json", "utf8"));
const glossary = JSON.parse(readFileSync("policy/lookup-glossary.json", "utf8")).terms;
const ranked = buildIndex(passages, DEFAULT_RANKING, glossary);
const search = (q) => ranked(q, K).map((i) => passages[i].id);

// Questions the claims agent asks while reconciling a claim, with the passages that answer them.
const cases = [
  ["physiotherapy sessions covered after knee surgery", ["POL-2.2", "MED-3"]],
  ["emergency care abroad ambulance", ["MED-4", "POL-3.1"]],
  ["lost luggage airline report", ["POL-3.2", "MED-10"]],
  ["medical necessity test", ["MED-1"]],
  ["documents needed for a medical claim", ["MED-2", "POL-4.1"]],
  ["incident date and treatment do not match", ["MED-5"]],
  ["psychologist sessions referral", ["POL-2.4", "MED-6"]],
  ["hearing aids prescription limit", ["POL-2.5", "MED-7"]],
  ["invoice much higher than usual charge", ["MED-8"]],
  ["own risk deductible", ["POL-2.1"]],
  ["claim deadline", ["POL-4.2"]],
  ["who decides the claim outcome", ["POL-5.1", "MED-9"]],
  [
    "is a DPIA required for health data processing",
    ["METHOD-PRIVACY-TRIAGE", "GDPR-35(1)", "GDPR-35(3)"],
  ],
  [
    "pseudonymised data still personal data",
    ["GDPR-R26", "GDPR-4(5)", "CJEU-C-413/23P", "EDPB-01/2025"],
  ],
  ["right not to be subject to automated decision", ["GDPR-22(1)"]],
  ["health data special category processing prohibited", ["GDPR-9(1)"]],
  ["record keeping logs high-risk AI system", ["AIA-Art12(1)", "AIA-Art12(2)"]],
  ["human oversight of AI system", ["AIA-Art14(1)", "AIA-Art14(4)"]],
  ["life and health insurance risk assessment pricing high-risk", ["AIA-Annex3(5)"]],
  ["national identification number", ["GDPR-87"]],
  [
    "transfer personal data outside the EU safeguards",
    ["GDPR-46(1)", "GDPR-46(2)", "METHOD-TRANSFERS"],
  ],
  ["records of processing activities", ["GDPR-30(1)", "GDPR-30(3)", "GDPR-30(4)", "GDPR-30(5)"]],
];

let pass = 0;
for (const [q, want] of cases) {
  const got = search(q);
  const ok = got.some((id) => want.includes(id));
  if (ok) pass++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${q.padEnd(58)} top${K}: ${got.join(", ")}${ok ? "" : `  (want one of ${want.join(", ")})`}`,
  );
}
console.log(
  `\n${pass}/${cases.length} questions find an answering passage in the top ${K} (${passages.length} passages)`,
);
process.exitCode = pass === cases.length ? 0 : 1;
