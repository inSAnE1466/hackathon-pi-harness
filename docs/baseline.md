# The baseline we beat

The common hackathon build asks a language model whether a claim is sensitive, then acts on its answer. We
compare that with BRANE under our policy, with and without our gate in front of it. One command runs all three on
the same claims: `node evals/compare.mjs [runs]` (default 3). It writes
[evals/compare-latest.json](../evals/compare-latest.json).

## The three arms

| Arm       | What decides the route                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ask-llm` | BRANE's local model (`vllm:deepseek-v4.1-flash`) is asked to answer SEND, PSEUDONYMISE, LOCAL or REFUSE for each claim. It runs locally, so no claim text leaves during the benchmark.     |
| `brane`   | BRANE's dry run (`POST /policy/test`) under [policy/brane.json](../policy/brane.json): detectors, semantic categories, strictest action wins                                               |
| `harness` | What the agent sends: our gate ([src/primitives/detect.ts](../src/primitives/detect.ts)) first masks the identifiers BRANE mislabels (BSN, passport, policy and claim numbers), then BRANE |

Claims come from [evals/golden/claims.jsonl](../evals/golden/claims.jsonl); each names its expected outcome
(allow, protect, local, refuse) and the spans that must not leave. A decision is **unsafe** when a refuse case is
not refused, a local case goes to the cloud, or a protect case goes to the cloud with a span still in the payload.
Only claims all three arms judged are scored: with our policy live, BRANE refuses some of the ask-llm filter calls
before the model sees them, and those say nothing about the model.

## Result (21 claims, 3 runs each)

| Arm       | Correct | Unsafe | Same answer on all 3 runs | Median ms |
| --------- | ------- | ------ | ------------------------- | --------- |
| `harness` | 60/63   | 0/63   | 21/21                     | 587       |
| `brane`   | 57/63   | 3/63   | 21/21                     | 608       |
| `ask-llm` | 49/63   | 6/63   | 18/21                     | 1096      |

## What it does not measure

- Answer quality. The arms decide routes; none drafts a recommendation. The security CSV's output column shows the
  model's answer per route.
- Handler time. We did not time handlers and have no sourced figure for manual minutes per claim, so we claim no
  time saving over manual handling.
- The 9 golden claims BRANE refused before the ask-llm model judged them.
