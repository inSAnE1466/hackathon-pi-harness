# Gezira datasets (omar/)

All rows are **synthetic**. Labels: 14 yes/no columns -> `gold_tier` -> `gold_route` (computed in code, see `data/company_guidelines.md`).

| File | Rows | Use | Written by | Vocabulary | Population | Entities |
|---|---|---|---|---|---|---|
| `data/dev.csv` | **800** | tune policy descriptions, train baselines | dev-001..200 free-form LLM drafting; dev-201..800 `generator/compose.py` from `bank_dev.json` | Half A | working-age | dev pools, CLM-2026-1000..4999 |
| `data/val.csv` | 80 | **choose** between policies / classifiers / combinations | separate author, different styles (WhatsApp, broker mail, OCR, notes) | Half A | mixed | own |
| `data/test.csv` | 200 | **held out: one run per predictor**, sha256 recorded before any run | `compose.py` from `bank_test.json`, author never saw dev/val/guidelines/policies | **Half B** | **65+** | test pools, CLM-2026-6000..9999 |
| `data/gold.csv` | ~40 (to write) | held out, human-labelled, one run | teammates, from `gold_briefs.md` only | Half B | mixed | own |

Test sha256 (recorded before any run): `42b87bc53972df681983214a5bad1ce63ece328574fa44794b6be213ff75380d`. **Do not tune anything on test or gold.**

Separation is checked, not assumed: `python3 eval/check_leakage.py` fails on any Half B term in tuning material, any shared IBAN / claim-policy-customer number / email, or any shared 8-word sequence between held-out and tuning rows (current result: PASS; warnings only for the 5 shared test BSNs from the small allowed list and one name-regex false positive).

`data/vocab_split.json`: Half A terms may appear in guidelines, policy keywords and dev/val; Half B terms only in test/gold (health terms from ICD-10 chapters, medicines from the WHO ATC classification). Rows with no keyword at all are marked `no-keyword` in `notes`; tricky negatives (trigger words in harmless context) are marked `tricky negative`.
