#!/usr/bin/env node
// Apply policy/brane.json to our BRANE department, or compare it with the live one.
// Usage: node scripts/brane-policy.mjs diff | apply
// Reads BRANE_BASE_URL and BRANE_API_KEY from the environment or .dev.vars. Never prints the key.
import { readFileSync, existsSync } from "node:fs";

function env() {
  const vars = { ...process.env };
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (m && !vars[m[1]]) vars[m[1]] = m[2];
    }
  }
  if (!vars.BRANE_BASE_URL || !vars.BRANE_API_KEY)
    throw new Error("BRANE_BASE_URL and BRANE_API_KEY are required");
  return { base: vars.BRANE_BASE_URL.replace(/\/+$/, ""), key: vars.BRANE_API_KEY };
}

async function brane(method, path, body) {
  const { base, key } = env();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

const file = JSON.parse(readFileSync("policy/brane.json", "utf8"));
const desired = {
  routingMode: file.routingMode,
  piiSensitivity: file.piiSensitivity,
  categories: file.categories,
  semanticCategories: file.semanticCategories,
};

const live = await brane("GET", "/policy");
const changed = Object.entries(desired.categories).filter(([k, v]) => live.categories?.[k] !== v);
const liveCodes = new Set((live.semanticCategories ?? []).map((s) => s.code));
const fileCodes = new Set(desired.semanticCategories.map((s) => s.code));
console.log(`live: ${live.team} mode=${live.routingMode} sensitivity=${live.piiSensitivity}`);
console.log(
  `file: ${file.version} mode=${desired.routingMode} sensitivity=${desired.piiSensitivity}`,
);
console.log(
  `categories to change: ${changed.map(([k, v]) => `${k}:${live.categories?.[k] ?? "?"}->${v}`).join(", ") || "none"}`,
);
console.log(
  `semantic to add: ${[...fileCodes].filter((c) => !liveCodes.has(c)).join(", ") || "none"}`,
);
console.log(
  `semantic to remove: ${[...liveCodes].filter((c) => !fileCodes.has(c)).join(", ") || "none"}`,
);

if (process.argv[2] === "apply") {
  const saved = await brane("PUT", "/policy", desired);
  console.log(`saved: ${JSON.stringify(saved.summary)}`);
}
