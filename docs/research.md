# Legal research: AI-assisted claims intake for an EU health and travel insurer

Draft for the legal team to verify and extend. Each finding names its source; [sources](sources.md) lists every
source with how far it was checked. The passage ids in brackets are the agent's own corpus
(`corpus/passages.json`), so the agent cites the same text this analysis relies on.

The setting follows the track: BRANE runs inside the insurer's own perimeter and counts as trusted; the question is
what may leave that perimeter to an external model, what must be pseudonymised first, and what stays on the local
model.

## 1. What the agent does

It checks that a claim is complete, extracts billable items, matches them to the policy terms and prepares a
recommendation. It does not decide claims, give medical opinions or contact claimants about outcomes.

## 2. Is the processing lawful at all?

- **Personal data.** Claims hold names, contact details, bank details and identifiers: personal data under GDPR
  Art. 4(1) [GDPR-4(1)].
- **Health data.** Treatment, injuries, medication and the name of the treating hospital concern health. Data that
  indirectly reveal a special category fall under Art. 9(1) (CJEU C-184/20) [GDPR-9(1)], [CJEU-C-184/20].
- **Legal basis.** Performance of the insurance contract (Art. 6(1)(b)) [GDPR-6(1)]. For health data, Art. 9(1)
  forbids processing unless an exception applies; Art. 9(2) lets Member State law provide one, with safeguards
  [GDPR-9(2)]. Several Member States do so for insurers. In the Netherlands, for example, the UAVG allows insurers to
  process health data where needed to assess the risk or perform the insurance contract, and only by persons bound to
  secrecy (UAVG Art. 30(3)(b) and 30(4)). The Dutch insurers' code of conduct adds that only the medical adviser
  processes health data to write a medical opinion (section 5.1.3).
- **Conclusion.** Claims processing is fundamentally permissible. The constraints are minimisation, who may see
  health data, where it is processed, and who decides.

## 3. What may leave the perimeter

| Data                                 | Needed by the external model? | Rule                                                          | Source                                                        |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| Names, contact details, bank details | No                            | Pseudonymise before any external transfer                     | Art. 5(1)(c) [GDPR-5(1)]; Art. 25 [GDPR-25(1)]; Art. 4(5)     |
| National identifiers (BSN, passport) | No                            | Never leaves; masked by the harness before BRANE              | Art. 87; national rules limiting ID numbers to legal purposes |
| Health detail                        | Only for medical steps        | Stays on the local model; a health-free fact sheet may go out | Art. 9 [GDPR-9(1)]; code of conduct 5.1                       |
| Other special categories             | Never                         | Stays local                                                   | Art. 9(1)                                                     |
| Policy terms and law                 | Yes                           | May go out as typed                                           | Not personal data                                             |

**Pseudonymisation still counts.** Pseudonymised data remain personal data for the insurer, which holds the key
(Recital 26; EDPB Guidelines 01/2025) [EDPB-01/2025]. For a recipient without means reasonably likely to re-identify,
they may not be personal data (CJEU C-413/23 P EDPS v SRB, 4 September 2025) [CJEU-C-413/23P]. The insurer therefore
still records each transfer and names the recipient in its privacy notice.

**Transfers outside the EU.** The cloud models run through OpenRouter. Where a provider processes data outside the
EEA, Chapter V applies (Art. 44, 46) [GDPR-44], [GDPR-46(1)]. Pseudonymisation lowers the risk but does not remove
the need for a transfer mechanism. The legal team confirms the processor terms (Art. 28) [GDPR-28(1)].

## 4. Who decides

- **No automated claim decisions.** Art. 22(1) gives the insured the right not to be subject to a decision based
  solely on automated processing with legal or similarly significant effects [GDPR-22(1)]. A score or recommendation
  on which a human decision depends decisively can itself be such a decision (CJEU C-634/21 SCHUFA)
  [CJEU-C-634/21]. Human involvement must be meaningful: by someone with authority and competence to change the
  outcome (WP251rev.01) [WP251].
- **Design.** The agent produces a recommendation with reasons and cited passages; the claims handler decides; any
  request to the agent to decide is refused by BRANE. The policy terms say so too [POL-5.1].
- **Medical and legal judgement.** The medical adviser answers necessity and causality questions (code of conduct
  5.1.3); a legal reviewer handles disputed wording, exclusions and suspected fraud.

## 5. The AI Act

- **Is the system high-risk?** Annex III point 5(c) lists AI used for risk assessment and pricing in life and health
  insurance [AIA-Annex3(5)]. Claims handling is not listed. EIOPA (6 August 2025) treats other AI in insurance,
  including claims management, under proportionate governance: data quality, records, transparency, human oversight
  [EIOPA-AI-2025]. The legal team decides whether our system falls under Annex III and cites the answer.
- **Either way.** The design meets the high-risk duties that matter here: human oversight by competent people
  (Art. 14) [AIA-Art14(1)], logs kept by the deployer (Art. 26) [AIA-Art26(6)], and information for the people affected.

## 6. What must never happen

| Forbidden                                                                                | Why                                                         | Source                                                                   |
| ---------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------ |
| Selecting or treating claims differently by ethnicity, origin or a proxy such as surname | Discrimination; special-category processing without a basis | Art. 9(1); EU Charter Art. 21; CJEU C-236/09 Test-Achats [CJEU-C-236/09] |
| Comparing or ranking claimants                                                           | Purpose limitation; each claim is assessed on its own       | Art. 5(1)(b) [GDPR-5(1)]; code of conduct 5.1.1                          |
| Following instructions hidden in claim documents                                         | Security of processing                                      | Art. 32 [GDPR-32(1)]; OWASP LLM01 [OWASP-LLM01]                          |
| Sending anything when the check is unavailable                                           | No transfer without a verified check                        | Art. 32; Art. 25                                                         |

## 7. How each finding becomes a rule

Each row of `submission/MAIN_Policy_Matrix.csv` turns one finding above into a BRANE category action, a semantic
category or agent code, with the header that proves it and the test that checks it. The golden set, the held-out
set and the organizers' tests run on every policy change (`node evals/qc.mjs`).

## 8. Open questions for the legal team

1. Netherlands or Germany as the insurer's home state, which fixes the Art. 9(2) exception (UAVG Art. 30 or BDSG
   § 22 with VVG § 213).
2. Whether claims handling falls under AI Act Annex III.
3. The processor terms and transfer mechanism for the cloud models behind BRANE.
4. Whether the insured must be told that an AI system prepared the recommendation (AI Act Art. 50; GDPR Art. 13)
   [AIA-Art50(1)], [GDPR-13(2)].
