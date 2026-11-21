# Demo, site and video

## The site

The app runs locally with `pnpm dev` for building and the live demo. If the jury needs a link, the Worker deploys to
Cloudflare behind a shared team password ([run](run.md)). The same app serves manual testing, the live demo and the
screen recordings for the video.

What a tester does by hand:

1. Open a claim from the queue and start it.
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

What `src/client/` renders today: one screen after sign-in. Its design rules (tokens, regions, states) are in
[src/client/DESIGN.md](../src/client/DESIGN.md).

- **Header.** "Claims assistant", one line of subtitle, the policy version read from `policy/brane.json` at build
  time, and "All claims are synthetic".
- **Queue (left).** Eight synthetic claims from `src/client/queue.ts`, each as it would arrive: the request in the
  sender's words plus the attached documents as text (invoice lines, a discharge note, an airline report). They
  follow golden cases g28, g14, g01, g09, g17, g26, g19 and g22. Each row shows a status from that claim's
  `GET /api/sessions/:id/audit`: New, In progress, Waiting on expert (a `consult` handoff), Prepared (a
  `request_approval` handoff), Refused (a refused BRANE row), or Decided: approved, edited or rejected. The queue
  folds to icons, and starts folded at 1280 px and below.
- **Chat (centre).** Each claim has one session, created the first time it opens; the claim-to-session map is in
  localStorage, so the queue survives a reload. The request arrives as the first message with its attachments as
  chips that open to their text. **Start** sends it as "Claims handler", a role and not a name. While the harness
  works, a thread under the claim adds one line per step as audit rows arrive (intake, identifiers masked, the BRANE
  route, passages found, a handoff). Assistant answers render Markdown with an in-repo renderer that builds React
  elements and never injects HTML. A lookup shows as one line, "Cited: POL-3.2, POL-4.1", that opens to the
  passages; `consult` and `request_approval` show as one line each.
- **The claims handler's decision.** A claim with a `request_approval` handoff ends with a card: the recommendation,
  the amount per item from the assistant's reasons, the cited passage ids, a small diagram of where the work went
  (local model, frontier model, person) and Approve, Edit or Reject. The choice is kept in this browser only; no
  model is called.
- **Refusals.** A model call BRANE refused (HTTP 422) shows as a card: "This request needs a person. BRANE refused it
  under <rule>.", with the rule's description and legal basis from BRANE's response.
- **How the harness decided (right).** Two tabs. **Trace** is the claim's path as five fixed steps (Intake, Gate,
  BRANE, Tools, Person) that fill in from the audit rows; the step the claim is at now is yellow. **Audit log** opens
  with the latest QC numbers from `evals/baseline.json` and `evals/compare-latest.json`, then every audit row (time,
  kind, route, categories, rule, model, detail) with **Export CSV**, and the basis: EU AI Act Art. 12 and 26(6),
  GDPR Art. 5(2). Rows hold categories and ids, never prompt text.
- **Activity.** The harness's task graph, a drawer that stays closed until opened from the chat header.

Tokens live in `src/client/tokens.css`; the pure log logic (routes, claim status, handoff wording, refusal parsing,
CSV) in `src/client/decision-log.ts`, the trace in `src/client/trace.ts`.

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
