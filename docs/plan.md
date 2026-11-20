# Plan

Ordered units. Each ends with a check that proves it on the real surface. Delete a step when it lands; this file
is transient and goes away when the plan is done.

1. **Settle BRANE's shape (prototype).** With the organizers' endpoint and key in `.dev.vars`, send one clean and
   one PII-laden request; record the request and response shape, latency, how policies are configured, and what an
   error looks like. Decide: `baseUrl` swap or verdict-then-forward. Check: a script in `scripts/brane-probe.mjs`
   prints both responses' structure with values redacted.
2. **Make BRANE the only transport.** Replace `openaiProvider()` in `src/chat.ts` with a `brane` provider; delete the
   direct OpenAI path and `OPENAI_API_KEY`. Fail closed on every non-success. Check: `pnpm test` green, and the
   agent answers one prompt through BRANE in `pnpm dev`.
3. **Pick the use case and write the policy matrix.** Team decision from [use cases](use-cases.md). Law students
   fill `docs/policy-matrix.md` and `policy/<use-case>.json`, one rule per category with its legal basis. Check: at
   least three rules with different actions, each citing an article.
4. **Primitives.** `detect`, `protect`, `route`, `record` as pure functions in `src/primitives/`, then `classify`
   over the brain endpoint as a pi-ai provider with `classify()`. Check: the eval runner drives `route()` over the
   seed cases.
5. **Eval runner and generator.** `evals/generate.mjs` (seeded) and `evals/run.mjs` with the recording transport and
   stub BRANE; `pnpm eval` prints pass or fail per track test and writes the protocol. Check: a deliberately
   broken `route()` fails the suite, then the real one passes.
6. **The agent's task.** Replace upstream's weather and schedule tools with the use case's tools; a code mode batch
   path classifies many documents at once. Check: the demo scenario completes end to end in the browser.
7. **Hill-climb the conditions** per [evals](evals.md#hill-climbing-the-conditions). Check: `decision.tsv` with at
   least 10 rows and the held-out split's numbers.
8. **Approval and protocol view** in `src/client/`: the human queue and a protocol table the jury can read. Check:
   screenshots of an approval and of the five tests' rows.
9. **Demo and business case.** Two-minute script, the four deliverables. Check: a timed dry run.

Saturday morning is for steps 7 to 9 only. If step 1 slips, steps 3 to 5 proceed against the stub BRANE.
