# Setup and access (public API)

**API base URL:** `$PAI_API_BASE`
Default: `https://dashboard.preferencesai.io/api/v1`
**Auth:** `X-API-Key: $PREFERENCES_AI_API_KEY` (keys start with `pak_`)
**Docs:** Dashboard → API Management → API docs (or the published developer API reference)

```bash
export PAI_API_BASE="${PAI_API_BASE:-https://dashboard.preferencesai.io/api/v1}"
export PREFERENCES_AI_API_KEY="pak_your_key_here"
CURL_AUTH=(-H "X-API-Key: $PREFERENCES_AI_API_KEY")
```

## Before you spend

Always call `GET /balance` first. Confirm the response includes `pai_balance`
(two-decimal string) and, for Quick Concept Tests, `free_runs_remaining`.

If `pai_balance` is missing or the API returns that PAI Credits are unavailable,
stop and ask the user to check Dashboard billing / API access with Preferences AI support.

## Team isolation

- Your **team** is implied by the API key.
- Never ask end users for a `team_id` or put `team_id` in request bodies.
- Resources from another team usually return `404` or `403 TEAM_MISMATCH`.

## Response shape

Success:

```json
{ "success": true, "data": {}, "meta": { "pagination": {} } }
```

Error:

```json
{
  "success": false,
  "error": { "code": "VALIDATION_ERROR", "message": "…", "details": {} }
}
```

## Rate limits

Per key (typical defaults): **60** requests/minute, **1,000**/day → `429 RATE_LIMITED`.

Optional IP allowlists may apply on some keys.

## Pagination

List endpoints use `limit` (default 20, max 100) and `offset`. Check
`meta.pagination.has_more`.

## Permissions (scopes)

| Scope                 | Allows                                      |
| --------------------- | ------------------------------------------- |
| `admin:keys`          | Create, list, update, revoke API keys       |
| `balance:read`        | Read PAI Credits balance and free trials    |
| `scenario:read`       | List scenarios/runs, results, share links   |
| `scenario:run`        | Start concept tests and poll status         |
| `scenario:estimate`   | Estimate full scenario sample / price       |
| `surveys:build`       | AI survey builder                           |
| `surveys:create`      | Create surveys                              |
| `surveys:read`        | List/get surveys                            |
| `surveys:update`      | Update surveys                              |
| `surveys:deploy`      | Deploy surveys                              |
| `surveys:suspend`     | Pause active surveys                        |
| `responses:read`      | Read survey responses                       |
| `analytics:read`      | Read analytics / share analytics reports    |
| `analytics:run`       | Start analytics jobs                        |
| `simulation:estimate` | Estimate simulation / follow-up cost        |
| `simulation:run`      | Run simulations / follow-ups; poll status   |
| `simulation:read`     | List/get simulations, share, follow-up list |

Missing scope → `403 SCOPE_INSUFFICIENT`.

## Safe defaults

- Keep the API key in a secret store or environment variable — never paste keys into chat logs or commits.
- Keys are shown **once** at creation — rotate if lost.
- Always check balance before billable work.
- When acting for a user, confirm before paid spend.

## Next

- Pricing: [pricing.md](pricing.md)
- Admin keys: [admin-keys.md](admin-keys.md)
- Errors: [errors.md](errors.md)
- Validation recipes: [combinations.md](combinations.md)
