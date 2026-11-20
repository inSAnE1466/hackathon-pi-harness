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
