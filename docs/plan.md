# Plan

Ordered units. Each ends with a check on the real surface. Delete a step when it lands; this file goes away when
the plan is done. The criterion each step serves is in brackets ([track](track.md#judging)).

1. **Write our BRANE policy.** Categories, semantic categories and routing mode for claims, applied with
   `PUT /api/v1/policy` from a versioned file `policy/brane.json`. Check: `/policy/test` on the routing tiers' four
   examples gives local, refused and placeholder as expected. [enforcement, derived policies]
2. **BRANE is the only transport.** Replace `openaiProvider()` in `src/chat.ts` with a `brane` provider: OpenAI-compatible
   chat at `BRANE_BASE_URL` with BRANE's cloud and local models; delete the direct OpenAI path and `OPENAI_API_KEY`.
   Fail closed on any non-success or missing `X-Brane-*` headers. Check: `pnpm test` green; one prompt answered
   through BRANE in `pnpm dev` with its headers recorded. [enforcement]
3. **Legal research and policy matrix.** The legal team turns [use case](use-case.md#data-categories-draft-for-the-legal-team)
   into `docs/research.md` (cited analysis) and `submission/MAIN_Policy_Matrix_Template.csv`, the format due
   Saturday 21 November 10:30 CET.
   Check: every rule cites a source and names its research section; at least three rules with different actions.
   [sources, classification, derived policies]
4. **Primitives.** `route`, `record` and `isolate` first (pure or config), then `brane`, `decide`, `consult`,
   `approve` ([primitives](primitives.md)). Check: the eval runner drives `route()` over seed cases. [enforcement]
5. **Generator and runner.** `evals/generate.ts` from Synthea, Gretel and our templates; `evals/run.ts` with the
   recording transport and a stub BRANE; it fills `submission/MAIN_Five_Tests_Template.csv` (T1 to T5, E1 to E5); `pnpm eval --agent harness`. Check: a deliberately broken `route()` fails
   the suite, then the real one passes. [test protocol]
6. **Claims workflow.** Replace upstream's weather, schedule and search tools with the claim steps
   ([use case](use-case.md#the-workflow)); one claim per conversation. Check: a seeded claim completes in the
   browser with a consult and an approval. [reliability]
7. **Trace viewer.** Pipeline, sent versus original, confidence bars, human queue, eval board
   ([demo](demo.md#the-trace-viewer)). Check: screenshots of each panel on a real run. [demo clarity]
8. **Baseline.** `baselines/vanilla/` and `pnpm eval --agent vanilla`; both columns on the eval board. Check: the
   scorecard shows both. [enforcement, demo clarity]
9. **Deploy.** Cloudflare Worker behind Access with the team's allow-list. Check: a teammate signs in and runs a
   claim. [demo clarity]
10. **Hill-climb** per [evals](evals.md#hill-climbing). Check: `decision.tsv` with at least 10 rows and the held-out
    numbers. [reliability]
11. **Deck, video, rehearsal** per [demo](demo.md). Check: a timed dry run and a rendered MP4. [problem relevance,
    demo clarity]

Steps 3 and 5 run in parallel with 1, 2 and 4: the legal team needs no code, and the generator needs no BRANE.
