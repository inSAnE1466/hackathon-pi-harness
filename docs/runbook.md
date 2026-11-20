# Demo day runbook

Everything to check and run on Saturday morning, in order. Each command prints its own result; a non-zero exit is a
failure.

## 30 minutes before

1. Pull and install.

   ```sh
   git pull && npx -y pnpm@11.15.1 install
   ```

2. BRANE policy matches the file, and the organizers' tests pass.

   ```sh
   node scripts/brane-policy.mjs diff     # "categories to change: none"
   node scripts/brane-cases.mjs           # 10/10 pass, writes submission/test_evidence_run.csv
   ```

   If `diff` shows changes, a teammate edited the workbench. Run `node scripts/brane-policy.mjs apply`.

3. The golden set and the benchmark.

   ```sh
   node evals/golden.mjs                  # 0 spans leaked
   node evals/compare.mjs 3               # harness 0 unsafe, 21/21 stable (about 2 minutes)
   ```

4. The deployed agent end to end.

   ```sh
   node evals/agent.mjs https://claims-harness.fred-755.workers.dev    # 7/7 agent cases pass (about 4 minutes)
   ```

5. Regenerate the submission files from the current policy.

   ```sh
   node scripts/policy-matrix.mjs
   ```

## After any change

```sh
node evals/qc.mjs                                                   # BRANE suites vs the accepted baseline
node evals/qc.mjs --agent https://claims-harness.fred-755.workers.dev   # plus the deployed agent
```

Keep a change only on `PASS`. After a deliberate improvement, `node evals/qc.mjs --accept` records the new baseline
in `evals/baseline.json`, and the change and the new baseline go in the same commit.

## Autonomous QC loop

```sh
scripts/qc-loop.sh        # prints its log path (/tmp/qc-loop-*.log); 15 to 30 minutes; non-zero on regression
```

One command runs three steps:

1. `node evals/propose.mjs` reads the failures from the last QC run (`evals/qc-latest.json`), groups leaked spans
   by semantic category and variant, and writes `evals/candidates.json`: the leaked phrases as keywords, and one
   description sentence. No model call; the held-out set is never proposed from.
2. `node evals/climb.mjs` applies each candidate to the live department, scores it, and keeps it only on a strict
   improvement confirmed by a second scoring. On SIGINT, SIGTERM or a crash it reapplies the original policy. It
   writes `evals/climb-latest.md`.
3. `node evals/qc.mjs` compares the result with `evals/baseline.json`, and `node scripts/brane-policy.mjs diff`
   must show nothing to change.

BRANE's semantic matching varies between runs, so every score is the worst of N: golden and held-out sets 3 runs,
the mutated set (`--set=mutated --harness`) 2 runs. A claim passes only if every run passed. A dry run that still
fails after a 20 s timeout and 2 retries counts as a failure. `node evals/qc.mjs --cache` reuses the dry runs of
the exact same policy from `/tmp/brane-dryrun-cache` (a changed policy never reads them); the climb never caches. The department is shared with teammates: do not edit
the workbench while the loop runs. If the loop is killed with `kill -9`, run `git checkout policy/brane.json &&
node scripts/brane-policy.mjs apply`.

## Hand-in (10:30 CET)

| Deliverable                 | File                                                                      |
| --------------------------- | ------------------------------------------------------------------------- |
| Policy matrix               | `submission/MAIN_Policy_Matrix.csv`                                       |
| Tests T1 to T5 and E1 to E5 | `submission/test_evidence_run.csv`                                        |
| Legal research              | `docs/sources.md`, `docs/decisions.md`, the policy matrix's source column |
| Live demo and business case | the deployed app, `demo/`                                                 |

## If something breaks during the demo

| Symptom                                  | Cause                                       | What to do                                                                                |
| ---------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Sign-in page loops                       | Cookie blocked                              | Use a private window; the password is in `.dev.vars`                                      |
| Every turn fails with "Connection error" | BRANE is down or the key changed            | That is the check-failure test working: show the `withheld` row, then switch to the video |
| A health claim never uses the cloud      | Intake's fact sheet failed BRANE's re-check | Expected sometimes; the decision log shows `kept local`. Point to it as the safe fallback |
| The workbench shows a different policy   | A teammate saved in the workbench           | `node scripts/brane-policy.mjs apply`                                                     |
| Venue Wi-Fi fails                        |                                             | Play the video in `demo/video/`                                                           |

## Never on stage

- Never type the BRANE key or the password where the screen is shared.
- Never paste real personal data; use the sample claims.
