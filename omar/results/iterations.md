# Iteration log: towards a plateau

**Protocol.** Errors are found on **dev** (800) only. Changes are confirmed on **val** (500): BRANE runs twice (run-to-run noise
~1-3 points), classifier once. A change is kept only if it beats the current system **in both BRANE runs** on the primary metric
(leak), without raising over-block by more than the noise. **Plateau** = two consecutive rounds without a kept change, or max 3 rounds.
Test (200) is never used; the human gold set is the final check after the plateau. Minimal pairs (80 rows, 40 pairs) are a
diagnostic run every round: a pair passes only if both halves are routed correctly.

| Round | Change (from dev errors) | System | val leak (run1 / run2) | val over-block | val route F1 | Pairs | Kept? |
|---|---|---|---|---|---|---|---|
| 0 | baseline (round-2 selection) | BRANE v1-nokw + classifier v1 (A) | 0.8% | 3.2% | 0.893 | – | baseline |
| 1 | dev-800 errors: explicit "does NOT count" boundaries (pets, crimes against the customer, quoted instructions, counts vs lists, parental leave) | BRANE **v5** + classifier **defs v2** | 2.4% / 2.4% | 1.6% | 0.953 | 82% | **No** (leak worse in both runs) |
| 2 | combine the better halves (no new runs) | BRANE v1-nokw + classifier **defs v2** | 2.4% / 1.6% | 3.2% / 1.6% | 0.911 / 0.953 | 85% | **No** (leak worse in both runs) |

**Round-0 reference with the second BRANE run:** combination leak 0.8% / 0.4%, over-block 3.2% / 1.6%, route F1 0.893 / 0.933; minimal pairs 57%.

**Plateau reached after round 2** (two consecutive rounds without a kept change). Final system unchanged: BRANE policy v1-nokw +
classifier definitions v1, stricter route wins.

**Finding: precision vs recall.** Explicit exclusions make both BRANE's judge and our classifier more precise (classifier pairs
57% -> 88%, route F1 0.953 -> 0.962, fewer false alarms) but more lenient (classifier leak 2.4% -> 4.8%, BRANE v5 leak 16% -> 20%).
For privacy we keep recall: an over-block costs convenience, a leak is a breach.

**Minimal pairs (40 pairs, every sensitive half keyword-free):** keyword baseline 5%, classifier v1 57%, BRANE v1-nokw 75%,
final system 57%. Remaining failures of the final system are almost all over-protection of the harmless half; the injection pairs fail
for every system because BRANE's built-in injection detector also blocks quoted or human-addressed instructions (not configurable).
Honesty note: round-0 pair results were seen before the round-1 fixes were written (fixes were derived from dev errors).
