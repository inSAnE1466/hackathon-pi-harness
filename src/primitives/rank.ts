/**
 * rank: the lookup tool's ranking, as pure functions over a list of passages. BM25 with switches the climb scores one
 * at a time on evals/legal/dev.jsonl (evals/legal.mjs); DEFAULT_RANKING holds the switches that were kept.
 */
export type Ranked = { readonly id: string; readonly title: string; readonly text: string };

export type Ranking = {
  /** Reduce English plurals and verb endings to one form, so "claims" finds "claim". */
  readonly stem: boolean;
  /** Add the glossary's legal terms for plain or Dutch words in the question. */
  readonly glossary: boolean;
  /** Count a passage's id and title this many times. 1 is plain BM25 over id, title and text. */
  readonly titleWeight: number;
  /** After the best hit, prefer passages that answer words the hits so far do not. For two-part questions. */
  readonly diverse: boolean;
  /** Rank each part of a two-part question ("..., and ...", "...: ... and ...") by itself and take hits in turn. */
  readonly split: boolean;
};

export const BASELINE_RANKING: Ranking = {
  stem: false,
  glossary: false,
  titleWeight: 1,
  diverse: false,
  split: false,
};

/** Plain or Dutch word (or phrase) to the terms the legal text uses. */
export type Glossary = Readonly<Record<string, string>>;

const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were which with shall may not any".split(
    " ",
  ),
);
const clean = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ");

function stemOf(t: string): string {
  if (t.length < 5 || /\d/.test(t)) return t;
  for (const [suffix, to] of [
    ["isation", "ise"],
    ["ization", "ise"],
    ["ies", "y"],
    ["sses", "ss"],
    ["ing", ""],
    ["ed", ""],
    ["es", "e"],
    ["s", ""],
  ] as const) {
    if (t.endsWith(suffix) && t.length - suffix.length >= 3 && !t.endsWith("ss"))
      return t.slice(0, t.length - suffix.length) + to;
  }
  return t;
}

export function buildIndex(passages: readonly Ranked[], ranking: Ranking, glossary: Glossary = {}) {
  const tokens = (s: string) => {
    const words = clean(s)
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOP.has(t));
    return ranking.stem ? words.map(stemOf) : words;
  };
  const docs = passages.map((p) => {
    const head = tokens(`${p.id} ${p.title}`);
    const all = [...tokens(p.text)];
    for (let i = 0; i < ranking.titleWeight; i++) all.push(...head);
    const tf = new Map<string, number>();
    for (const t of all) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { tf, length: all.length };
  });
  const avgLen = docs.reduce((a, d) => a + d.length, 0) / docs.length;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const entries = Object.entries(glossary).map(([k, v]) => [` ${clean(k).trim()} `, v] as const);

  const k1 = 1.4;
  const b = 0.75;
  const termScore = (t: string, d: (typeof docs)[number]) => {
    const f = d.tf.get(t) ?? 0;
    if (f === 0) return 0;
    const n = df.get(t) ?? 0;
    const idf = Math.log(1 + (docs.length - n + 0.5) / (n + 0.5));
    return (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen));
  };

  /** Indexes of matching passages, best first. `keep` filters before the cut. */
  return function search(
    query: string,
    limit: number,
    keep: (i: number) => boolean = () => true,
  ): number[] {
    if (!ranking.split) return one(query, limit, keep);
    const parts = query
      .split(/\s*(?:[:;?]|,? and (?=wh|is |are |does |do |the |an? ))\s*/i)
      .filter((part) => part.trim().split(/\s+/).length >= 3);
    if (parts.length < 2) return one(query, limit, keep);
    // The whole question keeps the first place; each part then adds its own best hits in turn.
    const lists = [one(query, limit, keep), ...parts.map((part) => one(part, limit, keep))];
    const merged: number[] = [];
    for (let rank = 0; merged.length < limit && rank < limit; rank++) {
      for (const list of rank === 0 ? lists : lists.slice(1)) {
        const hit = list[rank];
        if (hit !== undefined && !merged.includes(hit) && merged.length < limit) merged.push(hit);
      }
    }
    return merged;
  };

  function one(query: string, limit: number, keep: (i: number) => boolean): number[] {
    let text = query;
    if (ranking.glossary) {
      const padded = ` ${clean(query).replace(/\s+/g, " ").trim()} `;
      for (const [k, v] of entries) if (padded.includes(k)) text += ` ${v}`;
    }
    const q = [...new Set(tokens(text))];
    const scored = docs
      .map((d, i) => ({ i, terms: q.map((t) => termScore(t, d)) }))
      .map((x) => ({ ...x, score: x.terms.reduce((a, s) => a + s, 0) }))
      .filter((x) => x.score > 0 && keep(x.i))
      .sort((a, b) => b.score - a.score);
    if (!ranking.diverse) return scored.slice(0, limit).map((x) => x.i);
    // Greedy cover: each next hit is scored with the query words the earlier hits already answer at half weight.
    const picked: typeof scored = [];
    const pool = scored.slice(0, 30);
    const covered = q.map(() => 0);
    while (picked.length < limit && pool.length) {
      let best = 0;
      let bestScore = -1;
      pool.forEach((x, n) => {
        const s = x.terms.reduce((a, v, t) => a + v / (1 + covered[t]), 0);
        if (s > bestScore) ((best = n), (bestScore = s));
      });
      const [x] = pool.splice(best, 1);
      x.terms.forEach((v, t) => v > 0 && covered[t]++);
      picked.push(x);
    }
    return picked.map((x) => x.i);
  }
}
