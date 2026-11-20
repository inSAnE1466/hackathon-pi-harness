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
