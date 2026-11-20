# Primitives

A primitive is one capability in one file under `src/primitives/<name>.ts`, with a typed input and output and its
own eval cases. The agent composes them and never reimplements one inline.

| Primitive | Input                                 | Output                                                      | Runs where             | Track step                |
| --------- | ------------------------------------- | ----------------------------------------------------------- | ---------------------- | ------------------------- |
| `brane`   | raw text, policy id                   | verdict, categories, protected text                         | BRANE                  | Detect, classify, protect |
| `decide`  | claim step text                       | BRANE dry-run detections, semantic matches, injection score | BRANE `/policy/test`   | Classify                  |
| `route`   | verdict, probabilities, policy matrix | `Route` per step                                            | local, pure function   | Route or block            |
| `consult` | minimised case, expert role           | expert opinion record                                       | human, in the client   | Human oversight           |
| `approve` | recommendation, sources               | outcome record with approver                                | human, in the client   | Human oversight           |
| `isolate` | claim id                              | a fresh Pi conversation with no shared memory               | Pi Durable config      | Purpose limitation        |
| `record`  | a decision and its inputs             | protocol row                                                | Durable Object storage | Document                  |

## Data shapes

```ts
type Category = string; // keys of the policy matrix, e.g. "claimant.name", "health.diagnosis"
type Action = "allow" | "protect" | "local" | "block";
type Route = "frontier" | "frontier-protected" | "local" | "consult" | "block";

type Verdict = {
  action: Action;
  categories: Category[];
  protectedText?: string;
  payloadHash: string;
};

type PolicyRule = {
  category: Category;
  action: Action;
  method?: "pseudonymise" | "mask" | "remove";
  consult?: "medical" | "legal";
  legalBasis: string; // the article or guidance the rule rests on
};

type ProtocolRow = {
  at: string;
  claimId: string;
  testCase?: string;
  payloadHash: string; // never the raw text
  categories: Category[];
  verdict: Action | "error";
  answers: Record<string, number>;
  route: Route;
  outcome: "sent" | "withheld" | "consulted" | "approved" | "rejected" | "error";
  actor?: string; // the human role for consult and approve
};
```

The policy matrix is data (`policy/claims.json`, a list of `PolicyRule`), so the legal team edits rules without
touching code, and the jury can read the matrix and the code side by side.

## decide

BRANE exposes no Decisions endpoint, so `decide` reads BRANE's own dry run (`POST /api/v1/policy/test`): each
detected category with its detector and confidence, the matched semantic categories, and the prompt-injection
score ([brane](brane.md)). Raw claim text then reaches no service other than BRANE. Our own questions become
semantic categories in BRANE's policy, so BRANE's internal GPU model answers them:

| Semantic category           | Asks                                                                                         | Action                                       |
| --------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `CLAIM_HEALTH_CONTEXT`      | Indirect health detail: symptoms, therapy, medication, sick leave, without a named diagnosis | `local`                                      |
| `CLAIM_OUTCOME_DECISION`    | A request to pay, reduce, deny or reject a claim, or send that decision                      | `refuse`, so the harness routes to `approve` |
| `CROSS_CLAIMANT_COMPARISON` | Comparing or ranking several claimants' records                                              | `refuse`                                     |
| `PROTECTED_TRAIT_PROFILING` | Selecting claims by ethnicity, religion, nationality or a proxy such as surname              | `refuse`                                     |

`route()` reads the dry run's decision and these matches, and applies our own floors to the confidences: a health
detection below its floor still routes `local`, failing safe as in the routing tiers.

## Where code mode fits

| Call                                       | Code mode | Why                                                                           |
| ------------------------------------------ | --------- | ----------------------------------------------------------------------------- |
| Running `decide` over many claim documents | yes       | Fan-out with four in flight, journaled; the model sees the routing table only |
| Running the eval suite inside the harness  | yes       | Deterministic replay; results stay out of the chat context                    |
| The `brane` call on each outbound request  | no        | It is the transport itself and runs on every request                          |
| `route()`                                  | never     | A model-written script must not compute its own route                         |
| The pseudonym map                          | never     | Re-identification stays outside every sandbox                                 |
