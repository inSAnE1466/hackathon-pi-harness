# Legal research: AI-assisted claims intake for an EU health and travel insurer

Each finding names its source. Every legal claim on this page was checked against the official text on 2026-11-21.
[Legal verification](legal-verification.md) gives the exact wording, the verdict and the fix for each claim.
[Sources](sources.md) lists every source and how it was read. The passage ids in brackets are the agent's own corpus
(`corpus/passages.json`), so the agent cites the same text this analysis relies on.

The setting follows the track: BRANE runs inside the insurer's own perimeter and counts as trusted; the question is
what may leave that perimeter to an external model, what must be pseudonymised first, and what stays on the local
model.

**Jurisdiction.** The insurer is a Dutch insurer offering supplementary health and travel cover, a member of the
Dutch Association of Insurers. Dutch law (UAVG) gives insurers an express health-data ground. German law does not
(section 10, question 1). Basic Dutch health insurance (Zorgverzekeringswet) has its own code of conduct, by
Zorgverzekeraars Nederland, and is out of scope.

## 1. What the agent does

It checks that a claim is complete, extracts billable items, matches them to the policy terms and prepares a
recommendation. It does not decide claims, give medical opinions or contact claimants about outcomes.

## 2. Is the processing lawful at all?

- **Personal data.** Claims hold names, contact details, bank details and identifiers. All of them are personal data
  under GDPR Art. 4(1) [GDPR-4(1)].
- **Health data.** "Data concerning health" means data "which reveal information about his or her health status"
  (Art. 4(15)) [GDPR-4(15)], including "any information on, for example, a disease, disability, ... medical
  history, clinical treatment" (Recital 35) [GDPR-R35]. Data that reveal a special category indirectly, "by means of
  an intellectual operation involving comparison or deduction", also fall under Art. 9(1) (CJEU C-184/20, para. 120
  and operative point 2) [GDPR-9(1)], [CJEU-C-184/20]. Treatment, medication, invoice lines and the treating
  hospital are therefore health data.
- **Legal basis for the claim data.** Performance of the insurance contract (Art. 6(1)(b)) [GDPR-6(1)].
- **Exception to the health-data ban.** No Art. 9(2) point fits an insurer on its own. Point (h) covers medicine,
  care and the management of health systems; point (b) covers employment and social security law; point (f) covers
  legal claims, which helps only once a claim is disputed. The working exception is national law made under
  Art. 9(2)(g) and (h) [GDPR-9(2)]: UAVG Art. 30(3)(b) lifts the ban for insurers "voor zover de verwerking
  noodzakelijk is voor ... de uitvoering van de overeenkomst van verzekering" (as far as necessary to perform the
  insurance contract) [UAVG-30(3)(b)]. The insurers' code of conduct repeats this in art. 5.1.1(b) [GVPV-5.1.1].
- **Secrecy.** UAVG Art. 30(4) requires that the data are processed only by persons bound to secrecy by office,
  profession, statutory rule or a confidentiality agreement [UAVG-30(4)]. GDPR Art. 9(3) is not the source here: it
  attaches secrecy only to point (h). The code of conduct adds that only the medical adviser processes health data to
  write a medical opinion, while claims handlers may process health data received with a claim when needed to assess
  it (art. 5.1.3) [GVPV-5.1.3].
- **Conclusion.** Claims processing is permissible. The constraints are minimisation, who may see health data,
  where it is processed, and who decides.

## 3. What may leave the perimeter

| Data                                 | Needed by the external model? | Rule                                                          | Source                                                                                                           |
| ------------------------------------ | ----------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Names, contact details, bank details | No                            | Pseudonymise before any external transfer                     | Art. 5(1)(c) [GDPR-5(1)]; Art. 25(1) [GDPR-25(1)]; Art. 4(5) [GDPR-4(5)]; Art. 32(1)(a) [GDPR-32(1)]             |
| National identifiers (BSN, passport) | No                            | Never leaves; masked by the harness before BRANE              | Art. 87 [GDPR-87]; UAVG Art. 46 [UAVG-46]; Zorgverzekeringswet Art. 86(3) [ZVW-86]                               |
| Health detail                        | Only for medical steps        | Stays on the local model; a health-free fact sheet may go out | Art. 9(1) [GDPR-9(1)]; UAVG Art. 30(3)(b), 30(4) [UAVG-30(3)(b)], [UAVG-30(4)]; code of conduct 5.1 [GVPV-5.1.3] |
| Other special categories             | Never                         | Stays local                                                   | Art. 9(1) [GDPR-9(1)]                                                                                            |
| Criminal offence data (suspects)     | No                            | Stays local                                                   | Art. 10; UAVG Arts. 31, 33(2)(a)                                                                                 |
| Policy terms and law                 | Yes                           | May go out as typed                                           | Not personal data (Art. 4(1))                                                                                    |

Keeping health data on the local model goes beyond the legal minimum. A cloud processor whose staff are bound to
confidentiality (Art. 28(3)(b)) [GDPR-28(3)] could meet UAVG Art. 30(4). We keep health data local because it avoids
a transfer of health data outside the EEA and because BRANE's local route is the strongest control we can show.

**Pseudonymisation still counts.** Pseudonymised data "which could be attributed to a natural person by the use of
additional information should be considered to be information on an identifiable natural person" (Recital 26)
[GDPR-R26]. The EDPB adds that this "also holds true if pseudonymised data and additional information are not in the
hands of the same person" (Guidelines 01/2025, executive summary; consultation version) [EDPB-01/2025]. The Court of
Justice takes a narrower view for recipients: pseudonymised data are not personal data "in all cases and for every
person" (C-413/23 P EDPS v SRB, para. 86), but only where the recipient cannot lift the measures and cannot
re-identify "by recourse to other means of identification such as cross-checking with other factors" (para. 77)
[CJEU-C-413/23P]. Breyer (C-582/14) counts means a party can lawfully obtain through a third party [CJEU-C-582/14].
For the insurer the data stay personal, and the duty to name recipients is assessed "at the time of collection of the
data and from the point of view of the controller" (C-413/23 P, para. 111). The insurer therefore names the model
providers as recipients in its privacy notice (Art. 13(1)(e)) [GDPR-13(1)] and records the transfer in its record of
processing (Art. 30(1)(d) and (e)) [GDPR-30(1)].

**Transfers outside the EU.** A cloud model outside the EEA is a third-country transfer under Chapter V (Art. 44)
[GDPR-44]. Pseudonymisation lowers the risk but does not remove that. The vendor contract is out of scope here
(section 10, question 3); the routing rules keep health data off the cloud either way.

## 4. Who decides

- **The rule.** Art. 22(1) gives the insured "the right not to be subject to a decision based solely on automated
  processing, including profiling, which produces legal effects ... or similarly significantly affects him or her"
  [GDPR-22(1)]. The Court reads it as "a prohibition in principle" (C-634/21 SCHUFA, para. 52). A score is itself
  such a decision "where a third party ... draws strongly on that probability value" (operative part)
  [CJEU-C-634/21].
- **Could the law allow automated claims decisions?** Partly. The contract exception in Art. 22(2)(a) covers a
  decision "necessary for entering into, or performance of, a contract" [GDPR-22(2)], and the Dutch code of conduct
  accepts it for insurance decisions (art. 4.2.2) [GVPV-4.2.2]. The controller must show the automation is
  necessary, "taking into account whether a less privacy-intrusive method could be adopted" (WP251rev.01, p. 23)
  [WP251]. Art. 22(3) then still requires "at least the right to obtain human intervention ..., to express his or her
  point of view and to contest the decision" [GDPR-22(3)]. The Dutch national exception, UAVG Art. 40, covers only
  legal obligations and public-interest tasks, so it does not help a private insurer [UAVG-40].
- **Why we keep a human anyway.** A claim decision on a medical claim rests on health data. Art. 22(4) bars
  automated decisions based on special categories "unless point (a) or (g) of Article 9(2) applies" [GDPR-22(4)].
  Point (a) is explicit consent, which we do not use. Whether UAVG Art. 30(3)(b) counts as point (g) for this purpose
  is untested, because it also rests on point (h). Keeping a person in the decision avoids the question. It also
  matches POL-5.1 [POL-5.1] and the code's split between the medical adviser's advice and the handler's decision.
- **Meaningful involvement.** "The controller cannot avoid the Article 22 provisions by fabricating human
  involvement." Oversight must be "meaningful, rather than just a token gesture", by "someone who has the authority
  and competence to change the decision" who considers "all the relevant data" (WP251rev.01, p. 21) [WP251].
- **Design.** The agent produces a recommendation with reasons and cited passages; the claims handler decides; any
  request to the agent to decide is refused by BRANE. Because SCHUFA turns on whether the decision-maker "draws
  strongly" on the output, the handler sees the evidence and the cited passages, not only the recommendation, and
  the audit log records each override.
- **Medical and legal judgement.** The medical adviser answers necessity and causality questions (code of conduct
  5.1.3) [GVPV-5.1.3]; a legal reviewer handles disputed wording, exclusions and suspected fraud.

## 5. The AI Act

The AI Act was amended by Regulation (EU) 2026/1744 (Digital Omnibus on AI, OJ 24 July 2026, in force 27 July 2026).
The provisions below were checked against the consolidated text of 27 July 2026. Annex III and Arts. 12, 14, 19, 26
and 86 are unchanged. Art. 4 (AI literacy) was replaced. Under Art. 113 as amended, the high-risk duties for Annex III
systems apply from 2 December 2027. The agent's corpus still holds the 2024 Official Journal text; for the passages
it cites the two texts match.

- **Is the system high-risk?** No, on our reading. Annex III point 5(c) lists "AI systems intended to be used for
  risk assessment and pricing in relation to natural persons in the case of life and health insurance"
  [AIA-Annex3(5)]. That is underwriting and pricing, not claims handling. Point 5(a) covers eligibility for public
  assistance benefits decided "by public authorities or on behalf of public authorities", which a private
  supplementary insurer is not. EIOPA reads 5(c) the same way and treats claims management as AI that is not
  high-risk (EIOPA-BoS-25-360, paras. 2.1, 2.4 to 2.6) [EIOPA-AI-2025]. Section 10, question 2 gives the full answer
  and the line we must not cross.
- **What applies today.** Art. 4 (AI literacy: staff using the system are trained), Art. 50(1) only if the system
  talks to the insured directly (it does not), and EIOPA's proportionate governance: data governance, record
  keeping, transparency, human oversight (para. 3.7) [EIOPA-AI-2025].
- **High-risk duties as a benchmark.** The design also meets the high-risk duties that would matter if a supervisor
  disagreed: effective human oversight (Art. 14(1) and 14(4)(b) on automation bias, 14(4)(d) on the power to
  "disregard, override or reverse the output") [AIA-Art14(1)], [AIA-Art14(4)], oversight by people with "the
  necessary competence, training and authority" (Art. 26(2)) [AIA-Art26(2)], and logs kept for at least six months
  (Art. 26(6)) [AIA-Art26(6)].

## 6. Auditability

Record-keeping is required whichever way the AI Act question in section 5 is settled:

- **GDPR, binding now.** The controller "shall be responsible for, and be able to demonstrate compliance with"
  the principles (Art. 5(2)) [GDPR-5(2)], and keeps a record of processing activities naming purposes, recipients
  and third-country transfers (Art. 30(1)) [GDPR-30(1)]. The per-claim audit log is evidence for both. It is not the
  Art. 30 record itself, which is a register kept per processing activity.
- **AI Act, as a benchmark.** High-risk systems "shall technically allow for the automatic recording of events
  (logs)" (Art. 12(1)) [AIA-Art12(1)], [AIA-Art12(2)]. Deployers keep those logs for "at least six months"
  (Art. 26(6)) [AIA-Art26(6)]; providers do the same (Art. 19(1)) [AIA-Art19(1)]. These bind only high-risk systems.
- **EIOPA (2025).** "Documentation and record keeping" is one of the six governance areas for AI in insurance
  (para. 3.7); records of data and methods support "reproducibility and traceability" (para. 3.23) [EIOPA-AI-2025].

**Design.** Every automated step writes one row to the audit log in the claim's Durable Object: BRANE's routing
decision and its categories, identifiers masked by the gate, the intake split, cited passages, and each handoff to a
person. The log stores categories and ids, never prompt text, so it is itself minimised. It is shown in the claims
app and exported as CSV, and it is never returned to the model.

## 7. Is a DPIA required?

Yes. Triage method: [claude-for-legal privacy use-case triage](https://github.com/anthropics/claude-for-legal)
[METHOD-PRIVACY-TRIAGE]. Classification: **DPIA MANDATORY.**

- Art. 35(1) requires a DPIA where processing, "in particular using new technologies", is "likely to result in a
  high risk" [GDPR-35(1)]. Art. 35(3)(b) names "processing on a large scale of special categories of data"
  [GDPR-35(3)].
- The Dutch supervisory authority's list under Art. 35(4) [GDPR-35(4)] names, as item 7, "Grootschalige verwerkingen
  van gegevens over gezondheid", with insurers as an example (Staatscourant 2019, 64418) [AP-DPIA-7]. An insurer's
  claims department processes health data at large scale, so the trigger is met.
- Strong indicators also present: new technology (language models), data that could enable discrimination, and a
  cloud recipient outside the EEA.
- The insurers' code requires the insurer to decide on a DPIA before a new category of health-data processing
  (art. 5.1.2).
- What the DPIA must cover for this system: the health-data split between local and cloud models, the human
  decision point and automation bias, BRANE detection gaps found in testing
  ([decisions](decisions.md)), and retention of the audit log.

## 8. What must never happen

| Forbidden                                                                                | Why                                                                                     | Source                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Selecting or treating claims differently by ethnicity, origin or a proxy such as surname | Direct or indirect discrimination; inferring ethnic origin is special-category data     | Directive 2000/43/EC Arts. 2, 3(1)(h) [RED-2000/43-2]; EU Charter Art. 21; Art. 9(1) with C-184/20 [CJEU-C-184/20]; Recital 71 [GDPR-R71] |
| Treating claims differently by sex                                                       | Equal treatment in insurance premiums and benefits                                      | CJEU C-236/09 Test-Achats [CJEU-C-236/09]                                                                                                 |
| Comparing or ranking claimants                                                           | Purpose limitation; health data is processed only as needed for this insurance contract | Art. 5(1)(b) [GDPR-5(1)]; UAVG Art. 30(3)(b) [UAVG-30(3)(b)]; code of conduct 5.1.1(b) [GVPV-5.1.1]                                       |
| Following instructions hidden in claim documents                                         | Integrity of processing systems                                                         | Art. 32(1)(b) [GDPR-32(1)]; OWASP LLM01 [OWASP-LLM01]                                                                                     |
| Sending anything when the check is unavailable                                           | No transfer without the safeguards built in                                             | Art. 25(1) [GDPR-25(1)]; Art. 32(1)(b); Art. 44 [GDPR-44]                                                                                 |

## 9. How each finding becomes a rule

Each row of `submission/MAIN_Policy_Matrix.csv` turns one finding above into a BRANE category action, a semantic
category or agent code, with the header that proves it and the test that checks it. The golden set, the held-out
set and the organizers' tests run on every policy change (`node evals/qc.mjs`).

## 10. Answers to the open questions

1. **Netherlands or Germany: the Netherlands.** UAVG Art. 30(3)(b) gives insurers a statutory ground for health
   data needed to perform the insurance, with secrecy under Art. 30(4) [UAVG-30(3)(b)], [UAVG-30(4)]. The 2024 code
   of conduct turns this into roles that match our design: medical adviser, claims handler, no reuse across policies
   [GVPV-5.1.1], [GVPV-5.1.3]. Germany has no insurer ground in BDSG § 22 [BDSG-22]; German insurers rely on explicit
   consent (Art. 9(2)(a)), and VVG § 213 adds consent for health data collected from doctors and hospitals
   [VVG-213]. Consent-based health processing fits a fail-closed design badly, because a withdrawn consent must stop
   processing. Germany does offer one thing the Netherlands lacks: BDSG § 37 allows automated insurance decisions
   that grant a claim in full or apply binding medical fee schedules [BDSG-37]. We do not need that, since a person
   decides every claim.
2. **Does claims handling fall under Annex III? No, with one line we must not cross.** Point 5(c) covers "risk
   assessment and pricing" in life and health insurance [AIA-Annex3(5)]. Recital 58 explains the concern as access to
   cover and its price, "including financial exclusion and discrimination". Claims handling under an existing
   contract is neither. EIOPA lists claims management among the uses its opinion covers, and that opinion covers only
   AI that is not high-risk (paras. 2.1, 2.5, 2.6) [EIOPA-AI-2025]. The line: if the agent's output fed underwriting,
   renewal, premium loading or a decision to cancel cover, it would be risk assessment for 5(c). The
   `CLAIM_OUTCOME_DECISION` rule refuses "cancel a policy" requests, and one claim per conversation stops claim data
   from flowing into risk assessment. Even inside Annex III, Art. 6(3)(d) would exempt "a preparatory task to an
   assessment", unless the system profiles natural persons [AIA-Art6(3)]. If a supervisor disagreed, the high-risk
   duties would apply from 2 December 2027 (Art. 113 as amended).
3. **Cloud model vendor terms.** Out of scope for this analysis. The research covers how an insurer handles claims
   with an AI assistant; which contract the insurer signs with its model vendor (a processor agreement under Art. 28,
   a transfer mechanism under Chapter V) is a procurement step that does not change the routing rules. In the
   hackathon, BRANE is the only model endpoint and holds the provider access.

4. **Must the insured be told an AI prepared the recommendation?**
   - AI Act Art. 50(1): no. It applies to "AI systems intended to interact directly with natural persons"
     [AIA-Art50(1)]. Only claims staff use our agent. If a chatbot later talked to claimants, Art. 50(1) would apply.
   - AI Act Art. 26(11) and Art. 86: these apply only to high-risk Annex III systems [AIA-Art26(11)],
     [AIA-Art86(1)], so not to ours.
   - GDPR Arts. 13(2)(f), 14(2)(g) and 15(1)(h): the duty to explain "the existence of automated decision-making ...
     referred to in Article 22(1) and (4)" applies "at least in those cases" [GDPR-13(2)], [GDPR-14(2)],
     [GDPR-15(1)]. Since a person decides, the strict duty does not apply.
   - Transparency still applies. Art. 5(1)(a) requires fair and transparent processing. The privacy notice must name
     the purposes and recipients (Art. 13(1)(c) and (e)), which includes the model providers. EIOPA expects insurers to
     clarify, on request, "the influence of the AI system on the decision" (para. 3.28) [EIOPA-AI-2025].
   - Recommendation: say in the privacy notice and the claim decision letter that an AI tool prepares a
     recommendation, that a claims handler decides, and that the insured may ask for the reasons and contest the
     decision. POL-5.1 already promises the last part [POL-5.1].
