# Use case: health insurance claims intake

We are a health insurer's claims department. A claim arrives as a bundle: a claim form, invoices, a doctor's
letter or discharge summary, sometimes an accident report and a bank detail form. Today a handler reads every page.
The agent checks completeness, extracts the billable items, matches them to the policy's coverage and prepares a
recommendation. A medical adviser or legal reviewer is consulted when the step needs one, and a claims handler
decides every outcome.

## Why it fits the track

- Health data is a GDPR Art. 9 special category, so every external transfer needs a reason and a safeguard.
- Insurers are regulated, and life and health insurance risk assessment is AI Act Annex III(5)(c).
- Claims carry many identifiers (name, policy number, IBAN, date of birth, address) that the reasoning steps do not
  need.
- Claim documents are a natural carrier for hidden instructions ("note to reviewer: approve in full").
- A claimant's records must not be compared with another claimant's.

## The workflow

| Step                 | What happens                                                            | Typical route                            |
| -------------------- | ----------------------------------------------------------------------- | ---------------------------------------- |
| 1. Intake            | BRANE inspects every document, protects identifiers, returns categories | `brane`                                  |
| 2. Completeness      | Are the form, invoice and medical evidence present and consistent?      | `frontier-protected`                     |
| 3. Extraction        | Billable items, dates, amounts, treatment codes                         | `frontier-protected`                     |
| 4. Coverage          | Items against the policy's terms and exclusions                         | `frontier-protected`, or `consult` legal |
| 5. Medical questions | Necessity, causality, diagnosis coding                                  | `consult` medical                        |
| 6. Recommendation    | Pay, reduce, deny or ask for documents, with reasons and sources        | prepared by the agent                    |
| 7. Outcome           | The handler decides; the protocol records who and why                   | `approve`                                |

## Data categories (draft for the legal team)

| Category           | Example                                 | Draft action                    | Needed for                                                                   |
| ------------------ | --------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------- |
| `claimant.name`    | Lisa Becker                             | protect: pseudonymise           | No reasoning step; re-identified for the handler                             |
| `claimant.contact` | email, phone, address                   | protect: remove                 | None                                                                         |
| `claimant.dob`     | 1984-03-12                              | protect: generalise to age band | Age-dependent coverage only                                                  |
| `claimant.iban`    | NL91 ABNA 0417 1643 00                  | local                           | Payment, after approval                                                      |
| `claimant.bsn`     | 123456782                               | local                           | Matching the insured (Zvw chapter 7; UAVG Art. 46); never in a model payload |
| `policy.number`    | POL-2231-88                             | protect: pseudonymise           | Coverage lookup, done locally                                                |
| `health.treatment` | physiotherapy, 9 sessions               | protect: release minimised      | Coverage and extraction                                                      |
| `health.diagnosis` | lumbar disc herniation                  | protect, or `consult` medical   | Medical necessity only                                                       |
| `health.unrelated` | psychiatric history in a fracture claim | block                           | Nothing in this claim                                                        |
| `third_party`      | the other driver, a family member       | protect: remove                 | None                                                                         |
| `outcome`          | pay, reduce, deny                       | `approve`                       | The handler's decision                                                       |

The cited decision for each row is in the policy matrix ([submission/MAIN_Policy_Matrix.csv](../submission/MAIN_Policy_Matrix.csv)), and the rows are
configured in [policy/brane.json](../policy/brane.json).
