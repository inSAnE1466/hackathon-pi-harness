#!/usr/bin/env node
// Build the corpus the agent searches (corpus/passages.json): the law from the official EUR-Lex texts, split into
// paragraphs with stable ids, plus the synthetic insurer's policy terms, medical-claims criteria, case-law and guidance
// summaries. Each passage records its source URL, the CELEX number and a content hash, so a rebuild shows any change.
// EU legislation may be reused (Commission Decision 2011/833/EU).
// Run: node corpus/build.mjs   (fetches EUR-Lex once and caches the HTML under /tmp/legal)
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { annex, article, recital } from "./eurlex.mjs";

const SOURCES = [
  {
    key: "GDPR",
    source: "GDPR",
    celex: "32016R0679",
    articles: [4, 5, 6, 9, 10, 13, 15, 22, 25, 28, 30, 32, 35, 44, 46, 87],
    recitals: [26, 35, 38, 51, 71],
  },
  {
    key: "AIA",
    source: "EU AI Act",
    celex: "32024R1689",
    articles: [6, 12, 13, 14, 19, 26, 27, 50],
    annexes: ["III"],
  },
];

const url = (celex) => `https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:${celex}`;
const hash = (text) => createHash("sha256").update(text).digest("hex").slice(0, 12);

async function official(celex) {
  mkdirSync("/tmp/legal", { recursive: true });
  const file = `/tmp/legal/${celex}.html`;
  if (!existsSync(file)) {
    const res = await fetch(url(celex), {
      headers: { "User-Agent": "Mozilla/5.0 (corpus build)" },
    });
    if (!res.ok) throw new Error(`EUR-Lex ${celex} -> ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return readFileSync(file, "utf8");
}

const passages = [];
const add = (p) => passages.push({ ...p, hash: hash(p.text) });

for (const s of SOURCES) {
  const html = await official(s.celex);
  for (const n of s.articles) {
    const a = article(html, n);
    if (!a) throw new Error(`${s.key} Art. ${n} not found in ${s.celex}`);
    // Definitions articles (GDPR Art. 4) are one paragraph of numbered points; split them into one passage each.
    const defs = a.paragraphs.length === 1 ? a.paragraphs[0].text.split(/\n\s*\((\d+)\)\s*\n/) : [];
    if (defs.length > 3) {
      for (let i = 1; i < defs.length; i += 2) {
        add({
          id: `${s.key}-${n}(${defs[i]})`,
          source: s.source,
          title: `Art. ${n}(${defs[i]}) ${a.title}`,
          text: defs[i + 1].trim(),
          url: `${url(s.celex)}#art_${n}`,
          celex: s.celex,
        });
      }
      continue;
    }
    for (const p of a.paragraphs) {
      add({
        id: `${s.key}-${s.key === "AIA" ? "Art" : ""}${n}${p.n && a.paragraphs.length > 1 ? `(${p.n})` : ""}`,
        source: s.source,
        title: `Art. ${n}${p.n && a.paragraphs.length > 1 ? `(${p.n})` : ""} ${a.title}`,
        text: p.text.slice(0, 3000),
        url: `${url(s.celex)}#art_${n}`,
        celex: s.celex,
      });
    }
  }
  for (const n of s.recitals ?? []) {
    const text = recital(html, n);
    if (!text) throw new Error(`${s.key} Recital ${n} not found`);
    add({
      id: `${s.key}-R${n}`,
      source: s.source,
      title: `Recital ${n}`,
      text,
      url: `${url(s.celex)}#rct_${n}`,
      celex: s.celex,
    });
  }
  for (const roman of s.annexes ?? []) {
    const text = annex(html, roman);
    if (!text) throw new Error(`${s.key} Annex ${roman} not found`);
    // Split the annex into its numbered points so a search returns the relevant one.
    const points = text.split(/\n\s*(?=\d+\.\s*\n)/).filter((t) => /^\d+\./.test(t.trim()));
    for (const point of points) {
      const n = /^(\d+)\./.exec(point.trim())[1];
      add({
        id: `${s.key}-Annex${roman === "III" ? 3 : roman}(${n})`,
        source: s.source,
        title: `Annex ${roman} point ${n}`,
        text: point.trim().slice(0, 3000),
        url: `${url(s.celex)}#anx_${roman}`,
        celex: s.celex,
      });
    }
  }
  console.log(`${s.key}: official text ${s.celex}`);
}

// The insurer's own material (synthetic) and summaries of case law and guidance, with their sources.
for (const file of [
  "corpus/policy-terms.jsonl",
  "corpus/medical-criteria.jsonl",
  "corpus/guidance.jsonl",
  "corpus/methods.jsonl",
]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").trim().split("\n")) add(JSON.parse(line));
}

writeFileSync("corpus/passages.json", JSON.stringify(passages, null, 1) + "\n");
const bySource = passages.reduce((m, p) => ({ ...m, [p.source]: (m[p.source] ?? 0) + 1 }), {});
console.log(`wrote corpus/passages.json: ${passages.length} passages`, bySource);
