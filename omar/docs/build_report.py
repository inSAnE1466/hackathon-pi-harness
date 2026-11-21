#!/usr/bin/env python3
"""
Builds the Gezira submission report (HTML -> PDF via headless Chrome) from the result files.
Re-run after new results: python3 docs/build_report.py
"""
from __future__ import annotations

import csv
import html
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
R = ROOT / "results"
OUT_HTML = ROOT / "docs" / "Gezira_Report.html"
OUT_PDF = ROOT / "docs" / "Gezira_Report.pdf"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def load(tag):
    p = R / f"{tag}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def pct(x):
    return "–" if x is None else f"{100 * x:.1f}%"


def f3(x):
    return "–" if x is None else f"{x:.3f}"


def e(s):
    return html.escape(str(s))


def table(head, rows, cls=""):
    h = "".join(f"<th>{e(x)}</th>" for x in head)
    b = "".join("<tr>" + "".join(f"<td>{x}</td>" for x in r) + "</tr>" for r in rows)
    return f'<table class="{cls}"><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'


def results_rows(tags, highlight=()):
    rows = []
    for label, tag in tags:
        r = load(tag)
        if not r:
            continue
        m = r["metrics"]
        lm = m["label_metrics"]
        sup = [l for l in lm if lm[l]["support"] > 0 and l in (r.get("predictable_labels") or lm)]
        lab = sum(lm[l]["f1"] for l in sup) / len(sup) if sup else None
        name = f"<b>{e(label)}</b>" if tag in highlight else e(label)
        rows.append([name, f3(m["route_macro_f1"]), f3(lab), pct(m["leak_rate"]), pct(m["identifier_leak_rate"]),
                     pct(m["over_block_rate"]), "–" if m["calls_per_row"] is None else f"{m['calls_per_row']:.0f}",
                     "–" if not m["mean_latency_ms"] else f"{m['mean_latency_ms'] / 1000:.1f} s", m["n_evaluated"]])
    return rows


RES_HEAD = ["Predictor", "Route F1", "Label F1", "Leak", "ID leak", "Over-block", "Calls/row", "Time/row", "n"]


def slice_rows(tags):
    rows = []
    for label, tag in tags:
        r = load(tag)
        if not r:
            continue
        s = r["metrics"].get("slices") or {}
        g = lambda k, f: f3(s[k][f]) if k in s else "–"
        rows.append([e(label), g("keyword_present", "route_macro_f1"), g("keyword_absent", "route_macro_f1"),
                     g("lang_en", "route_macro_f1"), g("lang_nl_de", "route_macro_f1"), g("short", "route_macro_f1"),
                     g("long", "route_macro_f1")])
    return rows


def gate_rows():
    tests = {t["id"]: t for t in json.loads((ROOT / "tests" / "gate_tests.json").read_text())["tests"]}
    rep = None
    for cand in [R / "gate_repeat_policy_v1_nokw" / "summary.json", R / "gate_repeat_policy_v1_nokw_classifier" / "summary.json"]:
        if cand.exists():
            rep = json.loads(cand.read_text())
    dry = {}
    p = R / "gate_repeat_policy_v1_nokw_classifier" / "run_1.csv"
    if not p.exists():
        p = R / "gate_repeat_policy_v1_nokw" / "run_1.csv"
    if not p.exists():
        p = R / "gate_dryrun_v1.csv"
    if p.exists():
        with open(p, newline="", encoding="utf-8") as f:
            dry = {r["Test ID"]: r for r in csv.DictReader(f)}
    rows = []
    for tid, t in tests.items():
        d = dry.get(tid, {})
        stab = rep["tests"].get(tid) if rep else None
        ex = t["expected"]
        if len(ex) > 150:
            ex = ex[:150].rsplit(" ", 1)[0] + " …"
        rows.append([f"<b>{tid}</b>", e(t["type"]), e(ex), e(d.get("Observed Route", "–")),
                     e(d.get("Pass / Fail", "–")), f"{stab['pass']}/{stab['runs']}" if stab else "–"])
    return rows, rep


def pi_rows():
    rows = []
    for label, tag in [("Teammate live policy (keywords tuned on this benchmark)", "pi_team_live"),
                       ("BRANE v1 no keywords", "pi_v1_nokw"), ("BRANE v3", "pi_v3"),
                       ("BRANE v1 no keywords + harness classifier", "pi_v1_nokw_llm")]:
        p = R / f"{tag}.json"
        if not p.exists():
            continue
        d = json.loads(p.read_text())["summary"]
        cell = lambda k: f"{d[k]['pass']}/{d[k]['n']}" if k in d else "–"
        tot = sum(v["pass"] for v in d.values()); n = sum(v["n"] for v in d.values())
        uns = sum(v["unsafe"] for v in d.values())
        rows.append([e(label), cell("claims"), cell("heldout"), cell("mutated"), f"<b>{tot}/{n}</b>", str(uns)])
    return rows


def matrix_rows():
    with open(ROOT / "submission" / "MAIN_Policy_Matrix_Gezira.csv", newline="", encoding="utf-8") as f:
        rd = list(csv.reader(f))
    return [[f"<b>{e(r[0])}</b>", e(r[1]), e(r[2]), e(r[3]), e(r[7])] for r in rd[1:]]


CSS = """
@page { size: A4; margin: 16mm 15mm 16mm 15mm; }
* { box-sizing: border-box; }
body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color: #1b2330; font-size: 9.6pt; line-height: 1.42; margin: 0; }
h1 { font-size: 22pt; margin: 0 0 4px; letter-spacing: -0.3px; }
h2 { font-size: 13.5pt; margin: 18px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #0b6bcb; color: #0b2545; break-after: avoid; }
h3 { font-size: 10.5pt; margin: 12px 0 4px; color: #0b2545; break-after: avoid; }
p { margin: 4px 0 6px; }
.sub { color: #4a5568; font-size: 10.5pt; }
.meta { color: #4a5568; font-size: 8.8pt; margin-top: 6px; }
.lede { background: #eef5fd; border-left: 4px solid #0b6bcb; padding: 8px 12px; margin: 10px 0; font-size: 10.2pt; }
table { width: 100%; border-collapse: collapse; margin: 6px 0 10px; font-size: 8.4pt; break-inside: auto; }
th { background: #0b2545; color: #fff; text-align: left; padding: 4px 5px; font-weight: 600; }
td { border-bottom: 1px solid #dfe5ee; padding: 3.5px 5px; vertical-align: top; }
tr:nth-child(even) td { background: #f7f9fc; }
tr { break-inside: avoid; }
table.num { break-inside: avoid; }
table.num td:not(:first-child), table.num th:not(:first-child) { text-align: right; white-space: nowrap; }
.small { font-size: 7.8pt; }
.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.card { border: 1px solid #dfe5ee; border-radius: 6px; padding: 8px 10px; background: #fbfcfe; break-inside: avoid; }
.card b.t { display: block; color: #0b2545; margin-bottom: 2px; }
.flow { display: flex; flex-direction: column; gap: 4px; margin: 8px 0; }
.box { border: 1.5px solid #0b6bcb; border-radius: 6px; padding: 6px 10px; background: #fff; }
.box.brane { border-color: #b7791f; background: #fffaf0; }
.box.human { border-color: #2f855a; background: #f0fff4; }
.arrow { text-align: center; color: #0b6bcb; font-size: 10pt; line-height: 1; }
.tag { display: inline-block; padding: 0 5px; border-radius: 3px; font-size: 7.8pt; font-weight: 600; }
.allow { background: #c6f6d5; } .ph { background: #bee3f8; } .loc { background: #feebc8; } .ref { background: #fed7d7; }
.find { margin: 3px 0; padding-left: 14px; text-indent: -14px; }
.find b { color: #0b2545; }
.pb { break-before: page; }
code { font-family: Menlo, monospace; font-size: 8.2pt; background: #f1f4f8; padding: 0 3px; border-radius: 3px; }
.warn { color: #9c4221; }
"""


def build():
    sel = json.loads((R / "selection.json").read_text()) if (R / "selection.json").exists() else {}
    gate, rep = gate_rows()
    locks = json.loads((R / "locks.json").read_text()) if (R / "locks.json").exists() else {}
    test_done = any(k.startswith("FINAL_") for k in locks)
    test_hash = sel.get("test_sha256", "")
    leak = load("check_leakage") or {}

    val_tags = [("Keyword baseline (policy keywords + regex)", "kw_v1_val"),
                ("TF-IDF + logistic regression (dev 800)", "lr800_val"),
                ("Own LLM classifier A: 1 call, 14 labels", "llmA_val"),
                ("Own LLM classifier B: 14 calls, 1 label each", "llmB_val"),
                ("BRANE: team live policy (5 rules)", "brane_team_live_val"),
                ("BRANE: policy v1 with keywords", "brane_v1_val"),
                ("BRANE: policy v1, no keywords (selected)", "brane_v1_nokw_val"),
                ("BRANE: policy v2 narrow, no keywords", "brane_v2_nokw_val"),
                ("BRANE: policy v3 (v2 + dev fixes)", "brane_v3_val"),
                ("Harness pre-tokeniser + BRANE v3", "hbrane_v3_val")]
    v500_tags = [("Keyword baseline", "v500_kw"), ("TF-IDF + logistic regression (dev 800)", "v500_lr800"),
                 ("Own LLM classifier A", "v500_llmA"),
                 ("BRANE v4 (team live + Art. 10), run 1", "v500_brane_v4_r1"), ("BRANE v4, run 2", "v500_brane_v4_r2"),
                 ("BRANE v1 no keywords, run 1", "v500_brane_v1_nokw_r1"), ("BRANE v1 no keywords, run 2", "v500_brane_v1_nokw_r2"),
                 ("BRANE v4 + classifier (stricter wins)", "v500_combo_v4"),
                 ("BRANE v1-nokw + classifier (stricter wins): selected", "v500_combo_v1_nokw")]
    test_tags = [("Keyword baseline", "FINAL_kw_v1_test"), ("TF-IDF + logistic regression", "FINAL_lr800_test"),
                 ("Own LLM classifier A", "FINAL_llmA_test"), ("BRANE: team live policy", "FINAL_brane_team_live_test"),
                 ("BRANE: policy v1, no keywords (selected)", "FINAL_brane_v1_nokw_test"),
                 ("BRANE v1-nokw + classifier, stricter wins (final system)", "FINAL_combo_test")]
    dev_tags = [("BRANE v1 with keywords", "brane_v1_dev"), ("BRANE v1, no keywords", "brane_v1_nokw_dev"),
                ("BRANE v2 narrow, no keywords", "brane_v2_nokw_dev")]

    test_section = (table(RES_HEAD, results_rows(test_tags, {"FINAL_combo_test"}), "num")
                    + "<h3>Where it works: route F1 by slice (test)</h3>"
                    + table(["Predictor", "Keyword present", "Keyword absent", "English", "Dutch / German", "Short", "Long"],
                            slice_rows(test_tags), "num")) if test_done else \
        '<p class="warn">Test runs pending: re-run <code>python3 docs/build_report.py</code> after <code>results/FINAL_*.json</code> exist.</p>'

    html_doc = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Gezira Claims Privacy Harness</title>
<style>{CSS}</style></head><body>

<h1>Claims Privacy Harness on BRANE</h1>
<div class="sub">Team Gezira · MAIN Summit 2026 · AI-Z Challenge Track · Maastricht</div>
<div class="meta">Omar · Frederick · Hussein &nbsp;|&nbsp; fictional insurer Maasverzekeringen N.V. &nbsp;|&nbsp; synthetic data only &nbsp;|&nbsp; code: <code>omar/</code> in hackathon-pi-harness</div>

<div class="lede"><b>Employees use frontier AI on insurance claims, sensitive data never leaves the company, and a human makes every decision.</b>
BRANE stops data leaving; our harness makes the AI do useful claims work inside those limits, and proves it with a gate test suite and a
leakage-guarded evaluation.</div>

<h2>1. Problem</h2>
<div class="grid">
<div class="card"><b class="t">Business</b>Claims handlers want AI to summarise claims, check coverage and draft letters. Claims are full of
names, IBANs, BSNs, health details (sick leave, operations, a child in hospital), police reports, and decisions with legal effect.
Today insurers either block AI (slow, and staff use personal chatbots anyway) or send everything to the cloud.</div>
<div class="card"><b class="t">Legal</b>Identifiers: GDPR Art. 5(1)(c), 25, 32; pseudonymised data stays personal data (Recital 26, EDPB Guidelines 01/2025).
Health: Art. 9(1), 4(15), UAVG Art. 30(3). Criminal data: Art. 10, UAVG Art. 31-33. BSN: Art. 87, UAVG Art. 46.
Automated decisions: Art. 22, UAVG Art. 40, WP251rev.01, CJEU C-634/21. Life/health pricing: AI Act Annex III 5(c), Art. 14.
Discrimination: Art. 9, Charter Art. 21, C-236/09 (Test-Achats). Injection: Art. 32, AI Act Art. 15(5), OWASP LLM01.</div>
</div>

<h2>2. What we built</h2>
<div class="flow">
<div class="box">Claims handler pastes a synthetic claim and picks a task (intake summary, customer letter, or custom instruction).</div>
<div class="arrow">▼</div>
<div class="box"><b>Harness</b>: pre-tokenises company references (CLM-…, MV-POL-…, KL-…) and checksum-valid BSNs locally ·
<b>pre-flight</b> <code>POST /policy/test</code>: unreachable, error or no decision means <b>not sent</b> (fail closed) ·
endpoint allow-list: the harness can only talk to BRANE, never directly to a model.</div>
<div class="arrow">▼</div>
<div class="box brane"><b>BRANE AIF</b> <code>/chat/completions</code>: 25 built-in detectors + our semantic rules, strictest action wins:
<span class="tag allow">allow → cloud</span> <span class="tag ph">placeholder → PERSON_REF_1 → cloud → restored</span>
<span class="tag loc">local → internal GPU</span> <span class="tag ref">refuse → HTTP 422</span></div>
<div class="arrow">▼</div>
<div class="box human"><b>Human</b>: X-Brane headers verified (missing → answer discarded) · handler <b>Approves / Edits / Rejects</b> every draft ·
on 422 the case is escalated with the reason (Art. 22 decision, injection, discrimination, bulk export) · the AI never decides or sends ·
audit log stores claim hash, route, headers, policy fingerprint, reviewer, decision (no claim text).</div>
</div>

<h2>3. Policy: from research to rules</h2>
<p>Five tiers, strictest label wins: <span class="tag allow">0 cloud</span> no sensitive data ·
<span class="tag ph">1 placeholder</span> identifiers · <span class="tag loc">2 local</span> health, third-party health, mental health,
work incapacity, criminal data · <span class="tag ref">3 refuse + human</span> autonomous decision ·
<span class="tag ref">4 refuse</span> discrimination, bulk export, injection. The full matrix (18 rules, article-level sources,
BRANE setting, agent/human handling, product gap, test ID) is in <code>submission/MAIN_Policy_Matrix_Gezira.csv</code>; summary:</p>
{table(["Rule", "Scenario", "Source", "Action", "Test"], matrix_rows(), "small")}

<h2 class="pb">4. Security gate (official brief) and team edge cases</h2>
<p>Dry runs on live BRANE (<code>POST /policy/test</code>) with the exact outgoing cloud payload checked for every protected value.
T5 simulates BRANE being unavailable three ways (closed port, HTTP 503, 200 without a decision): the request is never sent and
no model endpoint is reached. Final system = BRANE policy v1-nokw + harness classifier (stricter route wins). T5 is covered both ways the official sources
define it: T5a special category (participant brief) and T5b check unavailable (five-tests template, track description).
Stability column: the whole suite repeated three times, because BRANE's semantic judge and the classifier are LLMs.</p>
{table(["ID", "Test", "Expected", "Observed (final system)", "Result", "Stable over repeats"], gate, "small")}

<h2>5. Evaluation design: understanding, not keyword copying</h2>
<div class="grid">
<div class="card"><b class="t">Splits kept apart on four axes</b>
dev 800 (tune, train) · val 80 (choose) · test 200 (held out, one run per predictor) · gold ~40 (human, one run, pending).
Test differs from dev in <b>author</b> (separate fragment bank, never saw dev or the policies), <b>vocabulary</b>
(Half B terms only: ICD-10 / WHO-ATC derived, e.g. lithium, knee reconstruction, UWV), <b>population</b> (65+ vs working-age)
and <b>entities</b> (disjoint names, IBAN banks, ID ranges). Test sha256 <code>{e(test_hash[:16])}…</code> recorded before any run.</div>
<div class="card"><b class="t">Checked, not assumed</b>
<code>eval/check_leakage.py</code>: no Half B term in tuning material, no shared IBAN / claim number / email, no shared 8-word sequence
between held-out and tuning rows, no elderly scenarios in dev (PASS). 45-59% of sensitive dev/val rows contain no keyword at all;
tricky negatives (a dog's therapy at the vet, a Turkish restaurant flooded) test over-blocking.</div>
</div>
<p><b>Predictors</b> (same 14 labels, same deterministic label→route code): keyword rules (the floor) · TF-IDF + logistic regression ·
own LLM classifier on BRANE's local GPU (A: one call, B: one call per label; a local-only draft policy guarantees nothing leaves) ·
BRANE policies · combinations (stricter route wins). <b>Metrics</b>: route macro F1, label macro F1, leak rate (local/refused rows sent
to cloud), identifier leaks, over-block (benign rows not sent to cloud), cost and latency, slices.</p>

<h2>6. Results</h2>
<h3>Round 2: selection on val 500 (final decision)</h3>
{table(RES_HEAD, results_rows(v500_tags, {"v500_combo_v1_nokw"}), "num")}
<p class="small">Recorded in <code>results/selection_round2.json</code>. BRANE passes were repeated twice (run-to-run variance). Winner:
<b>BRANE policy v1-nokw + harness classifier, stricter route wins</b>; it was already on the round-1 pre-registered reference list and
was run once on test (table below: 1.0% leak). The larger val now agrees with test (BRANE alone ~16% leak), unlike the 80-row val.</p>
<h3>Round 1: selection on val (80 rows)</h3>
{table(RES_HEAD, results_rows(val_tags, {"brane_v1_nokw_val"}), "num")}
<p class="small">Selection rule, recorded in <code>results/selection.json</code> before any test run: minimise leak, then over-block, then route F1.
Winner: BRANE with policy v1 without keywords.</p>
<h3>Held-out test (200 rows, elderly population, unseen vocabulary): one run each</h3>
{test_section}
<h3>Independent cross-check: the teammate's benchmark (200 rows, their grading rule)</h3>
<p class="small">30 golden claims, 20 held-out claims and 150 adversarial rewrites (lowercase, padding, line breaks, politeness, embedded
"pre-clearance" notes), written by a teammate who never saw our data. Pass = acceptable route and no annotated sensitive span in the cloud
payload. Unsafe = a sensitive span or local/refuse case reached the cloud.</p>
{table(["Policy", "Claims 30", "Held-out 20", "Adversarial 150", "Total", "Unsafe"], pi_rows(), "num")}
<h3>The keyword experiment (dev, 200 rows)</h3>
{table(RES_HEAD, results_rows(dev_tags), "num")}

<h2>7. Findings</h2>
<p class="find"><b>0. Held-out headline: defence in depth.</b> On the held-out test (unseen vocabulary, 65+ population, separate author) the
pre-registered winner, BRANE with policy v1-nokw, leaked <b>21.6%</b> of sensitive rows although it leaked 0% on val: every leak was health-type
(care homes, guardians, unseen conditions and medicines). Our harness classifier (one local-LLM call, 14 labels) leaked 5.2%, but only
decision / discrimination / injection rows. The errors are complementary, so the pre-registered combination "BRANE + harness classifier,
stricter route wins" leaked <b>1.0%</b> (1 row: a Dutch proxy for refugee status) at 13% over-block. Lesson: val was too close to dev to predict
generalisation; the four-axis test exposed it. Round 2 on a 500-row val confirmed this (BRANE alone ~16% leak, combination 0.8%) and selected the combination as the final system.
Recommendation: run BRANE plus the harness classifier in production; confirm on the human gold set.</p>
<p class="find"><b>1. BRANE semantic keywords act as hard triggers.</b> Every over-block of policy v1 on val was <code>matchedVia: keyword</code>
("Ziekenhuis Maasoever" as a business client, "Operation Hagelschlag", a phishing warning containing "verdachte"). Removing keywords and
relying on the GPU judge with good descriptions cut over-blocking on dev from 30% to 0% and raised route F1 from 0.74 to 0.92-0.96.</p>
<p class="find"><b>2. Narrow rules only win without keywords.</b> With keywords, 14 narrow rules (v2) lost to 6 broad ones (more lists, more false
triggers). Without keywords v2 scored highest on dev (0.963), but on val v1-nokw generalised better (0 leaks), so v1-nokw was selected.</p>
<p class="find"><b>3. A keyword copier collapses on unseen wording.</b> The keyword baseline leaked 100% of sensitive val rows that contain no
guideline keyword; the selected BRANE policy and the LLM classifier did not depend on keywords (slice table).</p>
<p class="find"><b>4. One LLM call beats fourteen.</b> Classifier A (one call, all labels) matched B's route F1 (0.938) with higher label F1,
a third of the over-blocking, 1/14 of the calls and ~12x lower latency.</p>
<p class="find"><b>5. More data helps learned baselines, but not enough.</b> TF-IDF + LR went from 0.725 to 0.808 route F1 (dev 200 → 800);
leak fell from 38% to 15%, still far from 0: usable as a second opinion, never as the enforcer.</p>
<p class="find"><b>6. The teammate's live policy leaks criminal data.</b> It has no Art. 10 rule: gate test E3 (named suspect, previous convictions)
went to the cloud, and it leaked 8.8% of sensitive val rows.</p>

<h2>8. Product gaps observed live (BRANE)</h2>
<p class="find">· No native human-approval action (semantic rules only local / refuse); approval lives in agent code.</p>
<p class="find">· No "drop span" action: an unnecessary medical remark forces the whole turn local (T2b).</p>
<p class="find">· Placeholder spans swallow the preceding space (<code>policyholderPERSON_REF_1</code>), slightly degrading cloud answers.</p>
<p class="find">· IBANs and company references are labelled <code>ACCOUNT_NUMBER</code>; category-level policies depend on consistent labels.</p>
<p class="find">· Detector drift: within one evening Presidio began tagging ordinary words ("Which", "Beschrijf") as PERSON (0.85), turning 27 benign
dev rows into redacted ones; a Dutch name and BSN were missed in another row (the harness now tokenises checksum-valid BSNs itself).</p>
<p class="find">· <code>PASSWORD</code> false positives on Dutch words ("sleutels" = keys, "inlogcode") turn harmless requests into 422s under a refuse rule.</p>
<p class="find">· No native Art. 10 category, no volume rule, no per-step rules, injection threshold not configurable, undocumented
behaviour when BRANE's own detectors or GPU are down.</p>

<h2>9. Limitations</h2>
<p>All data is synthetic and LLM-drafted except the pending human gold set; labels were validated by scripts and reviewed, not double-annotated
(gold will report Cohen's kappa). BRANE's semantic judge varies between runs and its detectors drifted during the evening; comparisons
are made within the same time window and the gate suite is repeated. Val was drawn closer to dev than test is, so val
overestimated BRANE's generalisation (0% vs 21.6% leak). With only 34 sensitive val rows, "0 leaks" is compatible with a
true leak rate of up to ~9% (rule of three); val was therefore grown to 500 rows (dev 800 / val 500 / test 200) for the final decision; the production recommendation (combination) is informed by test and must be
confirmed on the untouched human gold set before it is final. Legal citations are to be verified by the team's lawyers before reliance.
Results are dry runs (<code>/policy/test</code>); live <code>/chat/completions</code> header evidence follows once the team applies the selected policy.</p>

<h2>10. Reproduce</h2>
<p><code>python3 gezira_claims_agent.py --tests --repeat 3 --policy policy/policy_v1_nokw.json</code> ·
<code>python3 eval/check_leakage.py</code> · <code>python3 eval/run_eval.py --data data/val.csv --backend brane --policy policy/policy_v1_nokw.json --tag x</code> ·
<code>python3 docs/build_report.py</code>. Python 3.9 standard library only; key via <code>BRANE_API_KEY</code>, never committed.</p>
</body></html>"""
    OUT_HTML.write_text(html_doc, encoding="utf-8")
    if Path(CHROME).exists():
        subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                        f"--print-to-pdf={OUT_PDF}", OUT_HTML.as_uri()], check=True,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
        print(f"PDF -> {OUT_PDF}")
    else:
        print(f"Chrome not found; open {OUT_HTML} and print to PDF")


if __name__ == "__main__":
    build()
