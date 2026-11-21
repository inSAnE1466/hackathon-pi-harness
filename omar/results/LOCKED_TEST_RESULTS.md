# Locked held-out test results

Three locked exams, each run **once per predictor**. The system for exams 2 and 3 was chosen and recorded in
`results/selection_round3.json` at **2026-11-21T03:12:31+01:00**, before either exam was touched (hashes in `results/test_ar.sha256`,
`results/test_farm.sha256`; one-run guard in `eval/run_eval.py --final`, log in `results/locks.json`).

## Exam 2: Arabic (test_ar.csv, 200 rows): new language and script
Customers writing in Arabic (MSA + Moroccan / Egyptian colloquial), Arabic-script names; written by an independent author; 0 overlap with any tuning row.

| Predictor | Route F1 | Label F1 | Leak | ID leak | Over-block | n | Run at |
|---|---|---|---|---|---|---|---|
| Keyword baseline | 0.261 | 0.291 | 98.2% | 39.2% | 0.0% | 200 | 2026-11-21T03:21:31 |
| TF-IDF + logistic regression (dev 800) | 0.114 | 0.320 | 0.0% | 0.0% | 100.0% | 200 | 2026-11-21T03:21:44 |
| Our classifier alone (defs v3) | 0.935 | 0.932 | 0.9% | 0.0% | 7.5% | 200 | 2026-11-21T03:17:49 |
| BRANE: team live policy | 0.712 | 0.752 | 36.7% | 7.8% | 5.0% | 200 | 2026-11-21T03:21:30 |
| BRANE: policy v1, no keywords | 0.821 | 0.896 | 21.1% | 11.8% | 2.5% | 200 | 2026-11-21T03:18:33 |
| **Final system: BRANE v1-nokw + classifier defs v3** | 0.917 | 0.930 | 0.0% | 0.0% | 7.5% | 200 | derived: combination of the two locked runs above |

## Exam 3: Farm & agricultural insurance (test_farm.csv, 200 rows): new topic, English
A domain never mentioned before (tractor, livestock, harvest, barn, silo, dairy, crop: 0 mentions in all tuning data); farmers and farm workers.

| Predictor | Route F1 | Label F1 | Leak | ID leak | Over-block | n | Run at |
|---|---|---|---|---|---|---|---|
| Keyword baseline | 0.357 | 0.386 | 83.2% | 31.9% | 15.0% | 200 | 2026-11-21T03:21:46 |
| TF-IDF + logistic regression (dev 800) | 0.619 | 0.506 | 26.5% | 8.5% | 35.0% | 200 | 2026-11-21T03:21:59 |
| Our classifier alone (defs v3) | 0.965 | 0.947 | 2.7% | 0.0% | 0.0% | 200 | 2026-11-21T03:17:53 |
| BRANE: team live policy | 0.648 | 0.721 | 50.4% | 14.9% | 5.0% | 200 | 2026-11-21T03:21:30 |
| BRANE: policy v1, no keywords | 0.773 | 0.814 | 31.0% | 14.9% | 5.0% | 200 | 2026-11-21T03:18:33 |
| **Final system: BRANE v1-nokw + classifier defs v3** | 0.928 | 0.935 | 1.8% | 0.0% | 5.0% | 200 | derived: combination of the two locked runs above |

**Reading it:** BRANE alone leaks 21-31% and sends 12-15% of names/IDs unmasked (e.g. Arabic-script names it does not detect). The final
system leaks 0.0% (Arabic) and 1.8% (farm) with 0% unmasked identifiers: when our classifier finds an identifier BRANE missed, the harness
forces the local model. The keyword baseline collapses (83-98% leak); the word-statistics model does not transfer to Arabic at all.

---

## Exam 1 (retired): test.csv, 200 rows, elderly population, unseen vocabulary
Run once at 23:53-00:00 on 20/21 Nov (results below are final and unchanged). It was then **retired into validation data**
(`data/val_elderly.csv`) after an independent-model label audit showed our answer key treated walkers / stairlifts / care homes /
guardianship as non-health; under the broad Art. 9 reading (CJEU C-184/20) those rows are health data. Its results are reported as
they were; later fixes were tuned on it and measured on exams 2 and 3 instead.

**What this set was:** the final exam. 200 synthetic claims written by a separate author who never saw dev, val, the guidelines or the
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
