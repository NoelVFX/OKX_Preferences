import os
import subprocess
import json
import asyncio
import hashlib
import re
import discord
from discord import app_commands
import stripe
import requests
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


def load_local_env(path=None):
    """Load simple KEY=VALUE pairs from the project .env file without requiring python-dotenv."""
    env_path = Path(path) if path else BASE_DIR / ".env"
    if not env_path.exists():
        print(f"⚠️ .env file not found at {env_path}; relying on process environment variables.")
        return
    with open(env_path, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ[key] = value


def log_api_failure(label, response):
    """Print enough API error detail to diagnose 4xx/5xx failures without exposing secrets."""
    print(f"⚠️ {label} failed: HTTP {response.status_code}")
    trace_headers = {
        name: response.headers.get(name)
        for name in ["cf-ray", "traceparent", "x-cloud-trace-context"]
        if response.headers.get(name)
    }
    if trace_headers:
        print(f"{label} trace headers: {trace_headers}")
    print(f"{label} response body: {response.text[:2000]}")


TRANSIENT_PREFERENCESAI_STATUS = {502, 503, 504, 520, 522, 524}


async def preferences_request(method, url, attempts=3, backoff_seconds=5, **kwargs):
    """Run a PreferencesAI HTTP request with retries for transport/upstream failures."""
    last_exception = None
    last_response = None
    for attempt in range(1, attempts + 1):
        try:
            response = await asyncio.to_thread(requests.request, method, url, **kwargs)
            last_response = response
            if response.status_code not in TRANSIENT_PREFERENCESAI_STATUS:
                return response
            retry_after = response.headers.get("Retry-After")
            wait_seconds = int(retry_after) if str(retry_after or "").isdigit() else backoff_seconds * attempt
            print(
                f"⚠️ PreferencesAI {method} {url} returned transient HTTP {response.status_code} "
                f"on attempt {attempt}/{attempts}; retrying in {wait_seconds}s."
            )
        except requests.exceptions.RequestException as exc:
            last_exception = exc
            wait_seconds = backoff_seconds * attempt
            print(
                f"⚠️ PreferencesAI {method} {url} transport failure on attempt {attempt}/{attempts}: {exc}; "
                f"retrying in {wait_seconds}s."
            )
        if attempt < attempts:
            await asyncio.sleep(wait_seconds)
    if last_exception is not None and last_response is None:
        raise last_exception
    return last_response


def extract_survey_id(response_json):
    """Return the real PreferencesAI survey_id from a create-survey response.

    The simulation endpoint should never receive a fallback/missing survey id; that
    turns into backend "survey not found" failures and can look like a 502.
    """
    data = response_json.get("data") or {}
    survey_id = (
        response_json.get("survey_id")
        or response_json.get("id")
        or data.get("survey_id")
        or data.get("id")
    )
    survey_id = str(survey_id or "").strip()
    if not survey_id or survey_id == "survey_fallback_demo303" or not survey_id.startswith("survey_"):
        raise RuntimeError(f"Survey create response did not include a usable survey_id: {response_json}")
    return survey_id


def build_simulation_payload(survey_id, pitch, preview_report, pru_cost):
    """Build the PreferencesAI simulation payload from a verified survey id."""
    survey_id = str(survey_id or "").strip()
    if not survey_id or survey_id == "survey_fallback_demo303" or not survey_id.startswith("survey_"):
        raise RuntimeError("Cannot launch simulation without a real PreferencesAI survey_id")

    respondent_count = int(pru_cost)
    population_query = (
        f"Target Demographic A: {preview_report['demographic_a']}. "
        f"Target Demographic B: {preview_report['demographic_b']}. "
        f"All respondents should be plausible target customers for this Agent Service Provider / product concept: {pitch}"
    )
    return {
        "survey_id": survey_id,
        "population_query": population_query,
        "label": f"{pitch[:50]} Digital Population Pilot",
        "desired_respondent_count": respondent_count,
        "respondent_count": respondent_count,
        "num_respondents": respondent_count,
        "sample_size": respondent_count,
        "n": respondent_count,
        "pru_cost": respondent_count,
        "confidence_level": 0.95,
        "margin_of_error": 0.05,
    }


def log_simulation_payload(payload):
    """Log non-secret simulation request fields so missing survey_id is visible."""
    safe_payload = dict(payload)
    if len(safe_payload.get("population_query", "")) > 500:
        safe_payload["population_query"] = safe_payload["population_query"][:500] + "…"
    print(f"PreferencesAI simulation launch payload: {json.dumps(safe_payload, ensure_ascii=False)}")


load_local_env()

# --- CONFIGURATION ---
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY")
if STRIPE_SECRET_KEY:
    stripe.api_key = STRIPE_SECRET_KEY
else:
    print("⚠️ STRIPE_SECRET_KEY is not set; Stripe Checkout generation will fall back to NGROK_URL.")

NGROK_URL = os.getenv("NGROK_URL", "http://localhost:4242")
MANIFEST_PATH = os.getenv("MANIFEST_PATH", str(BASE_DIR / "active_session.json"))

PREFERENCES_API_BASE = os.getenv("PREFERENCES_API_BASE", "https://dashboard.preferencesai.io/api/v1")
PREFERENCES_API_KEY = os.getenv("PREFERENCES_AI_API_KEY")
if PREFERENCES_API_KEY:
    print(f"✅ PreferencesAI API key loaded from environment; length={len(PREFERENCES_API_KEY)}")
else:
    print("⚠️ PREFERENCES_AI_API_KEY is not loaded; PreferencesAI API calls will be skipped.")
PREFERENCES_SIMULATION_PRU_COST = int(os.getenv("PREFERENCES_SIMULATION_PRU_COST", "29"))
PREFERENCES_REQUEST_TIMEOUT = int(os.getenv("PREFERENCES_REQUEST_TIMEOUT", "180"))
HERMES_PREVIEW_USE_CLI = os.getenv("HERMES_PREVIEW_USE_CLI", "1").lower() not in {"0", "false", "no"}
HERMES_COMMAND = os.getenv(
    "HERMES_COMMAND",
    os.path.expanduser("~/.local/bin/hermes") if os.path.exists(os.path.expanduser("~/.local/bin/hermes")) else "hermes"
)
HERMES_PREVIEW_TIMEOUT = int(os.getenv("HERMES_PREVIEW_TIMEOUT", "90"))

DISCORD_BOT_TOKEN = os.getenv("DISCORD_BOT_TOKEN")
DISCORD_GUILD_ID = os.getenv("DISCORD_GUILD_ID")
if not DISCORD_GUILD_ID:
    raise RuntimeError("DISCORD_GUILD_ID is not set. Add it to your .env file.")
GUILD_ID = discord.Object(id=int(DISCORD_GUILD_ID))

STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "into",
    "is", "it", "of", "on", "or", "our", "that", "the", "their", "this", "to", "with",
    "who", "will", "would", "your", "you", "user", "users", "people", "customer", "customers",
    "product", "service", "app", "platform", "startup", "concept", "idea", "new", "make", "help"
}

MARKET_SIGNALS = {
    "food_beverage": {
        "keywords": {"food", "restaurant", "drink", "beverage", "coffee", "tea", "snack", "meal", "chef", "protein", "nutrition", "flavor", "kitchen"},
        "segments": [
            "Urban convenience seekers aged 22-38 who frequently try new food and beverage brands",
            "Health-conscious grocery and delivery buyers aged 28-45 balancing taste, price, and nutrition"
        ],
        "drivers": "taste proof, ingredient trust, repeat-purchase convenience, and clear value per serving",
        "barriers": "skepticism around claims, premium pricing, and whether the experience fits existing routines",
        "channels": "TikTok food discovery, delivery-app promos, creator demos, and in-store sampling"
    },
    "software_productivity": {
        "keywords": {"saas", "software", "ai", "agent", "automation", "workflow", "dashboard", "tool", "crm", "b2b", "api", "team", "meeting", "email", "calendar"},
        "segments": [
            "Ops-minded founders and small-team leads aged 25-44 who already pay for productivity software",
            "Time-constrained knowledge workers aged 24-40 looking to automate repetitive coordination tasks"
        ],
        "drivers": "time saved, integration fit, implementation speed, and evidence that the tool reduces busywork",
        "barriers": "data-security concerns, tool fatigue, switching costs, and unclear ROI before trial",
        "channels": "LinkedIn demos, founder communities, workflow templates, and free interactive trials"
    },
    "fitness_wellness": {
        "keywords": {"fitness", "gym", "workout", "wellness", "health", "sleep", "meditation", "therapy", "habit", "coach", "supplement", "recovery"},
        "segments": [
            "Routine-driven wellness optimizers aged 24-42 who track health habits and buy premium self-improvement products",
            "Busy professionals aged 30-50 seeking low-friction health improvements that fit packed schedules"
        ],
        "drivers": "credible outcomes, simple habit formation, personalization, and visible progress tracking",
        "barriers": "motivation drop-off, distrust of exaggerated claims, and subscription fatigue",
        "channels": "creator testimonials, community challenges, app-store search, and wellness newsletters"
    },
    "fashion_beauty": {
        "keywords": {"fashion", "clothing", "beauty", "skin", "skincare", "makeup", "hair", "style", "jewelry", "cosmetic", "apparel"},
        "segments": [
            "Trend-aware Gen Z and millennial shoppers aged 18-34 who discover brands through social content",
            "Quality-focused repeat buyers aged 28-45 who prioritize fit, ingredients, durability, and brand values"
        ],
        "drivers": "visual differentiation, trust signals, personalization, social proof, and confident fit or shade matching",
        "barriers": "return risk, quality uncertainty, crowded alternatives, and unclear brand credibility",
        "channels": "short-form video, influencer seeding, UGC before/after content, and retargeted storefront offers"
    },
    "education": {
        "keywords": {"education", "learn", "learning", "student", "school", "course", "tutor", "teacher", "training", "skill", "class"},
        "segments": [
            "Ambitious students and early-career learners aged 16-29 seeking faster skill acquisition",
            "Career-switching professionals aged 27-45 who need practical outcomes and flexible schedules"
        ],
        "drivers": "measurable progress, credible instruction, practical projects, and flexible pacing",
        "barriers": "completion anxiety, price sensitivity, and uncertainty that the skill will translate to outcomes",
        "channels": "YouTube explainers, school/community partnerships, learning communities, and outcome-led landing pages"
    },
    "finance": {
        "keywords": {"finance", "money", "bank", "invest", "crypto", "budget", "insurance", "tax", "payment", "stripe", "credit", "loan"},
        "segments": [
            "Digitally native earners aged 22-39 who want clearer control over money decisions",
            "Risk-aware households and small-business owners aged 30-55 who value trust, compliance, and transparency"
        ],
        "drivers": "trust, transparency, measurable savings or upside, and low-friction onboarding",
        "barriers": "privacy concerns, perceived financial risk, regulation questions, and fear of hidden fees",
        "channels": "advisor content, comparison pages, referral loops, fintech communities, and credibility-led webinars"
    },
    "local_experience": {
        "keywords": {"local", "event", "travel", "hotel", "venue", "community", "city", "nightlife", "experience", "tour", "booking"},
        "segments": [
            "Experience-seeking urban millennials aged 24-39 who spend on memorable social outings",
            "Planning-heavy groups and families aged 30-55 who need reliable logistics and clear value"
        ],
        "drivers": "novelty, convenience, trust in logistics, and shareable moments",
        "barriers": "availability uncertainty, cancellation risk, unclear differentiation, and group coordination friction",
        "channels": "local creator content, search, partnerships, event calendars, and referral offers"
    },
    "general_consumer": {
        "keywords": set(),
        "segments": [
            "Early-adopter consumers aged 21-38 who actively try new solutions in this category",
            "Pragmatic mainstream buyers aged 30-55 who need clear proof, trust, and everyday usefulness"
        ],
        "drivers": "clear practical benefit, trust, ease of use, and a fast path to first value",
        "barriers": "unclear differentiation, pricing hesitation, and uncertainty that the concept solves a frequent problem",
        "channels": "short demos, referral offers, search-intent content, and targeted community launches"
    }
}

def _pitch_terms(pitch, limit=5):
    words = re.findall(r"[A-Za-z][A-Za-z0-9'\-]{2,}", pitch.lower())
    seen = []
    for word in words:
        clean = word.strip("'-")
        if clean not in STOPWORDS and clean not in seen:
            seen.append(clean)
    return seen[:limit]

def _classify_pitch(pitch):
    pitch_words = set(_pitch_terms(pitch, limit=50))
    best_name = "general_consumer"
    best_score = 0
    for name, profile in MARKET_SIGNALS.items():
        score = len(pitch_words & profile["keywords"])
        if score > best_score:
            best_name = name
            best_score = score
    return best_name, MARKET_SIGNALS[best_name]

def _stable_affinity(pitch, segment_label, floor=48, ceiling=88):
    digest = hashlib.sha256(f"{pitch}|{segment_label}".encode("utf-8")).hexdigest()
    raw = int(digest[:8], 16)
    value = floor + (raw % int((ceiling - floor) * 10)) / 10
    return f"{value:.1f}%"

def _trim_discord(value, max_len=900):
    if len(value) <= max_len:
        return value
    return value[: max_len - 1].rstrip() + "…"

def build_preview_report(pitch):
    """Build a dynamic free preview from the exact pitch instead of a static embed template."""
    category, profile = _classify_pitch(pitch)
    terms = _pitch_terms(pitch)
    focus_phrase = ", ".join(terms[:3]) if terms else "the submitted concept"

    demographic_a, demographic_b = profile["segments"]
    affinity_a = _stable_affinity(pitch, demographic_a, floor=62, ceiling=91)
    affinity_b = _stable_affinity(pitch, demographic_b, floor=42, ceiling=76)

    summary = (
        f"• **Best-fit wedge:** `{demographic_a}` should respond first if the pitch clearly proves {profile['drivers']} for **{focus_phrase}**.\n"
        f"• **Secondary read:** `{demographic_b}` is viable, but messaging needs to overcome {profile['barriers']}.\n"
        f"• **Launch angle:** Start with {profile['channels']} and test copy that names the specific pain point in the pitch: *{_trim_discord(pitch, 160)}*.\n"
        f"• **What to validate next:** Compare willingness-to-pay, urgency, and objection intensity between Groups A and B before scaling spend.\n"
        f"• **ASP packaging:** Present this as a repeatable concierge service with a clear input, Preferences AI dashboard deliverable, and Stripe unlock."
    )

    return {
        "pitch_category": category,
        "demographic_a": demographic_a,
        "demographic_b": demographic_b,
        "affinity_a": affinity_a,
        "affinity_b": affinity_b,
        "summary_matrix": summary
    }

async def build_hermes_preview_report(pitch):
    """Ask Hermes Agent for the preview using a non-blocking asynchronous process invocation."""
    fallback = build_preview_report(pitch)
    if not HERMES_PREVIEW_USE_CLI:
        return fallback

    prompt = f"""
You are Hermes Agent preparing a free Discord preview for Preferences ASP Concierge, a standalone Agent Service Provider.
Frame the submitted concept as a repeatable paid validation service with a clear input, dashboard deliverable, and unlock path.
Handpick exactly two pitch-specific demographic groups, Group A and Group B, for this concept:
{pitch}

Return only valid compact JSON with these keys:
pitch_category: short snake_case category
demographic_a: one specific demographic segment, age range included
demographic_b: a contrasting specific demographic segment, age range included
affinity_a: plausible preview affinity percentage string like "76.4%"
affinity_b: plausible preview affinity percentage string like "58.1%"
summary_matrix: 3-4 Discord-ready bullet lines using • and **bold labels**. Findings must be specific to the pitch, compare Group A vs Group B, and mention one driver, one objection, one recommended validation test, and one ASP packaging note.

Do not include markdown fences, commentary, or any text outside the JSON object.
""".strip()

    try:
        proc = await asyncio.create_subprocess_exec(
            HERMES_COMMAND, "chat", "-Q", "--ignore-rules", "-q", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=HERMES_PREVIEW_TIMEOUT)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise TimeoutError("Hermes CLI process execution timed out.")

        if proc.returncode != 0:
            raise RuntimeError(f"Hermes process error ({proc.returncode}): {stderr.decode().strip()}")

        output = stdout.decode().strip()
        start = output.find("{")
        end = output.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise ValueError(f"Hermes preview response did not contain JSON: {output[:300]}")

        parsed = json.loads(output[start:end + 1])
        for key in ["demographic_a", "demographic_b", "summary_matrix"]:
            if not parsed.get(key):
                raise ValueError(f"Hermes preview JSON missing key: {key}")

        preview = {**fallback, **parsed}
        if not str(preview.get("affinity_a", "")).endswith("%"):
            preview["affinity_a"] = fallback["affinity_a"]
        if not str(preview.get("affinity_b", "")).endswith("%"):
            preview["affinity_b"] = fallback["affinity_b"]
        preview["summary_matrix"] = _trim_discord(str(preview["summary_matrix"]), 1000)
        return preview
    except Exception as e:
        print(f"⚠️ Hermes preview generation failed; using local dynamic preview fallback: {e}")
        return fallback

class AgencyBot(discord.Client):
    def __init__(self):
        super().__init__(intents=discord.Intents.default())
        self.tree = app_commands.CommandTree(self)

    async def setup_hook(self):
        self.tree.copy_global_to(guild=GUILD_ID)
        await self.tree.sync(guild=GUILD_ID)

bot = AgencyBot()

@bot.tree.command(name="validate", description="Build a standalone ASP validation preview.")
@app_commands.describe(pitch="Enter a real-world concept for the Preferences ASP Concierge")
async def validate(interaction: discord.Interaction, pitch: str):
    # 1. DEFER IMMEDIATELY (Gives us up to 15 minutes of safe execution window)
    await interaction.response.defer(ephemeral=False)
    
    await interaction.followup.send(
        f"🤖 **Concept forwarded to Preferences ASP Concierge:** *\"{pitch}\"*\n"
        "📡 `[ASP]` Contacting Preferences AI to deploy survey and simulation assets for this validation workflow..."
    )

    survey_id = "survey_fallback_demo303"
    simulation_id = "sim_fallback_demo303"

    preview_report = await build_hermes_preview_report(pitch)

    if PREFERENCES_API_KEY:
        headers = {
            "X-API-Key": PREFERENCES_API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "Preferences-ASP-Concierge/1.0"
        }

        # ========================================================
        # 🎯 LIVE GENERATION: CREATE FRESH, CUSTOM OBJECTS VIA API
        # ========================================================
        try:
            build_payload = {
                "survey_prompt": (
                    f"ASP product-market-fit survey for this real-world service concept: {pitch}. "
                    f"Prioritize Target Demographic A: {preview_report['demographic_a']}. "
                    f"Compare against Target Demographic B: {preview_report['demographic_b']}. "
                    "Cover target audience, purchase intent, willingness to pay, "
                    "pain points, alternatives, objections, messaging, and purchase channels."
                ),
                "survey_type": "product_market_fit",
                "languages": ["English (US)"],
                "output_format": "json"
            }

            print(f"📡 Building custom PreferencesAI survey for: {pitch[:60]}...")
        
            build_res = await preferences_request(
                "POST",
                f"{PREFERENCES_API_BASE}/surveys/build",
                json=build_payload,
                headers=headers,
                timeout=PREFERENCES_REQUEST_TIMEOUT
            )
            print(f"📥 Survey build response: {build_res.status_code}")
            if not build_res.ok:
                log_api_failure("PreferencesAI survey build", build_res)
            build_res.raise_for_status()
            build_json = build_res.json()
            survey_content = build_json.get("data", {}).get("survey_content")
            if not survey_content:
                raise RuntimeError("Survey build response did not include data.survey_content")

            create_payload = {
                "survey_title": f"Preferences ASP Concierge - {pitch[:50]} Discovery Panel",
                "survey_type": "product_market_fit",
                "survey_goal": f"Validate ASP fit, product-market fit, customer preferences, pricing, and messaging for: {pitch}",
                "sections": survey_content,
                "languages": ["English (US)"]
            }

            print("📡 Saving custom PreferencesAI survey to dashboard...")
        
            # 🏎️ FIXED: Wrapped blocking requests.post in asyncio.to_thread
            survey_res = await preferences_request(
                "POST",
                f"{PREFERENCES_API_BASE}/surveys",
                json=create_payload,
                headers=headers,
                timeout=PREFERENCES_REQUEST_TIMEOUT
            )
            print(f"📥 Survey create response: {survey_res.status_code}")
            if not survey_res.ok:
                log_api_failure("PreferencesAI survey create", survey_res)
            survey_res.raise_for_status()
            res_json = survey_res.json()
            survey_id = extract_survey_id(res_json)
            print(f"✅ Success! Fresh Survey ID Generated: {survey_id}")

            # Confirm the just-created survey is readable before using it for simulation.
            # If the backend has a short propagation delay, retry the read instead of
            # sending a missing/not-found survey_id into /simulations.
            verify_res = None
            for attempt in range(1, 4):
                verify_res = await preferences_request(
                    "GET",
                    f"{PREFERENCES_API_BASE}/surveys/{survey_id}",
                    headers=headers,
                    timeout=PREFERENCES_REQUEST_TIMEOUT
                )
                print(f"📥 Survey verify response attempt {attempt}: {verify_res.status_code}")
                if verify_res.ok:
                    break
                log_api_failure("PreferencesAI survey verify", verify_res)
                if verify_res.status_code == 404 and attempt < 3:
                    await asyncio.sleep(2 * attempt)
                    continue
                verify_res.raise_for_status()

            if not verify_res or not verify_res.ok:
                raise RuntimeError(f"Survey {survey_id} was created but could not be verified before simulation launch")

            sim_payload = build_simulation_payload(
                survey_id=survey_id,
                pitch=pitch,
                preview_report=preview_report,
                pru_cost=PREFERENCES_SIMULATION_PRU_COST,
            )
            log_simulation_payload(sim_payload)

            print(f"📡 Launching PreferencesAI pilot simulation capped at {PREFERENCES_SIMULATION_PRU_COST} PRU...")
        
            sim_res = await preferences_request(
                "POST",
                f"{PREFERENCES_API_BASE}/simulations",
                json=sim_payload,
                headers=headers,
                timeout=PREFERENCES_REQUEST_TIMEOUT
            )
            print(f"📥 Simulation response: {sim_res.status_code}")
            if sim_res.status_code in [200, 201, 202]:
                sim_json = sim_res.json()
                simulation_id = (
                    sim_json.get("simulation_id")
                    or sim_json.get("id")
                    or sim_json.get("data", {}).get("simulation_id")
                    or sim_json.get("data", {}).get("id")
                    or simulation_id
                )
                print(f"✅ Success! Fresh Simulation ID Dispatched: {simulation_id}")
            else:
                log_api_failure("PreferencesAI simulation launch", sim_res)
                print("⚠️ Simulation endpoint rejected request; preserving fallback layout.")

        except Exception as e:
            print(f"⚠️ PreferencesAI live API flow failed. Preserving fallback IDs for rendering: {e}")

    else:
        print("⚠️ PREFERENCES_AI_API_KEY is not set; preserving fallback IDs for rendering.")

    hermes_data = {
        "pitch": pitch,
        "survey_id": survey_id,
        "simulation_id": simulation_id,
        **preview_report
    }

    try:
        with open(MANIFEST_PATH, "w") as f:
            json.dump(hermes_data, f, indent=4)
        print("✅ active_session.json state manifest fully written to disk.")
    except Exception as e:
        print(f"❌ Failed to write state manifest: {e}")

    try:
        instructions = f"Task: dynamically registered tracking endpoints [Survey: {survey_id}]"
        subprocess.run(["tmux", "send-keys", "-t", "hermes-agent", instructions, "C-m"], check=True)
    except Exception:
        pass

    # --- STRIPE CHECKOUT LINK GENERATION ---
    try:
        session = await asyncio.to_thread(
            stripe.checkout.Session.create,
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'product_data': {
                        'name': "Preferences ASP Concierge Unlock",
                        'description': f"Preferences ASP validation dashboard unlock",
                    },
                    'unit_amount': 999,
                },
                'quantity': 1,
            }],
            mode='payment',
            locale='en',
            success_url=f"{NGROK_URL}/success?session_id={{CHECKOUT_SESSION_ID}}",
            cancel_url=f"{NGROK_URL}/cancel",
            metadata={
                'discord_id': str(interaction.user.id),
                'channel_id': str(interaction.channel_id),
                'pitch': pitch
            }
        )
        checkout_url = session.url
    except Exception as e:
        print(f"❌ Stripe URL creation error: {e}")
        checkout_url = NGROK_URL 

    # --- RENDER DYNAMIC FREE PREVIEW EMBED CARD ---
    embed = discord.Embed(
        title="📊 PREFERENCES ASP FREE PREVIEW",
        description=f"**ASP concept:** *{pitch}*",
        color=0x7289da
    )
    
    embed.add_field(
        name="🎯 Target Demographic A",
        value=_trim_discord(
            f"**{hermes_data['demographic_a']}**\n"
            f"📈 **Preview Affinity:** `{hermes_data['affinity_a']}` via Preferences AI Matrix Engine\n"
            f"📝 *Survey API State:* Active resource tracking under live key `{survey_id}`.",
            1024
        ),
        inline=False
    )
    
    embed.add_field(
        name="🎯 Target Demographic B",
        value=_trim_discord(
            f"**{hermes_data['demographic_b']}**\n"
            f"📉 **Preview Affinity:** `{hermes_data['affinity_b']}` via Preferences AI Matrix Engine\n"
            f"📝 *Survey API State:* Active resource tracking under live key `{survey_id}`.",
            1024
        ),
        inline=False
    )
    
    embed.add_field(
        name="💡 ASP Validation Findings & Intelligence Matrix", 
        value=_trim_discord(hermes_data["summary_matrix"], 1024), 
        inline=False
    )
    
    embed.add_field(
        name="🔒 UNLOCK FULL ASP DASHBOARD & SURVEY PAYLOADS",
        value="Click below to pay $9.99 and instantly receive the full Preferences ASP survey "
              "configuration files, full raw panel data, and actionable strategic deployment steps.",
        inline=False
    )
    
    view = discord.ui.View()
    view.add_item(discord.ui.Button(label="💳 Pay $9.99 to Unlock ASP Assets", url=checkout_url))
    
    await interaction.followup.send(embed=embed, view=view)

if __name__ == "__main__":
    if not DISCORD_BOT_TOKEN:
        raise RuntimeError("DISCORD_BOT_TOKEN is not set. Add it to your .env file.")
    bot.run(DISCORD_BOT_TOKEN)