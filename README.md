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
4. Stripe Checkout — or the OKX Wallet (USDT on X Layer) — sells the full report/dashboard unlock.
5. After payment, the user receives unlocked Preferences AI dashboard links.
6. On the unlocked page, the user can pay for a second add-on (again via Stripe or OKX Wallet): Hermes Agent generates an investor pitch deck (`.pptx`) from the validation preview and Preferences AI simulation data, downloadable once the simulation completes.

## Why it is a real-world ASP

Many builders have ideas but do not know who will buy, what objections matter, or what messaging to test. This ASP packages market research as an agent-discoverable service:

- Input: product/startup/workflow concept
- Agent work: market framing, audience segmentation, survey generation, simulation setup
- Output: validation preview + survey/simulation dashboard links + optional Hermes Agent investor pitch deck
- Monetization: unlock + pitch deck add-on, each payable by Stripe Checkout or OKX Wallet (USDT on X Layer)
- Delivery: web UI and Discord command

## Main files

- `public/index.html` — standalone landing page
- `public/app.js` — browser workflow and status/result rendering
- `public/crypto-pay.js` — vanilla OKX Wallet (EIP-1193) connect + USDT payment helper, shared by the unlock and pitch-deck flows
- `server.js` — Express API, Hermes preview, Preferences AI provisioning, Stripe Checkout, OKX Wallet on-chain payment verification, unlock pages, pitch deck generation, webhook handler
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

## OKX Wallet crypto payment (X Layer / USDT)

Alongside Stripe, both the base unlock and the pitch deck add-on can be paid with the **OKX Wallet** browser extension, in **USDT on X Layer** (OKX's L2, chainId 196). This is a vanilla EIP-1193 integration against the injected `window.okxwallet` provider — **no RainbowKit/Wagmi and no React/build step**, because this app is a static Express-served frontend, not a Next.js app.

**Enable it** by setting one required env var to your own receiving wallet address:

```dotenv
OKX_RECEIVING_ADDRESS=0xYourXLayerWalletAddress
```

If it is unset (or not a valid address), the crypto option stays hidden and only Stripe is offered — so funds are never sent to a placeholder. Everything else has working, live-verified X Layer defaults (USDT `0x1E4a5963aBFD975d8c9021ce480b42188849D41d`, 6 decimals, RPC `https://rpc.xlayer.tech`); see `.env.example` for the optional overrides. The USDT price is derived from `WEB_PRICE_CENTS` / `WEB_PITCH_DECK_PRICE_CENTS` (e.g. `999` → `9.99 USDT`).

**Flow:**

1. `GET /api/crypto/config` returns the public (non-secret) chain/token/amount config the frontend needs. `public/crypto-pay.js` connects the wallet (`eth_requestAccounts`), switches/adds X Layer if needed, and sends a USDT `transfer(...)` to `OKX_RECEIVING_ADDRESS`.
2. The frontend posts the transaction hash to `POST /api/session/:validationId/crypto/verify` (unlock) or `POST /api/session/:validationId/pitch-deck/crypto/verify` (pitch deck).
3. The server **verifies on-chain via RPC** — it never trusts the client's claim. It confirms the transaction succeeded, has the configured number of confirmations, and contains a USDT `Transfer` **log to your address for at least the required amount**, then marks the session paid. A used-transaction guard (`used_crypto_txs.json`) prevents replaying one payment for multiple unlocks. Endpoints return `202` while the tx is still confirming, so the frontend polls until it lands.

**Security notes / limitations:** verification is on-chain and provider-agnostic (any X Layer RPC), but the replay guard and paid state live in the same file-based session store the rest of the app uses, so on Vercel's ephemeral `/tmp` they are best-effort across cold instances (fine for an MVP; use a shared DB/KV for production hardening). Always verify the USDT contract address on the [X Layer explorer](https://www.oklink.com/xlayer) before changing chains or tokens.

### Free testnet demo mode (spend nothing)

To exercise the OKX Wallet flow for a demo without spending any crypto, set `OKX_TEST_MODE=1` and point the chain/RPC at X Layer **testnet**:

```dotenv
OKX_TEST_MODE=1
OKX_CHAIN_ID=1952
OKX_CHAIN_NAME=X Layer Testnet
OKX_RPC_URL=https://testrpc.xlayer.tech
OKX_BLOCK_EXPLORER_URL=https://www.oklink.com/xlayer-test
OKX_MIN_CONFIRMATIONS=0
OKX_RECEIVING_ADDRESS=0xYourTestnetWalletAddress
```

In test mode the required amount is **0** and the payment becomes a plain **zero-value native transfer** to the receiving address (no USDT/token contract involved), so it works on testnet with no real funds — you only need free testnet OKB for gas from the [X Layer faucet](https://www.okx.com/xlayer/faucet). It is still a real, confirmed, explorer-visible transaction (the server verifies the receipt on-chain), so it shows up in a demo. The button/label reads "0 USDT (testnet demo)" and Stripe prices are unaffected. Set `OKX_TEST_MODE=0` (or remove it) and switch the chain/RPC back to mainnet to charge real USDT again.

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

# OKX Wallet crypto payment (X Layer / USDT). Set your own receiving address to
# enable it; leave unset to keep only Stripe. See "OKX Wallet crypto payment".
OKX_RECEIVING_ADDRESS=0xYourXLayerWalletAddress

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
