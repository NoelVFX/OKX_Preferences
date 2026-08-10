# Error handling

Use the standard API error envelope (`success: false`, `error.code`). Do not invent
codes. Credit shortfalls use **`INSUFFICIENT_PAI_BALANCE`**.

## Access

| Code                 | HTTP | What to do                                                                                    |
| -------------------- | ---- | --------------------------------------------------------------------------------------------- |
| `INVALID_API_KEY`    | 401  | Fix or rotate `PREFERENCES_AI_API_KEY`                                                        |
| `KEY_EXPIRED`        | 401  | Create a new API key in the Dashboard                                                         |
| `SCOPE_INSUFFICIENT` | 403  | Add the missing permission on the key ([setup-auth.md](setup-auth.md))                        |
| `TEAM_MISMATCH`      | 403  | Wrong id for this team                                                                        |
| `PAI_NOT_ENABLED`    | 503  | PAI Credits / public API not available — stop; ask the user to contact Preferences AI support |
| `NOT_FOUND`          | 404  | Fix the scenario, survey, run, or simulation id                                               |

## Credits and validation

| Code                       | HTTP | What to do                                                                      |
| -------------------------- | ---- | ------------------------------------------------------------------------------- |
| `FREEMIUM_EXHAUSTED`       | 402  | Top up for a `"0.99"` Quick Concept Test, or wait until paid runs are available |
| `INSUFFICIENT_PAI_BALANCE` | 402  | Stop; show `details.pai_balance` / `required`; guide Dashboard top-up           |
| `VALIDATION_ERROR`         | 400  | Fix the request (concept count, constructs, required fields, deploy type)       |
| `RATE_LIMITED`             | 429  | Slow down; respect per-key limits                                               |
| `CONFLICT`                 | 409  | Wrong state (e.g. share before complete, survey already active)                 |

Money fields in `details` are two-decimal strings.

## Audience and service availability

| Code                       | HTTP | What to do                                                          |
| -------------------------- | ---- | ------------------------------------------------------------------- |
| `AUDIENCE_TOO_NARROW`      | 400  | Broaden the audience description or relax confidence / margin       |
| `ENGINE_UNAVAILABLE`       | 502  | Retry with back-off                                                 |
| `ENGINE_RATE_LIMITED`      | 429  | Wait about a minute, then retry                                     |
| `ENGINE_CONFLICT`          | 409  | Likely a duplicate — poll the existing job instead of re-submitting |
| `SIMULATION_MISCONFIGURED` | 422  | Fix fields listed in `error.details`                                |

## Follow-up eligibility

| Code               | HTTP | What to do                                                                  |
| ------------------ | ---- | --------------------------------------------------------------------------- |
| `PARENT_NOT_FOUND` | 404  | Fix the parent simulation id                                                |
| `NOT_ELIGIBLE`     | 400  | Parent must be `completed`, have `engine_trace_id`, and have ≥5 respondents |

## Failed job checklist

1. Report ids: run / simulation id, `engine_trace_id`, `billing_source`, billing reference, `pai_cost`
2. Note whether credits were restored (`pai_refunded`) or a free trial was consumed
3. Ask the user before spending again
4. Prefer the next step in [combinations.md](combinations.md) over blind retries
