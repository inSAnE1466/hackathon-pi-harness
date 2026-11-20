export { Session } from "./session.ts";

const json = (body: unknown, status: number, headers?: HeadersInit): Response =>
  Response.json(body, { status, headers });

const sessionRoute = /^\/api\/sessions\/([^/]+)\/?$/;
const auditRoute = /^\/api\/sessions\/([^/]+)\/audit\/?$/;
const COOKIE = "team_session";

/** The cookie value: a hash of the password, so the password itself is never stored in the browser. */
async function token(password: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`gezira:${password}`),
  );
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hasCookie(request: Request, value: string): boolean {
  return (request.headers.get("Cookie") ?? "").split(/;\s*/).includes(`${COOKIE}=${value}`);
}

const signInPage = (failed: boolean) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign in</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;font:14px/1.4 Inter,system-ui,sans-serif;color:#171717;background:#fff}
form{display:grid;gap:12px;width:280px}h1{font-size:20px;font-weight:600;margin:0 0 4px}p{margin:0;color:#666}
input{font:inherit;padding:10px 12px;border:1px solid #8f8f8f;border-radius:10px}button{font:inherit;font-weight:500;padding:10px 12px;border:0;border-radius:999px;background:#262626;color:#fff;cursor:pointer}
.err{color:#c62828}</style></head><body><form method="post" action="/signin"><h1>Claims assistant</h1><p>Team access</p>
<input type="password" name="password" placeholder="Password" autofocus required aria-label="Password">
${failed ? '<p class="err" role="alert">Wrong password</p>' : ""}<button type="submit">Sign in</button></form></body></html>`,
    { status: failed ? 401 : 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // With TEAM_PASSWORD set (the deployed Worker), every route needs the team cookie. Local dev leaves it unset.
    if (env.TEAM_PASSWORD) {
      const expected = await token(env.TEAM_PASSWORD);
      if (url.pathname === "/signin" && request.method === "POST") {
        const form = await request.formData();
        if (String(form.get("password") ?? "") !== env.TEAM_PASSWORD) return signInPage(true);
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": `${COOKIE}=${expected}; Path=/; HttpOnly;${url.protocol === "https:" ? " Secure;" : ""} SameSite=Lax; Max-Age=604800`,
          },
        });
      }
      if (!hasCookie(request, expected)) {
        return url.pathname.startsWith("/api/")
          ? json({ error: "Sign in required" }, 401)
          : signInPage(false);
      }
    }

    if (url.pathname === "/api/sessions" || url.pathname === "/api/sessions/") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      const sessionId = crypto.randomUUID();
      return json({ sessionId, url: `/sessions/${sessionId}` }, 201);
    }

    const audit = auditRoute.exec(url.pathname);
    if (audit !== null) {
      if (request.method !== "GET")
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      return env.SESSIONS.getByName(audit[1]).fetch(request);
    }

    const sessionMatch = sessionRoute.exec(url.pathname);
    if (sessionMatch !== null) {
      if (request.method !== "GET") {
        return json({ error: "Method not allowed" }, 405, { Allow: "GET" });
      }
      if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
        return json({ error: "WebSocket upgrade required" }, 426, { Upgrade: "websocket" });
      }
      return env.SESSIONS.getByName(sessionMatch[1]).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) return json({ error: "Not found" }, 404);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
