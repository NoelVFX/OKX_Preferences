import express from 'express';
import Stripe from 'stripe';
import fs from 'fs';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

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
const HERMES_PROVIDER = process.env.HERMES_PROVIDER || (IS_VERCEL && process.env.OPENAI_API_KEY ? 'openai-api' : '');
const HERMES_MODEL = process.env.HERMES_MODEL || (IS_VERCEL && process.env.OPENAI_API_KEY ? 'gpt-5.5' : '');

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
  console.log(`Hermes preview CLI enabled: command=${HERMES_COMMAND} provider=${HERMES_PROVIDER || '(default config)'} model=${HERMES_MODEL || '(default config)'} timeout=${HERMES_PREVIEW_TIMEOUT}ms`);
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

async function buildHermesPreviewReport(pitch, { runHermes = runHermesCli } = {}) {
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

function renderSuccessPage({ session, unlocked, error }) {
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

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Preferences ASP Unlock</title><link rel="stylesheet" href="/styles.css"></head><body><main class="shell narrow"><a href="/" class="back-link">← Run another validation</a><section class="hero-card">${links}<div class="result-card"><p class="eyebrow">Concept</p><h1>${escapeHtml(session?.pitch || 'Preferences ASP validation')}</h1><ul>${previewItems}</ul></div></section></main></body></html>`;
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
  let session = validationId ? getWebSession(validationId) : null;
  let unlocked = false;
  let error = '';
  try {
    session = await verifyPaidUnlock(validationId, checkoutSessionId);
    unlocked = true;
  } catch (err) {
    error = err.message;
  }
  res.type('html').send(renderSuccessPage({ session, unlocked, error }));
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
  verifyPaidUnlock,
  sessionFromCheckoutMetadata,
  retryPreferencesProvisioning,
  saveWebSession,
  getWebSession
};
