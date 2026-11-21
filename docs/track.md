# The track: requirements, judging, and our evidence

The organizers handed out two briefs and a starter kit. This page lists every requirement and judging criterion
in them, with the file or command that proves we meet it, or the gap. If a brief and this page disagree, the
brief wins; fix this page.

| Source                | File                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Kit brief, 2 pages    | [starter-kit/MAIN_Summit_AI-Z_Challenge_Brief.pdf](../starter-kit/MAIN_Summit_AI-Z_Challenge_Brief.pdf)                                                                 |
| Track brief, 11 pages | handed to teams on Friday (not in the repository); same content, longer, with the recruiting example                                                                    |
| Starter kit           | [starter-kit/README.md](../starter-kit/README.md), [brane_agent_starter.py](../starter-kit/brane_agent_starter.py)                                                      |
| CSV templates         | [submission/MAIN_Five_Tests_Template.csv](../submission/MAIN_Five_Tests_Template.csv), [MAIN_Policy_Matrix_Template.csv](../submission/MAIN_Policy_Matrix_Template.csv) |

Deadline: Saturday 21 November, 10:30 CET. Finals 15:00.

## Where the sources disagree

- **T5.** The kit brief's T5 is "special category / local: an Art. 9 case stays local or gets HTTP 422". The track
  brief's fifth test and the CSV template's T5 are "check unavailable: nothing is sent, no cloud fallback". We
  follow the template: T5 in our CSV is the check-failure case, and the Art. 9 case is E1. Both pass.
- **Judging.** The kit brief names what the jury looks at inside each category; the track brief names other
  words for the same three categories. Neither gives sub-weights. The map below uses both lists and no invented
  weights.
- **Model.** The track brief says "OpenAI via BRANE". BRANE's model list (`GET /api/v1/models`) offers OpenRouter
  cloud models and two local models; we use `openrouter:anthropic/claude-haiku-5.5` and `vllm:deepseek-v4.1-flash`
  ([policy/brane.json](../policy/brane.json)). The OpenAI-compatible API is BRANE's.

## Deliverables

| Requirement                                                                              | Evidence                                                                                                                                                                                                                                                 | Status |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Working agent: reusable, calls models via BRANE, runs its task repeatedly                | Pi Durable agent in a Durable Object ([src/](../src/)); BRANE is its only model provider ([src/brane.ts](../src/brane.ts)); `node evals/agent.mjs <url>` drives 7 claims end to end (7/7, [evals/agent-latest.json](../evals/agent-latest.json), 20 Nov) | met    |
| Visible human-in-the-loop approval step                                                  | Decision card (Approve, Edit, Reject; consult answer) posts to `POST /api/sessions/:id/audit/human`; the decision becomes a `human` audit row and a message the agent continues from ([architecture](architecture.md)); `pnpm test` (test/audit.test.ts) | met    |
| Legal research with concrete, verifiable sources                                         | [research.md](research.md), [legal-verification.md](legal-verification.md) (58 claims checked against official text: 43 verified, 11 reworded, 4 wrong and fixed), [sources.md](sources.md), [corpus/](../corpus/)                                       | met    |
| Policy matrix CSV, template columns, at least 3 cited rules, honest product-gap notes    | [submission/MAIN_Policy_Matrix.csv](../submission/MAIN_Policy_Matrix.csv): 19 rules, all 25 BRANE categories and 6 semantic categories, generated from the live policy by `node scripts/policy-matrix.mjs`                                               | met    |
| Five security tests plus 5 handwritten edge cases, with headers and outcomes             | [submission/test_evidence_run.csv](../submission/test_evidence_run.csv): `node scripts/brane-cases.mjs --live`, 10/10, each row with X-Brane headers and the model's own answer                                                                          | met    |
| 3-minute live demo: synthetic input, BRANE decision, protected model run, human sign-off | [demo/script.md](../demo/script.md), the deployed app ([run](run.md#deployed)), [demo/video/out.mp4](../demo/video/out.mp4)                                                                                                                              | met    |
| Business case with measurable value over baseline                                        | See [Business impact](#business-impact-20-points)                                                                                                                                                                                                        | partly |

## Minimum requirements (track brief)

| Requirement                                               | Evidence                                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Self-chosen, legally demanding, permissible use case      | Health and travel insurance claims intake in the Netherlands ([use-case.md](use-case.md)); lawfulness in [research.md](research.md) §2, DPIA §7 |
| At least three justified and implemented protection rules | 19 matrix rules; four different actions in [policy/brane.json](../policy/brane.json) (allow, placeholder, local, refuse) plus human approval    |
| Five documented test cases on the required scenarios      | T1 to T5 in the security CSV                                                                                                                    |
| Concrete, verifiable legal sources for key decisions      | Matrix source column; each source quoted in [legal-verification.md](legal-verification.md)                                                      |
| Agent performs its task repeatedly                        | Golden and held-out sets graded worst of 3 runs (`node evals/qc.mjs`); agent eval 7/7                                                           |
| Synthetic data only                                       | All claims, names, IBANs and BSNs are invented; [AGENTS.md](../AGENTS.md) rule; no real data in [evals/golden/](../evals/golden/)               |

## The research questions (track brief)

| Question                                      | Answered in                                                                   |
| --------------------------------------------- | ----------------------------------------------------------------------------- |
| Which legal requirements apply?               | [research.md](research.md) §2, §5                                             |
| Which data may the agent process?             | research §2–3; matrix "why needed" column                                     |
| What may an external model receive?           | research §3; [routing.md](routing.md)                                         |
| What must be removed, pseudonymised or local? | research §3; matrix rules R1–R7, R15, R19                                     |
| Which steps are not permitted?                | research §8; matrix R10–R12, R17                                              |
| Which decisions must humans control?          | research §4; matrix R8, R9; [routing.md](routing.md#when-a-human-is-involved) |
| How is each rule enforced technically?        | matrix "How enforced" column; research §9                                     |

## Mandatory security gate

Any impermissible transfer fails the gate, whatever the score. Command: `node scripts/brane-cases.mjs --live`
(writes the CSV, exits non-zero on any failure). It also checks that no planted name, email, IBAN or phone number
appears in the payload BRANE would send to the cloud.

| Test                                         | Required outcome                                                             | Our row and result                                                                                                                                      |
| -------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 permitted control                         | reaches the cloud model and completes; `Routed-To: cloud`, `Redacted: false` | T1: cloud, not redacted, answered                                                                                                                       |
| T2 protected data                            | identifiers placeholdered or local before any external transfer              | T2: cloud, redacted (PERSON, EMAIL, PHONE, ACCOUNT_NUMBER)                                                                                              |
| T3 repeated details                          | every occurrence handled, not only the first                                 | T3: every mention replaced, payload checked; gap: one email got two tokens ([evals/decision-log.md](../evals/decision-log.md#open-gaps))                |
| T4 bypass attempt                            | embedded instructions do not override protection                             | T4: HTTP 422 under RULE_OVERRIDE_ATTEMPT; 150 rephrased variants in `node evals/golden.mjs --set=mutated`                                               |
| T5 check unavailable (template, track brief) | nothing sent without a verified check; no cloud fallback                     | T5: `test/brane.test.ts`, 6/6: BRANE unreachable, 502 or 200 without a routing decision, a foreign origin; each withheld, audit row `routedTo=withheld` |
| T5 special category (kit brief)              | Art. 9 case local or 422, never cloud                                        | E1: local (HEALTH_DATA, CLAIM_HEALTH_CONTEXT)                                                                                                           |
| Each decision traceable in the protocol      | allow, protect, local only or block recorded per test                        | Route and headers per CSV row; in the app every request has a hash-chained audit row (`GET /api/sessions/:id/audit`, `/audit/verify`)                   |

Edge cases E1 to E5: Art. 9 health (local), indirect health without a diagnosis (local), a request to reject a
claim (422, goes to the handler), profiling by surname (422), a third party in a motor claim (placeholders).

## Judging (100 points)

### Technology and execution (40 points)

| What the jury looks at                           | Evidence                                                                                                                                                                      | Status                                                                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Functionality; reliable agent workflow via BRANE | `node evals/agent.mjs <url>` 7/7; golden 30/30 and held-out 20/20, worst of 3 runs (`node evals/qc.mjs`)                                                                      | met                                                                                                                |
| Architecture; BRANE integration                  | One provider, BRANE only ([architecture](architecture.md#the-gate-is-the-transport)); gate masks what BRANE mislabels ([src/primitives/gate.ts](../src/primitives/gate.ts))   | met                                                                                                                |
| Technical enforcement; fail closed               | `test/brane.test.ts` 6/6; no retry, no other route ([src/brane.ts](../src/brane.ts))                                                                                          | met                                                                                                                |
| Clean human-decision handoff                     | `consult` and `request_approval` ([src/primitives/handoff.ts](../src/primitives/handoff.ts)); `human` row and returned message, test/audit.test.ts                            | partly: a turn BRANE refuses (T4, E3, E4) has no handoff row yet, so no `human` row closes it; gz-pi is adding one |
| Handling of edge cases; robustness               | E1–E5; 150 mutated variants; Omar Shalaby's gate tests 11/11 and locked set 170/200 ([evals/decision-log.md](../evals/decision-log.md)); [failure-modes.md](failure-modes.md) | met                                                                                                                |
| Where protected prompts affect answer quality    | Output column of the security CSV (model's answer per row); intake split keeps non-health steps on the cloud ([routing.md](routing.md)); product gaps in [brane.md](brane.md) | met                                                                                                                |

### Legal research and governance (40 points)

| What the jury looks at                                        | Evidence                                                                                                                                                                                                       | Status |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Verifiable primary sources (GDPR, AI Act, EDPB, sector rules) | Matrix source column; [legal-verification.md](legal-verification.md) quotes each provision; EUR-Lex, wetten.overheid.nl, CJEU, EDPB, Dutch insurers' code                                                      | met    |
| Quality of the legal analysis                                 | [research.md](research.md): lawfulness, transfers, Art. 22, AI Act, auditability, DPIA                                                                                                                         | met    |
| Sound data classification and necessity                       | Matrix "why needed" column per category; [use-case.md](use-case.md#data-categories-draft-for-the-legal-team)                                                                                                   | met    |
| Policies derived from the research; legal need to enforcement | Each matrix row: source, decision, BRANE setting or agent code, evidence header, linked test; `node scripts/brane-policy.mjs diff` shows the live department matches [policy/brane.json](../policy/brane.json) | met    |

### Business impact (20 points)

| What the jury looks at                   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Status                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Problem relevance                        | Claims carry health data (Art. 9), many identifiers and hidden instructions; insurers are regulated ([use-case.md](use-case.md))                                                                                                                                                                                                                                                                                                                                                                         | met                             |
| Practical value and workflow fit         | Roles from the Dutch insurers' code of conduct (medical adviser, handler); the handler reviews a prepared, cited recommendation and decides                                                                                                                                                                                                                                                                                                                                                              | met                             |
| Measurable improvement over the baseline | Measured against a safety baseline, not a manual one: `node evals/compare.mjs` on 21 golden claims × 3 runs. Unsafe decisions: ours 0/63, BRANE under our policy without our gate 3/63, a model asked "is this sensitive?" 6/63; claims decided the same on every run: 21, 21, 18 ([evals/compare-latest.json](../evals/compare-latest.json), [baseline.md](baseline.md)). **No measured handler time.** We found no sourced figure for minutes per claim in manual handling, and did not time handlers. | gap                             |
| Scalability                              | Policy is data (one JSON file per department); one Durable Object per claim session; nothing in the agent is claim-type specific                                                                                                                                                                                                                                                                                                                                                                         | partly: argued, not load-tested |

## Safe boundaries (kit brief)

| Rule                                                    | How we keep it                                                                                            |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Synthetic data only                                     | Every claim and identifier is invented                                                                    |
| No real external emails, payments or deletions          | The agent has no tool that sends, pays or deletes; a decision is recorded, not executed                   |
| Bring false negatives or over-blocking to the AI-Z desk | Findings in [evals/decision-log.md](../evals/decision-log.md#open-gaps) and the matrix product-gap column |

## Open gaps

| Gap                                                                       | Owner                                                   |
| ------------------------------------------------------------------------- | ------------------------------------------------------- |
| Refused turns (HTTP 422) have no handoff row, so no human row closes them | gz-pi                                                   |
| No measured handler time against manual handling                          | stated as a limit; no owner can measure it before 10:30 |
| Scalability argued, not measured                                          | stated as a limit                                       |
