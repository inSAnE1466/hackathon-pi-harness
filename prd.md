# PRD: claims queue on a classified, BRANE-gated Pi harness

Working product requirements for the team. It turns the team call ([transcript](notes/2026-11-20-team-call-transcript.md))
and the [routing tiers](routing-tiers_hackathon.md) into what we build, checked against what BRANE's live API can do
([brane](docs/brane.md)). Plain Markdown, so it pastes into a Google Docs tab. Deadline: Saturday 21 November,
10:30 CET.

## 1. The user and the problem

We are an EU health and travel insurer that wants to go AI-native. A queue of claims arrives every day; each claim
carries medical detail, identifiers and sometimes legal questions. Handlers read every page by hand.

The insurer has two bad options today:

- **Frontier models only** (Anthropic, OpenAI): best quality, but sending health data to them unchecked breaks
  GDPR Art. 9 and the insurers' code of conduct, so it is untenable.
- **Open-weight models only**: the data stays inside, but the insurer gives up the quality of the best models.

**Our product gets both.** Every piece of a claim goes to the cheapest model allowed to see it: a frontier model
when the data is protected or not needed, a local open-weight model when the sensitive data is the point of the
task, a human expert when the step needs professional judgement, and nobody when the request is forbidden.

## 2. Why this beats what other teams will build

Most teams will ask an LLM "is this sensitive?" and then clean the text and send it to OpenAI. An LLM asked that
question gives different answers on different runs, and a planted instruction can talk it out of its answer.

We decide with classifiers and code:

1. **The same input routes the same way every time.** BRANE's detectors return categories with confidences; our
   `route()` turns them into a tier with fixed thresholds. Labels in, route out, in deterministic code.
2. **The orchestrator cannot choose its own route.** A claim that says "ignore your rules" changes nothing,
   because the route is not decided by a model reading the claim.
3. **The harness is malleable.** Pi lets us add or remove classifiers, models, tools, skills and contingencies as
   configuration, instead of hard-coding one API call.
4. **Every step is traced.** Pi Durable records each model call and tool call, which gives us the test protocol,
   the trace viewer, and the data to hill-climb on.
5. **Claims are reconciled, not just routed.** The harness knows the policy terms and the law, so it asks for the
   right document and the right expert.

## 3. The two classifiers

The call settled on two questions in a fixed order. Both run on BRANE, so raw claim text reaches no other service.

|                | Classifier 1: the gate                                                              | Classifier 2: the router                                                                       |
| -------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Asks           | What is being asked?                                                                | What data is in it, and does the task need it?                                                 |
| Answers        | forbidden, needs a human, or continue                                               | special-category data needed, or only identifiers                                              |
| Implemented as | BRANE semantic categories with action `refuse`, plus BRANE's prompt-injection score | BRANE built-in categories and confidences, plus a semantic category for indirect health detail |
| Read by        | `route()`                                                                           | `route()`                                                                                      |

The most restrictive answer wins, and the stages add up: a request flagged for a human by the gate still passes
the router when it is drafted after approval.

### Labels in BRANE terms

The [label taxonomy](labels_routing.md) names our labels; BRANE has its own category names. The core set maps like this:

| Our label          | Classifier | BRANE mechanism                                                                                          | Action                                                              |
| ------------------ | ---------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `ADVERSE_DECISION` | gate       | semantic category (claim outcome: reject, reduce, fraud flag, cancel)                                    | `refuse`, then `approve`                                            |
| `DISCRIMINATORY`   | gate       | semantic category (selection by protected trait or proxy such as surname)                                | `refuse`                                                            |
| `INJECTION`        | gate       | BRANE's prompt-injection score (`prompt_injection_local`) plus a semantic category for override attempts | `refuse`                                                            |
| `PERSON`           | router     | `PERSON`                                                                                                 | `placeholder`                                                       |
| `FINANCIAL_ID`     | router     | `IBAN`, `ACCOUNT_NUMBER`, `CREDIT_CARD` (a Dutch IBAN was detected as `ACCOUNT_NUMBER`)                  | `placeholder`                                                       |
| `NATIONAL_ID`      | router     | `SSN`, `PASSPORT`, `TAX_NUMBER`, `INSURANCE_NUMBER` (whether a BSN lands in one of these is untested)    | `local`, or `refuse` if it never belongs in a prompt                |
| `HEALTH`           | router     | `HEALTH_DATA` plus a semantic category for indirect health (burnout and sertraline were missed)          | `local`                                                             |
| `THIRD_PARTY`      | router     | no BRANE category: BRANE sees a `PERSON` but not whose                                                   | `placeholder` via `PERSON`; a product gap for the policy matrix CSV |

BRANE applies the strictest action to the whole request, so a request with `HEALTH` and `PERSON` goes local as a
whole. Where a step only needs the non-health part, the harness sends that part as its own request.

## 4. The four tiers

| Tier | Route                                     | Trigger                                                             | BRANE mechanism                                                                                        | Legal basis (to verify)                      |
| ---- | ----------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| 1    | Pseudonymise, frontier model, re-identify | Only identifiers, not needed for the task                           | Category action `placeholder` (`<PERSON_1>`), restored in the answer                                   | GDPR Art. 25; Art. 5(1)(c)                   |
| 2    | Local open-weight model only              | Special-category data needed for the task                           | Category or semantic action `local`; `vllm:*` model, `X-Brane-Routed-To: local`                        | GDPR Art. 9; UAVG Art. 30(3)(b)              |
| 3    | Human in the loop                         | A decision with significant effect, or a medical or legal judgement | Semantic action `refuse` (HTTP 422); the harness turns the refusal into an approval or consult request | GDPR Art. 22; C-634/21; insurers' code 5.1.3 |
| 4    | Refuse and log                            | Discriminatory request, prompt injection, cross-claimant comparison | Semantic action `refuse`; injection routed by BRANE                                                    | GDPR Art. 9; non-discrimination; OWASP LLM01 |

Low confidence routes up: a health score of 0.35 goes to Tier 2, not Tier 1. Worked examples for each tier are in
the [routing tiers](routing-tiers_hackathon.md); every label is in the [label taxonomy](labels_routing.md).

## 5. Reconciling a claim

Routing is half the product. The other half is reaching a recommendation a handler can approve.

| Step              | Work                                                             | Typical tier                                       |
| ----------------- | ---------------------------------------------------------------- | -------------------------------------------------- |
| Intake            | Split the bundle into documents and steps; BRANE dry run on each |                                                    |
| Completeness      | Form, invoice, medical evidence present and consistent?          | 1                                                  |
| Extraction        | Billable items, dates, amounts, treatment codes                  | 1, or 2 if diagnosis detail is needed              |
| Coverage          | Items against the policy terms and exclusions                    | 1; 3 if wording is disputed                        |
| Medical questions | Necessity, causality, diagnosis                                  | 2 for a draft; 3 for the medical adviser's opinion |
| Recommendation    | Pay, reduce, deny or ask for documents, with reasons and sources | 1 or 2                                             |
| Outcome           | The handler decides                                              | 3, always                                          |

### Knowledge the harness needs

To ask for the right document and the right expert, the harness looks things up instead of guessing:

- the insurer's policy terms and exclusions (synthetic, written by us);
- the legal texts in [sources](docs/sources.md): GDPR, AI Act, UAVG, the insurers' code of conduct;
- the medical coding needed to read invoices.

These are indexed and retrieved per step. Each claim runs in its own Pi conversation with no shared memory, so
context stays durable across a long claim and never crosses between claimants.

## 6. Primitives

`brane`, `intake`, `gate`, `lookup`, `consult`, `request_approval`, `audit`, `isolate`: each one file with one job and a
measured reason to exist ([primitives](docs/primitives.md)).

## 7. Evals

- **Security suite (pass or fail):** T1 to T5 from the brief, plus edge cases E1 to E5 from this workflow, written
  into `submission/MAIN_Five_Tests_Template.csv` with the `X-Brane-*` headers as evidence. One leak fails it.
- **Edge cases to start from:** a mixed request (summarise a burnout claim and draft a rejection: Tier 3 first,
  then Tier 2); low confidence (health 0.35 routes to Tier 2); a Dutch IBAN labeled `ACCOUNT_NUMBER`; indirect
  health ("burnout", "sertraline") that the built-in detector misses; a surname-based fraud filter.
- **Quality suite:** generated synthetic claims ([evals](docs/evals.md)) scored on recommendation correctness and
  the right expert consulted.
- **Determinism check:** every case runs three times and must route the same way.
- **Baseline:** the same suite against an "ask the LLM if it is sensitive" build ([baseline](docs/baseline.md)).
- **Hill-climb:** change one BRANE policy setting or threshold, rerun the dry runs, keep or revert.

## 8. Demo and deliverables

Everything we build must appear in the demo and the video. Deliverables due Saturday 10:30 CET:

1. Working agent with an explicit human decision step (3-minute live demo).
2. `submission/MAIN_Policy_Matrix_Template.csv`: every category and semantic rule with its article.
3. `submission/MAIN_Five_Tests_Template.csv`: T1 to T5 and E1 to E5 with evidence.
4. Legal research and the business case.

Demo flow and video plan: [demo](docs/demo.md).

## 9. Ideas raised, not yet decided

| Idea                                     | What it would add                                                                                                      | Fit                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| LLM as judge                             | A second model grades the agent's draft (accuracy, no leaked identifiers, reasons cited) before it reaches the handler | Good for the quality suite and for checking drafts; it must never decide a route, since that would bring back the non-determinism we avoid |
| Mixture of experts                       | Route each step to a specialised model                                                                                 | This is what the tiers already do at the model level: frontier, local, human                                                               |
| A deterministic classifier besides BRANE | A classifier we control, with fixed outputs                                                                            | BRANE's detectors and semantic categories already return labels and confidences; adding one would send raw data to a second service        |
| A memory tool for long claims            | Durable notes across a long claim                                                                                      | Pi Durable's per-claim conversation covers this for the hackathon                                                                          |

## 10. Owners

| Area                                       | Owner     |
| ------------------------------------------ | --------- |
| BRANE policy, harness, evals, trace viewer | Frederick |
| Legal research, policy matrix CSV, sources | to assign |
| Business case, demo script, video          | to assign |
