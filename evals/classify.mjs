// The second classifier as the app runs it, for the scripts that grade BRANE dry runs (scripts/brane-cases.mjs,
// evals/compare.mjs). Same semantics as src/primitives/classify.ts: the pre-masked text goes to BRANE's local model
// through POST /policy/test with a local-only draft policy (every category allowed, no semantic category), so
// nothing leaves. The call must itself have stayed local on a vllm: model; if not, or on an error or an unreadable
// reply, the verdict is `local`. A verdict that only asks for protection is kept local too, because the harness
// cannot redact by itself. The spec is policy/classifier.json, the one the app ships.
import { readFileSync } from "node:fs";
import { classifierPrompt, readVerdict } from "../src/primitives/detect.ts";

export const spec = JSON.parse(readFileSync("policy/classifier.json", "utf8"));
const policy = JSON.parse(readFileSync("policy/brane.json", "utf8"));
const draftPolicy = {
  ...spec.draftPolicy,
  categories: Object.fromEntries(Object.keys(policy.categories).map((name) => [name, "allow"])),
  semanticCategories: [],
};

/** `sent` is the pre-masked text. Returns { labels, route: "allow" | "local" | "refuse", ranOn, failure }. */
export async function classify(base, key, sent) {
  const failed = (failure, ranOn = "") => ({ labels: [], route: "local", ranOn, failure });
  try {
    const res = await fetch(`${base}/policy/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: classifierPrompt(spec, sent),
        executeCompletion: true,
        draftPolicy,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return failed(`BRANE ${res.status}`);
    const body = await res.json();
    const ranOn =
      /\b(?:vllm|openrouter):[\w.\-/:]+/.exec(body.liveCompletion?.status ?? "")?.[0] ?? "";
    if (body.decision?.route !== "local" || !ranOn.startsWith("vllm:"))
      return failed(`classifier call routed ${body.decision?.route ?? "nowhere"}`, ranOn);
    const verdict = readVerdict(spec, body.liveCompletion?.preview);
    if (verdict.labels.length === 0 && verdict.route === "local")
      return failed("unreadable reply", ranOn);
    return {
      labels: verdict.labels,
      route: verdict.route === "protect" ? "local" : verdict.route,
      ranOn,
      failure: "",
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

// BRANE's route and the classifier's, the stricter one: refused over local over cloud.
const STRICT = { cloud: 0, local: 1, refused: 2 };
export const stricterRoute = (braneRoute, verdict) => {
  const asked = { allow: "cloud", local: "local", refuse: "refused" }[verdict.route];
  return (STRICT[asked] ?? 1) > (STRICT[braneRoute] ?? 0) ? asked : braneRoute;
};
