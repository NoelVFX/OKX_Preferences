# Concept tests (scenarios)

**Permissions:** `scenario:read`, `scenario:run`, `scenario:estimate`, `balance:read`
**Pricing:** free / `"0.99"` Quick Concept Test, `"1.99"` full scenario — [pricing.md](pricing.md)
**Picker:** [scenario-picker.md](scenario-picker.md)

```bash
export PAI_API_BASE="${PAI_API_BASE:-https://dashboard.preferencesai.io/api/v1}"
CURL_AUTH=(-H "X-API-Key: $PREFERENCES_AI_API_KEY")
```

## Endpoints

| Method      | Path                                   | Scope               |
| ----------- | -------------------------------------- | ------------------- |
| GET         | `/scenarios`                           | `scenario:read`     |
| POST        | `/scenarios/:scenarioId/quick-run`     | `scenario:run`      |
| POST        | `/scenarios/:scenarioId/estimate-cost` | `scenario:estimate` |
| POST        | `/scenarios/:scenarioId/run`           | `scenario:run`      |
| GET         | `/scenario-runs`                       | `scenario:read`     |
| GET         | `/scenario-runs/:id`                   | `scenario:read`     |
| GET         | `/scenario-runs/:id/status`            | `scenario:run`      |
| POST/DELETE | `/scenario-runs/:id/share-link`        | `scenario:read`     |

## List scenario types

```bash
curl -sS "$PAI_API_BASE/scenarios" "${CURL_AUTH[@]}" | python3 -m json.tool
```

Copy valid `constructs` / `aspects` from the response for full runs — do not invent values.

## Concept object (`config.concepts[]`)

Each concept is text-first. Optional images add **vision / multimodal** support so the
AI Digital Population can evaluate packaging, product shots, ads, storefronts,
or UI mockups—not only UX scenarios.

| Field         | Quick-run       | Full scenario | Notes                                                                           |
| ------------- | --------------- | ------------- | ------------------------------------------------------------------------------- |
| `description` | **Required**    | **Required**  | Stimulus text the audience reacts to                                            |
| `concept_id`  | Optional        | Optional      | Defaults to `c1`, `c2`, …                                                       |
| `title`       | **Do not send** | Optional      | Quick-run titles are derived in results                                         |
| `image_url`   | Optional        | Optional      | Primary image URL (**HTTPS** or GCS). When set, elicitation runs multimodal     |
| `image_urls`  | Optional        | Optional      | Extra image URLs (array). If both are set, `image_url` is prepended to the list |

**When to attach images (any scenario type)**

| Use case                        | Example assets                              |
| ------------------------------- | ------------------------------------------- |
| Product / packaging             | Pack shot, label close-up, shelf photo      |
| Pricing / offer                 | Pricing card, promo banner, checkout screen |
| Messaging / GTM                 | Ad creative, landing hero, email screenshot |
| UX / visual (image-first types) | App or web mockups — strongly recommended   |

- Prefer publicly reachable HTTPS URLs the engine can fetch.
- Keep `description` specific even when images are present (what to notice / decide).
- UX scenario ids (`app_visual_design`, etc.) are **image-first**—still send mockups via these fields; product scenarios benefit from the same fields when visuals matter.

## Quick-run (prefer free trials first)

`GET /balance` first. Server uses a free trial when remaining; else `"0.99"`. Concepts: **2–4**, description required (no `title`). Attach `image_url` / `image_urls` whenever visuals support the concept.

**Text-only example:**

```bash
SCENARIO_ID="product_testing"
curl -sS -X POST "$PAI_API_BASE/scenarios/${SCENARIO_ID}/quick-run" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "population_query": "Adults 22–35 in Singapore who use food delivery apps twice a week",
    "goal_summary": "Which premium tier concept wins on upgrade intent?",
    "config": {
      "concepts": [
        { "concept_id": "c1", "description": "S$9.90/month Pro tier with free delivery" },
        { "concept_id": "c2", "description": "S$14.90/month Max tier with unlimited deliveries" }
      ]
    },
    "quick_mode": true
  }' | python3 -m json.tool
```

**With supporting images (product packaging — same fields work for any scenario):**

```bash
SCENARIO_ID="product_testing"
curl -sS -X POST "$PAI_API_BASE/scenarios/${SCENARIO_ID}/quick-run" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "population_query": "US grocery shoppers 25-44 who buy premium snacks weekly",
    "goal_summary": "Which packaging concept wins on purchase intent?",
    "config": {
      "concepts": [
        {
          "concept_id": "c1",
          "description": "Matte black pouch with bold gold wordmark and single hero product photo",
          "image_url": "https://storage.example.com/concepts/pack-a-front.png"
        },
        {
          "concept_id": "c2",
          "description": "Bright recyclable carton with nutrition callouts and lifestyle scene",
          "image_url": "https://storage.example.com/concepts/pack-b-front.png",
          "image_urls": [
            "https://storage.example.com/concepts/pack-b-detail.png"
          ]
        }
      ]
    },
    "quick_mode": true
  }' | python3 -m json.tool
```

Expect **202** with `run_id`, `pai_cost` (`"0.00"` or `"0.99"`), optional `free_runs_remaining` / `pai_balance_after`.

## Full scenario (`"1.99"`)

Same concept fields apply. Optional estimate (no debit):

```bash
curl -sS -X POST "$PAI_API_BASE/scenarios/${SCENARIO_ID}/estimate-cost" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "population_query": "US adults 25-44 interested in premium skincare",
    "confidence_level": 0.95,
    "margin_of_error": 0.05,
    "config": {
      "concepts": [
        {
          "concept_id": "c1",
          "title": "Serum A",
          "description": "Daily vitamin C serum for sensitive skin",
          "image_url": "https://storage.example.com/products/serum-a.png"
        },
        {
          "concept_id": "c2",
          "title": "Serum B",
          "description": "Retinol night cream with peptides",
          "image_urls": [
            "https://storage.example.com/products/serum-b-front.png",
            "https://storage.example.com/products/serum-b-back.png"
          ]
        }
      ],
      "constructs": ["purchase_intent", "relevance", "uniqueness"],
      "aspects": ["visual_appeal", "usability"],
      "goal_summary": "Which concept wins on purchase intent?"
    }
  }' | python3 -m json.tool
```

Then:

1. Confirm `pai_balance >= "1.99"`; confirm paid spend with the user when acting autonomously.
2. Run (no client cost field); pass `desired_respondent_count` from the estimate when available.
3. Poll / retrieve as below.

## Poll and results

```bash
RUN_ID="run_…"
curl -sS "$PAI_API_BASE/scenario-runs/${RUN_ID}/status" "${CURL_AUTH[@]}" | python3 -m json.tool
# every 10–30s until completed | failed

curl -sS "$PAI_API_BASE/scenario-runs/${RUN_ID}" "${CURL_AUTH[@]}" | python3 -m json.tool
```

List history: `GET /scenario-runs` (optional `run_type=quick|full`).

## Share link (completed only)

```bash
curl -sS -X POST "$PAI_API_BASE/scenario-runs/${RUN_ID}/share-link" "${CURL_AUTH[@]}" | python3 -m json.tool
curl -sS -X DELETE "$PAI_API_BASE/scenario-runs/${RUN_ID}/share-link" "${CURL_AUTH[@]}" | python3 -m json.tool
```

Public URL: `https://dashboard.preferencesai.io/report/{share_code}` (`?format=json|markdown` optional).

## Interpret

See [interpret-results.md](interpret-results.md). Escalate to survey→simulation when question-level detail is required — [combinations.md](combinations.md).
