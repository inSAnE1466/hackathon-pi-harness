# Use-case candidates

The team picks one on Friday morning. The brief's own example is recruiting, so many teams will choose it; a
different case scores better on relevance if we can research it as deeply. Each candidate has a real legal
constraint, a task that is fundamentally permissible, and all five security tests apply.

| Candidate                                         | Business task                                                                             | Data that bites                                                                                           | Main sources                                                                                                                        | Human decision                                               | Synthetic data                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ |
| **Whistleblower intake triage**                   | Sort reports into topics, extract facts, draft acknowledgements within the 7-day deadline | Reporter identity (strict confidentiality), named accused persons, health or criminal data inside reports | Directive (EU) 2019/1937 Art. 9, 16; GDPR Art. 9, 10; national transposition (Dutch Wet bescherming klokkenluiders, German HinSchG) | Whether to open an investigation; any disclosure of identity | Templates plus Nemotron-PII spans                |
| **Sick-leave and return-to-work case notes** (HR) | Summarise case notes for the line manager and plan adjustments                            | Diagnosis and medical detail (Art. 9), which in the Netherlands the employer may not even register        | GDPR Art. 9, 88; Dutch AP guidance on sick employees; AI Act Annex III(4)                                                           | Any adjustment or sanction                                   | Synthea notes recast as HR files                 |
| **Insurance claims pre-check**                    | Check a claim's documents for completeness and summarise for the handler                  | Health data, IBANs, third parties' data                                                                   | GDPR Art. 9, 22; AI Act Annex III(5)(c) for life and health insurance; EIOPA guidance                                               | Approve or reject the claim                                  | Gretel finance plus Synthea                      |
| **Contract review for a law firm**                | Extract clauses, flag risk against a playbook                                             | Client confidentiality and privilege, counterparties' personal data, trade secrets                        | GDPR Art. 28 (processor), professional secrecy rules, Trade Secrets Directive (EU) 2016/943                                         | Legal advice to the client                                   | Public contract templates with synthetic parties |
| **Recruiting (the brief's example)**              | Compare 40 applications against job criteria                                              | Names, contact data, health or other special categories in CVs                                            | GDPR Art. 6, 9, 22, 88; AI Act Annex III(4)(a), Art. 14, 26                                                                         | Shortlist and hire                                           | Nemotron-PII resumes                             |

## Selection test

Score each 1 to 5 on: depth of legal research available to our law students, clarity of the policy matrix (at
least three rules that differ in action), demo value in two minutes, and how naturally the five security tests
arise. Pick the highest total; break ties toward the case with a clear `local` route, because a use case where
every rule is "pseudonymise" shows less of the architecture.

Whistleblower intake has the strongest shape: identity must be `local` or `block` by law, facts may go
`frontier-protected`, the decision to investigate is `human`, and reports are the natural carrier for hidden
instructions.
