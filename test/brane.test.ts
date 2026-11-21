import { afterEach, describe, expect, it, vi } from "vitest";
import { braneFetch, type BraneDecision } from "../src/brane.ts";

const env = { BRANE_BASE_URL: "https://brane.test/api/v1", BRANE_API_KEY: "test-brane-key" };
const chat = `${env.BRANE_BASE_URL}/chat/completions`;

/** A gated fetch over a stubbed network, with the decisions it recorded and the URLs the network saw. */
function gated(network: () => Promise<Response>) {
  const decisions: BraneDecision[] = [];
  const stub = vi.spyOn(globalThis, "fetch").mockImplementation(network);
  const origins = () =>
    stub.mock.calls.map(
      ([input]) => new URL(input instanceof Request ? input.url : String(input)).origin,
    );
  return { fetch: braneFetch(env, (d) => decisions.push(d)), decisions, stub, origins };
}

afterEach(() => vi.restoreAllMocks());

describe("check failure: the BRANE fetch fails closed", () => {
  it("withholds the request when BRANE is unreachable", async () => {
    const g = gated(() => Promise.reject(new TypeError("network down")));
    await expect(g.fetch(chat, { method: "POST" })).rejects.toThrow("network down");
    expect(g.decisions).toMatchObject([{ routedTo: "withheld", localCause: "brane_unreachable" }]);
    expect(g.origins()).toEqual(["https://brane.test"]);
  });

  it("withholds the request on HTTP 502 without a routing decision", async () => {
    const g = gated(() => Promise.resolve(new Response("bad gateway", { status: 502 })));
    await expect(g.fetch(chat, { method: "POST" })).rejects.toThrow("no routing decision");
    expect(g.decisions).toMatchObject([
      { status: 502, routedTo: "withheld", localCause: "no_brane_decision" },
    ]);
    expect(g.origins()).toEqual(["https://brane.test"]);
  });

  it("rejects an HTTP 200 answer that carries no routing decision", async () => {
    const g = gated(() => Promise.resolve(Response.json({ choices: [] }, { status: 200 })));
    await expect(g.fetch(chat, { method: "POST" })).rejects.toThrow("no routing decision");
    expect(g.decisions).toMatchObject([
      { status: 200, routedTo: "withheld", localCause: "no_brane_decision" },
    ]);
    expect(g.origins()).toEqual(["https://brane.test"]);
  });

  it("never sends a model request to an origin that is not BRANE", async () => {
    const g = gated(() => Promise.resolve(new Response("ok")));
    await expect(
      g.fetch("https://api.openai.com/v1/chat/completions", { method: "POST" }),
    ).rejects.toThrow("only BRANE is allowed");
    expect(g.stub).not.toHaveBeenCalled();
    expect(g.decisions).toEqual([]);
  });

  it("returns a 422 refusal as refused, with the rule that refused it", async () => {
    const g = gated(() =>
      Promise.resolve(
        Response.json(
          { error: "policy_violation" },
          {
            status: 422,
            headers: {
              "X-Brane-Routed-To": "refused",
              "X-Brane-Refused-By": "semantic:CLAIM_OUTCOME_DECISION->refuse",
            },
          },
        ),
      ),
    );
    const response = await g.fetch(chat, { method: "POST" });
    expect(response.status).toBe(422);
    expect(g.decisions).toMatchObject([
      { status: 422, routedTo: "refused", refusedBy: "semantic:CLAIM_OUTCOME_DECISION->refuse" },
    ]);
  });

  it("passes a routed answer through and records the decision", async () => {
    const g = gated(() =>
      Promise.resolve(
        Response.json({ choices: [] }, { headers: { "X-Brane-Routed-To": "local" } }),
      ),
    );
    expect((await g.fetch(chat, { method: "POST" })).status).toBe(200);
    expect(g.decisions).toMatchObject([{ status: 200, routedTo: "local" }]);
  });
});
