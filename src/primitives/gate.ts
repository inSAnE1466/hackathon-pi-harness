import { defineExtension, GenerationTask, hook, ToolTask } from "@earendil-works/pi-durable";
import { findIdentifiers, mask } from "./detect.ts";

/** One event for the decision log, written outside every conversation. */
export type GateEvent =
  | { readonly kind: "masked"; readonly findings: string }
  | { readonly kind: "handoff"; readonly tool: string; readonly detail: string }
  | { readonly kind: "lookup"; readonly ids: string }
  | { readonly kind: "intake"; readonly result: string };

/**
 * The gate: our deterministic layer around BRANE, as Pi hooks.
 * - beforeProviderRequest: every request body, the harness's own housekeeping calls included, has BSNs, policy and
 *   claim numbers and passport numbers replaced with tokens before it reaches BRANE (BRANE mislabels these).
 * - afterTool: handoffs (consult, request_approval) and lookups are logged with what they cite.
 */
export function gateExtension(onEvent: (event: GateEvent) => void) {
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
        beforeProviderRequest: ({ payload }) => {
          const p = payload as { messages?: unknown[] };
          if (!Array.isArray(p.messages)) return undefined;
          return { payload: { ...p, messages: maskDeep(p.messages) } };
        },
      }),
      hook(ToolTask, {
        afterTool: (call, result) => {
          const details = (result as { details?: Record<string, unknown> }).details ?? {};
          if (call.name === "consult" || call.name === "request_approval") {
            onEvent({
              kind: "handoff",
              tool: call.name,
              detail: String(details.expert ?? details.recommendation ?? ""),
            });
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
