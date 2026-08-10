---
name: preferences-validate
description: >
  Uses Preferences AI as a Validation Layer before build and launch: test
  product, pricing, messaging, and UX concepts with an AI Digital Population,
  then deepen with surveys, simulations, analytics, and optional live
  deployment—all via the public Dashboard API (X-API-Key) and PAI Credits.
  Prefer freemium or low-cost concept tests first; escalate to survey-backed
  simulation when question-level evidence is needed. Use when validating
  ideas, comparing concepts, checking product-market fit, or deciding go/no-go
  with PreferencesAI. Keywords: validation layer, concept test, preferences
  validate, preferencesai.io, PAI Credits, AI Digital Population, survey,
  simulation, analytics.
version: 1.0.4
author: Preferences AI (https://preferencesai.io)
license: MIT
platforms: [linux, macos, windows]
prerequisites:
  env_vars: [PREFERENCES_AI_API_KEY]
  commands: [curl]
metadata:
  openclaw:
    emoji: '✅'
    requires:
      env: [PREFERENCES_AI_API_KEY]
    primaryEnv: PREFERENCES_AI_API_KEY
  hermes:
    tags:
      [PreferencesAI, Validation Layer, Concept Test, PAI Credits, Surveys, Simulations, Analytics]
---

# preferences-validate

**Preferences AI as your Validation Layer** — test ideas with an AI Digital
Population _before_ you over-invest in build, launch, or large research programs.

This skill teaches agents how to run that validation end-to-end on the public
Preferences AI API with a Team API key and **PAI Credits**.

**What you can validate**

| Need                                    | What Preferences AI does                                                    |
| --------------------------------------- | --------------------------------------------------------------------------- |
| Fast concept / message / mockup compare | Quick or full **scenario** tests — directional winner in minutes            |
| Deeper preference & PMF evidence        | **Survey** + **AI Digital Population simulation** — question-level insights |
| Real customers                          | **Deploy** a survey, collect responses, run **analytics**                   |
| Dig deeper on a finding                 | **Follow-up** simulation on a completed run                                 |

**Credits:** `1.00` PAI = USD `1.00`. Prices and balances are exact two-decimal
strings (e.g. `"0.99"`). Always check balance before spending.

**Access**

1. Sign up at [dashboard.preferencesai.io](https://dashboard.preferencesai.io)
2. Create a Team API key (`pak_…`) under API Management
3. Export it for agents:

```bash
export PREFERENCES_AI_API_KEY="pak_your_key_here"
```

**API base URL:** `PAI_API_BASE` defaults to
`https://dashboard.preferencesai.io/api/v1`. Override it before running a
workflow when targeting another environment:

```bash
export PAI_API_BASE="${PAI_API_BASE:-https://dashboard.preferencesai.io/api/v1}"
```

**Auth header:** `X-API-Key: $PREFERENCES_AI_API_KEY`
Your team is implied by the key — never send `team_id` in the body.

Before any paid work, call `GET /balance` and confirm `pai_balance` is present.
If balance looks unexpected, ask the user to check Dashboard billing.

Details: [setup-auth](references/setup-auth.md) · [pricing](references/pricing.md)

## When to use

- Validate product, pricing, messaging, or UX concepts before build or launch
- Choose among 2–6 variants with evidence (not opinion alone)
- Run survey-backed simulations when you need richer, question-level findings
- Deploy to real respondents and analyze results when the user asks for live data
- Manage API keys and credit-aware workflows for a Preferences AI Team

## When NOT to use

| Situation                                      | Guidance                           |
| ---------------------------------------------- | ---------------------------------- |
| No Team / no API key (wallet-only pay-per-run) | Outside this skill’s Team API path |
| Pure Dashboard clicking with no API key        | Use the Dashboard UI directly      |

## How to choose a validation path

| Business question                                                    | Recommended path                                      | Recipe                          |
| -------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------- |
| “Which concept / headline / mockup wins directionally?”              | Scenario freemium → paid quick test, or full scenario | [B](references/combinations.md) |
| “We need detailed, question-level evidence—not just a concept score” | Build survey → run simulation → interpret insights    | [A](references/combinations.md) |
| “We need answers from real people”                                   | Deploy survey → responses → analytics                 | [C](references/combinations.md) |
| “Dig into what the last simulation found”                            | Follow-up simulation                                  | [D](references/combinations.md) |
| “Don’t create duplicates or waste credits”                           | List existing work first                              | [E](references/combinations.md) |

**Validation Layer rule:** start light (scenario). Escalate to **survey → simulation → insights** when the user needs more than a concept comparison.

## Permissions (API scopes)

Grant only what the workflow needs:

| Workflow                   | Scopes                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| Check credits              | `balance:read`                                                                   |
| Manage keys                | `admin:keys`                                                                     |
| Quick / full concept tests | `balance:read`, `scenario:run`, `scenario:read` (+ `scenario:estimate` for full) |
| Build & save surveys       | `surveys:build`, `surveys:create`, `surveys:read` (+ `surveys:update`)           |
| Responses & analytics      | `responses:read`, `analytics:read`, `analytics:run`                              |
| Deploy / pause             | `surveys:deploy`, `surveys:suspend`                                              |
| Simulations & follow-ups   | `balance:read`, `simulation:estimate`, `simulation:run`, `simulation:read`       |

Full list: [setup-auth.md](references/setup-auth.md).

## Credit-aware spend order

| Step | Product                                   | Typical cost                 |
| ---- | ----------------------------------------- | ---------------------------- |
| 1    | Free Quick Concept Tests (limited trials) | `"0.00"` while trials remain |
| 2    | Paid Quick Concept Test                   | `"0.99"`                     |
| 3    | Full scenario                             | `"1.99"`                     |
| 4    | Survey simulation (short / complex)       | `"2.49"` / `"3.99"`          |
| 5    | Follow-up simulation                      | `"1.99"`                     |

- Always `GET /balance` before billable work
- Cost estimates do **not** charge; runs apply catalog prices (do not send a client price field)
- Agents acting for a user: **confirm** before paid spend
- If a paid job fails after acceptance, check whether credits were restored (`pai_refunded`)

## How to run a validation

1. Clarify the business question → pick a path in the table above
2. Follow the matching recipe in [combinations.md](references/combinations.md)
3. Use service guides: [scenarios](references/scenarios.md) · [surveys](references/surveys.md) · [simulations](references/simulations.md)
4. On errors, use [errors.md](references/errors.md)
5. Deliver a clear brief with [interpret-results.md](references/interpret-results.md);
   co-interpret the API JSON with the optional shared Markdown report when a
   completed simulation or analytics share link is available

## Security & tenancy

| Topic       | Rule                                            |
| ----------- | ----------------------------------------------- |
| Auth        | Team API key in `X-API-Key` only                |
| Team        | Implied by the key                              |
| Rate limits | Typically 60 requests/minute, 1,000/day per key |
| Secrets     | Never embed keys in prompts, logs, or commits   |

## Further reading

| File                                                          | Contents                        |
| ------------------------------------------------------------- | ------------------------------- |
| [setup-auth.md](references/setup-auth.md)                     | Access, scopes, response shape  |
| [pricing.md](references/pricing.md)                           | Prices, free trials, plans      |
| [admin-keys.md](references/admin-keys.md)                     | Create and revoke keys          |
| [scenarios.md](references/scenarios.md)                       | Concept tests                   |
| [scenario-picker.md](references/scenario-picker.md)           | Which scenario type to pick     |
| [surveys.md](references/surveys.md)                           | Surveys, analytics, deploy      |
| [survey-create-schema.md](references/survey-create-schema.md) | Hand-built `POST /surveys` body |
| [simulations.md](references/simulations.md)                   | AI Digital Population runs      |
| [combinations.md](references/combinations.md)                 | End-to-end validation recipes   |
| [errors.md](references/errors.md)                             | Errors → what to do             |
| [interpret-results.md](references/interpret-results.md)       | How to present findings         |
