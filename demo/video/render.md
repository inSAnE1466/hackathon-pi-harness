# Render the video

A HyperFrames 0.9.72 project, 1920x1080 at 30 fps, about 95 seconds. It is one node graph that grows from the people
around a claim (claimant, AI assistant, medical adviser, claims handler) into the Pi harness in its Durable Object,
then carries one claim through it. The beats follow [the video plan](../../docs/demo.md#the-video-95-seconds-backup-and-opener),
the spoken text and captions follow [narration.md](../narration.md), and the styles are `assets/tokens.css`, which the
deck shares. [REVIEW.md](REVIEW.md) records the last frame review.

## Tools

HyperFrames needs FFmpeg, FFprobe and a Chrome. This machine has no system FFmpeg, so the video renders with static
builds from npm and Playwright's cached headless shell:

```sh
mkdir -p /tmp/ffbin && (cd /tmp/ffbin && npm init -y >/dev/null && npm i ffmpeg-static@5 @ffprobe-installer/ffprobe)
mkdir -p /tmp/ffbin/bin
ln -sf /tmp/ffbin/node_modules/ffmpeg-static/ffmpeg /tmp/ffbin/bin/ffmpeg
ln -sf /tmp/ffbin/node_modules/@ffprobe-installer/darwin-arm64/ffprobe /tmp/ffbin/bin/ffprobe
export PATH=/tmp/ffbin/bin:$PATH
export HYPERFRAMES_BROWSER_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell
```

If `brew install ffmpeg` is available, the two exports are unnecessary. The composition loads GSAP 3.15.0 from
jsDelivr, so the render needs network access.

## Voiceover

```sh
cd demo/video
node voiceover.mjs            # generate the beats whose text changed, then re-time index.html
node voiceover.mjs --apply    # re-time index.html from assets/timing.json, no API call
node voiceover.mjs --fixed    # no audio: the windows from the narration.md headings
```

`voiceover.mjs` reads `ELEVENLABS_API_KEY` from the environment or from `.dev.vars` at the repository root and never
prints it. Without a key it exits with code 2 and leaves `index.html` as it is, so the video still renders. It reads
the quoted lines of `../narration.md`, one ElevenLabs request per beat (`/v1/text-to-speech/{voice}/with-timestamps`,
model `eleven_multilingual_v2`, voice Daniel `onwK4e9ZLuTAKqWW03F9`, Brian as the fallback), and keeps each clip as
returned in `assets/raw/vo-<beat>.mp3`. It writes `assets/vo-<beat>.mp3` at 1.07 times the speed (ffmpeg `atempo`,
pitch kept; `--tempo=1` turns that off), measures each clip with ffprobe, and writes `assets/timing.json` with each
beat's start, its clip and every word's time from the alignment. Then it rewrites the timing block, the `<audio>`
tags and every `data-beat` window in `index.html`. Each animation is keyed to a spoken phrase, so a new voice re-times
the whole video.

A beat whose text is unchanged is not sent again; `--only=<beat>` or `--all` forces it. The free ElevenLabs tier
allows 10,000 characters a month, and the full narration is about 1,200.

## Render

```sh
cd demo/video
npx -y hyperframes@0.9.72 check                                # lint, runtime, layout, contrast
npx -y hyperframes@0.9.72 render -o out.mp4 --quality standard # about 2 minutes
```
