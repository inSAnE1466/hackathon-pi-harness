import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import passages from "../../corpus/passages.json";
import glossary from "../../policy/lookup-glossary.json";
import { DEFAULT_RANKING } from "./lookup-ranking.ts";
import { buildIndex } from "./rank.ts";

/**
 * lookup is a keyword search over the legal corpus and the insurer's policy terms (corpus/passages.json). It runs
 * BM25 (src/primitives/rank.ts, with the switches the climb kept) over passages bundled into the Worker. It is
 * deterministic and needs no external service, and every result carries a passage id the agent cites and the audit
 * can trace. It runs inside the perimeter, so nothing leaves.
 */
export type Passage = {
  readonly id: string;
  readonly source: string;
  readonly title: string;
  readonly text: string;
  readonly url: string;
};

const CORPUS = passages as readonly Passage[];
const ranked = buildIndex(CORPUS, DEFAULT_RANKING, glossary.terms);

export function search(query: string, limit = 4, source?: string): Passage[] {
  return ranked(query, limit, (i) => !source || CORPUS[i].source === source).map((i) => CORPUS[i]);
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
