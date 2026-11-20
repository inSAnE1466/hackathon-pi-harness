// Extract articles, paragraphs and recitals from an EUR-Lex consolidated HTML page (the official text).
// EUR-Lex marks each article as <div class="eli-subdivision" id="art_N"> and each paragraph as <div id="NNN.MMM">,
// and each recital as <div class="eli-subdivision" id="rct_N">.
const clean = (html) =>
  html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "")
    .replace(/<\/(p|td|tr|li|div)>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .replace(/\(([a-z]|[ivx]+)\)\n/g, "($1) ")
    .trim();

/** The HTML of one element with the given id, up to its matching close tag. */
function block(html, id) {
  const start = html.search(new RegExp(`<div[^>]*\\bid="${id.replace(/\./g, "\\.")}"`));
  if (start === -1) return undefined;
  let depth = 0;
  const tag = /<(\/?)div\b[^>]*>/g;
  tag.lastIndex = start;
  for (let m; (m = tag.exec(html));) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, tag.lastIndex);
  }
  return undefined;
}

export function article(html, n) {
  const art = block(html, `art_${n}`);
  if (!art) return undefined;
  const title = clean(/class="oj-sti-art">([\s\S]*?)<\/p>/.exec(art)?.[1] ?? "");
  const pad = String(n).padStart(3, "0");
  const paragraphs = [];
  for (let p = 1; p < 40; p++) {
    const para = block(art, `${pad}.${String(p).padStart(3, "0")}`);
    if (!para) break;
    paragraphs.push({ n: p, text: clean(para).replace(/^\d+\.\s+/, "") });
  }
  // Articles without numbered paragraphs (one block of text)
  if (paragraphs.length === 0) {
    const body = art
      .replace(/<p[^>]*class="oj-ti-art"[\s\S]*?<\/p>/, "")
      .replace(/<div class="eli-title"[\s\S]*?<\/div>/, "");
    paragraphs.push({ n: 0, text: clean(body) });
  }
  return { title, paragraphs };
}

export function recital(html, n) {
  const r = block(html, `rct_${n}`);
  return r ? clean(r).replace(/^\(\d+\)\s*/, "") : undefined;
}

/** Annex by roman numeral, e.g. "III". */
export function annex(html, roman) {
  const id = `anx_${roman}`;
  const a = block(html, id);
  return a ? clean(a) : undefined;
}
