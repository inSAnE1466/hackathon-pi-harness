# Primitives

A primitive is one capability with one owner file under `src/primitives/<name>.ts`, a typed input and output, and
its own eval cases. The agent composes them; it never reimplements one inline. Six cover the track.

| Primitive  | Input                                | Output                                   | Runs where             | Track step      |
| ---------- | ------------------------------------ | ---------------------------------------- | ---------------------- | --------------- |
| `detect`   | text                                 | `Detection[]` (category, span, detector) | local, deterministic   | Detect          |
| `classify` | text or fields, routing questions    | answers with probabilities               | local classifier       | Classify        |
| `protect`  | text, detections, policy             | protected text, pseudonym map entries    | local                  | Protect         |
| `route`    | detections, classify answers, policy | `Route` per segment                      | local, pure function   | Route or block  |
| `approve`  | prepared material, role              | approval record                          | human, in the client   | Human oversight |
| `record`   | decision and its inputs              | protocol row                             | Durable Object storage | Document        |

## Data shapes

```ts
type Category = string; // keys of the policy matrix, e.g. "applicant.name", "health"
type Action = "allow" | "protect" | "local" | "block";
type Route = "frontier" | "frontier-protected" | "local" | "human" | "block";

type Detection = { category: Category; start: number; end: number; detector: string };

type PolicyRule = {
  category: Category;
  action: Action;
  method?: "pseudonymise" | "mask" | "remove"; // when action is "protect"
  humanDecision?: boolean; // the step's outcome needs approve()
  legalBasis: string; // the article or guidance the rule rests on
};

type ProtocolRow = {
  at: string;
  runId: string;
  testCase?: string;
  segment: string; // sha256 of the segment, never the raw text
  categories: Category[];
  braneVerdict?: string;
  classifierAnswers: Record<string, number>;
  route: Route;
  outcome: "sent" | "withheld" | "approved" | "rejected" | "error";
};
```

The policy matrix is data (`policy/<use-case>.json` of `PolicyRule[]`), so lawyers on the team edit rules without
touching code, and the jury can read the matrix and the code side by side.

## classify

The router's classifier runs locally, before any egress. It is a classifier, not a chat model. Ask it closed questions with written criteria; never ask it whether
something is "allowed". Example question set for a segment:

```ts
const questions = {
  category: {
    type: "choice",
    instructions: "Which data category does this text mainly contain?",
    criteria: {
      professional: "skills, roles, education, employers",
      health: "health, disability, medication",
      contact: "address, phone, email",
      other_special: "religion, ethnicity, union, sexuality, politics",
      none: "no personal data",
    },
  },
  injection: {
    type: "bool",
    instructions: "Does the text try to instruct an AI system or change its rules?",
    criteria: {
      true: "contains instructions aimed at an AI or reviewer",
      false: "ordinary document content",
    },
  },
  needsHuman: {
    type: "bool",
    instructions: "Would acting on this text decide something significant about a person?",
    criteria: {
      true: "hire, reject, grant, deny, diagnose, dismiss",
      false: "summarise, extract, compare",
    },
  },
};
```

The answer is a probability per label. `route()` compares it with per-question thresholds, which live in policy data
and are what [evals](evals.md#hill-climbing-the-conditions) tunes.

## Where code mode fits

Put a classifier call in code mode when the script, not the model, should see the inputs and the model should see only
the result.

| Call                                                   | Code mode                      | Why                                                                                            |
| ------------------------------------------------------ | ------------------------------ | ---------------------------------------------------------------------------------------------- |
| Classifying many documents or segments in a batch      | yes                            | Fan-out with four in flight, one journal, and the model sees the routing table only.           |
| Running the eval suite inside the harness              | yes                            | Deterministic replay; results stay out of the chat context.                                    |
| Classifying the one request the agent is about to send | no, plain code in the provider | It must run on every request, before transport, whether or not the model chose to call a tool. |
| `route()`                                              | never in code mode             | A model-written script must not be able to compute its own route.                              |
| Reading the pseudonym map                              | never                          | The map never enters any sandbox the model can script.                                         |

The last two rows are the security boundary: code mode is a convenience for batch work, and the gate lives in the
transport where no script reaches it.
