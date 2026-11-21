// Drive one claim through the running harness like a user, for the end-to-end evals: sign in, create a session with
// the given harness switches, send the prompt, and, when the agent hands off, answer as the named reviewer through
// POST /audit/human so the decision returns to the conversation. Returns the audit rows, the tool calls the agent
// made (with their arguments) and timings. Used by evals/agent-climb.mjs.
import { existsSync, readFileSync } from "node:fs";

export function teamPassword() {
  if (process.env.TEAM_PASSWORD) return process.env.TEAM_PASSWORD;
  if (!existsSync(".dev.vars")) return undefined;
  return /^TEAM_PASSWORD=(.*)$/m.exec(readFileSync(".dev.vars", "utf8"))?.[1];
}

export async function signIn(base, password) {
  if (!password) return {};
  const res = await fetch(`${base}/signin`, {
    method: "POST",
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  const cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`Sign-in failed: ${res.status}`);
  return { Cookie: cookie };
}

/** Every tool call in a frame: [{name, arguments}]. Frames nest messages at several depths, so walk the whole value. */
function toolCalls(value, out = []) {
  if (Array.isArray(value)) for (const v of value) toolCalls(v, out);
  else if (value && typeof value === "object") {
    if (value.type === "toolCall" && typeof value.name === "string")
      out.push({ id: value.id, name: value.name, arguments: value.arguments ?? {} });
    for (const v of Object.values(value)) toolCalls(v, out);
  }
  return out;
}
function lastText(value, out = { text: "" }) {
  if (Array.isArray(value)) for (const v of value) lastText(v, out);
  else if (value && typeof value === "object") {
    if (value.role === "assistant" && Array.isArray(value.content)) {
      const text = value.content
        .filter((p) => p.type === "text")
        .map((p) => p.text)
        .join("\n");
      if (text) out.text = text;
    }
    for (const v of Object.values(value)) lastText(v, out);
  }
  return out.text;
}

/**
 * @param {{base: string, headers: object, prompt: string, switches?: object, answer?: (handoff) => {decision, note} | null,
 *          reviewer?: string, turnMs?: number}} run
 */
export async function runClaim({
  base,
  headers,
  prompt,
  switches,
  answer,
  reviewer = "Eval handler",
  turnMs = 150_000,
}) {
  const created = await fetch(`${base}/api/sessions`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(switches ? { switches } : {}),
  });
  if (!created.ok) throw new Error(`create session ${created.status}: ${await created.text()}`);
  const { sessionId } = await created.json();
  const ws = new WebSocket(
    `${base.replace(/^http/, "ws")}/api/sessions/${sessionId}?username=Eval&_pk=eval`,
    { headers },
  );
  const calls = new Map();
  let answerText = "";
  let firstAnswer;
  let conversationId;
  let submitted = false;
  let stops = 0;
  let waiting;
  let error;
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.type === "session.snapshot" && !submitted) {
      submitted = true;
      ws.send(JSON.stringify({ type: "conversation.create", requestId: "c1" }));
    }
    if (msg.type === "command.result" && msg.command === "conversation.create" && !conversationId) {
      conversationId = msg.conversationId;
      ws.send(
        JSON.stringify({ type: "prompt.submit", requestId: "p1", conversationId, content: prompt }),
      );
    }
    if (msg.type === "conversation.ops" || msg.type === "conversation.view") {
      for (const c of toolCalls(msg))
        calls.set(c.id ?? `${c.name}:${JSON.stringify(c.arguments)}`, c);
      const text = lastText(msg);
      if (text) answerText = text;
      const raw = String(event.data);
      const found = [...raw.matchAll(/"stopReason":"(stop|error|aborted)"/g)].length;
      // A view frame resends history, so it sets the count; an ops frame adds to it.
      const total = msg.type === "conversation.view" ? Math.max(stops, found) : stops + found;
      if (total > stops) {
        stops = total;
        error = /"errorMessage":"([^"]*)"/.exec(raw)?.[1] ?? error;
        if (firstAnswer === undefined) firstAnswer = answerText;
        waiting?.();
      }
    }
  });
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve);
    ws.addEventListener("error", (e) => reject(new Error(`WebSocket error: ${e.message ?? e}`)));
  });
  await opened;
  // A turn is over when a stop arrives and no further one follows within the quiet time.
  const turn = (ms) =>
    new Promise((resolve) => {
      const seen = stops;
      const timer = setTimeout(() => resolve(stops > seen), ms);
      waiting = () => {
        clearTimeout(timer);
        resolve(true);
      };
    });
  const audit = async () =>
    (await fetch(`${base}/api/sessions/${sessionId}/audit`, { headers })).json();

  const started = Date.now();
  const finished = await turn(turnMs);
  const firstTurnMs = Date.now() - started;
  let log = await audit();
  const posted = [];
  if (finished && answer) {
    // Two rounds: an expert's answer can lead to the recommendation, which the handler then decides.
    for (let round = 0; round < 3; round++) {
      const open = log.decisions.filter(
        (r) =>
          r.kind === "handoff" &&
          !log.decisions.some((h) => h.kind === "human" && h.refId === r.id),
      );
      if (!open.length) break;
      for (const handoff of open.sort((a, b) => a.id - b.id)) {
        const reply = answer(handoff);
        if (!reply) continue;
        const res = await fetch(`${base}/api/sessions/${sessionId}/audit/human`, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ handoffId: handoff.id, reviewer, ...reply }),
          signal: AbortSignal.timeout(turnMs),
        });
        posted.push({ handoffId: handoff.id, status: res.status });
        if (res.status === 201) await turn(turnMs);
      }
      log = await audit();
    }
  }
  ws.close();
  return {
    sessionId,
    finished,
    error,
    answer: firstAnswer ?? answerText,
    finalAnswer: answerText,
    calls: [...calls.values()],
    rows: [...log.decisions].sort((a, b) => a.id - b.id),
    chain: log.chain,
    switches: log.switches,
    posted,
    firstTurnMs,
    totalMs: Date.now() - started,
  };
}
