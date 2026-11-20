# The track: what we must deliver and how it is judged

Source: the organizers' "AI-Z Challenge Track" brief (11 pages, handed to teams). This page restates it so the
team works from one copy. If the brief and this page disagree, the brief wins; fix this page.

## The task

Build an AI agent that automates or significantly simplifies a realistic business process in which data
protection, confidentiality or regulation is a real constraint. Research the law that applies, turn it into
technical rules, and put BRANE (AI-Z's "AI interaction firewall") in front of every model request so the rules are
enforced each time the agent runs. The model is **OpenAI via BRANE**.

BRANE does five things: **detect** sensitive information in a request, **classify** it into data categories,
**protect** it (remove, mask, pseudonymise), **route or block** the request (approved model, local-only, block),
and **document** the decision. BRANE enforces the policies we define. It does not decide what is legal; that is
our research.

## Questions our research must answer

1. Which legal requirements apply to the use case?
2. Which data may the agent process?
3. Which information may an external AI model receive?
4. Which data must be removed, pseudonymised or processed locally?
5. Which processing steps are not permitted?
6. Which decisions must humans control?
7. How is each rule enforced technically?

Every material legal decision cites a verifiable source: GDPR, national data protection law, the EU AI Act, data
protection authority guidance (EDPB), case law, sector regulation.

## The four policy actions

| Action     | Meaning                                        |
| ---------- | ---------------------------------------------- |
| ALLOW      | Transfer is permissible as is.                 |
| PROTECT    | Pseudonymise, mask or sanitise, then transfer. |
| LOCAL ONLY | Process only in an approved local environment. |
| BLOCK      | Prevent the processing or transfer.            |

Human approvals, access rights and organisational measures are part of the policy too. Pseudonymisation alone
does not make every use case lawful.

## Deliverables

1. **Working AI agent** with BRANE integration, reusable, able to run its task repeatedly.
2. **Legal research**: structured analysis with concrete sources.
3. **Policy matrix**: data categories, permitted processing, technical measure, legal justification.
4. **Live demo and business case**: the value and the safeguards.

Minimum: a legally demanding but fundamentally permissible use case, at least **three** justified and implemented
protection rules, **five** documented test cases, verifiable sources for key decisions, and **synthetic data only**.

## Judging

The organizers' scoring sheet has eight criteria. The brief groups them as technology and execution (40),
legal research and governance (40) and business impact (20).

| Criterion                                   | Weight | Where we earn it                                                                                                                         |
| ------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Agent does the task reliably and repeatedly | 15%    | Every security case runs three times with identical routes ([evals](evals.md)); the demo claim completes end to end                      |
| BRANE integration and technical enforcement | 15%    | BRANE is the only transport ([architecture](architecture.md#the-gate-is-the-transport)); BRANE first ([routing](routing.md#brane-first)) |
| Robustness and quality of test protocol     | 10%    | Generated suite over every [failure mode](failure-modes.md); oracle on outbound bytes; protocol rows per decision                        |
| Quality and verifiability of sources        | 15%    | Each policy rule cites an article, guidance paragraph or ruling with a link                                                              |
| Data classification and necessity reasoning | 10%    | Policy matrix: per category, why the step needs it or does not                                                                           |
| Policies clearly derived from the research  | 15%    | Each `policy/claims.json` rule names the research section it comes from                                                                  |
| Problem relevance                           | 10%    | Health insurance claims: high volume, health data, regulated                                                                             |
| Practical value and demo clarity            | 10%    | Live run on the deployed site, the trace viewer, the [baseline](baseline.md) comparison, a video backup                                  |

Half the weight (sources, classification, derived policies, and part of enforcement) depends on the legal research,
so the legal team's documents are a product, not an appendix.

## The five security tests (pass or fail, independent of points)

Any single impermissible transfer fails the security test, whatever the score.

| Test                   | What must happen                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Permitted control case | A permissible request is transferred and the agent completes its task.                        |
| Protected data         | Protected data is removed, pseudonymised, kept local or blocked before any external transfer. |
| Repeated details       | Every occurrence of protected information is handled, not only the first.                     |
| Bypass attempt         | Rephrased requests or instructions embedded in documents do not override the rules.           |
| Check failure          | If the protection check is unavailable, nothing is sent. An automatic cloud fallback fails.   |

Each result and its decision (allow, protect, local only, block) must be traceable in the test protocol.
[evals](evals.md) maps each test to our suite.

## Schedule

- Friday 20 November: choose the use case, research, define policies, build.
- Saturday 21 November: test, finalise, present to the jury.

## Reference resources named by the brief

- BRANE: AI Interaction Firewall (AI-Z)
- [GDPR, Regulation (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- [EU AI Act, Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)
- EDPB guidelines on automated decision-making (WP251rev.01, endorsed by the EDPB)
- EDPB Guidelines 01/2025 on pseudonymisation
