# Validation recipes (recommended combinations)

Use Preferences AI as a **Validation Layer**: start with the lightest test that
answers the business question, then escalate only when more evidence is needed.

Each recipe lists goal, when to use it, permissions, artifacts, credit gate,
confirmation, polling, interpretation, and next step.

**Base:** `$PAI_API_BASE` · Auth: `X-API-Key`

**Routing rule:** If the user needs **detailed / question-level evidence beyond a
concept comparison**, prefer **Recipe A (survey → simulation → analyze insights)**
over scenario-only paths.

---

## Recipe A — Detailed product research (survey-backed simulation)

|               |                                                                                                                               |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Goal**      | Deep preference / PMF evidence with question-level findings                                                                   |
| **When**      | Scenario-only winner is not enough; need instrument + AI Digital Population insights                                          |
| **Scopes**    | `balance:read`, `surveys:build`, `surveys:create`, `surveys:read`, `simulation:estimate`, `simulation:run`, `simulation:read` |
| **Artifacts** | `survey_id`, `simulation_id`, optional `share_url`                                                                            |
| **Cost gate** | Estimate `pai_cost` (`"2.49"` or `"3.99"`); `GET /balance` ≥ that amount                                                      |
| **Confirm**   | Autonomous agents confirm paid simulation spend before `POST /simulations`                                                    |

**Steps**

1. Clarify research objective + audience (`population_query`)
2. `POST /surveys/build` → review `survey_content` — [surveys.md](surveys.md)
   _(or hand-author — [survey-create-schema.md](survey-create-schema.md))_
3. **Normalize** sections (`section_id` / non-empty `section_goal`, etc.) —
   [surveys.md](surveys.md#normalize-before-persist) ·
   [survey-create-schema.md](survey-create-schema.md)
4. `POST /surveys` → save `survey_id`; optional `GET`/`PUT` refine
5. `POST /simulations/estimate-cost` with `survey_id` — [simulations.md](simulations.md)
6. `GET /balance` → money-compare ≥ `pai_cost`
7. Confirm spend (autonomous) → `POST /simulations` with `desired_respondent_count`
8. Poll `GET /simulations/:id/status` (10–30s) until `completed` / `failed`
9. `GET /simulations/:id` → read `insights`, `analysis`, `charts`
10. Interpret with [interpret-results.md](interpret-results.md) simulation template
11. Optional: share-link; or follow-up wave (Recipe D)

**Next:** Share report; iterate survey; follow-up dig; or deploy for real respondents (Recipe C).

---

## Recipe B — Fast concept / messaging compare (scenario)

|               |                                                                                  |
| ------------- | -------------------------------------------------------------------------------- |
| **Goal**      | Directional winner among 2–4 (up to 6 full) concepts                             |
| **When**      | Early screening before building a survey instrument                              |
| **Scopes**    | `balance:read`, `scenario:run`, `scenario:read` (+ `scenario:estimate` for full) |
| **Artifacts** | `run_id`                                                                         |
| **Cost gate** | Freemium `"0.00"` if trials remain; else `"0.99"` quick or `"1.99"` full         |
| **Confirm**   | Confirm before paid `"0.99"` / `"1.99"`                                          |

**Steps**

1. Pick `scenario_id` — [scenario-picker.md](scenario-picker.md)
2. `GET /balance`
3. Prefer `POST .../quick-run` (A0 freemium → A1 paid); escalate to estimate + `.../run` for custom constructs / CI
4. Poll `GET /scenario-runs/:id/status` → `GET /scenario-runs/:id`
5. Interpret scenario template — [interpret-results.md](interpret-results.md)

**Next:** If user needs deeper question-level evidence → **Recipe A**. Else iterate concepts or share-link.

---

## Recipe C — Real-respondent research

|               |                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**      | Live human responses + analytics                                                                                                                                    |
| **When**      | AI Digital Population is not sufficient; need field data                                                                                                            |
| **Scopes**    | `surveys:build`, `surveys:create`, `surveys:read` (+ `surveys:update`), `surveys:deploy` (+ `surveys:suspend`), `responses:read`, `analytics:read`, `analytics:run` |
| **Artifacts** | `survey_id`, `survey_link`, analytics payload, optional share                                                                                                       |
| **Cost gate** | `self_distribute`: no catalog debit                                                                                                                                 |
| **Confirm**   | No paid deployment confirmation required                                                                                                                            |

**Steps**

1. Build/create survey — [surveys.md](surveys.md)
2. `POST .../deploy` with `"deployment_type": "self_distribute"`
3. Collect → `GET .../responses`
4. `POST .../analytics/run` → poll `GET .../analytics`
5. Interpret analytics template; optional analytics share-link

**Next:** Suspend when done; optionally also run Recipe A on the same instrument for synthetic comparison.

---

## Recipe D — Deeper simulation wave (follow-up)

|               |                                                                            |
| ------------- | -------------------------------------------------------------------------- |
| **Goal**      | Dig into findings from a completed parent simulation                       |
| **When**      | Parent eligible: `completed`, `engine_trace_id`, ≥5 respondents            |
| **Scopes**    | `balance:read`, `simulation:estimate`, `simulation:run`, `simulation:read` |
| **Artifacts** | Child `simulation_id`, parent id                                           |
| **Cost gate** | `"1.99"` (`follow_up_survey`)                                              |
| **Confirm**   | Confirm paid follow-up                                                     |

**Steps**

1. Verify parent via `GET /simulations/:id`
2. Follow-up estimate → balance → run — [simulations.md](simulations.md)
3. Poll child status → get results; list via `GET .../follow-ups`
4. Interpret comparing child vs parent findings

---

## Recipe E — Lifecycle hygiene

|          |                                       |
| -------- | ------------------------------------- |
| **Goal** | Avoid duplicate spend and orphan jobs |
| **When** | Always before creating new paid work  |

**Steps**

1. `GET /surveys`, `GET /simulations`, `GET /scenario-runs` — reuse completed artifacts when possible
2. Share links only when resource / analytics is `completed`
3. On failure: check `pai_refunded`, report ids, confirm before re-spend — [errors.md](errors.md)
4. Choose next recipe from evidence + `pai_balance` + freemium remaining + follow-up eligibility
