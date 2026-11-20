# BRANE AIF API, as used by the Gezira harness

Source: the public workbench script `https://brane.ai-z.io/team-policy.js` and the public catalog
(`docs/brane_catalog_snapshot.json`), confirmed against live responses on 20–21 Nov 2026.
Base URL `https://brane.ai-z.io/api/v1`; auth `Authorization: Bearer $BRANE_API_KEY` (team key, never commit).

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /policy/catalog` | public | 25 built-in categories, 4 actions, groups, 3 semantic templates |
| `GET /policy` | key | current team policy + `team`, `summary`, `updatedAt` |
| `PUT /policy` | key | **overwrites the whole team policy** for every teammate |
| `POST /policy/test` | key | dry run of one prompt against a draft policy; no saved-policy change |
| `POST /chat/completions` | key | OpenAI-style call; decision in `X-Brane-*` headers; HTTP 422 on refuse |
| `GET /models` | key | available models |

## Policy body (`PUT /policy`, and `draftPolicy` in `/policy/test`)
```json
{
  "routingMode": "cloud-preferred | local-preferred | local-only",
  "piiSensitivity": "low (0.60) | standard (0.50) | high (0.40)",
  "categories": {"PERSON": "allow | placeholder | local | refuse", "...": "all 25"},
  "semanticCategories": [
    {"code": "A_Z0_9", "name": "...", "description": "...", "keywords": ["..."],
     "legalBasis": "...", "action": "local | refuse", "enabled": true}
  ]
}
```
Strictest action wins: refuse (422) > local > placeholder > allow. The workbench only sends `local` or `refuse`
for semantic categories. Max 25 semantic categories.

## `POST /policy/test`
Request: `{"prompt": "...", "draftPolicy": {...}, "executeCompletion": false}`.
Response (abridged, real example):
```json
{
  "team": "Team 03",
  "decision": {"winningAction": "placeholder", "route": "cloud", "httpStatus": 200, "triggers": []},
  "detectedCategories": [{"label": "PERSON", "sampleText": " Marieke Visser", "detector": "opf",
                          "confidence": 0.9999, "action": "placeholder"}],
  "matchedSemanticCategories": [{"code": "...", "action": "local", "matchedVia": "..."}],
  "promptInjection": {"detected": false, "score": 0.815, "source": "clean"},
  "outgoingCloudPayloadPreview": "… The policyholderPERSON_REF_1 asked us to pay intoACCOUNT_NUMBER_REF_1 …",
  "simulatedHeaders": {"X-Brane-Routed-To": "cloud", "X-Brane-Action": "placeholder", "X-Brane-Redacted": "true",
                       "X-Brane-Pii-Detected": "true", "X-Brane-Pii-Types": "PERSON,ACCOUNT_NUMBER,EMAIL",
                       "X-Brane-Placeholder-Types": "PERSON,ACCOUNT_NUMBER,EMAIL"},
  "liveCompletion": null
}
```
With `executeCompletion: true`, `liveCompletion = {"status": "HTTP 200 (local · vllm:deepseek-v4.1-flash)", "preview": "..."}`.
With a draft policy `routingMode: local-only` + all categories `allow`, this runs a prompt on BRANE's internal GPU
model without touching the saved policy: the harness uses this for its own per-label classifier (`eval/run_eval.py --backend llmA|llmB`).

## Observations (product-gap material)
- Placeholder tokens are `CATEGORY_REF_n` (no brackets); the span includes the preceding space, so words get glued
  (`policyholderPERSON_REF_1`).
- IBANs are detected as `ACCOUNT_NUMBER`; company references (CLM-…, MV-POL-…, KL-…) also as `ACCOUNT_NUMBER`.
- Same value → same token across all occurrences (T3 passes: PERSON_REF_1 x4, ACCOUNT_NUMBER_REF_1 x3, EMAIL_REF_1 x2).
- `promptInjection.score` is exposed, but its threshold and action are not configurable.
