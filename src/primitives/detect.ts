/**
 * detect: deterministic identifier checks that cover the gaps measured in BRANE's detectors (evals/decision-log.md):
 * a Dutch BSN is labeled ACCOUNT_NUMBER, a passport number is labeled ACCOUNT_NUMBER, and a policy number is
 * labeled PERSON and only partly masked. Pure functions: same input, same answer, every time.
 */
export type Finding = {
  readonly kind: "BSN" | "POLICY_ID" | "CLAIM_ID" | "PASSPORT";
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
