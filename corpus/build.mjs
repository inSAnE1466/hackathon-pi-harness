#!/usr/bin/env node
// Build the legal corpus the agent searches: fetch the public law texts our policy cites, split them into
// passages with stable ids, add our synthetic policy terms, and write corpus/passages.json.
// Sources: GDPR (gdpr-info.eu mirror of Regulation (EU) 2016/679), AI Act (artificialintelligenceact.eu mirror of
// Regulation (EU) 2024/1689). EU legislation may be reused (Commission Decision 2011/833/EU); each passage keeps its
// source URL. Run when the article list changes: node corpus/build.mjs
import { readFileSync, writeFileSync } from "node:fs";

const GDPR = [4, 5, 6, 9, 10, 13, 15, 22, 25, 28, 30, 32, 35, 44, 46];
const AI_ACT = [6, 12, 13, 14, 19, 26, 27, 50];
const AI_ACT_ANNEX = [3];

const clean = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
    .replace(/<\/(li|p|div|h\d)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();

async function get(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (corpus build)" } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.text();
}

// The article's paragraphs are the top-level <li> of its first <ol>; nested lists stay inside their paragraph.
function topLevelItems(body) {
  const start = body.indexOf("<ol>");
  if (start === -1) return [clean(body)];
  const items = [];
  let depth = 0;
  let itemStart = -1;
  const tag = /<(\/?)(ol|li)\b[^>]*>/g;
  tag.lastIndex = start;
  for (let m; (m = tag.exec(body));) {
    const [, close, name] = m;
    if (name === "ol") {
      depth += close ? -1 : 1;
      if (depth === 0) break;
    } else if (depth === 1 && !close) itemStart = tag.lastIndex;
    else if (depth === 1 && close && itemStart >= 0) {
      items.push(clean(body.slice(itemStart, m.index)));
      itemStart = -1;
    }
  }
  return items.length ? items : [clean(body)];
}

const passages = [];

for (const n of GDPR) {
  const url = `https://gdpr-info.eu/art-${n}-gdpr/`;
  const html = await get(url);
  const title =
    /<h1[^>]*>([\s\S]*?)<\/h1>/
      .exec(html)?.[1]
      .replace(/<[^>]+>/g, "")
      .trim() ?? `Art. ${n} GDPR`;
  const body = /<div class="entry-content">([\s\S]*?)<div class="emp/.exec(html)?.[1] ?? "";
  const paras = topLevelItems(body);
  paras.forEach((text, i) => {
    if (text.length < 20) return;
    passages.push({
      id: `GDPR-${n}${paras.length > 1 ? `(${i + 1})` : ""}`,
      source: "GDPR",
      title: title.replace(/\s+/g, " "),
      text,
      url,
    });
  });
  console.log(`GDPR Art. ${n}: ${paras.length} passages`);
}

async function aiAct(kind, n) {
  const url = `https://artificialintelligenceact.eu/${kind}/${n}/`;
  const html = await get(url);
  const title = clean(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html)?.[1] ?? `${kind} ${n}`);
  // Each paragraph is a depth-0 block; its sub-points are the depth-1 blocks that follow it.
  const blocks = [
    ...html.matchAll(/<div class="para (depth-\d)"[^>]*>([\s\S]*?)<div class="para-actions">/g),
  ];
  const paras = [];
  for (const [, depth, inner] of blocks) {
    const label = clean(/<span class="para-label">([\s\S]*?)<\/span>/.exec(inner)?.[1] ?? "");
    const text = clean(
      (/<span class="para-text">([\s\S]*)/.exec(inner)?.[1] ?? inner).replace(
        /<span class="term-tip">[\s\S]*?<\/span><\/span>/g,
        "",
      ),
    );
    if (depth === "depth-0" || paras.length === 0) paras.push(`${label} ${text}`.trim());
    else paras[paras.length - 1] += `\n${label} ${text}`;
  }
  paras.forEach((text, i) =>
    passages.push({
      id: `AIA-${kind === "annex" ? "Annex" : "Art"}${n}${paras.length > 1 ? `(${i + 1})` : ""}`,
      source: "EU AI Act",
      title,
      text: text.slice(0, 2400),
      url,
    }),
  );
  console.log(`AI Act ${kind} ${n}: ${paras.length} passages`);
}
for (const n of AI_ACT) await aiAct("article", n);
for (const n of AI_ACT_ANNEX) await aiAct("annex", n);

// Our synthetic insurer's policy terms and the summaries of case law and guidance the policy relies on.
for (const line of readFileSync("corpus/policy-terms.jsonl", "utf8").trim().split("\n"))
  passages.push(JSON.parse(line));
for (const line of readFileSync("corpus/guidance.jsonl", "utf8").trim().split("\n"))
  passages.push(JSON.parse(line));

writeFileSync("corpus/passages.json", JSON.stringify(passages, null, 1) + "\n");
console.log(`wrote corpus/passages.json: ${passages.length} passages`);
