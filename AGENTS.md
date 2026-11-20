# AI-Z hackathon agent

A team repository for the AI-Z Challenge Track (MAIN Summit 2026, Maastricht, 20–21 November 2026). We build an
agent for a legally demanding business process, put BRANE in front of every model request, and prove with a test
protocol that no impermissible transfer happens. The code is a fork of
[earendil-works/pi-durable-cloudflare](https://github.com/earendil-works/pi-durable-cloudflare): one Pi Durable
harness in a Cloudflare Durable Object.

## Start here

1. Read [pstack](.agents/skills/pstack/SKILL.md) and pick a playbook before any change.
2. Read [docs/README.md](docs/README.md), then the doc that owns your question.
3. Run `git status` and `git log -5`. Teammates share this repository; preserve their work.

## Rules

- **Synthetic data only.** No real personal data, real company documents or real credentials anywhere: code,
  fixtures, logs, prompts or screenshots. The track disqualifies real data.
- **Never commit a secret.** The BRANE endpoint and key live in `.dev.vars` (gitignored) or Worker secrets. Never
  print them in chat, logs or the test protocol.
- **Fail closed.** No code path sends a request to a model without a successful BRANE check. No fallback to a
  direct provider route, ever. See [architecture](docs/architecture.md#the-gate-is-the-transport).
- **One owner per fact.** Each fact lives in one doc; others link to it. Docs describe the current state in the
  present tense. Git holds the history.
- **One current implementation.** Delete what you replace, including its tests and docs, in the same commit.
- Commit only the paths you changed: `git commit -m "<what changed>" -- <paths>`. Never `git add -A`.
- Prove a change on the real surface and report the command and its output.

## Checks

| Change            | Check                                                    |
| ----------------- | -------------------------------------------------------- |
| `src/` or `test/` | `pnpm check && pnpm test`                                |
| `evals/`          | `pnpm eval` (once it exists, see [evals](docs/evals.md)) |

Toolchain: Node 22.19 or newer, pnpm 11 (`npx -y pnpm@11.15.1 <cmd>` if your global pnpm is older).
