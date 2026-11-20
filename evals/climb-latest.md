# Latest climb

Written by `node evals/climb.mjs` at 2026-11-20T23:30:59.080Z on policy claims-v5, in 977 s. Each
score is the worst of N runs (golden and held-out 3, mutated 2); a candidate is kept only on a strict
improvement confirmed by a second scoring.

- Start: golden[passed 29/30, leaked 0/53, overBlocked 0/3] heldout[passed 20/20, leaked 0/33, overBlocked 0/2] mutated[passed 141/150, leaked 6/265, overBlocked 2/12] organizers[passed 10/10]
- End: golden[passed 29/30, leaked 0/53, overBlocked 0/3] heldout[passed 20/20, leaked 0/33, overBlocked 0/2] mutated[passed 145/150, leaked 0/265, overBlocked 2/12] organizers[passed 10/10]
- Policy file changed: yes

| Candidate                                                                                                                                   | Verdict                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| CLAIM_HEALTH_CONTEXT keywords: ent specialist, hearing aids                                                                                 | kept (better: mutated passed 141->145, mutated leaked 6->3) |
| CLAIM_HEALTH_CONTEXT description: Mentions such as ent specialist, hearing aids count, also when the request is wrapped in polite phrasing. | kept (better: mutated leaked 3->0)                          |
