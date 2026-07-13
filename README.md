# Preferences ASP Concierge

Preferences ASP Concierge is a standalone Agent Service Provider (ASP) MVP for real-world product validation.

It repackages the original Preferences AI Discord concierge into a browser + Discord workflow that turns any product, startup, or business workflow idea into a paid validation service.

## Product positioning

- Use case: real-world product-market-fit validation before a founder, builder, or product team spends money on development or launch campaigns
- Service type: software service / business and market research service
- Service promise: “Give the concierge a concept; it returns target demographics, a Preferences AI survey, digital population simulation state, and dashboard unlock links.”
- Distribution surfaces: browser landing page, Discord slash command, and Stripe-paid unlock flow

## What this ASP does

1. A user submits a real-world concept through the web UI or Discord concierge.
2. Hermes Agent creates a preview:
   - pitch category
   - two target demographic groups
   - preview affinity scores
   - product-market-fit findings
   - ASP packaging note
3. The app provisions Preferences AI assets when `PREFERENCES_AI_API_KEY` is configured:
   - custom product-market-fit survey
   - saved survey dashboard asset
   - optional digital population simulation
4. Stripe Checkout sells the full report/dashboard unlock.
5. After payment, the user receives unlocked Preferences AI dashboard links.

## Why it is a real-world ASP

Many builders have ideas but do not know who will buy, what objections matter, or what messaging to test. This ASP packages market research as an agent-discoverable service:

- Input: product/startup/workflow concept
- Agent work: market framing, audience segmentation, survey generation, simulation setup
- Output: validation preview + survey/simulation dashboard links
- Monetization: Stripe-paid unlock
- Delivery: web UI and Discord command

## Main files

- `public/index.html` — standalone landing page
- `public/app.js` — browser workflow and status/result rendering
- `server.js` — Express API, Hermes preview, Preferences AI provisioning, Stripe Checkout, unlock pages, webhook handler
- `agent_coordinator.py` — Discord concierge flow for slash-command usage
- `tests/*.mjs` — Node regression tests for frontend copy, Hermes prompt shape, and provisioning behavior
- `tests/test_preferencesai_simulation_payload.py` — Python payload tests for the Discord coordinator
- `ecosystem.config.cjs` — PM2 process names for this standalone copy

## Local setup

```bash
npm install
python -m pip install -r requirements.txt
cp .env.example .env
```

Configure `.env`:

```dotenv
PORT=4242
DOMAIN=http://localhost:4242

# Preferences AI
PREFERENCES_AI_API_KEY=...
PREFERENCES_REQUEST_TIMEOUT=180
WEB_RUN_LIVE_SIMULATION=1

# Stripe
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
WEB_PRODUCT_NAME="Preferences ASP Concierge Unlock"
WEB_PRICE_CENTS=999
WEB_PRICE_CURRENCY=usd

# Hermes preview generation
HERMES_PREVIEW_USE_CLI=1
HERMES_COMMAND=hermes
HERMES_PROVIDER=openai-api
HERMES_MODEL=gpt-5.5
HERMES_PREVIEW_TIMEOUT=180
OPENAI_API_KEY=...

# Discord concierge, optional
DISCORD_BOT_TOKEN=...
DISCORD_GUILD_ID=...
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
```

Run the web ASP locally:

```bash
npm start
```

Open:

```text
http://localhost:4242
```

Run the Discord concierge:

```bash
python agent_coordinator.py
```

Then use:

```text
/validate pitch:"AI scheduling concierge for small clinics"
```

## Stripe webhook

For local development:

```bash
stripe listen --forward-to localhost:4242/webhook
```

Add the printed `whsec_...` value to `STRIPE_WEBHOOK_SECRET`.

Required event:

```text
checkout.session.completed
```

## Railway deployment

This folder keeps `nixpacks.toml` and `railway.json` from the original app. Railway should install Node dependencies and Hermes Agent.

Recommended Railway variables:

```dotenv
PORT=4242
DOMAIN=https://your-railway-domain.up.railway.app
PREFERENCES_AI_API_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
WEB_PRODUCT_NAME="Preferences ASP Concierge Unlock"
HERMES_PREVIEW_USE_CLI=1
HERMES_COMMAND=hermes
HERMES_PROVIDER=openai-api
HERMES_MODEL=gpt-5.5
OPENAI_API_KEY=...
```

## Test plan

```bash
npm run check
npm test
python -m unittest tests.test_preferencesai_simulation_payload
```

If Python does not have pytest, the unittest command above avoids needing pytest.

## Demo outline

1. Show the landing page and explain the use case.
2. Submit a concept.
3. Show demographic preview and affinity scores.
4. Show survey/simulation resource state.
5. Click the Stripe unlock path.
6. Explain how this is an ASP that can be listed/discovered as a repeatable service.
