# PAI Credits pricing

Preferences AI bills validation work in **PAI Credits**. Published catalog
prices match the Dashboard product catalog and public API responses.

## Rules for agents

- `1.00` PAI = USD `1.00`
- Treat money as exact **two-decimal strings** (`"0.99"`) — compare carefully, not as floating-point math
- Trust `pai_balance` and freemium counters from `GET /balance` — do not invent balances
- Do **not** send a client price on run requests — the server applies the catalog `pai_cost`
- **Estimates do not charge**; they help size the sample and confirm the catalog price

## Validation catalog (pay-as-you-go)

| What you run                 | Catalog name        | Typical `pai_cost` | Notes                                                           |
| ---------------------------- | ------------------- | ------------------ | --------------------------------------------------------------- |
| Free Quick Concept Test      | `quick_run` (trial) | `"0.00"`           | While `free_runs_remaining >= 1`                                |
| Paid Quick Concept Test      | `quick_run`         | `"0.99"`           | After free trials are used                                      |
| Full structured scenario     | `scenario`          | `"1.99"`           | Custom constructs / stronger CI                                 |
| Survey simulation (shorter)  | `short_survey`      | `"2.49"`           | ≤10 questions and confidence ≤ `0.90` when count is known       |
| Survey simulation (standard) | `complex_survey`    | `"3.99"`           | Default when question count is unknown or short-tier rules fail |
| Follow-up simulation         | `follow_up_survey`  | `"1.99"`           | Dig deeper on a completed simulation                            |
| Virtual interview (if used)  | `virtual_interview` | `"0.29"`           | Per-respondent catalog face                                     |

## Free Quick Concept Tests

| Item                      | Value                                                     |
| ------------------------- | --------------------------------------------------------- |
| Prepaid balance required? | No — balance may be `"0.00"`                              |
| What’s free               | **Quick Concept Tests only**                              |
| Typical allowance         | **3** trials (`free_runs_remaining`)                      |
| Cost when accepted        | `"0.00"`                                                  |
| How it works              | Server uses a free trial automatically when trials remain |

When trials are gone, the next quick test costs `"0.99"` (if paid runs are available)
or returns `FREEMIUM_EXHAUSTED`.

## Estimates vs charging

- `…/estimate-cost` endpoints **do not debit**
- Use estimated respondent counts when starting a run
- Before charging runs: `GET /balance` and ensure `pai_balance` covers catalog `pai_cost`

## Check balance

```bash
curl -sS "$PAI_API_BASE/balance" \
  -H "X-API-Key: $PREFERENCES_AI_API_KEY" | python3 -m json.tool
```

Use `pai_balance`, `free_runs_remaining`, and `freemium_default`.

## Plans & packs (buy in Dashboard)

Agents do **not** purchase plans via the API. Guide users to Dashboard billing:

| Plan       | Monthly (USD≡PAI) | Credits                                    | Notes             |
| ---------- | ----------------- | ------------------------------------------ | ----------------- |
| Free entry | —                 | 0 credits + **3 free Quick Concept Tests** | Start validating  |
| Starter    | `"29.00"`         | **35** credits                             | Rollover          |
| Pro        | `"99.00"`         | **125** credits                            | Rollover + extras |
| Enterprise | Custom            | Tailored                                   | SSO / support     |

| Pack       | Credits | Bonus |
| ---------- | ------: | ----- |
| `"10.00"`  |      10 | —     |
| `"50.00"`  |      60 | +20%  |
| `"100.00"` |     125 | +25%  |
| `"250.00"` |     325 | +30%  |

## If a paid job fails

After a paid job is accepted, a later failure may restore credits
(`pai_refunded: true` on status). Free trials are generally **not** returned
after the job was accepted.
