#!/usr/bin/env node
// Cuts the live recording to the voiced demo beats.
//
//   node live.mjs    reads assets/live/live.mp4, assets/live/cuts.json and assets/timing.json, writes
//                    assets/live/walkthrough.mp4: each demo beat's stretches of the recording, one frame held
//                    until the beat is full, so the footage stays in step with the voice
//
// Needs ffmpeg on PATH (render.md, Tools). Run after voiceover.mjs whenever a demo beat's length changes.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const live = join(here, "assets", "live");
const { cuts } = JSON.parse(readFileSync(join(live, "cuts.json"), "utf8"));
const timing = JSON.parse(readFileSync(join(here, "assets", "timing.json"), "utf8"));
const beat = Object.fromEntries(timing.beats.map((b) => [b.id, b]));

const pieces = [];
for (const c of cuts) {
  const b = beat[c.beat];
  if (!b) throw new Error(`timing.json has no beat ${c.beat}`);
  const played = c.pieces.reduce((a, p) => a + (p.to - p.from), 0);
  const hold = Math.max(0, b.duration - played);
  for (const p of c.pieces) pieces.push({ from: p.from, to: p.to, hold: p.hold ? hold : 0 });
}
const parts = pieces.map(
  (p, i) =>
    `[0:v]trim=start=${p.from}:end=${p.to},setpts=PTS-STARTPTS` +
    (p.hold > 0 ? `,tpad=stop_mode=clone:stop_duration=${p.hold.toFixed(3)}` : "") +
    `[p${i}]`,
);
const filter = `${parts.join(";")};${pieces.map((_, i) => `[p${i}]`).join("")}concat=n=${pieces.length}:v=1:a=0,fps=30[v]`;
execFileSync(
  process.env.FFMPEG || "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-i",
    join(live, "live.mp4"),
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-preset",
    "medium",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(live, "walkthrough.mp4"),
  ],
  { stdio: "inherit" },
);
const total = cuts.reduce((a, c) => a + beat[c.beat].duration, 0);
console.log(`walkthrough.mp4 ${total.toFixed(2)} s from ${beat[cuts[0].beat].start.toFixed(2)} s`);
