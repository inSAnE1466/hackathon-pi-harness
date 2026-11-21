#!/usr/bin/env node
// Records one real session on the deployed app for the pitch video, then speeds up only the waits.
//
//   node record-live.mjs [baseUrl]      record: writes assets/live/raw.webm (18 MB, not committed) and spans.json
//   node record-live.mjs --edit         edit:   writes assets/live/live.mp4 and edit.json from raw.webm and spans.json
//
// Playwright 1.65 looks for its ffmpeg in ~/Library/Caches/ms-playwright/ffmpeg-1013/ffmpeg-mac; the build it ships
// rejects one of its own flags on this Mac, so that path holds a copy of the static ffmpeg from render.md instead.
//
// Sign-in happens off camera: one context signs in and saves its storageState, a second context loads it and
// records, so the password never appears on screen. Headless video has no cursor, so the page gets a dot that
// follows the mouse and pulses on a click. Every wait for the agent is logged as a span; the edit plays those spans at
// SPEED times and tags them "sped up", and plays everything else at real speed. No step is cut.
// Uses playwright-core with Playwright's headless shell, never a desktop browser. TEAM_PASSWORD is read from
// .dev.vars at the repository root and never printed.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const out = join(here, "assets", "live");
const SPEED = 8;
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const SHELL = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

if (process.argv.includes("--edit")) edit();
else
  await record(
    process.argv.slice(2).find((a) => !a.startsWith("--")) ??
      "https://claims-harness.fred-755.workers.dev",
  );

async function record(base) {
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE || "playwright-core");
  const vars = readFileSync(join(repo, ".dev.vars"), "utf8");
  const password = /^TEAM_PASSWORD=(.*)$/m.exec(vars)?.[1]?.trim().replace(/^"|"$/g, "") ?? "";
  mkdirSync(out, { recursive: true });
  const tmp = join(out, "tmp");
  rmSync(tmp, { recursive: true, force: true });
  const browser = await chromium.launch({ executablePath: SHELL });
  const size = { width: 1920, height: 1080 };

  // Off camera: sign in and keep the session cookie.
  const signin = await browser.newContext({ viewport: size });
  const p0 = await signin.newPage();
  await p0.goto(base);
  if (await p0.locator('input[name="password"], input[type="password"]').count()) {
    await p0.fill('input[name="password"], input[type="password"]', password);
    await Promise.all([p0.waitForNavigation(), p0.click('button[type="submit"]')]);
  }
  const state = await signin.storageState();
  await signin.close();

  const ctx = await browser.newContext({
    viewport: size,
    storageState: state,
    recordVideo: { dir: tmp, size },
  });
  await ctx.addInitScript(() => {
    const css = `#rec-cursor{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;
      background:rgba(17,17,17,.85);box-shadow:0 0 0 3px #fff;z-index:2147483647;pointer-events:none;transition:transform .12s}
      #rec-cursor.down{transform:scale(.7)}#rec-cursor::after{content:"";position:absolute;inset:-14px;border-radius:50%;
      border:3px solid #ffe14a;opacity:0}#rec-cursor.pulse::after{animation:rp .5s ease-out}
      @keyframes rp{from{opacity:1;transform:scale(.4)}to{opacity:0;transform:scale(1.4)}}`;
    const put = () => {
      if (document.getElementById("rec-cursor")) return;
      const s = document.createElement("style");
      s.textContent = css;
      document.head.appendChild(s);
      const d = document.createElement("div");
      d.id = "rec-cursor";
      d.style.left = "960px";
      d.style.top = "540px";
      document.body.appendChild(d);
      const at = (x, y) => {
        d.style.left = `${x}px`;
        d.style.top = `${y}px`;
      };
      addEventListener("mousemove", (e) => at(e.clientX, e.clientY), true);
      addEventListener(
        "mousedown",
        () => {
          d.classList.add("down");
          d.classList.remove("pulse");
          void d.offsetWidth;
          d.classList.add("pulse");
        },
        true,
      );
      addEventListener("mouseup", () => d.classList.remove("down"), true);
    };
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", put);
    else put();
  });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const spans = [];
  const steps = [];
  const log = (m) => {
    steps.push({ t: +now().toFixed(2), m });
    console.log(now().toFixed(1).padStart(6), m);
  };
  let mouse = { x: 960, y: 540 };
  const moveTo = async (x, y) => {
    const n = Math.max(12, Math.round(Math.hypot(x - mouse.x, y - mouse.y) / 18));
    await page.mouse.move(x, y, { steps: n });
    mouse = { x, y };
  };
  const click = async (loc, what) => {
    await loc.scrollIntoViewIfNeeded();
    const b = await loc.boundingBox();
    await moveTo(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(900);
    await page.mouse.down();
    await page.waitForTimeout(90);
    await page.mouse.up();
    log(`click ${what}`);
    await page.waitForTimeout(500);
  };
  const wait = async (what, fn) => {
    const s = now();
    await fn();
    const e = now();
    if (e - s > 3) spans.push({ s: +s.toFixed(2), e: +e.toFixed(2), what });
    log(`waited ${(e - s).toFixed(1)} s: ${what}`);
  };
  const smooth = async (sel, dy, ms = 1600) => {
    await page.evaluate(
      ([sel, dy, ms]) =>
        new Promise((r) => {
          const el = sel ? document.querySelector(sel) : document.scrollingElement;
          const from = el.scrollTop;
          const t0 = performance.now();
          const f = (t) => {
            const k = Math.min(1, (t - t0) / ms);
            el.scrollTop = from + dy * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
            k < 1 ? requestAnimationFrame(f) : r();
          };
          requestAnimationFrame(f);
        }),
      [sel, dy, ms],
    );
  };

  try {
    await page.goto(`${base}/?claim=own-risk`);
    await page.waitForSelector(".queue-row");
    await page.waitForTimeout(1500);
    log("queue");
    await click(page.locator('.queue-row[href="/?claim=burnout"]'), "burnout claim");
    await page.waitForFunction(() => document.querySelector("#prompt")?.value.length > 0);
    await page.waitForSelector(".connection-status .state--passed", { timeout: 30000 });
    await page.waitForTimeout(1500);
    await click(page.locator(".button-send"), "Send");

    let approved = false;
    for (let round = 0; round < 4 && !approved; round += 1) {
      const card = page
        .locator(
          ".decision-card:has(.decision-card-actions button, .decision-card-edit textarea:not([disabled]))",
        )
        .first();
      await wait(round === 0 ? "the agent works the claim" : "the agent continues", () =>
        card.waitFor({ timeout: 300000 }),
      );
      await card.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1800);
      const heading = await card.locator("h3").innerText();
      log(`card: ${heading}`);
      if (heading.startsWith("Question")) {
        const ta = card.locator("textarea");
        await click(ta, "answer box");
        await ta.pressSequentially(
          "The therapy is medically necessary for the diagnosis in the GP letter.",
          { delay: 28 },
        );
        await page.waitForTimeout(700);
        await click(card.locator('button[type="submit"]'), "send answer");
        await page.locator(".transcript-message--human").nth(round).waitFor({ timeout: 60000 });
        await page.waitForTimeout(1200);
      } else {
        await page.waitForTimeout(1500);
        await click(card.getByRole("button", { name: "Approve" }), "Approve");
        approved = true;
      }
    }
    await wait("the decision returns to the chat", () =>
      page.waitForFunction(
        () =>
          [...document.querySelectorAll(".transcript-message--human")].some((m) =>
            m.textContent.includes("Approved"),
          ),
        null,
        { timeout: 60000 },
      ),
    );
    const human = page.locator(".transcript-message--human").last();
    await human.scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    log("decision in chat");
    await page
      .waitForSelector(".trace-step--person:not(.trace-step--idle)", { timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(1500);
    await click(page.locator("#tab-audit"), "Audit log tab");
    await page.waitForSelector(".audit-row--human");
    await page.waitForSelector(".audit-chain");
    await page.waitForTimeout(2000);
    const host = await page.evaluate(() => {
      let el = document.querySelector(".audit-row--human");
      while (el && el !== document.body) {
        const s = getComputedStyle(el);
        if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight) {
          el.id ||= "rec-audit-scroll";
          return `#${el.id}`;
        }
        el = el.parentElement;
      }
      return null;
    });
    await moveTo(1500, 600);
    await smooth(host, 700, 2400);
    await page.waitForTimeout(1200);
    await smooth(host, -700, 2000);
    await page.locator(".audit-chain").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    log("audit log, chain verified");
  } catch (e) {
    log(`FAIL ${e.message}`);
    process.exitCode = 1;
  } finally {
    const video = page.video();
    await ctx.close();
    await browser.close();
    const src = await video.path();
    renameSync(src, join(out, "raw.webm"));
    rmSync(tmp, { recursive: true, force: true });
    writeFileSync(
      join(out, "spans.json"),
      `${JSON.stringify({ base, speed: SPEED, spans, steps }, null, 2)}\n`,
    );
    console.log(`raw.webm, ${spans.length} wait spans`);
  }
}

/** Plays the wait spans at SPEED times with a "sped up" tag, the rest at real speed, and writes live.mp4 and edit.json. */
function edit() {
  const { spans, speed } = JSON.parse(readFileSync(join(out, "spans.json"), "utf8"));
  const raw = join(out, "raw.webm");
  const dur = Number(
    execFileSync(
      process.env.FFPROBE || "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", raw],
      { encoding: "utf8" },
    ).trim(),
  );
  // Segments over the whole clip: real speed between spans, SPEED inside them. Waits keep 0.6 s at each end real.
  const segs = [];
  let t = 0;
  for (const sp of spans) {
    const s = sp.s + 0.6,
      e = sp.e - 0.6;
    if (e - s < 2) continue;
    if (s > t) segs.push({ s: t, e: s, k: 1 });
    segs.push({ s, e, k: speed, what: sp.what });
    t = e;
  }
  if (t < dur) segs.push({ s: t, e: dur, k: 1 });
  const font = join(here, "assets", "fonts", "Inter-600-normal.ttf");
  const parts = segs.map((g, i) => {
    let f = `[0:v]trim=start=${g.s}:end=${g.e},setpts=(PTS-STARTPTS)/${g.k}`;
    if (g.k !== 1)
      f += `,drawbox=x=iw-300:y=36:w=264:h=58:color=0xffe14a@1:t=fill,drawtext=fontfile='${font}':text='sped up ${g.k}x':x=w-282:y=52:fontsize=28:fontcolor=0x111111`;
    return `${f}[v${i}]`;
  });
  const graph = `${parts.join(";")};${segs.map((_, i) => `[v${i}]`).join("")}concat=n=${segs.length}:v=1:a=0,fps=30[out]`;
  execFileSync(FFMPEG, [
    "-v",
    "error",
    "-y",
    "-i",
    raw,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "22",
    "-preset",
    "medium",
    join(out, "live.mp4"),
  ]);
  // Map raw times to edited times, so the composition can key overlays to steps.
  let at = 0;
  const map = segs.map((g) => {
    const m = {
      raw: [g.s, g.e],
      edit: [+at.toFixed(2), +(at + (g.e - g.s) / g.k).toFixed(2)],
      speed: g.k,
    };
    at += (g.e - g.s) / g.k;
    return m;
  });
  writeFileSync(
    join(out, "edit.json"),
    `${JSON.stringify({ duration: +at.toFixed(2), segments: map }, null, 2)}\n`,
  );
  console.log(
    `live.mp4 ${at.toFixed(1)} s from ${dur.toFixed(1)} s raw, ${segs.filter((g) => g.k !== 1).length} sped-up spans`,
  );
}
