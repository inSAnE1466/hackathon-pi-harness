# Routing: who may see which data, and who decides

Every unit of work the agent handles goes to exactly one **route**. The route is decided by code from the
classification of the data and the task, never by the model that would receive the data.

## The routes

| Route                | Who processes it                                                                  | Track action       | When                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontier`           | An external closed frontier model (OpenAI via BRANE)                              | ALLOW              | The payload holds only data the policy matrix releases, and the task needs frontier reasoning.                                              |
| `frontier-protected` | The same model, after BRANE pseudonymises or masks the payload                    | PROTECT            | The task needs frontier reasoning; the identifying or sensitive fields are not needed for it.                                               |
| `local`              | An open-weight model in an approved environment we control, or deterministic code | LOCAL ONLY         | The data may not leave (special categories, trade secrets, re-identification keys), but the task can be automated.                          |
| `human`              | An authorised person, with the agent's prepared material                          | none; a human gate | The decision has legal or similarly significant effect, needs professional judgement or accountability, or the classifier is not confident. |
| `block`              | Nobody                                                                            | BLOCK              | The processing is not permitted at all, or a bypass attempt is detected.                                                                    |

`frontier-protected` is a payload transform followed by `frontier`, not a third kind of model. A request can split:
the job-relevant parts go `frontier-protected` while a health disclosure in the same document goes `block`.

## Distinction 1: human expertise or a model

A step goes to `human` when any of these hold. Each row names its source; the policy matrix ([plan](plan.md) step 3)
cites the exact article per use case.

| Test                                                                                                                         | Why it forces a human                                                                                                | Source                                                              |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| The output is a decision with legal or similarly significant effect on a person (hire, reject, credit, diagnosis, dismissal) | Solely automated decisions of this kind are restricted; meaningful human involvement is required, not a rubber stamp | GDPR Art. 22; WP251rev.01                                           |
| The system is high-risk under the AI Act (employment, credit, essential services, and others in Annex III)                   | Deployers must assign human oversight to competent people who can override                                           | AI Act Art. 14, Art. 26, Annex III                                  |
| A regulated profession signs it (lawyer, doctor, auditor)                                                                    | Accountability cannot be delegated to a model                                                                        | Sector law per use case                                             |
| The classifier's confidence on any routing question is below the threshold                                                   | Uncertain classification is not evidence of permission                                                               | Our policy; tuned in [evals](evals.md#hill-climbing-the-conditions) |
| The input contains a conflict the policy matrix does not cover                                                               | No rule exists, so no automated rule can apply it                                                                    | Our policy                                                          |

The agent may **prepare** material for every human step (summaries, comparisons, extracted facts) on the routes
the data allows. The final act stays with a named role, and the test protocol records who acted.

## Distinction 2: closed frontier or open-weight local

"Frontier" here means a hosted closed model reached through BRANE. "Local" means an open-weight model or plain code
running where the data already is. The question is not which model is smarter. It is **where the bytes go**.

| Prefer `local` when                                                                                  | Prefer `frontier` when                                                                             |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| The data is a GDPR Art. 9 special category, or Art. 10 criminal data                                 | The payload holds only released categories after protection                                        |
| The data is a trade secret or under a confidentiality obligation that forbids third-party processors | Long-context reasoning, drafting or comparison quality matters for the task                        |
| The step is extraction, redaction, matching or classification that a small model or regex does well  | The step is synthesis across many released facts                                                   |
| The data includes the re-identification key (the pseudonym map)                                      | The step's output goes back to a human, not to an automated decision                               |
| BRANE or the processor contract does not cover the data category                                     | The processor contract, data residency and retention terms cover it (Art. 28, Chapter V transfers) |

Open-weight does not mean safe: a local model on a third party's cloud is an external transfer. `local` names the
environment, not the license.

## How the route is computed

1. Deterministic detectors run first (regex and checksums for emails, IBANs, phone numbers, national identifiers).
   They are cheap and their recall is measurable.
2. BRANE runs on every outbound request: detect, classify, protect. Its verdict is required. No verdict, no request.
3. The **brain** classifier answers the routing questions ([primitives](primitives.md#classify)) on the task and the
   remaining text. Its questions and thresholds are the conditions we hill-climb.
4. A pure function `route(detections, braneVerdict, brainAnswers, policy)` returns the route. It is the only place
   the route is decided, and the eval suite drives it directly.
5. The decision, its inputs (as categories and hashes, never raw values) and the outcome go to the test protocol.
