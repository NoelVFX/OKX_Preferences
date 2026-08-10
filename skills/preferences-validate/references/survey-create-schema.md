# Hand-built `POST /surveys` payload

Use this when an agent **authors** survey sections/questions itself (or edits
`POST /surveys/build` output) before `POST /surveys` → simulation.

**Scope:** `surveys:create`
**Contract source:** public API Zod `CreateSurveySchema` (Dashboard
`src/lib/api/validation.ts`). Customer Data Types (Section / Question /
ChoiceItem) are in Dashboard → API Management → API docs.

```bash
export PAI_API_BASE="${PAI_API_BASE:-https://dashboard.preferencesai.io/api/v1}"
CURL_AUTH=(-H "X-API-Key: $PREFERENCES_AI_API_KEY")
```

Prefer `POST /surveys/build` when a natural-language brief is enough — see
[surveys.md](surveys.md). Use this doc when you need precise question types,
choice lists, or image options.

## Top-level body

| Field          | Required | Notes                                                |
| -------------- | -------- | ---------------------------------------------------- |
| `survey_title` | Yes      | Max 200 characters                                   |
| `survey_type`  | Yes      | Category hint (e.g. `general`, `product_market_fit`) |
| `survey_goal`  | Yes      | What you want to learn                               |
| `sections`     | Yes      | Min 1 [section](#section)                            |
| `status`       | No       | Create accepts `draft` only (default)                |

## Section

| Field                 | Required | Notes                                   |
| --------------------- | -------- | --------------------------------------- |
| `section_id`          | Yes      | Stable id (e.g. `s1`); non-empty        |
| `section_title`       | Yes      | Display title; non-empty                |
| `section_goal`        | Yes      | Research goal; **non-empty** (`min(1)`) |
| `section_description` | No       | Helper copy                             |
| `questions`           | Yes      | Min 1 question                          |

> Dashboard UI / older doc samples sometimes omit `section_id` or
> `section_goal`. **Public create validation requires both as non-empty
> strings** — `""` fails with `VALIDATION_ERROR`. When editing
> `POST /surveys/build` output, fill any blank `section_goal` before
> persisting (markdown conversion may leave `section_goal: ""` until a
> `Goal:` line is present).

## Question

| Field           | Required | Notes                                     |
| --------------- | -------- | ----------------------------------------- |
| `question_type` | Yes      | One of the [types](#question-types) below |
| `question`      | Yes      | Prompt text (min 1 char)                  |
| `choices`       | No\*     | Defaults to `[]` if omitted               |
| `required`      | No       | Whether an answer is required             |
| `description`   | No       | Secondary helper text under the question  |

\*Send `choices: []` explicitly for types that do not use options (`rate`,
`text`, `html`, `yes_no`) to match build-output style.

### Question types

| `question_type`   | Typical use                       | Choices / extras                                      |
| ----------------- | --------------------------------- | ----------------------------------------------------- |
| `multiple_choice` | Single select                     | `choices` as `string[]`                               |
| `multiple_select` | Multi select                      | `choices` as `string[]`                               |
| `rank`            | Ordered preference                | `choices` as `string[]`                               |
| `rate`            | Likert / numeric scale            | `rateValues` (e.g. `[1,2,3,4,5]`); optional labels    |
| `text`            | Free text                         | optional `placeholder`, `maxLength`                   |
| `yes_no`          | Binary                            | optional `labelTrue`, `labelFalse`                    |
| `html`            | Static HTML block (not an answer) | optional `html`                                       |
| `imagepicker`     | Choose among images               | `choices` as [ChoiceItem](#choiceitem-images) objects |
| `matrix_choice`   | Grid (rows × column labels)       | `sub_questions` = rows; `choices` = column labels     |

### Type-specific fields (API create)

| Field                      | Used by         | Notes                                                   |
| -------------------------- | --------------- | ------------------------------------------------------- |
| `rateValues`               | `rate`          | Number array, e.g. `[1,2,3,4,5]`                        |
| `minRateDescription`       | `rate`          | Label for low end                                       |
| `maxRateDescription`       | `rate`          | Label for high end                                      |
| `sub_questions`            | `matrix_choice` | Row labels (`string[]`)                                 |
| `html`                     | `html`          | Markup string                                           |
| `labelTrue` / `labelFalse` | `yes_no`        | Button labels                                           |
| `placeholder`              | `text`          | Input hint                                              |
| `maxLength`                | `text`          | Max characters                                          |

Renderer-specific fields are intentionally omitted from this create contract.
`rateValues` and the optional low/high labels are sufficient for a rate
question. Do not add raw SurveyJS fields such as `rateType` or
`displayMode` unless the live Preferences AI API documentation explicitly
lists them for `CreateSurveySchema`.

Do **not** send richer Dashboard editor-only fields (`multiSelect`,
`imageHeight`, `cellType`, `rateType`, etc.) on create — they are not in
`CreateSurveySchema` and are **stripped / ignored** by Zod (they do not
cause a validation error).

Create validation is **permissive beyond** required keys and the
`question_type` enum: it does not enforce type-specific shapes (e.g. a
`rate` without `rateValues`, or `imagepicker` with bare string
`choices`, can still parse). Follow the tables above for a workable
survey; do not treat a `201` as proof the instrument is complete.

## ChoiceItem (images)

For `imagepicker`, each choice is an object (not a bare string):

| Field       | Required | Notes                                    |
| ----------- | -------- | ---------------------------------------- |
| `value`     | Yes      | Stable machine id (e.g. `opt_a`)         |
| `text`      | Yes      | Accessible / caption label               |
| `imageLink` | Yes      | **Full HTTPS (or CDN) URL** of the image |

**Not the same as scenario concepts:** scenario quick-run / run use optional
`image_url` / `image_urls` on each concept ([scenarios.md](scenarios.md)).
Survey create uses **`imageLink`** on each choice. Do not send `image_url` on
survey questions.

Plain `string` choices are fine for MC / multi-select / rank / matrix columns.

## Basic examples

### Minimal rate + multiple choice

```bash
curl -sS -X POST "$PAI_API_BASE/surveys" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "survey_title": "Snack concept feedback",
    "survey_type": "product_market_fit",
    "survey_goal": "Compare packaging preference and purchase intent",
    "sections": [
      {
        "section_id": "s1",
        "section_title": "Preference",
        "section_goal": "Forced choice and intent",
        "questions": [
          {
            "question_type": "multiple_choice",
            "question": "Which packaging would you buy?",
            "choices": ["Matte pouch", "Clear jar", "Neither"],
            "required": true
          },
          {
            "question_type": "rate",
            "question": "How likely are you to try this product?",
            "choices": [],
            "rateValues": [1, 2, 3, 4, 5],
            "minRateDescription": "Not at all",
            "maxRateDescription": "Extremely likely"
          }
        ]
      }
    ]
  }' | python3 -m json.tool
```

Save `data.survey_id`, then estimate/run simulation — [simulations.md](simulations.md).

### Image picker

```bash
curl -sS -X POST "$PAI_API_BASE/surveys" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "survey_title": "Logo variants",
    "survey_type": "general",
    "survey_goal": "Pick preferred logo treatment",
    "sections": [
      {
        "section_id": "s1",
        "section_title": "Visuals",
        "section_goal": "Image preference",
        "questions": [
          {
            "question_type": "imagepicker",
            "question": "Which logo feels more trustworthy?",
            "choices": [
              {
                "value": "logo_a",
                "text": "Wordmark A",
                "imageLink": "https://cdn.example.com/logos/a.png"
              },
              {
                "value": "logo_b",
                "text": "Wordmark B",
                "imageLink": "https://cdn.example.com/logos/b.png"
              }
            ],
            "required": true
          }
        ]
      }
    ]
  }' | python3 -m json.tool
```

Images must already be publicly reachable URLs. This API does not upload
files; host assets first (Dashboard media CDN, GCS, etc.).

### Matrix + yes/no + text

```bash
curl -sS -X POST "$PAI_API_BASE/surveys" \
  "${CURL_AUTH[@]}" -H "Content-Type: application/json" \
  -d '{
    "survey_title": "Feature priority matrix",
    "survey_type": "general",
    "survey_goal": "Importance vs satisfaction by feature",
    "sections": [
      {
        "section_id": "s1",
        "section_title": "Features",
        "section_goal": "Grid ratings",
        "questions": [
          {
            "question_type": "matrix_choice",
            "question": "How important is each feature?",
            "sub_questions": ["Export CSV", "SSO", "Audit log"],
            "choices": ["Low", "Medium", "High"]
          },
          {
            "question_type": "yes_no",
            "question": "Would you pay more for SSO?",
            "choices": [],
            "labelTrue": "Yes",
            "labelFalse": "No"
          },
          {
            "question_type": "text",
            "question": "Anything else we should know?",
            "choices": [],
            "placeholder": "Optional feedback",
            "maxLength": 500,
            "required": false
          }
        ]
      }
    ]
  }' | python3 -m json.tool
```

## Agent checklist

1. Include non-empty `section_id` + `section_goal` on every section
2. Use only the nine `question_type` values above; fill type-specific
   fields from the tables (Zod will not require them for you)
3. Images → `imagepicker` + ChoiceItem `imageLink` (not `image_url`)
4. Persist with `POST /surveys` → keep `survey_id`
5. Confirm spend → `POST /simulations/estimate-cost` → `POST /simulations`

## Related

- Persist / build / deploy flows: [surveys.md](surveys.md)
- Simulation after create: [simulations.md](simulations.md)
- Recipe A: [combinations.md](combinations.md)
