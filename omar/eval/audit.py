#!/usr/bin/env python3
"""
Human label audit of the held-out test set (standard library only).

  python3 eval/audit.py make             # -> data/audit/test_label_audit_50.csv (+ AUDIT_INSTRUCTIONS.md)
  python3 eval/audit.py score data/audit/test_label_audit_50.csv [--pred results/FINAL_combo_test.predictions.csv]

make : 50 test rows, stratified so every route and every sensitive label is represented (fixed seed). The sheet shows the
       prompt and OUR labels in plain words; reviewers mark AGREE / DISAGREE and, if needed, the correct route and labels.
       Model predictions are NOT shown (no anchoring on the system under test).
score: label agreement, Cohen's kappa on the route (ours vs human), and the final system's metrics on the audited rows against
       the human-corrected answers. The existing one-time test predictions are reused: test is not run again.
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "eval"))
import brane_client as bc  # noqa: E402
import metrics as M  # noqa: E402

PLAIN = {
    "PERSON": "a person's name", "CONTACT": "email / phone / home address", "IBAN": "bank account (IBAN)",
    "BSN": "BSN or other national ID", "POLICY_ID": "policy / claim / customer number",
    "HEALTH": "health info about a specific person", "THIRD_PARTY_HEALTH": "health of someone OTHER than the policyholder",
    "MENTAL_HEALTH": "mental health", "WORK_INCAPACITY": "unable to work / sick leave", "CRIMINAL": "a person suspected or convicted of a crime",
    "AUTO_DECISION": "AI asked to take/send a final decision itself (no human check)",
    "DISCRIMINATORY": "treating people differently by ethnicity, nationality, religion, gender, health... (or a proxy)",
    "BULK_EXPORT": "exporting personal data of many people", "INJECTION": "hidden instruction trying to override the AI's rules",
}
ROUTE_PLAIN = {"cloud": "cloud: may go to the outside AI as typed",
               "cloud_redacted": "cloud_redacted: outside AI, but names/numbers replaced by codes",
               "local": "local: must stay on the company's own AI", "refused": "refused: must be blocked, a human decides"}
COLS = ["audit_id", "row_id", "lang", "prompt", "our_labels (plain words)", "our_route", "AGREE or DISAGREE",
        "if DISAGREE: correct route (cloud / cloud_redacted / local / refused)", "if DISAGREE: labels to add (+) or remove (-)",
        "comment", "reviewer"]


def make(n=50, seed=2026):
    rows = list(csv.DictReader(open(ROOT / "data" / "test.csv", encoding="utf-8")))
    rng = random.Random(seed)
    picked, seen = [], set()
    # 1. at least one row per sensitive label, 2. fill per route proportionally to the set
    for l in bc.LABELS:
        cand = [r for r in rows if r[l] == "1" and r["id"] not in seen]
        if cand and bc.TIER_OF_LABEL[l] >= 2:
            r = rng.choice(cand); picked.append(r); seen.add(r["id"])
    by_route = {rt: [r for r in rows if r["gold_route"] == rt and r["id"] not in seen] for rt in bc.ROUTES}
    share = Counter(r["gold_route"] for r in rows)
    while len(picked) < n:
        rt = rng.choices(bc.ROUTES, [share[x] for x in bc.ROUTES])[0]
        if by_route[rt]:
            r = by_route[rt].pop(rng.randrange(len(by_route[rt]))); picked.append(r); seen.add(r["id"])
    rng.shuffle(picked)
    out_dir = ROOT / "data" / "audit"
    out_dir.mkdir(parents=True, exist_ok=True)
    sheet = out_dir / "test_label_audit_50.csv"
    with open(sheet, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(COLS)
        for k, r in enumerate(picked, 1):
            labs = [l for l in bc.LABELS if r[l] == "1"]
            w.writerow([f"A{k:02d}", r["id"], r["lang"], r["prompt"],
                        "; ".join(f"{l} = {PLAIN[l]}" for l in labs) or "none (no private or sensitive data)",
                        ROUTE_PLAIN[r["gold_route"]], "", "", "", "", ""])
    (out_dir / "AUDIT_INSTRUCTIONS.md").write_text(f"""# Label audit: 50 rows of the held-out test set (about 20-30 minutes)

Why: every label in our data was written by an AI. This audit checks that answer key against human judgement.

1. Open `test_label_audit_50.csv` in Excel / Google Sheets. Do NOT look at any model output.
2. For each row read the prompt, then our labels and our route.
3. Fill **AGREE** if both are right. Fill **DISAGREE** if anything is wrong, then give the correct route and which labels to add (+) or
   remove (-), e.g. `+MENTAL_HEALTH -WORK_INCAPACITY`. Use the label names from column E.
4. Rules of thumb: pets are never personal health; a draft "for my review" is never an autonomous decision; a crime that happened TO
   the customer is not criminal data about a person; the strictest label decides the route
   (identifiers -> cloud_redacted, health/criminal -> local, autonomous decision / discrimination / bulk export / injection -> refused).
5. Put your name in `reviewer`. Ideally two teammates audit the same sheet independently (save as `..._<name>.csv`).
6. Send the file back; then run: `python3 eval/audit.py score data/audit/test_label_audit_50_<name>.csv`

Routes: {"; ".join(ROUTE_PLAIN.values())}
""", encoding="utf-8")
    cnt = Counter(r["gold_route"] for r in picked)
    print(f"{len(picked)} rows -> {sheet.relative_to(ROOT)}  routes {dict(cnt)}")


def score(path, pred_path):
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    filled = [r for r in rows if r["AGREE or DISAGREE"].strip()]
    if not filled:
        sys.exit("no rows filled in yet")
    test = M.read_gold(ROOT / "data" / "test.csv")
    human = {}
    agree = 0
    for r in filled:
        g = test[r["row_id"]]
        labels, route = set(g["labels"]), g["route"]
        if r["AGREE or DISAGREE"].strip().upper().startswith("A"):
            agree += 1
        else:
            for tok in r["if DISAGREE: labels to add (+) or remove (-)"].replace(",", " ").split():
                l = tok[1:].strip().upper()
                if l in bc.LABELS:
                    (labels.add if tok.startswith("+") else labels.discard)(l)
            route = (r["if DISAGREE: correct route (cloud / cloud_redacted / local / refused)"].strip().lower()
                     or bc.route_of_labels(labels))
        human[r["row_id"]] = {"labels": labels, "route": route, "tier": 0, "lang": g["lang"], "prompt": g["prompt"], "notes": ""}
    ids = list(human)
    k = M.cohen_kappa([test[i]["route"] for i in ids], [human[i]["route"] for i in ids])
    print(f"{len(filled)} rows audited by {sorted({r['reviewer'] for r in filled if r['reviewer']}) or ['?']}")
    print(f"label agreement: {agree}/{len(filled)} = {agree / len(filled):.0%}   route kappa (AI labels vs human): {k:.2f}")
    pred = M.read_pred(pred_path)
    for name, ref in (("AI answer key", {i: test[i] for i in ids}), ("HUMAN answer key", human)):
        m = M.evaluate(ref, pred)
        print(f"final system vs {name:<16}: route F1 {m['route_macro_f1']:.3f}  leak {m['leak_rate']:.1%}  "
              f"over-block {m['over_block_rate']:.1%}  (n={m['n_evaluated']})")
    out = Path(path).with_suffix(".score.json")
    out.write_text(json.dumps({"rows": len(filled), "agreement": agree / len(filled), "route_kappa": k}, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("make")
    s = sub.add_parser("score"); s.add_argument("sheet"); s.add_argument("--pred", default=str(ROOT / "results" / "FINAL_combo_test.predictions.csv"))
    a = ap.parse_args()
    make() if a.cmd == "make" else score(a.sheet, a.pred)


if __name__ == "__main__":
    main()
