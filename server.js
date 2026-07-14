import express from 'express';
import Stripe from 'stripe';
import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

// Vercel's build bundles this ESM ("type": "module") codebase, and its
// bundler resolves `import PptxGenJS from 'pptxgenjs'` to the package's
// dist/pptxgen.es.js build (an ES module) but then loads it through Node's
// CommonJS loader at runtime, which fails with "Cannot use import statement
// outside a module". Forcing an explicit require() here always resolves the
// package's "require" export condition (dist/pptxgen.cjs.js) instead,
// sidestepping that dual-package resolution mismatch. Plain `node server.js`
// (local/Railway) was never affected; only Vercel's bundled output was.
const require = createRequire(import.meta.url);
const PptxGenJS = require('pptxgenjs');

function isVercelRuntime() {
  return process.env.VERCEL === '1' || Boolean(process.env.VERCEL_URL);
}

const app = express();
const port = Number(process.env.PORT || 4242);
const localDefaultDomain = `http://localhost:${port}`;
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const IS_VERCEL = isVercelRuntime();
const RUNTIME_WRITABLE_DIR = IS_VERCEL ? '/tmp' : __dirname;

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PREFERENCES_API_BASE = process.env.PREFERENCES_API_BASE || 'https://dashboard.preferencesai.io/api/v1';
const PREFERENCES_API_KEY = process.env.PREFERENCES_AI_API_KEY;
const PREFERENCES_REQUEST_TIMEOUT = Number(process.env.PREFERENCES_REQUEST_TIMEOUT || 180) * 1000;
const WEB_RUN_LIVE_SIMULATION = !['0', 'false', 'no'].includes(String(process.env.WEB_RUN_LIVE_SIMULATION || '1').toLowerCase());
const WEB_REQUIRE_PAYMENT_FOR_DASHBOARD_LINKS = !['0', 'false', 'no'].includes(String(process.env.WEB_REQUIRE_PAYMENT_FOR_DASHBOARD_LINKS || '1').toLowerCase());
const WEB_PRICE_CENTS = Number(process.env.WEB_PRICE_CENTS || 999);
const WEB_PRICE_CURRENCY = process.env.WEB_PRICE_CURRENCY || 'usd';
const WEB_PRODUCT_NAME = process.env.WEB_PRODUCT_NAME || 'Preferences ASP Concierge Unlock';
const WEB_PITCH_DECK_PRICE_CENTS = Number(process.env.WEB_PITCH_DECK_PRICE_CENTS || WEB_PRICE_CENTS);
const WEB_PITCH_DECK_PRODUCT_NAME = process.env.WEB_PITCH_DECK_PRODUCT_NAME || 'Preferences ASP Concierge Investor Pitch Deck';
const SESSION_STORE_PATH = process.env.WEB_SESSION_STORE_PATH || path.join(RUNTIME_WRITABLE_DIR, 'web_sessions.json');
const ACTIVE_MANIFEST_PATH = process.env.MANIFEST_PATH || path.join(RUNTIME_WRITABLE_DIR, 'active_session.json');
const STATIC_DIR = path.join(__dirname, 'public');
const HERMES_PREVIEW_USE_CLI = !['0', 'false', 'no'].includes(String(process.env.HERMES_PREVIEW_USE_CLI || '1').toLowerCase());
const bundledHermesCommand = path.join(__dirname, '.vercel-hermes', 'bin', 'hermes');
function resolveHermesCommand() {
  const configured = process.env.HERMES_COMMAND || '';
  if (IS_VERCEL && fs.existsSync(bundledHermesCommand) && (!configured || configured === 'hermes')) return bundledHermesCommand;
  if (configured) return configured;
  if (fs.existsSync(bundledHermesCommand)) return bundledHermesCommand;
  return process.env.HOME ? path.join(process.env.HOME, '.local/bin/hermes') : 'hermes';
}
const HERMES_COMMAND = resolveHermesCommand();
const HERMES_PREVIEW_TIMEOUT = Number(process.env.HERMES_PREVIEW_TIMEOUT || 90) * 1000;
const HERMES_PROVIDER = process.env.HERMES_PROVIDER || (
  IS_VERCEL && process.env.GEMINI_API_KEY ? 'gemini-api' :
  IS_VERCEL && process.env.OPENAI_API_KEY ? 'openai-api' : ''
);
const HERMES_MODEL = process.env.HERMES_MODEL || (
  HERMES_PROVIDER === 'gemini-api' ? 'gemini-2.0-flash' :
  HERMES_PROVIDER === 'openai-api' ? 'gpt-4o-mini' : ''
);

if (!PREFERENCES_API_KEY) {
  console.warn('⚠️ PREFERENCES_AI_API_KEY is not set; web validations will render a dynamic preview but skip live Preferences AI API provisioning.');
}
if (!stripe) {
  console.warn('⚠️ STRIPE_SECRET_KEY is not set; paid web unlock checkout links cannot be created.');
}
if (!DISCORD_WEBHOOK_URL) {
  console.warn('⚠️ DISCORD_WEBHOOK_URL is not set; Stripe webhook Discord unlock delivery is disabled unless DISCORD_BOT_TOKEN + metadata channel/user is present.');
}
if (HERMES_PREVIEW_USE_CLI) {
  const activeRunner = defaultHermesRunner();
  const runnerLabel = activeRunner === runHermesViaGeminiApi ? 'Gemini API'
    : activeRunner === runHermesViaOpenAiApi ? 'OpenAI API'
    : `CLI (command=${HERMES_COMMAND})`;
  console.log(`Hermes preview enabled: runner=${runnerLabel} provider=${HERMES_PROVIDER || '(default config)'} model=${HERMES_MODEL || '(default config)'} timeout=${HERMES_PREVIEW_TIMEOUT}ms`);
}

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'in', 'into', 'is', 'it', 'of', 'on', 'or', 'our',
  'that', 'the', 'their', 'this', 'to', 'with', 'who', 'will', 'would', 'your', 'you', 'user', 'users', 'people',
  'customer', 'customers', 'product', 'service', 'app', 'platform', 'startup', 'concept', 'idea', 'new', 'make', 'help'
]);

const MARKET_SIGNALS = {
  food_beverage: {
    keywords: ['food', 'restaurant', 'drink', 'beverage', 'coffee', 'tea', 'snack', 'meal', 'chef', 'protein', 'nutrition', 'flavor', 'kitchen'],
    segments: [
      'Urban convenience seekers aged 22-38 who frequently try new food and beverage brands',
      'Health-conscious grocery and delivery buyers aged 28-45 balancing taste, price, and nutrition'
    ],
    drivers: 'taste proof, ingredient trust, repeat-purchase convenience, and clear value per serving',
    barriers: 'skepticism around claims, premium pricing, and whether the experience fits existing routines',
    channels: 'TikTok food discovery, delivery-app promos, creator demos, and in-store sampling'
  },
  software_productivity: {
    keywords: ['saas', 'software', 'ai', 'agent', 'automation', 'workflow', 'dashboard', 'tool', 'crm', 'b2b', 'api', 'team', 'meeting', 'email', 'calendar'],
    segments: [
      'Ops-minded founders and small-team leads aged 25-44 who already pay for productivity software',
      'Time-constrained knowledge workers aged 24-40 looking to automate repetitive coordination tasks'
    ],
    drivers: 'time saved, integration fit, implementation speed, and evidence that the tool reduces busywork',
    barriers: 'data-security concerns, tool fatigue, switching costs, and unclear ROI before trial',
    channels: 'LinkedIn demos, founder communities, workflow templates, and free interactive trials'
  },
  fitness_wellness: {
    keywords: ['fitness', 'gym', 'workout', 'wellness', 'health', 'sleep', 'meditation', 'therapy', 'habit', 'coach', 'supplement', 'recovery'],
    segments: [
      'Routine-driven wellness optimizers aged 24-42 who track health habits and buy premium self-improvement products',
      'Busy professionals aged 30-50 seeking low-friction health improvements that fit packed schedules'
    ],
    drivers: 'credible outcomes, simple habit formation, personalization, and visible progress tracking',
    barriers: 'motivation drop-off, distrust of exaggerated claims, and subscription fatigue',
    channels: 'creator testimonials, community challenges, app-store search, and wellness newsletters'
  },
  fashion_beauty: {
    keywords: ['fashion', 'clothing', 'beauty', 'skin', 'skincare', 'makeup', 'hair', 'style', 'jewelry', 'cosmetic', 'apparel'],
    segments: [
      'Trend-aware Gen Z and millennial shoppers aged 18-34 who discover brands through social content',
      'Quality-focused repeat buyers aged 28-45 who prioritize fit, ingredients, durability, and brand values'
    ],
    drivers: 'visual differentiation, trust signals, personalization, social proof, and confident fit or shade matching',
    barriers: 'return risk, quality uncertainty, crowded alternatives, and unclear brand credibility',
    channels: 'short-form video, influencer seeding, UGC before/after content, and retargeted storefront offers'
  },
  education: {
    keywords: ['education', 'learn', 'learning', 'student', 'school', 'course', 'tutor', 'teacher', 'training', 'skill', 'class'],
    segments: [
      'Ambitious students and early-career learners aged 16-29 seeking faster skill acquisition',
      'Career-switching professionals aged 27-45 who need practical outcomes and flexible schedules'
    ],
    drivers: 'measurable progress, credible instruction, practical projects, and flexible pacing',
    barriers: 'completion anxiety, price sensitivity, and uncertainty that the skill will translate to outcomes',
    channels: 'YouTube explainers, school/community partnerships, learning communities, and outcome-led landing pages'
  },
  finance: {
    keywords: ['finance', 'money', 'bank', 'invest', 'crypto', 'budget', 'insurance', 'tax', 'payment', 'stripe', 'credit', 'loan'],
    segments: [
      'Digitally native earners aged 22-39 who want clearer control over money decisions',
      'Risk-aware households and small-business owners aged 30-55 who value trust, compliance, and transparency'
    ],
    drivers: 'trust, transparency, measurable savings or upside, and low-friction onboarding',
    barriers: 'privacy concerns, perceived financial risk, regulation questions, and fear of hidden fees',
    channels: 'advisor content, comparison pages, referral loops, fintech communities, and credibility-led webinars'
  },
  local_experience: {
    keywords: ['local', 'event', 'travel', 'hotel', 'venue', 'community', 'city', 'nightlife', 'experience', 'tour', 'booking'],
    segments: [
      'Experience-seeking urban millennials aged 24-39 who spend on memorable social outings',
      'Planning-heavy groups and families aged 30-55 who need reliable logistics and clear value'
    ],
    drivers: 'novelty, convenience, trust in logistics, and shareable moments',
    barriers: 'availability uncertainty, cancellation risk, unclear differentiation, and group coordination friction',
    channels: 'local creator content, search, partnerships, event calendars, and referral offers'
  },
  general_consumer: {
    keywords: [],
    segments: [
      'Early-adopter consumers aged 21-38 who actively try new solutions in this category',
      'Pragmatic mainstream buyers aged 30-55 who need clear proof, trust, and everyday usefulness'
    ],
    drivers: 'clear practical benefit, trust, ease of use, and a fast path to first value',
    barriers: 'unclear differentiation, pricing hesitation, and uncertainty that the concept solves a frequent problem',
    channels: 'short demos, referral offers, search-intent content, and targeted community launches'
  }
};

function readJsonFile(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    console.warn(`⚠️ Could not read ${filePath}: ${error.message}`);
    return fallback;
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function saveWebSession(session) {
  const store = readJsonFile(SESSION_STORE_PATH, {});
  store[session.validation_id] = { ...(store[session.validation_id] || {}), ...session, updated_at: new Date().toISOString() };
  writeJsonFile(SESSION_STORE_PATH, store);
  return store[session.validation_id];
}

function getWebSession(validationId) {
  return readJsonFile(SESSION_STORE_PATH, {})[validationId] || null;
}

function pitchTerms(pitch, limit = 5) {
  const words = String(pitch || '').toLowerCase().match(/[a-z][a-z0-9'-]{2,}/g) || [];
  const seen = [];
  for (const word of words) {
    const clean = word.replace(/^['-]+|['-]+$/g, '');
    if (!STOPWORDS.has(clean) && !seen.includes(clean)) seen.push(clean);
    if (seen.length >= limit) break;
  }
  return seen;
}

function classifyPitch(pitch) {
  const words = new Set(pitchTerms(pitch, 50));
  let bestName = 'general_consumer';
  let bestScore = 0;
  for (const [name, profile] of Object.entries(MARKET_SIGNALS)) {
    const score = profile.keywords.filter((keyword) => words.has(keyword)).length;
    if (score > bestScore) {
      bestName = name;
      bestScore = score;
    }
  }
  return [bestName, MARKET_SIGNALS[bestName]];
}

function stableAffinity(pitch, segment, floor, ceiling) {
  const digest = crypto.createHash('sha256').update(`${pitch}|${segment}`).digest('hex');
  const raw = parseInt(digest.slice(0, 8), 16);
  const value = floor + (raw % Math.floor((ceiling - floor) * 10)) / 10;
  return `${value.toFixed(1)}%`;
}

function trimText(value, maxLen = 900) {
  const text = String(value || '');
  return text.length <= maxLen ? text : `${text.slice(0, maxLen - 1).trim()}…`;
}

function buildPreviewReport(pitch) {
  const [category, profile] = classifyPitch(pitch);
  const terms = pitchTerms(pitch);
  const focus = terms.length ? terms.slice(0, 3).join(', ') : 'the submitted concept';
  const [demographicA, demographicB] = profile.segments;
  return {
    pitch_category: category,
    demographic_a: demographicA,
    demographic_b: demographicB,
    affinity_a: stableAffinity(pitch, demographicA, 62, 91),
    affinity_b: stableAffinity(pitch, demographicB, 42, 76),
    summary_matrix: [
      `Best-fit wedge: ${demographicA} should respond first if the pitch proves ${profile.drivers} for ${focus}.`,
      `Secondary read: ${demographicB} is viable, but messaging needs to overcome ${profile.barriers}.`,
      `Launch angle: Start with ${profile.channels} and copy that names the pitch pain point directly.`,
      'Validation test: Compare willingness-to-pay, urgency, and objection intensity between both groups before scaling spend.',
      'ASP packaging note: package the workflow as a repeatable concierge service with a clear input, dashboard deliverable, and paid unlock.'
    ]
  };
}

function normalizeSummaryMatrix(value, fallbackItems = []) {
  if (Array.isArray(value)) {
    const items = value.map((item) => String(item || '').trim()).filter(Boolean);
    return items.length ? items : fallbackItems;
  }
  if (typeof value === 'string') {
    const items = value
      .split(/\r?\n+/)
      .map((item) => item.replace(/^\s*[•\-*]+\s*/, '').trim())
      .filter(Boolean);
    return items.length ? items : fallbackItems;
  }
  return fallbackItems;
}

function extractJsonObject(output) {
  const text = String(output || '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Hermes preview response did not contain JSON: ${output.slice(0, 300)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isNgrokUrl(value) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host.includes('ngrok-free.') || host.endsWith('.ngrok.app') || host.endsWith('.ngrok.io');
  } catch {
    return false;
  }
}

function requestBaseUrl(req) {
  const forwardedHost = req?.headers?.['x-forwarded-host'];
  const hostHeader = Array.isArray(forwardedHost) ? forwardedHost[0] : (forwardedHost || req?.headers?.host || '');
  const host = String(hostHeader).split(',')[0].trim();
  if (!host || host.startsWith('localhost') || host.startsWith('127.0.0.1')) return '';
  const forwardedProto = req?.headers?.['x-forwarded-proto'];
  const protoHeader = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const proto = String(protoHeader || req?.protocol || 'https').split(',')[0].trim() || 'https';
  return `${proto}://${host}`;
}

function configuredBaseUrl() {
  const vercelUrl = normalizeBaseUrl(process.env.VERCEL_URL || '');
  if (isVercelRuntime() && vercelUrl) return vercelUrl.startsWith('http') ? vercelUrl : `https://${vercelUrl}`;

  const configured = normalizeBaseUrl(process.env.DOMAIN || '');
  if (configured && !(isVercelRuntime() && isNgrokUrl(configured))) return configured;

  return localDefaultDomain;
}

function publicBaseUrl(req) {
  if (isVercelRuntime()) return requestBaseUrl(req) || configuredBaseUrl();
  return configuredBaseUrl();
}

function buildHermesCliArgs(prompt, { provider = HERMES_PROVIDER, model = HERMES_MODEL } = {}) {
  const args = ['chat', '-Q', '--ignore-rules'];
  if (provider) args.push('--provider', provider);
  if (model) args.push('-m', model);
  args.push('-q', prompt);
  return args;
}

function hermesCliEnv() {
  const localBin = process.env.HOME ? path.join(process.env.HOME, '.local/bin') : '';
  const bundledBin = path.dirname(bundledHermesCommand);
  const pathParts = [bundledBin, localBin, process.env.PATH || ''].filter(Boolean);
  return {
    ...process.env,
    PATH: pathParts.join(':')
  };
}

function commandLabel(command) {
  return command === HERMES_COMMAND ? 'Hermes CLI' : `Hermes CLI (${command})`;
}

function formatHermesFailure(command, message, { code = '', stdout = '', stderr = '', timeoutMs = 0 } = {}) {
  const stderrSnippet = String(stderr || '').trim().slice(0, 900);
  const stdoutSnippet = String(stdout || '').trim().slice(0, 300);
  const parts = [
    `${commandLabel(command)} failed: ${message}`,
    `command=${command}`
  ];
  if (code !== '') parts.push(`exit_code=${code}`);
  if (timeoutMs) parts.push(`timeout_ms=${timeoutMs}`);
  parts.push(`stdout_bytes=${Buffer.byteLength(String(stdout || ''), 'utf8')}`);
  parts.push(`stderr_bytes=${Buffer.byteLength(String(stderr || ''), 'utf8')}`);
  if (stderrSnippet) parts.push(`stderr=${stderrSnippet}`);
  if (stdoutSnippet) parts.push(`stdout=${stdoutSnippet}`);
  return parts.join(' | ');
}

function runHermesCli(prompt, { command = HERMES_COMMAND, timeoutMs = HERMES_PREVIEW_TIMEOUT, provider = HERMES_PROVIDER, model = HERMES_MODEL } = {}) {
  return new Promise((resolve, reject) => {
    // Use the documented one-shot form and quiet mode so stdout is just the
    // model answer. Legacy `hermes -z` can emit banners/noise on some installs,
    // which makes the JSON parser fail and silently drops the app into the
    // deterministic local preview fallback.
    const args = buildHermesCliArgs(prompt, { provider, model });
    const proc = spawn(command, args, {
      env: hermesCliEnv(),
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      proc.kill('SIGKILL');
      reject(new Error(formatHermesFailure(command, 'process execution timed out', { stdout, stderr, timeoutMs })));
    }, timeoutMs);

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    proc.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(formatHermesFailure(command, error.message, { stdout, stderr, timeoutMs })));
    });
    proc.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(formatHermesFailure(command, 'process exited non-zero', { code, stdout, stderr, timeoutMs })));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function runHermesViaOpenAiApi(prompt, { apiKey = process.env.OPENAI_API_KEY, model = HERMES_MODEL, timeoutMs = HERMES_PREVIEW_TIMEOUT, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set; cannot call the OpenAI API directly.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(`OpenAI API request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = json?.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`OpenAI API request failed: ${response.status} ${response.statusText} ${detail}`);
  }
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error('OpenAI API response did not include message content.');
  return content.trim();
}

async function runHermesViaGeminiApi(prompt, { apiKey = process.env.GEMINI_API_KEY, model = HERMES_MODEL, timeoutMs = HERMES_PREVIEW_TIMEOUT, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set; cannot call the Gemini API directly.');
  const resolvedModel = model || 'gemini-2.0-flash';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, response_mime_type: 'application/json' }
      }),
      signal: controller.signal
    });
  } catch (error) {
    throw new Error(`Gemini API request failed: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = json?.error?.message || JSON.stringify(json).slice(0, 300);
    throw new Error(`Gemini API request failed: ${response.status} ${response.statusText} ${detail}`);
  }
  const content = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!content) throw new Error('Gemini API response did not include candidate text.');
  return content.trim();
}

function defaultHermesRunner() {
  // The bundled Vercel Hermes CLI is a pip-installed venv; its launcher script's
  // shebang bakes in the build container's absolute path, which does not exist
  // in the deployed Lambda filesystem, so spawning it always fails with ENOENT
  // there. Call a hosted API directly instead of shelling out to the CLI: prefer
  // Gemini (has a genuinely free tier) over OpenAI when both are configured.
  if (HERMES_PROVIDER === 'gemini-api' && process.env.GEMINI_API_KEY) return runHermesViaGeminiApi;
  if (HERMES_PROVIDER === 'openai-api' && process.env.OPENAI_API_KEY) return runHermesViaOpenAiApi;
  return runHermesCli;
}

async function buildHermesPreviewReport(pitch, { runHermes = defaultHermesRunner() } = {}) {
  const fallback = buildPreviewReport(pitch);
  if (!HERMES_PREVIEW_USE_CLI) return { ...fallback, preview_source: 'local_fallback', preview_error: 'HERMES_PREVIEW_USE_CLI is disabled' };

  const prompt = `
You are Hermes Agent preparing a free browser preview for Preferences ASP Concierge, a standalone Agent Service Provider.
Frame the submitted concept as a repeatable paid validation service with a clear input, dashboard deliverable, and unlock path.
Handpick exactly two pitch-specific demographic groups, Group A and Group B, for this concept:
${pitch}

Return only valid compact JSON with these keys:
pitch_category: short snake_case category
demographic_a: one specific demographic segment, age range included
demographic_b: a contrasting specific demographic segment, age range included
affinity_a: plausible preview affinity percentage string like "76.4%"
affinity_b: plausible preview affinity percentage string like "58.1%"
summary_matrix: an array of 3-4 short strings. Findings must be specific to the pitch, compare Group A vs Group B, and mention one driver, one objection, one recommended validation test, and one ASP packaging note.

Do not include markdown fences, commentary, or any text outside the JSON object.
`.trim();

  try {
    const output = await runHermes(prompt);
    const parsed = extractJsonObject(output);
    for (const key of ['demographic_a', 'demographic_b', 'summary_matrix']) {
      if (!parsed[key]) throw new Error(`Hermes preview JSON missing key: ${key}`);
    }
    const preview = { ...fallback, ...parsed, preview_source: 'hermes_agent', preview_error: '' };
    if (!String(preview.affinity_a || '').endsWith('%')) preview.affinity_a = fallback.affinity_a;
    if (!String(preview.affinity_b || '').endsWith('%')) preview.affinity_b = fallback.affinity_b;
    preview.summary_matrix = normalizeSummaryMatrix(preview.summary_matrix, fallback.summary_matrix);
    return preview;
  } catch (error) {
    const previewError = error.message;
    console.warn(`⚠️ Hermes preview generation failed; using local dynamic preview fallback: ${previewError}`);
    return { ...fallback, preview_source: 'local_fallback', preview_error: previewError };
  }
}

function buildPitchDeckFallback(session) {
  const preview = session.preview || {};
  const pitch = session.pitch || 'Preferences ASP validation';
  return {
    title: pitch.length > 60 ? `${pitch.slice(0, 57)}...` : pitch,
    tagline: 'A repeatable, agent-validated product opportunity.',
    problem: `Target buyers currently lack a fast, trustworthy way to validate demand for: ${pitch}`,
    solution: `${pitch}, packaged as a repeatable, paid validation-ready Agent Service Provider offering.`,
    market_opportunity: `Preferences AI identified two viable buyer segments for this concept in the ${preview.pitch_category || 'general_consumer'} category.`,
    target_segments: [
      { name: preview.demographic_a || 'Segment A', affinity: preview.affinity_a || 'N/A' },
      { name: preview.demographic_b || 'Segment B', affinity: preview.affinity_b || 'N/A' }
    ],
    validation_findings: (preview.summary_matrix && preview.summary_matrix.length) ? preview.summary_matrix : ['Validation findings were not available for this run.'],
    business_model: 'Paid unlock of a custom validation survey, digital population simulation, and dashboard access, with this pitch deck as a premium add-on deliverable.',
    go_to_market: 'Launch through targeted outreach to the higher-affinity segment first, using messaging validated in the survey findings.',
    ask: 'Seeking early customers and design partners to pilot this validation-ready concept.',
    next_steps: ['Review the unlocked Preferences AI survey and simulation dashboards.', 'Run a small paid pilot with the highest-affinity segment.', 'Iterate messaging based on the objection data above.']
  };
}

// Confirmed against a live account: GET /simulations/:id returns only status
// fields (respondent_count, desired_respondent_count, etc.) while a simulation
// is still running. Once status is "completed" and Preferences AI's own
// analysis succeeded, it also includes an insights block with STRUCTURED
// objects, not plain strings:
//   key_findings[]: { finding, confidence, evidence_question_ids[], follow_up_suggestion?: { label, ... } }
//   recommendations[]: { recommendation, priority }
//   segment_insights[]: { segment, insight, size_pct }
//   limitations[]: string[]
//   goal_summary: string
// (analysis.questions[] holds per-question response distributions, with
// sample_answers[] — real respondent quotes — for open-text questions.)
function extractSimulationInsightHighlights(simulationInsights) {
  const insights = simulationInsights?.insights || {};

  const keyFindings = (Array.isArray(insights.key_findings) ? insights.key_findings : [])
    .map((item) => (typeof item === 'string')
      ? { text: item, confidence: '', evidence: [], followUpLabel: '' }
      : {
        text: String(item?.finding || item?.text || '').trim(),
        confidence: String(item?.confidence || '').trim(),
        evidence: Array.isArray(item?.evidence_question_ids) ? item.evidence_question_ids.map((id) => String(id).toUpperCase()) : [],
        followUpLabel: item?.follow_up_suggestion?.label || ''
      })
    .filter((item) => item.text);

  const recommendations = (Array.isArray(insights.recommendations) ? insights.recommendations : [])
    .map((item) => (typeof item === 'string')
      ? { text: item, priority: '' }
      : { text: String(item?.recommendation || item?.text || '').trim(), priority: String(item?.priority || '').trim() })
    .filter((item) => item.text);

  const segmentInsights = (Array.isArray(insights.segment_insights) ? insights.segment_insights : [])
    .map((item) => (typeof item === 'string')
      ? { segment: '', text: item, sizePct: null }
      : { segment: String(item?.segment || '').trim(), text: String(item?.insight || item?.text || '').trim(), sizePct: typeof item?.size_pct === 'number' ? item.size_pct : null })
    .filter((item) => item.text);

  return { keyFindings, recommendations, segmentInsights, goalSummary: insights.goal_summary || '' };
}

// Turns a live simulation payload into compact, prompt-friendly text instead
// of dumping raw JSON, since a completed simulation's full payload can be
// tens of KB.
function summarizeSimulationInsights(simulationInsights) {
  if (!simulationInsights) return '';
  const lines = [];
  const status = simulationInsights.status || 'unknown';
  const respondents = simulationInsights.respondent_count ?? 0;
  const desired = simulationInsights.desired_respondent_count ?? 0;
  lines.push(`Simulation status: ${status} (${respondents}/${desired} respondents).`);

  const { keyFindings, recommendations, segmentInsights, goalSummary } = extractSimulationInsightHighlights(simulationInsights);
  if (goalSummary) lines.push(`Executive summary: ${goalSummary}`);
  for (const finding of keyFindings) {
    const confidence = finding.confidence ? ` [${finding.confidence} confidence]` : '';
    const evidence = finding.evidence.length ? ` (evidence: ${finding.evidence.join(', ')})` : '';
    lines.push(`Key finding${confidence}: ${finding.text}${evidence}`);
  }
  for (const recommendation of recommendations) {
    const priority = recommendation.priority ? ` [${recommendation.priority} priority]` : '';
    lines.push(`Recommendation${priority}: ${recommendation.text}`);
  }
  for (const segment of segmentInsights) {
    const sizeNote = segment.sizePct !== null ? ` (${segment.sizePct}% of respondents)` : '';
    lines.push(`Segment insight — ${segment.segment}${sizeNote}: ${segment.text}`);
  }

  // Only fall back to raw per-question distributions when Preferences AI's
  // own curated insights are empty (e.g. its summary generation failed for
  // this particular run) — the curated findings above are strictly better
  // signal when they exist.
  if (!keyFindings.length && !recommendations.length) {
    const questions = simulationInsights.analysis?.questions || [];
    for (const question of questions.slice(0, 12)) {
      if (question.type === 'text') {
        const samples = (question.sample_answers || []).slice(0, 3);
        if (samples.length) lines.push(`Q: ${question.text} — sample respondent answers: ${samples.join('; ')}`);
        continue;
      }
      const distribution = question.distribution || {};
      const total = Object.values(distribution).reduce((sum, count) => sum + count, 0) || 1;
      const top = Object.entries(distribution)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([label, count]) => `${label} (${Math.round((count / total) * 100)}%)`)
        .join(', ');
      if (top) lines.push(`Q: ${question.text} — ${top}`);
    }
  }

  return lines.join('\n').slice(0, 6000);
}

function buildPitchDeckPrompt(session, simulationInsights) {
  const preview = session.preview || {};
  const pitch = session.pitch || 'Preferences ASP validation';
  const insightsSummary = summarizeSimulationInsights(simulationInsights);
  const insightsText = insightsSummary
    ? `Live Preferences AI simulation results are also available. Cite specific numbers, percentages, or respondent quotes from this data wherever relevant:\n${insightsSummary}`
    : 'Live simulation result data was not available for this run (the simulation may still be running); rely on the validation preview below.';

  return `
You are Hermes Agent preparing an investor-ready pitch deck outline for Preferences ASP Concierge, a standalone Agent Service Provider.
The concept is: ${pitch}

Validation context already generated for this concept:
- Category: ${preview.pitch_category || 'general_consumer'}
- Demographic A: ${preview.demographic_a || 'unknown'} (affinity ${preview.affinity_a || 'unknown'})
- Demographic B: ${preview.demographic_b || 'unknown'} (affinity ${preview.affinity_b || 'unknown'})
- Validation findings: ${(preview.summary_matrix || []).join(' | ')}
${insightsText}

Return only valid compact JSON with these keys:
title: short punchy deck title, under 60 characters
tagline: one sentence positioning line
problem: 1-2 sentences on the problem this concept addresses
solution: 1-2 sentences on how this concept solves it
market_opportunity: 1-2 sentences citing the validated demographics and, if simulation results are available, real respondent numbers
target_segments: array of exactly 2 objects, each with "name" and "affinity" keys, reusing the demographic and affinity values above
validation_findings: array of 3-5 short strings summarizing the validation evidence; if simulation results are available, prefer citing specific percentages, price points, or respondent quotes from that data over generic statements
business_model: 1-2 sentences on how this makes money
go_to_market: 1-2 sentences on the launch wedge
ask: 1 sentence describing what this pitch is asking for (funding, pilot customers, or partners)
next_steps: array of 3 short strings, concrete next actions

Do not include markdown fences, commentary, or any text outside the JSON object.
`.trim();
}

async function fetchSimulationInsights(simulationId, { request = preferencesRequest } = {}) {
  if (!PREFERENCES_API_KEY || !simulationId) return null;
  // Confirmed against a live Preferences AI account: this is a real endpoint.
  // Any failure must still not block pitch deck generation, which falls back to
  // the validation preview data alone.
  const json = await request('GET', `/simulations/${simulationId}`);
  return json?.data || json || null;
}

async function buildHermesPitchDeckReport(session, { runHermes = defaultHermesRunner(), fetchInsights = fetchSimulationInsights } = {}) {
  const fallback = buildPitchDeckFallback(session);

  let simulationInsights = null;
  if (session.simulation_id) {
    try {
      simulationInsights = await fetchInsights(session.simulation_id);
    } catch (error) {
      console.warn(`⚠️ Could not fetch Preferences AI simulation insights for pitch deck (continuing without them): ${error.message}`);
    }
  }
  // Extracted once and attached to every return path below (Hermes success,
  // Hermes failure, or Hermes disabled) so the deck's dedicated findings and
  // recommendations slides always reflect real simulation data whenever it
  // exists, regardless of whether Hermes itself is working.
  const highlights = extractSimulationInsightHighlights(simulationInsights);
  const highlightFields = {
    simulation_key_findings: highlights.keyFindings,
    simulation_recommendations: highlights.recommendations,
    simulation_segment_insights: highlights.segmentInsights
  };

  if (!HERMES_PREVIEW_USE_CLI) return { ...fallback, ...highlightFields, deck_source: 'local_fallback', deck_error: 'HERMES_PREVIEW_USE_CLI is disabled' };

  const prompt = buildPitchDeckPrompt(session, simulationInsights);
  try {
    const output = await runHermes(prompt);
    const parsed = extractJsonObject(output);
    for (const key of ['title', 'problem', 'solution', 'target_segments', 'validation_findings']) {
      if (!parsed[key]) throw new Error(`Hermes pitch deck JSON missing key: ${key}`);
    }
    const deck = { ...fallback, ...parsed, ...highlightFields, deck_source: 'hermes_agent', deck_error: '' };
    deck.target_segments = (Array.isArray(deck.target_segments) && deck.target_segments.length) ? deck.target_segments : fallback.target_segments;
    deck.validation_findings = normalizeSummaryMatrix(deck.validation_findings, fallback.validation_findings);
    deck.next_steps = normalizeSummaryMatrix(deck.next_steps, fallback.next_steps);
    return deck;
  } catch (error) {
    const deckError = error.message;
    console.warn(`⚠️ Hermes pitch deck generation failed; using local dynamic deck fallback: ${deckError}`);
    return { ...fallback, ...highlightFields, deck_source: 'local_fallback', deck_error: deckError };
  }
}

// Live Preferences AI status values seen on real simulations are 'running',
// 'completed', or 'failed'. Our own provisioning can also leave a session at
// one of these interim statuses before a simulation ever reaches the live
// API. Only the "still actively running" states should keep the pitch deck
// button waiting; everything else (including failure) is treated as a
// terminal state so a customer is never stuck waiting forever.
const SIMULATION_IN_PROGRESS_STATES = new Set(['running', 'launched', 'not_started']);

async function checkPitchDeckReadiness(session, { fetchInsights = fetchSimulationInsights, buildDeck = buildHermesPitchDeckReport } = {}) {
  if (session.pitch_deck_ready && session.pitch_deck_content) {
    return {
      deck_ready: true,
      simulation_status: session.pitch_deck_simulation_status || 'completed',
      respondent_count: session.pitch_deck_respondent_count || 0,
      desired_respondent_count: session.pitch_deck_desired_respondent_count || 0
    };
  }

  let simulationStatus = session.simulation_id ? (session.simulation_status || 'unknown') : 'not_available';
  let respondentCount = 0;
  let desiredCount = 0;

  if (session.simulation_id) {
    try {
      const insights = await fetchInsights(session.simulation_id);
      if (insights) {
        simulationStatus = insights.status || simulationStatus;
        respondentCount = Number(insights.respondent_count || 0);
        desiredCount = Number(insights.desired_respondent_count || 0);
      }
    } catch (error) {
      console.warn(`⚠️ Could not refresh simulation status for pitch deck readiness check (continuing to wait): ${error.message}`);
      return { deck_ready: false, simulation_status: simulationStatus, respondent_count: respondentCount, desired_respondent_count: desiredCount };
    }
  }

  if (SIMULATION_IN_PROGRESS_STATES.has(simulationStatus)) {
    return { deck_ready: false, simulation_status: simulationStatus, respondent_count: respondentCount, desired_respondent_count: desiredCount };
  }

  const deck = await buildDeck(session);
  saveWebSession({
    validation_id: session.validation_id,
    pitch_deck_ready: true,
    pitch_deck_content: deck,
    pitch_deck_simulation_status: simulationStatus,
    pitch_deck_respondent_count: respondentCount,
    pitch_deck_desired_respondent_count: desiredCount
  });

  return { deck_ready: true, simulation_status: simulationStatus, respondent_count: respondentCount, desired_respondent_count: desiredCount };
}

const DECK_COLORS = { bg: '0B0F1F', panel: '141A33', accent: '8F7CFF', accent2: '36E7C4', text: 'F5F7FF', muted: 'AEB7D9' };

function addDeckTitleSlide(pptx, deck) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK_COLORS.bg };
  slide.addText(deck.title, { x: 0.6, y: 1.8, w: 8.8, h: 1.5, fontSize: 40, bold: true, color: DECK_COLORS.text, fontFace: 'Arial' });
  slide.addText(deck.tagline, { x: 0.6, y: 3.2, w: 8.8, h: 1, fontSize: 18, color: DECK_COLORS.accent2, fontFace: 'Arial' });
  slide.addText('Prepared by Preferences ASP Concierge', { x: 0.6, y: 5.0, w: 8.8, h: 0.4, fontSize: 12, color: DECK_COLORS.muted, fontFace: 'Arial' });
  return slide;
}

function addDeckBodySlide(pptx, heading, bodyText) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK_COLORS.bg };
  slide.addText(heading, { x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 26, bold: true, color: DECK_COLORS.accent2, fontFace: 'Arial' });
  slide.addText(String(bodyText || ''), { x: 0.6, y: 1.6, w: 8.8, h: 3.6, fontSize: 18, color: DECK_COLORS.text, fontFace: 'Arial', valign: 'top' });
  return slide;
}

function addDeckBulletSlide(pptx, heading, items) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK_COLORS.bg };
  slide.addText(heading, { x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 26, bold: true, color: DECK_COLORS.accent2, fontFace: 'Arial' });
  const bulletText = (items || []).map((item) => ({ text: String(item), options: { bullet: true, breakLine: true, color: DECK_COLORS.text, fontSize: 16 } }));
  slide.addText(bulletText, { x: 0.6, y: 1.6, w: 8.8, h: 3.6, fontFace: 'Arial' });
  return slide;
}

// Renders real Preferences AI simulation findings/recommendations, each as a
// badge (confidence or priority) + main text + optional evidence question IDs
// + optional follow-up experiment label, independent of Hermes.
function addDeckHighlightSlide(pptx, heading, items, { badgeField, badgeLabel } = {}) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK_COLORS.bg };
  slide.addText(heading, { x: 0.6, y: 0.5, w: 8.8, h: 0.6, fontSize: 24, bold: true, color: DECK_COLORS.accent2, fontFace: 'Arial' });

  const runs = [];
  for (const item of items.slice(0, 4)) {
    const badgeValue = item[badgeField];
    if (badgeValue) runs.push({ text: `[${String(badgeValue).toUpperCase()} ${badgeLabel}] `, options: { bold: true, color: DECK_COLORS.accent, fontSize: 13 } });
    runs.push({ text: item.text, options: { color: DECK_COLORS.text, fontSize: 13, breakLine: true } });
    if (item.evidence && item.evidence.length) {
      runs.push({ text: `Evidence: ${item.evidence.join(', ')}`, options: { italic: true, color: DECK_COLORS.muted, fontSize: 10, breakLine: true } });
    }
    if (item.followUpLabel) {
      runs.push({ text: `→ ${item.followUpLabel}`, options: { italic: true, color: DECK_COLORS.accent2, fontSize: 10, breakLine: true } });
    }
    runs.push({ text: ' ', options: { fontSize: 5, breakLine: true } });
  }
  slide.addText(runs, { x: 0.6, y: 1.25, w: 8.8, h: 3.95, fontFace: 'Arial', valign: 'top' });
  return slide;
}

function addDeckSegmentsSlide(pptx, heading, segments) {
  const slide = pptx.addSlide();
  slide.background = { color: DECK_COLORS.bg };
  slide.addText(heading, { x: 0.6, y: 0.5, w: 8.8, h: 0.8, fontSize: 26, bold: true, color: DECK_COLORS.accent2, fontFace: 'Arial' });
  const headerCellOptions = { bold: true, color: DECK_COLORS.text, fill: { color: DECK_COLORS.panel } };
  const rows = [[
    { text: 'Segment', options: headerCellOptions },
    { text: 'Preview Affinity', options: headerCellOptions }
  ]];
  for (const segment of (segments || [])) {
    rows.push([
      { text: String(segment.name || segment.description || 'Segment'), options: { color: DECK_COLORS.text, fill: { color: DECK_COLORS.bg } } },
      { text: String(segment.affinity || 'N/A'), options: { color: DECK_COLORS.accent2, bold: true, fill: { color: DECK_COLORS.bg } } }
    ]);
  }
  slide.addTable(rows, { x: 0.6, y: 1.6, w: 8.8, h: 2.5, fontSize: 16, border: { type: 'solid', color: '2A3157', pt: 1 } });
  return slide;
}

async function buildPitchDeckBuffer(session, deck) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_16x9';

  addDeckTitleSlide(pptx, deck);
  addDeckBodySlide(pptx, 'Problem', deck.problem);
  addDeckBodySlide(pptx, 'Solution', deck.solution);
  addDeckSegmentsSlide(pptx, 'Target Segments (Preferences AI Validated)', deck.target_segments);
  addDeckBodySlide(pptx, 'Market Opportunity', deck.market_opportunity);
  addDeckBulletSlide(pptx, 'Validation Findings', deck.validation_findings);
  if (deck.simulation_key_findings?.length) {
    addDeckHighlightSlide(pptx, 'Key Findings from Live Simulation', deck.simulation_key_findings, { badgeField: 'confidence', badgeLabel: 'CONFIDENCE' });
  }
  if (deck.simulation_recommendations?.length) {
    addDeckHighlightSlide(pptx, 'Data-Driven Recommendations', deck.simulation_recommendations, { badgeField: 'priority', badgeLabel: 'PRIORITY' });
  }
  addDeckBodySlide(pptx, 'Business Model', deck.business_model);
  addDeckBodySlide(pptx, 'Go-To-Market', deck.go_to_market);
  addDeckBodySlide(pptx, 'The Ask', deck.ask);
  addDeckBulletSlide(pptx, 'Next Steps', deck.next_steps);

  return pptx.write({ outputType: 'nodebuffer' });
}

function extractSurveyId(responseJson) {
  const data = responseJson?.data || {};
  const surveyId = responseJson?.survey_id || responseJson?.id || data.survey_id || data.id;
  if (!surveyId || !String(surveyId).startsWith('survey_')) {
    throw new Error(`Survey create response did not include a usable survey_id: ${JSON.stringify(responseJson).slice(0, 800)}`);
  }
  return String(surveyId);
}

function extractSimulationId(responseJson) {
  const data = responseJson?.data || {};
  return String(responseJson?.simulation_id || responseJson?.id || data.simulation_id || data.id || '');
}

async function preferencesRequest(method, endpoint, { body, attempts = 3 } = {}) {
  const headers = {
    'X-API-Key': PREFERENCES_API_KEY,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'Preferences-ASP-Concierge/1.0'
  };
  let lastError;
  let lastResponse;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PREFERENCES_REQUEST_TIMEOUT);
    try {
      const response = await fetch(`${PREFERENCES_API_BASE}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      clearTimeout(timeout);
      lastResponse = response;
      const text = await response.text();
      let json = {};
      if (text) {
        try { json = JSON.parse(text); } catch { json = { raw: text }; }
      }
      if (![502, 503, 504, 520, 522, 524].includes(response.status)) {
        if (!response.ok) {
          const err = new Error(`Preferences AI ${method} ${endpoint} failed: HTTP ${response.status} ${text.slice(0, 1200)}`);
          err.status = response.status;
          err.body = json;
          throw err;
        }
        return json;
      }
      lastError = new Error(`Transient Preferences AI HTTP ${response.status}: ${text.slice(0, 400)}`);
    } catch (error) {
      clearTimeout(timeout);
      lastError = error;
      if (attempt === attempts || (error.status && ![502, 503, 504, 520, 522, 524].includes(error.status))) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
  }
  throw lastError || new Error(`Preferences AI ${method} ${endpoint} failed after ${attempts} attempts; last response ${lastResponse?.status}`);
}

function buildFallbackSurveySections(pitch, preview = {}) {
  const demographicA = preview.demographic_a || 'likely early adopters aged 21-38';
  const demographicB = preview.demographic_b || 'mainstream buyers aged 30-55';
  return [
    {
      section_id: 'sec_1',
      section_title: 'Screening and segment fit',
      section_goal: 'Confirm respondent segment, category relevance, and current behavior.',
      questions: [
        { question_type: 'multiple_choice', question: 'Which group best describes you?', choices: [demographicA, demographicB, 'Neither group, but I understand the category'] },
        { question_type: 'multiple_choice', question: `How often do you currently experience the problem addressed by this concept: ${pitch.slice(0, 140)}?`, choices: ['Daily', 'Weekly', 'Monthly', 'Rarely', 'Never'] },
        { question_type: 'rate', question: 'How relevant is this concept to your current needs?', choices: [], rateValues: [1, 2, 3, 4, 5], minRateDescription: 'Not relevant', maxRateDescription: 'Extremely relevant' }
      ]
    },
    {
      section_id: 'sec_2',
      section_title: 'Purchase intent and objections',
      section_goal: 'Measure willingness to try, pay, and overcome objections.',
      questions: [
        { question_type: 'rate', question: 'How likely would you be to try this service if it were available today?', choices: [], rateValues: [1, 2, 3, 4, 5], minRateDescription: 'Very unlikely', maxRateDescription: 'Very likely' },
        { question_type: 'multiple_choice', question: 'What would be your biggest concern before buying or using it?', choices: ['Price or subscription fatigue', 'Trust and data privacy', 'Unclear value compared with current alternatives', 'Setup effort or learning curve', 'I have no major concern'] },
        { question_type: 'multiple_choice', question: 'Which price range would feel reasonable for a useful paid version?', choices: ['$0 / only free', '$1-$9 per month', '$10-$29 per month', '$30-$99 per month', '$100+ per month or enterprise pricing'] }
      ]
    },
    {
      section_id: 'sec_3',
      section_title: 'Messaging and launch channel',
      section_goal: 'Identify the strongest positioning and go-to-market wedge.',
      questions: [
        { question_type: 'multiple_choice', question: 'Which message would make you most interested?', choices: ['Save time immediately', 'Get more accurate decisions', 'Reduce manual work', 'Improve outcomes with personalized insights', 'Lower cost versus alternatives'] },
        { question_type: 'multiple_choice', question: 'Where would you most likely discover and trust this offer?', choices: ['Search or comparison pages', 'Short-form social video', 'Creator or expert recommendation', 'Work/community referral', 'Direct sales or demo'] },
        { question_type: 'rate', question: 'Overall, how strong is the product-market fit for your segment?', choices: [], rateValues: [1, 2, 3, 4, 5], minRateDescription: 'Weak fit', maxRateDescription: 'Strong fit' }
      ]
    }
  ];
}

async function createSurveyWithFallback(request, pitch, preview, primarySections) {
  const createBody = {
    survey_title: `Preferences ASP Concierge - ${pitch.slice(0, 50)} Discovery Panel`,
    survey_type: 'product_market_fit',
    survey_goal: `Validate ASP fit, product-market fit, customer preferences, pricing, and messaging for: ${pitch}`,
    sections: primarySections,
    languages: ['English (US)']
  };

  try {
    return await request('POST', '/surveys', { body: createBody });
  } catch (error) {
    if (error.status !== 400) throw error;
    console.warn(`⚠️ Preferences AI rejected generated survey content; retrying with deterministic fallback survey: ${error.message}`);
    return request('POST', '/surveys', {
      body: { ...createBody, sections: buildFallbackSurveySections(pitch, preview) }
    });
  }
}

function buildSimulationPayload({ surveyId, pitch, preview, estimate }) {
  const respondents = Number(estimate?.respondents || estimate?.sample_size || process.env.PREFERENCES_SIMULATION_RESPONDENTS || 100);
  const pruCost = Number(estimate?.pru_cost || process.env.PREFERENCES_SIMULATION_PRU_COST || Math.ceil(respondents / 10));
  const populationQuery = [
    `Target Demographic A: ${preview.demographic_a}.`,
    `Target Demographic B: ${preview.demographic_b}.`,
    `All respondents should be plausible target customers for this Agent Service Provider / product concept: ${pitch}`
  ].join(' ');
  return {
    survey_id: surveyId,
    population_query: populationQuery,
    label: `${pitch.slice(0, 50)} Digital Population Pilot`,
    desired_respondent_count: respondents,
    respondent_count: respondents,
    num_respondents: respondents,
    sample_size: respondents,
    n: respondents,
    pru_cost: pruCost,
    confidence_level: 0.95,
    margin_of_error: 0.05
  };
}

async function provisionPreferencesAssets(pitch, preview, { request = preferencesRequest } = {}) {
  if (!PREFERENCES_API_KEY) {
    return { live: false, status: 'skipped', message: 'PREFERENCES_AI_API_KEY is not set.' };
  }

  const surveyPrompt = [
    `ASP product-market-fit survey for this real-world service concept: ${pitch}.`,
    `Prioritize Target Demographic A: ${preview.demographic_a}.`,
    `Compare against Target Demographic B: ${preview.demographic_b}.`,
    'Cover target audience, purchase intent, willingness to pay, pain points, alternatives, objections, messaging, and purchase channels.'
  ].join(' ');

  const buildJson = await request('POST', '/surveys/build', {
    body: {
      survey_prompt: surveyPrompt,
      survey_type: 'product_market_fit',
      languages: ['English (US)'],
      output_format: 'json'
    }
  });
  const surveyContent = buildJson?.data?.survey_content;
  if (!surveyContent) throw new Error('Survey build response did not include data.survey_content');

  const createJson = await createSurveyWithFallback(request, pitch, preview, surveyContent);
  const surveyId = extractSurveyId(createJson);

  let verified = false;
  let verificationError = '';
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await request('GET', `/surveys/${surveyId}`);
      verified = true;
      break;
    } catch (error) {
      verificationError = error.message;
      await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
    }
  }

  let simulationId = '';
  let simulationStatus = verified ? 'not_started' : 'survey_verification_failed';
  let simulationMessage = verified ? '' : `Survey ${surveyId} was created but could not be verified before simulation launch: ${verificationError || 'unknown verification error'}`;
  let estimate = {};
  let pruCost = 0;
  let respondents = 0;
  let pruBalance = 0;

  if (!verified) {
    // Keep the created survey visible to the browser instead of throwing away
    // the survey_id just because a downstream read/launch step failed.
  } else if (!WEB_RUN_LIVE_SIMULATION) {
    simulationStatus = 'skipped';
    simulationMessage = 'WEB_RUN_LIVE_SIMULATION=0, so the survey was created but simulation launch was skipped.';
  } else {
    try {
      const balanceJson = await request('GET', '/balance');
      pruBalance = Number(balanceJson?.data?.pru_balance ?? balanceJson?.pru_balance ?? 0);

      const populationQuery = `Target Demographic A: ${preview.demographic_a}. Target Demographic B: ${preview.demographic_b}. Plausible target customers for: ${pitch}`;
      const estimateJson = await request('POST', '/simulations/estimate-cost', {
        body: { population_query: populationQuery, confidence_level: 0.95, margin_of_error: 0.05 }
      });
      estimate = estimateJson?.data || estimateJson || {};
      pruCost = Number(estimate.pru_cost || 0);
      respondents = Number(estimate.respondents || 0);

      if (pruCost > 0 && pruBalance < pruCost) {
        simulationStatus = 'insufficient_balance';
        simulationMessage = `PRU balance ${pruBalance} is below estimated cost ${pruCost}; simulation was not launched.`;
      } else {
        const simJson = await request('POST', '/simulations', {
          body: buildSimulationPayload({ surveyId, pitch, preview, estimate })
        });
        simulationId = extractSimulationId(simJson);
        simulationStatus = simulationId ? 'launched' : 'submitted_without_id';
      }
    } catch (error) {
      console.warn(`⚠️ PreferencesAI simulation provisioning failed after survey ${surveyId} was created: ${error.message}`);
      simulationStatus = 'failed';
      simulationMessage = `Simulation provisioning failed after survey creation: ${error.message}`;
    }
  }

  return {
    live: true,
    status: 'created',
    survey_id: surveyId,
    simulation_id: simulationId,
    survey_url: `https://dashboard.preferencesai.io/surveys/${surveyId}`,
    simulation_url: simulationId ? `https://dashboard.preferencesai.io/simulations/${simulationId}` : '',
    estimate: { pru_cost: pruCost, respondents, pru_balance: pruBalance, tier_used: estimate.tier_used, notes: estimate.notes },
    simulation_status: simulationStatus,
    simulation_message: simulationMessage
  };
}

async function createCheckoutSession(validationSession, req = null) {
  if (!stripe) return null;
  const checkoutBaseUrl = publicBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'en',
    line_items: [{
      price_data: {
        currency: WEB_PRICE_CURRENCY,
        product_data: { name: WEB_PRODUCT_NAME, description: `Full Preferences ASP validation dashboard unlock for: ${validationSession.pitch.slice(0, 240)}` },
        unit_amount: WEB_PRICE_CENTS
      },
      quantity: 1
    }],
    success_url: `${checkoutBaseUrl}/success?validation_id=${validationSession.validation_id}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${checkoutBaseUrl}/cancel?validation_id=${validationSession.validation_id}`,
    metadata: {
      validation_id: validationSession.validation_id,
      pitch: validationSession.pitch.slice(0, 500),
      survey_id: validationSession.survey_id || '',
      simulation_id: validationSession.simulation_id || '',
      live_status: validationSession.live_status || '',
      simulation_status: validationSession.simulation_status || ''
    }
  });
  saveWebSession({ validation_id: validationSession.validation_id, stripe_checkout_session_id: session.id, checkout_url: session.url });
  return session;
}

async function createPitchDeckCheckoutSession(validationSession, req = null) {
  if (!stripe) return null;
  const checkoutBaseUrl = publicBaseUrl(req);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    locale: 'en',
    line_items: [{
      price_data: {
        currency: WEB_PRICE_CURRENCY,
        product_data: { name: WEB_PITCH_DECK_PRODUCT_NAME, description: `Hermes Agent investor pitch deck for: ${validationSession.pitch.slice(0, 240)}` },
        unit_amount: WEB_PITCH_DECK_PRICE_CENTS
      },
      quantity: 1
    }],
    success_url: `${checkoutBaseUrl}/success?validation_id=${validationSession.validation_id}&deck_session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${checkoutBaseUrl}/success?validation_id=${validationSession.validation_id}`,
    metadata: {
      product: 'pitch_deck',
      validation_id: validationSession.validation_id,
      pitch: validationSession.pitch.slice(0, 500)
    }
  });
  return session;
}

function publicWebSession(session) {
  return {
    validation_id: session.validation_id,
    pitch: session.pitch,
    preview: session.preview,
    preview_source: session.preview?.preview_source || 'unknown',
    preview_error: session.preview?.preview_error || '',
    pitch_category: session.pitch_category,
    survey_id: session.survey_id || '',
    simulation_id: session.simulation_id || '',
    estimate: session.estimate || null,
    simulation_status: session.simulation_status || 'unknown',
    simulation_message: session.simulation_message || '',
    checkout_url: session.checkout_url || '',
    checkout_error: session.checkout_error || '',
    live_status: session.live_status || 'unknown',
    live_error: session.live_error || '',
    paid: Boolean(session.paid)
  };
}

async function retryPreferencesProvisioning(validationId) {
  const existing = getWebSession(validationId);
  if (!existing) {
    const error = new Error('Validation session not found.');
    error.status = 404;
    throw error;
  }
  if (existing.live_status === 'created' && existing.survey_id) return existing;
  if (!existing.pitch || !existing.preview) throw new Error('Validation session is missing the pitch or preview needed to retry provisioning.');

  const assets = await provisionPreferencesAssets(existing.pitch, existing.preview);
  const updatedSession = saveWebSession({
    validation_id: validationId,
    survey_id: assets.survey_id || '',
    simulation_id: assets.simulation_id || '',
    survey_url: assets.survey_url || '',
    simulation_url: assets.simulation_url || '',
    estimate: assets.estimate || null,
    simulation_status: assets.simulation_status || 'not_available',
    simulation_message: assets.simulation_message || assets.message || '',
    live_status: assets.status || 'created',
    live_error: ''
  });

  if (!updatedSession.checkout_url) {
    try {
      const checkoutSession = await createCheckoutSession(updatedSession);
      if (checkoutSession) return saveWebSession({ validation_id: validationId, checkout_url: checkoutSession.url, stripe_checkout_session_id: checkoutSession.id });
    } catch (error) {
      return saveWebSession({ validation_id: validationId, checkout_error: error.message });
    }
  }

  return updatedSession;
}

function sessionFromCheckoutMetadata(checkoutSession, requestedValidationId = '') {
  const metadata = checkoutSession?.metadata || {};
  const validationId = metadata.validation_id || requestedValidationId;
  if (!validationId) throw new Error('Checkout Session metadata is missing validation_id.');
  if (requestedValidationId && metadata.validation_id && metadata.validation_id !== requestedValidationId) {
    throw new Error('Checkout Session does not match this validation.');
  }

  const pitch = metadata.pitch || 'Preferences ASP validation';
  const surveyId = metadata.survey_id || '';
  const simulationId = metadata.simulation_id || '';
  const recovered = {
    validation_id: validationId,
    pitch,
    preview: buildPreviewReport(pitch),
    pitch_category: buildPreviewReport(pitch).pitch_category,
    survey_id: surveyId,
    simulation_id: simulationId,
    survey_url: surveyId ? `https://dashboard.preferencesai.io/surveys/${surveyId}` : '',
    simulation_url: simulationId ? `https://dashboard.preferencesai.io/simulations/${simulationId}` : '',
    simulation_status: metadata.simulation_status || (simulationId ? 'launched' : 'not_available'),
    simulation_message: 'Recovered from Stripe Checkout metadata after payment.',
    live_status: metadata.live_status || (surveyId ? 'created' : 'unknown'),
    paid: true,
    paid_at: new Date().toISOString(),
    stripe_checkout_session_id: checkoutSession.id
  };
  return saveWebSession(recovered);
}

async function verifyPaidUnlock(validationId, checkoutSessionId, { retrieveCheckoutSession = null } = {}) {
  const existingSession = validationId ? getWebSession(validationId) : null;
  // A validation that was already verified paid should stay unlocked on any
  // later /success visit (e.g. redirected back from the separate pitch deck
  // checkout, which carries its own deck_session_id, not this one) without
  // re-requiring a base-unlock session_id or another Stripe round-trip.
  if (existingSession?.paid) return existingSession;
  if (!WEB_REQUIRE_PAYMENT_FOR_DASHBOARD_LINKS) {
    if (existingSession) return { ...existingSession, paid: true };
    if (!checkoutSessionId) throw new Error('Validation session not found.');
  }
  if (!stripe && !retrieveCheckoutSession) throw new Error('Stripe is not configured on this server.');
  if (!checkoutSessionId) throw new Error('Missing Stripe Checkout session_id.');
  const checkoutSession = retrieveCheckoutSession
    ? await retrieveCheckoutSession(checkoutSessionId)
    : await stripe.checkout.sessions.retrieve(checkoutSessionId);
  const metadataValidationId = checkoutSession.metadata?.validation_id || '';
  if (validationId && metadataValidationId && metadataValidationId !== validationId) {
    throw new Error('Checkout Session does not match this validation.');
  }
  if (checkoutSession.payment_status !== 'paid') {
    throw new Error(`Checkout payment_status is ${checkoutSession.payment_status}, not paid.`);
  }

  const finalValidationId = validationId || metadataValidationId;
  if (existingSession) {
    return saveWebSession({ validation_id: finalValidationId, paid: true, paid_at: new Date().toISOString(), stripe_checkout_session_id: checkoutSession.id });
  }

  // Vercel serverless instances only have ephemeral /tmp storage. The validation
  // session created before redirect may not exist in the later /success or
  // /webhook invocation, so recover enough state from signed Stripe Checkout
  // metadata instead of showing "Validation session not found" after payment.
  return sessionFromCheckoutMetadata(checkoutSession, finalValidationId);
}

async function verifyPitchDeckPaid(validationId, deckCheckoutSessionId, { retrieveCheckoutSession = null } = {}) {
  const existingSession = validationId ? getWebSession(validationId) : null;
  if (existingSession?.pitch_deck_paid) return existingSession;
  if (!WEB_REQUIRE_PAYMENT_FOR_DASHBOARD_LINKS && existingSession) {
    return saveWebSession({ validation_id: validationId, pitch_deck_paid: true, pitch_deck_paid_at: new Date().toISOString() });
  }
  if (!stripe && !retrieveCheckoutSession) throw new Error('Stripe is not configured on this server.');
  if (!deckCheckoutSessionId) throw new Error('Missing Stripe Checkout session_id for the pitch deck purchase.');

  const checkoutSession = retrieveCheckoutSession
    ? await retrieveCheckoutSession(deckCheckoutSessionId)
    : await stripe.checkout.sessions.retrieve(deckCheckoutSessionId);
  // Require the product marker so a base-unlock session_id can't be replayed
  // here to unlock the pitch deck without paying for it.
  if (checkoutSession.metadata?.product !== 'pitch_deck') {
    throw new Error('Checkout Session was not for the pitch deck add-on.');
  }
  const metadataValidationId = checkoutSession.metadata?.validation_id || '';
  if (validationId && metadataValidationId && metadataValidationId !== validationId) {
    throw new Error('Checkout Session does not match this validation.');
  }
  if (checkoutSession.payment_status !== 'paid') {
    throw new Error(`Checkout payment_status is ${checkoutSession.payment_status}, not paid.`);
  }

  const finalValidationId = validationId || metadataValidationId;
  const paidFields = { pitch_deck_paid: true, pitch_deck_paid_at: new Date().toISOString(), pitch_deck_checkout_session_id: checkoutSession.id };
  if (existingSession) {
    return saveWebSession({ validation_id: finalValidationId, ...paidFields });
  }

  // Same ephemeral-storage recovery as the base unlock, using the pitch this
  // deck checkout carried in its own metadata.
  const pitch = checkoutSession.metadata?.pitch || 'Preferences ASP validation';
  return saveWebSession({
    validation_id: finalValidationId,
    pitch,
    preview: buildPreviewReport(pitch),
    pitch_category: buildPreviewReport(pitch).pitch_category,
    ...paidFields
  });
}

const DECK_ERROR_MESSAGES = {
  checkout_unavailable: 'Could not start pitch deck checkout. Please try again.',
  not_paid: 'We could not verify payment for the pitch deck yet.',
  generation_failed: 'Something went wrong generating the pitch deck. Please try again.'
};

function friendlyDeckErrorMessage(code) {
  return DECK_ERROR_MESSAGES[code] || DECK_ERROR_MESSAGES.generation_failed;
}

function renderSuccessPage({ session, unlocked, error, pitchDeckUnlocked, pitchDeckError, pitchDeckReady, pitchDeckStatus, deckSessionId }) {
  const previewItems = (session?.preview?.summary_matrix || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  const links = unlocked ? `
    <div class="unlock-card success">
      <h2>Unlocked Preferences ASP dashboard links</h2>
      ${session.survey_url ? `<a class="big-link" href="${escapeAttr(session.survey_url)}" target="_blank" rel="noreferrer">Open Preferences AI Survey</a>` : ''}
      ${session.simulation_url ? `<a class="big-link" href="${escapeAttr(session.simulation_url)}" target="_blank" rel="noreferrer">Open Simulation Logs</a>` : '<p>No live simulation URL is available for this run.</p>'}
    </div>` : `
    <div class="unlock-card warning">
      <h2>Unlock not verified</h2>
      <p>${escapeHtml(error || 'Payment could not be verified yet.')}</p>
    </div>`;

  let pitchDeckSection = '';
  if (unlocked) {
    const validationId = escapeAttr(session.validation_id || '');
    const deckSessionIdAttr = escapeAttr(deckSessionId || '');
    const deckQuery = deckSessionId ? `?deck_session_id=${deckSessionIdAttr}` : '';
    if (pitchDeckUnlocked && pitchDeckReady) {
      const downloadHref = `/api/session/${validationId}/pitch-deck/download${deckQuery}`;
      pitchDeckSection = `
    <div class="unlock-panel" id="pitch-deck-panel">
      <h3>Investor pitch deck</h3>
      <p>Hermes Agent generated a downloadable pitch deck (.pptx) from this concept's validation data.</p>
      <a class="button-link" id="deck-action" href="${downloadHref}">Download pitch deck (.pptx)</a>
    </div>`;
    } else if (pitchDeckUnlocked) {
      const downloadHref = `/api/session/${validationId}/pitch-deck/download${deckQuery}`;
      const statusHref = `/api/session/${validationId}/pitch-deck/status${deckQuery}`;
      const respondents = pitchDeckStatus?.respondent_count || 0;
      const desired = pitchDeckStatus?.desired_respondent_count || 0;
      const progressPct = desired ? Math.min(100, Math.round((respondents / desired) * 100)) : 0;
      const statusNote = desired
        ? `Simulation progress: ${respondents} / ${desired} respondents.`
        : 'Waiting for the Preferences AI simulation to finish running.';
      pitchDeckSection = `
    <div class="unlock-panel" id="pitch-deck-panel" data-status-url="${escapeAttr(statusHref)}" data-download-url="${escapeAttr(downloadHref)}">
      <h3>Investor pitch deck</h3>
      <p>Hermes Agent will build a downloadable pitch deck (.pptx) once the Preferences AI simulation finishes running.</p>
      <div class="status-head">
        <div class="spinner"></div>
        <button class="button-link disabled" id="deck-action" type="button" disabled>Pitch deck creation in progress</button>
      </div>
      <div class="progress-track"><div id="deck-progress-fill" class="progress-fill" style="width:${progressPct}%"></div></div>
      <p id="deck-status-text" class="fine-print">${escapeHtml(statusNote)}</p>
    </div>`;
    } else {
      const errorNote = pitchDeckError ? `<p class="fine-print">${escapeHtml(friendlyDeckErrorMessage(pitchDeckError))}</p>` : '';
      pitchDeckSection = `
    <div class="unlock-panel">
      <h3>Generate an investor pitch deck</h3>
      <p>Have Hermes Agent turn this validation into a downloadable pitch deck (.pptx) built from your survey and simulation data.</p>
      <a class="button-link" href="/api/session/${validationId}/pitch-deck/checkout">Pay $${(WEB_PITCH_DECK_PRICE_CENTS / 100).toFixed(2)} to generate pitch deck</a>
      ${errorNote}
    </div>`;
    }
  }

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preferences ASP Unlock</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell narrow"><a href="/" class="back-link">← Run another validation</a><section class="hero-card">${links}${pitchDeckSection}<div class="result-card"><p class="eyebrow">Concept</p><h1>${escapeHtml(session?.pitch || 'Preferences ASP validation')}</h1><ul>${previewItems}</ul></div></section></main><div id="toast-stack" class="toast-stack"></div><script src="/pitch-deck-status.js?v=1" type="module"></script></body></html>`;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char]));
}
function escapeAttr(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}

async function sendDiscordUnlock(discordPayload, channelId, userId) {
  if (DISCORD_WEBHOOK_URL) {
    const discordResponse = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload)
    });
    if (!discordResponse.ok) throw new Error(`Discord webhook rejected payload: ${discordResponse.status} ${discordResponse.statusText} ${await discordResponse.text()}`);
    console.log('🚀 Payment unlock message dispatched to Discord webhook.');
    return;
  }

  if (DISCORD_BOT_TOKEN && channelId) {
    const botResponse = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload)
    });
    if (!botResponse.ok) throw new Error(`Discord bot message rejected payload: ${botResponse.status} ${botResponse.statusText} ${await botResponse.text()}`);
    console.log(`🚀 Payment unlock message dispatched to Discord channel ${channelId}.`);
    return;
  }

  if (DISCORD_BOT_TOKEN && userId) {
    const dmResponse = await fetch('https://discord.com/api/v10/users/@me/channels', {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient_id: userId })
    });
    if (!dmResponse.ok) throw new Error(`Discord DM channel creation rejected: ${dmResponse.status} ${dmResponse.statusText} ${await dmResponse.text()}`);
    const dmChannel = await dmResponse.json();
    const botResponse = await fetch(`https://discord.com/api/v10/channels/${dmChannel.id}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(discordPayload)
    });
    if (!botResponse.ok) throw new Error(`Discord bot DM rejected payload: ${botResponse.status} ${botResponse.statusText} ${await botResponse.text()}`);
    console.log(`🚀 Payment unlock message dispatched to Discord user ${userId}.`);
    return;
  }

  throw new Error('No Discord delivery route configured.');
}

// Stripe webhook must stay before express.json() so raw signature verification works.
app.post('/webhook', express.raw({ type: 'application/json' }), async (request, response) => {
  let event = request.body;
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (endpointSecret && stripe) {
    const signature = request.headers['stripe-signature'];
    try {
      event = stripe.webhooks.constructEvent(request.body, signature, endpointSecret);
    } catch (err) {
      console.error('⚠️ Webhook signature verification failed:', err.message);
      return response.sendStatus(400);
    }
  } else {
    try { event = JSON.parse(request.body); } catch { return response.sendStatus(400); }
  }

  if (event.type === 'checkout.session.completed') {
    const checkout = event.data.object;
    const validationId = checkout.metadata?.validation_id;
    const discordUserId = checkout.metadata?.discord_id || null;
    const discordChannelId = checkout.metadata?.channel_id || null;
    const pitch = checkout.metadata?.pitch || 'Dynamic Concept Framework';

    if (validationId) {
      const webSession = getWebSession(validationId);
      if (webSession) {
        saveWebSession({ validation_id: validationId, paid: true, paid_at: new Date().toISOString(), stripe_checkout_session_id: checkout.id });
        console.log(`💰 [WEB PAYMENT VERIFIED] ${validationId} unlocked for: ${pitch}`);
        return response.json({ received: true, validation_id: validationId });
      }
      if (checkout.payment_status === 'paid') {
        sessionFromCheckoutMetadata(checkout, validationId);
        console.log(`💰 [WEB PAYMENT RECOVERED FROM STRIPE METADATA] ${validationId} unlocked for: ${pitch}`);
        return response.json({ received: true, validation_id: validationId, recovered: true });
      }
    }

    // Backward-compatible Discord unlock path for existing slash-command flow.
    let surveyId = 'survey_rdohjcsqytgjsg40';
    let simulationId = 'AeHA3EN8az46uHPX4DjF';
    try {
      if (fs.existsSync(ACTIVE_MANIFEST_PATH)) {
        const stateManifest = JSON.parse(fs.readFileSync(ACTIVE_MANIFEST_PATH, 'utf8'));
        surveyId = stateManifest.survey_id || surveyId;
        simulationId = stateManifest.simulation_id || simulationId;
      }
    } catch (err) {
      console.error('⚠️ Error parsing runtime state manifest file:', err.message);
    }

    const surveyDashboardUrl = `https://dashboard.preferencesai.io/surveys/${surveyId}`;
    const simulationDashboardUrl = `https://dashboard.preferencesai.io/simulations/${simulationId}`;
    const discordPayload = {
      content: discordUserId ? `🔔 **Payment Confirmed!** <@${discordUserId}>` : '🔔 **Payment Confirmed!**',
      embeds: [{
        title: '🔓 PREFERENCES AI PORTAL UNLOCKED',
        description: `The discovery assets for *"${pitch}"* are active.\n\n➡️ **[📝 View Unlocked Survey](${surveyDashboardUrl})**\n\n➡️ **[📈 View Live Simulation Logs](${simulationDashboardUrl})**`,
        color: 65280,
        fields: [
          { name: '📋 Survey API State', value: `Live provisioned instance tracking key \`${surveyId}\`.`, inline: true },
          { name: '📊 Simulation Matrix State', value: `Active running profile benchmark matrix key \`${simulationId}\`.`, inline: true }
        ],
        footer: { text: `Session Validation ID: ${checkout.id}` }
      }]
    };

    try { await sendDiscordUnlock(discordPayload, discordChannelId, discordUserId); }
    catch (error) { console.error('❌ Failed to push payment unlock data downstream to Discord:', error.message); }
  }
  response.json({ received: true });
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(STATIC_DIR));

app.post('/api/validate', async (req, res) => {
  const pitch = trimText(req.body?.pitch, 1000).trim();
  if (pitch.length < 8) return res.status(400).json({ error: 'Please enter a concept brief with at least 8 characters.' });

  const validationId = crypto.randomUUID();
  const preview = await buildHermesPreviewReport(pitch);
  let assets;
  let liveStatus = 'pending';
  let liveError = '';

  try {
    assets = await provisionPreferencesAssets(pitch, preview);
    liveStatus = assets.status || 'created';
  } catch (error) {
    console.error('⚠️ Web PreferencesAI provisioning failed:', error.message);
    liveStatus = 'failed';
    liveError = error.message;
    assets = { live: false, status: 'failed', message: error.message };
  }

  const validationSession = saveWebSession({
    validation_id: validationId,
    created_at: new Date().toISOString(),
    pitch,
    preview,
    pitch_category: preview.pitch_category,
    survey_id: assets.survey_id || '',
    simulation_id: assets.simulation_id || '',
    survey_url: assets.survey_url || '',
    simulation_url: assets.simulation_url || '',
    estimate: assets.estimate || null,
    simulation_status: assets.simulation_status || 'not_available',
    simulation_message: assets.simulation_message || assets.message || '',
    live_status: liveStatus,
    live_error: liveError,
    paid: false
  });

  try {
    const checkoutSession = await createCheckoutSession(validationSession, req);
    if (checkoutSession) validationSession.checkout_url = checkoutSession.url;
  } catch (error) {
    console.error('⚠️ Stripe Checkout creation failed:', error.message);
    saveWebSession({ validation_id: validationId, checkout_error: error.message });
    validationSession.checkout_error = error.message;
  }

  res.json({ ...publicWebSession({ ...validationSession, checkout_url: validationSession.checkout_url }), checkout_error: validationSession.checkout_error || '', live_error: WEB_REQUIRE_PAYMENT_FOR_DASHBOARD_LINKS ? undefined : liveError });
});

app.post('/api/session/:validationId/retry', async (req, res) => {
  const validationId = String(req.params.validationId || '');
  try {
    const session = await retryPreferencesProvisioning(validationId);
    res.json(publicWebSession(session));
  } catch (error) {
    const status = error.status || 500;
    const existing = getWebSession(validationId);
    if (existing) saveWebSession({ validation_id: validationId, live_status: 'failed', live_error: error.message, simulation_message: error.message });
    console.error('⚠️ Web PreferencesAI retry provisioning failed:', error.message);
    res.status(status).json({ error: error.message });
  }
});

app.get('/api/session/:validationId', (req, res) => {
  const session = getWebSession(req.params.validationId);
  if (!session) return res.status(404).json({ error: 'Validation session not found.' });
  res.json(publicWebSession(session));
});

app.get('/success', async (req, res) => {
  const validationId = String(req.query.validation_id || '');
  const checkoutSessionId = String(req.query.session_id || '');
  const deckSessionId = String(req.query.deck_session_id || '');
  let session = validationId ? getWebSession(validationId) : null;
  let unlocked = false;
  let error = '';
  try {
    session = await verifyPaidUnlock(validationId, checkoutSessionId);
    unlocked = true;
  } catch (err) {
    error = err.message;
  }

  let pitchDeckUnlocked = false;
  let pitchDeckError = '';
  let pitchDeckReady = false;
  let pitchDeckStatus = null;
  if (unlocked) {
    const currentSession = getWebSession(validationId);
    if (currentSession?.pitch_deck_paid) {
      pitchDeckUnlocked = true;
      session = currentSession;
    } else if (deckSessionId) {
      try {
        session = await verifyPitchDeckPaid(validationId, deckSessionId);
        pitchDeckUnlocked = true;
      } catch (err) {
        console.warn('⚠️ Pitch deck payment verification failed:', err.message);
        pitchDeckError = 'not_paid';
      }
    } else if (req.query.deck_error) {
      pitchDeckError = String(req.query.deck_error);
    }

    if (pitchDeckUnlocked) {
      try {
        pitchDeckStatus = await checkPitchDeckReadiness(session);
        pitchDeckReady = pitchDeckStatus.deck_ready;
      } catch (err) {
        console.warn('⚠️ Pitch deck readiness check failed on page load:', err.message);
      }
    }
  }

  res.type('html').send(renderSuccessPage({ session, unlocked, error, pitchDeckUnlocked, pitchDeckError, pitchDeckReady, pitchDeckStatus, deckSessionId }));
});

app.get('/api/session/:validationId/pitch-deck/checkout', async (req, res) => {
  const validationId = String(req.params.validationId || '');
  const backUrl = `/success?validation_id=${encodeURIComponent(validationId)}`;
  const session = getWebSession(validationId);
  if (!session) return res.redirect(303, `${backUrl}&deck_error=checkout_unavailable`);

  try {
    const checkoutSession = await createPitchDeckCheckoutSession(session, req);
    if (!checkoutSession) throw new Error('Stripe is not configured on this server.');
    return res.redirect(303, checkoutSession.url);
  } catch (error) {
    console.error('⚠️ Pitch deck Stripe Checkout creation failed:', error.message);
    return res.redirect(303, `${backUrl}&deck_error=checkout_unavailable`);
  }
});

app.get('/api/session/:validationId/pitch-deck/status', async (req, res) => {
  const validationId = String(req.params.validationId || '');
  const deckSessionId = String(req.query.deck_session_id || '');

  let session;
  try {
    session = await verifyPitchDeckPaid(validationId, deckSessionId);
  } catch (error) {
    return res.json({ paid: false });
  }

  try {
    const status = await checkPitchDeckReadiness(session);
    return res.json({ paid: true, ...status });
  } catch (error) {
    console.error('⚠️ Pitch deck readiness check failed:', error.message);
    return res.json({ paid: true, deck_ready: false, simulation_status: 'unknown', deck_error: 'generation_failed' });
  }
});

app.get('/api/session/:validationId/pitch-deck/download', async (req, res) => {
  const validationId = String(req.params.validationId || '');
  const deckSessionId = String(req.query.deck_session_id || '');
  const backUrl = `/success?validation_id=${encodeURIComponent(validationId)}${deckSessionId ? `&deck_session_id=${encodeURIComponent(deckSessionId)}` : ''}`;

  let session;
  try {
    session = await verifyPitchDeckPaid(validationId, deckSessionId);
  } catch (error) {
    console.warn('⚠️ Pitch deck download blocked, payment not verified:', error.message);
    return res.redirect(303, `${backUrl}&deck_error=not_paid`);
  }

  try {
    const deck = (session.pitch_deck_ready && session.pitch_deck_content)
      ? session.pitch_deck_content
      : await buildHermesPitchDeckReport(session);
    const buffer = await buildPitchDeckBuffer(session, deck);
    const safeName = String(session.pitch || 'pitch-deck').slice(0, 40).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'pitch-deck';
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}-pitch-deck.pptx"`);
    return res.send(buffer);
  } catch (error) {
    console.error('⚠️ Pitch deck generation failed:', error.message);
    return res.redirect(303, `${backUrl}&deck_error=generation_failed`);
  }
});

app.get('/cancel', (req, res) => {
  const validationId = String(req.query.validation_id || '');
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Checkout cancelled</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell narrow"><a href="/" class="back-link">← Back</a><section class="hero-card"><h1>Checkout cancelled</h1><p>Your free preview is still saved${validationId ? ` under validation ID <code>${escapeHtml(validationId)}</code>` : ''}. You can run another validation anytime.</p></section></main></body></html>`);
});

if (process.env.WEB_DISABLE_SERVER_LISTEN !== '1' && !IS_VERCEL) {
  app.listen(port, () => {
    console.log(`Preferences ASP Concierge active: http://localhost:${port}`);
  });
}

export default app;

export {
  app,
  WEB_PRODUCT_NAME,
  buildPreviewReport,
  buildHermesPreviewReport,
  provisionPreferencesAssets,
  buildFallbackSurveySections,
  createSurveyWithFallback,
  buildHermesCliArgs,
  extractJsonObject,
  normalizeSummaryMatrix,
  publicBaseUrl,
  runHermesCli,
  runHermesViaOpenAiApi,
  runHermesViaGeminiApi,
  verifyPaidUnlock,
  sessionFromCheckoutMetadata,
  retryPreferencesProvisioning,
  saveWebSession,
  getWebSession,
  buildPitchDeckFallback,
  buildPitchDeckPrompt,
  buildHermesPitchDeckReport,
  buildPitchDeckBuffer,
  fetchSimulationInsights,
  summarizeSimulationInsights,
  extractSimulationInsightHighlights,
  verifyPitchDeckPaid,
  checkPitchDeckReadiness,
  WEB_PITCH_DECK_PRICE_CENTS
};
