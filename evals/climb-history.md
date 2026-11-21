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

- BRANE is shared. Keep at most three requests in flight (`hill.mjs` does) and run the mandatory tests one at a
  time: under load BRANE has answered sensitive requests with no detection ([decision log](decision-log.md)).
- Routing rows use a fixed sample of `omar-val` (every k-th row per route, 200 of 500) because one request takes
  about 5 seconds whatever the load. With 50 rows per route, one row is 2 points of leak rate; smaller differences
  are noise, and the keep rule ignores F1 changes under 0.01 and over-block changes under 1 point.
- Most rows are one run. Stability (same route on every run) is only reported where a row ran more than once.
- The 12 agent claims are few and the agent varies between runs: one claim is 8 points of the pass rate.
- The reviewer in the agent eval is a script with fixed answers. It checks that the handoff loop closes and is
  recorded; it says nothing about how good a real handler's decision is.
