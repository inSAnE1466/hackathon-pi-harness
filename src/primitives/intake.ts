import { BRANE_LOCAL_MODEL, type BraneEnv } from "../brane.ts";

/**
 * intake: split a claim before the orchestrator sees it.
 *
 * BRANE routes a whole request by its strictest category, so one health detail sends the entire claim to the local
 * model and the frontier model never helps. Intake runs first, on BRANE's local model inside the perimeter: it turns
 * the medical part into a health-free fact sheet (service categories, dates, amounts, whether a referral or report is
 * present, whether the medical adviser is needed). The orchestrator receives the claim with that sheet in place of the
 * medical text, so its turns can go to the frontier model while health detail never leaves.
 *
 * It only runs when BRANE says the claim would go local for health reasons. Everything else passes through unchanged.
 */
export type IntakeResult =
  | { readonly kind: "unchanged" }
  | { readonly kind: "split"; readonly content: string; readonly sheet: string }
  | { readonly kind: "failed"; readonly reason: string };

const EXTRACT = `You prepare an insurance claim for a claims assistant that is not allowed to see medical details.
Rewrite the claim below as a short fact sheet that keeps everything EXCEPT medical details:
- keep claim and policy numbers, names, amounts, dates, places, and what the claimant asks for, exactly as written;
- replace each medical item with a coded invoice line, "Invoice A", "Invoice B" and so on, typed only as "treatment",
  "transport" or "prescription item", keeping its date and amount; non-medical items (luggage, ski pass, cancellation)
  keep their own plain name;
- say whether a referral, prescription or medical report is mentioned;
- end with one line "Medical adviser needed: yes" if necessity or causality of treatment must be judged, else "no".
Never write diagnoses, symptoms, injuries, accidents' physical effects, body parts, medication names, conditions,
therapy types, or the words hospital, clinic, ambulance, doctor, physician, medical, health, patient, or names of care
providers. When unsure whether a word reveals health information, leave it out. Reply with the fact sheet only.

Claim:
`;

async function dryRun(env: BraneEnv, prompt: string) {
  const res = await fetch(`${env.BRANE_BASE_URL.replace(/\/+$/, "")}/policy/test`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.BRANE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, executeCompletion: false }),
  });
  if (!res.ok) throw new Error(`BRANE dry run ${res.status}`);
  return (await res.json()) as {
    decision: { route: string };
    simulatedHeaders?: Record<string, string>;
  };
}

const isHealthLocal = (j: Awaited<ReturnType<typeof dryRun>>) =>
  j.decision.route === "local" &&
  /HEALTH|CLAIM_HEALTH_CONTEXT/.test(
    `${j.simulatedHeaders?.["X-Brane-Pii-Types"] ?? ""} ${j.simulatedHeaders?.["X-Brane-Semantic-Matches"] ?? ""}`,
  );

export async function intake(
  env: BraneEnv,
  claim: string,
  localModel: string = BRANE_LOCAL_MODEL,
): Promise<IntakeResult> {
  try {
    // An unreachable BRANE fails here and the claim is passed on unchanged; the model request that follows is then
    // withheld by the provider, so nothing is sent.
    if (!isHealthLocal(await dryRun(env, claim))) return { kind: "unchanged" };

    const res = await fetch(`${env.BRANE_BASE_URL.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.BRANE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: localModel,
        messages: [{ role: "user", content: EXTRACT + claim }],
      }),
    });
    // The extraction itself carries the health text, so it must stay local; anything else is a failure.
    if (res.headers.get("x-brane-routed-to") !== "local") {
      return {
        kind: "failed",
        reason: `extraction routed ${res.headers.get("x-brane-routed-to") || "nowhere"}`,
      };
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const sheet = body.choices?.[0]?.message?.content?.trim() ?? "";
    if (!sheet) return { kind: "failed", reason: "empty fact sheet" };

    // Accept the sheet only if BRANE now finds no health data in it; otherwise keep the claim local as it was.
    if (isHealthLocal(await dryRun(env, sheet)))
      return { kind: "failed", reason: "fact sheet still holds health data" };
    return {
      kind: "split",
      sheet,
      content: `Claim fact sheet. The medical details were reduced inside the perimeter by the local model; they are not available to you. Ask the medical adviser (consult) for any medical judgement.\n\n${sheet}`,
    };
  } catch (error) {
    return { kind: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
