# Render the video

A HyperFrames 0.9.72 project, 1920x1080 at 30 fps, about 3 minutes 20 seconds. The beats and the
spoken text are in [narration.md](../narration.md): situation, harness, loop, evals, the live recording in five beats,
impact, and the close with the address and the team password. The styles are in `assets/tokens.css`. Inter is bundled in
`assets/fonts/`. [REVIEW.md](REVIEW.md) records the last frame review.

## Inputs

| File                          | What                                                                                  | Made by                    |
| ----------------------------- | ------------------------------------------------------------------------------------- | -------------------------- |
| `assets/vo-<beat>.mp3`        | the voice per beat, sped to 1.05                                                      | `node voiceover.mjs`       |
| `assets/timing.json`          | each beat's start and every word's time; inlined into `index.html` as `TIMING`        | `node voiceover.mjs`       |
| `evals/climb-summary.json`    | start and end of each climbed metric; inlined as `CLIMB`; a missing metric is dropped | gz-climb; `node climb.mjs` |
| `assets/live/live.mp4`        | the live recording of the burnout claim on the deployed app (below)                   | `node record-live.mjs`     |
| `assets/live/cuts.json`       | which stretches of `live.mp4` each demo beat plays, and which frame holds             | by hand                    |
| `assets/live/walkthrough.mp4` | `live.mp4` cut to the five voiced demo beats                                          | `node live.mjs`            |
| `assets/team.js`              | the team password for the closing card; gitignored, never committed                   | `node team.mjs`            |

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
request per changed beat (`eleven_multilingual_v2`, voice Brian), keeps the raw clip in `assets/raw/`, writes the
clip at 1.05 times the speed, and rewrites the timing block, the `<audio>` tags and every `data-beat` window in
`index.html`. The evals beat holds 3.5 s after its voice so the slopes finish (`HOLD` in the script). A demo beat lasts
at least as long as its stretch of the recording (`cuts.json`). Every animation is keyed to a spoken word, so a new
voice re-times the whole video; run `node live.mjs` after it so the footage matches the new beat lengths.

## Render

```sh
cd demo/video
node climb.mjs                                                 # inline evals/climb-summary.json
node live.mjs                                                  # cut the recording to the demo beats
node team.mjs                                                  # password for the closing card, from .dev.vars
npx -y hyperframes@0.9.72 check                                # lint, layout, contrast, audio
npx -y hyperframes@0.9.72 render -o out.mp4 --quality standard # about 2 minutes, about 9 MB
```

## The live recording

`record-live.mjs` records one real session on the deployed app with Playwright's headless shell: it signs in off
camera, opens the burnout claim, sends it, answers the medical adviser, approves on the decision card, and ends on the
Audit log tab with "Chain verified". A dot shows the cursor. `--edit` plays only the two waits for the agent at 8x,
tagged "sped up 8x", and writes `assets/live/live.mp4` (51.7 s, 1920x1080) and `assets/live/edit.json` (raw to
edited times). The video plays it through `walkthrough.mp4`, five beats long, with a highlight and a short label on
each part of the screen as the voice names it. Recorded 21 Nov 04:30 CET against https://claims-harness.fred-755.workers.dev; the raw 108 s webm is
kept out of git.

| Edited time (s) | What happens                                                                           |
| --------------- | -------------------------------------------------------------------------------------- |
| 0 to 9          | Queue; click "Therapy for burnout"; the request and two attachments fill the box; Send |
| 9 to 16         | Sped up: intake, BRANE routing, lookups; the trace fills Pre-mask to Person            |
| 16 to 27        | Question for the medical adviser; the answer is typed and sent                         |
| 27 to 28        | Sped up: the agent continues to the recommendation                                     |
| 28 to 40        | Claims handler's decision card; Approve; "Approved" appears in the chat                |
| 40 to 52        | Audit log tab: human row #21, "Chain verified, 23 rows, SHA-256"                       |
