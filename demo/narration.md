# Video narration (about 2 minutes)

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
> tokens. A second classifier on BRANE's local model, which we switch on per run, labels the request and can only make
> the route stricter. BRANE is the gate. It sends the request to the frontier model with placeholders, keeps it on the local model, or refuses it, and
> the harness has no other path to a model.

## Loop, 55 to 75 seconds

> The agent itself runs in a loop. It calls the model, runs the tool the model asks for, and calls the model again with
> the result until the claim is ready. While building it we found that the same loop improves the harness. We change one
> part, such as a pre-mask pattern or a policy rule, run the evals, keep the change only if the scores improve, and go
> round again.

## Evals, 75 to 95 seconds

> Each check is scored on its own. On Omar Shalaby's split we tuned on eight hundred labelled requests, chose between
> versions on five hundred, and ran a hash-locked set of two hundred once, at the end. BRANE's answers vary, so each
> case counts at its worst run, and no kept change leaked.

## Demo, 80 to 110 seconds

> Here is one claim from the queue. Sanne Bakker asks whether her weekly therapy for burnout is covered, and her GP's
> letter names the diagnosis and the medication. BRANE keeps the seven requests that carry those details on the local
> model, and the one request that goes to the frontier model has her name replaced. The agent cites the policy terms, asks the medical adviser whether the therapy is necessary, and recommends paying once the
> adviser answers. The claims handler approves. The decision comes back into the chat as a message the agent continues
> from, and the audit trail stores it as a human row, linked to the handoff it answers, in a hash-chained log.

## Close, 110 to 116 seconds

> The app is live with synthetic claims, so you can run this claim yourself. We are Team Gezira.

## What each line rests on

| Spoken                                                                 | Source                                                                                                                                                                                                |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| health data is a special category, may not go to an outside model      | GDPR Art. 9; [docs/research.md](../docs/research.md); policy rule for health, `policy/brane.json`                                                                                                     |
| regular-expression pre-mask, policy numbers and other identifiers      | `src/primitives/detect.ts` (BSN, policy, claim, passport, plate patterns)                                                                                                                             |
| classifier on BRANE's local model, switched on per run, only stricter  | `src/primitives/classify.ts`, `policy/classifier.json`; the `classifier` switch in `src/switches.ts` (default off)                                                                                    |
| BRANE is the gate; placeholders, local or refused; no other path       | `src/brane.ts` (the only transport, fails closed); [docs/architecture.md](../docs/architecture.md)                                                                                                    |
| 800 tuning, 500 choosing, 200 hash-locked test run once                | `omar/README.md` section 5; `omar/results/LOCKED_TEST_RESULTS.md` (test sha256 recorded before the run)                                                                                               |
| the agent's loop; the same loop on the harness; kept only if better    | Pi's agent loop (`src/session.ts`); `evals/climb.mjs`, `evals/autoclimb.mjs`, [docs/harness-environment.md](../docs/harness-environment.md)                                                           |
| worst run; no kept change leaked                                       | [docs/harness-environment.md](../docs/harness-environment.md), `evals/climb.mjs`; slopes from `evals/climb-summary.json` (`evals/slopes.mjs`)                                                         |
| Sanne Bakker, therapy for burnout, GP letter with diagnosis and drug   | the queue's burnout claim, `src/client/queue.ts` (synthetic, golden g09)                                                                                                                              |
| seven local, one frontier with the name replaced; consult; pay         | the burnout run behind `demo/video/assets/ui/` (main at 4479b9b, 2026-11-21): 8 BRANE requests, 1 cloud protected, 7 local; consult answered (#16); recommendation #19; approval #22, its request #23 |
| decision back in the chat; human row linked to the handoff; hash chain | `src/session.ts` (POST /audit/human, decision message), `src/audit.ts` (ref_id, prev_hash, hash)                                                                                                      |

The video ends on the live app's address, https://claims-harness.fred-755.workers.dev. The slopes on screen (leak rate, route F1, over-block, the five mandatory tests) come from
`evals/climb-summary.json`; the voice names no numbers from them.
