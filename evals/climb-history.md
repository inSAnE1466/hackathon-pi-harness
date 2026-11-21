# The climb, and how to rerun it

`evals/climb-history.json` has one row per iteration: `{iter, track, change, layer, scores, kept, reason, run}`.
`evals/climb-summary.json` holds the headline slopes that the README, the video and `docs/evals.md` show. Both
files are generated; nobody types a score.

## What is climbed

The models stay fixed. Each iteration changes one thing in the harness and is scored by a real run:

| Track          | What changes                                                                    | Scored by               | On                                   |
| -------------- | ------------------------------------------------------------------------------- | ----------------------- | ------------------------------------ |
| `routing`      | The policy (as a BRANE draft), the pre-mask, the second classifier              | `evals/hill.mjs`        | `omar-val`, 50 rows per route        |
| `policy-first` | Whether the policy alone can do what a pre-mask pattern does                    | `evals/hill.mjs`        | rows of `omar-dev` holding the value |
| `legal`        | Lookup ranking and the corpus                                                   | `evals/legal.mjs`       | 54 hard dev questions                |
| `agent`        | Instructions, intake, when BRANE is called, the model per route, the classifier | `evals/agent-climb.mjs` | 12 dev claims, end to end            |

The rule that keeps or reverts a change is code, at the top of `evals/history.mjs`. The locked set `omar-test` is
run once, for the final configuration, and never chooses anything.

## Rerun

```sh
node evals/import-omar.mjs                     # Omar's splits, hashes checked
node evals/generate-health.mjs --check         # the health suite matches its generator

# one routing iteration (about 15 minutes; answers are cached in /tmp, so an unchanged layer is not paid twice)
node evals/hill.mjs evals/variants/cfg-s03-gate-names.json --per-route 50
# its mandatory tests, five runs in sequence
node evals/hill.mjs evals/variants/cfg-s03-gate-names.json --sets mandatory --runs 5 --concurrency 1 \
  --out evals/runs/mandatory-s03-gate-names.json

node evals/legal.mjs --verbose                 # the legal lookup, no network
node evals/trace.mjs                           # policy rule to verified source to passage, no network

pnpm dev --port 5199                           # the harness, locally
node evals/agent-climb.mjs evals/variants/agent-a0-default.json

node evals/history.mjs                         # runs -> climb-history.json (keep or revert decided here)
node evals/slopes.mjs --docs                   # history -> climb-summary.json and the table in docs/evals.md
```

A new iteration is a new file in `evals/variants/`, a run, and one line in the track's list in `history.mjs`.

## Limits

- The climb was stopped at 04:45 on 21 November with the routing stack at the pre-mask. From 05:30 the complete
  system was measured as one more routing row, `s07-full-stack`: the second classifier exactly as the app ships it
  (`policy/classifier.json`, its counted labels), with its mandatory tests. The locked `omar-test` run on it was started and stopped unfinished at 06:00, so there
  is no locked result. Not run,
  so not results: the classifier variants s04 to s06, the three narrowed policy rules, the policy-first pass per
  pre-mask pattern, keywords against no keywords and the other agent switches. Their configurations are in
  `evals/variants/` and listed under `not_run` in `climb-history.json`.
- The rows before `s07-full-stack` (the policy alone, then the pre-mask) are steps on the way. No document quotes
  them as a result; the numbers to quote are the `headline` object in `climb-summary.json`.
- The classifier costs a second BRANE call per person's message (about 5 to 6 seconds more in a dry run) and it
  is one run on 200 rows, so one row is 1 point of leak rate.
- The two agent runs (with and without the lookup tool) were made before the classifier ran by default, with the
  classifier off. They were not re-measured, and the headline labels them so.
- BRANE is shared. Keep at most three requests in flight (`hill.mjs` does) and run the mandatory tests one at a
  time: BRANE has answered sensitive requests with no detection ([decision log](decision-log.md)). Blank answers
  on sensitive rows are counted per run (`blank_answers`); between two routing rows they are noise no harness
  change causes.
- Routing rows use a fixed sample of `omar-val` (every k-th row per route, 200 of 500) because one request takes
  about 5 seconds whatever the load. With 50 rows per route, one row is 1 point of leak rate. Each row is one run,
  so the keep rule treats a leak-rate change of 2 points or less as no change. The two pre-mask rows were kept for
  fewer names and labelled values sent as typed, not for the leak rate.
- The mandatory tests here are BRANE dry runs graded by `hill.mjs`. The submission's evidence is the live run in
  `submission/test_evidence_run.csv`.
- The 12 agent claims are few and the agent varies between runs: one claim is 8 points of the pass rate, and each
  configuration ran once.
- With and without the lookup tool (pass 83.3% against 25%, one run each): most of the gap is by construction. The
  checks ask for a cited passage, and an agent without lookup has no passage ids to cite, so 9 of 12 claims fail on
  that check or on the missing recommendation. It shows that grounded, cited recommendations depend on lookup; it
  does not measure how much better the advice is. Without lookup 93% of model requests stayed on the frontier model
  against 23% with it: lookup passages in the context trigger the policy's semantic rules and send later turns
  local. That cost is real and was not climbed (the three narrowed policy rules are among the runs not done).
- The pre-mask for names was kept although route macro F1 fell from 0.825 to 0.814: names left as typed fell from
  7.6% to 1.7%, and the leak-rate change (25% to 23%) is inside the noise band.
- The reviewer in the agent eval is a script with fixed answers. It checks that the handoff loop closes and is
  recorded; it says nothing about how good a real handler's decision is.
- The legal glossary was tuned on the 54 dev questions. On the 18 held-out questions recall@3 is lower; both numbers
  are in `climb-summary.json`.
