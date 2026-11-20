#!/usr/bin/env python3
"""
Cross-check on the teammate's golden sets (hackathon-pi-harness/evals/golden/*.jsonl), graded with THEIR rule
(evals/golden.mjs): pass = route acceptable for `expect` AND no protected span in the outgoing cloud payload.

Our policy is sent as a draftPolicy to POST /policy/test, so the live team policy is never touched.
Optional --llm adds our harness classifier (one local-LLM call, 14 labels) with "stricter route wins".

  python3 eval/run_pi_golden.py --policy policy/policy_v1_nokw.json --tag pi_v1_nokw            # all three sets
  python3 eval/run_pi_golden.py --policy policy/policy_v1_nokw.json --tag pi_v1_nokw_llm --llm
  (from omar/ inside hackathon-pi-harness the golden dir ../evals/golden is found automatically)
"""
from __future__ import annotations

import argparse
import collections
import concurrent.futures as cf
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "eval"))
import brane_client as bc  # noqa: E402
from run_eval import LLMBackend  # noqa: E402

ROUTE_OK = {  # identical to evals/golden.mjs (their "cloud" includes placeholdered cloud)
    "allow": lambda r: r == "cloud",
    "protect": lambda r: r in ("cloud", "local"),
    "local": lambda r: r in ("local", "refused"),
    "refuse": lambda r: r == "refused",
}


def their_route(route):
    return "cloud" if route in ("cloud", "cloud_redacted") else route


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--policy", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--sets", nargs="+", default=["claims", "heldout", "mutated"])
    ap.add_argument("--golden-dir", default=str(ROOT.parent / "evals" / "golden"))
    ap.add_argument("--llm", action="store_true", help="add the harness LLM classifier, stricter route wins")
    ap.add_argument("--workers", type=int, default=6)
    a = ap.parse_args(argv)
    gdir = Path(a.golden_dir)
    if not gdir.exists():
        sys.exit(f"golden dir not found: {gdir} (pass --golden-dir)")
    pol = bc.load_policy(a.policy)
    payload = bc.build_payload(pol)
    client = bc.Brane()
    raw = ROOT / "results" / "raw" / a.tag
    raw.mkdir(parents=True, exist_ok=True)
    llm = LLMBackend(client, "A", raw) if a.llm else None

    def grade(c):
        d = bc.decision_from_policy_test(client.policy_test(c["text"], draft_policy=payload))
        route = d["route"]
        if llm:
            lr = llm.predict(c["id"], c["text"])["pred_route"]
            if lr in bc.ROUTE_RANK and bc.ROUTE_RANK[lr] > bc.ROUTE_RANK.get(route, -1):
                route = lr
        payload_text = d.get("cloud_payload") or "" if route in ("cloud", "cloud_redacted") else ""
        leaked = [f"{s['cat']}:{s['text']}" for s in c.get("spans", []) if s["text"] and s["text"] in payload_text]
        ok = ROUTE_OK[c["expect"]](their_route(route)) and not leaked
        return {"set": c["_set"], "id": c["id"], "kind": c["kind"], "expect": c["expect"], "route": route, "ok": ok,
                "leaked": leaked, "semantic": [s["code"] for s in d.get("semantic") or []]}

    claims = []
    for s in a.sets:
        for line in (gdir / f"{s}.jsonl").read_text(encoding="utf-8").splitlines():
            if line.strip():
                c = json.loads(line)
                c["_set"] = s
                claims.append(c)
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        res = list(ex.map(grade, claims))
    out = {"tag": a.tag, "policy": pol.get("version"), "llm": a.llm, "results": res, "summary": {}}
    print(f"{a.tag}: policy {pol.get('version')}{' + harness LLM classifier' if a.llm else ''}")
    for s in a.sets:
        rs = [r for r in res if r["set"] == s]
        n_ok = sum(r["ok"] for r in rs)
        leaks = sum(1 for r in rs if r["leaked"] or (r["expect"] in ("local", "refuse") and their_route(r["route"]) == "cloud"))
        out["summary"][s] = {"pass": n_ok, "n": len(rs), "unsafe": leaks}
        print(f"  {s:<8} {n_ok}/{len(rs)} pass   unsafe (leak or sensitive sent to cloud): {leaks}")
        by = collections.defaultdict(lambda: [0, 0])
        for r in rs:
            k = r["kind"].split("/")[0]
            by[k][0] += r["ok"]
            by[k][1] += 1
        print("           " + "  ".join(f"{k} {v[0]}/{v[1]}" for k, v in sorted(by.items())))
    fails = [f"{r['set']}:{r['id']}({r['expect']}->{r['route']}{' LEAK ' + ','.join(r['leaked']) if r['leaked'] else ''})"
             for r in res if not r["ok"]]
    print("  failures:", ", ".join(fails[:25]) + (" ..." if len(fails) > 25 else ""))
    (ROOT / "results" / f"{a.tag}.json").write_text(json.dumps(out, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
