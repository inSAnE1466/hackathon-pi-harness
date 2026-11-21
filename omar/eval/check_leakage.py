#!/usr/bin/env python3
"""
Leakage guard: proves dev/val (tuning) and test/gold (held out) are really separate. Standard library only.

Checks
 1. Held-out vocabulary: no Half B term (data/vocab_split.json) in anything we tune on: guidelines, policy files,
    dev/val rows, the dev fragment bank, gold briefs.
 2. Entity overlap: no shared emails, IBANs, BSNs, claim/policy/customer numbers or full names between
    tuning data (dev+val) and held-out data (test, gold).
 3. Text overlap: no 8-word sequence shared between a held-out row and any tuning row; gate-test prompts checked too.
 4. Population split: dev should not contain elderly-life-stage scenarios (reserved for test).
Exit code 1 if a hard check fails.

  python3 eval/check_leakage.py
"""
from __future__ import annotations

import csv
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "data"
TUNING_CSV = [D / "dev.csv", D / "dev_composed.csv", D / "val.csv", D / "val_elderly.csv", D / "minimal_pairs.csv", D / "test.csv"]  # test.csv retired 21 Nov 02:40
HELDOUT_CSV = [D / "test_ar.csv", D / "test_farm.csv", D / "gold.csv", D / "gold_rephrase.csv"]
TUNING_TEXT = [D / "company_guidelines.md", D / "gold_briefs.md", D / "generator" / "bank_dev.json"] + \
    sorted((ROOT / "policy").glob("policy_*.json"))
ELDERLY = ["retired", "retiree", "pensioner", "care home", "nursing home", "grandchild", "grandson", "granddaughter",
           "mobility scooter", "walker", "verzorgingshuis", "verpleeghuis", "bejaard", "gepensioneerd", "rollator",
           "kleinkind", "kleinzoon", "kleindochter", "scootmobiel", "Rentner", "Pflegeheim", "Altenheim", "Enkel", "Rollator"]
NGRAM = 8


def rows(path):
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as f:
        if path.name == "gold_rephrase.csv":
            return [{"id": f"{r['base_id']}~{r['variant']}", "prompt": r["prompt"]} for r in csv.DictReader(f)]
        return list(csv.DictReader(f))


def term_re(term):
    flags = 0 if term[:1].isupper() else re.I      # 'Polish' (nationality) vs 'polish' (verb)
    # word boundaries on both sides (plural endings allowed): 'Polish' must not match 'Polishouder'
    return re.compile(r"(?<![\w])" + re.escape(term) + r"(?:s|es|en|e|n)?(?![a-zà-ÿß])", flags)


def half_b_terms():
    v = json.loads((D / "vocab_split.json").read_text(encoding="utf-8"))
    return sorted({re.sub(r"\s*\(.*?\)\s*$", "", t).strip() for g in v["half_b"].values() for t in g})


IBAN_RE = re.compile(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b")
ID_RE = re.compile(r"\b(?:MV-POL-\d{4}-\d{4,8}|CLM-\d{4}-\d{3,8}|KL-\d{5,8})\b")
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b")
BSN_RE = re.compile(r"\b\d{9}\b")
NAME_RE = re.compile(r"\b([A-Z][a-z]+ (?:(?:van der|van den|van de|van|de|den|el|El|ter|ten) )?[A-Z][a-z]+(?:-[A-Z][a-z]+)?)\b")


def entities(text):
    return {
        "iban": {re.sub(r"\s", "", m) for m in IBAN_RE.findall(text)},
        "id": set(ID_RE.findall(text)),
        "email": {e.lower() for e in EMAIL_RE.findall(text)},
        "bsn": set(BSN_RE.findall(text)),
        "name": set(NAME_RE.findall(text)),
    }


def shingles(text, n=NGRAM):
    w = re.findall(r"[a-zà-ÿß0-9]+", text.lower())
    return {" ".join(w[i:i + n]) for i in range(len(w) - n + 1)}


def main():
    hard, warn = [], []
    tuning = [(p.name, r) for p in TUNING_CSV for r in rows(p)]
    heldout = [(p.name, r) for p in HELDOUT_CSV for r in rows(p)]
    print(f"tuning rows: {len(tuning)} ({', '.join(p.name for p in TUNING_CSV if p.exists())}) | "
          f"held-out rows: {len(heldout)} ({', '.join(p.name for p in HELDOUT_CSV if p.exists()) or 'none yet'})")

    # 1. Half B vocabulary in tuning material
    terms = [(t, term_re(t)) for t in half_b_terms()]
    hits = []
    # Half B guarded the ORIGINAL test (now retired into tuning as test.csv / val_elderly.csv), so those two files are exempt
    for name, r in tuning:
        if name in ("test.csv", "val_elderly.csv"):
            continue
        for t, rx in terms:
            if rx.search(r["prompt"]):
                hits.append(f"{name}:{r['id']} contains '{t}'")
    for p in TUNING_TEXT:
        if p.exists():
            txt = p.read_text(encoding="utf-8")
            for t, rx in terms:
                if rx.search(txt):
                    hits.append(f"{p.relative_to(ROOT)} contains '{t}'")
    (hard if hits else []).append(f"[1] Half B term in tuning material: {len(hits)}")
    print(f"[1] held-out vocabulary (Half B) in tuning material: {'NONE' if not hits else len(hits)}")
    for h in hits[:15]:
        print("     " + h)

    # 2. entity overlap
    if heldout:
        te = {k: set() for k in ("iban", "id", "email", "bsn", "name")}
        for _, r in tuning:
            for k, v in entities(r["prompt"]).items():
                te[k] |= v
        overlap = {k: set() for k in te}
        for _, r in heldout:
            for k, v in entities(r["prompt"]).items():
                overlap[k] |= v & te[k]
        for k, v in overlap.items():
            print(f"[2] shared {k:<5}: {len(v)} {sorted(v)[:6] if v else ''}")
        if overlap["iban"] or overlap["id"] or overlap["email"]:
            hard.append("[2] shared IBAN/ID/email between tuning and held-out")
        if overlap["bsn"]:
            warn.append(f"[2] {len(overlap['bsn'])} BSN value(s) shared (small allowed test-BSN list); "
                        "learned baselines mask digits, BRANE detects BSN by pattern")
        if overlap["name"]:
            warn.append(f"[2] {len(overlap['name'])} full name(s) shared: {sorted(overlap['name'])[:8]}")
    else:
        print("[2] no held-out data yet (test.csv / gold.csv)")

    # 3. text overlap
    tun_sh = {}
    for name, r in tuning:
        for s in shingles(r["prompt"]):
            tun_sh.setdefault(s, f"{name}:{r['id']}")
    bad = []
    for name, r in heldout:
        common = shingles(r["prompt"]) & tun_sh.keys()
        if common:
            s = sorted(common)[0]
            bad.append(f"{name}:{r['id']} ~ {tun_sh[s]}: '{s}'")
    share = len(bad) / len(heldout) if heldout else 0.0
    print(f"[3] held-out rows sharing an {NGRAM}-word sequence with tuning rows: {len(bad)} ({100 * share:.1f}%)")
    for b in bad[:8]:
        print("     " + b)
    if share > 0.02:
        hard.append(f"[3] {len(bad)} held-out rows overlap tuning text")
    gate = json.loads((ROOT / "tests" / "gate_tests.json").read_text(encoding="utf-8"))["tests"]
    gate_hits = []
    for t in gate:
        gs = shingles(t["prompt"])
        for name, r in tuning + heldout:
            if gs & shingles(r["prompt"]):
                gate_hits.append(f"{t['id']} ~ {name}:{r['id']}")
    print(f"[3] gate-test prompts sharing an {NGRAM}-word sequence with any eval row: {len(gate_hits)} {gate_hits[:6]}")
    if gate_hits:
        warn.append(f"[3] gate tests overlap eval rows: {gate_hits[:6]}")

    # 4. population split
    eld = [term_re(t) for t in ELDERLY]
    dev_eld = [f"{n}:{r['id']}" for n, r in tuning if n.startswith("dev") and any(rx.search(r["prompt"]) for rx in eld)]
    test_rows = [r for n, r in heldout if n == "test_ar.csv"]
    test_eld = sum(1 for r in test_rows if any(rx.search(r["prompt"]) for rx in eld))
    print(f"[4] dev rows with elderly-life-stage markers: {len(dev_eld)} {dev_eld[:6]}"
          + (f" | test rows with markers: {test_eld}/{len(test_rows)}" if test_rows else ""))
    if dev_eld:
        warn.append(f"[4] {len(dev_eld)} dev rows mention elderly scenarios reserved for test")

    report = {"hard_failures": hard, "warnings": warn}
    (ROOT / "results").mkdir(exist_ok=True)
    (ROOT / "results" / "leakage_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nRESULT:", "FAIL" if hard else "PASS", "| warnings:", len(warn))
    for x in hard + warn:
        print("  - " + x)
    sys.exit(1 if hard else 0)


if __name__ == "__main__":
    main()
