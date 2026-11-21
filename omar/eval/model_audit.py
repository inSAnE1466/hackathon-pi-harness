#!/usr/bin/env python3
"""
Independent-model cross-check of the AI-written answer key (the 50 audit rows of the test set).

The labels were written by Claude Opus 5.5. Two OTHER models label the same rows blind (they never see our labels), all through BRANE:
  * Qwen 3.8 27B (different model family): POST /chat/completions with model vllm:qwen3.8-27b-nvfp4 (BRANE routes it locally,
    X-Brane-Local-Cause: explicit_local_model). Rows that the LIVE team policy refuses (decision / injection rows) return 422 and
    are reported as 'blocked by live policy'.
  * Claude Haiku 5.5 (smaller model, same vendor): POST /policy/test with an open cloud draft + executeCompletion (synthetic data,
    dry run, saved team policy untouched); BRANE resolves the cloud model itself.
Then: route agreement and Cohen's kappa of each rater vs our answer key, and of the panel majority where both raters answered.

  python3 eval/model_audit.py
"""
from __future__ import annotations

import concurrent.futures as cf
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "eval"))
import brane_client as bc  # noqa: E402
import metrics as M  # noqa: E402

OPEN_CLOUD = {"routingMode": "cloud-preferred", "piiSensitivity": "low",
              "categories": {c: "allow" for c in bc.BUILTIN_CATEGORIES}, "semanticCategories": []}
QWEN = "vllm:qwen3.8-27b-nvfp4"


def rate_qwen(b, text):
    r = b.chat([{"role": "user", "content": bc.prompt_multi(text)}], model=QWEN, temperature=0)
    if r.status == 422:
        return None, "blocked by live policy"
    d = bc.decision_from_chat(r)
    labels = bc.parse_json_labels(d.get("completion"))
    return labels, ("" if labels is not None else "unparseable") + f" [{d.get('model_resolved')}]"


def rate_haiku(b, text):
    r = b.policy_test(bc.prompt_multi(text), draft_policy=OPEN_CLOUD, execute=True)
    live = (r.json or {}).get("liveCompletion") or {}
    labels = bc.parse_json_labels(live.get("preview"))
    return labels, ("" if labels is not None else "unparseable") + f" [{live.get('status')}]"


def main():
    b = bc.Brane()
    ids = [r["row_id"] for r in csv.DictReader(open(ROOT / "data" / "audit" / "test_label_audit_50.csv", encoding="utf-8"))]
    test = M.read_gold(ROOT / "data" / "test.csv")

    def job(i):
        out = {"id": i}
        for name, fn in (("qwen", rate_qwen), ("haiku", rate_haiku)):
            try:
                labels, note = fn(b, test[i]["prompt"])
            except bc.BraneError as e:
                labels, note = None, f"error: {e}"
            if labels is not None and labels & {"THIRD_PARTY_HEALTH", "MENTAL_HEALTH", "WORK_INCAPACITY"}:
                labels.add("HEALTH")
            out[name] = {"labels": sorted(labels) if labels is not None else None,
                         "route": bc.route_of_labels(labels) if labels is not None else None, "note": note}
        return out

    with cf.ThreadPoolExecutor(max_workers=4) as ex:
        res = list(ex.map(job, ids))
    ours = {i: test[i]["route"] for i in ids}
    report = {"rows": len(ids), "raters": {}}
    for name in ("qwen", "haiku"):
        got = [r for r in res if r[name]["route"]]
        agree = sum(r[name]["route"] == ours[r["id"]] for r in got)
        k = M.cohen_kappa([ours[r["id"]] for r in got], [r[name]["route"] for r in got])
        blocked = sum(1 for r in res if r[name]["note"].startswith("blocked"))
        report["raters"][name] = {"rated": len(got), "route_agreement": agree / len(got) if got else None, "kappa": k, "blocked": blocked}
        print(f"{name:<6} rated {len(got)}/{len(ids)} (blocked by live policy: {blocked})  route agreement with our labels: "
              f"{agree}/{len(got)} = {agree / max(1, len(got)):.0%}   kappa {k:.2f}")
    both = [r for r in res if r["qwen"]["route"] and r["haiku"]["route"]]
    panel_agree = [r for r in both if r["qwen"]["route"] == r["haiku"]["route"]]
    vs_ours = sum(r["qwen"]["route"] == ours[r["id"]] for r in panel_agree)
    print(f"panel: both raters answered {len(both)} rows; they agree with EACH OTHER on {len(panel_agree)}; "
          f"of those, our answer key matches {vs_ours}/{len(panel_agree)}")
    dis = [(r["id"], ours[r["id"]], r["qwen"]["route"], r["haiku"]["route"]) for r in panel_agree if r["qwen"]["route"] != ours[r["id"]]]
    for d in dis:
        print(f"  both raters disagree with our key: {d[0]}  ours={d[1]}  qwen={d[2]}  haiku={d[3]}")
    report["panel"] = {"both_answered": len(both), "raters_agree": len(panel_agree), "key_matches_panel": vs_ours, "disputed": dis}
    out = ROOT / "results" / "model_audit.json"
    out.write_text(json.dumps({"report": report, "rows": res}, indent=2), encoding="utf-8")
    print(f"-> {out.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
