#!/usr/bin/env node
// Voiceover for the pitch video.
//
//   node voiceover.mjs                 one ElevenLabs request per beat of ../narration.md whose text changed since
//                                      the last run (or has no clip yet), then re-time index.html
//   node voiceover.mjs --only=attack   regenerate this beat even if its text is unchanged
//   node voiceover.mjs --all           regenerate every beat
//   node voiceover.mjs --fixed         no audio: the fixed windows from the narration headings
//   node voiceover.mjs --apply         re-time index.html from the existing assets/timing.json
//
// Reads ELEVENLABS_API_KEY from the environment or from .dev.vars at the repository root, and never prints it.
// Keeps each clip as ElevenLabs returned it in assets/raw/vo-<beat>.mp3 (so a re-time never needs new credits), writes
// assets/vo-<beat>.mp3 sped up by TEMPO with ffmpeg atempo (pitch kept), and assets/timing.json (beat starts, clip durations from ffprobe, word times from
// the with-timestamps alignment), then rewrites the timing block, the audio tags and the clip windows in index.html.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..");
const assets = join(here, "assets");
const timingPath = join(assets, "timing.json");
const htmlPath = join(here, "index.html");

const args = process.argv.slice(2);
function args0(name) {
  return args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

const API = "https://api.elevenlabs.io/v1";
const MODEL = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
const VOICES = [
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel" }, // stock voice, male, steady broadcaster
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian" }, // stock voice, fallback if Daniel fails
];
const TEMPO = Number(args0("tempo") ?? process.env.VO_TEMPO ?? 1.07); // 1 = as generated
const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.75,
  style: 0,
  use_speaker_boost: true,
  speed: 1,
};

// Spacing of the voiced cut, in seconds.
const LEAD = 0.4; // first beat: picture before the first word
const PRE = 0.25; // every later beat: scene enters before its voice
const GAP = 0.3; // after each clip
const TAIL = 3.5; // after the last clip: the closing line and the graphs hold
// Extra silence after a beat's clip, so its picture can finish (the climb graphs draw after the voice ends).
const HOLD = { climb: 4.5 };

const flag = (name) => args.some((a) => a === `--${name}`);
const only = args.find((a) => a.startsWith("--only="))?.slice(7);

/** Beats from ../narration.md: "## Name, A to B seconds (N words)" followed by "> " lines. */
function parseNarration() {
  const md = readFileSync(join(here, "..", "narration.md"), "utf8");
  const beats = [];
  let cur = null;
  for (const line of md.split("\n")) {
    const h = line.match(/^## (.+?), (\d+(?:\.\d+)?) to (\d+(?:\.\d+)?) seconds/);
    if (h) {
      cur = { id: slug(h[1]), title: h[1], from: Number(h[2]), to: Number(h[3]), text: "" };
      beats.push(cur);
      continue;
    }
    if (line.startsWith("## ")) cur = null;
    if (cur && line.startsWith(">")) cur.text = `${cur.text} ${line.replace(/^>\s?/, "")}`.trim();
  }
  if (!beats.length) throw new Error("no beats found in demo/narration.md");
  for (const b of beats) if (!b.text) throw new Error(`beat "${b.title}" has no quoted text`);
  return beats;
}

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function readKey() {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY.trim();
  const vars = join(repo, ".dev.vars");
  if (!existsSync(vars)) return null;
  for (const line of readFileSync(vars, "utf8").split("\n")) {
    const m = line.match(/^\s*ELEVENLABS_API_KEY\s*=\s*(.*)\s*$/);
    if (m) return m[1].replace(/^["']|["']$/g, "").trim() || null;
  }
  return null;
}

function ffprobe() {
  if (process.env.FFPROBE) return process.env.FFPROBE;
  return "ffprobe";
}

function speedUp(raw, out) {
  const ffmpeg = process.env.FFMPEG || "ffmpeg";
  const filter = TEMPO === 1 ? "anull" : `atempo=${TEMPO}`;
  execFileSync(ffmpeg, ["-v", "error", "-y", "-i", raw, "-filter:a", filter, "-b:a", "128k", out]);
}

function duration(file) {
  const out = execFileSync(
    ffprobe(),
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
    { encoding: "utf8" },
  );
  const d = Number(out.trim());
  if (!Number.isFinite(d) || d <= 0) throw new Error(`ffprobe gave no duration for ${file}`);
  return d;
}

/** Word times from ElevenLabs' character alignment: a word runs from its first character's start to its last's end. */
function wordsFromAlignment(al) {
  const words = [];
  let w = null;
  al.characters.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (w) words.push(w);
      w = null;
      return;
    }
    if (!w) w = { w: "", s: al.character_start_times_seconds[i], e: 0 };
    w.w += ch;
    w.e = al.character_end_times_seconds[i];
  });
  if (w) words.push(w);
  return words.map((x) => ({ w: x.w, s: round(x.s), e: round(x.e) }));
}

/** Word times for the silent cut: spread over the beat window by word length, with a pause after each sentence. */
function estimateWords(text, window) {
  const toks = text.split(/\s+/).filter(Boolean);
  const weight = (t) =>
    t.replace(/[^\w]/g, "").length + 2 + (/[.?!]$/.test(t) ? 4 : /[,:;]$/.test(t) ? 2 : 0);
  const total = toks.reduce((a, t) => a + weight(t), 0);
  const start = 0.3;
  const span = Math.max(1, window - 0.8);
  let at = start;
  return toks.map((t) => {
    const len = (weight(t) / total) * span;
    const w = { w: t, s: round(at), e: round(at + len * 0.8) };
    at += len;
    return w;
  });
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

async function tts(key, voice, beat) {
  const res = await fetch(
    `${API}/text-to-speech/${voice.id}/with-timestamps?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": key,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ text: beat.text, model_id: MODEL, voice_settings: VOICE_SETTINGS }),
    },
  );
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    const err = new Error(
      `ElevenLabs ${res.status} for beat "${beat.id}" with ${voice.name}: ${body}`,
    );
    err.status = res.status;
    throw err;
  }
  return res.json();
}

/** Lay the voiced beats end to end. */
function layoutVoiced(beats, clips) {
  let t = 0;
  return beats.map((b, i) => {
    const c = clips[b.id];
    const offset = i === 0 ? LEAD : PRE;
    const last = i === beats.length - 1;
    const dur = round(offset + c.duration + (last ? TAIL : GAP) + (HOLD[b.id] ?? 0));
    const out = {
      id: b.id,
      title: b.title,
      text: b.text,
      start: round(t),
      duration: dur,
      audio: { src: `assets/vo-${b.id}.mp3`, offset, duration: round(c.duration), voice: c.voice },
      words: c.words.map((w) => ({
        w: w.w,
        s: round(w.s / TEMPO + offset),
        e: round(w.e / TEMPO + offset),
      })),
      clipWords: c.words,
    };
    t += dur;
    return out;
  });
}

function layoutFixed(beats) {
  return beats.map((b) => ({
    id: b.id,
    title: b.title,
    text: b.text,
    start: b.from,
    duration: round(b.to - b.from),
    audio: null,
    words: estimateWords(b.text, b.to - b.from),
  }));
}

function writeTiming(source, laid) {
  const total = round(laid.at(-1).start + laid.at(-1).duration);
  const timing = {
    source,
    model: source === "elevenlabs" ? MODEL : null,
    tempo: source === "elevenlabs" ? TEMPO : null,
    total,
    beats: laid,
  };
  writeFileSync(timingPath, `${JSON.stringify(timing, null, 2)}\n`);
  return timing;
}

/** Rewrite index.html: the timing block, the audio tags, every [data-beat] window and the total length. */
function apply(timing) {
  let html = readFileSync(htmlPath, "utf8");
  const slim = {
    source: timing.source,
    total: timing.total,
    beats: timing.beats.map(({ id, start, duration, words }) => ({ id, start, duration, words })),
  };
  html = replaceBetween(html, "/* timing:begin */", "/* timing:end */", JSON.stringify(slim));

  const audio = timing.beats
    .filter((b) => b.audio)
    .map(
      (b) =>
        `      <audio id="vo-${b.id}" src="${b.audio.src}" data-start="${round(b.start + b.audio.offset)}" ` +
        `data-duration="${b.audio.duration}" data-track-index="9" data-volume="1"></audio>`,
    )
    .join("\n");
  html = replaceBetween(
    html,
    "<!-- vo:begin -->",
    "<!-- vo:end -->",
    `\n${audio}${audio ? "\n" : ""}      `,
  );

  for (const b of timing.beats) {
    const re = new RegExp(`(<[^>]*data-beat="${b.id}"[^>]*>)`);
    const m = html.match(re);
    if (!m) throw new Error(`index.html has no element with data-beat="${b.id}"`);
    html = html.replace(m[1], setWindow(m[1], b.start, b.duration));
  }
  html = html.replace(/(<[^>]*data-span="total"[^>]*>)/g, (tag) => setWindow(tag, 0, timing.total));
  html = html.replace(/(<div[^>]*data-composition-id="main"[^>]*>)/, (tag) =>
    setWindow(tag, 0, timing.total),
  );
  writeFileSync(htmlPath, html);
}

function setWindow(tag, start, dur) {
  return tag
    .replace(/data-start="[^"]*"/, `data-start="${round(start)}"`)
    .replace(/data-duration="[^"]*"/, `data-duration="${round(dur)}"`);
}

function replaceBetween(s, a, b, body) {
  const i = s.indexOf(a);
  const j = s.indexOf(b, i + a.length);
  if (i < 0 || j < 0) throw new Error(`index.html is missing the ${a} ... ${b} markers`);
  return s.slice(0, i + a.length) + body + s.slice(j);
}

function summary(timing) {
  for (const b of timing.beats) {
    const a = b.audio ? `voice ${b.audio.duration.toFixed(2)} s` : "silent";
    console.log(
      `${b.id.padEnd(13)} ${b.start.toFixed(2).padStart(6)} s  +${b.duration.toFixed(2)} s  ${a}`,
    );
  }
  console.log(`total ${timing.total.toFixed(2)} s (${timing.source})`);
}

async function main() {
  const beats = parseNarration();

  if (flag("apply")) {
    const timing = JSON.parse(readFileSync(timingPath, "utf8"));
    apply(timing);
    summary(timing);
    return;
  }
  if (flag("fixed")) {
    const timing = writeTiming("fixed", layoutFixed(beats));
    apply(timing);
    summary(timing);
    return;
  }

  const key = readKey();
  if (!key) {
    console.error(
      "ELEVENLABS_API_KEY is not set (environment or .dev.vars at the repository root). No audio generated;\n" +
        "index.html keeps its current timings and still renders. Set the key and run `node voiceover.mjs` again.",
    );
    process.exit(2);
  }

  const previous = existsSync(timingPath) ? JSON.parse(readFileSync(timingPath, "utf8")) : null;
  const clips = {};
  for (const b of beats) {
    const mp3 = join(assets, `vo-${b.id}.mp3`);
    const raw = join(assets, "raw", `vo-${b.id}.mp3`);
    const old =
      previous?.source === "elevenlabs" ? previous.beats.find((x) => x.id === b.id) : null;
    const forced = flag("all") || only === b.id;
    if (!forced && old?.clipWords && old.text === b.text && existsSync(raw)) {
      speedUp(raw, mp3);
      clips[b.id] = { duration: duration(mp3), words: old.clipWords, voice: old.audio.voice };
      console.log(`vo-${b.id}.mp3  ${clips[b.id].duration.toFixed(2)} s  unchanged, kept`);
      continue;
    }
    let res;
    let voice;
    for (const v of process.env.ELEVENLABS_VOICE_ID
      ? [{ id: process.env.ELEVENLABS_VOICE_ID, name: "custom" }]
      : VOICES) {
      try {
        res = await tts(key, v, b);
        voice = v;
        break;
      } catch (e) {
        if (e.status === 401 || e.status === 402 || e.status === 429) throw e;
        console.error(e.message);
      }
    }
    if (!res) throw new Error(`no voice produced beat "${b.id}"`);
    mkdirSync(join(assets, "raw"), { recursive: true });
    writeFileSync(raw, Buffer.from(res.audio_base64, "base64"));
    speedUp(raw, mp3);
    const words = wordsFromAlignment(res.alignment);
    clips[b.id] = { duration: duration(mp3), words, voice: voice.name };
    console.log(
      `vo-${b.id}.mp3  ${clips[b.id].duration.toFixed(2)} s  ${b.text.length} chars  ${voice.name}`,
    );
  }

  const timing = writeTiming("elevenlabs", layoutVoiced(beats, clips));
  apply(timing);
  summary(timing);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
