# The harness as an environment

We hill-climb the harness, not a model. The models (BRANE's cloud and local models) stay fixed; what changes is the
harness configuration around them, and every change is scored against rewards that code checks.

## The loop

| Part                               | In this harness                                                                                                                                                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Episode                            | One synthetic claim, one fresh session (one Durable Object conversation, no shared memory)                                                                                                                                                                                     |
| What can change (the action space) | The BRANE policy (`policy/brane.json`: category actions, semantic category descriptions and keywords, sensitivity), the gate's identifier patterns (`src/primitives/detect.ts`), the corpus (`corpus/`), the agent's instructions and tools (`src/chat.ts`, `src/primitives/`) |
| Reward                             | Checked by code, never by a model: spans leaked, routes correct, controls over-blocked, organizers' tests passed, passages retrieved, agent handoffs and outcomes                                                                                                              |
| Held-out data                      | Our held-out set and Omar Shalaby's hash-locked test set are never used to choose a change, only to confirm one                                                                                                                                                                |
| Noise                              | BRANE's semantic judge varies run to run, so every claim is scored worst of N and a win must survive a second scoring                                                                                                                                                          |
| Safety                             | Candidates are scored as BRANE drafts (`--policy`), so the shared live department changes only when a winner is applied                                                                                                                                                        |

## Rewards and the command that measures each

| Reward                                                   | Command                                                    | Current (claims-v6.1)           |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| No sensitive span leaves (tuning set)                    | `node evals/golden.mjs --runs 3`                           | 29/30 claims, 0/53 spans leaked |
| Held-out generalisation                                  | `node evals/golden.mjs --set=heldout --runs 3`             | 20/20, 0/33                     |
| Adversarial variants                                     | `node evals/golden.mjs --set=mutated --harness --runs 2`   | 145/150, 2/265                  |
| Omar's gate tests                                        | `node evals/golden.mjs --set=omar-gate --runs 2`           | 11/11                           |
| Omar's locked test (unseen vocabulary, 65+)              | `node evals/golden.mjs --set=omar-test --harness --runs 2` | 170/200                         |
| Organizers' tests                                        | `node scripts/brane-cases.mjs`                             | 10/10                           |
| Retrieval for claims questions                           | `node evals/retrieval.mjs`                                 | 22/22 in the top 3              |
| The agent end to end                                     | `node evals/agent.mjs <url>`                               | 7/7                             |
| Against the base case (asking a model what is sensitive) | `node evals/compare.mjs 3`                                 | 0/63 unsafe vs 6/63             |

## The climb

`scripts/qc-loop.sh` runs one iteration: `evals/propose.mjs` reads the latest failures and writes candidate changes,
`evals/climb.mjs` scores each and keeps only strict, confirmed improvements, `evals/qc.mjs` fails on any regression
against `evals/baseline.json`. Every kept and rejected change is a row in `evals/decision-log.md`, for example:

- claims-v3 kept: the health rule names injuries and hospitals (2 leaks closed).
- claims-v5 broad rewrite rejected: 4 leaks reappeared.
- claims-v6 kept: Omar's criminal-data rule (his gate 10/11 to 11/11, his locked test 163 to 170 of 200).
- claims-v7 rejected: removing all keywords leaked 2 held-out spans.

## What to climb next

1. A harness-side classifier whose route wins when stricter than BRANE's. Omar measured it on his locked test:
   BRANE alone leaked 21.6% of sensitive rows, BRANE plus a classifier 1.0%. The 30 rows claims-v6 still fails on his
   set (17 health rows sent to the cloud, 10 forbidden requests protected instead of refused) are its target.
2. Proposals written from failures by a model and scored by the same rewards (GEPA-style reflective search) instead
   of the keyword proposer.
3. Agent instructions and tool descriptions as part of the action space, scored by `evals/agent.mjs` and an outcome
   check on each claim's deliverable.
