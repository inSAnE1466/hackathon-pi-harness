#!/usr/bin/env python3
"""
Learned baseline: TF-IDF (word 1-2 grams) -> one logistic regression per label. Standard library only.

Answers the question "does learning word weights beat a fixed keyword list?". Labels -> route by the same
deterministic code as every other predictor. Trained on dev only; never on val/test/gold.

Preprocessing masks values so the model cannot memorise specific numbers: emails -> __email__,
IBANs -> __iban__, any digit run -> __numN__ (N = length).

  python3 eval/tfidf_lr.py --train data/dev.csv --data data/val.csv --tag lr_val
  python3 eval/tfidf_lr.py --train data/dev.csv --data data/test.csv --tag FINAL_lr_test --final
"""
from __future__ import annotations

import argparse
import datetime
import json
import math
import random
import re
import sys
import time
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "eval"))
import brane_client as bc  # noqa: E402
import metrics as M  # noqa: E402
from run_eval import check_lock, sha256  # noqa: E402

TOKEN_RE = re.compile(r"__\w+__|[a-zà-ÿß]+")


def normalise(text):
    t = re.sub(r"\b[\w.+-]+@[\w-]+\.[\w.]+\b", " __email__ ", text)
    t = re.sub(r"\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,3})?\b", " __iban__ ", t)
    t = re.sub(r"\d+", lambda m: f" __num{len(m.group(0))}__ ", t)
    return t.lower()


def features(text):
    toks = TOKEN_RE.findall(normalise(text))
    return toks + [a + " " + b for a, b in zip(toks, toks[1:])]


class Tfidf:
    def __init__(self, min_df=2):
        self.min_df = min_df

    def fit(self, docs):
        df = Counter()
        for d in docs:
            df.update(set(features(d)))
        self.vocab = {t: i for i, t in enumerate(sorted(t for t, n in df.items() if n >= self.min_df))}
        n = len(docs)
        self.idf = {t: math.log((1 + n) / (1 + df[t])) + 1 for t in self.vocab}
        return self

    def transform(self, doc):
        tf = Counter(t for t in features(doc) if t in self.vocab)
        v = {self.vocab[t]: (1 + math.log(c)) * self.idf[t] for t, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1.0
        return {k: x / norm for k, x in v.items()}


def train_lr(X, y, epochs=30, lr=0.5, l2=1e-4, seed=0):
    """AdaGrad logistic regression with balanced class weights; X = list of sparse dicts."""
    pos = sum(y)
    if pos < 2 or pos == len(y):
        return None
    wpos, wneg = len(y) / (2 * pos), len(y) / (2 * (len(y) - pos))
    w, b, g2, gb2 = {}, 0.0, {}, 1e-8
    idx = list(range(len(X)))
    rng = random.Random(seed)
    for _ in range(epochs):
        rng.shuffle(idx)
        for i in idx:
            x = X[i]
            z = b + sum(w.get(k, 0.0) * v for k, v in x.items())
            p = 1 / (1 + math.exp(-max(-30, min(30, z))))
            g = (p - y[i]) * (wpos if y[i] else wneg)
            for k, v in x.items():
                gk = g * v + l2 * w.get(k, 0.0)
                g2[k] = g2.get(k, 1e-8) + gk * gk
                w[k] = w.get(k, 0.0) - lr * gk / math.sqrt(g2[k])
            gb2 += g * g
            b -= lr * g / math.sqrt(gb2)
    return w, b


def predict_proba(model, x):
    if model is None:
        return 0.0
    w, b = model
    z = b + sum(w.get(k, 0.0) * v for k, v in x.items())
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--train", nargs="+", required=True)
    ap.add_argument("--data", nargs="+", required=True)
    ap.add_argument("--tag", required=True)
    ap.add_argument("--threshold", type=float, default=0.5)
    ap.add_argument("--final", action="store_true")
    a = ap.parse_args(argv)
    for d in a.train:
        if Path(d).name in ("val.csv", "test.csv", "gold.csv", "gold_rephrase.csv"):
            sys.exit(f"refusing to train on {d}: train on dev only")
    locks, data_hash = None, None
    for d in a.data:
        locks, h = check_lock(d, a.tag, a.final)
        data_hash = h or data_hash
    train = {}
    for d in a.train:
        train.update(M.read_gold(d))
    gold = {}
    for d in a.data:
        gold.update(M.read_gold(d))
    t0 = time.time()
    vec = Tfidf().fit([g["prompt"] for g in train.values()])
    Xtr = [vec.transform(g["prompt"]) for g in train.values()]
    models = {}
    for l in bc.LABELS:
        y = [int(l in g["labels"]) for g in train.values()]
        models[l] = train_lr(Xtr, y)
    print(f"trained {sum(m is not None for m in models.values())}/{len(models)} label models on {len(train)} dev rows, "
          f"{len(vec.vocab)} features, {time.time() - t0:.1f}s")
    rows = []
    for i, g in gold.items():
        t = time.time()
        x = vec.transform(g["prompt"])
        labels = {l for l, m in models.items() if predict_proba(m, x) >= a.threshold}
        if labels & {"THIRD_PARTY_HEALTH", "MENTAL_HEALTH", "WORK_INCAPACITY"}:
            labels.add("HEALTH")
        rows.append({"id": i, "pred_route": bc.route_of_labels(labels), "pred_labels": labels, "backend": "tfidf_lr",
                     "policy_version": "own-classifier", "latency_ms": round((time.time() - t) * 1000, 2), "n_calls": 0,
                     "http_status": "", "error": ""})
    pred_path = ROOT / "results" / f"{a.tag}.predictions.csv"
    M.write_pred(pred_path, rows)
    pred = M.read_pred(pred_path)
    m = M.evaluate(gold, pred, bc.LABELS)
    m["slices"] = M.slices(gold, pred, bc.LABELS)
    res = {"tag": a.tag, "backend": "tfidf_lr", "policy_version": "own-classifier", "train": a.train,
           "data": a.data, "data_sha256": {Path(d).name: sha256(d) for d in a.data}, "predictable_labels": bc.LABELS,
           "final": a.final, "timestamp": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "metrics": m}
    (ROOT / "results" / f"{a.tag}.json").write_text(json.dumps(res, indent=2, default=list), encoding="utf-8")
    if data_hash:
        locks[a.tag] = {"data_sha256": data_hash, "final": True, "timestamp": res["timestamp"], "backend": "tfidf_lr"}
        lp = ROOT / "results" / "locks.json"
        latest = json.loads(lp.read_text(encoding="utf-8")) if lp.exists() else {}   # merge: parallel runs must not overwrite each other
        latest.update({k: v for k, v in locks.items() if k not in latest or k == a.tag})
        lp.write_text(json.dumps(latest, indent=2), encoding="utf-8")
    M.print_report(m, f"{a.tag} (tfidf_lr)")


if __name__ == "__main__":
    main()
