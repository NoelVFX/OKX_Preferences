# AI Digital Population simulations

**Permissions:** `balance:read`, `simulation:estimate`, `simulation:run`, `simulation:read`
**Requires:** a saved `survey_id` ([surveys.md](surveys.md))
**Pricing:** shorter `"2.49"` / standard `"3.99"` / follow-up `"1.99"` — [pricing.md](pricing.md)

```bash
export PAI_API_BASE="${PAI_API_BASE:-https://dashboard.preferencesai.io/api/v1}"
CURL_AUTH=(-H "X-API-Key: $PREFERENCES_AI_API_KEY")
```

## Endpoints

| Method      | Path                                       | Scope                 |
| ----------- | ------------------------------------------ | --------------------- |
| POST        | `/simulations/estimate-cost`               | `simulation:estimate` |
| POST        | `/simulations`                             | `simulation:run`      |
| GET         | `/simulations`                             | `simulation:read`     |
| GET         | `/simulations/:id`                         | `simulation:read`     |
| GET         | `/simulations/:id/status`                  | `simulation:run`      |
| POST/DELETE | `/simulations/:id/share-link`              | `simulation:read`     |
| POST        | `/simulations/:id/follow-up/estimate-cost` | `simulation:estimate` |
| POST        | `/simulations/:id/follow-up`               | `simulation:run`      |
| GET         | `/simulations/:id/follow-ups`              | `simulation:read`     |

## Estimate (non-charging)

Pass `survey_id` (preferred) or `question_count` so SKU matches the run. Unknown count → `complex_survey` (`"3.99"`).

```bash
curl -sS -X POST "$PAI_API_BASE/simulations/estimate-cost" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "population_query": "Adults 25-45 in the UK interested in technology",
    "confidence_level": 0.95,
    "margin_of_error": 0.05,
    "survey_id": "'"$SURVEY_ID"'"
  }' | python3 -m json.tool
```

Note `pai_cost`, `catalog_sku`, `respondents` (FPC may lower sample). `AUDIENCE_TOO_NARROW` → broaden query.

## Run (paid)

1. `GET /balance` — `pai_balance` ≥ estimate `pai_cost`
2. Autonomous agents: confirm spend
3. Submit (no client cost field):

```bash
curl -sS -X POST "$PAI_API_BASE/simulations" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "survey_id": "'"$SURVEY_ID"'",
    "population_query": "Adults 25-45 in the UK interested in technology",
    "desired_respondent_count": 292,
    "confidence_level": 0.95,
    "margin_of_error": 0.05,
    "label": "Q3 Brand Perception"
  }' | python3 -m json.tool
```

Expect **202** with `id`, `pai_cost`, `billing_source`. Save `id` as `SIMULATION_ID`.

## Poll and retrieve

```bash
curl -sS "$PAI_API_BASE/simulations/${SIMULATION_ID}/status" "${CURL_AUTH[@]}" | python3 -m json.tool
# 10–30s until completed | failed (check pai_refunded on paid failure)

curl -sS "$PAI_API_BASE/simulations/${SIMULATION_ID}" "${CURL_AUTH[@]}" | python3 -m json.tool
# insights / analysis / charts only when status === completed
```

List: `GET /simulations?status=completed&survey_id=…`

## Share (completed)

```bash
curl -sS -X POST "$PAI_API_BASE/simulations/${SIMULATION_ID}/share-link" "${CURL_AUTH[@]}" | python3 -m json.tool
```

Copy `data.share_url` from the response and fetch the LLM-friendly report
companion (no API key is needed for this public capability URL):

```bash
export SHARE_URL="https://dashboard.preferencesai.io/report/<share_code>"
curl -fsSL "${SHARE_URL}?format=markdown"
```

Use this Markdown export to understand the report structure and narrative, then
co-interpret it with `GET /simulations/:id` for exact values, IDs, respondent
counts, and machine-readable evidence. Treat the share URL as public once
distributed; revoke it when it should no longer be accessible.

## Follow-up

**Eligibility:** parent `completed`, has `engine_trace_id`, ≥ **5** respondents.

```bash
curl -sS -X POST "$PAI_API_BASE/simulations/${SIMULATION_ID}/follow-up/estimate-cost" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "sampling_strategy": "all_respondents",
    "focus_areas": ["deep_dive", "rationale"],
    "follow_up_brief": "Explore purchase drivers in more depth",
    "complexity": "complex"
  }' | python3 -m json.tool

# Confirm pai_balance >= "1.99", then:
curl -sS -X POST "$PAI_API_BASE/simulations/${SIMULATION_ID}/follow-up" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "sampling_strategy": "all_respondents",
    "focus_areas": ["deep_dive", "rationale"],
    "follow_up_brief": "Explore purchase drivers in more depth",
    "desired_respondent_count": 385,
    "label": "Wave 2"
  }' | python3 -m json.tool

curl -sS "$PAI_API_BASE/simulations/${SIMULATION_ID}/follow-ups" "${CURL_AUTH[@]}" | python3 -m json.tool
```

Focus areas include e.g. `deep_dive`, `rationale`, `pricing`, `messaging`, `adoption`
(see the Dashboard API docs for the full enum).

## Interpret

[interpret-results.md](interpret-results.md) · recipes [combinations.md](combinations.md)
