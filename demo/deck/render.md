# Render the deck

`index.html` holds 12 slides, each a 1920x1080 section. Open it in any browser to present: the sections stack
vertically. To render `deck.pdf` without opening an app, use the headless shell that Playwright caches:

```sh
CH=~/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell
"$CH" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD/demo/deck/deck.pdf" "file://$PWD/demo/deck/index.html"
```

If that cache is missing, run `npx playwright install chromium-headless-shell` first. The PDF has 12 pages, 1920x1080 px each,
with Inter embedded from the system fonts. Styles come from `../video/assets/tokens.css`, which the video shares.

Each slide cites the repo files behind its numbers, in an HTML comment and in its footer.
