import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import {
  createProvider,
  type Model,
  type Provider,
  type ProviderStreams,
} from "@earendil-works/pi-ai";

/** The one route from this harness to any model. BRANE inspects, protects and routes every request. */
export const BRANE_PROVIDER = "brane";

/** Our cloud and local models, from the organizers' list (`GET /api/v1/models`). */
export const BRANE_CLOUD_MODEL = "openrouter:anthropic/claude-haiku-5.5";
export const BRANE_LOCAL_MODEL = "vllm:deepseek-v4.1-flash";

export type BraneEnv = { readonly BRANE_BASE_URL: string; readonly BRANE_API_KEY: string };

/** What BRANE decided for one request, read from its `X-Brane-*` headers. */
export type BraneDecision = {
  readonly status: number;
  readonly routedTo: string;
  readonly action: string;
  readonly redacted: boolean;
  readonly piiTypes: string;
  readonly semanticMatches: string;
  readonly localCause: string;
  readonly refusedBy: string;
  readonly modelResolved: string;
};

export function readDecision(status: number, headers: Record<string, string>): BraneDecision {
  const h = (name: string) => headers[name] ?? headers[name.toLowerCase()] ?? "";
  return {
    status,
    routedTo: h("x-brane-routed-to"),
    action: h("x-brane-action"),
    redacted: h("x-brane-redacted") === "true",
    piiTypes: h("x-brane-pii-types"),
    semanticMatches: h("x-brane-semantic-matches"),
    localCause: h("x-brane-local-cause"),
    refusedBy: h("x-brane-refused-by"),
    modelResolved: h("x-brane-model-resolved"),
  };
}

function model(id: string, name: string, baseUrl: string): Model<"openai-completions"> {
  return {
    id,
    name,
    api: "openai-completions",
    provider: BRANE_PROVIDER,
    baseUrl,
    input: ["text"],
    reasoning: false,
    contextWindow: 128_000,
    maxTokens: 4_096,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
}

/**
 * A fetch that reaches BRANE only, and fails closed: a response without BRANE's routing header never reaches the
 * agent as an answer. A refusal (HTTP 422) surfaces as a failed model call, which the agent reports as needing a
 * human. `onDecision` records each decision outside the conversation.
 */
export function braneFetch(
  env: BraneEnv,
  onDecision: (decision: BraneDecision) => void,
): typeof fetch {
  const base = new URL(env.BRANE_BASE_URL);
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== base.origin)
      throw new Error(`Blocked model request to ${url.origin}: only BRANE is allowed`);
    const response = await fetch(input, init);
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => (headers[key] = value));
    const decision = readDecision(response.status, headers);
    onDecision(decision);
    if (decision.routedTo === "" && response.status !== 422) {
      throw new Error("BRANE returned no routing decision; nothing is sent");
    }
    return response;
  };
}

export function braneProvider(
  env: BraneEnv,
  onDecision: (decision: BraneDecision) => void = () => {},
): Provider<"openai-completions"> {
  const baseUrl = env.BRANE_BASE_URL.replace(/\/+$/, "");
  const inner = openAICompletionsApi();
  const gatedFetch = braneFetch(env, onDecision);
  // Every chat call, the harness's own housekeeping calls included, goes through the gated fetch.
  const api: ProviderStreams = {
    stream: (m, context, options) =>
      inner.stream(m, context, { ...options, fetch: gatedFetch, maxRetries: 0 }),
    streamSimple: (m, context, options) =>
      inner.streamSimple(m, context, { ...options, fetch: gatedFetch, maxRetries: 0 }),
  };
  return createProvider({
    id: BRANE_PROVIDER,
    name: "BRANE",
    baseUrl,
    auth: {
      apiKey: {
        name: "BRANE team key",
        resolve: async () => ({ auth: { apiKey: env.BRANE_API_KEY }, source: "BRANE_API_KEY" }),
      },
    },
    models: [
      model(BRANE_CLOUD_MODEL, "Claude Haiku 5.5 via BRANE", baseUrl),
      model(BRANE_LOCAL_MODEL, "DeepSeek V4.1 Flash, local via BRANE", baseUrl),
    ],
    api,
  });
}
