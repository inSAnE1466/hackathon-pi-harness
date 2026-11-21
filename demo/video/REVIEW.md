# Review of out.mp4

Rendered 2026-11-21 with HyperFrames 0.9.72: 92.1 s, 1920x1080, 30 fps, H.264 with AAC voice, 8.0 MB, mean voice
level -24 dB. `npx hyperframes check` passes with 0 errors. The review used `hyperframes snapshot --at` stills and
frames extracted from the render with ffmpeg.

| Beat (s)           | What the frames show                                                                                                                    | Verdict |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| Cast (0 to 15)     | The ski claim from the app; claimant, agent, BRANE, adviser, reviewer and handler draw in as named; handler lights up                   | ok      |
| Harness (15 to 35) | The agent opens into the Durable Object; each primitive's outline draws, then fills; the audit log appears last                         | ok      |
| Claim (35 to 44)   | Discharge note to the local model, placeholders to the frontier model, POL-3.1 back, the medical question to the adviser                | ok      |
| Decide (44 to 56)  | The app's decision card, Approve ringed, the decision travels back to the agent, the chat message, the audit log's #17 human row ringed | ok      |
| Attack (56 to 65)  | The order travels to BRANE and stops; the app's refusal card; the refused row drops into the log                                        | ok      |
| Climb (65 to 83)   | Ten graphs, one per criterion, draw point by point; reverted changes hollow; the ticker names each change                               | ok      |
| Close (83 to 92)   | The graphs stay under the closing line                                                                                                  | ok      |

Fixed during review: the cast "Agent" label showed through the harness, round-cap specks on undrawn edges, the
faded cast edges returning in the attack, the decision card competing with the chat message.

Open items:

- The climb graphs run on `assets/climb-placeholder.json` until gz-climb's `evals/climb-history.json` lands; the frame
  then says "placeholder data" in red. Run `node climb.mjs` and render again.
- `check` warns about 20 to 24 px labels under its 28 px phone floor (graph captions, audit rows). They are legible at
  1080p; the voice carries them on a phone.
