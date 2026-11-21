import { afterEach, describe, expect, it, vi } from "vitest";
import type { BraneDecision } from "../src/brane.ts";
import { intake } from "../src/primitives/intake.ts";

const env = { BRANE_BASE_URL: "https://brane.test/api/v1", BRANE_API_KEY: "test-brane-key" };
const claim =
  "Synthetic claim CLM-2026-3301, policy POL-6620-11, BSN 123456782: fractured wrist, invoice EUR 1,240.";

const healthLocal = {
  decision: { route: "local" },
  simulatedHeaders: { "X-Brane-Pii-Types": "HEALTH_DATA" },
};
const clean = { decision: { route: "cloud" }, simulatedHeaders: {} };

type Call = { readonly url: string; readonly body: string };

/** BRANE as a stub: dry runs answer from `dryRuns` in order, the extraction answers with `extraction`. */
function brane(dryRuns: object[], extraction: () => Response) {
  const calls: Call[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input);
    calls.push({ url, body: String(init?.body ?? "") });
    return url.endsWith("/policy/test") ? Response.json(dryRuns.shift()) : extraction();
  });
  return calls;
}

const sheet = (headers: Record<string, string>) => () =>
  Response.json(
    { choices: [{ message: { content: "Invoice A: treatment, EUR 1,240" } }] },
    { headers },
  );

afterEach(() => vi.restoreAllMocks());

describe("intake egress", () => {
  it("masks identifiers before BRANE sees the claim, pins the local model and records the call", async () => {
    const decisions: BraneDecision[] = [];
    const calls = brane(
      [healthLocal, clean],
      sheet({ "X-Brane-Routed-To": "local", "X-Brane-Model-Resolved": "vllm:deepseek-v4.1-flash" }),
    );
    const result = await intake(env, claim, "vllm:deepseek-v4.1-flash", (d) => decisions.push(d));
    expect(result.kind).toBe("split");
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(new URL(call.url).origin).toBe("https://brane.test");
      expect(call.body).not.toMatch(/123456782|POL-6620-11|CLM-2026-3301/);
    }
    expect(JSON.parse(calls[1]!.body)).toMatchObject({ model: "vllm:deepseek-v4.1-flash" });
    expect(decisions).toMatchObject([
      { routedTo: "local", modelResolved: "vllm:deepseek-v4.1-flash" },
    ]);
  });

  it("sends nothing when the extraction model is not a local model", async () => {
    const calls = brane([healthLocal], sheet({ "X-Brane-Routed-To": "cloud" }));
    const result = await intake(env, claim, "openrouter:anthropic/claude-haiku-5.5");
    expect(result.kind).toBe("failed");
    expect(calls).toHaveLength(0);
  });

  it("discards an extraction that did not run on the local lane and keeps the claim as it was", async () => {
    const calls = brane(
      [healthLocal],
      sheet({ "X-Brane-Routed-To": "cloud", "X-Brane-Model-Resolved": "openrouter:x/y" }),
    );
    const result = await intake(env, claim);
    expect(result).toMatchObject({ kind: "failed" });
    expect(calls).toHaveLength(2);
  });

  it("fails closed when the extraction answer carries no routing decision", async () => {
    const decisions: BraneDecision[] = [];
    brane([healthLocal], sheet({}));
    const result = await intake(env, claim, undefined, (d) => decisions.push(d));
    expect(result.kind).toBe("failed");
    expect(decisions).toMatchObject([{ routedTo: "withheld", localCause: "no_brane_decision" }]);
  });
});
