# Architecture

## Base: Pi Durable on Cloudflare

The repository is a fork of [earendil-works/pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare)
(MIT), Earendil's reference for one Pi Durable harness in a hibernating Durable Object. `upstream` is that
repository; pull its changes with `git fetch upstream && git merge upstream/main`.

| File                                       | Role                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `src/chat.ts`                              | Models, extensions, tools and the default agent. The integration point for BRANE and our tools.         |
| `src/session.ts`                           | Hosts the harness in a Durable Object with Pi Durable's SQLite storage, sockets and alarms.             |
| `src/tools.ts`, `schedule.ts`, `search.ts` | Upstream's example tools. Replace them with ours; delete what we do not use.                            |
| `src/client/`                              | React client: transcript, live activity panel. The demo surface.                                        |
| `test/`                                    | Upstream's flow tests (restart recovery, scheduling, forks). Keep them green while we change the agent. |

Why this base: Pi Durable gives us a durable event log (every model call and tool call is recorded and survives
restarts, which is the raw material for the test protocol), code mode in a QuickJS sandbox, and a JavaScript
runtime where calling an HTTP endpoint is one `fetch`.

## Target shape

The flow is in [routing](routing.md#brane-first): BRANE first, then `decide` on BRANE's protected text, then
`route()`, then one of five routes, with `approve` closing every claim. Everything writes protocol rows.

## The audit log

`src/audit.ts` keeps the `audit_log` table in the session Durable Object's SQLite, beside Pi's own tables. It records
who did what for every decision:

| Kind                | Actor                     | Written when                                                                                   |
| ------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `request`           | the person's display name | a person sends a request (the conversation id, never the text)                                 |
| `brane`             | `brane`                   | BRANE decides a model request (status, route, action, categories, rule, resolved model)        |
| `masked`            | `pre-mask`                | `detect.ts` replaces identifiers BRANE mislabels, before BRANE sees the request                |
| `intake`            | `intake`                  | intake splits health detail out on the local model                                             |
| `classify`          | `classifier`              | the second classifier judges a person's text (`action` is its route, `detail` its labels)      |
| `lookup`, `handoff` | `agent`                   | the assistant cites passages or hands a case to a person                                       |
| `cited`             | `agent`                   | the passage ids a recommendation's reasons cite (`ref_id` names its handoff)                   |
| `handoff`           | `gate`                    | BRANE refused a request (`detail` is `refusal:<rule>`, `ref_id` names the refused `brane` row) |
| `config`            | `operator`                | the harness switches were set                                                                  |
| `human`             | the person's role or name | a person decides a handoff (`ref_id` names it; one decision each)                              |

Automated rows also carry the policy version that decided them (`policy/brane.json` `version`). The rows form a hash
chain: each stores the previous row's hash and `hash = sha256(prev_hash + its fields)`, so changing or deleting any row
breaks every later hash. Rows written before the chain existed are sealed in id order when the table is upgraded.

| Route                                    | Does                                                               |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `GET /api/sessions/:id/audit`            | rows newest first, plus the chain check                            |
| `GET /api/sessions/:id/audit?format=csv` | the whole trail oldest first, with actors and hashes               |
| `GET /api/sessions/:id/audit/verify`     | the chain check alone                                              |
| `POST /api/sessions/:id/audit/human`     | a reviewer's decision: `handoffId`, `decision`, `note`, `reviewer` |

A person's decision is canonical here, not in the browser. `POST /audit/human` takes
`{handoffId, decision, note, reviewer}`: `approved`, `rejected` or `edited` on a `request_approval` handoff,
`answered` on a `consult` (the note is the answer). A refusal handoff takes `approved`, `rejected` or `edited`; it records what the person
did with the refused request and is never sent back to a model. It writes the `human` row, then submits the decision to the
conversation the handoff came from as a user message (`[reviewer]`, then
`Human decision on handoff #<id> (<tool>): <decision>`, then `Note: ...`), and writes a `request` row whose `ref_id`
is the human row. The agent continues from that message, and the model request it starts goes through BRANE like
every other: a refusal or an unreachable BRANE fails that turn, and the human row stands. The response is
`201 {decision, message}`; 400 for invalid input, 404 for an unknown handoff, 409 for a second decision. Handoff,
human and request rows carry `conversation_id`.

The `reviewer` is a display string that the team password does not prove; per-person sign-in is the step a real
deployment adds. The audit log itself is never written into a conversation, so no model reads it, and it holds
categories, ids and a person's own note, never prompt text.

## Harness switches

`src/switches.ts` holds what an eval run can change about one session without a code edit. Set them when the session
is created (`POST /api/sessions` with `{"switches": {...}}`) or later (`PUT /api/sessions/:id/switches`, partial);
`GET /api/sessions/:id/switches` reads them. They are stored in the session's SQLite and read at every model request.
An unknown key or a bad value is a 400 and changes nothing. Each change writes a `config` audit row (actor `operator`)
with the full resolved set, and `GET /audit` returns the current set as `switches`.

| Switch          | Values (default first)                                     | Effect                                                                                                                   |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `classifier`    | `off`, `on`                                                | Run the second classifier on a person's text before the turn; the stricter route wins                                    |
| `intake`        | `on`, `off`                                                | Split health detail out on the local model before the turn                                                               |
| `braneTiming`   | `preflight`, `inline`                                      | `preflight` dry-runs the prompt at BRANE before the turn (intake needs it); `inline` relies on the chat call's own check |
| `cloudModel`    | `policy.models.cloud`, any BRANE model id                  | The model every agent request asks BRANE for                                                                             |
| `localModel`    | `policy.models.local`, any BRANE model id                  | The model for intake's extraction                                                                                        |
| `promptVariant` | `default`, `minimal`, `strict`                             | Which instructions in `src/chat.ts` the agent gets                                                                       |
| `instructions`  | empty, or text up to 8,000 characters                      | Replaces the variant; logged as a hash                                                                                   |
| `tools`         | all of `lookup`, `web_read`, `consult`, `request_approval` | Tools offered to the model; a call to one that is off is blocked                                                         |

No switch opens a path around BRANE. The provider is still the only transport, and BRANE checks every request
whatever the timing.

## Where the time goes

Measured on 21 Nov against the live BRANE: every BRANE call takes 5 to 6 s, a dry run and a one-word chat alike, so a
turn costs about 6 s per model request. A luggage claim (one dry run, four model requests, six lookups) ends in about
35 s; intake's split adds about 17 s to a health claim (two dry runs and one local extraction) and the classifier about
6 s per prompt. Lookups and the pre-mask run in the Worker in milliseconds.

## The gate is the transport

The one rule that wins the security tests: **the agent has no model transport except the BRANE one.**

- `src/brane.ts` is the only model provider. Its fetch reaches BRANE's origin only, records each decision, and fails
  when a response carries no `X-Brane-Routed-To` header. A 422 refusal ends the turn as a failed model call. Retries
  are off in the provider (`maxRetries: 0`) and in the harness (`settings.retry`), so a failure is never resent, to
  BRANE or elsewhere. `src/chat.ts` registers it as the only provider. The upstream
  `openaiProvider()` and any direct OpenAI key are removed. A bypass is then not a missed check but a missing
  network path.
- The BRANE provider throws on any non-success from BRANE (timeout, 5xx, malformed verdict, a verdict of `block`).
  Pi records the failed model call; nothing is retried against another provider. This is the **check failure** test.
- Prompt injection inside documents cannot change the route, because `route()` is code that reads BRANE's verdict,
  classifier answers and the policy, not model output. This is the **bypass attempt** test.
- The pseudonym map stays in the Durable Object's storage. The model only ever sees `CLAIMANT_01`-style tokens;
  re-identification happens in the client for the authorised handler.

BRANE proxies an OpenAI-compatible chat API, so the provider is a `baseUrl` swap plus a check of the `X-Brane-*`
headers on every response ([brane](brane.md)).

## Code mode and the classifier

Scripts in code mode can call `models.classify(model, { state, questions })` from a QuickJS sandbox; each call is a
journaled, durable nested call. That lets one script classify a claim bundle's documents in parallel (four in flight at once) and
return only the routing table to the model, and it keeps the classifier's raw inputs out of the chat context. Because
`decide` is a tool over BRANE's `/policy/test`, code mode can fan it out over a claim's documents.
[Primitives](primitives.md#where-code-mode-fits) says which calls belong in code mode.
