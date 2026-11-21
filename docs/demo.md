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

## The video (95 seconds, backup and opener)

<a id="the-video-90-seconds-backup-and-opener"></a>

Made with HyperFrames (Apache-2.0, HTML and CSS rendered to MP4), so it shares the slide deck's design tokens.
Narration by ElevenLabs from [demo/narration.md](../demo/narration.md); captions come from the voice's word times.

The video is one node graph that grows. People are outlined pills, machines are grey tiles, BRANE is ink, and yellow
marks what moves or matters. Each part appears when the voice names it, and a small label travels along each edge to
show what flows.

| Beat         | On screen                                                                                                                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hook         | The people: a claimant sends a claim to the AI assistant; the medical adviser and claims handler join                                                                                                                                                |
| Architecture | The assistant opens into its Durable Object: Pi Durable agent, lookup, consult, request_approval, the audit log; every model call goes through the gate and BRANE to the frontier or local model                                                     |
| One claim    | Claim g01: injury and hospital go to intake on the local model and come back as a fact sheet; placeholders go to the frontier model; a citation, a consult to the adviser, a recommendation to the handler; each step drops a row into the audit log |
| Attack       | Letter g26: its planted note reaches BRANE and stops (422, nothing sent); the model edges fade                                                                                                                                                       |
| Audit        | The camera rests on the audit log: categories and ids, never claim text; AI Act Art. 12, GDPR Art. 5(2)                                                                                                                                              |
| Evals        | One square per decision: BRANE with our policy and gate, 0 of 63 unsafe; an LLM asked what is sensitive, 6; then the QC loop and the held-out 20/20                                                                                                  |
| Close        | The whole graph again; the claims handler lights up                                                                                                                                                                                                  |

The benchmark compares PII handling only (who decides what may leave, and how protected), not answer quality.

Motion rules: one graph for the whole film, a part appears when it is named, arrivals on long ease-outs, camera moves
ease both ways, landed headlines stay still, nothing loops. One headline per beat; no paragraphs on screen.

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
