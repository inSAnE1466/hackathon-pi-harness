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

## The gate is the transport

The one rule that wins the security tests: **the agent has no model transport except the BRANE one.**

- `src/chat.ts` registers exactly one provider, `brane`, whose `baseUrl` is the BRANE endpoint. BRANE is
  OpenAI-compatible and carries both cloud and local models ([brane](brane.md#endpoints)). The upstream
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
