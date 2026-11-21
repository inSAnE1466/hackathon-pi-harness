# Video narration (about 3 minutes)

The voiceover for the pitch video, one block per beat, read by one speaker explaining one thing. Spoken text is inside
the quote blocks; everything else is direction. `node demo/video/voiceover.mjs` sends each changed block to ElevenLabs
(voice Brian, American) and re-times the composition to the clips. The headings are fixed: the script turns each into
the beat id the composition keys on (`situation`, `harness`, `loop`, `evals`, `demo`, `close`). The seconds are the unvoiced
plan; the voiced cut replaces them.

## Situation, 0 to 22 seconds

> Claims handlers at an EU health insurer work through files full of diagnoses, prescriptions and hospital notes. A
> frontier model would help them check each invoice against the policy, but health data is a special category under
> the GDPR and may not go to an outside model. We built an assistant that prepares each claim for the handler while
> the health data stays on a local model.

## Harness, 22 to 50 seconds

> The assistant is a custom harness built on Pi, and every request it makes to a model passes a fixed series of checks
> that we can test one at a time. A regular-expression pre-mask replaces policy numbers and other identifiers with
> tokens. A second classifier on BRANE's local model labels the request and can only make the route
> stricter. BRANE is the gate. It sends the request to the frontier model with placeholders, keeps it on the local model, or refuses it, and
> the harness has no other path to a model.

## Loop, 55 to 75 seconds

> The agent itself runs in a loop. It calls the model, runs the tool the model asks for, and calls the model again with
> the result until the claim is ready. While building it we found that the same loop improves the harness. We change one
> part, such as a pre-mask pattern or a policy rule, run the evals, keep the change only if the scores improve, and go
> round again.

## Evals, 75 to 95 seconds

> Each check is scored on its own, on Omar Shalaby's labelled requests. We tune on one split and choose between
> versions on another. BRANE's answers vary, so each case counts at its worst run. Here is where each score started
> and where it ended.

## Demo queue, 96 to 108 seconds

> Here is the web app. The queue on the left holds the claims. In this claim, Sanne Bakker asks whether her therapy for
> burnout is covered. Her message and her files fill the message box, and the handler presses Send.

## Demo trace, 108 to 120 seconds

> On the right, the trace fills in while the agent works: pre-mask, intake, BRANE, tools, and the person. By the end,
> BRANE has kept the requests with health details on the local model, and the request to the frontier model is
> protected.

## Demo adviser, 120 to 132 seconds

> The agent looks up the policy terms and asks the medical adviser a question. The adviser answers in this card, and
> the answer goes back to the agent through BRANE, like every other request.

## Demo decision, 132 to 145 seconds

> Now the claims handler decides. The decision card shows the recommendation, the cited terms, and where each request
> went. The handler approves, and the decision comes back into the chat as a message the agent continues from.

## Demo audit, 145 to 156 seconds

> The audit log tab lists every step and every decision a person made. The approval is a human row, linked to the
> handoff it answers, and the hash chain is verified.

## Impact, 156 to 180 seconds

> What does this take off the handler's desk? The assistant reads the file, looks up the policy terms and the law, asks
> the adviser, and drafts a recommendation with its sources. The handler reads it and decides.

## Close, 180 to 190 seconds

> Try it yourself. The app is live with synthetic claims, and the address and the password are on screen. We are Team
> Gezira.

## What each line rests on

| Spoken                                                                 | Source                                                                                                                             |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| health data is a special category, may not go to an outside model      | GDPR Art. 9; [docs/research.md](../docs/research.md); policy rule for health, `policy/brane.json`                                  |
| regular-expression pre-mask, policy numbers and other identifiers      | `src/primitives/detect.ts` (BSN, policy, claim, passport, plate patterns)                                                          |
| classifier on BRANE's local model, only stricter                       | `src/primitives/classify.ts`, `policy/classifier.json`; the `classifier` switch in `src/switches.ts` (default on)                  |
| BRANE is the gate; placeholders, local or refused; no other path       | `src/brane.ts` (the only transport, fails closed)                                                                                  |
| the agent's loop; the same loop on the harness; kept only if better    | Pi's agent loop (`src/session.ts`); `evals/hill.mjs`, `evals/autoclimb.mjs`, `evals/climb-history.json`                            |
| worst run; where each score started and ended                          | `evals/climb-summary.json` (`.metrics`, `.headline.values`: the complete system, classifier on), inlined by `demo/video/climb.mjs` |
| Sanne Bakker, therapy for burnout, GP letter with diagnosis and drug   | the queue's burnout claim, `src/client/queue.ts` (synthetic, golden g09)                                                           |
| the queue, message box, trace, adviser card, decision card, audit log  | `demo/video/assets/live/live.mp4`, recorded on the deployed app 21 Nov 04:30 CET (`demo/video/record-live.mjs`)                    |
| health details local, the frontier request protected                   | the trace and decision card in the recording (BRANE row, "Where it went")                                                          |
| decision back in the chat; human row linked to the handoff; hash chain | `src/session.ts` (POST /audit/human, decision message), `src/audit.ts` (ref_id, prev_hash, hash)                                   |

The video ends on the live app's address, https://claims-harness.fred-755.workers.dev, and the team password, read
from `.dev.vars` at render time. The slopes on screen come from `evals/climb-summary.json` (`demo/video/climb.mjs`);
the voice names no numbers from them. Handler time saved is not measured, so the video does not claim it.
