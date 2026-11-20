#!/usr/bin/env python3
"""
Compositional generator for Gezira eval rows (standard library only).

Each row is assembled from a fragment bank written by ONE author:
  task (request) + document shell + identifier slots + 0-2 sensitive fragments + optional injection / tricky sentence.
Labels are exact because every fragment category and every identifier slot carries its label.

dev and test are kept apart by construction:
  * different banks (bank_dev.json / bank_test.json), written by separate authors that never saw each other's bank
  * different vocabulary (Half A vs Half B, data/vocab_split.json)
  * disjoint entity pools (names, cities, streets, postcodes, IBAN banks, BSNs, email domains, ID ranges)
  * different shells and task phrasings (they live in the banks)
eval/check_leakage.py verifies the separation afterwards.

  python3 data/generator/compose.py --bank data/generator/bank_dev.json  --pool dev  --n 600 --start 201 --prefix dev  --out data/dev_composed.csv
  python3 data/generator/compose.py --bank data/generator/bank_test.json --pool test --n 200 --start 1   --prefix test --out data/test.csv
"""
from __future__ import annotations

import argparse
import csv
import json
import random
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
import brane_client as bc  # noqa: E402
sys.path.insert(0, str(ROOT / "eval"))
from check_leakage import ID_RE, NAME_RE, shingles  # noqa: E402

COLUMNS = ["id", "split", "lang", "prompt"] + bc.LABELS + ["gold_tier", "gold_route", "notes"]

FRAGMENT_LABELS = {
    "health_physical": ["HEALTH"],
    "third_party_health": ["HEALTH", "THIRD_PARTY_HEALTH"],
    "mental_health": ["HEALTH", "MENTAL_HEALTH"],
    "work_incapacity": ["HEALTH", "WORK_INCAPACITY"],
    "criminal": ["CRIMINAL"],
    "injection": ["INJECTION"],
    "tricky_negative": [],
}
REQUEST_LABELS = {
    "benign_task": [], "review_draft_task": [], "auto_decision_task": ["AUTO_DECISION"],
    "standalone_benign": [], "standalone_tricky": [], "discriminatory": ["DISCRIMINATORY"], "bulk_export": ["BULK_EXPORT"],
}
SLOT_LABELS = {
    "name": ["PERSON"], "first": ["PERSON"], "other_name": ["PERSON"],
    "email": ["CONTACT"], "phone": ["CONTACT"], "address": ["CONTACT"],
    "iban": ["IBAN"], "bsn": ["BSN"],
    "policy": ["POLICY_ID"], "claim": ["POLICY_ID"], "customer": ["POLICY_ID"], "claim_list": ["POLICY_ID"],
    "date": [], "city": [], "amount": [],
}
SENSITIVE = ["health_physical", "third_party_health", "mental_health", "work_incapacity", "criminal"]
CLAIM_TYPES = ["home", "travel", "motor", "income", "liability", "pet", "legal"]

# ----------------------------------------------------------------------------- disjoint entity pools
POOLS = {
    "dev": {
        "first": {"nl": ["Jan", "Sanne", "Pieter", "Lotte", "Femke", "Koen", "Noor", "Sem", "Tess", "Joost", "Anke", "Gerrit", "Hanneke", "Mart", "Yara", "Stijn"],
                  "en": ["Oliver", "Grace", "Harry", "Chloe", "Samir", "Nadia", "George", "Ella", "Omar", "Maya", "Jack", "Freya"],
                  "de": ["Lukas", "Anna", "Jonas", "Lea", "Felix", "Paula", "Tobias", "Hannah", "Emre", "Sophie"]},
        "last": {"nl": ["de Vries", "Bakker", "Jansen", "Meijer", "de Boer", "Bos", "Vos", "van Leeuwen", "Dekker", "Kramer", "Hermans", "Wolters", "Jacobs", "Peeters", "El Amrani", "Yilmaz"],
                 "en": ["Hughes", "Turner", "Price", "Bennett", "Khan", "Walsh", "Reid", "Morgan"],
                 "de": ["Becker", "Schmidt", "Weber", "Fischer", "Wagner", "Krause", "Lange", "Arslan"]},
        "city": {"nl": ["Maastricht", "Heerlen", "Venlo", "Sittard", "Roermond", "Weert", "Kerkrade"], "en": ["Maastricht", "Heerlen", "Venlo"], "de": ["Aachen", "Düren", "Mönchengladbach"]},
        "street": {"nl": ["Kerkstraat", "Stationsweg", "Molenweg", "Brugstraat", "Markt", "Hoogstraat"], "de": ["Hauptstraße", "Bahnhofstraße", "Gartenweg"]},
        "postcode": ("62", "59", "61"), "de_plz": ("520", "523", "410"),
        "banks": ["ABNA", "INGB", "RABO"], "de_banks": ["37040044", "50010517"],
        "bsn": ["111222333", "187765546", "417395176", "493938382", "570481594", "647024809"],
        "domains": ["example.nl", "example.org"],
        "claim": (1000, 4999), "policy": (100, 4999), "customer": (100000, 499999),
    },
    "test": {
        "first": {"nl": ["Wouter", "Anouk", "Jesse", "Iris", "Thijs", "Roos", "Niels", "Esmee", "Luuk", "Floor", "Gijs", "Merel", "Siem", "Fenna", "Youssef", "Priya"],
                  "en": ["Callum", "Isla", "Rhys", "Amelia", "Kofi", "Leah", "Ewan", "Zara", "Mateusz", "Ruby"],
                  "de": ["Moritz", "Leonie", "Finn", "Clara", "Jannik", "Mila", "Deniz", "Greta"]},
        "last": {"nl": ["Dijkstra", "Hoekstra", "van Dam", "Kok", "Vermeulen", "Postma", "Willemsen", "Prins", "Blom", "Schouten", "Bulut", "Sanders", "Koster", "Brink"],
                 "en": ["Fraser", "Doyle", "Okafor", "Lambert", "Nowak", "Shaw", "Barker"],
                 "de": ["Hoffmann", "Zimmermann", "Braun", "Hartmann", "Wolf", "Keller", "Demir"]},
        "city": {"nl": ["Groningen", "Zwolle", "Leeuwarden", "Deventer", "Assen", "Enschede", "Hoorn"], "en": ["Groningen", "Zwolle", "Utrecht"], "de": ["Köln", "Münster", "Bielefeld"]},
        "street": {"nl": ["Dorpsstraat", "Julianalaan", "Spoorlaan", "Beukenlaan", "Vijverweg", "Schoolstraat"], "de": ["Lindenallee", "Schulweg", "Am Markt"]},
        "postcode": ("97", "80", "75"), "de_plz": ("506", "481", "336"),
        "banks": ["SNSB", "TRIO", "ASNB", "KNAB", "BUNQ"], "de_banks": ["30050110", "44010046"],
        "bsn": ["723568017", "800111229", "876654431", "953197645", "123456782"],
        "domains": ["example.com", "example.net"],
        "claim": (6000, 9999), "policy": (5000, 9999), "customer": (600000, 999999),
    },
}
GATE_IDS = {"CLM-2026-5120", "CLM-2026-6034", "CLM-2026-7001", "CLM-2026-7312", "CLM-2026-7401", "CLM-2026-7402",
            "CLM-2026-7403", "CLM-2026-7404", "CLM-2026-7405", "CLM-2026-8120", "CLM-2026-8304"}
ANON = {"en": {"first": "the customer", "other_name": "another person", "claim": "the claim"},
        "nl": {"first": "de klant", "other_name": "een ander", "claim": "de claim"},
        "de": {"first": "der Kunde", "other_name": "eine andere Person", "claim": "der Schaden"}}
SEPARATORS = ["\n\n", "\n---\n", "\n\n=== DOCUMENT ===\n", "\n\n>>> pasted:\n", "\n"]
MONTHS = {"en": ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November"],
          "nl": ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november"],
          "de": ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November"]}

# row type -> share; tiers follow from the pieces
MIX = [("standalone_benign", .12), ("standalone_tricky", .08), ("anon_doc", .14), ("ident_doc", .26),
       ("sensitive_doc", .22), ("auto_decision", .07), ("injection_doc", .06), ("discriminatory", .03), ("bulk_export", .02)]


def iban(cc, bban):
    n = int("".join(str(int(ch, 36)) for ch in bban + cc + "00"))
    return f"{cc}{98 - n % 97:02d}{bban}"


class Entities:
    def __init__(self, pool, rng, avoid_ids=(), avoid_names=()):
        self.p, self.rng = POOLS[pool], rng
        self.used_ids = set(avoid_ids)
        self.avoid_names = set(avoid_names)

    def person(self, lang):
        p, r = self.p, self.rng
        for _ in range(100):
            fl = lang if r.random() < .75 else r.choice(["nl", "en", "de"])
            first, last = r.choice(p["first"][fl]), r.choice(p["last"][fl if fl in p["last"] else "nl"])
            if f"{first} {last}" not in self.avoid_names:
                return first, last
        return first, last

    def _uniq(self, fmt, lo, hi):
        while True:
            v = fmt.format(self.rng.randint(lo, hi))
            if v not in self.used_ids and v not in GATE_IDS:
                self.used_ids.add(v)
                return v

    def values(self, lang):
        p, r = self.p, self.rng
        first, last = self.person(lang)
        ofirst, olast = self.person(lang)
        if lang == "de":
            addr = f"{r.choice(p['street']['de'])} {r.randint(1, 120)}, {r.choice(p['de_plz'])}{r.randint(10, 99)} {r.choice(p['city']['de'])}"
            ib = iban("DE", r.choice(p["de_banks"]) + f"{r.randint(0, 10**10 - 1):010d}")
            phone = f"+49 1{r.randint(50, 79)} {r.randint(1000000, 9999999)}"
        else:
            addr = (f"{r.choice(p['street']['nl'])} {r.randint(1, 180)}, {r.choice(p['postcode'])}{r.randint(10, 99)} "
                    f"{r.choice('ABCDEFGHJKLMNPRSTVWXZ')}{r.choice('ABCDEFGHJKLMNPRSTVWXZ')} {r.choice(p['city']['nl'])}")
            ib = iban("NL", r.choice(p["banks"]) + f"{r.randint(10**9, 10**10 - 1)}")
            phone = r.choice([f"+31 6 {r.randint(1000, 9999)} {r.randint(1000, 9999)}", f"06-{r.randint(10000000, 99999999)}",
                              f"06 {r.randint(10, 99)} {r.randint(10, 99)} {r.randint(10, 99)} {r.randint(10, 99)}"])
        if r.random() < .3:
            ib = " ".join(ib[i:i + 4] for i in range(0, len(ib), 4))
        email = (re.sub(r"[^a-z.]", "", f"{first}.{last}".lower().replace(" ", "")) + "@" + r.choice(p["domains"]))
        return {
            "name": f"{first} {last}", "first": first, "other_name": f"{ofirst} {olast}",
            "email": email, "phone": phone, "address": addr, "iban": ib, "bsn": r.choice(p["bsn"]),
            "policy": self._uniq("MV-POL-2026-{:06d}", *p["policy"]),
            "claim": self._uniq("CLM-2026-{:04d}", *p["claim"]),
            "customer": self._uniq("KL-{:06d}", *p["customer"]),
            "claim_list": ", ".join(self._uniq("CLM-2026-{:04d}", *p["claim"]) for _ in range(r.randint(3, 5))),
            "date": f"{r.randint(1, 28)} {r.choice(MONTHS[lang])} 2026",
            "city": r.choice(p["city"][lang if lang in p["city"] else "nl"]),
            "amount": f"EUR {r.randint(80, 9800):,}".replace(",", "." if lang != "en" else ","),
        }


SLOT_RE = re.compile(r"\{([a-z_]+)\}")


def render(text, vals, labels, lang, anon=False):
    def sub(m):
        k = m.group(1)
        if k == "body":
            return m.group(0)
        if k not in SLOT_LABELS:
            raise ValueError(f"unknown slot {{{k}}} in: {text[:80]}")
        if anon and k in ANON[lang]:
            return ANON[lang][k]
        labels.update(SLOT_LABELS[k])
        return vals[k]
    return SLOT_RE.sub(sub, text)


def typo(text, rng):
    words = text.split(" ")
    cand = [i for i, w in enumerate(words) if len(w) > 4 and w.isalpha()]
    if not cand:
        return text
    i = rng.choice(cand)
    w = words[i]
    j = rng.randrange(1, len(w) - 2)
    words[i] = w[:j] + w[j + 1] + w[j] + w[j + 2:]
    return " ".join(words)


def has_slots(t, slots):
    return any("{" + s + "}" in t for s in slots)


class Composer:
    def __init__(self, bank, pool, seed, langs, avoid_texts=()):
        self.b, self.rng, self.langs = bank, random.Random(seed), langs
        joined = "\n".join(avoid_texts)
        self.avoid_sh = set().union(*[shingles(t) for t in avoid_texts]) if avoid_texts else set()
        self.ent = Entities(pool, self.rng, ID_RE.findall(joined), NAME_RE.findall(joined))
        self.rejected = 0

    def pick(self, lst, avoid_slots=None):
        if avoid_slots:
            ok = [x for x in lst if not has_slots(x, avoid_slots)]
            lst = ok or lst
        return self.rng.choice(lst)

    def maybe_typo(self, t, p=.12):
        return typo(t, self.rng) if self.rng.random() < p else t

    def row(self, kind, lang):
        r, B = self.rng, self.b
        F, R, S = B["fragments"][lang], B["requests"][lang], B["shells"][lang]
        vals = self.ent.values(lang)
        labels, notes = set(), [kind]
        if kind in ("standalone_benign", "standalone_tricky", "discriminatory", "bulk_export"):
            labels.update(REQUEST_LABELS[kind])
            return render(self.maybe_typo(self.pick(R[kind])), vals, labels, lang), labels, notes
        anon = kind == "anon_doc" or (kind == "sensitive_doc" and r.random() < .2)
        ident_slots = ["name", "first", "other_name", "email", "phone", "address", "iban", "bsn", "policy", "claim", "customer"]
        shells = [s for s in S if not has_slots(s, ident_slots)] if anon else [s for s in S if has_slots(s, ident_slots)]
        shell = self.pick(shells or S)
        ctype = r.choice(CLAIM_TYPES)
        facts = list(F["claim_facts"][ctype])
        r.shuffle(facts)
        avoid = ["first", "other_name", "claim"] if anon else None
        body = [self.maybe_typo(self.pick([f]) if not avoid else f) for f in facts[:r.randint(1, 3)]
                if not (avoid and has_slots(f, avoid))] or [self.pick(F["claim_facts"][ctype], avoid)]
        frags = []
        if kind == "sensitive_doc":
            frags = r.sample(SENSITIVE, 2 if r.random() < .3 else 1)
        elif kind == "auto_decision" and r.random() < .3:
            frags = [r.choice(SENSITIVE)]
        elif kind == "injection_doc" and r.random() < .35:
            frags = [r.choice(SENSITIVE)]
        for cat in frags:
            body.insert(r.randint(0, len(body)), self.pick(F[cat], avoid))
            labels.update(FRAGMENT_LABELS[cat])
            notes.append(cat)
        if kind == "injection_doc":
            body.insert(r.randint(1, len(body)), self.pick(F["injection"], avoid))
            labels.add("INJECTION")
        if kind in ("anon_doc", "ident_doc") and r.random() < .35:
            body.insert(r.randint(0, len(body)), self.pick(F["tricky_negative"], avoid))
            notes.append("tricky negative")
        doc = shell.replace("{body}", " ".join(body))
        if kind == "auto_decision":
            task = self.pick(R["auto_decision_task"], avoid)
            labels.add("AUTO_DECISION")
        else:
            task = self.pick(R["review_draft_task"] if r.random() < .25 else R["benign_task"], avoid)
            if "review" in notes[-1:]:
                pass
        task = self.maybe_typo(task, .08)
        prompt = (task + r.choice(SEPARATORS) + doc) if r.random() < .75 else (doc + "\n\n" + task)
        prompt = render(prompt, vals, labels, lang, anon=anon)
        prompt = re.sub(r"(EUR|€)\s*EUR\s", r"\1 ", prompt)   # bank text "EUR {amount}" + slot "EUR 1,234"
        if kind == "auto_decision" and labels == {"AUTO_DECISION"}:
            pass
        return prompt, labels, notes

    def generate(self, n, lang_weights):
        kinds = [k for k, _ in MIX]
        weights = [w for _, w in MIX]
        langs, lw = zip(*lang_weights)
        seen, out = set(), []
        while len(out) < n:
            kind = self.rng.choices(kinds, weights)[0]
            lang = self.rng.choices(langs, lw)[0]
            prompt, labels, notes = self.row(kind, lang)
            key = re.sub(r"\W+", " ", prompt.lower())
            if key in seen:
                continue
            if self.avoid_sh and shingles(prompt) & self.avoid_sh:
                self.rejected += 1          # shares an 8-word sequence with tuning data
                continue
            seen.add(key)
            out.append((lang, prompt, labels, notes))
        return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--bank", required=True)
    ap.add_argument("--pool", choices=list(POOLS), required=True)
    ap.add_argument("--n", type=int, required=True)
    ap.add_argument("--start", type=int, default=1)
    ap.add_argument("--prefix", required=True)
    ap.add_argument("--split", help="split column value (default = prefix)")
    ap.add_argument("--seed", type=int, default=20261121)
    ap.add_argument("--langs", default="en:0.58,nl:0.29,de:0.13")
    ap.add_argument("--out", required=True)
    ap.add_argument("--avoid", nargs="*", default=[], help="tuning CSVs: reuse none of their IDs/names/8-word sequences")
    a = ap.parse_args(argv)
    bank = json.loads(Path(a.bank).read_text(encoding="utf-8"))
    lw = [(x.split(":")[0], float(x.split(":")[1])) for x in a.langs.split(",")]
    avoid = []
    for path in a.avoid:
        with open(path, newline="", encoding="utf-8") as f:
            avoid += [r["prompt"] for r in csv.DictReader(f)]
    comp = Composer(bank, a.pool, a.seed, [l for l, _ in lw], avoid)
    rows = comp.generate(a.n, lw)
    if avoid:
        print(f"avoid: {len(avoid)} tuning rows; {comp.rejected} candidate rows rejected for 8-word overlap")
    width = 3 if a.start + a.n - 1 < 1000 else 4
    with open(a.out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS)
        w.writeheader()
        for i, (lang, prompt, labels, notes) in enumerate(rows, a.start):
            t = bc.tier_of(labels)
            rec = {"id": f"{a.prefix}-{i:0{width}d}", "split": a.split or a.prefix, "lang": lang, "prompt": prompt,
                   "gold_tier": t, "gold_route": bc.ROUTE_OF_TIER[t],
                   "notes": f"composed from {Path(a.bank).name} ({a.pool} pools): " + ", ".join(notes)}
            rec.update({l: int(l in labels) for l in bc.LABELS})
            w.writerow(rec)
    from collections import Counter
    tiers = Counter(bc.tier_of(l) for _, _, l, _ in rows)
    labs = Counter(x for _, _, l, _ in rows for x in l)
    print(f"wrote {len(rows)} rows -> {a.out}")
    print("tiers", dict(sorted(tiers.items())), "| langs", dict(Counter(r[0] for r in rows)))
    print("labels", {l: labs[l] for l in bc.LABELS})


if __name__ == "__main__":
    main()
