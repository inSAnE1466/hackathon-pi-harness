# Gezira: an insurance claims assistant behind BRANE

**Live app:** https://claims-harness.fred-755.workers.dev (password in the submission form)

Team Gezira's entry to the AI-Z Challenge Track, MAIN Summit 2026. A Pi Durable agent on Cloudflare prepares EU health
and travel insurance claims up to a human decision. Every model request goes through BRANE, and health data stays on
BRANE's local model. A claims handler decides every outcome. The decision goes back into the chat, where the agent
continues from it, and into a hash-chained audit trail. All data in this repository is synthetic.

## The four submissions

[submission/README.md](submission/README.md) indexes the policy matrix, the security test results, the audit trail
of one claim and the demo, and maps each expectation in the track brief to its evidence.

## How it works

A claim takes this path. Each step names the file that holds it.

**Pre-mask.** Before any text reaches BRANE, our code replaces names, street addresses, email addresses, phone
numbers, IBANs, BSNs, policy and claim numbers, passport numbers, licence plates and dates of birth with tokens such
as `[NAME_1]`. It is pattern matching with no model, and it covers identifiers BRANE mislabels or misses on some runs.
Each conversation keeps one token map in the session's SQLite, so a value gets the same token in every request. The
map is never part of a model request. Code: `src/primitives/detect.ts`, `src/primitives/names.ts`, `src/tokens.ts`,
and the `beforeProviderRequest` hook in `src/primitives/gate.ts`.

**Intake.** BRANE routes a whole request by its strictest category, so one health detail would keep the entire claim
on the local model. Intake asks BRANE for a dry run first. When health data would send the claim local, BRANE's local
model rewrites the medical part as a health-free fact sheet, and BRANE checks the sheet again. Only a clean sheet
replaces the medical text, so the agent's turns can use the cloud model. Code: `src/primitives/intake.ts`.

**BRANE, the only gate.** `src/brane.ts` is the only model provider. Its fetch reaches BRANE's origin only, records
every `X-Brane-*` decision, and fails the turn when BRANE is unreachable or a response has no routing header. Retries
are off, so a failed request is never resent anywhere. A refusal (HTTP 422) goes to a person as a handoff. There is no
other route to a model. The policy is `policy/brane.json`; it also names the two models, a cloud model and a local one.

**Second classifier.** A second check runs on a person's text before the agent's turn. It makes one call to
BRANE's local model with the labels in `policy/classifier.json`. It can only make a route stricter: `local` keeps the
conversation on the local model, and `refuse` withholds the text. It runs by default; the `classifier` switch
(`src/switches.ts`) turns it off for one session. Code: `src/primitives/classify.ts`.

**Tools.** `lookup` searches 223 passages of law, guidance and the synthetic insurer's policy terms
(`corpus/passages.json`) with BM25 inside the Worker, and every result has a passage id the agent cites. `web_read`
reads one public page from an allowed host through Cloudflare Browser Run and refuses a URL with personal data in it.
Code: `src/primitives/lookup.ts`, `src/primitives/rank.ts`, `src/primitives/web.ts`.

**Human handoff.** The agent never decides a claim. `consult` sends a question to the medical adviser or legal
reviewer, and `request_approval` hands a recommendation to the claims handler. The person's decision is posted to
`POST /api/sessions/:id/audit/human` and passed back into the conversation as a message, which goes through BRANE like
every other request. Code: `src/primitives/handoff.ts`, `src/session.ts`, `src/client/DecisionCard.tsx`.

**Audit log.** `src/audit.ts` writes one row per decision to the session's SQLite: each request, BRANE's decision
on every model request, the pre-mask, intake, the classifier, tool calls, handoffs and each person's decision. Every
row names its actor. The rows form a SHA-256 hash chain, so editing or deleting a row breaks every later hash. The
log never goes into a conversation and holds categories and ids, never prompt text. It is served at
`GET /api/sessions/:id/audit` (add `?format=csv` for the whole trail, or `/verify` for the chain check).

**Harness switches.** `src/switches.ts` lets an eval run change one session without a code edit: the classifier,
intake, the models, the prompt variant and the tools offered. No switch opens a route around BRANE.

## Tech stack

- Cloudflare Workers, with one Durable Object per session (`Session` in `src/session.ts`, configured in
  `wrangler.jsonc`)
- Pi Durable 1.5.2 by earendil-works, the agent harness, with its SQLite storage in the Durable Object
- React 19 with Vite 8 for the client (`src/client/`)
- BRANE for every model request; the models are named in `policy/brane.json`
- Cloudflare Browser Run for `web_read` (the `BROWSER` binding)
- TypeScript, Vitest, oxfmt
- pnpm 11 and Node 22.19 or newer

## Run and deploy

Create `.dev.vars` from the example and fill in `BRANE_BASE_URL` and `BRANE_API_KEY`. `TEAM_PASSWORD` is optional
locally; without it, the sign-in check is off. Never commit or print a value.

```sh
cp .dev.vars.example .dev.vars
chmod 600 .dev.vars
pnpm install
pnpm dev        # Worker and client together, at the URL Vite prints
pnpm check      # formatting, types, build and a deploy dry run
pnpm test       # Vitest in the Workers runtime
```

To deploy, store the three values as Worker secrets, then deploy. Each `wrangler secret put` reads the value from
standard input.

```sh
pnpm exec wrangler login
pnpm exec wrangler secret put BRANE_API_KEY
pnpm exec wrangler secret put BRANE_BASE_URL
pnpm exec wrangler secret put TEAM_PASSWORD
pnpm deploy
```

With `TEAM_PASSWORD` set, every route needs the team cookie: pages show a sign-in form and `/api/*` returns 401.

`node scripts/brane-policy.mjs diff` compares `policy/brane.json` with the live BRANE department, and `apply` saves
the file to it. `node scripts/brane-probe.mjs "text"` shows what BRANE does with one input.

## Evals

These commands produce the test proof. Each script states its options in its header comment, and
[docs/evals.md](docs/evals.md) explains how to read the results.

| Command                                                    | What it checks                                                                       | Results                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| `node scripts/brane-cases.mjs`                             | The track's tests T1 to T5 and our edge cases E1 to E5 against the live BRANE policy | `submission/test_evidence_run.csv`                     |
| `node --experimental-strip-types evals/security.mjs <url>` | The five mandatory tests on the app path, graded on the session's audit log          | `evals/security-<mode>-latest.json`                    |
| `node evals/hill.mjs <config.json>`                        | One harness configuration on the routing sets: leak rate, route macro F1, over-block | `evals/runs/<name>.json`                               |
| `node evals/legal.mjs`                                     | The lookup tool's recall@3 and MRR on hard legal questions                           | printed                                                |
| `node evals/history.mjs` then `node evals/slopes.mjs`      | Every recorded iteration, kept or reverted by rule, and the headline numbers         | `evals/climb-history.json`, `evals/climb-summary.json` |

[evals/decision-log.md](evals/decision-log.md) records each measurement and policy change behind these numbers.

## Team and credit

Frederick (harness, BRANE policy, evals), Omar Shalaby (eval design, locked test set, criminal-data rule; report in
[omar/](omar/README.md)), Alex Capizzani (hash-chained audit trail with human decision rows, macro-F1 scorer) and
Hussein (legal and business).

Built on [earendil-works/pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare) (MIT,
[LICENSE](LICENSE)).
