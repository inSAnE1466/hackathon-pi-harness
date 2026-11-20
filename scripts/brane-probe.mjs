#!/usr/bin/env node
// Show what BRANE does with one input under the live policy: route, detections, semantic matches, injection score,
// and the exact payload that would leave for the cloud. Dry run by default; --live also runs the model.
// Usage: node scripts/brane-probe.mjs "text"   or   echo "text" | node scripts/brane-probe.mjs [--live]
// Reads BRANE_BASE_URL and BRANE_API_KEY from the environment or .dev.vars. Never prints the key.
import { existsSync, readFileSync } from "node:fs";

const vars = { ...process.env };
if (existsSync(".dev.vars")) {
  for (const line of readFileSync(".dev.vars", "utf8").split("\n")) {
    const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !vars[m[1]]) vars[m[1]] = m[2];
  }
}
const args = process.argv.slice(2);
const live = args.includes("--live");
const text = args.filter((a) => a !== "--live").join(" ") || readFileSync(0, "utf8").trim();
if (!text) throw new Error("Give the text as an argument or on stdin");

const res = await fetch(`${vars.BRANE_BASE_URL.replace(/\/+$/, "")}/policy/test`, {
  method: "POST",
  headers: { Authorization: `Bearer ${vars.BRANE_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ prompt: text, executeCompletion: live }),
});
const j = await res.json();
if (!res.ok) throw new Error(`BRANE ${res.status}: ${JSON.stringify(j).slice(0, 300)}`);

const d = j.decision;
console.log(`route      ${d.route}  (action ${d.winningAction}, HTTP ${d.httpStatus})`);
for (const c of j.detectedCategories) {
  console.log(
    `detected   ${c.label.padEnd(18)} ${c.confidence.toFixed(2)}  ${c.detector.padEnd(8)} ${c.action.padEnd(11)} "${c.sampleText.trim()}"`,
  );
}
for (const s of j.matchedSemanticCategories)
  console.log(`semantic   ${s.code ?? JSON.stringify(s)}`);
console.log(
  `injection  ${j.promptInjection.detected ? "DETECTED" : "clean"} (${j.promptInjection.score.toFixed(3)})`,
);
console.log(
  `leaves     ${d.route === "cloud" ? j.outgoingCloudPayloadPreview : "[nothing leaves for the cloud]"}`,
);
if (live && j.liveCompletion) console.log(`answer     ${j.liveCompletion.preview}`);
