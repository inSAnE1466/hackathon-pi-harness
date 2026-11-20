# Run, test and deploy

## Secrets

| Name             | What                                    | Where it lives                                                                                |
| ---------------- | --------------------------------------- | --------------------------------------------------------------------------------------------- |
| `BRANE_BASE_URL` | `https://brane.ai-z.io/api/v1`          | `.dev.vars` locally; a Worker variable when deployed                                          |
| `BRANE_API_KEY`  | The team key from the organizers' email | `.dev.vars` locally (gitignored, mode 600); `wrangler secret put BRANE_API_KEY` when deployed |
| `TEAM_PASSWORD`  | Shared sign-in for the deployed site    | `wrangler secret put TEAM_PASSWORD` when deployed; not needed locally                         |

There is no OpenAI key. Every model call goes through BRANE with the team key. Never commit, print or paste a key;
`.dev.vars.example` holds the names only.

Set up once:

```sh
cp .dev.vars.example .dev.vars   # then paste the BRANE key after BRANE_API_KEY=
chmod 600 .dev.vars
```

`pnpm dev` (Vite with the Cloudflare plugin) loads `.dev.vars` into the Worker as `env.BRANE_BASE_URL` and
`env.BRANE_API_KEY`; wrangler lists them as `(hidden)`. Bare `wrangler dev` does not work here, because the assets
directory comes from the Vite build.

## Models

From the organizers' email and `GET /api/v1/models`:

| Route                  | Model                                                                    | Use                              |
| ---------------------- | ------------------------------------------------------------------------ | -------------------------------- |
| Cloud (default)        | `openrouter:anthropic/claude-haiku-5.5`, or `auto`                       | Released and pseudonymised steps |
| Cloud                  | `openrouter:openai/gpt-6-luna`, `openrouter:mistralai/mistral-large-4-0` | Alternatives                     |
| Local, no cloud egress | `vllm:deepseek-v4.1-flash` (fast default), `vllm:qwen3.8-27b-nvfp4`      | Turns BRANE keeps local          |

`policy/brane.json` names the pair we use: cloud `openrouter:anthropic/claude-haiku-5.5`, local
`vllm:deepseek-v4.1-flash`.

## Our BRANE policy

`policy/brane.json` is the source of truth for the department's policy. The workbench at
`https://brane.ai-z.io/team-policy` shows the same policy after **Load Team Policy**; an edit saved there is
overwritten by the next apply, so change the file instead.

```sh
node scripts/brane-policy.mjs diff    # compare the file with the live department
node scripts/brane-policy.mjs apply   # save the file to the live department
```

## The organizers' tests

```sh
node scripts/brane-cases.mjs          # dry run: no model call
node scripts/brane-cases.mjs --live   # also runs the model, for the output column
```

It runs T1 to T5 and our E1 to E5 through `POST /api/v1/policy/test`, applies the starter kit's pass rules plus a
check that no planted name, email, IBAN or phone number appears in the cloud payload, and writes
`submission/test_evidence_run.csv` in the template's columns. It exits non-zero when any case fails.

## Run locally

```sh
pnpm install
pnpm dev                              # http://localhost:5173
```

The demo runs from a laptop. Deploy only when the jury needs a link.

## Deploy (when needed)

The Worker deploys to the existing Cloudflare account. A shared team password stored as the `TEAM_PASSWORD` secret
guards every route; the Worker sets a cookie after sign-in. The password check is not built yet.

```sh
pnpm exec wrangler secret put BRANE_API_KEY
pnpm exec wrangler secret put TEAM_PASSWORD
pnpm deploy
```

## Inside BRANE's own system

BRANE is OpenAI-compatible, so any agent that speaks the OpenAI chat API (theirs, ours, or the Python starter) can
point at `BRANE_BASE_URL` with the team key and inherit the same policy. Our harness adds what BRANE does not do:
splitting a claim into steps, the human `consult` and `approve` routes, the check-failure rule (nothing sent when
BRANE is unreachable or its headers are missing), and the protocol.
