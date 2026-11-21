import { defineExtension, GenerationTask, hook, ToolTask } from "@earendil-works/pi-durable";
import { DEFAULT_SWITCHES, TOOL_NAMES, type Switches, type ToolName } from "../switches.ts";
import { findIdentifiers, mask } from "./detect.ts";

/** One event for the decision log, written outside every conversation. */
export type GateEvent =
  | { readonly kind: "masked"; readonly findings: string }
  | {
      readonly kind: "handoff";
      readonly tool: string;
      readonly detail: string;
      /** Where the person's decision is passed back to. */
      readonly conversationId: number;
    }
  | { readonly kind: "lookup"; readonly ids: string }
  /** The passage ids a recommendation's reasons cite, so a check can compare them with what lookup returned. */
  | { readonly kind: "cited"; readonly ids: string }
  | { readonly kind: "intake"; readonly result: string };

/**
 * The gate: our deterministic layer around BRANE, as Pi hooks.
 * - beforeProviderRequest: every request body, the harness's own housekeeping calls included, has BSNs, policy and
 *   claim numbers and passport numbers replaced with tokens before it reaches BRANE (BRANE mislabels these).
 * - afterTool: handoffs (consult, request_approval) and lookups are logged with what they cite.
 * The same two hooks apply the session's switches: the model asked for, and the tools offered and callable.
 */
/** Passage ids in square brackets, e.g. `[POL-3.2]` or `[GDPR-22(1)]`, in order, once each. */
export const citedIds = (text: string): string =>
  [...new Set([...text.matchAll(/\[([A-Z][A-Za-z]*-[\w().-]+)\]/g)].map((m) => m[1]!))].join(",");

export function gateExtension(
  onEvent: (event: GateEvent) => void,
  switches: () => Switches = () => DEFAULT_SWITCHES,
  keptLocal: (conversationId: number) => boolean = () => false,
) {
  const switchedOff = (name: string): boolean =>
    TOOL_NAMES.includes(name as ToolName) && !switches().tools.includes(name as ToolName);
  const maskString = (s: string): string => {
    const findings = findIdentifiers(s);
    if (findings.length === 0) return s;
    onEvent({ kind: "masked", findings: findings.map((f) => f.kind).join(",") });
    return mask(s, findings);
  };
  const maskDeep = (v: unknown): unknown => {
    if (typeof v === "string") return maskString(v);
    if (Array.isArray(v)) return v.map(maskDeep);
    if (v && typeof v === "object")
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, maskDeep(x)]));
    return v;
  };

  return defineExtension({
    name: "gate",
    hooks: [
      hook(GenerationTask, {
        beforeProviderRequest: ({ payload }, api) => {
          const p = payload as {
            messages?: unknown[];
            tools?: { function?: { name?: string } }[];
          };
          if (!Array.isArray(p.messages)) return undefined;
          const tools = p.tools?.filter((tool) => !switchedOff(tool.function?.name ?? ""));
          return {
            payload: {
              ...p,
              // A conversation the classifier kept local asks for the local model by name, which pins BRANE's
              // local lane.
              model: keptLocal(api.conversationId) ? switches().localModel : switches().cloudModel,
              messages: maskDeep(p.messages),
              ...(tools === undefined ? {} : { tools }),
            },
          };
        },
        // A request BRANE refused needs a person. Log it as a handoff, so the person's action closes it.
        afterResponse: (message, api) => {
          if (message.stopReason === "error" && /^422\b/.test(message.errorMessage ?? ""))
            onEvent({
              kind: "handoff",
              tool: "refusal",
              detail: "",
              conversationId: api.conversationId,
            });
        },
      }),
      hook(ToolTask, {
        beforeTool: (call) =>
          switchedOff(call.name)
            ? { block: `${call.name} is switched off for this run` }
            : undefined,
        afterTool: (call, result, api) => {
          const details = (result as { details?: Record<string, unknown> }).details ?? {};
          if (call.name === "consult" || call.name === "request_approval") {
            onEvent({
              kind: "handoff",
              tool: call.name,
              detail: String(details.expert ?? details.recommendation ?? ""),
              conversationId: api.conversationId,
            });
            if (call.name === "request_approval")
              onEvent({ kind: "cited", ids: citedIds(String(call.arguments.reasons ?? "")) });
          } else if (call.name === "web_read") {
            onEvent({ kind: "lookup", ids: `web:${String(details.url ?? "refused")}` });
          } else if (call.name === "lookup") {
            onEvent({ kind: "lookup", ids: ((details.ids as string[]) ?? []).join(",") });
          }
          return undefined;
        },
      }),
    ],
  });
}
