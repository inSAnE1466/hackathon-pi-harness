# The baseline we beat

We run the same eval suite against two agents and publish both columns. The baseline is what a capable team
builds in two days by prompting a coding agent with the brief: a script that sends each document to BRANE, then to
OpenAI, with a system prompt or skill file that states the rules.

## The two builds

|                   | Baseline (`baselines/vanilla/`)                             | Our harness                                                                                                      |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Model access      | `fetch` to BRANE, and the OpenAI key is in the same process | One registered provider; BRANE is the only transport ([architecture](architecture.md#the-gate-is-the-transport)) |
| Rules             | System prompt and a skill file                              | Policy matrix as data, read by a pure `route()`                                                                  |
| Routing           | The model decides, guided by the prompt                     | Code decides from detectors, BRANE verdict and classifier answers                                                |
| Human in the loop | A sentence in the prompt                                    | `consult` (medical, legal) and `approve` (handler) routes with records                                           |
| Classifier        | BRANE only, or none                                         | BRANE first, then OpenAI Decisions on protected text with tuned floors, read by `route()`                        |
| Batch work        | One request per document, all text through the chat model   | Code mode fans out classifier calls; the chat model sees the routing table                                       |
| Context           | Grows with every document                                   | Each case runs in its own conversation; no shared memory across cases                                            |
| Failure handling  | `try/catch`, often with a retry                             | A failed verdict ends in `withheld`; no retry to another route                                                   |
| Protocol          | Whatever got logged                                         | Derived from Pi Durable's event log: every model call, tool call and its result                                  |

The baseline must be honest: same BRANE, same model, same documents, and the best prompt we can write for it.
A strawman baseline proves nothing to the jury.

## What the comparison measures

One command, `pnpm eval --agent vanilla|harness`, writes a scorecard per agent. Columns:

- leak count per failure-mode family ([failure modes](failure-modes.md)): E, G, R, L, H, T, P
- the five track tests, pass or fail
- task quality on control cases
- false blocks and human escalations on control cases
- cost and latency per case

## What a Pi Durable fork adds that a `curl` script cannot

- **Every step is recorded.** Pi Durable stores each model call, tool call and result in its event log, so the
  protocol and the trace viewer read real events instead of hand-written logging.
- **One choke point for model access.** The provider registry is the only way to reach a model, so one provider
  wrapper gates the chat model, code-mode `models.*` calls and the harness's own housekeeping calls (compaction,
  search). A script has as many egress points as it has `fetch` calls.
- **Hooks around every tool call.** Tool results pass through the same detector and protector before they re-enter
  context (failure E6), which a single pre-flight check misses.
- **Durable human approvals.** A case can wait for an approval across restarts and resume where it stopped.
- **Code mode for batches.** A script classifies many segments with journaled, replayable calls; the chat model
  never reads the raw batch.
- **Conversation isolation.** One conversation per case and no cross-case memory are configuration, which closes
  the linkage failures L1, L2 and L5.
- **Restart safety.** Pi Durable 1.5 counts a model request cut off by a restart as failed instead of resending it,
  so a crash cannot replay a send whose verdict is gone.
