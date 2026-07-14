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
6. On the unlocked page, the user can pay for a second add-on: Hermes Agent generates an investor pitch deck (`.pptx`) from the validation preview and Preferences AI simulation data, downloadable immediately after payment.

## Why it is a real-world ASP

Many builders have ideas but do not know who will buy, what objections matter, or what messaging to test. This ASP packages market research as an agent-discoverable service:

- Input: product/startup/workflow concept
- Agent work: market framing, audience segmentation, survey generation, simulation setup
- Output: validation preview + survey/simulation dashboard links + optional Hermes Agent investor pitch deck
- Monetization: Stripe-paid unlock, plus a Stripe-paid pitch deck add-on
- Delivery: web UI and Discord command

## Main files

- `public/index.html` — standalone landing page
- `public/app.js` — browser workflow and status/result rendering
- `server.js` — Express API, Hermes preview, Preferences AI provisioning, Stripe Checkout, unlock pages, pitch deck generation, webhook handler
- `agent_coordinator.py` — Discord concierge flow for slash-command usage
- `tests/*.mjs` — Node regression tests for frontend copy, Hermes prompt shape, provisioning behavior, and pitch deck generation
- `tests/test_preferencesai_simulation_payload.py` — Python payload tests for the Discord coordinator
- `ecosystem.config.cjs` — PM2 process names for this standalone copy

## Pitch deck add-on

After the base unlock is paid, the `/success` page offers a second Stripe Checkout for a Hermes Agent-generated investor pitch deck:

1. The user pays `WEB_PITCH_DECK_PRICE_CENTS` via a dedicated Stripe Checkout session (tagged with `metadata.product = 'pitch_deck'` so it can't be satisfied by replaying a base-unlock `session_id`).
2. On return to `/success`, the payment is verified. The download button stays disabled ("Pitch deck creation in progress") until the underlying Preferences AI simulation reaches a terminal state (`completed` or `failed`) — `GET /api/session/:validationId/pitch-deck/status` polls the live simulation status (`public/pitch-deck-status.js` polls this every ~7s from the page, animating a progress bar from the real respondent count), and the page also re-checks once server-side on every `/success` load so it works without JavaScript too.
3. Once the simulation is terminal, that same status check asks Hermes Agent for a structured slide outline (title, problem, solution, target segments, validation findings, business model, go-to-market, ask, next steps) — best-effort enriched with real Preferences AI simulation results (response distributions, respondent quotes) when available — and caches the resulting deck content (not the binary file) on the session. The button then swaps live to an enabled "Download pitch deck (.pptx)" link, with a confetti/toast moment, no page reload required.
4. `GET /api/session/:validationId/pitch-deck/download` renders the cached deck content into a real `.pptx` with [pptxgenjs](https://www.npmjs.com/package/pptxgenjs) (regenerating on the fly if no cached content exists yet). If Hermes ever fails, the deck falls back to a deterministic outline built from the existing validation preview, so the paid deliverable is never blocked by an LLM outage.

The download and status links carry the Stripe `deck_session_id` as a fallback so they still work even if the in-memory/`/tmp` session was evicted between payment and download on Vercel — the same resilience pattern the base unlock already uses for its own checkout recovery.

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

# Pitch deck add-on, sold on the unlocked /success page after the base unlock
WEB_PITCH_DECK_PRODUCT_NAME="Preferences ASP Concierge Investor Pitch Deck"
WEB_PITCH_DECK_PRICE_CENTS=999

# Hermes preview generation
HERMES_PREVIEW_USE_CLI=1
HERMES_COMMAND=hermes
HERMES_PROVIDER=openai-api
HERMES_MODEL=gpt-4o-mini
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
HERMES_MODEL=gpt-4o-mini
OPENAI_API_KEY=...
```

## Vercel deployment notes

For Vercel, do not point `DOMAIN` or Stripe webhooks at an ngrok tunnel. The app now derives the public base URL from the incoming Vercel request host, so checkout success/cancel links use the deployed URL, for example:

```text
https://okx-preferences.vercel.app/success
https://okx-preferences.vercel.app/webhook
```

Recommended Vercel environment variables:

```dotenv
DOMAIN=https://okx-preferences.vercel.app
PREFERENCES_AI_API_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_WEBHOOK_SECRET=...
WEB_PRODUCT_NAME="Preferences ASP Concierge Unlock"

# Set this to 1 only if you want Vercel to generate a live Hermes preview.
HERMES_PREVIEW_USE_CLI=1
HERMES_PROVIDER=gemini-api
HERMES_MODEL=gemini-2.0-flash
GEMINI_API_KEY=...
```

`NGROK_URL` is only for local Discord/tunnel workflows. In Stripe Dashboard, configure the webhook endpoint as your deployed Vercel URL plus `/webhook`, not the old ngrok URL.

On Vercel, `server.js` calls a hosted chat API directly for the free Hermes preview (via `fetch`, requesting JSON-mode output) instead of spawning the `hermes` CLI. A pip-installed CLI can't be bundled reliably into a Vercel serverless function: its venv launcher script bakes in the build container's absolute path, which doesn't exist once the function is deployed, so spawning it fails with `ENOENT` at runtime no matter how it's bundled.

Two providers are supported:

- **Gemini (recommended, free tier)** — set `HERMES_PROVIDER=gemini-api`, `GEMINI_API_KEY=...` (get one at no cost from [Google AI Studio](https://aistudio.google.com/apikey), no credit card required), and optionally `HERMES_MODEL` (defaults to `gemini-2.0-flash`).
- **OpenAI (paid)** — set `HERMES_PROVIDER=openai-api` and `OPENAI_API_KEY=...` instead. Requires OpenAI account credits.

If both `GEMINI_API_KEY` and `OPENAI_API_KEY` are set, Gemini takes priority. If neither is set, or the request fails (e.g. an expired/invalid key, or exhausted quota), the free preview falls back to the deterministic local generator instead of erroring out. Railway/local deployments still install and spawn the real Hermes CLI via `nixpacks.toml`, since those environments keep the same filesystem between build and run.

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
