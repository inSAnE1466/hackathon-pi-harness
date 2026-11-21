import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applySwitches, DEFAULT_SWITCHES } from "../src/switches.ts";

const base = "https://example.com/api/sessions";
const put = (sessionId: string, body: unknown): Promise<Response> =>
  exports.default.fetch(`${base}/${sessionId}/switches`, {
    method: "PUT",
    body: JSON.stringify(body),
  });

describe("harness switches", () => {
  it("rejects an unknown key or a bad value and changes nothing", () => {
    expect(applySwitches(DEFAULT_SWITCHES, { intake: "maybe" }).ok).toBe(false);
    expect(applySwitches(DEFAULT_SWITCHES, { bypassBrane: true }).ok).toBe(false);
    expect(applySwitches(DEFAULT_SWITCHES, { cloudModel: "https://example.com" }).ok).toBe(false);
    expect(applySwitches(DEFAULT_SWITCHES, { tools: "lookup,shell" }).ok).toBe(false);
    expect(applySwitches(DEFAULT_SWITCHES, { tools: "consult, lookup" })).toMatchObject({
      ok: true,
      switches: { tools: ["lookup", "consult"] },
    });
  });

  it("sets switches when a session is created and echoes them in the audit log", async () => {
    const created = await exports.default.fetch(base, {
      method: "POST",
      body: JSON.stringify({ switches: { intake: "off", promptVariant: "strict" } }),
    });
    expect(created.status).toBe(201);
    const { sessionId, switches } = (await created.json()) as {
      sessionId: string;
      switches: { intake: string };
    };
    expect(switches).toMatchObject({ intake: "off", promptVariant: "strict" });

    expect((await put(sessionId, { tools: ["lookup"], instructions: "Be brief." })).status).toBe(
      200,
    );
    expect((await put(sessionId, { tools: ["shell"] })).status).toBe(400);

    const audit = (await (await exports.default.fetch(`${base}/${sessionId}/audit`)).json()) as {
      decisions: { kind: string; actor: string; detail: string }[];
      switches: unknown;
      chain: { ok: boolean };
    };
    expect(audit.switches).toMatchObject({ intake: "off", tools: ["lookup"] });
    expect(audit.decisions.filter((row) => row.kind === "config")).toHaveLength(2);
    const latest = JSON.parse(audit.decisions[0]!.detail) as { instructions: string };
    // The audit row names the instructions by hash, not by text.
    expect(latest.instructions).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(audit.chain.ok).toBe(true);
  });

  it("refuses bad switches at creation", async () => {
    const created = await exports.default.fetch(base, {
      method: "POST",
      body: JSON.stringify({ switches: { braneTiming: "never" } }),
    });
    expect(created.status).toBe(400);
  });
});
