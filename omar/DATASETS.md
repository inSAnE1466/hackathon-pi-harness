# Gezira datasets (omar/)

All rows are **synthetic**. Labels: 14 yes/no columns -> `gold_tier` -> `gold_route` (computed in code, see `data/company_guidelines.md`).

| File | Rows | Use | Written by | Vocabulary | Population | Entities |
|---|---|---|---|---|---|---|
| `data/dev.csv` | **800** | tune policy descriptions, train baselines | dev-001..200 free-form LLM drafting; dev-201..800 `generator/compose.py` from `bank_dev.json` | Half A | working-age | dev pools, CLM-2026-1000..4999 |
| `data/val.csv` | **500** | **choose** between policies / classifiers / combinations | val-001..200 free-form (separate author, styles: WhatsApp, broker mail, OCR, voice memo, handler chat); val-201..500 composed from a **third independent bank** (`bank_val.json`, 84% keyword-free) | Half A / no keyword | working-age + middle-aged | own pools, CLM-2026-5xxx / 5xxxx |
| `data/test.csv` | 200 | **held out: one run per predictor**, sha256 recorded before any run | `compose.py` from `bank_test.json`, author never saw dev/val/guidelines/policies | **Half B** | **65+** | test pools, CLM-2026-6000..9999 |
| `data/audit/test_label_audit_50.csv` | 50 | **human check of the AI-written answer key** (agree / disagree per row), scored by `eval/audit.py` | 1-2 teammates | – | – | – |

Test sha256 (recorded before any run): `42b87bc53972df681983214a5bad1ce63ece328574fa44794b6be213ff75380d`. **Do not tune anything on test.**

Separation is checked, not assumed: `python3 eval/check_leakage.py` fails on any Half B term in tuning material, any shared IBAN / claim-policy-customer number / email, or any shared 8-word sequence between held-out and tuning rows (current result: PASS; warnings only for the 5 shared test BSNs from the small allowed list and one name-regex false positive).

`data/vocab_split.json`: Half A terms may appear in guidelines, policy keywords and dev/val; Half B terms only in test/gold (health terms from ICD-10 chapters, medicines from the WHO ATC classification). Rows with no keyword at all are marked `no-keyword` in `notes`; tricky negatives (trigger words in harmless context) are marked `tricky negative`.

**Split ratio:** dev 800 / val 500 / test 200 (+ human gold). val was grown from 80 to 500 after the 80-row val proved too small to predict generalisation (0% leak on val vs 21.6% on test for the same policy). Test was not touched.

No hand-written gold set was made (no time before the deadline); the 50-row label audit replaces it as the human check.
