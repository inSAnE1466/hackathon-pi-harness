# Claims assistant: design

One screen for a claims handler at a European insurer. They pick a claim from the queue, let the assistant prepare
it, check how the harness routed every model request, and decide. The screen is calm and precise: an office tool,
not a showcase.

## Tokens

All values live in `tokens.css`. Components use the tokens, never raw values.

| Group   | Tokens                                                                 | Use                                           |
| ------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| Surface | `--color-page` white, `--color-tile` #f5f5f5, `--color-hairline`       | Page, selected rows and cards, 1px separators |
| Text    | `--color-ink`, `--color-secondary`, `--color-muted` (4.5:1 on white)   | Primary, supporting, metadata                 |
| Action  | `--color-primary` near black pill                                      | One primary action per region                 |
| State   | `--color-passed`, `--color-waiting`, `--color-blocked` and their tints | Always beside a text label, never alone       |
| Accent  | `--color-active` #ffe14a, the deck's yellow                            | The trace step in progress, nothing else      |
| Type    | Inter 400/500/600; 12, 14, 16, 20 px; mono for ids and categories      | Weight and colour carry hierarchy before size |
| Space   | 4 px scale: 4, 8, 12, 16, 20, 24, 32, 48                               | Tight inside groups, 24 px between groups     |
| Radius  | 6 chip, 10 tile, pill for buttons                                      | Nested radius = inner radius + padding        |
| Depth   | Borders only                                                           | No shadows except the focus ring              |

## The three regions

| Region | Width at 1440 px     | Content                                                                     |
| ------ | -------------------- | --------------------------------------------------------------------------- |
| Queue  | 280 px, 56 px folded | The fixed claims queue (`queue.ts`), one row each: type icon, title, status |
| Chat   | Flexible             | The selected claim's session: messages, decision cards, the message box     |
| Panel  | 420 px               | "How the harness decided": Trace and Audit log tabs                         |

At 1280 px and below the queue starts folded to icons; the toggle opens it. Below 1100 px the panel moves under the
chat. The header holds the product name, one line of subtitle, the policy version from `policy/brane.json` and the
synthetic-data note.

## States

| Thing        | States                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Claim status | New, In progress, Waiting on expert, Prepared, Refused, Approved, Edited, Rejected              |
| Trace node   | Not reached (hollow, muted), done (ink), active (yellow), refused (red with label)              |
| Route        | Cloud, protected (green), Local model (green), Refused (red), No decision (red)                 |
| Data         | Loading text in place of rows, an empty line with what fills it, an inline error with the cause |

The trace reads Pre-mask, Intake, BRANE, Tools, Person with fixed heights, so it fills without moving. BRANE is the
only gate. The pre-mask is pattern matching in our own code (regex and the BSN checksum, no model), so it is a small
hollow diamond with a "No model" tag at the top of the line, never a round node of the same weight; it masks the claim
before intake and every request before BRANE, and its chips are the patterns that fired. Intake is labelled
"local model inside BRANE" and its summary starts "On the pre-masked claim". A "Classifier (local model)" step has a slot
that stays hidden until the server writes `classifier` audit rows. The server's actor `gate` stays in the data; only
the labels say pre-mask.
A person's decision is a square node wherever a model step is a round one (run thread, trace). Motion draws shapes
in: a trace connector grows down once its step is passed, a used routing lane strokes from the claim to its node.
Nothing pops; reduced motion turns both off. Every button has hover, focus-visible, active and disabled styles; every control is a native button, link, input or
tab with a visible focus ring.

## Copy

Short and plain, sentence case, no em dashes. A status names where the claim is; a node names what happened.
