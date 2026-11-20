import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import passages from "../../corpus/passages.json";

/**
 * lookup: keyword search over the legal corpus and the insurer's policy terms (corpus/passages.json).
 * BM25 over passages bundled into the Worker, so it is deterministic, needs no external service, and every result
 * carries a passage id the agent cites and the audit can trace. Runs inside the perimeter; nothing leaves.
 */
export type Passage = {
  readonly id: string;
  readonly source: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
};

const CORPUS = passages as readonly Passage[];
const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or that the this to was were which with shall may not any".split(
    " ",
  ),
);
const tokens = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));

const docs = CORPUS.map((p) => tokens(`${p.id} ${p.title} ${p.text}`));
const avgLen = docs.reduce((a, d) => a + d.length, 0) / docs.length;
const df = new Map<string, number>();
for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);

export function search(query: string, limit = 4, source?: string): Passage[] {
  const q = tokens(query);
  const k1 = 1.4;
  const b = 0.75;
  const scored = docs.map((d, i) => {
    let score = 0;
    for (const t of q) {
      const f = d.filter((x) => x === t).length;
      if (f === 0) continue;
      const idf = Math.log(1 + (docs.length - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avgLen));
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0 && (!source || CORPUS[s.i].source === source))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => CORPUS[s.i]);
}

export const lookupTool: ToolRegistration = {
  name: "lookup",
  description:
    "Search the insurer's policy terms, its claims criteria (medical necessity, documents, causality, emergency care, luggage), the law (GDPR, EU AI Act from the official EUR-Lex text, case law, regulator guidance) and assessment methods (privacy and AI triage). Use it before stating what a policy covers or what the law requires, and cite the passage ids it returns.",
  parameters: obj({
    query: str({
      description: "What to look up, in plain words, e.g. 'physiotherapy sessions covered'",
    }),
    source: opt(
      str({
        description:
          "Optional filter: 'Policy terms', 'Claims criteria', 'GDPR', 'EU AI Act', 'Case law', 'Guidance' or 'Method'",
      }),
    ),
    limit: opt(int({ description: "Passages to return, 1 to 6 (default 4)" })),
  }),
  replay: "safe",
  execute: async (args) => {
    const { query, source, limit } = args as { query: string; source?: string; limit?: number };
    const hits = search(query, Math.min(Math.max(limit ?? 4, 1), 6), source);
    const text = hits.length
      ? hits.map((p) => `[${p.id}] ${p.title}\n${p.text}`).join("\n\n")
      : "No passage matched. Try other words, or say that the corpus does not cover it.";
    return {
      output: [{ type: "text" as const, text }],
      details: { ids: hits.map((p) => p.id) },
    };
  },
};
