# Interpreting results (Validation Layer briefs)

Turn completed Preferences AI runs into clear decision support for the business
user. Wait until the resource is **`completed`** (or analytics `status: completed`).
Do not invent payload keys — report only fields that are present.

## Co-interpret API JSON with the shared Markdown report

For a completed scenario run, simulation, or survey analytics result, use the
API response and the public report export as complementary representations:

1. Read the authenticated API JSON for exact IDs, status, numeric values,
   respondent counts, question fields, billing, and machine-readable evidence.
2. If a share link does not exist, create one after completion:

   ```bash
   # Simulation
   curl -sS -X POST "$PAI_API_BASE/simulations/${SIMULATION_ID}/share-link" \
     "${CURL_AUTH[@]}" | python3 -m json.tool

   # Survey analytics
   curl -sS -X POST "$PAI_API_BASE/surveys/${SURVEY_ID}/analytics/share-link" \
     "${CURL_AUTH[@]}" | python3 -m json.tool
   ```

3. Take the returned `data.share_url` and request its LLM-friendly export:

   ```bash
   curl -fsSL "${SHARE_URL}?format=markdown"
   ```

   The Markdown GET is public and does not use the API key. A share URL is an
   unguessable capability link: treat it as public once distributed and do not
   place it in prompts, logs, or tickets containing confidential context.

4. Use Markdown to understand the report hierarchy and narrative
   (overview, findings, metrics, chart summaries, qualitative evidence, and
   actions). Use the API JSON to verify exact values, IDs, and fields.
5. Check that `resource_id`, report type, and `generated_at` refer to the same
   result. If the representations disagree or timestamps differ, fetch both
   again and call out the mismatch rather than silently combining them.

The Markdown export improves LLM readability; it is not an additional source
of evidence and does not replace the authenticated API response.

## Scenario runs (`GET /scenario-runs/:id`)

| Field / path                         | Use                                |
| ------------------------------------ | ---------------------------------- |
| `status`                             | Must be `completed` before verdict |
| `insights` / key findings            | One-line outcome + evidence        |
| `agent_context.winner` (if present)  | `concept_id`, construct, mean      |
| `analysis` / `charts`                | Deeper breakdown                   |
| Request concepts                     | Map `concept_id` → user names      |
| Submit `pai_cost` / `billing_source` | Spend line in brief                |
| Status `pai_refunded`                | Paid failure credit restored       |

Quick-run ≈ directional (~85% CI defaults). Full scenario honors your CI / constructs.

### Scenario report template

1. **Objective** — audience, concepts, path (freemium / `"0.99"` / `"1.99"`)
2. **Spend** — `billing_source`, `pai_cost`, freemium remaining or `pai_balance_after`
3. **Verdict** — leading concept on primary construct
4. **Evidence** — 2–4 bullets
5. **Caveats** — AI Digital Population is directional validation, not a substitute for live customers
6. **Next** — iterate concepts; escalate to **survey → simulation** ([combinations.md](combinations.md) Recipe A) when deeper evidence is needed; optional share link + Markdown report

---

## Simulations (`GET /simulations/:id`)

| Field / path                                                 | Use                                                   |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| `status`                                                     | `completed` required for insights                     |
| `insights.goal_summary` / `key_findings` / `recommendations` | Core narrative                                        |
| `analysis.summary` / `analysis.questions`                    | Question-level breakdown                              |
| `charts`                                                     | Visual evidence (summarize; do not invent series)     |
| `respondent_count` / CI / MoE                                | Sample quality                                        |
| `billing_source` / `billing_reference`                       | Audit trail (catalog `pai_cost` from submit/estimate) |
| Follow-up: `parent_simulation_id`, `focus_areas`             | Wave context                                          |

### Simulation report template

1. **Objective** — `survey_id` / title, audience, label
2. **Spend** — catalog SKU / `pai_cost` from submit or estimate; refund note if failed
3. **Verdict** — top findings + recommendations (priority)
4. **Evidence** — question-level highlights from `analysis`
5. **Report companion** — optionally co-interpret the share-link Markdown export with the API JSON using the rules above
6. **Caveats** — AI Digital Population validates at scale; confirm critical bets with real customers when stakes are high
7. **Next** — follow-up (Recipe D); deploy for live respondents (Recipe C); optional share link

### Follow-up compare

State parent finding → child focus → what changed / deepened. Cite both simulation ids.

---

## Survey analytics (`GET /surveys/:id/analytics`)

| Field                            | Use                  |
| -------------------------------- | -------------------- |
| `status` / `progress_percentage` | Wait for `completed` |
| `data.summary`                   | Executive summary    |
| `data.insights`                  | Bullets              |
| `data.question_breakdowns`       | Per-question stats   |

### Analytics report template

1. **Objective** — survey goal / title
2. **Sample** — response counts from responses endpoint if known
3. **Findings** — summary + top insights
4. **Question highlights** — 3–5 breakdowns
5. **Report companion** — optionally co-interpret the analytics share-link Markdown export with the API JSON using the rules above
6. **Next** — suspend deploy; recompute with `force_recompute`; share analytics link

---

## Deployment outcomes

| Field                         | Use                  |
| ----------------------------- | -------------------- |
| `status`                      | `active`, `paused`   |
| `survey_link` / `survey_code` | Give to distributors |

Report: `self_distribute`, link, and how to pull responses/analytics next.

---

## Inconclusive or failed

- Broaden audience on `AUDIENCE_TOO_NARROW`
- Differentiate concepts; escalate Recipe B → A when detail needed
- Do not re-run paid paths without user confirmation
- Follow [errors.md](errors.md) checklist
