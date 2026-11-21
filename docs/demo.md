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
  `request_approval` handoff), Refused (a refused BRANE row), or Approved, Edited or Rejected (a `human` row on the
  recommendation). The queue folds to icons, and starts folded at 1280 px and below.
- **Chat (centre).** Each claim has one session, created the first time it opens; the claim-to-session map is in
  localStorage, so the queue survives a reload. Opening a claim puts its request in the message box and its
  attachments as removable chips under it (`Composer`); nothing runs until the person edits and presses **Send**
  (or Cmd/Ctrl+Enter). It goes as "Claims handler", a role and not a name. While the harness
  works, a thread under the claim adds one line per step as audit rows arrive (intake, identifiers masked, the BRANE
  route, passages found, a handoff). Assistant answers render Markdown with an in-repo renderer that builds React
  elements and never injects HTML. A lookup shows as one line, "Cited: POL-3.2, POL-4.1", that opens to the
  passages; `consult` and `request_approval` show as one line each.
- **A person's decision (`DecisionCard`).** Each open handoff gets a card. A `consult` asks the medical adviser or
  legal reviewer for an answer. A `request_approval` shows the recommendation, the amount per item from the
  assistant's reasons, the cited passage ids, a diagram of where the work went (local model, frontier model,
  person) and Approve, Edit or Reject. The card posts to `POST /api/sessions/:id/audit/human`; the server writes a
  `human` row in the hash chain and passes the decision back into the conversation, through BRANE like every model
  request ([architecture](architecture.md)). The decision then shows in the chat as a message from that person
  (`HumanDecisionMessage` in `Transcript.tsx`), as a square node in the run thread, on the Person step of the
  trace, and as a row in the audit log. Nothing about a decision is kept in the browser.
- **Refusals.** A model call BRANE refused (HTTP 422) shows as a card: "This request needs a person. BRANE refused it
  under <rule>.", with the rule's description and legal basis from BRANE's response.
- **How the harness decided (right).** Two tabs. **Trace** is the claim's path as five fixed steps (Intake, Gate,
  BRANE, Tools, Person) that fill in from the audit rows; the step the claim is at now is yellow, and the Person
  step names who decided. **Audit log** shows Chain verified (or the row where the chain breaks), **Download trail**
  (the server's CSV), the basis (EU AI Act Art. 12 and 26(6), GDPR Art. 5(2)), then every row as #, who (BRANE, our
  gate, the assistant, or the person's role), what, and route with model or rule. The latest QC numbers from
  `evals/baseline.json` and `evals/compare-latest.json` sit under the table. Rows hold categories and ids, never
  prompt text.
- **Activity.** The harness's task graph, a drawer that stays closed until opened from the chat header.

Tokens live in `src/client/tokens.css`; the pure log logic (routes, claim status, open handoffs, handoff and
decision wording, refusal parsing) in `src/client/decision-log.ts`, the trace in `src/client/trace.ts`.

## The live demo (about 4 minutes)

1. The problem: one claim bundle, its health data and identifiers, and the question "what may leave?"
2. A clean claim runs end to end: protected payload, recommendation, handler approves (control case).
3. A claim with an unrelated psychiatric history and a hidden "approve in full" note: the history is blocked, the
   note is flagged, the route does not change (protected data, bypass).
4. A request to compare two claimants: blocked (linkage).
5. BRANE switched off: nothing sent, the claim waits (check failure).
6. The eval board: our run against the baseline on the same cases.

## The video (about 2 minutes, pitch and backup)

<a id="the-video-90-seconds-backup-and-opener"></a>
<a id="the-video-95-seconds-backup-and-opener"></a>
<a id="the-video-92-seconds-pitch-and-backup"></a>

Made with HyperFrames (Apache-2.0, HTML and CSS rendered to MP4) in [demo/video/](../demo/video/). One American voice
(ElevenLabs, Brian) reads [demo/narration.md](../demo/narration.md); captions come from the voice's word times.

The video stands alone. Diagrams draw themselves: each node's outline draws round it and then it fills, and each edge
draws along its path. When the voice reaches a key line, the scene blurs back and a large centered serif line (EB
Garamond) holds a few words of it, then the scene returns. The only screens are real crops of the app.

| Beat      | On screen                                                                                                                                                                                                                   |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Situation | A claims handler, a claim file with health detail, the frontier and local models; the edge to the frontier model is struck through. Key line: health data may not leave                                                     |
| Harness   | The Pi agent, then three checks in a row: pre-mask (regex, no model), the second classifier (local model, switched on per run), BRANE the gate; then frontier, local or refused. Key lines: three checks; BRANE is the gate |
| Evals     | Four slopes from `evals/climb-summary.json`, drawn one after another: leak rate, route F1, over-block, mandatory tests passed, with start and end values. Key line: a change stays only if the scores improve               |
| Demo      | The burnout claim in the app: the message box, the trace (BRANE: 1 cloud protected, 7 local), the decision card, Approve, the decision message in the chat, the audit log's human row #22. Key line: a person decides       |
| Close     | The live address, https://claims-harness.fred-755.workers.dev                                                                                                                                                               |

## Assets

Everything the jury sees besides the live app lives in `demo/`. Every number in it traces to a file in `evals/` or
`submission/`, cited where it appears.

| Asset                  | File                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| 3-minute live script   | [demo/script.md](../demo/script.md): prompts, clicks, decision log rows, lines, T1 to T5            |
| Video narration        | [demo/narration.md](../demo/narration.md): 197 words in seven beats, voiced by ElevenLabs           |
| Slide deck             | [demo/deck/index.html](../demo/deck/index.html): 8 diagram slides, rendered to `demo/deck/deck.pdf` |
| Video                  | [demo/video/](../demo/video/): HyperFrames composition, rendered to `demo/video/out.mp4`            |
| Live decision log rows | [demo/evidence/drive-2026-11-20.md](../demo/evidence/drive-2026-11-20.md)                           |
| QC gate run            | [demo/evidence/qc-2026-11-20.txt](../demo/evidence/qc-2026-11-20.txt)                               |

The voiceover clips are `demo/video/assets/vo-<beat>.mp3`, made by `demo/video/voiceover.mjs`;
[demo/video/render.md](../demo/video/render.md) has the commands.
