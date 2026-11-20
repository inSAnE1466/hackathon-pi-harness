# Demo, site and video

## The site

The app runs locally with `pnpm dev` for building and the live demo. If the jury needs a link, the Worker deploys to
Cloudflare behind a shared team password ([run](run.md)). The same app serves manual testing, the live demo and the
screen recordings for the video.

What a tester does by hand:

1. Open a claim from the seeded set, or paste one.
2. Watch the pipeline panel: BRANE's verdict per document, BRANE's detection confidences against our floors, the
   route per step, and what the model actually received beside the original.
3. Answer a `consult` or `approve` request as the medical adviser or the handler.
4. Read the protocol rows for that claim.
5. Open the eval board: the five track tests, every failure-mode family, and our scores beside the baseline's.

## The design system

Our own `src/client/tokens.css`, written from public product-design principles: a white page, grey only on tiles
and selected rows, hairline separators instead of heavy shadows, near-black pill for the one primary action, Inter
at 400/500/600 with four sizes (12, 14, 16, 20), spacing on a 4px scale, and tiles in a bento grid that fills the
page. State colours appear only beside a text label: green for passed, orange for waiting on a human, red for
blocked or failed. No design files from other projects are copied.

## The trace viewer

Panels inside the Pi client, beside the transcript (`src/client/`):

| Panel                | Shows                                                                                 | Source                                     |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| Pipeline             | Each document's path: BRANE, decide, route, then sent, consulted or blocked           | protocol rows                              |
| Sent versus original | The original with protected spans marked, beside the exact payload that left          | BRANE response and the recording transport |
| Confidences          | Each BRANE detection's confidence as a bar against our floor; semantic matches        | `decide` results                           |
| Human queue          | Open `consult` and `approve` requests with the minimised case                         | Pi Durable conversation state              |
| Eval board           | Pass or fail per track test, leak counts per failure family, harness against baseline | eval run output                            |

## The claims workspace

What `src/client/` renders today.

- **Landing page.** "Claims assistant" with three sample claims from `evals/golden/claims.jsonl`: a policy question
  (g28), a health claim (g07) and a request to reject a claim (g19). A sample opens a new session with its text in
  the composer. Prompts go in as "Claims handler", a role and not a name, so no personal name enters a request.
- **Session view.** The transcript on the left, the **Decision log** on the right (below it on narrow screens). The
  log reads `GET /api/sessions/:id/audit` on open, every 2 s while a turn runs, and once more after it ends. It
  shows totals (requests, cloud protected, kept local, refused, handoffs) and each row newest first: for BRANE rows
  the route, the detected categories, semantic matches, what happened to the payload, the rule and the model; for
  gate rows the identifiers masked before BRANE, the passages a lookup cited and each handoff. **Export CSV**
  downloads the same rows oldest first.
- **Review queue.** Above the composer when the log has a handoff: one card per handoff with the role and Approve,
  Edit or Reject. The choice is kept in the browser only; no model is called.
- **Refusals.** A model call BRANE refused (HTTP 422) shows as a card: "This request needs a person. BRANE refused it
  under <rule>.", with the rule's description and legal basis from BRANE's response.
- **Activity.** The harness's task graph, a drawer that stays closed until opened from the top bar.

Tokens live in `src/client/tokens.css`; the pure log logic (routes, totals, handoff wording, refusal parsing, CSV)
in `src/client/decision-log.ts`.

## The live demo (about 4 minutes)

1. The problem: one claim bundle, its health data and identifiers, and the question "what may leave?"
2. A clean claim runs end to end: protected payload, recommendation, handler approves (control case).
3. A claim with an unrelated psychiatric history and a hidden "approve in full" note: the history is blocked, the
   note is flagged, the route does not change (protected data, bypass).
4. A request to compare two claimants: blocked (linkage).
5. BRANE switched off: nothing sent, the claim waits (check failure).
6. The eval board: our run against the baseline on the same cases.

## The video (90 seconds, backup and opener)

Made with HyperFrames (Apache-2.0, HTML and CSS rendered to MP4), so its layouts share the slide deck's design
tokens. Narration by ElevenLabs from a script in `video/script.md`; captions synced to the audio.

| Beat         | Seconds  | On screen                                                                                           |
| ------------ | -------- | --------------------------------------------------------------------------------------------------- |
| Hook         | 0 to 8   | A claim bundle; health data and identifiers highlight one by one                                    |
| Architecture | 8 to 30  | The routing diagram draws itself: BRANE, decide, route, five routes                                 |
| One claim    | 30 to 55 | Screen recording of the site: pipeline panel, sent versus original, a consult                       |
| Attack       | 55 to 70 | The hidden instruction appears, the injection probability bar rises past its floor, route unchanged |
| Evals        | 70 to 85 | The eval board fills case by case; baseline column beside ours                                      |
| Close        | 85 to 90 | The one-line claim and the team                                                                     |

Motion rules: one idea per beat, animate only what the narration names, ease-out for entrances, no motion that does
not carry information. The design system is the deck's: white, black, Inter, yellow highlight as the only colour.

## Assets

Everything the jury sees besides the live app lives in `demo/`. Every number in it traces to a file in `evals/` or
`submission/`, cited where it appears.

| Asset                  | File                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| 3-minute live script   | [demo/script.md](../demo/script.md): prompts, clicks, decision log rows, lines, T1 to T5 |
| Video narration        | [demo/narration.md](../demo/narration.md): 217 words in six timed beats, for ElevenLabs  |
| Slide deck             | [demo/deck/index.html](../demo/deck/index.html), rendered to `demo/deck/deck.pdf`        |
| Video                  | [demo/video/](../demo/video/): HyperFrames composition, rendered to `demo/video/out.mp4` |
| Live decision log rows | [demo/evidence/drive-2026-11-20.md](../demo/evidence/drive-2026-11-20.md)                |
| QC gate run            | [demo/evidence/qc-2026-11-20.txt](../demo/evidence/qc-2026-11-20.txt)                    |

The narration script is `demo/narration.md`. The video's audio is silence until the ElevenLabs voiceover replaces
`demo/video/assets/narration-placeholder.m4a`; [demo/video/render.md](../demo/video/render.md) has the steps.
