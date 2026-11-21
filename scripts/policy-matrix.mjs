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
      "GDPR Art. 5(1)(c) data minimisation; Art. 25(1) data protection by design (names pseudonymisation); Art. 4(5) pseudonymisation; Recital 26; CJEU C-413/23 P EDPS v SRB paras. 77, 86 (placeholders may make data non-personal for the recipient only), paras. 111-112 (still personal for the insurer)",
    brane: ["PERSON"],
    code: "BRANE replaces names with PERSON_REF tokens and restores them in the answer; the agent is told never to guess a real value behind a token",
    gap: "BRANE cannot tell a claimant from a third party; both are PERSON. A third-party role would allow a stricter rule for people who never agreed to anything. PERSON and ADDRESS detection varies between runs: on 21 November 2026, 02:00-03:22 CET, with the policy unchanged, 'Jan de Vries filed a claim' had no PII detected in 4 of 4 runs at 02:07 and 1 of 4 at 02:10; the E5 prompt (Pieter Jansen, Kerkstraat 14) had none in 15 of 16 runs from 02:00 to 02:03; in the worst-of-5 security run at 03:15 the name reached the cloud payload in T2 2/5, T3 5/5 and E5 5/5. During the same window BRANE labelled a Dutch IBAN IBAN instead of ACCOUNT_NUMBER. A placeholder rule protects only what the detector finds",
    evidence:
      "X-Brane-Action: placeholder | X-Brane-Redacted: true | X-Brane-Placeholder-Types: PERSON",
    tests: "T2 / T3 / E5",
  },
  {
    id: "R2",
    category: "Contact details (email, phone, address, IP)",
    why: "Not needed for any reasoning step in claims handling",
    source: "GDPR Art. 5(1)(c); Art. 25(1)",
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
    source: "GDPR Art. 5(1)(c); Art. 32(1)(a) pseudonymisation as a security measure",
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
      "GDPR Art. 87 (Member States set conditions for national ID numbers); NL UAVG Art. 46 (a number prescribed by law is used only to carry out that law or for purposes set by law); NL Zorgverzekeringswet Art. 86(3) (the health insurer uses the BSN only to make sure data relate to the right insured person)",
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
    tests: "E1",
  },
  {
    id: "R6",
    category: "Health data: diagnoses, treatment, medication, injuries, hospitals and clinics",
    why: "Needed to assess medical claims, so masking would break the task; the data may not leave, so the step runs on the local model",
    source:
      "GDPR Art. 9(1); Art. 9(2)(g) and (h) as used by NL UAVG Art. 30(3)(b) (insurers may process health data needed to perform the insurance) with UAVG Art. 30(4) (only staff bound to secrecy); CJEU C-184/20 operative point 2 (data indirectly revealing a special category fall under Art. 9(1)); Dutch insurers' code of conduct (GVPV 2024) art. 5.1.1(b) and 5.1.3. Keeping health data on the local model goes beyond the legal minimum (a processor whose staff are bound to confidentiality under Art. 28(3)(b) could meet UAVG Art. 30(4)); it avoids a health-data transfer outside the EEA",
    brane: ["HEALTH_DATA"],
    semantic: "CLAIM_HEALTH_CONTEXT",
    code: "BRANE local for HEALTH_DATA, plus semantic category CLAIM_HEALTH_CONTEXT (local) for indirect health detail; the step runs on vllm:deepseek-v4.1-flash inside the perimeter",
    gap: "Built-in HEALTH_DATA missed 'burnout', 'sertraline', 'fractured her wrist' and a hospital name; a semantic category was needed. One request goes local as a whole, so the harness must split a claim into steps to keep the non-health part on the cloud. BRANE has no request-level local-only flag: intake pins its extraction to the local model by asking for an explicit vllm: model id (X-Brane-Local-Cause: explicit_local_model) and checks routed-to=local and a vllm: resolved model before reading the answer. The optional second classifier (src/primitives/classify.ts, switch classifier, off by default) has the same trust: it calls /policy/test with a draft policy in local-only mode with every category allowed, and if BRANE ignored the draft's routing mode the pre-masked text, names included, would reach the cloud and be caught only in the response check",
    evidence:
      "X-Brane-Routed-To: local | X-Brane-Local-Cause: semantic_category_local | X-Brane-Model-Resolved: vllm:deepseek-v4.1-flash",
    tests: "E1 / E2",
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
      "GDPR Art. 22(1); Art. 22(4) (an automated decision may not rest on health data unless Art. 9(2)(a) or (g) applies with safeguards); CJEU C-634/21 SCHUFA (a recommendation the decision-maker draws strongly on can itself be the decision); WP251rev.01 p. 21 (meaningful human involvement). The contract exception, Art. 22(2)(a), could allow some automated decisions (NL GVPV 2024 art. 4.2.2; NL UAVG Art. 40 covers only legal duties and public tasks), so a human decision-maker is our design choice and the safe reading of Art. 22(4), not a bare legal minimum. EU AI Act Arts. 14 and 26(2) as a benchmark; they bind only high-risk systems",
    semantic: "CLAIM_OUTCOME_DECISION",
    code: "BRANE semantic category refuses the request (HTTP 422) and the harness writes a handoff row for it (refusal:<rule>); the agent's request_approval tool hands a recommendation to the claims handler. Either way the handler's Approve, Edit or Reject is a hash-chained human row (POST /audit/human); a decision on a recommendation returns to the conversation through BRANE, a decision on a refusal is never sent to a model",
    target: "HUMAN APPROVAL",
    gap: "BRANE can only refuse; a 'route to human' action would make the handoff part of the policy instead of the agent code",
    evidence:
      "X-Brane-Refused-By: semantic:CLAIM_OUTCOME_DECISION->refuse; audit rows handoff then human (actor = the handler); submission/audit_trail_luggage_claim.csv rows 22 and 25; test/audit.test.ts",
    tests: "E3 / Demo",
  },
  {
    id: "R9",
    category: "Medical or legal judgement on a claim",
    why: "Medical necessity and causality are for the medical adviser; disputed wording and fraud for a legal reviewer",
    source:
      "Dutch insurers' code of conduct (GVPV 2024) art. 5.1.3 (only the medical adviser may process health data to write a medical opinion) and 5.1.5 (everyone processing health data is bound to secrecy); NL UAVG Art. 30(4)",
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
      "GDPR Art. 5(1)(b) purpose limitation and 5(1)(c) minimisation; NL UAVG Art. 30(3)(b) (health data only as far as necessary to perform this insurance); GVPV 2024 art. 5.1.1(b) (health data given for one insurance is not used for another without explicit consent)",
    semantic: "CROSS_CLAIMANT_COMPARISON",
    code: "BRANE semantic category refuses; the harness also keeps one claim per conversation with no shared memory",
    gap: "None observed",
    evidence: "X-Brane-Refused-By: semantic:CROSS_CLAIMANT_COMPARISON->refuse",
    tests: "golden g24",
  },
  {
    id: "R11",
    category: "Selecting claims by ethnicity, origin or a proxy such as surname",
    why: "Discriminatory processing has no lawful basis",
    source:
      "Racial Equality Directive 2000/43/EC Art. 2 (direct and indirect discrimination) and Art. 3(1)(h) (goods and services); EU Charter Art. 21; GDPR Art. 9(1) with CJEU C-184/20 (inferring ethnic origin from a surname is special-category processing); GDPR Recital 71 (prevent discriminatory effects). CJEU C-236/09 Test-Achats covers sex-based differences in insurance only",
    semantic: "PROTECTED_TRAIT_PROFILING",
    code: "BRANE semantic category refuses",
    gap: "None observed",
    evidence:
      "X-Brane-Refused-By: semantic:...->refuse | X-Brane-Semantic-Matches: PROTECTED_TRAIT_PROFILING",
    tests: "E4",
  },
  {
    id: "R12",
    category: "Instructions hidden in claim documents (prompt injection)",
    why: "Text in a claim is content, never an instruction; an override attempt must not change routing",
    source:
      "GDPR Art. 32(1)(b) confidentiality and integrity of processing systems; OWASP LLM01 prompt injection (mitigations 1, 5, 6: constrain model behaviour, human approval for high-risk actions, segregate external content)",
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
    source:
      "GDPR Art. 25(1) and Art. 32(1)(b) (safeguards built into the processing); Art. 44 (a transfer happens only if the Chapter V conditions are met)",
    code: "The harness's only model provider is BRANE; its fetch reaches BRANE's origin only, fails when a response has no X-Brane-Routed-To header, and never retries elsewhere",
    target: "BLOCK",
    gap: "Enforced in agent code; BRANE cannot enforce its own absence",
    evidence:
      "test/brane.test.ts (6 tests: unreachable, 502 or 200 without a routing decision, foreign origin, 422); audit row routedTo=withheld with Local-Cause brane_unreachable or no_brane_decision",
    tests: "T5",
  },
  {
    id: "R15",
    category: "Insurance or health-insurance number of the claimant",
    why: "Used to match the insured inside the insurer's systems; a model never needs it",
    source:
      "GDPR Art. 5(1)(c); Art. 87 and NL Zorgverzekeringswet Art. 86 where the number is the BSN",
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
    source:
      "GDPR Art. 4(1) and Recital 14 (the Regulation does not cover data about legal persons, including their name and contact details); a sole trader's identifiers are personal data",
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
    source: "GDPR Art. 32(1)(b) security of processing",
    brane: ["PASSWORD", "SECRET_KEY"],
    code: "BRANE refuses the request (HTTP 422); the agent tells the user to remove the credential",
    gap: "None observed",
    evidence: "X-Brane-Refused-By: category:PASSWORD->refuse",
    tests: "Edge (credential in claim)",
  },
  {
    id: "R18",
    category: "Record of every automated step (audit log)",
    why: "Each routing decision, masking, intake split, citation and handoff must be traceable after the fact",
    source:
      "GDPR Art. 5(2) accountability (binding now); Art. 30(1) record of processing activities (names recipients and transfers; the per-claim log is evidence for it, not the record itself); EU AI Act Art. 12(1), Art. 19(1), Art. 26(6) (logs kept for at least six months; binding only for high-risk systems, from 2 December 2027 under Art. 113 as amended by Regulation (EU) 2026/1744); EIOPA-BoS-25-360 paras. 3.7 and 3.22-3.24",
    code: "src/audit.ts writes one row per decision to the claim's Durable Object SQLite (categories and ids, never prompt text); shown in the app and exported as CSV; never returned to the model",
    target: "ALLOW",
    gap: "BRANE returns the decision in headers per request but keeps no per-claim record the deployer can export; the harness keeps it",
    evidence: "GET /api/sessions/:id/audit; app Audit log tab; CSV export",
    tests: "All (every test row cites its headers)",
  },
  {
    id: "R19",
    category:
      "Criminal offence data in a claim (police report naming a suspect, arrests, convictions)",
    why: "A suspect's identity and record are not needed to assess a burglary or theft claim; the claim needs only that a report exists",
    source:
      "GDPR Art. 10 (criminal offence data only under official authority or Member State law with safeguards); NL UAVG Art. 31 and Art. 33(2)(a) (an insurer may process such data for its own purposes to assess a request for a performance, such as a claim); GDPR Art. 5(1)(c) (the suspect's identity is not needed, so it stays local)",
    semantic: "CRIMINAL_OFFENCE_DATA",
    code: "BRANE semantic category keeps the turn on the local model; rule contributed by Omar Shalaby (omar/policy/policy_v1.json), measured with his gate test E3",
    gap: "BRANE has no built-in criminal-data category; the same text otherwise leaves with only the name masked",
    evidence: "X-Brane-Semantic-Matches: CRIMINAL_OFFENCE_DATA | X-Brane-Routed-To: local",
    tests: "omar-E3",
  },
  {
    id: "R14",
    category: "Public policy terms and law (no personal data)",
    why: "Needed for coverage reasoning; contains no personal data",
    source:
      "GDPR Art. 4(1) (no information about an identifiable natural person, so not personal data)",
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
