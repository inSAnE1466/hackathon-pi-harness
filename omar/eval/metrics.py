#!/usr/bin/env python3
"""
Gezira evaluation metrics (standard library only).

  python3 eval/metrics.py validate data/dev.csv
  python3 eval/metrics.py eval data/val.csv results/v1_val.predictions.csv [--policy policy/policy_v1.json]
  python3 eval/metrics.py compare results/v1_val.json results/v2_val.json results/kw_val.json
  python3 eval/metrics.py combine -o results/combo.predictions.csv results/v2_val.predictions.csv results/llmB_val.predictions.csv
  python3 eval/metrics.py consistency data/gold_rephrase.csv results/gold.predictions.csv results/gold_rephrase.predictions.csv
  python3 eval/metrics.py kappa data/gold.csv data/gold_second_labeller.csv

Prediction CSV (all backends): id,pred_route,pred_labels,backend,policy_version,latency_ms,n_calls,http_status,error
  pred_labels = space-separated label names; pred_route in cloud, cloud_redacted, local, refused, error.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import brane_client as bc  # noqa: E402

LABELS = bc.LABELS
ROUTES = bc.ROUTES
GOLD_COLUMNS = ["id", "split", "lang", "prompt"] + LABELS + ["gold_tier", "gold_route", "notes"]
PRED_COLUMNS = ["id", "pred_route", "pred_labels", "backend", "policy_version", "latency_ms", "n_calls", "http_status", "error"]
LONG_CHARS = 400


# ----------------------------------------------------------------------------- io
def read_gold(path) -> dict:
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["id"]] = {
                "labels": {l for l in LABELS if str(r.get(l, "0")).strip() == "1"},
                "route": r["gold_route"].strip(), "tier": int(r["gold_tier"]),
                "lang": r.get("lang", "").strip(), "prompt": r["prompt"], "notes": r.get("notes", ""),
            }
    return out


def read_pred(path) -> dict:
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["id"]] = {
                "route": r["pred_route"].strip(), "labels": set((r.get("pred_labels") or "").split()),
                "backend": r.get("backend", ""), "latency_ms": float(r.get("latency_ms") or 0),
                "n_calls": int(float(r.get("n_calls") or 0)), "error": r.get("error", ""),
                "policy_version": r.get("policy_version", ""),
            }
    return out


def write_pred(path, rows):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=PRED_COLUMNS)
        w.writeheader()
        for r in rows:
            r = dict(r)
            if isinstance(r.get("pred_labels"), (set, list, tuple)):
                r["pred_labels"] = " ".join(l for l in LABELS if l in set(r["pred_labels"]))
            w.writerow({k: r.get(k, "") for k in PRED_COLUMNS})


# ----------------------------------------------------------------------------- validation
def validate(path) -> list:
    problems = []
    with open(path, newline="", encoding="utf-8") as f:
        rd = csv.DictReader(f)
        if rd.fieldnames != GOLD_COLUMNS:
            problems.append(f"header mismatch:\n  got      {rd.fieldnames}\n  expected {GOLD_COLUMNS}")
            return problems
        ids = Counter()
        for i, r in enumerate(rd, 2):
            ids[r["id"]] += 1
            labs = set()
            for l in LABELS:
                v = r[l].strip()
                if v not in ("0", "1"):
                    problems.append(f"line {i} {r['id']}: {l}={v!r} not 0/1")
                elif v == "1":
                    labs.add(l)
            if labs & {"THIRD_PARTY_HEALTH", "MENTAL_HEALTH", "WORK_INCAPACITY"} and "HEALTH" not in labs:
                problems.append(f"line {i} {r['id']}: health sub-label without HEALTH umbrella")
            t = bc.tier_of(labs)
            if str(t) != r["gold_tier"].strip():
                problems.append(f"line {i} {r['id']}: gold_tier {r['gold_tier']} but labels give {t}")
            if bc.ROUTE_OF_TIER[t] != r["gold_route"].strip():
                problems.append(f"line {i} {r['id']}: gold_route {r['gold_route']} but labels give {bc.ROUTE_OF_TIER[t]}")
            if r["lang"].strip() not in ("en", "nl", "de", "ar"):
                problems.append(f"line {i} {r['id']}: lang {r['lang']!r}")
            if not r["prompt"].strip():
                problems.append(f"line {i} {r['id']}: empty prompt")
        problems += [f"duplicate id {k}" for k, n in ids.items() if n > 1]
    return problems


# ----------------------------------------------------------------------------- metric core
def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 0.0
    r = tp / (tp + fn) if tp + fn else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return p, r, f


def evaluate(gold: dict, pred: dict, predictable=None) -> dict:
    ids = [i for i in gold if i in pred]
    missing = [i for i in gold if i not in pred]
    errors = [i for i in ids if pred[i]["route"] not in ROUTES]
    ok = [i for i in ids if i not in errors]
    predictable = list(predictable or LABELS)

    label_m = {}
    for l in LABELS:
        tp = sum(1 for i in ok if l in gold[i]["labels"] and l in pred[i]["labels"])
        fp = sum(1 for i in ok if l not in gold[i]["labels"] and l in pred[i]["labels"])
        fn = sum(1 for i in ok if l in gold[i]["labels"] and l not in pred[i]["labels"])
        p, r, f = prf(tp, fp, fn)
        label_m[l] = {"precision": p, "recall": r, "f1": f, "support": tp + fn, "tp": tp, "fp": fp, "fn": fn}
    supported = [l for l in LABELS if label_m[l]["support"] > 0]
    mac = lambda ls: (sum(label_m[l]["f1"] for l in ls) / len(ls)) if ls else 0.0

    conf = {g: {p: 0 for p in ROUTES} for g in ROUTES}
    for i in ok:
        conf[gold[i]["route"]][pred[i]["route"]] += 1
    route_m = {}
    present = [r for r in ROUTES if any(conf[r].values()) or any(conf[g][r] for g in ROUTES)]
    for r in ROUTES:
        tp = conf[r][r]
        fp = sum(conf[g][r] for g in ROUTES if g != r)
        fn = sum(conf[r][p] for p in ROUTES if p != r)
        p_, r_, f_ = prf(tp, fp, fn)
        route_m[r] = {"precision": p_, "recall": r_, "f1": f_, "support": tp + fn}

    rank = bc.ROUTE_RANK
    special = [i for i in ok if gold[i]["route"] in ("local", "refused")]
    leaks_special = [i for i in special if pred[i]["route"] in ("cloud", "cloud_redacted")]
    ident = [i for i in ok if gold[i]["route"] == "cloud_redacted"]
    leaks_ident = [i for i in ident if pred[i]["route"] == "cloud"]
    benign = [i for i in ok if gold[i]["route"] == "cloud"]
    over_block = [i for i in benign if pred[i]["route"] in ("local", "refused")]
    benign_red = [i for i in benign if pred[i]["route"] == "cloud_redacted"]
    under = [i for i in ok if rank[pred[i]["route"]] < rank[gold[i]["route"]]]
    over = [i for i in ok if rank[pred[i]["route"]] > rank[gold[i]["route"]]]
    # refused when gold says the request should only stay local or be redacted (e.g. human-review drafts)
    wrongly_refused = [i for i in ok if pred[i]["route"] == "refused" and gold[i]["route"] != "refused"]
    rate = lambda a, b: (len(a) / len(b)) if b else 0.0
    lat = [pred[i]["latency_ms"] for i in ok if pred[i]["latency_ms"]]
    calls = [pred[i]["n_calls"] for i in ok]
    return {
        "n_gold": len(gold), "n_evaluated": len(ok), "n_missing": len(missing), "n_errors": len(errors),
        "errors": errors, "missing": missing,
        "label_metrics": label_m,
        "label_macro_f1": mac([l for l in supported if l in predictable]),
        "label_macro_f1_all_supported": mac(supported),
        "label_macro_over": [l for l in supported if l in predictable],
        "route_metrics": route_m,
        "route_macro_f1": (sum(route_m[r]["f1"] for r in present) / len(present)) if present else 0.0,
        "route_accuracy": rate([i for i in ok if pred[i]["route"] == gold[i]["route"]], ok),
        "confusion": conf,
        "leak_rate": rate(leaks_special, special), "leaks": leaks_special,
        "identifier_leak_rate": rate(leaks_ident, ident), "identifier_leaks": leaks_ident,
        "under_protection_rate": rate(under, ok), "under_protected": under,
        "over_block_rate": rate(over_block, benign), "over_blocked": over_block,
        "benign_redacted_rate": rate(benign_red, benign),
        "over_protection_rate": rate(over, ok),
        "wrongly_refused": wrongly_refused,
        "mean_latency_ms": (sum(lat) / len(lat)) if lat else None,
        "calls_per_row": (sum(calls) / len(calls)) if calls else None,
    }


# ----------------------------------------------------------------------------- slices
def keyword_terms(policy_paths=None) -> list:
    """Half A vocabulary + every keyword in the policy files: what a keyword copier knows."""
    terms = set()
    vocab = ROOT / "data" / "vocab_split.json"
    if vocab.exists():
        for group in json.loads(vocab.read_text(encoding="utf-8")).get("half_a", {}).values():
            terms.update(re.sub(r"\s*\(.*?\)\s*$", "", t).strip() for t in group)
    for p in policy_paths or sorted((ROOT / "policy").glob("policy_*.json")):
        for s in bc.load_policy(p).get("semanticCategories", []):
            terms.update(s.get("keywords") or [])
    return sorted(t for t in terms if t)


def has_keyword(text: str, terms) -> bool:
    """Left word boundary, so 'icu' does not match inside 'difficult'."""
    low = text.lower()
    return any(re.search(r"(?<![\w])" + re.escape(t.lower()), low) for t in terms)


def slices(gold: dict, pred: dict, predictable=None, terms=None) -> dict:
    terms = terms if terms is not None else keyword_terms()
    groups = {
        "keyword_present": lambda g: has_keyword(g["prompt"], terms),
        "keyword_absent": lambda g: not has_keyword(g["prompt"], terms),
        "lang_en": lambda g: g["lang"] == "en",
        "lang_nl_de": lambda g: g["lang"] in ("nl", "de"),
        "lang_ar": lambda g: g["lang"] == "ar",
        "short": lambda g: len(g["prompt"]) < LONG_CHARS,
        "long": lambda g: len(g["prompt"]) >= LONG_CHARS,
    }
    out = {}
    for name, fn in groups.items():
        sub = {i: g for i, g in gold.items() if fn(g)}
        if not sub:
            continue
        m = evaluate(sub, pred, predictable)
        out[name] = {"n": m["n_evaluated"], "route_macro_f1": m["route_macro_f1"], "label_macro_f1": m["label_macro_f1"],
                     "leak_rate": m["leak_rate"], "over_block_rate": m["over_block_rate"]}
    return out


# ----------------------------------------------------------------------------- combine / agreement
def combine(preds: list) -> dict:
    """Stricter route wins; labels are the union (any model flags -> flagged). Deterministic.
    preds[0] is the ENFORCER (BRANE): if it would send to the cloud unmasked while another predictor found identifiers
    (cloud_redacted), the harness cannot mask them itself and forces the local model, so the combined route is local."""
    ids = set(preds[0])
    for p in preds[1:]:
        ids &= set(p)
    out = {}
    for i in sorted(ids):
        routes = [p[i]["route"] for p in preds]
        valid = [r for r in routes if r in bc.ROUTE_RANK]
        route = max(valid, key=lambda r: bc.ROUTE_RANK[r]) if valid else "error"
        enf = preds[0][i]
        found = set().union(*[p[i]["labels"] for p in preds[1:]]) & bc.ID_LABELS if len(preds) > 1 else set()
        if route in ("cloud", "cloud_redacted") and enf["route"] in ("cloud", "cloud_redacted") and (found - enf["labels"]):
            route = "local"     # partial-masking guard: identifier types BRANE did not mask -> harness forces local
        labels = set().union(*[p[i]["labels"] for p in preds])
        out[i] = {"id": i, "pred_route": route, "pred_labels": labels,
                  "backend": "+".join(sorted({p[i]["backend"] for p in preds})),
                  "policy_version": "+".join(sorted({p[i]["policy_version"] for p in preds if p[i]["policy_version"]})),
                  "latency_ms": max(p[i]["latency_ms"] for p in preds),   # calls can run in parallel
                  "n_calls": sum(p[i]["n_calls"] for p in preds), "http_status": "", "error": ""}
    return out


def pairs(gold: dict, pred: dict) -> dict:
    """Minimal pairs (ids mp-NNa / mp-NNb): a pair passes only if BOTH halves get the right route."""
    groups = defaultdict(dict)
    for i in gold:
        mm = re.match(r"(mp-\d+)([ab])$", i)
        if mm:
            groups[mm.group(1)][mm.group(2)] = i
    res, by_label = [], defaultdict(lambda: [0, 0])
    for pid, h in sorted(groups.items()):
        if set(h) != {"a", "b"} or h["a"] not in pred or h["b"] not in pred:
            continue
        ga, gb = gold[h["a"]], gold[h["b"]]
        ok_a = pred[h["a"]]["route"] == ga["route"]
        ok_b = pred[h["b"]]["route"] == gb["route"]
        diff = sorted((ga["labels"] ^ gb["labels"]) - {"HEALTH"}) or sorted(ga["labels"] ^ gb["labels"]) or ["identifier"]
        for l in diff:
            by_label[l][0] += ok_a and ok_b
            by_label[l][1] += 1
        res.append({"pair": pid, "ok": ok_a and ok_b, "ok_a": ok_a, "ok_b": ok_b, "flipped": pred[h["a"]]["route"] != pred[h["b"]]["route"],
                    "changed": diff, "gold": (ga["route"], gb["route"]), "pred": (pred[h["a"]]["route"], pred[h["b"]]["route"])})
    n = len(res)
    return {"pairs": n, "pair_accuracy": sum(r["ok"] for r in res) / n if n else 0.0,
            "flip_rate": sum(r["flipped"] for r in res) / n if n else 0.0,
            "by_label": {k: f"{v[0]}/{v[1]}" for k, v in sorted(by_label.items())},
            "failures": [r for r in res if not r["ok"]]}


def cohen_kappa(a: list, b: list) -> float:
    n = len(a)
    if not n:
        return 0.0
    po = sum(1 for x, y in zip(a, b) if x == y) / n
    ca, cb = Counter(a), Counter(b)
    pe = sum(ca[k] * cb[k] for k in set(ca) | set(cb)) / (n * n)
    return (po - pe) / (1 - pe) if pe != 1 else 1.0


def consistency(rephrase_csv, base_pred: dict, var_pred: dict) -> dict:
    groups = defaultdict(list)
    with open(rephrase_csv, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            groups[r["base_id"]].append(f"{r['base_id']}~{r['variant']}")
    same_route, same_labels, per_variant = 0, 0, Counter()
    detail = {}
    for base, vids in groups.items():
        if base not in base_pred or not all(v in var_pred for v in vids):
            continue
        b = base_pred[base]
        routes = [b["route"]] + [var_pred[v]["route"] for v in vids]
        labs = [frozenset(b["labels"])] + [frozenset(var_pred[v]["labels"]) for v in vids]
        same_route += len(set(routes)) == 1
        same_labels += len(set(labs)) == 1
        for v in vids:
            per_variant[v.split("~", 1)[1]] += var_pred[v]["route"] == b["route"]
        detail[base] = routes
    n = len(detail)
    return {"groups": n, "route_consistency": same_route / n if n else 0.0,
            "label_set_consistency": same_labels / n if n else 0.0,
            "per_variant_route_agreement": {k: v / n for k, v in per_variant.items()} if n else {},
            "routes": detail}


# ----------------------------------------------------------------------------- reporting
def fmt(x, pct=False):
    if x is None:
        return "-"
    return f"{100 * x:.1f}%" if pct else f"{x:.3f}"


def print_report(m, title=""):
    if title:
        print(f"\n== {title} ==")
    print(f"rows evaluated {m['n_evaluated']}/{m['n_gold']}  errors {m['n_errors']}  missing {m['n_missing']}")
    print(f"route macro F1 {fmt(m['route_macro_f1'])}   route accuracy {fmt(m['route_accuracy'], True)}   "
          f"label macro F1 {fmt(m['label_macro_f1'])} (over {len(m['label_macro_over'])} labels)")
    print(f"LEAK rate {fmt(m['leak_rate'], True)} {m['leaks'] or ''}   identifier leaks {fmt(m['identifier_leak_rate'], True)} "
          f"{m['identifier_leaks'] or ''}")
    print(f"over-block {fmt(m['over_block_rate'], True)} {m['over_blocked'] or ''}   benign redacted "
          f"{fmt(m['benign_redacted_rate'], True)}   wrongly refused {m['wrongly_refused'] or 'none'}")
    if m.get("mean_latency_ms") is not None:
        print(f"latency {m['mean_latency_ms']:.0f} ms/row   calls/row {m['calls_per_row']:.1f}")
    print("confusion (rows = gold, cols = predicted):")
    print("  " + " " * 15 + "".join(f"{r:>15}" for r in ROUTES))
    for g in ROUTES:
        print("  " + f"{g:<15}" + "".join(f"{m['confusion'][g][p]:>15}" for p in ROUTES))
    print("per label:  label                 P      R      F1   support")
    for l, v in m["label_metrics"].items():
        if v["support"] or v["fp"]:
            print(f"            {l:<20} {v['precision']:.2f}   {v['recall']:.2f}   {v['f1']:.2f}   {v['support']}")
    if m.get("slices"):
        print("slices:      slice              n   routeF1  labelF1   leak   overblock")
        for k, s in m["slices"].items():
            print(f"            {k:<16} {s['n']:>4}   {s['route_macro_f1']:.3f}    {s['label_macro_f1']:.3f}   "
                  f"{fmt(s['leak_rate'], True):>6}   {fmt(s['over_block_rate'], True):>6}")


def compare_table(paths) -> str:
    rows = [json.loads(Path(p).read_text(encoding="utf-8")) for p in paths]
    common = None
    for r in rows:
        s = set(r.get("predictable_labels") or LABELS)
        common = s if common is None else common & s
    head = ("| Run | Backend | Route macro F1 | Label macro F1 (common) | Leak rate | Identifier leaks | Over-block | "
            "Calls/row | ms/row | n |\n|---|---|---|---|---|---|---|---|---|---|")
    lines = [head]
    for p, r in zip(paths, rows):
        m = r["metrics"]
        lm = m["label_metrics"]
        ls = [l for l in common if lm[l]["support"] > 0]
        common_f1 = sum(lm[l]["f1"] for l in ls) / len(ls) if ls else 0.0
        calls = "-" if m["calls_per_row"] is None else f"{m['calls_per_row']:.1f}"
        ms = "-" if m["mean_latency_ms"] is None else f"{m['mean_latency_ms']:.0f}"
        lines.append(f"| {r.get('tag', Path(p).stem)} | {r.get('backend')} | {fmt(m['route_macro_f1'])} | {fmt(common_f1)} | "
                     f"{fmt(m['leak_rate'], True)} | {fmt(m['identifier_leak_rate'], True)} | {fmt(m['over_block_rate'], True)} | "
                     f"{calls} | {ms} | {m['n_evaluated']} |")
    return "\n".join(lines) + f"\n\nLabel macro F1 is over the {len(common)} labels every compared run can predict."


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    v = sub.add_parser("validate"); v.add_argument("csv", nargs="+")
    e = sub.add_parser("eval"); e.add_argument("gold"); e.add_argument("pred"); e.add_argument("--policy")
    e.add_argument("--json", help="write metrics JSON here")
    cp = sub.add_parser("compare"); cp.add_argument("results", nargs="+")
    cb = sub.add_parser("combine"); cb.add_argument("preds", nargs="+"); cb.add_argument("-o", "--out", required=True)
    cs = sub.add_parser("consistency"); cs.add_argument("rephrase_csv"); cs.add_argument("base_pred"); cs.add_argument("variant_pred")
    k = sub.add_parser("kappa"); k.add_argument("a"); k.add_argument("b")
    pp = sub.add_parser("pairs"); pp.add_argument("gold"); pp.add_argument("pred"); pp.add_argument("--json")
    a = ap.parse_args(argv)

    if a.cmd == "validate":
        bad = 0
        for p in a.csv:
            probs = validate(p)
            print(f"{p}: {'OK' if not probs else str(len(probs)) + ' problem(s)'}")
            for x in probs:
                print("  - " + x)
            bad += bool(probs)
        sys.exit(1 if bad else 0)
    if a.cmd == "eval":
        gold, pred = read_gold(a.gold), read_pred(a.pred)
        predictable = bc.predictable_labels(bc.load_policy(a.policy)) if a.policy else None
        m = evaluate(gold, pred, predictable)
        m["slices"] = slices(gold, pred, predictable)
        print_report(m, f"{a.pred} vs {a.gold}")
        if a.json:
            Path(a.json).write_text(json.dumps({"tag": Path(a.pred).stem, "metrics": m}, indent=2), encoding="utf-8")
    if a.cmd == "compare":
        print(compare_table(a.results))
    if a.cmd == "combine":
        out = combine([read_pred(p) for p in a.preds])
        write_pred(a.out, out.values())
        print(f"combined {len(a.preds)} prediction files (stricter route wins, label union) -> {a.out} ({len(out)} rows)")
    if a.cmd == "consistency":
        res = consistency(a.rephrase_csv, read_pred(a.base_pred), read_pred(a.variant_pred))
        print(json.dumps({k: v for k, v in res.items() if k != "routes"}, indent=2))
        for base, routes in res["routes"].items():
            if len(set(routes)) > 1:
                print(f"  inconsistent {base}: {routes}")
    if a.cmd == "pairs":
        res = pairs(read_gold(a.gold), read_pred(a.pred))
        print(f"{a.pred}: pair accuracy {res['pair_accuracy']:.0%} ({res['pairs']} pairs), flip rate {res['flip_rate']:.0%}")
        print("  by changed label:", res["by_label"])
        for f in res["failures"]:
            print(f"  FAIL {f['pair']} changed={f['changed']} gold={f['gold']} pred={f['pred']}")
        if a.json:
            Path(a.json).write_text(json.dumps(res, indent=2), encoding="utf-8")
    if a.cmd == "kappa":
        ga, gb = read_gold(a.a), read_gold(a.b)
        ids = [i for i in ga if i in gb]
        print(f"{len(ids)} shared rows")
        print(f"route kappa {cohen_kappa([ga[i]['route'] for i in ids], [gb[i]['route'] for i in ids]):.3f}")
        for l in LABELS:
            xa = [int(l in ga[i]["labels"]) for i in ids]
            xb = [int(l in gb[i]["labels"]) for i in ids]
            if sum(xa) + sum(xb):
                print(f"  {l:<20} kappa {cohen_kappa(xa, xb):.3f}")


if __name__ == "__main__":
    main()
