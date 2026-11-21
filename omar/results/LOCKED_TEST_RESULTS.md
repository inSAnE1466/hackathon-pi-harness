# Locked held-out test results (test.csv, 200 rows)

**What this set is:** the final exam. 200 synthetic claims written by a separate author who never saw dev, val, the guidelines or the
policies; unseen vocabulary (ICD-10 / ATC derived "Half B" terms); elderly (65+) population; disjoint names, banks and ID ranges.
0 of its 97 sensitive rows contains any guideline or policy keyword.

**Proof that it was not tuned on:**
- test sha256 `42b87bc53972df681983214a5bad1ce63ece328574fa44794b6be213ff75380d`, recorded in the README before any run
- winner chosen on val and recorded in `results/selection.json` at **2026-11-20T23:52:24+01:00**, before the first test run
- each predictor ran **once** on test (`results/locks.json`; a second run of the same predictor is refused by `eval/run_eval.py --final`)

| Predictor | Route F1 | Label F1 | Leak | ID leak | Over-block | Calls/row | Time/row | n | Run at |
|---|---|---|---|---|---|---|---|---|---|
| Keyword baseline | 0.260 | 0.283 | 100.0% | 44.2% | 0.0% | 0 | 0.0 s | 200 | 2026-11-20T23:53:36 |
| TF-IDF + logistic regression (trained on dev 800) | 0.478 | 0.377 | 58.8% | 9.3% | 28.3% | 0 | 0.0 s | 200 | 2026-11-20T23:53:42 |
| Own LLM classifier A (1 call, 14 labels) | 0.884 | 0.914 | 5.2% | 0.0% | 13.3% | 1 | 6.5 s | 200 | 2026-11-21T00:00:28 |
| BRANE: team live policy (5 rules) | 0.683 | 0.765 | 43.3% | 0.0% | 1.7% | 1 | 1.5 s | 200 | 2026-11-20T23:54:58 |
| BRANE: policy v1, no keywords (selected on val) | 0.770 | 0.864 | 21.6% | 0.0% | 3.3% | 1 | 1.4 s | 200 | 2026-11-20T23:53:35 |
| **BRANE v1-nokw + classifier, stricter wins (final system)** | 0.809 | 0.884 | 1.0% | 0.0% | 13.3% | 2 | 6.5 s | 200 | derived: combinatio |

Metrics: **route F1** = did each row go to the right place (cloud / cloud with placeholders / local / refused), macro-averaged;
**leak** = rows that should stay local or be refused but reached the cloud; **ID leak** = rows that should be pseudonymised but reached the
cloud with raw names or numbers; **over-block** = harmless rows kept local or refused. Label F1 over the labels each predictor can produce.

**Reading it:** the keyword baseline collapses on unseen words (100% leak), BRANE alone leaks health described in everyday elderly
contexts (21.6%), our classifier's errors are different ones (decisions, discrimination, injection), so the combination leaks **1.0%**
(1 of 97 sensitive rows). Round-2 selection on val 500 later confirmed the same final system (`results/selection_round2.json`); test
was not run again.

**Caveat (label audit):** an independent model (Claude Haiku) relabelled 50 test rows blind: 82% agreement, kappa 0.73. Its 9
disagreements are elderly rows with assistive devices / care home / guardianship that this answer key treats as non-health. Under a
broad Art. 9 reading (CJEU C-184/20) the final system would leak 8 of those 9; see `results/model_audit.json` and PDF finding 7.

Raw per-row predictions: `results/FINAL_*_test.predictions.csv`; full metrics incl. confusion matrices and slices: `results/FINAL_*_test.json`.
