# Scenario picker

Pick a scenario type for **fast concept validation**. Copy **constructs** and
**aspects** for full runs from `GET /scenarios` — do not invent values.

## Product / GTM scenarios

| `scenario_id`         | Use when                            |
| --------------------- | ----------------------------------- |
| `product_testing`     | Compare product or feature concepts |
| `product_market_fit`  | Problem/solution fit                |
| `product_design`      | Design desirability / craftsmanship |
| `pricing_strategy`    | Price points, WTP                   |
| `go_to_market`        | Channel / launch concepts           |
| `marketing_messaging` | Headlines, positioning, copy        |

## Images (any scenario — product or UX)

Pass `image_url` or `image_urls` on each concept when visuals help validation
(packaging, product photos, ads, mockups). Full field contract:
[scenarios.md — Concept object](scenarios.md#concept-object-configconcepts).

UX scenario types below are **image-first** (mockups strongly recommended);
product / GTM types above also accept the same optional image fields.

| `scenario_id`           | Use when               |
| ----------------------- | ---------------------- |
| `app_visual_design`     | Mobile UI mockups      |
| `app_usability`         | App flow / usability   |
| `website_visual_design` | Website layout mockups |
| `theme_preferences`     | Color / theme variants |

## Limits

- **Quick-run:** 2–4 concepts; **description** required; do **not** send `title`
- **Full scenario:** up to registry `max_concepts` (often 6); `title` allowed

## Decision tree (Validation Layer)

```
Need question-level / survey-backed detail?
  → combinations.md Recipe A (build survey → simulate → interpret)

Fast directional concept compare (2–4 concepts)?
  → pick scenario_id above
  → GET /balance: free trials left? free Quick Concept Test (0.00)
  → else enough PAI for 0.99? paid Quick Concept Test
  → else ask user to top up in Dashboard billing

UI or product visuals available?
  → attach image_url / image_urls on concepts (any scenario_id); UX types are image-first
  → same free → paid ladder

Custom constructs or higher CI?
  → full scenario @ 1.99 PAI (estimate optional)

Need live humans?
  → combinations.md Recipe C (deploy → responses → analytics)
```

Details: [scenarios.md](scenarios.md) · [combinations.md](combinations.md)
