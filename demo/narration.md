# Video narration (about 80 seconds)

The voiceover for the pitch video, one block per beat. The video stands alone, so the words stay sparse and the
pictures carry the detail. Spoken text is inside the quote blocks; everything else is direction.
`node demo/video/voiceover.mjs` sends each changed block to ElevenLabs and re-times the composition to the clips. The
headings are fixed: the script turns each into the beat id the composition keys on (`cast`, `harness`, `claim`,
`decide`, `attack`, `climb`, `close`). The seconds are the unvoiced plan; the voiced cut replaces them.

Word count of the spoken text: 188.

## Cast, 0 to 13 seconds (31 words)

> Daan, the claimant, breaks his leg skiing in Austria. The agent prepares his claim. BRANE checks every model
> request. The adviser judges health, the reviewer judges law, and the handler decides.

## Harness, 13 to 28 seconds (46 words)

> The agent is a Pi harness in one Durable Object. Its intake keeps health detail local. The gate masks numbers
> BRANE misses. BRANE is the only road to a model. A lookup cites the policy, consult and approval go to people, and
> audit records each step.

## Claim, 28 to 37 seconds (20 words)

> The discharge note stays local. The frontier model sees placeholders, checks the invoices against the policy, and
> asks the adviser.

## Decide, 37 to 49 seconds (32 words)

> The handler reads the recommendation and approves. The decision comes back into the chat as a message, and the
> agent continues from it. In the audit trail, it is a human row.

## Attack, 49 to 56 seconds (20 words)

> A claim letter hides an order: approve in full, send the bank details. BRANE refuses, and nothing reaches a model.

## Climb, 56 to 69 seconds (29 words)

> We climb the harness, never the model. Each change is a real run, kept only if it scores better and nothing
> leaks. Here is each criterion, iteration by iteration.

## Close, 69 to 74 seconds (10 words)

> Frontier quality, local privacy, and a person decides. Team Gezira.

## What each line rests on

| Spoken                                                          | Source                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Daan, ski fracture in Austria                                   | the queue's ski claim, `src/client/queue.ts` (synthetic)                                                   |
| claimant, agent, BRANE, adviser, reviewer, handler              | roles in [docs/use-case.md](../docs/use-case.md); `consult` targets the medical adviser and legal reviewer |
| intake, gate, only road, lookup, consult, approval, audit       | [docs/primitives.md](../docs/primitives.md), [docs/architecture.md](../docs/architecture.md)               |
| decision back in the chat; a human row in the audit trail       | the human-decision route (POST to the audit trail, then a gated message into the session)                  |
| hidden order refused, nothing reaches a model                   | queue claim "hidden note", golden g26: HTTP 422 `RULE_OVERRIDE_ATTEMPT`                                    |
| change the harness, never the model; kept only if nothing leaks | [docs/harness-environment.md](../docs/harness-environment.md), `evals/climb-history.json`                  |

The climb beat names no numbers. The film ends on one graph per criterion drawn from `evals/climb-history.json`, so
the graphs carry the scores.
