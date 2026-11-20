# BRANE

What BRANE is and does, from the organizers' starter kit (`MAIN_Participant_Starter_Kit.zip`: README, Python
starter, policy matrix and five-tests CSV templates) and from reading the live API with our team key. Our team is
**Team 03** (name Gezira), department `0aa4a8bc-f0a5-4688-a891-e7f63a6ac4f3`.

The endpoint and key live in `.dev.vars` (gitignored) as `BRANE_BASE_URL` and `BRANE_API_KEY`. Never commit or
print the key. Synthetic data only.

## Endpoints

| Method and path                 | Auth | Does                                                                                                                                                                                                                   |
| ------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/models`            | key  | Lists models: cloud `openrouter:anthropic/claude-haiku-5.5` (default for `auto`), `openrouter:openai/gpt-6-luna`, `openrouter:mistralai/mistral-large-4-0`; local `vllm:deepseek-v4.1-flash`, `vllm:qwen3.8-27b-nvfp4` |
| `GET /api/v1/policy/catalog`    | none | 25 built-in categories in 6 groups, 4 actions, the open baseline, 3 semantic templates                                                                                                                                 |
| `GET /api/v1/policy`            | key  | Our department's policy                                                                                                                                                                                                |
| `PUT /api/v1/policy`            | key  | Replace it: `routingMode`, `piiSensitivity`, `categories`, `semanticCategories`                                                                                                                                        |
| `POST /api/v1/policy/test`      | key  | Dry run of a prompt: detections with detector and confidence, semantic matches, prompt-injection score, the exact cloud payload, simulated headers; `executeCompletion: true` also runs the model                      |
| `POST /api/v1/chat/completions` | key  | OpenAI-compatible chat; BRANE applies the policy, routes, and returns `X-Brane-*` headers                                                                                                                              |

There is no Decisions endpoint (`POST /api/v1/decisions` returns 404) and no public API reference (`/api/docs`
needs a browser session). The policy workbench is `https://brane.ai-z.io/team-policy`.

## Policy

- **Routing mode:** `cloud-preferred`, `local-preferred` or `local-only`.
- **PII sensitivity:** `low`, `standard` or `high`.
- **Per-category action**, one of four, ranked; when several categories appear in one request the strictest wins:

| Action        | Rank | Route   | Effect                                                                             |
| ------------- | ---- | ------- | ---------------------------------------------------------------------------------- |
| `allow`       | 0    | cloud   | Sent as typed                                                                      |
| `placeholder` | 1    | cloud   | Replaced with `<PERSON_1>` and so on before the cloud call, restored in the answer |
| `local`       | 2    | local   | The whole turn runs on BRANE's internal GPU model; nothing reaches the cloud       |
| `refuse`      | 3    | refused | HTTP 422 `policy_violation` before any model runs                                  |

- **Semantic categories:** up to 25, each with `code`, `name`, `description` (judged by BRANE's internal GPU model),
  optional `keywords`, `legalBasis` and an action of `local` or `refuse`. They catch meaning that the detectors miss.

### The 25 built-in categories

| Group       | Categories                                                                                                                        | Detectors                      |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Contact     | `PERSON`, `EMAIL`, `PHONE`, `ADDRESS`, `IP_ADDRESS`                                                                               | Presidio, GLiNER, OPF, regex   |
| Company     | `ORG`, `TRADE_REGISTER`, `VAT_ID`                                                                                                 | GLiNER, Presidio, regex        |
| Civil IDs   | `DATE_OF_BIRTH`, `SSN`, `PASSPORT`, `TAX_NUMBER`, `INSURANCE_NUMBER`                                                              | regex, Piiranha, GLiNER        |
| Financial   | `IBAN`, `CREDIT_CARD`, `ACCOUNT_NUMBER`                                                                                           | regex, Presidio, OPF, Piiranha |
| Credentials | `PASSWORD`, `SECRET_KEY`                                                                                                          | regex, GLiNER, OPF             |
| GDPR Art. 9 | `HEALTH_DATA`, `ETHNIC_ORIGIN`, `POLITICAL_OPINION`, `RELIGIOUS_BELIEF`, `SEXUAL_ORIENTATION`, `TRADE_UNION`, `SENSITIVE_CONTEXT` | GLiNER, regex, OPF             |

All 25 start at `allow`, so the open baseline fails T2, T3 and T5 until we set a policy. The workbench has a
one-click 17-category floor preset.

## Response headers on chat completions

`X-Brane-Routed-To` (`cloud`, `local`, `refused`), `X-Brane-Action`, `X-Brane-Redacted`, `X-Brane-Pii-Detected`,
`X-Brane-Pii-Types`, `X-Brane-Placeholder-Types`, `X-Brane-Allowed-Types`, `X-Brane-Semantic-Matches`,
`X-Brane-Local-Cause` (`data_category_local`, `semantic_category_local`, `prompt_injection_local`, and others),
`X-Brane-Refused-By` (`category:PASSWORD->refuse`, `semantic:...->refuse`), `X-Brane-Model-Resolved`.

These headers are the evidence column of the five-tests CSV and the raw data of the trace viewer.

## What we observed

A dry run on the open baseline with a synthetic claim ("Sanne Bakker", an email, a Dutch IBAN, burnout,
depression, sertraline):

| Finding                                                                                               | Consequence                                                                                                         |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `PERSON` 0.92 (OPF), `EMAIL` 1.0 (Presidio), the IBAN labeled `ACCOUNT_NUMBER` 0.99 (OPF), not `IBAN` | Set `IBAN` and `ACCOUNT_NUMBER` to the same action, or a Dutch IBAN slips through under the other label             |
| `HEALTH_DATA` caught "depression" (regex, 0.88) but not "burnout" or "sertraline"                     | Built-in detection misses indirect health and medication; a semantic category for claims health context is required |
| Prompt-injection score 0.005 on clean text                                                            | BRANE scores injection itself and can route it local (`prompt_injection_local`)                                     |
| The preview showed the raw text leaving, because everything was `allow`                               | `/policy/test` shows the exact cloud payload, so the leak oracle can check it without a model call                  |

## What this changes in our design

- **The router's classifier is BRANE's own output.** `/policy/test` returns per-category confidences, semantic
  matches and an injection score, so `decide` reads those instead of calling OpenAI Decisions, which BRANE does not
  expose. Raw data then reaches no service other than BRANE.
- **Local is a real route.** BRANE's local models (`vllm:*`) process a turn with no cloud egress, which is the
  routing tiers' Tier 2.
- **Refuse is a real route.** HTTP 422 before any model runs, which is Tier 4.
- **Granularity is per request, not per span.** The strictest category decides for the whole turn. To keep the
  useful part of a claim on the cloud while health detail stays local, our harness splits a claim into steps and
  sends each step as its own request.
- **Check failure (T5)** is ours to enforce: if BRANE is unreachable or returns no `X-Brane-*` headers, the harness
  sends nothing. BRANE cannot test its own absence.
