#!/usr/bin/env node
// Write submission/MAIN_Policy_Matrix.csv in the organizers' template columns, from policy/brane.json, the
// harness's own rules, and the sources each rule rests on. Run after changing the policy:
//   node scripts/policy-matrix.mjs
import { readFileSync, writeFileSync } from "node:fs";

const policy = JSON.parse(readFileSync("policy/brane.json", "utf8"));
const decision = { allow: "ALLOW", placeholder: "PROTECT", local: "LOCAL ONLY", refuse: "BLOCK" };

// One row per use-case data category or decision, in the template's order of columns.
const rows = [
  {
    id: "R1",
    category: "Claimant and third-party names (policyholder, witness, other driver)",
    why: "Not needed to check completeness, extract amounts or match policy terms; needed only by the handler, who sees the real name after rehydration",
    source:
      "GDPR Art. 5(1)(c) data minimisation; Art. 25 data protection by design; Art. 4(5) pseudonymisation; CJEU C-413/23 P EDPS v SRB",
    brane: ["PERSON"],
    code: "BRANE replaces names with PERSON_REF tokens and restores them in the answer; the agent is told never to guess a real value behind a token",
    gap: "BRANE cannot tell a claimant from a third party; both are PERSON. A third-party role would allow a stricter rule for people who never agreed to anything",
    evidence:
      "X-Brane-Action: placeholder | X-Brane-Redacted: true | X-Brane-Placeholder-Types: PERSON",
    tests: "T2 / T3 / E5",
  },
  {
    id: "R2",
    category: "Contact details (email, phone, address, IP)",
    why: "Not needed for any reasoning step in claims handling",
    source: "GDPR Art. 5(1)(c); Art. 25",
    brane: ["EMAIL", "PHONE", "ADDRESS", "IP_ADDRESS"],
    code: "BRANE placeholder before the cloud call",
    gap: "None observed in tests",
    evidence: "X-Brane-Placeholder-Types: EMAIL,PHONE,ADDRESS",
    tests: "T2 / T3 / E5",
  },
  {
    id: "R3",
    category: "Bank details (IBAN, account and card numbers)",
    why: "Needed only for payment after the handler approves, which happens outside the model",
    source: "GDPR Art. 5(1)(c); Art. 32 security of processing",
    brane: ["IBAN", "ACCOUNT_NUMBER", "CREDIT_CARD"],
    code: "BRANE placeholder; IBAN and ACCOUNT_NUMBER set alike because BRANE labeled a Dutch IBAN as ACCOUNT_NUMBER",
    gap: "A Dutch IBAN, a BSN and a passport number were all detected as ACCOUNT_NUMBER, so one rule had to cover all three",
    evidence: "X-Brane-Pii-Types: ACCOUNT_NUMBER | X-Brane-Redacted: true",
    tests: "T2 / T4",
  },
  {
    id: "R4",
    category: "National identifiers (BSN, passport, tax number)",
    why: "Used only to match the insured inside the insurer's systems; never needed by a model",
    source:
      "GDPR Art. 87; national rule that a national ID number is used only for purposes set by law (e.g. NL UAVG Art. 46)",
    brane: ["SSN", "PASSPORT", "TAX_NUMBER"],
    code: "BRANE local; plus our gate (src/primitives/detect.ts) masks BSNs (11-proof), passport, policy and claim numbers in every request body before BRANE, because BRANE labeled them ACCOUNT_NUMBER or PERSON",
    gap: "BRANE detected a valid BSN and a passport number as ACCOUNT_NUMBER and a policy number as PERSON (partly masked); a national-ID detector per country would close this inside BRANE",
    evidence: "Decision log row kind=masked detail=BSN,POLICY_ID,CLAIM_ID; evals/decision-log.md",
    tests: "E-golden g13 / g14",
  },
  {
    id: "R5",
    category: "Date of birth",
    why: "Only an age band can matter for coverage; the exact date identifies the person",
    source: "GDPR Art. 5(1)(c)",
    brane: ["DATE_OF_BIRTH"],
    code: "BRANE placeholder",
    gap: "BRANE cannot generalise a date to an age band; it can only mask or keep it",
    evidence: "X-Brane-Pii-Types: DATE_OF_BIRTH",
    tests: "T5",
  },
  {
    id: "R6",
    category: "Health data: diagnoses, treatment, medication, injuries, hospitals and clinics",
    why: "Needed to assess medical claims, so masking would break the task; the data may not leave, so the step runs on the local model",
    source:
      "GDPR Art. 9(1) and 9(2)(h), 9(3); CJEU C-184/20 (data indirectly revealing health is health data); Dutch insurers' code of conduct 5.1.1 and 5.1.3",
    brane: ["HEALTH_DATA"],
    semantic: "CLAIM_HEALTH_CONTEXT",
    code: "BRANE local for HEALTH_DATA, plus semantic category CLAIM_HEALTH_CONTEXT (local) for indirect health detail; the step runs on vllm:deepseek-v4.1-flash inside the perimeter",
    gap: "Built-in HEALTH_DATA missed 'burnout', 'sertraline', 'fractured her wrist' and a hospital name; a semantic category was needed. One request goes local as a whole, so the harness must split a claim into steps to keep the non-health part on the cloud",
    evidence:
      "X-Brane-Routed-To: local | X-Brane-Local-Cause: semantic_category_local | X-Brane-Model-Resolved: vllm:deepseek-v4.1-flash",
    tests: "T5 / E1",
  },
  {
    id: "R7",
    category:
      "Other special categories (ethnic origin, religion, politics, sexual orientation, trade union)",
    why: "Never needed to assess a claim",
    source: "GDPR Art. 9(1)",
    brane: [
      "ETHNIC_ORIGIN",
      "RELIGIOUS_BELIEF",
      "POLITICAL_OPINION",
      "SEXUAL_ORIENTATION",
      "TRADE_UNION",
      "SENSITIVE_CONTEXT",
    ],
    code: "BRANE local; sensitivity 'standard' (0.50) because at 'high' (0.40) the word 'Dutch' was detected as ETHNIC_ORIGIN and a harmless question went local",
    gap: "A per-category threshold would let us keep high recall for health while avoiding false ethnic-origin hits",
    evidence: "evals/decision-log.md claims-v1 vs claims-v2",
    tests: "T1",
  },
  {
    id: "R8",
    category: "Final claim decision (pay, reduce, reject, flag fraud, cancel)",
    why: "A decision with legal or similarly significant effect on the insured; the agent prepares, a person decides",
    source:
      "GDPR Art. 22; CJEU C-634/21 SCHUFA; national exceptions to Art. 22(1) do not cover a private insurer (e.g. NL UAVG Art. 40); EU AI Act Art. 14; WP251rev.01",
    semantic: "CLAIM_OUTCOME_DECISION",
    code: "BRANE semantic category refuses the request (HTTP 422); the agent's request_approval tool hands the recommendation to the claims handler, who decides",
    target: "HUMAN APPROVAL",
    gap: "BRANE can only refuse; a 'route to human' action would make the handoff part of the policy instead of the agent code",
    evidence:
      "X-Brane-Refused-By: semantic:CLAIM_OUTCOME_DECISION->refuse; decision log kind=handoff",
    tests: "E2 / Demo",
  },
  {
    id: "R9",
    category: "Medical or legal judgement on a claim",
    why: "Medical necessity and causality are for the medical adviser; disputed wording and fraud for a legal reviewer",
    source:
      "Dutch insurers' code of conduct 5.1.3 (only the medical adviser writes a medical opinion); GDPR Art. 9(3)",
    code: "Agent consult tool sends a minimised case to the medical adviser or legal reviewer; logged as kind=handoff",
    target: "HUMAN APPROVAL",
    gap: "Handled in agent code; BRANE has no concept of an expert role",
    evidence: "Decision log row kind=handoff detail=consult:medical",
    tests: "Demo",
  },
  {
    id: "R10",
    category: "Comparing or ranking several claimants",
    why: "Purpose limitation: each claim is assessed on its own; combining claimants' health data serves no claim",
    source:
      "GDPR Art. 5(1)(b) purpose limitation and 5(1)(c); insurers' code of conduct 5.1.1 (no reuse across policies)",
    semantic: "CROSS_CLAIMANT_COMPARISON",
    code: "BRANE semantic category refuses; the harness also keeps one claim per conversation with no shared memory",
    gap: "None observed",
    evidence: "X-Brane-Refused-By: semantic:CROSS_CLAIMANT_COMPARISON->refuse",
    tests: "E4",
  },
  {
    id: "R11",
    category: "Selecting claims by ethnicity, origin or a proxy such as surname",
    why: "Discriminatory processing has no lawful basis",
    source: "GDPR Art. 9(1); EU Charter of Fundamental Rights Art. 21; CJEU C-236/09 Test-Achats",
    semantic: "PROTECTED_TRAIT_PROFILING",
    code: "BRANE semantic category refuses",
    gap: "None observed",
    evidence:
      "X-Brane-Refused-By: semantic:...->refuse | X-Brane-Semantic-Matches: PROTECTED_TRAIT_PROFILING",
    tests: "E3",
  },
  {
    id: "R12",
    category: "Instructions hidden in claim documents (prompt injection)",
    why: "Text in a claim is content, never an instruction; an override attempt must not change routing",
    source: "GDPR Art. 32 security of processing; OWASP LLM01 prompt injection",
    semantic: "RULE_OVERRIDE_ATTEMPT",
    code: "BRANE semantic category refuses; BRANE's own injection score; the route is decided by policy, never by the model",
    gap: "None observed",
    evidence: "X-Brane-Refused-By: semantic:RULE_OVERRIDE_ATTEMPT->refuse",
    tests: "T4",
  },
  {
    id: "R13",
    category: "BRANE unavailable or unverifiable",
    why: "No transfer may happen without a verified check",
    source: "GDPR Art. 32; Art. 25",
    code: "The harness's only model provider is BRANE; its fetch reaches BRANE's origin only, fails when a response has no X-Brane-Routed-To header, and never retries elsewhere",
    target: "BLOCK",
    gap: "Enforced in agent code; BRANE cannot enforce its own absence",
    evidence: "src/brane.ts braneFetch; decision log row with status 0 when no decision",
    tests: "T5 (check failure)",
  },
  {
    id: "R15",
    category: "Insurance or health-insurance number of the claimant",
    why: "Used to match the insured inside the insurer's systems; a model never needs it",
    source: "GDPR Art. 5(1)(c); Art. 87 where the number is a national identifier",
    brane: ["INSURANCE_NUMBER"],
    code: "BRANE placeholder; the gate also masks policy and claim numbers (POL-, CLM-) that BRANE labels PERSON",
    gap: "BRANE's regex for INSURANCE_NUMBER did not match this insurer's policy number format; a custom identifier pattern per tenant would close it",
    evidence:
      "X-Brane-Placeholder-Types: INSURANCE_NUMBER; decision log kind=masked detail=POLICY_ID",
    tests: "T2",
  },
  {
    id: "R16",
    category:
      "Company identifiers of providers and garages (company name, trade register, VAT number)",
    why: "Needed to check that an invoice comes from a real provider; company data is not personal data",
    source: "GDPR Art. 4(1) (legal persons are not data subjects); Recital 14",
    brane: ["ORG", "TRADE_REGISTER", "VAT_ID"],
    code: "Sent as typed so the agent can match invoices to providers",
    target: "ALLOW",
    gap: "A sole trader's VAT or trade-register number can identify a natural person; BRANE has one rule per category and cannot tell a company from a sole trader",
    evidence: "X-Brane-Allowed-Types: ORG",
    tests: "T1",
  },
  {
    id: "R17",
    category: "Credentials pasted into a claim (passwords, API keys)",
    why: "Never needed; a credential in a prompt is a security incident",
    source: "GDPR Art. 32 security of processing",
    brane: ["PASSWORD", "SECRET_KEY"],
    code: "BRANE refuses the request (HTTP 422); the agent tells the user to remove the credential",
    gap: "None observed",
    evidence: "X-Brane-Refused-By: category:PASSWORD->refuse",
    tests: "Edge (credential in claim)",
  },
  {
    id: "R14",
    category: "Public policy terms and law (no personal data)",
    why: "Needed for coverage reasoning; contains no personal data",
    source: "GDPR Art. 4(1) (not personal data)",
    brane: ["ORG"],
    code: "Sent as typed; the lookup tool cites passage ids from the bundled corpus",
    target: "ALLOW",
    gap: "None",
    evidence: "X-Brane-Routed-To: cloud | X-Brane-Action: allow",
    tests: "T1",
  },
];

const header = [
  "Rule ID",
  "Use-case data category",
  "Why needed (or not needed) for task",
  "Legal or governance source (Article / Guideline)",
  "Target decision: ALLOW / PROTECT / LOCAL ONLY / BLOCK / HUMAN APPROVAL",
  "How enforced in BRANE AIF + Agent code today",
  "Product gap note (what finer rule you wished BRANE had per-category)",
  "Evidence captured (X-Brane-* headers / UI step)",
  "Linked Test IDs",
];

const semantic = Object.fromEntries(policy.semanticCategories.map((s) => [s.code, s.action]));
const out = rows.map((r) => {
  const actions = [
    ...(r.brane ?? []).map((c) => policy.categories[c]),
    ...(r.semantic ? [semantic[r.semantic]] : []),
  ];
  const strictest = ["refuse", "local", "placeholder", "allow"].find((a) => actions.includes(a));
  const target = r.target ?? decision[strictest];
  const configured = [
    ...(r.brane ?? []).map((c) => `${c}=${policy.categories[c]}`),
    ...(r.semantic ? [`semantic ${r.semantic}=${semantic[r.semantic]}`] : []),
  ].join(", ");
  return [
    r.id,
    r.category,
    r.why,
    r.source,
    target,
    configured ? `${configured} (policy ${policy.version}). ${r.code}` : r.code,
    r.gap,
    r.evidence,
    r.tests,
  ];
});

const csv =
  [header, ...out]
    .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
    .join("\n") + "\n";
writeFileSync("submission/MAIN_Policy_Matrix.csv", csv);
console.log(
  `wrote submission/MAIN_Policy_Matrix.csv: ${out.length} rules from policy ${policy.version}`,
);
