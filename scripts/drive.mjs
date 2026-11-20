#!/usr/bin/env node
// Drive the running app like a user: create a session and a conversation, send one prompt, wait for the
// answer, then print the session's audit log. Works against local dev or the deployed Worker.
// Usage: node scripts/drive.mjs <base-url> "prompt" [--password <pw>]
const [base, prompt] = process.argv.slice(2);
const pwIndex = process.argv.indexOf("--password");
const password = pwIndex > 0 ? process.argv[pwIndex + 1] : undefined;
if (!base || !prompt)
  throw new Error('Usage: node scripts/drive.mjs <base-url> "prompt" [--password <pw>]');

let cookie = "";
if (password) {
  const res = await fetch(`${base}/signin`, {
    method: "POST",
    body: new URLSearchParams({ password }),
    redirect: "manual",
  });
  cookie = (res.headers.get("set-cookie") ?? "").split(";")[0];
  if (!cookie) throw new Error(`Sign-in failed: ${res.status}`);
}
const headers = cookie ? { Cookie: cookie } : {};

const { sessionId } = await (
  await fetch(`${base}/api/sessions`, { method: "POST", headers })
).json();
const wsUrl = `${base.replace(/^http/, "ws")}/api/sessions/${sessionId}?username=Tester&_pk=drive`;
const ws = new WebSocket(wsUrl, { headers });

const send = (command) => ws.send(JSON.stringify(command));
let conversationId;
let answer = "";
const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("No answer within 120 s")), 120_000);
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data));
    if (msg.type === "session.snapshot") send({ type: "conversation.create", requestId: "c1" });
    if (msg.type === "command.result" && msg.command === "conversation.create") {
      conversationId = msg.conversationId;
      send({ type: "prompt.submit", requestId: "p1", conversationId, content: prompt });
    }
    const text = JSON.stringify(msg);
    if (msg.type === "conversation.ops" || msg.type === "conversation.view") {
      for (const m of text.matchAll(/"stopReason":"(stop|error|aborted)"/g)) {
        const err = /"errorMessage":"([^"]*)"/.exec(text);
        const texts = [...text.matchAll(/"type":"text","text":"((?:[^"\\]|\\.)*)"/g)].map((t) =>
          JSON.parse(`"${t[1]}"`),
        );
        answer = texts.at(-1) ?? "";
        clearTimeout(timer);
        resolve({ stop: m[1], error: err?.[1] });
      }
    }
  });
  ws.addEventListener("error", (e) => reject(new Error(`WebSocket error: ${e.message ?? e}`)));
});

const result = await done;
ws.close();
console.log(`stop: ${result.stop}${result.error ? ` (${result.error})` : ""}`);
console.log(`answer: ${answer.slice(0, 400)}`);
const audit = await (await fetch(`${base}/api/sessions/${sessionId}/audit`, { headers })).json();
for (const d of audit.decisions) {
  console.log(
    `audit: ${d.at} HTTP ${d.status} routed=${d.routedTo || "-"} action=${d.action || "-"} redacted=${d.redacted} pii=${d.piiTypes || "-"} semantic=${d.semanticMatches || "-"} refused=${d.refusedBy || "-"} model=${d.modelResolved || "-"}`,
  );
}
