# Review of out.mp4

Rendered 2026-11-21 with HyperFrames 0.9.72: 148.3 s, 1920x1080, 30 fps, H.264 with AAC voice, 9.0 MB, mean voice
level -24.9 dB. `npx hyperframes check` passes with 0 errors. The review used `hyperframes snapshot --at` stills and
frames extracted from the render with ffmpeg at each beat seam.

| Beat (s)             | What the frames show                                                                                                       | Verdict |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------- |
| Situation (0 to 23)  | Handler, claim file, frontier and local models draw in; the frontier edge turns red and is crossed; the serif key line     | ok      |
| Harness (23 to 56)   | Pi agent, pre-mask with its regex crop, classifier, BRANE, then frontier, local and refused; the braneFetch crop           | ok      |
| Loop (56 to 78)      | The ring draws; a claim token goes round model call, tool, result; the nodes relabel for the harness; the kept-change crop | ok      |
| Evals (78 to 99)     | Four slopes draw one after another, start to end, all finished by 95 s                                                     | ok      |
| Demo (99 to 137)     | Message box, trace with the BRANE row ringed, decision card, Approve, the decision in the chat, audit row #22 ringed       | ok      |
| Close (137 to 148)   | The live address, no password                                                                                              | ok      |

Fixed during review: each slope's axis ticks and stray end-point specks showed before the slope drew; the slope's
graphics now appear with its label.

Open items:

- The slopes run on `assets/climb-placeholder.json` until gz-climb's `evals/climb-summary.json` lands; the frame says
  "placeholder data" in red. Run `node climb.mjs` and render again.
- `check` warns that some captions and the kept-change crop are on screen under its reading floor. The voice carries
  them.
