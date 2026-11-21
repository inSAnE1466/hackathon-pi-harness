/**
 * detect: deterministic identifier checks that cover the gaps measured in BRANE's detectors (evals/decision-log.md):
 * a Dutch BSN is labeled ACCOUNT_NUMBER, a passport number is labeled ACCOUNT_NUMBER, and a policy number is
 * labeled PERSON and only partly masked, and a Dutch licence plate is not detected. Pure functions: same input, same answer, every time.
 */
export type Finding = {
  readonly kind: "BSN" | "POLICY_ID" | "CLAIM_ID" | "PASSPORT" | "PLATE";
  readonly text: string;
};

/** The Dutch BSN "11-proof": 9 digits, weights 9..2 and -1, sum divisible by 11. */
export function isBsn(digits: string): boolean {
  if (!/^\d{9}$/.test(digits) || digits === "000000000") return false;
  const d = [...digits].map(Number);
  const sum = d.slice(0, 8).reduce((s, x, i) => s + x * (9 - i), 0) - d[8];
  return sum % 11 === 0;
}

export function findIdentifiers(text: string): Finding[] {
  const found: Finding[] = [];
  for (const m of text.matchAll(/(?<![\d-])(\d{3}[ .]?\d{2}[ .]?\d{4}|\d{9})(?![\d-])/g)) {
    if (isBsn(m[1].replace(/[ .]/g, ""))) found.push({ kind: "BSN", text: m[1] });
  }
  for (const m of text.matchAll(/\bPOL-\d{4}-\d{2}\b/g))
    found.push({ kind: "POLICY_ID", text: m[0] });
  for (const m of text.matchAll(/\bCLM-\d{4}-\d{4}\b/g))
    found.push({ kind: "CLAIM_ID", text: m[0] });
  for (const m of text.matchAll(/\bpassport(?: number)?:?\s+([A-Z]{2}[A-Z0-9]{6,7})\b/gi)) {
    found.push({ kind: "PASSPORT", text: m[1] });
  }
  // Dutch licence plates (sidecode formats such as 12-ABC-3, AB-123-C, 1-ABC-23); BRANE does not detect them.
  for (const m of text.matchAll(
    /\b(?:\d{1,2}-[A-Z]{2,3}-\d{1,2}|[A-Z]{1,2}-\d{2,3}-[A-Z]{1,2}|\d{2}-[A-Z]{2}-[A-Z]{2}|[A-Z]{2}-[A-Z]{2}-\d{2})\b/gi,
  )) {
    found.push({ kind: "PLATE", text: m[0] });
  }
  return found;
}

/** Replace each finding with a stable token, so a payload can go to the cloud without the value. */
export function mask(text: string, findings: readonly Finding[]): string {
  let out = text;
  const seen = new Map<string, string>();
  for (const f of findings) {
    if (!seen.has(f.text)) seen.set(f.text, `<${f.kind}_${seen.size + 1}>`);
    out = out.split(f.text).join(seen.get(f.text)!);
  }
  return out;
}

/**
 * The second classifier's pure half. The spec (prompt template, label definitions, label to route) lives in
 * policy/classifier.json; the caller runs the prompt on BRANE's local model through a local-only draft policy, so
 * the text never leaves, and passes the reply here. The classifier can only make a route stricter.
 */
export type Outcome = "allow" | "protect" | "local" | "refuse";
export type ClassifierSpec = {
  readonly version: string;
  readonly template: string;
  /** The labels that move a route. Labels left out are reported but ignored (BRANE already handles them). */
  readonly counted?: readonly string[];
  readonly labels: Readonly<
    Record<string, { readonly route: Outcome; readonly definition: string }>
  >;
};
export type Verdict = { readonly labels: readonly string[]; readonly route: Outcome };

const RANK: Readonly<Record<Outcome, number>> = { allow: 0, protect: 1, local: 2, refuse: 3 };

/** The stricter of two outcomes. */
export const stricter = (a: Outcome, b: Outcome): Outcome => (RANK[a] >= RANK[b] ? a : b);

/** The prompt for one text: every label with its definition, the text fenced as data. */
export function classifierPrompt(spec: ClassifierSpec, text: string): string {
  const names = Object.keys(spec.labels);
  return spec.template
    .replace("{definitions}", names.map((l) => `- ${l}: ${spec.labels[l].definition}`).join("\n"))
    .replace("{keys}", names.map((l) => `"${l}": 0`).join(", "))
    .replace("{text}", () => text);
}

/**
 * Read the model's reply: one JSON object with every label as 0 or 1. A reply that cannot be read, or that lacks a
 * label, yields route "local" with no labels: a failed classifier never loosens a route.
 */
export function readVerdict(spec: ClassifierSpec, reply: string | null | undefined): Verdict {
  const failed: Verdict = { labels: [], route: "local" };
  const match = /\{[\s\S]*\}/.exec(reply ?? "");
  if (!match) return failed;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return failed;
  }
  const labels: string[] = [];
  for (const name of Object.keys(spec.labels)) {
    const value = parsed[name];
    if (value === undefined) return failed;
    if (/^(1|true|yes)$/i.test(String(value).trim())) labels.push(name);
  }
  const counted = labels.filter((l) => spec.counted?.includes(l) ?? true);
  return { labels, route: counted.map((l) => spec.labels[l].route).reduce(stricter, "allow") };
}
