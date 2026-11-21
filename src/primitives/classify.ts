import policy from "../../policy/brane.json";
import spec from "../../policy/classifier.json";
import { isLocalModel, type BraneEnv } from "../brane.ts";
import {
  classifierPrompt,
  findIdentifiers,
  mask,
  readVerdict,
  type ClassifierSpec,
  type Outcome,
} from "./detect.ts";

/**
 * classify: the second classifier, run on a person's text before the agent's turn. One call to BRANE's local model
 * with the labels in `policy/classifier.json`; the stricter of its route and BRANE's own wins. It can only make a
 * route stricter: `local` keeps the conversation on the local model, `refuse` withholds the text.
 *
 * Egress rules:
 * - The text is pre-masked (BSN, policy and claim numbers, passport, plate) before it is sent.
 * - The call goes to BRANE's origin only: `POST /policy/test` with a local-only draft policy and
 *   `executeCompletion`. The chat endpoint cannot carry it: under the live policy BRANE refuses the classifier's own
 *   prompt, because the label definitions name the things the policy forbids.
 * - `/policy/test` returns no `X-Brane-*` headers, so the check reads its body: the decision must say `local` and the
 *   completion must have run on a local model. Anything else, an error or an unreadable reply yields `local`.
 */
export type Classification = {
  readonly labels: readonly string[];
  /** The route the classifier asks for: `allow`, `local` or `refuse`. */
  readonly route: Exclude<Outcome, "protect">;
  /** Where BRANE ran the classifier call; empty when it failed before an answer. */
  readonly ranOn: string;
  /** Why the classifier fell back to `local`, when it did. */
  readonly failure: string;
  readonly version: string;
};

const SPEC = spec as ClassifierSpec & { readonly draftPolicy: Readonly<Record<string, unknown>> };

/** Local-only, every category allowed and no semantic category, so BRANE runs the prompt and nothing leaves. */
const DRAFT_POLICY = {
  ...SPEC.draftPolicy,
  categories: Object.fromEntries(Object.keys(policy.categories).map((name) => [name, "allow"])),
  semanticCategories: [],
};

const failed = (failure: string, ranOn = ""): Classification => ({
  labels: [],
  route: "local",
  ranOn,
  failure,
  version: SPEC.version,
});

export async function classify(env: BraneEnv, rawText: string): Promise<Classification> {
  const text = mask(rawText, findIdentifiers(rawText));
  try {
    const res = await fetch(`${env.BRANE_BASE_URL.replace(/\/+$/, "")}/policy/test`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.BRANE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: classifierPrompt(SPEC, text),
        executeCompletion: true,
        draftPolicy: DRAFT_POLICY,
      }),
    });
    if (!res.ok) return failed(`BRANE ${res.status}`);
    const body = (await res.json()) as {
      decision?: { route?: string };
      liveCompletion?: { status?: string; preview?: string } | null;
    };
    const ranOn =
      /\b(?:vllm|openrouter):[\w.\-/:]+/.exec(body.liveCompletion?.status ?? "")?.[0] ?? "";
    if (body.decision?.route !== "local" || !isLocalModel(ranOn))
      return failed(`classifier call routed ${body.decision?.route ?? "nowhere"}`, ranOn);
    const verdict = readVerdict(SPEC, body.liveCompletion?.preview);
    if (verdict.labels.length === 0 && verdict.route === "local")
      return failed("unreadable reply", ranOn);
    return {
      labels: verdict.labels,
      // The harness cannot redact by itself, so a route that only asks for protection is kept local.
      route: verdict.route === "protect" ? "local" : verdict.route,
      ranOn,
      failure: "",
      version: SPEC.version,
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}
