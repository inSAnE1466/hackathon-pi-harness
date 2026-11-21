import { afterEach, describe, expect, it, vi } from "vitest";
import spec from "../policy/classifier.json";
import { classify } from "../src/primitives/classify.ts";

const env = { BRANE_BASE_URL: "https://brane.test/api/v1", BRANE_API_KEY: "test-brane-key" };
const reply = (set: readonly string[]): string =>
  JSON.stringify(
    Object.fromEntries(Object.keys(spec.labels).map((l) => [l, set.includes(l) ? 1 : 0])),
  );
const local = (preview: string) => ({
  decision: { route: "local" },
  liveCompletion: { status: "HTTP 200 (local · vllm:deepseek-v4.1-flash)", preview },
});

function brane(answer: () => Response | Promise<Response>) {
  const calls: { url: string; body: string }[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body ?? "") });
    return answer();
  });
  return calls;
}

afterEach(() => vi.restoreAllMocks());

describe("second classifier", () => {
  it("asks BRANE only, with a local-only draft policy and the text pre-masked", async () => {
    const calls = brane(() => Response.json(local(reply([]))));
    const verdict = await classify(
      env,
      "Claim CLM-2026-3301, BSN 123456782: what is the own risk?",
    );
    expect(verdict).toMatchObject({ route: "allow", labels: [], failure: "" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://brane.test/api/v1/policy/test");
    expect(calls[0]!.body).not.toMatch(/123456782|CLM-2026-3301/);
    const body = JSON.parse(calls[0]!.body) as {
      executeCompletion: boolean;
      draftPolicy: { routingMode: string; semanticCategories: unknown[] };
    };
    expect(body.executeCompletion).toBe(true);
    expect(body.draftPolicy).toMatchObject({ routingMode: "local-only", semanticCategories: [] });
  });

  it("returns the stricter route of the labels it finds", async () => {
    brane(() => Response.json(local(reply(["PERSON", "HEALTH"]))));
    expect(await classify(env, "x")).toMatchObject({
      route: "local",
      labels: ["PERSON", "HEALTH"],
    });
    vi.restoreAllMocks();
    brane(() => Response.json(local(reply(["AUTO_DECISION"]))));
    expect(await classify(env, "x")).toMatchObject({ route: "refuse" });
  });

  it("falls back to local when the call did not stay local, fails, or cannot be read", async () => {
    brane(() =>
      Response.json({
        decision: { route: "cloud" },
        liveCompletion: { status: "HTTP 200 (cloud · openrouter:x/y)", preview: reply([]) },
      }),
    );
    expect(await classify(env, "x")).toMatchObject({ route: "local", labels: [] });
    vi.restoreAllMocks();
    brane(() => new Response("down", { status: 502 }));
    expect(await classify(env, "x")).toMatchObject({ route: "local", failure: "BRANE 502" });
    vi.restoreAllMocks();
    brane(() => Promise.reject(new TypeError("network down")));
    expect(await classify(env, "x")).toMatchObject({ route: "local", failure: "network down" });
    vi.restoreAllMocks();
    brane(() => Response.json(local("I cannot answer that.")));
    expect(await classify(env, "x")).toMatchObject({ route: "local", failure: "unreadable reply" });
  });
});
