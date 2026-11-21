# Routing: who may see which data, and who decides

Every step of a claim goes to exactly one **route**. Code decides the route from BRANE's verdict, its detection
confidences and semantic matches, and the policy matrix. The model that would receive the data never decides.

## BRANE first

Raw input goes to BRANE before anything else sees it. A hosted classifier is an external recipient like any model,
so classifying raw health data with one would itself be the transfer we are trying to control. BRANE is the one
place raw data is inspected; every other component, the classifier included, sees BRANE's protected output.

```
claim documents ──► BRANE (detect, classify, protect, verdict)
                        │ protected text + categories + verdict
                        ▼
                    decide (BRANE /policy/test signals)        ──► route() ◄── policy matrix
                                                                      │
              ┌───────────────┬────────────────┬──────────────────┬───┴──────────┐
              ▼               ▼                ▼                  ▼              ▼
          frontier      frontier-protected   local             consult        block
       (OpenAI chat)   (OpenAI on BRANE's    (BRANE local    (medical or     (refuse)
                        protected payload)    processing)    legal expert)
                                                                  │
                                              approve (claims handler decides the outcome)
```

## The parts

| Part             | Sees                                            | Decides                                                                   |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------- |
| **BRANE**        | Raw claim documents                             | What leaves, in what form (allow, protect, local only, block)             |
| **decide**       | BRANE's protected text and categories           | Probabilities for our routing questions; nothing else                     |
| **route()**      | Verdict, probabilities, policy matrix           | The route per step; pure code                                             |
| **Orchestrator** | Only what `route()` released, with pseudonyms   | The next step of the claim workflow; it cannot choose or change a route   |
| **consult**      | The prepared, minimised case for one expert     | A medical or legal opinion the agent needs before it can continue         |
| **approve**      | The agent's prepared recommendation and sources | The claim outcome; the agent never pays, reduces or denies a claim itself |

BRANE's verdict sets the ceiling: `route()` may make a step stricter than BRANE's verdict (a `consult` or `block`
BRANE did not ask for) but never looser.

## The routes

| Route                | Who processes it                                  | Track action | When                                                                                        |
| -------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------- |
| `frontier`           | OpenAI through BRANE                              | ALLOW        | Only released categories, and the step needs model reasoning                                |
| `frontier-protected` | OpenAI on BRANE's pseudonymised or masked payload | PROTECT      | The step needs model reasoning; identities and unneeded health detail do not                |
| `local`              | BRANE's local processing, or deterministic code   | LOCAL ONLY   | The data may not leave, but the step can be automated                                       |
| `consult`            | A named medical or legal expert, in the client    | none         | The step needs professional judgement, or a classifier answer is below its confidence floor |
| `block`              | Nobody                                            | BLOCK        | Not permitted at all, a bypass attempt, or a cross-claim comparison                         |

The claim outcome always ends in `approve` by an authorised claims handler, whatever the routes before it.

## When a human is involved

The brief asks which decisions humans must control and requires "necessary human approvals, access rights and
other organisational requirements". Its example keeps the final decision with "authorised people" and allows "no
autonomous decision by the agent". For a claim:

| Human step                       | Trigger                                                                                               | Source ([sources](sources.md))                                                                                                 |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **approve**: claims handler      | Every outcome: pay, reduce, deny, request more documents                                              | GDPR Art. 22; C-634/21 SCHUFA; UAVG Art. 40; WP251rev.01 on meaningful human involvement                                       |
| **consult**: medical adviser     | Whether a treatment is medically necessary, causality between incident and injury, coding a diagnosis | Insurers' code of conduct 5.1.3 (only the medical adviser writes a medical opinion); UAVG Art. 30(3)(b) and 30(4); GDPR Art. 9 |
| **consult**: legal or compliance | Policy wording disputes, exclusions, suspected fraud, a request outside the policy matrix             | Our policy; national insurance law                                                                                             |
| **consult**: any                 | A BRANE confidence near its floor, or a semantic match without a clear action                         | Our policy; floors tuned in [evals](evals.md)                                                                                  |

Life and health insurance risk assessment and pricing are high-risk under AI Act Annex III(5)(c). Claims handling
is not named there; the legal team decides whether our system falls under it and cites the answer.

## One claim per run

Each claim runs in its own Pi conversation with no shared memory. Comparing one claimant's records with another's
is `block`. A claimant's own earlier claims are reachable only through a fraud check that a human approves. This
closes the linkage failures L1, L2 and L5 ([failure modes](failure-modes.md#linkage-records-combined-that-must-stay-apart)).

## Labels and tiers

Omar Shalaby designed the label taxonomy and the four tiers the routes come from: one question about the request
(what is being asked?) and one about the data (what is in it, and does the task need it?). The strictest answer
wins, and the stages add up: a step a person approves still passes the data check when it is drafted. His
originals are in git history (`labels_routing.md`, `routing-tiers_hackathon.md`, removed in favour of this page);
his harness and evaluation sets are in [omar/](../omar/).

| Tier | Route                                     | Trigger                                                             | Example                                                                  | BRANE mechanism                                             |
| ---- | ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1    | Pseudonymise, frontier model, re-identify | Only identifiers, not needed for the task                           | Confirm receipt of a water-damage claim to a named claimant with an IBAN | `placeholder`, restored in the answer                       |
| 2    | Local model only                          | Special-category data the task needs                                | Summarise a burnout claim treated with sertraline                        | `local` (category or semantic), `X-Brane-Routed-To: local`  |
| 3    | Human in the loop                         | A decision with significant effect, or a medical or legal judgement | Reject a travel claim and send the letter                                | semantic `refuse` (HTTP 422); `request_approval`, `consult` |
| 4    | Refuse and log                            | Discriminatory request, prompt injection, cross-claimant comparison | Flag claimants with Moroccan or Turkish surnames for fraud checks        | semantic `refuse`                                           |

The labels map onto BRANE like this ([policy/brane.json](../policy/brane.json), matrix rules in
[submission/MAIN_Policy_Matrix.csv](../submission/MAIN_Policy_Matrix.csv)):

| Label              | Asks about | BRANE mechanism                                                                             | Action                                     |
| ------------------ | ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `ADVERSE_DECISION` | request    | semantic `CLAIM_OUTCOME_DECISION`                                                           | `refuse`, then a person                    |
| `DISCRIMINATORY`   | request    | semantic `PROTECTED_TRAIT_PROFILING`                                                        | `refuse`                                   |
| `BULK_PROFILING`   | request    | semantic `CROSS_CLAIMANT_COMPARISON`                                                        | `refuse`                                   |
| `INJECTION`        | request    | semantic `RULE_OVERRIDE_ATTEMPT` and BRANE's injection score                                | `refuse`                                   |
| `PERSON`           | data       | `PERSON`                                                                                    | `placeholder`                              |
| `FINANCIAL_ID`     | data       | `IBAN`, `ACCOUNT_NUMBER`, `CREDIT_CARD`                                                     | `placeholder`                              |
| `NATIONAL_ID`      | data       | `SSN`, `PASSPORT`, `TAX_NUMBER`, plus our gate, because BRANE labels a BSN `ACCOUNT_NUMBER` | `local`, masked by the gate                |
| `HEALTH`           | data       | `HEALTH_DATA` plus semantic `CLAIM_HEALTH_CONTEXT` for indirect detail                      | `local`                                    |
| `CRIMINAL`         | data       | semantic `CRIMINAL_OFFENCE_DATA` (Omar's rule, GDPR Art. 10)                                | `local`                                    |
| `THIRD_PARTY`      | data       | none: BRANE sees a `PERSON` but not whose                                                   | `placeholder`; a product gap in the matrix |

The taxonomy's roadmap labels (`RISK_PRICING`, `GENETIC`, `BIOMETRIC`, `FINANCIAL_STATUS`, `PRECISE_LOCATION`,
`MINOR`, `QUASI_ID`) have no rule yet. Genetic and biometric data fall under BRANE's Art. 9 categories, which are all
`local`.
