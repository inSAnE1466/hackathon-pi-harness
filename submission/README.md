# Team Gezira: AI-Z Challenge Track submission

A claims assistant for an EU health and travel insurer. It prepares each claim up to a human decision, sends every
model request through BRANE, and keeps health data on the local model. The claims handler decides. The decision goes
back into the chat, where the agent continues from it, and into the audit trail as a hash-chained human row.
Synthetic data only.

This page is the index of the four submissions and of the evidence for each expectation in the brief
([starter-kit/MAIN_Summit_AI-Z_Challenge_Brief.pdf](../starter-kit/MAIN_Summit_AI-Z_Challenge_Brief.pdf)). The full
map of every requirement and judging criterion, with gaps, is [docs/track.md](../docs/track.md).

## The four submissions

| Submission        | What to open                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pitch video       | [demo/video/out.mp4](../demo/video/out.mp4) (about 2.5 minutes); narration [demo/narration.md](../demo/narration.md); 3-minute live demo script [demo/script.md](../demo/script.md); deck [demo/deck/deck.pdf](../demo/deck/deck.pdf)                                                                                                                                                                                                                                                                              |
| Code              | The agent in [src/](../src/); the BRANE policy [policy/brane.json](../policy/brane.json); the pre-mask that runs before BRANE [src/primitives/detect.ts](../src/primitives/detect.ts) and [gate.ts](../src/primitives/gate.ts); the second classifier [src/primitives/classify.ts](../src/primitives/classify.ts) with [policy/classifier.json](../policy/classifier.json); the evals in [evals/](../evals/) ([docs/evals.md](../docs/evals.md)); how to run it: [docs/run.md](../docs/run.md) |
| GitHub repository | https://github.com/inSAnE1466/hackathon-pi-harness; live app https://claims-harness.fred-755.workers.dev (password in the submission form)                                                                                                                                                                                                                                                                                                                                                                         |
| Test proof        | Security tests [test_evidence_run.csv](test_evidence_run.csv) (T1 to T5, E1 to E5); policy matrix [MAIN_Policy_Matrix.csv](MAIN_Policy_Matrix.csv) (19 cited rules); one claim's exported audit trail with both human decisions [audit_trail_luggage_claim.csv](audit_trail_luggage_claim.csv); the hill-climb summary [evals/climb-summary.json](../evals/climb-summary.json) (how it is built: [docs/evals.md](../docs/evals.md)); BRANE findings and every kept or rejected change in [evals/decision-log.md](../evals/decision-log.md) |

Both CSVs keep the exact columns of the organizers' templates (`MAIN_Five_Tests_Template.csv`,
`MAIN_Policy_Matrix_Template.csv` in the starter kit).

## What the brief asks us to deliver

| Box in "What You Deliver"                                                                                                                                              | Evidence                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Working AI agent: a reusable application calling models via BRANE with a visible human-in-the-loop approval step                                                       | Pi Durable agent in a Cloudflare Durable Object ([src/](../src/)); BRANE is its only model route ([src/brane.ts](../src/brane.ts)); each claim ends in the handler's Approve, Edit or Reject card ([The human in the loop](#the-human-in-the-loop)); live app above                                                            |
| Legal policy matrix (CSV): at least 3 cited rules mapping legal sources to technical enforcement, with honest notes where the ideal rule exceeds the platform switches | [MAIN_Policy_Matrix.csv](MAIN_Policy_Matrix.csv): 19 rules covering all 25 BRANE categories, each with source, decision, enforcement, product-gap note, evidence header and linked tests; generated from the live policy by `node scripts/policy-matrix.mjs`                                                                   |
| Five security checks plus edge cases (CSV): headers and outcomes for T1 to T5 plus 5 handwritten domain edge cases                                                    | [test_evidence_run.csv](test_evidence_run.csv), written by `node scripts/brane-cases.mjs --live`: each case 5 times in sequence, worst of 5, the gate's masking applied first and every protected value checked in the cloud payload; each row has the X-Brane headers and the model's answer                                  |
| 3-minute live demo and business case: synthetic input to BRANE decision, protected model run, human sign-off, measurable value over baseline                          | [demo/script.md](../demo/script.md), the live app, [demo/video/out.mp4](../demo/video/out.mp4); value over a safety baseline in [docs/baseline.md](../docs/baseline.md) (`node evals/compare.mjs`): on 21 claims run 3 times, 0 unsafe decisions in 63 with our policy and gate, 3 under BRANE without the gate, 6 for a model asked whether each claim is sensitive. No handler time measured |

## Each expectation, its proof and its result

| Expectation                                         | File or command that proves it                                                                                                                                                                                                         | Result                                                                                                                                                                                                       |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The task is completed                               | `node evals/agent.mjs <url>` drives 7 claims end to end on the deployed app ([evals/agent-latest.json](../evals/agent-latest.json)); [audit_trail_luggage_claim.csv](audit_trail_luggage_claim.csv) is one full claim                 | 7/7 (20 Nov); the luggage claim ends with the handler's approval (human row 25), chain verified                                                                                                              |
| Data categories are handled correctly               | [docs/use-case.md](../docs/use-case.md#data-categories-draft-for-the-legal-team), [policy/brane.json](../policy/brane.json), matrix "why needed" column; `node evals/golden.mjs` and `node evals/qc.mjs` (worst of 3 runs)          | Golden 30/30, held-out 20/20, 0 health spans leaked (claims-v6, [evals/decision-log.md](../evals/decision-log.md))                                                                                           |
| Impermissible transfers are prevented               | [test_evidence_run.csv](test_evidence_run.csv); `pnpm test` (test/brane.test.ts, test/detect.test.ts)                                                                                                                                  | Run of 03:15 CET: 7/10. T2, T3 and E5 failed on runs where BRANE did not detect a name or street address; the pre-mask for names and streets in detect.ts landed after that run. See [the gate](#mandatory-security-gate) |
| Rules hold when inputs change                       | 150 adversarial rewrites (`node evals/golden.mjs --set=mutated`, [evals/mutate.mjs](../evals/mutate.mjs)); Omar Shalaby's locked set (`--set=omar-test`); [docs/failure-modes.md](../docs/failure-modes.md)                         | Mutated set 0 to 6 of 265 spans leaked between runs; locked set 170/200 (claims-v6); BRANE's own variance is logged in [evals/decision-log.md](../evals/decision-log.md#open-gaps)                            |
| A permissible, legally demanding use case           | [docs/use-case.md](../docs/use-case.md); lawfulness and DPIA in [docs/research.md](../docs/research.md)                                                                                                                                | Health and travel claims intake at a Dutch insurer: Art. 9 health data, identifiers, Art. 22 limits                                                                                                          |
| At least three protection rules                     | [MAIN_Policy_Matrix.csv](MAIN_Policy_Matrix.csv); [policy/brane.json](../policy/brane.json); `node scripts/brane-policy.mjs diff` shows the live department matches the file                                                          | 19 rules; four actions in use (allow, placeholder, local, refuse) plus human approval                                                                                                                        |
| Verifiable legal sources                            | Matrix source column; [docs/legal-verification.md](../docs/legal-verification.md) quotes the official text per claim; [corpus/](../corpus/) holds 219 EUR-Lex passages with CELEX, link and hash                                     | 58 claims checked: 43 verified, 15 corrected                                                                                                                                                                 |
| Works repeatedly                                    | Every eval scores worst of N runs (`node evals/qc.mjs`, worst of 3; security CSV, worst of 5)                                                                                                                                          | Golden and held-out pass worst of 3; every claim decided the same way on all 3 runs (21/21) in `evals/compare.mjs`                                                                                          |
| Every decision is traceable                         | Per-claim audit log: `GET /api/sessions/:id/audit` (CSV with `?format=csv`), `GET /audit/verify` recomputes the SHA-256 chain ([src/audit.ts](../src/audit.ts)); route and headers per row of the security CSV                      | [audit_trail_luggage_claim.csv](audit_trail_luggage_claim.csv): 28 rows, two human rows, chain verified                                                                                                      |
| Five test cases on the required scenarios           | [test_evidence_run.csv](test_evidence_run.csv) T1 to T5                                                                                                                                                                                | T1, T4, T5 pass; T2, T3 failed in the 03:15 run (see the gate)                                                                                                                                               |
| Synthetic data only                                 | Generators and hand-written sets in [evals/golden/](../evals/golden/) and [omar/data/](../omar/data/); every email is on an `example.*` domain                                                                                       | No real person, document or credential in the repository                                                                                                                                                     |

## Mandatory security gate

| Test                                            | Required outcome                                                                  | Our result (live, policy claims-v6.1, run of 03:15 CET, worst of 5)                                                                                                                      |
| ----------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1 permitted control                            | reaches the external model, `X-Brane-Routed-To: cloud`, `X-Brane-Redacted: false` | Pass: cloud, not redacted                                                                                                                                                                |
| T2 protected data                               | identifiers placeholdered or kept local before external transfer                  | Fail (3/5 runs pass): email, phone and IBAN placeholdered every run; on 2 runs BRANE did not detect the name, which reached the cloud payload                                            |
| T3 repeated details                             | every occurrence handled consistently                                             | Fail (0/5): emails and phones replaced at every mention; BRANE did not detect the name, so both forms of it stayed                                                                      |
| T4 bypass attempt                               | embedded instructions do not override protection                                  | Pass: refused (HTTP 422, RULE_OVERRIDE_ATTEMPT)                                                                                                                                          |
| T5 special category (kit brief)                 | Art. 9 case kept local or refused, never cloud                                    | Pass, as our E1: local (HEALTH_DATA, CLAIM_HEALTH_CONTEXT)                                                                                                                              |
| T5 check unavailable (template and track brief) | nothing sent without a verified check; no cloud fallback                          | Pass: `test/brane.test.ts` 6/6 (BRANE unreachable, 502 or 200 without a routing decision, foreign origin): each request is withheld, the audit log records `withheld`, nothing is sent |

From about 02:00 CET on 21 November, with our policy unchanged, BRANE found names and street addresses on some runs
and not others. A placeholder rule protects only what the detector finds. Measured counts and times are in matrix
rule R1 and [evals/decision-log.md](../evals/decision-log.md#open-gaps). Earlier single runs passed 10/10; we report
worst of 5 because one leak fails the test.

## The human in the loop

The agent never decides a claim. It ends each one with a handoff: `consult` asks the medical adviser or the legal
reviewer, `request_approval` asks the claims handler. The handler's Approve, Edit or Reject (or the adviser's answer)
is posted to `POST /api/sessions/:id/audit/human` ([src/session.ts](../src/session.ts)). That writes:

1. a `human` audit row with the person as actor, the handoff it answers, the decision and the note, in the SHA-256
   hash chain ([src/audit.ts](../src/audit.ts));
2. a message in the claim's conversation, so the agent sees the decision and continues from it. That turn goes
   through BRANE like every other model request; if BRANE refuses or is down, the turn fails and nothing is sent;
3. a `request` audit row for that message, linked to the `human` row.

A second decision on the same handoff is refused (HTTP 409).

## Why Pi: the harness as an environment we hill-climb

The models stay fixed. We change the harness (BRANE policy, pre-mask patterns, corpus, agent instructions and tools)
and score every change against rewards that code checks, on tuning sets, then confirm on held-out sets
([docs/harness-environment.md](../docs/harness-environment.md)). Kept and rejected changes, with their numbers, are in
[evals/decision-log.md](../evals/decision-log.md). `node evals/qc.mjs` fails on any regression.

## Team

Frederick (harness, BRANE policy, evals), Omar Shalaby (eval design, locked test set, criminal-data
rule, report in [omar/](../omar/README.md)), Hussein (legal and business), Alex Capizzani (hash-chained audit trail
with human decision rows, macro-F1 scorer).

Built on [earendil-works/pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare) (MIT,
[LICENSE](../LICENSE)).
