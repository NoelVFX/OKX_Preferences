# Surveys, responses, analytics, and deployment

**Permissions:** `surveys:build|create|read|update|deploy|suspend`, `responses:read`, `analytics:read|run`
**Pricing:** building and self-distributed links do not use catalog PAI — [pricing.md](pricing.md)

```bash
export PAI_API_BASE="${PAI_API_BASE:-https://dashboard.preferencesai.io/api/v1}"
CURL_AUTH=(-H "X-API-Key: $PREFERENCES_AI_API_KEY")
```

## Endpoints

| Method      | Path                                | Scope                             |
| ----------- | ----------------------------------- | --------------------------------- |
| POST        | `/surveys/build`                    | `surveys:build`                   |
| GET/POST    | `/surveys`                          | `surveys:read` / `surveys:create` |
| GET/PUT     | `/surveys/:id`                      | `surveys:read` / `surveys:update` |
| GET         | `/surveys/:id/responses`            | `responses:read`                  |
| POST        | `/surveys/:id/analytics/run`        | `analytics:run`                   |
| GET         | `/surveys/:id/analytics`            | `analytics:read`                  |
| POST/DELETE | `/surveys/:id/analytics/share-link` | `analytics:read`                  |
| POST        | `/surveys/:id/deploy`               | `surveys:deploy`                  |
| POST        | `/surveys/:id/suspend`              | `surveys:suspend`                 |

## AI survey builder

```bash
curl -sS -X POST "$PAI_API_BASE/surveys/build" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "survey_prompt": "Create a product-market fit survey for a B2B analytics platform",
    "survey_type": "product_market_fit",
    "languages": ["English (US)"],
    "output_format": "json"
  }' | python3 -m json.tool
```

Synchronous (often 3–10s). Returns `data.survey_content` (sections array).

## Normalize before persist

Do **not** POST raw `survey_content` blindly. `POST /surveys` uses
`CreateSurveySchema` — blank or missing section fields fail with
`VALIDATION_ERROR`. Before create:

1. Map build sections into the create body (`survey_title`, `survey_type`,
   `survey_goal`, `sections`)
2. For **each** section, ensure non-empty:
   - `section_id` (e.g. `s1`, `s2` if missing)
   - `section_title`
   - `section_goal` — fill from the section title / research goal if build
     left `""` (markdown conversion can omit `Goal:`)
3. Ensure every section has ≥1 question; each question has a valid
   `question_type` and non-empty `question`
4. Spot-check types/choices/images against
   [survey-create-schema.md](survey-create-schema.md)

**Hand-built surveys:** author (or heavily edit) the body using that same
schema reference.

## Persist survey

After normalization, persist (sample below shows a valid hand-shaped body;
replace `sections` with your normalized build output when using `/surveys/build`):

```bash
curl -sS -X POST "$PAI_API_BASE/surveys" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "survey_title": "PMF — Analytics Platform",
    "survey_type": "product_market_fit",
    "survey_goal": "Measure problem/solution fit among B2B buyers",
    "sections": [
      {
        "section_id": "s1",
        "section_title": "Overall Experience",
        "section_goal": "Measure overall satisfaction",
        "questions": [
          {
            "question_type": "rate",
            "question": "How satisfied are you with our product?",
            "choices": [],
            "rateValues": [1, 2, 3, 4, 5]
          }
        ]
      }
    ]
  }' | python3 -m json.tool
```

Save `survey_id` (status `draft`). Review with `GET /surveys/:id`; edit with `PUT /surveys/:id`.

## Responses

```bash
curl -sS "$PAI_API_BASE/surveys/${SURVEY_ID}/responses?limit=20&offset=0&format=json" \
  "${CURL_AUTH[@]}" | python3 -m json.tool
# format=csv for download
```

## Analytics

```bash
curl -sS -X POST "$PAI_API_BASE/surveys/${SURVEY_ID}/analytics/run" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{ "force_recompute": false }' | python3 -m json.tool

curl -sS "$PAI_API_BASE/surveys/${SURVEY_ID}/analytics" "${CURL_AUTH[@]}" | python3 -m json.tool
# poll until data.status === completed
```

Share when analytics completed:

```bash
curl -sS -X POST "$PAI_API_BASE/surveys/${SURVEY_ID}/analytics/share-link" "${CURL_AUTH[@]}" | python3 -m json.tool
```

Copy `data.share_url` from the response and fetch the LLM-friendly analytics
report companion (no API key is needed for this public capability URL):

```bash
export SHARE_URL="https://dashboard.preferencesai.io/report/<share_code>"
curl -fsSL "${SHARE_URL}?format=markdown"
```

Use the Markdown export to understand the executive summary, metrics, insight
groups, chart summaries, and qualitative sections. Co-interpret it with
`GET /surveys/:id/analytics` for exact values and status fields. Treat the share
URL as public once distributed; revoke it when it should no longer be
accessible.

## Deployment

| `deployment_type` | PAI | Result                                |
| ----------------- | --- | ------------------------------------- |
| `self_distribute` | No  | Instant `survey_link` / `survey_code` |

```bash
# Self-distribute
curl -sS -X POST "$PAI_API_BASE/surveys/${SURVEY_ID}/deploy" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{ "deployment_type": "self_distribute", "anonymous": false }' | python3 -m json.tool

# Suspend active
curl -sS -X POST "$PAI_API_BASE/surveys/${SURVEY_ID}/suspend" "${CURL_AUTH[@]}" | python3 -m json.tool
```

Only `draft` / `paused` can deploy; only `active` can suspend. Survey must have questions.

## Next

- Simulation against `survey_id`: [simulations.md](simulations.md)
- Recipes: [combinations.md](combinations.md)
- Interpret: [interpret-results.md](interpret-results.md)
