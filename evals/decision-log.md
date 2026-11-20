# Hill-climb log

One row per policy change, measured on the golden set (`node evals/golden.mjs`) and the organizers' tests
(`node scripts/brane-cases.mjs`). Keep a change only when leaks do not rise and controls are not over-blocked.

| Version   | Change                                                                                                                | Golden claims | Spans leaked                                   | Controls over-blocked                                        | Organizers' tests | Kept |
| --------- | --------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------- | ------------------------------------------------------------ | ----------------- | ---- |
| claims-v1 | First policy, sensitivity high (0.40)                                                                                 | not run       | not run                                        | T1 over-blocked: GLiNER read "Dutch" as ETHNIC_ORIGIN (0.48) | 9/10              | no   |
| claims-v2 | Sensitivity standard (0.50)                                                                                           | 28/30         | 2/53: "fractured her wrist", "Maastricht UMC+" | 0/3                                                          | 10/10             | yes  |
| claims-v3 | Health semantic category names injuries, hospitals and clinics; keywords fracture, plaster, hospital, UMC, clinic, ER | 29/30         | 0/53                                           | 0/3                                                          | 10/10             | yes  |

## Open gaps

| Gap                                                                                                  | Seen in   | Effect                                                                   | Next step                                                                                |
| ---------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| A passport number is labeled `ACCOUNT_NUMBER`, so it gets a placeholder instead of staying local     | g14       | No leak; routes cloud instead of local                                   | Product gap for the policy matrix CSV; or a harness-side identifier check before sending |
| A BSN is labeled `ACCOUNT_NUMBER`                                                                    | g13 probe | Routed local here only because the prompt also named a person and policy | Harness-side 11-check for 9-digit BSNs                                                   |
| A policy number such as `POL-2231-88` is labeled `PERSON` and only partly masked (`PERSON_REF_2-88`) | probe     | Fragment of the identifier leaves                                        | Custom semantic or harness-side pattern for policy and claim numbers                     |
