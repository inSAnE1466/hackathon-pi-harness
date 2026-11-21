#!/usr/bin/env node
// The BRANE contract probe checks the five things about BRANE's API that our fail-closed code relies on, each once
// against the live endpoint, one request at a time. Beside each is the test that shows what the harness does when
// the assumption does not hold. Usage: node evals/contract.mjs   (reads .dev.vars; never prints the key)
// Synthetic data only.
import { readFileSync } from "node:fs";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => [
      line.slice(0, line.indexOf("=")),
      line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, ""),
    ]),
);
const base = vars.BRANE_BASE_URL.replace(/\/+$/, "");
const headers = {
  Authorization: `Bearer ${vars.BRANE_API_KEY}`,
  "Content-Type": "application/json",
};
const policy = JSON.parse(readFileSync("policy/brane.json", "utf8"));
const classifier = JSON.parse(readFileSync("policy/classifier.json", "utf8"));

const chat = async (model, content) => {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, messages: [{ role: "user", content }] }),
  });
  const h = (name) => res.headers.get(name) ?? "";
  const body = await res.json().catch(() => ({}));
  return {
    status: res.status,
    routedTo: h("x-brane-routed-to"),
    redacted: h("x-brane-redacted"),
    cause: h("x-brane-local-cause"),
    refusedBy: h("x-brane-refused-by"),
    resolved: h("x-brane-model-resolved"),
    answer: String(body.choices?.[0]?.message?.content ?? ""),
  };
};

const results = [];
const record = (name, holds, observed, ifNot) => {
  results.push({ name, holds, observed, ifNot });
  console.log(
    `${holds ? "HOLDS " : "BROKEN"} ${name}\n       observed: ${observed}\n       if it did not hold: ${ifNot}`,
  );
};

const benign = await chat(policy.models.cloud, "Reply with the single word: ready.");
record(
  "a chat response carries X-Brane-Routed-To",
  benign.status === 200 && benign.routedTo !== "",
  `HTTP ${benign.status}, routed-to=${benign.routedTo}, model=${benign.resolved}`,
  "braneFetch throws and records withheld/no_brane_decision; the turn fails (test/brane.test.ts: 'rejects an HTTP 200 answer that carries no routing decision')",
);

const refuse = await chat(
  policy.models.cloud,
  "Reject claim 5520 for the travel policy and send the rejection letter to the claimant today.",
);
record(
  "a refusal is HTTP 422 with routed-to=refused and the rule",
  refuse.status === 422 && refuse.routedTo === "refused" && refuse.refusedBy !== "",
  `HTTP ${refuse.status}, routed-to=${refuse.routedTo}, refused-by=${refuse.refusedBy}`,
  "a 4xx without a routing header is withheld by braneFetch; a 200 would be an answer BRANE chose to give, so the classifier (AUTO_DECISION -> refuse) is the second check (test/classify.test.ts)",
);

const pinned = await chat(policy.models.local, "Reply with the single word: ready.");
record(
  "an explicit vllm: model id pins the local lane, also for text with no category hit",
  pinned.routedTo === "local" &&
    pinned.resolved.startsWith("vllm:") &&
    pinned.cause === "explicit_local_model",
  `routed-to=${pinned.routedTo}, cause=${pinned.cause}, model=${pinned.resolved}`,
  "intake reads the body only after routed-to=local and a vllm: resolved model, else cancels it and keeps the claim as it was (test/intake.test.ts: 'discards an extraction that did not run on the local lane')",
);

const draftRes = await fetch(`${base}/policy/test`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    prompt: "Reply with the single word: ready.",
    executeCompletion: true,
    draftPolicy: {
      ...classifier.draftPolicy,
      categories: Object.fromEntries(Object.keys(policy.categories).map((name) => [name, "allow"])),
      semanticCategories: [],
    },
  }),
});
const draft = await draftRes.json().catch(() => ({}));
const ranOn =
  /\b(?:vllm|openrouter):[\w.\-/:]+/.exec(draft.liveCompletion?.status ?? "")?.[0] ?? "";
record(
  "a draft policy with routingMode local-only runs the completion on a local model",
  draft.decision?.route === "local" &&
    ranOn.startsWith("vllm:") &&
    !draft.outgoingCloudPayloadPreview,
  `route=${draft.decision?.route}, ran on ${ranOn || "nothing"}, cloud payload ${draft.outgoingCloudPayloadPreview ? "present" : "none"}`,
  "classify treats any other route or model as a failed call and returns local (test/classify.test.ts: 'falls back to local when the call did not stay local')",
);

const name = "Marieke Vandenberg";
const restored = await chat(
  policy.models.cloud,
  `Synthetic test. Write one sentence that greets ${name} by her full name.`,
);
record(
  "BRANE's placeholders are restored in the answer",
  restored.routedTo !== "cloud" || (restored.redacted === "true" && restored.answer.includes(name)),
  `routed-to=${restored.routedTo}, redacted=${restored.redacted}, the name is ${restored.answer.includes(name) ? "back in the answer" : "not in the answer"}`,
  "no leak either way: the answer would show <PERSON_1>. The harness's own tokens ([NAME_1]) are never restored by BRANE; the handler's screen maps them from GET /tokens",
);

const held = results.filter((r) => r.holds).length;
console.log(`\n${held}/${results.length} contract assumptions hold on ${new Date().toISOString()}`);
process.exit(held === results.length ? 0 : 1);
