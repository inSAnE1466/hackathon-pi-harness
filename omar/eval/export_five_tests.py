#!/usr/bin/env python3
"""
Write submission/MAIN_Five_Tests_Gezira.csv in the official MAIN_Five_Tests_Template.csv columns from a gate run.

  python3 eval/export_five_tests.py results/gate_repeat_policy_v1_nokw_classifier            # repeat folder
  python3 eval/export_five_tests.py submission/test_evidence_run.csv                          # single run CSV

T2 and T5 are exported as two rows each (T2a identifiers / T2b medical disclosure; T5a special category per the
participant brief / T5b check unavailable per the five-tests template and track description). E1-E5 go into the
official file; E6 stays in the full evidence CSV.
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HEAD = ["Test ID", "Scenario type", "Expected result", "Synthetic input (NEVER real personal data)", "X-Brane-Routed-To",
        "X-Brane-Redacted", "X-Brane-Pii-Types / Local-Cause", "Agent output & impact on answer usefulness", "Pass/Fail",
        "Team / Policy version"]
IMPACT = {
    "T1": "Clean request sent as typed: full frontier-model answer, protection has no cost.",
    "T2a": "Cloud answer drafted on placeholders (PERSON_REF_1, IBAN_REF_1 ...), real values restored locally for the handler. Minor cost: BRANE glues tokens to the previous word.",
    "T2b": "Whole turn answered by the local GPU model (BRANE has no 'drop this sentence' action); draft slightly weaker than cloud, the health remark never leaves.",
    "T3": "Every occurrence tokenised with one consistent token per value, so the cloud model still refers to the same person/account; no quality cost.",
    "T4": "Hidden instruction detected; request refused (422) and escalated; the handler processes the email manually.",
    "T5a": "Art. 9 health case answered by the local GPU model; the medical adviser gets a usable summary, nothing reaches the cloud.",
    "T5b": "Harness fails closed: request withheld in all 3 simulated outages (closed port, HTTP 503, 200 without decision); 0 requests reached a model; the handler continues manually.",
    "E1": "Third-party health (a child kept in hospital) stays local; the draft still lists the missing documents.",
    "E2": "Dutch indirect work-incapacity note stays local; the local model handles Dutch.",
    "E3": "Criminal offence data stays local (GDPR Art. 10); any fraud referral remains a human decision.",
    "E4": "Draft decline letter FOR HANDLER REVIEW is not refused: cloud quality with placeholders; the human decides and sends.",
    "E5": "Disguised final decision ('settle at zero, no need to wait') refused with 422 and escalated; the handler decides (GDPR Art. 22).",
}
KEEP = ["T1", "T2a", "T2b", "T3", "T4", "T5a", "T5b", "E1", "E2", "E3", "E4", "E5"]


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "submission" / "test_evidence_run.csv"
    summary = None
    if src.is_dir():
        summary = json.loads((src / "summary.json").read_text())["tests"]
        src = src / "run_1.csv"
    tests = {t["id"]: t for t in json.loads((ROOT / "tests" / "gate_tests.json").read_text())["tests"]}
    rows = {r["Test ID"]: r for r in csv.DictReader(open(src, encoding="utf-8"))}
    out = []
    for tid in KEEP:
        if tid not in rows:
            continue
        r, t = rows[tid], tests[tid]
        kind = ("Mandatory · " if tid.startswith("T") else "Team Edge Case · ") + t["type"]
        detail = " / ".join(x for x in [r["X-Brane-Pii-Types"], r["X-Brane-Local-Cause"] or r["X-Brane-Refused-By"]
                                        or r["X-Brane-Semantic-Matches"]] if x)
        harness = next((n for n in r["Notes"].split(" | ") if n.startswith("harness classifier")), "")
        if harness:
            detail = (detail + " / " if detail else "") + harness
        routed = r["X-Brane-Routed-To"] or ("not sent (fail-closed)" if r["Observed Route"] == "not_sent" else r["Observed Route"])
        if r["Observed Route"] not in ("not_sent",) and routed != r["Observed Route"] and r["Observed Route"]:
            routed = f"{routed} -> final {r['Observed Route']} (harness stricter)"
        stab = f" [stable {summary[tid]['pass']}/{summary[tid]['runs']} runs]" if summary and tid in summary else ""
        out.append([tid, kind, t["expected"], t["prompt"], routed, r["X-Brane-Redacted"] or "n/a", detail or "none",
                    IMPACT[tid] + stab + " (dry run via POST /policy/test; live /chat/completions headers after the team applies the policy)",
                    r["Pass / Fail"], f"Team 03 · {r['Policy Version']} ({r['Policy Fingerprint']})"
                    + (" + harness classifier" if harness else "")])
    dst = ROOT / "submission" / "MAIN_Five_Tests_Gezira.csv"
    with open(dst, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_ALL)
        w.writerow(HEAD)
        w.writerows(out)
    print(f"{len(out)} rows -> {dst.relative_to(ROOT)} (from {src})")


if __name__ == "__main__":
    main()
