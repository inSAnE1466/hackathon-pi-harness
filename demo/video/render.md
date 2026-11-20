# Render the video

A HyperFrames 0.9.72 project (`npx hyperframes init video --example blank`), 90 seconds at 1920x1080 and 30 fps. The
beats follow [the video plan](../../docs/demo.md#the-video-90-seconds-backup-and-opener), the spoken text and captions
follow [narration.md](../narration.md), and the styles are `assets/tokens.css`, which the deck shares.

## Render

HyperFrames needs FFmpeg, FFprobe and a Chrome. This machine has no system FFmpeg, so `out.mp4` was rendered with
static builds from npm and with Playwright's cached headless shell:

```sh
mkdir -p /tmp/ffbin && (cd /tmp/ffbin && npm init -y >/dev/null && npm i ffmpeg-static@5 @ffprobe-installer/ffprobe)
mkdir -p /tmp/ffbin/bin
ln -sf /tmp/ffbin/node_modules/ffmpeg-static/ffmpeg /tmp/ffbin/bin/ffmpeg
ln -sf /tmp/ffbin/node_modules/@ffprobe-installer/darwin-arm64/ffprobe /tmp/ffbin/bin/ffprobe
export PATH=/tmp/ffbin/bin:$PATH
export HYPERFRAMES_BROWSER_PATH=~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell
cd demo/video
npx -y hyperframes@0.9.72 check                                # lint, runtime, layout, contrast
npx -y hyperframes@0.9.72 render -o out.mp4 --quality standard # about 1 minute
```

If `brew install ffmpeg` is available, the two exports above are unnecessary. The composition loads GSAP 3.15.0 from
jsDelivr, so the render needs network access.

## Narration

`assets/narration-placeholder.m4a` is 90 seconds of silence. Once the ElevenLabs key arrives, generate the voiceover
from the quoted text in `../narration.md`, save it over that file (or change the `<audio>` `src` in `index.html`),
check that each beat lands inside its time window, and render again. The captions already match the script.
