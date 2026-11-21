# Primitives

The harness is a Pi Durable agent in a Durable Object. Its claims-specific behavior is a small set of primitives, each
one file under `src/` with one job. Each primitive exists because a measured gap or a legal rule needs it; the case
for each is below.

| Primitive          | File                                                               | Kind                  | What it does                                                                                                                      |
| ------------------ | ------------------------------------------------------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `brane`            | `src/brane.ts`                                                     | model provider        | The only route to any model. OpenAI-compatible chat at BRANE; fails closed                                                        |
| `intake`           | `src/primitives/intake.ts`                                         | runs before the agent | Splits health detail out of a claim on the local model so the agent can use the frontier model                                    |
| `gate`             | `src/primitives/gate.ts`, `detect.ts`, `names.ts`, `src/tokens.ts` | Pi hooks              | Pre-masks names, addresses and identifiers in every request body with one token map per conversation; logs handoffs and citations |
| `classify`         | `src/primitives/classify.ts`                                       | runs before the agent | A second classifier on BRANE's local model; the stricter of its route and BRANE's wins                                            |
| `lookup`           | `src/primitives/lookup.ts`                                         | agent tool            | Searches the legal corpus and policy terms; returns citable passage ids                                                           |
| `consult`          | `src/primitives/handoff.ts`                                        | agent tool            | Sends a minimised question to the medical adviser or legal reviewer                                                               |
| `request_approval` | `src/primitives/handoff.ts`                                        | agent tool            | Hands a recommendation to the claims handler, who decides                                                                         |
| `audit`            | `src/audit.ts`                                                     | storage               | One row per decision in the Durable Object's SQLite, served to the decision log, never to a model                                 |
| `isolate`          | `src/chat.ts`, `session.ts`                                        | configuration         | One claim per conversation; no shared memory across claims                                                                        |

## The case for each

### brane: the gate is the transport

A check before a model call can be skipped; a missing network path cannot. `braneFetch` reaches BRANE's origin only,
records every `X-Brane-*` decision, and throws when a response has no routing header. Retries are off, so a failure
is never resent elsewhere. This is track test T5 (check failure), enforced by construction. Source: brief, check
failure test; GDPR Art. 32.

### intake: BRANE routes per request, claims need per-part routing

BRANE applies the strictest category to the whole request. One word of health detail sends the entire claim to the
local model, and the frontier model never helps with coverage reasoning or drafting. Intake runs a BRANE dry run
first. Identifiers are masked before either call, the extraction is pinned to a `vllm:` model id (BRANE runs an
explicitly requested local model on its local lane, cause `explicit_local_model`), and it goes through `braneFetch`, so
it is a `brane` audit row and fails closed. The two dry runs (`/policy/test`, no completion) use a plain fetch to BRANE's
origin and write no audit row: no model runs on them, and their result is the `intake` row. BRANE has no
request-level local-only flag, so the pin rests on the explicit local model id; the check after the response is the
backstop. Only when health would send the claim local, BRANE's local model rewrites the medical part as a fact sheet
with coded invoice lines ("Invoice A: treatment, EUR 1,240"), amounts, whether a referral is present, and whether the
medical adviser is needed. BRANE re-checks the sheet; only a clean sheet replaces the claim. A failed check keeps the
claim local, as before. Measured: a ski-fracture claim that went local on every turn now reasons on
`claude-haiku-5.5` with policy citations and sends the medical question to the adviser. Source: GDPR Art. 5(1)(c),
Art. 9; insurers' code of conduct 5.1.3.

### gate and pre-mask: nothing depends on what BRANE detects

The golden set showed BRANE labeling a valid BSN and a passport number as `ACCOUNT_NUMBER` and a policy number as
`PERSON`, partly masked (`PERSON_REF_2-88`). It also misses a person's name or a street address on some runs, and
now and then returns a blank answer for a sensitive request ([decision log](../evals/decision-log.md), open gaps).
So the pre-mask, `detect.ts`, replaces these itself, with code and no model, the same way every run:

| Token                                          | What it replaces                                                                                                                                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[BSN_1]`, `[PASSPORT_1]`, `[PLATE_1]`         | a BSN by its 11-proof, a passport number, a Dutch licence plate                                                                                                                                     |
| `[POLICY_ID_1]`, `[CLAIM_ID_1]`                | policy and claim numbers                                                                                                                                                                            |
| `[NAME_1]`                                     | a given name from the bundled list (`names.ts`) with initials, particles and a surname; any capitalized name after a person cue (Mr, mevrouw, claimant, hit by); the surname alone once it is known |
| `[STREET_1]`                                   | a street word (straat, weg, laan, plein, ...) with a house number, and its postcode and town                                                                                                        |
| `[MAIL_1]`, `[TEL_1]`, `[BANK_1]`, `[BIRTH_1]` | an email address, a phone number, an IBAN, a date of birth                                                                                                                                          |

The gate's `beforeProviderRequest` hook applies it to every request body, the harness's own housekeeping calls
included, before BRANE sees it; intake and the classifier apply it to their own calls. Each conversation has one token
map (`src/tokens.ts`, in the session's SQLite): the same value gets the same token in every message, tool result and
request, "J. de Vries" and "Jan de Vries" share one, and the map survives a restart. The map holds the real values,
is served only to the handler's screen (`GET /api/sessions/:id/tokens`) and is never part of a model request. The
tokens are spelled differently from BRANE's own (`<PERSON_1>`, `<EMAIL_1>`), which BRANE fills back in on the way out.
It is strict on purpose: masking a capitalized phrase too many costs a little quality; a leaked name fails the gate.
Limits: a name that is not on the list, has no cue and no surname pattern is left to BRANE, and so is a foreign
street format the patterns do not cover. Source: GDPR Art. 5(1)(c), Art. 32, Art. 87; national-ID rules (e.g. NL UAVG
Art. 46).

### classify: a second opinion that can only tighten

BRANE's semantic categories vary between runs ([decision log](../evals/decision-log.md)). `classify` is Omar
Shalaby's second classifier as a harness step: one call to BRANE's local model with the labels in
`policy/classifier.json`, on a person's text (a prompt, or the note of a decision) after pre-masking and before the
agent's turn. `allow` changes nothing. `local` keeps that conversation on the local model from then on, by asking for
the local model by name. `refuse` withholds the text, and a refusal handoff goes to a person. The call is
`POST /policy/test` with a local-only draft policy; a call that did not run locally, an error or an unreadable reply
counts as `local`. Each verdict is a `classify` audit row. It is off by default (switch `classifier`).

### lookup: claims need law and policy, cited

The two models BRANE offers know neither this insurer's policy terms nor the exact legal text. `lookup` is BM25
over `corpus/passages.json`: 125 passages of GDPR articles, EU AI Act articles and Annex III (fetched by
`corpus/build.mjs` from public mirrors), case-law and guidance summaries, and the synthetic policy terms. It runs in
the Worker: deterministic, no external service, nothing leaves. Every passage id it returns is logged, so the audit
shows which clause each recommendation rests on.

### consult and request_approval: people decide

The agent prepares; a medical adviser judges medical questions and a claims handler decides every outcome. The tools
return only an acknowledgement to the model, so a person's decision is never generated. The person's decision or
answer comes back into the conversation as a message, with its own audit rows
([architecture](architecture.md#the-audit-log)). BRANE's semantic category
`CLAIM_OUTCOME_DECISION` refuses any request to decide, and these tools are the path the agent takes instead.
Source: GDPR Art. 22; CJEU C-634/21; AI Act Art. 14; insurers' code of conduct 5.1.3.

### audit: every decision traceable, none returned to a chat

The track requires every decision in the test protocol. `audit_log` in the Durable Object's SQLite holds who did
what: each person's request, BRANE's decision per request, the gate's and the assistant's events, and the reviewer's
decision on each handoff, each with its actor, in a hash chain. It is served at `GET /api/sessions/:id/audit` to the
decision log panel and never written into a conversation. [Architecture](architecture.md#the-audit-log) owns its
rows, routes and chain.

### isolate: one claim, one conversation

Comparing claimants is refused by BRANE (`CROSS_CLAIMANT_COMPARISON`), and the harness gives each claim its own
conversation with no shared memory, so a claim's data cannot surface in another. Source: GDPR Art. 5(1)(b).

## Flow of one claim

```
claim text
  └─ intake: BRANE dry run ── health would send it local? ── yes ─ local model → fact sheet → BRANE re-check
  └─ agent turn (Pi Durable, Durable Object)
       ├─ lookup → passage ids                      (inside the Worker)
       ├─ consult / request_approval → a person     (logged)
       └─ model request
            ├─ gate: mask BSN, passport, policy, claim ids
            └─ brane: BRANE decides cloud protected, local or refused → X-Brane-* → audit
```
