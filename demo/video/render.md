# Render the video

A HyperFrames 0.9.72 project, 1920x1080 at 30 fps, about 92 seconds. The beats are in
[the video plan](../../docs/demo.md#the-video-92-seconds-pitch-and-backup), the spoken text in
[narration.md](../narration.md), and the styles in `assets/tokens.css`, which the deck shares. Inter is bundled in
`assets/fonts/`. [REVIEW.md](REVIEW.md) records the last frame review.

## Inputs

| File                            | What                                                                                                      | Made by                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------- |
| `assets/vo-<beat>.mp3`          | the voice per beat, sped to 1.07                                                                          | `node voiceover.mjs`       |
| `assets/timing.json`            | each beat's start and every word's time; inlined into `index.html` as `TIMING`                            | `node voiceover.mjs`       |
| `evals/climb-history.json`      | the climb, one row per iteration; inlined as `CLIMB`                                                      | gz-climb; `node climb.mjs` |
| `assets/climb-placeholder.json` | stand-in with the same shape, used only when the real file is missing; shows "placeholder data"           | by hand                    |
| `assets/ui/*.png`               | crops of the real app: the claim, the decision card, the decision in the chat, the audit log, the refusal | headless Playwright runs   |
| `assets/ui/*-audit.json`        | the audit rows of the ski and hidden-note runs that the graph's log rows follow                           | the same runs              |

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

The composition loads GSAP 3.15.0 from jsDelivr, so the render needs network access.

## Voiceover

```sh
cd demo/video
node voiceover.mjs            # generate the beats whose text changed, then re-time index.html
node voiceover.mjs --apply    # re-time index.html from assets/timing.json, no API call
```

`voiceover.mjs` reads `ELEVENLABS_API_KEY` from the environment or from `.dev.vars` at the repository root and never
prints it. It reads the `## Name, A to B seconds` headings and quoted lines of `../narration.md`, one ElevenLabs
request per changed beat (`eleven_multilingual_v2`, voice Daniel), keeps the raw clip in `assets/raw/`, writes the
clip at 1.07 times the speed, and rewrites the timing block, the `<audio>` tags and every `data-beat` window in
`index.html`. The climb beat holds 4.5 s after its voice so the graphs finish (`HOLD` in the script). Every animation
is keyed to a spoken word, so a new voice re-times the whole video.

## Render

```sh
cd demo/video
node climb.mjs                                                 # inline evals/climb-history.json
npx -y hyperframes@0.9.72 check                                # lint, layout, contrast, audio
npx -y hyperframes@0.9.72 render -o out.mp4 --quality standard # about 2 minutes, about 8 MB
```
