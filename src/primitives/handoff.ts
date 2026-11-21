import { obj, oneOf, str } from "@earendil-works/pi-schema";
import type { ToolRegistration } from "@earendil-works/pi-durable";

/**
 * consult and request_approval are the two routes to a person. The agent never decides a claim and never gives a
 * medical or legal judgement itself; it prepares the case and hands it to a named role. The afterTool hook in gate.ts
 * records each handoff in the decision log, and the review queue shows it, so a person acts on it. The tool's answer
 * to the model is only an acknowledgement; a model never writes the person's decision.
 */
export const consultTool: ToolRegistration = {
  name: "consult",
  description:
    "Ask a human expert when a step needs professional judgement: the medical adviser for medical necessity, causality or a diagnosis; the legal reviewer for disputed policy wording, an exclusion or suspected fraud. Give a short, minimised case summary with no names or identifiers.",
  parameters: obj({
    expert: oneOf(["medical", "legal"] as const, { description: "Which expert" }),
    question: str({ description: "The exact question the expert must answer" }),
    summary: str({
      description: "Minimised case facts the expert needs, with no names or identifiers",
    }),
  }),
  replay: "safe",
  execute: async (args) => {
    const { expert } = args as { expert: "medical" | "legal" };
    const who = expert === "medical" ? "medical adviser" : "legal reviewer";
    return {
      output: [
        {
          type: "text" as const,
          text: `Sent to the ${who}. Continue with the parts of the claim that do not depend on their answer, and tell the user the step is waiting for the ${who}.`,
        },
      ],
      details: { handoff: "consult", expert },
    };
  },
};

export const approveTool: ToolRegistration = {
  name: "request_approval",
  description:
    "Hand a prepared recommendation (pay, reduce, reject, or request documents) to the claims handler, who decides. Use this instead of deciding. Include the reasons and the passage ids that support them.",
  parameters: obj({
    recommendation: oneOf(["pay", "reduce", "reject", "request_documents"] as const, {
      description: "What you recommend",
    }),
    reasons: str({ description: "Reasons, citing policy and law passage ids from lookup" }),
  }),
  replay: "safe",
  execute: async (args) => {
    const { recommendation } = args as { recommendation: string };
    return {
      output: [
        {
          type: "text" as const,
          text: "The recommendation is with the claims handler, who will decide. Do not tell the claimant any outcome.",
        },
      ],
      details: { handoff: "approve", recommendation },
    };
  },
};
