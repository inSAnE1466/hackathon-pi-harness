# Review of out.mp4

Rendered 2026-11-21 with HyperFrames 0.9.72: 94.7 s, 1920x1080, 30 fps, H.264 with AAC voice, 7.4 MB.
`npx hyperframes check` passed with 0 errors and 84 of 84 contrast checks. `snapshot --review` does not exist in
0.9.72, so the review used frames extracted with ffmpeg at 3, 9, 31, 41, 58, 64, 67, 70, 79, 83, 86.5 and 92 s.

| Beat (s)            | What the frames show                                                                                     | Verdict |
| ------------------- | -------------------------------------------------------------------------------------------------------- | ------- |
| Hook (0 to 9)       | Claimant, the claim token, the AI assistant, then the adviser and the handler; the handler lights up on "decides" | ok      |
| Architecture (9 to 30) | The assistant opens into its Durable Object; agent, three tools, gate, BRANE, two models and the audit log appear as named | ok      |
| One claim (30 to 50) | g01 travels: the injury and hospital token to the local model, fact sheet back, placeholders to the frontier model, then a citation, a consult and a recommendation; six rows drop into the log | ok      |
| Attack (50 to 62)   | The camera follows the planted note to BRANE; "422 · nothing sent" lands and the model edges fade          | ok      |
| Audit (62 to 69)    | The rest of the graph dims and the camera rests on the log; ids highlight; AI Act Art. 12 and GDPR Art. 5(2) label | ok      |
| Evals (69 to 87)    | Labels first, then one square per decision for each build (0 and 6 unsafe), then the QC loop and 20/20, 0/33 | ok      |
| Close (87 to 95)    | The whole graph; the claims handler lights up on "person"                                                  | ok      |

Fixed during review: a grey empty pill at frame 0, dots left by round line caps on undrawn edges, the faded
assistant label under the audit log, a QC loop too small for its labels, the proof labels appearing late.

Open items:

- The audit log rows use 22 px monospace. They are captioned, the voice names them, and the camera enlarges them in
  the audit beat, but in the other beats they are small on a phone.
- `check` warns that the file is large and suggests sub-compositions. The graph is one world that every beat
  changes, so it stays in one file.
