import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';

const sessionStorePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-web-sessions-')), 'sessions.json');

process.env.WEB_DISABLE_SERVER_LISTEN = '1';
process.env.WEB_SESSION_STORE_PATH = sessionStorePath;
process.env.PREFERENCES_AI_API_KEY = 'test-preferences-key';
process.env.STRIPE_SECRET_KEY = '';
process.env.HERMES_PREVIEW_USE_CLI = '1';

// OKX Wallet crypto payment test config (enables CRYPTO_PAYMENTS_ENABLED).
const CRYPTO_RECIPIENT = '0x1111111111111111111111111111111111111111';
process.env.OKX_RECEIVING_ADDRESS = CRYPTO_RECIPIENT;
process.env.WEB_CRYPTO_TX_STORE_PATH = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-crypto-tx-')), 'used.json');

const server = await import('../server.js');

test('Vercel can import the Express app as the default serverless export', () => {
  assert.equal(server.default, server.app);
  assert.equal(typeof server.default, 'function');
});

test('Vercel checkout URLs prefer the request host over a stale ngrok DOMAIN', () => {
  const previousVercel = process.env.VERCEL;
  const previousDomain = process.env.DOMAIN;
  const previousVercelUrl = process.env.VERCEL_URL;
  process.env.VERCEL = '1';
  process.env.DOMAIN = 'https://wildfowl-cubicle-line.ngrok-free.dev';
  delete process.env.VERCEL_URL;

  try {
    assert.equal(server.publicBaseUrl({
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'okx-preferences.vercel.app'
      }
    }), 'https://okx-preferences.vercel.app');
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousDomain === undefined) delete process.env.DOMAIN; else process.env.DOMAIN = previousDomain;
    if (previousVercelUrl === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = previousVercelUrl;
  }
});

test('Vercel checkout URLs use VERCEL_URL instead of stale ngrok when no request host is available', () => {
  const previousVercel = process.env.VERCEL;
  const previousDomain = process.env.DOMAIN;
  const previousVercelUrl = process.env.VERCEL_URL;
  process.env.VERCEL = '1';
  process.env.DOMAIN = 'https://wildfowl-cubicle-line.ngrok-free.dev';
  process.env.VERCEL_URL = 'okx-preferences.vercel.app';

  try {
    assert.equal(server.publicBaseUrl(), 'https://okx-preferences.vercel.app');
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = previousVercel;
    if (previousDomain === undefined) delete process.env.DOMAIN; else process.env.DOMAIN = previousDomain;
    if (previousVercelUrl === undefined) delete process.env.VERCEL_URL; else process.env.VERCEL_URL = previousVercelUrl;
  }
});

test('product configuration names the standalone ASP concierge', () => {
  assert.equal(server.WEB_PRODUCT_NAME, 'Preferences ASP Concierge Unlock');
});

test('Hermes prompt asks for standalone ASP positioning without campaign branding', async () => {
  let capturedPrompt = '';
  await server.buildHermesPreviewReport('AI concierge that validates startup ideas through digital surveys', {
    runHermes: async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        pitch_category: 'agent_service_provider',
        demographic_a: 'AI startup founders ages 24-42 preparing product launches',
        demographic_b: 'Innovation teams ages 30-55 validating new internal tools',
        affinity_a: '82.1%',
        affinity_b: '64.2%',
        summary_matrix: ['ASP fit: the product packages validation as a repeatable agent service.']
      });
    }
  });

  assert.match(capturedPrompt, /Agent Service Provider/);
  assert.match(capturedPrompt, /repeatable paid validation service/);
  assert.doesNotMatch(capturedPrompt, /OKX/i);
  assert.doesNotMatch(capturedPrompt, /#OKXAI/i);
  assert.doesNotMatch(capturedPrompt, /Hackathon/i);
});

test('buildHermesPreviewReport uses Hermes JSON over the local fallback', async () => {
  const preview = await server.buildHermesPreviewReport('cold resistant teddy bear', {
    runHermes: async () => JSON.stringify({
      pitch_category: 'cold_weather_plush_toy',
      demographic_a: 'Parents ages 28-42 in snowy climates buying comfort toys for children ages 3-8',
      demographic_b: 'Outdoor gift shoppers ages 18-30 who camp, ski, or attend winter events',
      affinity_a: '78.6%',
      affinity_b: '57.9%',
      summary_matrix: [
        'Group A values bedtime comfort plus winter durability.',
        'Group B treats it as a novelty winter gift.'
      ]
    })
  });

  assert.equal(preview.pitch_category, 'cold_weather_plush_toy');
  assert.equal(preview.preview_source, 'hermes_agent');
  assert.match(preview.demographic_a, /Parents ages 28-42/);
  assert.match(preview.demographic_b, /Outdoor gift shoppers ages 18-30/);
  assert.deepEqual(preview.summary_matrix, [
    'Group A values bedtime comfort plus winter durability.',
    'Group B treats it as a novelty winter gift.'
  ]);
});

test('buildHermesPreviewReport falls back when Hermes output is invalid', async () => {
  const preview = await server.buildHermesPreviewReport('cold resistant teddy bear', {
    runHermes: async () => 'not json'
  });

  assert.equal(preview.pitch_category, 'general_consumer');
  assert.equal(preview.preview_source, 'local_fallback');
  assert.match(preview.preview_error, /not json/);
  assert.match(preview.demographic_a, /Early-adopter consumers/);
  assert.ok(Array.isArray(preview.summary_matrix));
});

test('buildHermesPreviewReport converts string summary_matrix into browser list items', async () => {
  const preview = await server.buildHermesPreviewReport('AI accounting agent for dentists', {
    runHermes: async () => JSON.stringify({
      pitch_category: 'vertical_saas',
      demographic_a: 'Dental practice owners ages 35-60 with 3-20 staff',
      demographic_b: 'Bookkeepers ages 28-55 serving healthcare clinics',
      affinity_a: '81.2%',
      affinity_b: '62.4%',
      summary_matrix: '• **Driver:** less admin time\n• **Objection:** trust in financial automation'
    })
  });

  assert.deepEqual(preview.summary_matrix, [
    '**Driver:** less admin time',
    '**Objection:** trust in financial automation'
  ]);
});

test('runHermesCli uses documented quiet chat one-shot args', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-hermes-cli-'));
  const argvPath = path.join(tempDir, 'argv.json');
  const fakeHermesPath = path.join(tempDir, 'fake-hermes.mjs');
  fs.writeFileSync(fakeHermesPath, `#!/usr/bin/env node\nimport fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(argvPath)}, JSON.stringify(process.argv.slice(2)));\nconsole.log(JSON.stringify({ pitch_category: 'ok', demographic_a: 'Group A ages 20-30', demographic_b: 'Group B ages 31-40', summary_matrix: ['ok'] }));\n`);
  fs.chmodSync(fakeHermesPath, 0o755);

  const output = await server.runHermesCli('test prompt', { command: fakeHermesPath, timeoutMs: 5000 });
  assert.match(output, /"pitch_category":"ok"/);
  assert.deepEqual(JSON.parse(fs.readFileSync(argvPath, 'utf8')), [
    'chat',
    '-Q',
    '--ignore-rules',
    '-q',
    'test prompt'
  ]);
});

test('buildHermesCliArgs includes Railway provider and model overrides when configured', () => {
  assert.deepEqual(server.buildHermesCliArgs('test prompt', { provider: 'openai-api', model: 'gpt-5.5' }), [
    'chat',
    '-Q',
    '--ignore-rules',
    '--provider',
    'openai-api',
    '-m',
    'gpt-5.5',
    '-q',
    'test prompt'
  ]);
});

test('runHermesCli reports actionable diagnostics when the CLI fails in production', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-hermes-cli-fail-'));
  const fakeHermesPath = path.join(tempDir, 'fake-hermes-fail.mjs');
  fs.writeFileSync(fakeHermesPath, `#!/usr/bin/env node\nconsole.error('missing provider api key');\nprocess.exit(7);\n`);
  fs.chmodSync(fakeHermesPath, 0o755);

  await assert.rejects(
    () => server.runHermesCli('test prompt', { command: fakeHermesPath, timeoutMs: 5000 }),
    (error) => {
      assert.match(error.message, /process exited non-zero/);
      assert.match(error.message, /exit_code=7/);
      assert.match(error.message, /stderr_bytes=/);
      assert.match(error.message, /missing provider api key/);
      return true;
    }
  );
});

test('runHermesViaOpenAiApi posts a JSON-mode chat completion and returns the message content', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ choices: [{ message: { content: '{"pitch_category":"ok"}' } }] })
    };
  };

  const output = await server.runHermesViaOpenAiApi('test prompt', { apiKey: 'sk-test', model: 'gpt-5.5', fetchImpl: fakeFetch });

  assert.equal(output, '{"pitch_category":"ok"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].body.model, 'gpt-5.5');
  assert.deepEqual(calls[0].body.response_format, { type: 'json_object' });
  assert.deepEqual(calls[0].body.messages, [{ role: 'user', content: 'test prompt' }]);
});

test('runHermesViaOpenAiApi surfaces the OpenAI error detail on a non-2xx response', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 401,
    statusText: 'Unauthorized',
    json: async () => ({ error: { message: 'Incorrect API key provided' } })
  });

  await assert.rejects(
    () => server.runHermesViaOpenAiApi('test prompt', { apiKey: 'sk-bad', fetchImpl: fakeFetch }),
    /401 Unauthorized.*Incorrect API key provided/
  );
});

test('runHermesViaOpenAiApi refuses to call out without an API key', async () => {
  await assert.rejects(
    () => server.runHermesViaOpenAiApi('test prompt', { apiKey: '' }),
    /OPENAI_API_KEY is not set/
  );
});

test('runHermesViaGeminiApi posts a JSON-mode generateContent request and returns the candidate text', async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{"pitch_category":"ok"}' }] } }] })
    };
  };

  const output = await server.runHermesViaGeminiApi('test prompt', { apiKey: 'test-gemini-key', model: 'gemini-2.0-flash', fetchImpl: fakeFetch });

  assert.equal(output, '{"pitch_category":"ok"}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(calls[0].headers['x-goog-api-key'], 'test-gemini-key');
  assert.deepEqual(calls[0].body.generationConfig, { temperature: 0.7, response_mime_type: 'application/json' });
  assert.deepEqual(calls[0].body.contents, [{ parts: [{ text: 'test prompt' }] }]);
});

test('runHermesViaGeminiApi surfaces the Gemini error detail on a non-2xx response', async () => {
  const fakeFetch = async () => ({
    ok: false,
    status: 400,
    statusText: 'Bad Request',
    json: async () => ({ error: { message: 'API key not valid' } })
  });

  await assert.rejects(
    () => server.runHermesViaGeminiApi('test prompt', { apiKey: 'bad-key', fetchImpl: fakeFetch }),
    /400 Bad Request.*API key not valid/
  );
});

test('runHermesViaGeminiApi refuses to call out without an API key', async () => {
  await assert.rejects(
    () => server.runHermesViaGeminiApi('test prompt', { apiKey: '' }),
    /GEMINI_API_KEY is not set/
  );
});

test('buildHermesPreviewReport uses the injected OpenAI runner end to end', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      choices: [{
        message: {
          content: JSON.stringify({
            pitch_category: 'clinic_ops',
            demographic_a: 'Busy clinic admins ages 28-45',
            demographic_b: 'Solo practitioners ages 35-60',
            affinity_a: '82.1%',
            affinity_b: '61.4%',
            summary_matrix: ['driver', 'objection', 'validation test', 'ASP note']
          })
        }
      }]
    })
  });

  const preview = await server.buildHermesPreviewReport('AI scheduling concierge for small clinics', {
    runHermes: (prompt) => server.runHermesViaOpenAiApi(prompt, { apiKey: 'sk-test', model: 'gpt-5.5', fetchImpl: fakeFetch })
  });

  assert.equal(preview.preview_source, 'hermes_agent');
  assert.equal(preview.pitch_category, 'clinic_ops');
  assert.equal(preview.demographic_a, 'Busy clinic admins ages 28-45');
});

test('buildHermesPreviewReport uses the injected Gemini runner end to end', async () => {
  const fakeFetch = async () => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              pitch_category: 'clinic_ops',
              demographic_a: 'Busy clinic admins ages 28-45',
              demographic_b: 'Solo practitioners ages 35-60',
              affinity_a: '82.1%',
              affinity_b: '61.4%',
              summary_matrix: ['driver', 'objection', 'validation test', 'ASP note']
            })
          }]
        }
      }]
    })
  });

  const preview = await server.buildHermesPreviewReport('AI scheduling concierge for small clinics', {
    runHermes: (prompt) => server.runHermesViaGeminiApi(prompt, { apiKey: 'test-gemini-key', model: 'gemini-2.0-flash', fetchImpl: fakeFetch })
  });

  assert.equal(preview.preview_source, 'hermes_agent');
  assert.equal(preview.pitch_category, 'clinic_ops');
  assert.equal(preview.demographic_a, 'Busy clinic admins ages 28-45');
});

test('retryPreferencesProvisioning returns an already-provisioned session without another API call', async () => {
  const validationId = 'retry-test-validation';
  const existing = server.saveWebSession({
    validation_id: validationId,
    pitch: 'AI study coach for college students',
    preview: server.buildPreviewReport('AI study coach for college students'),
    live_status: 'created',
    survey_id: 'survey_existing_test',
    simulation_id: 'simulation_existing_test'
  });

  const retried = await server.retryPreferencesProvisioning(validationId);

  assert.equal(retried.validation_id, validationId);
  assert.equal(retried.live_status, 'created');
  assert.equal(retried.survey_id, existing.survey_id);
  assert.equal(retried.simulation_id, existing.simulation_id);
});

test('provisionPreferencesAssets returns created survey when simulation launch fails', async () => {
  const calls = [];
  const fakeRequest = async (method, endpoint) => {
    calls.push(`${method} ${endpoint}`);
    if (method === 'GET' && endpoint === '/balance') return { data: { pru_balance: 100 } };
    if (method === 'POST' && endpoint === '/surveys/build') return { data: { survey_content: [{ title: 'Fit', questions: [] }] } };
    if (method === 'POST' && endpoint === '/surveys') return { data: { survey_id: 'survey_partial_test' } };
    if (method === 'GET' && endpoint === '/surveys/survey_partial_test') return { data: { id: 'survey_partial_test' } };
    if (method === 'POST' && endpoint === '/simulations/estimate-cost') return { data: { pru_cost: 10, respondents: 100 } };
    if (method === 'POST' && endpoint === '/simulations') throw new Error('simulation upstream 502');
    throw new Error(`unexpected request ${method} ${endpoint}`);
  };

  const assets = await server.provisionPreferencesAssets('AI elder health consultant', server.buildPreviewReport('AI elder health consultant'), {
    request: fakeRequest
  });

  assert.equal(assets.status, 'created');
  assert.equal(assets.survey_id, 'survey_partial_test');
  assert.equal(assets.survey_url, 'https://dashboard.preferencesai.io/surveys/survey_partial_test');
  assert.equal(assets.simulation_id, '');
  assert.equal(assets.simulation_status, 'failed');
  assert.match(assets.simulation_message, /simulation upstream 502/);
  assert.deepEqual(calls, [
    'POST /surveys/build',
    'POST /surveys',
    'GET /surveys/survey_partial_test',
    'GET /balance',
    'POST /simulations/estimate-cost',
    'POST /simulations'
  ]);
});

test('provisionPreferencesAssets retries with deterministic survey sections when Preferences AI rejects generated content', async () => {
  let surveyCreateAttempts = 0;
  let fallbackSections = null;
  const calls = [];
  const fakeRequest = async (method, endpoint, options = {}) => {
    calls.push(`${method} ${endpoint}`);
    if (method === 'POST' && endpoint === '/surveys/build') {
      return { data: { survey_content: [{ title: 'Generated but invalid', questions: [{ question_type: 'unsupported_type', question: 'Bad?', choices: [] }] }] } };
    }
    if (method === 'POST' && endpoint === '/surveys') {
      surveyCreateAttempts += 1;
      if (surveyCreateAttempts === 1) {
        const error = new Error('Preferences AI POST /surveys failed: HTTP 400 Invalid survey data');
        error.status = 400;
        throw error;
      }
      fallbackSections = options.body.sections;
      return { data: { survey_id: 'survey_fallback_retry_test' } };
    }
    if (method === 'GET' && endpoint === '/surveys/survey_fallback_retry_test') return { data: { id: 'survey_fallback_retry_test' } };
    if (method === 'GET' && endpoint === '/balance') return { data: { pru_balance: 0 } };
    if (method === 'POST' && endpoint === '/simulations/estimate-cost') return { data: { pru_cost: 10, respondents: 100 } };
    throw new Error(`unexpected request ${method} ${endpoint}`);
  };

  const assets = await server.provisionPreferencesAssets('AI notes app for students', server.buildPreviewReport('AI notes app for students'), {
    request: fakeRequest
  });

  assert.equal(assets.status, 'created');
  assert.equal(assets.survey_id, 'survey_fallback_retry_test');
  assert.equal(surveyCreateAttempts, 2);
  assert.ok(Array.isArray(fallbackSections));
  assert.equal(fallbackSections[0].section_id, 'sec_1');
  assert.equal(fallbackSections[0].questions[0].question_type, 'multiple_choice');
  assert.deepEqual(calls.slice(0, 4), ['POST /surveys/build', 'POST /surveys', 'POST /surveys', 'GET /surveys/survey_fallback_retry_test']);
});

test('verifyPaidUnlock recovers paid web session from Stripe metadata when Vercel lost local session state', async () => {
  const validationId = 'stripe-recovered-validation-test';
  const checkoutSession = {
    id: 'cs_test_recovered',
    payment_status: 'paid',
    metadata: {
      validation_id: validationId,
      pitch: 'AI meal planning concierge for busy parents',
      survey_id: 'survey_recovered_test',
      simulation_id: 'simulation_recovered_test',
      live_status: 'created',
      simulation_status: 'launched'
    }
  };

  const recovered = await server.verifyPaidUnlock(validationId, checkoutSession.id, {
    retrieveCheckoutSession: async (id) => {
      assert.equal(id, checkoutSession.id);
      return checkoutSession;
    }
  });

  assert.equal(recovered.validation_id, validationId);
  assert.equal(recovered.paid, true);
  assert.equal(recovered.stripe_checkout_session_id, checkoutSession.id);
  assert.equal(recovered.pitch, 'AI meal planning concierge for busy parents');
  assert.equal(recovered.survey_url, 'https://dashboard.preferencesai.io/surveys/survey_recovered_test');
  assert.equal(recovered.simulation_url, 'https://dashboard.preferencesai.io/simulations/simulation_recovered_test');
  assert.equal(server.getWebSession(validationId).paid, true);
});

test('verifyPaidUnlock stays unlocked on a later /success visit with no session_id (e.g. redirected back from the pitch deck checkout)', async () => {
  const validationId = 'already-paid-revisit-test';
  server.saveWebSession({
    validation_id: validationId,
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    paid: true,
    paid_at: new Date().toISOString()
  });

  const result = await server.verifyPaidUnlock(validationId, '', {
    retrieveCheckoutSession: async () => { throw new Error('should not call Stripe for an already-paid session'); }
  });

  assert.equal(result.paid, true);
  assert.equal(result.validation_id, validationId);
});

test('buildHermesPitchDeckReport uses Hermes JSON over the local fallback', async () => {
  const session = {
    validation_id: 'deck-test-1',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics')
  };

  const deck = await server.buildHermesPitchDeckReport(session, {
    fetchInsights: async () => null,
    runHermes: async () => JSON.stringify({
      title: 'ClinicFlow',
      tagline: 'Never miss another patient call.',
      problem: 'Clinics lose revenue to missed calls.',
      solution: 'An AI concierge answers and books automatically.',
      market_opportunity: 'Two validated segments show strong demand.',
      target_segments: [{ name: 'Clinic admins', affinity: '82.1%' }, { name: 'Solo practitioners', affinity: '61.4%' }],
      validation_findings: ['Admins want less phone time.', 'Practitioners worry about trust.'],
      business_model: 'Monthly SaaS subscription per clinic.',
      go_to_market: 'Partner with clinic software vendors.',
      ask: 'Seeking 5 pilot clinics.',
      next_steps: ['Ship pilot', 'Collect feedback', 'Expand']
    })
  });

  assert.equal(deck.deck_source, 'hermes_agent');
  assert.equal(deck.title, 'ClinicFlow');
  assert.equal(deck.target_segments.length, 2);
  assert.deepEqual(deck.validation_findings, ['Admins want less phone time.', 'Practitioners worry about trust.']);
});

test('buildHermesPitchDeckReport falls back to validation-derived deck content when Hermes output is invalid', async () => {
  const session = {
    validation_id: 'deck-test-2',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics')
  };

  const deck = await server.buildHermesPitchDeckReport(session, {
    fetchInsights: async () => null,
    runHermes: async () => 'not json'
  });

  assert.equal(deck.deck_source, 'local_fallback');
  assert.match(deck.deck_error, /not json/);
  assert.equal(deck.target_segments[0].name, session.preview.demographic_a);
  assert.equal(deck.target_segments[1].name, session.preview.demographic_b);
  assert.ok(Array.isArray(deck.validation_findings));
});

test('buildHermesPitchDeckReport attaches real simulation findings/recommendations even when Hermes fails', async () => {
  const session = {
    validation_id: 'deck-test-2b',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: 'sim_with_real_insights'
  };

  const deck = await server.buildHermesPitchDeckReport(session, {
    fetchInsights: async () => ({
      status: 'completed',
      respondent_count: 369,
      desired_respondent_count: 357,
      insights: {
        key_findings: [{ finding: 'Strong product-market fit.', confidence: 'high', evidence_question_ids: ['q09'] }],
        recommendations: [{ recommendation: 'Lead with the B2B pitch.', priority: 'high' }]
      }
    }),
    runHermes: async () => { throw new Error('Hermes is down'); }
  });

  assert.equal(deck.deck_source, 'local_fallback');
  assert.equal(deck.simulation_key_findings.length, 1);
  assert.match(deck.simulation_key_findings[0].text, /Strong product-market fit/);
  assert.equal(deck.simulation_recommendations.length, 1);
  assert.match(deck.simulation_recommendations[0].text, /Lead with the B2B pitch/);
});

test('buildHermesPitchDeckReport continues without simulation insights when fetching them fails', async () => {
  const session = {
    validation_id: 'deck-test-3',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: 'simulation_test_123'
  };
  let capturedPrompt = '';

  const deck = await server.buildHermesPitchDeckReport(session, {
    fetchInsights: async () => { throw new Error('simulation results endpoint not available'); },
    runHermes: async (prompt) => {
      capturedPrompt = prompt;
      return JSON.stringify({
        title: 'Deck',
        problem: 'p',
        solution: 's',
        target_segments: [{ name: 'A', affinity: '1%' }, { name: 'B', affinity: '2%' }],
        validation_findings: ['f1']
      });
    }
  });

  assert.equal(deck.deck_source, 'hermes_agent');
  assert.match(capturedPrompt, /Live simulation result data was not available/);
});

// Fixture shape confirmed against a live Preferences AI account's
// GET /simulations/:id response for a status: "completed" simulation with
// populated insights (an AI scheduling concierge for clinics run).
const REAL_COMPLETED_SIMULATION_FIXTURE = {
  status: 'completed',
  respondent_count: 369,
  desired_respondent_count: 357,
  insights: {
    key_findings: [
      {
        finding: 'Product-market fit is exceptionally strong, with 100% of respondents preferring automated 24/7 booking.',
        confidence: 'high',
        evidence_question_ids: ['q09', 'q11', 'q08'],
        follow_up_suggestion: { label: 'Map Booking Journeys' }
      },
      {
        finding: 'Trust and privacy are the primary adoption barriers, with only 57.3% rating the concept as trustworthy.',
        confidence: 'high',
        evidence_question_ids: ['q08', 'q13']
      }
    ],
    recommendations: [
      { recommendation: 'Position the product primarily as a B2B SaaS solution sold directly to clinics.', priority: 'high' },
      { recommendation: 'Prioritize HIPAA compliance and clear privacy guarantees in onboarding.', priority: 'medium' }
    ],
    segment_insights: [
      { segment: 'Parents & Caregivers', insight: 'Highest willingness to pay the convenience fee.', size_pct: 50.8 }
    ],
    goal_summary: 'The survey validates an exceptionally strong product-market fit for the AI scheduling concierge.'
  },
  analysis: {
    questions: [
      { text: 'Do you keep your business and personal banking accounts strictly separate?', type: 'yes_no', distribution: { No: 8, Yes: 361 } }
    ],
    summary: { total_respondents: 369, total_questions: 1 }
  }
};

test('extractSimulationInsightHighlights parses the real key_findings/recommendations object shape (not [object Object])', () => {
  const highlights = server.extractSimulationInsightHighlights(REAL_COMPLETED_SIMULATION_FIXTURE);

  assert.equal(highlights.keyFindings.length, 2);
  assert.match(highlights.keyFindings[0].text, /Product-market fit is exceptionally strong/);
  assert.equal(highlights.keyFindings[0].confidence, 'high');
  assert.deepEqual(highlights.keyFindings[0].evidence, ['Q09', 'Q11', 'Q08']);
  assert.equal(highlights.keyFindings[0].followUpLabel, 'Map Booking Journeys');

  assert.equal(highlights.recommendations.length, 2);
  assert.match(highlights.recommendations[0].text, /B2B SaaS solution/);
  assert.equal(highlights.recommendations[0].priority, 'high');

  assert.equal(highlights.segmentInsights.length, 1);
  assert.equal(highlights.segmentInsights[0].segment, 'Parents & Caregivers');
  assert.equal(highlights.segmentInsights[0].sizePct, 50.8);
});

test('summarizeSimulationInsights renders curated findings/recommendations as readable text, not [object Object]', () => {
  const summary = server.summarizeSimulationInsights(REAL_COMPLETED_SIMULATION_FIXTURE);

  assert.doesNotMatch(summary, /\[object Object\]/);
  assert.match(summary, /completed \(369\/357 respondents\)/);
  assert.match(summary, /Key finding \[high confidence\]: Product-market fit is exceptionally strong.*\(evidence: Q09, Q11, Q08\)/);
  assert.match(summary, /Recommendation \[high priority\]: Position the product primarily as a B2B SaaS solution/);
  assert.match(summary, /Segment insight — Parents & Caregivers \(50\.8% of respondents\)/);
});

test('summarizeSimulationInsights falls back to per-question distributions only when curated insights are empty', () => {
  const simulation = {
    status: 'completed',
    respondent_count: 369,
    desired_respondent_count: 357,
    insights: { key_findings: [], recommendations: [], goal_summary: "We couldn't generate an executive summary for this run." },
    analysis: {
      questions: [
        { text: 'Do you keep your business and personal banking accounts strictly separate?', type: 'yes_no', distribution: { No: 8, Yes: 361 } },
        { text: 'At what monthly subscription price would you consider this too expensive?', type: 'text', distribution: {}, sample_answers: ['30', '25', '30', '50'] }
      ]
    }
  };

  const summary = server.summarizeSimulationInsights(simulation);

  assert.match(summary, /Yes \(98%\)/);
  assert.match(summary, /sample respondent answers: 30; 25; 30/);
});

test('summarizeSimulationInsights returns just a status line for a still-running simulation with no analysis yet', () => {
  const summary = server.summarizeSimulationInsights({ status: 'running', respondent_count: 0, desired_respondent_count: 357 });
  assert.match(summary, /Simulation status: running \(0\/357 respondents\)/);
  assert.doesNotMatch(summary, /Key finding/);
});

test('buildPitchDeckPrompt cites real simulation findings instead of dumping raw JSON', () => {
  const session = {
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics')
  };

  const prompt = server.buildPitchDeckPrompt(session, REAL_COMPLETED_SIMULATION_FIXTURE);

  assert.match(prompt, /Cite specific numbers, percentages, or respondent quotes/);
  assert.match(prompt, /Product-market fit is exceptionally strong/);
  assert.doesNotMatch(prompt, /\[object Object\]/);
  assert.doesNotMatch(prompt, /"respondent_count":369/);
});

test('fetchSimulationInsights returns null when no simulation id or API key is available', async () => {
  const insights = await server.fetchSimulationInsights('', { request: async () => { throw new Error('should not be called'); } });
  assert.equal(insights, null);
});

async function countSlides(buffer) {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buffer);
  return Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).length;
}

test('buildPitchDeckBuffer produces a valid pptx (zip) buffer with one slide per section', async () => {
  const session = {
    validation_id: 'deck-test-4',
    pitch: 'AI scheduling concierge for small clinics'
  };
  const deck = server.buildPitchDeckFallback({ ...session, preview: server.buildPreviewReport(session.pitch) });

  const buffer = await server.buildPitchDeckBuffer(session, deck);

  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.slice(0, 2).toString(), 'PK');
  assert.ok(buffer.length > 1000);
  assert.equal(await countSlides(buffer), 10);
});

test('buildPitchDeckBuffer adds dedicated slides for real simulation findings and recommendations when present', async () => {
  const session = { validation_id: 'deck-test-4b', pitch: 'AI scheduling concierge for small clinics' };
  const baseDeck = server.buildPitchDeckFallback({ ...session, preview: server.buildPreviewReport(session.pitch) });

  const bufferWithout = await server.buildPitchDeckBuffer(session, baseDeck);
  const slidesWithout = await countSlides(bufferWithout);

  const deckWithInsights = {
    ...baseDeck,
    simulation_key_findings: [{ text: 'Strong product-market fit.', confidence: 'high', evidence: ['Q09'], followUpLabel: 'Map Booking Journeys' }],
    simulation_recommendations: [{ text: 'Lead with the B2B pitch.', priority: 'high' }]
  };
  const bufferWith = await server.buildPitchDeckBuffer(session, deckWithInsights);
  const slidesWith = await countSlides(bufferWith);

  assert.equal(slidesWith, slidesWithout + 2);
});

test('verifyPitchDeckPaid rejects a checkout session that is not marked for the pitch deck product', async () => {
  const validationId = 'deck-security-test-1';
  server.saveWebSession({
    validation_id: validationId,
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics')
  });

  const baseUnlockCheckoutSession = {
    id: 'cs_test_base_unlock_only',
    payment_status: 'paid',
    metadata: { validation_id: validationId }
  };

  await assert.rejects(
    () => server.verifyPitchDeckPaid(validationId, baseUnlockCheckoutSession.id, {
      retrieveCheckoutSession: async () => baseUnlockCheckoutSession
    }),
    /was not for the pitch deck add-on/
  );
  assert.equal(server.getWebSession(validationId).pitch_deck_paid, undefined);
});

test('verifyPitchDeckPaid marks the session paid for a genuine pitch deck checkout', async () => {
  const validationId = 'deck-security-test-2';
  server.saveWebSession({
    validation_id: validationId,
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics')
  });

  const deckCheckoutSession = {
    id: 'cs_test_deck_paid',
    payment_status: 'paid',
    metadata: { validation_id: validationId, product: 'pitch_deck', pitch: 'AI scheduling concierge for small clinics' }
  };

  const result = await server.verifyPitchDeckPaid(validationId, deckCheckoutSession.id, {
    retrieveCheckoutSession: async () => deckCheckoutSession
  });

  assert.equal(result.pitch_deck_paid, true);
  assert.equal(result.pitch_deck_checkout_session_id, deckCheckoutSession.id);
  assert.equal(server.getWebSession(validationId).pitch_deck_paid, true);
});

test('verifyPitchDeckPaid recovers from checkout metadata when the local session was lost (Vercel /tmp eviction)', async () => {
  const validationId = 'deck-security-test-3';
  const deckCheckoutSession = {
    id: 'cs_test_deck_recovered',
    payment_status: 'paid',
    metadata: { validation_id: validationId, product: 'pitch_deck', pitch: 'AI meal planning concierge for busy parents' }
  };

  const result = await server.verifyPitchDeckPaid(validationId, deckCheckoutSession.id, {
    retrieveCheckoutSession: async () => deckCheckoutSession
  });

  assert.equal(result.pitch_deck_paid, true);
  assert.equal(result.pitch, 'AI meal planning concierge for busy parents');
  assert.ok(result.preview);
});

test('checkPitchDeckReadiness keeps waiting while the simulation is still running', async () => {
  const session = {
    validation_id: 'deck-readiness-test-1',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: 'sim_running_test'
  };

  const status = await server.checkPitchDeckReadiness(session, {
    fetchInsights: async () => ({ status: 'running', respondent_count: 142, desired_respondent_count: 357 }),
    buildDeck: async () => { throw new Error('should not generate while still running'); }
  });

  assert.equal(status.deck_ready, false);
  assert.equal(status.simulation_status, 'running');
  assert.equal(status.respondent_count, 142);
  assert.equal(status.desired_respondent_count, 357);
  assert.equal(server.getWebSession('deck-readiness-test-1'), null);
});

test('checkPitchDeckReadiness generates and caches the deck once the simulation completes', async () => {
  const validationId = 'deck-readiness-test-2';
  server.saveWebSession({
    validation_id: validationId,
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: 'sim_completed_test'
  });
  const session = server.getWebSession(validationId);
  let generateCalls = 0;

  // A completed simulation with real result data (key findings), so the
  // readiness check's hasSimulationResultData gate passes.
  const completedInsights = {
    status: 'completed',
    respondent_count: 369,
    desired_respondent_count: 357,
    insights: { key_findings: [{ finding: 'Strong product-market fit.', confidence: 'high', evidence_question_ids: ['q09'] }] }
  };
  const deckWithResults = () => ({
    ...server.buildPitchDeckFallback(session),
    simulation_key_findings: [{ text: 'Strong product-market fit.', confidence: 'high', evidence: ['Q09'], followUpLabel: '' }]
  });

  const status = await server.checkPitchDeckReadiness(session, {
    fetchInsights: async () => completedInsights,
    buildDeck: async () => { generateCalls += 1; return deckWithResults(); }
  });

  assert.equal(status.deck_ready, true);
  assert.equal(status.simulation_status, 'completed');
  assert.equal(generateCalls, 1);

  const saved = server.getWebSession(validationId);
  assert.equal(saved.pitch_deck_ready, true);
  assert.ok(saved.pitch_deck_content);

  // A second check should reuse the cached deck instead of regenerating.
  const secondStatus = await server.checkPitchDeckReadiness(saved, {
    fetchInsights: async () => { throw new Error('should not re-fetch once cached'); },
    buildDeck: async () => { generateCalls += 1; return deckWithResults(); }
  });
  assert.equal(secondStatus.deck_ready, true);
  assert.equal(generateCalls, 1);
});

test('checkPitchDeckReadiness treats a failed or missing simulation as terminal so the deck still generates', async () => {
  const session = {
    validation_id: 'deck-readiness-test-3',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics')
    // no simulation_id: survey/simulation provisioning never launched one
  };

  const status = await server.checkPitchDeckReadiness(session, {
    fetchInsights: async () => { throw new Error('should not be called without a simulation_id'); },
    buildDeck: async () => server.buildPitchDeckFallback(session)
  });

  assert.equal(status.deck_ready, true);
  assert.equal(status.simulation_status, 'not_available');
});

test('checkPitchDeckReadiness falls back to a local deck (not stuck loading) when the simulation cannot run for lack of PRU credits', async () => {
  // Provisioning without enough PRU balance leaves the session with no
  // simulation_id and simulation_status "insufficient_balance"; the deck must
  // still generate immediately instead of spinning forever.
  const validationId = 'deck-readiness-no-pru';
  server.saveWebSession({
    validation_id: validationId,
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: '',
    simulation_status: 'insufficient_balance'
  });
  const session = server.getWebSession(validationId);
  let generateCalls = 0;

  const status = await server.checkPitchDeckReadiness(session, {
    fetchInsights: async () => { throw new Error('no simulation to fetch'); },
    buildDeck: async () => { generateCalls += 1; return server.buildPitchDeckFallback(session); }
  });

  assert.equal(status.deck_ready, true);
  assert.equal(generateCalls, 1);
  assert.equal(server.getWebSession(validationId).pitch_deck_ready, true);

  // And it is cached, so a later poll/reload does not regenerate.
  const second = await server.checkPitchDeckReadiness(server.getWebSession(validationId), {
    fetchInsights: async () => { throw new Error('no simulation to fetch'); },
    buildDeck: async () => { generateCalls += 1; return server.buildPitchDeckFallback(session); }
  });
  assert.equal(second.deck_ready, true);
  assert.equal(generateCalls, 1);
});

test('checkPitchDeckReadiness falls back to a local deck when a launched simulation ends in a failed state', async () => {
  const session = {
    validation_id: 'deck-readiness-failed-sim',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: 'sim_that_failed',
    simulation_status: 'launched'
  };
  let generateCalls = 0;

  const status = await server.checkPitchDeckReadiness(session, {
    fetchInsights: async () => ({ status: 'failed', respondent_count: 0, desired_respondent_count: 357 }),
    buildDeck: async () => { generateCalls += 1; return server.buildPitchDeckFallback(session); }
  });

  assert.equal(status.deck_ready, true);
  assert.equal(status.simulation_status, 'failed');
  assert.equal(generateCalls, 1);
});

test('checkPitchDeckReadiness keeps waiting (does not generate) when the live status fetch fails transiently', async () => {
  const session = {
    validation_id: 'deck-readiness-test-4',
    pitch: 'AI scheduling concierge for small clinics',
    preview: server.buildPreviewReport('AI scheduling concierge for small clinics'),
    simulation_id: 'sim_flaky_test'
  };

  const status = await server.checkPitchDeckReadiness(session, {
    fetchInsights: async () => { throw new Error('temporary network error'); },
    buildDeck: async () => { throw new Error('should not generate on a transient fetch failure'); }
  });

  assert.equal(status.deck_ready, false);
});

// ---------------------------------------------------------------------------
// OKX Wallet (X Layer) crypto payment verification
// ---------------------------------------------------------------------------

const USDT_CONTRACT = '0x1e4a5963abfd975d8c9021ce480b42188849d41d';
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const PAYER = '0x2222222222222222222222222222222222222222';

function addrTopic(addr) {
  return `0x${addr.replace(/^0x/, '').toLowerCase().padStart(64, '0')}`;
}
function amountData(baseUnits) {
  return `0x${BigInt(baseUnits).toString(16).padStart(64, '0')}`;
}
function transferLog({ contract = USDT_CONTRACT, from = PAYER, to = CRYPTO_RECIPIENT, value }) {
  return { address: contract, topics: [TRANSFER_TOPIC, addrTopic(from), addrTopic(to)], data: amountData(value) };
}
function mockRpc({ receipt, head = '0x1000' }) {
  return async (method) => {
    if (method === 'eth_getTransactionReceipt') return receipt;
    if (method === 'eth_blockNumber') return head;
    throw new Error(`unexpected rpc call: ${method}`);
  };
}
const GOOD_TX = `0x${'a'.repeat(64)}`;

test('cryptoConfigForClient exposes enabled config with correct USDT base-unit amounts (never secrets)', () => {
  const cfg = server.cryptoConfigForClient();
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.chain_id, 196);
  assert.equal(cfg.chain_id_hex, '0xc4');
  assert.equal(cfg.receiving_address, CRYPTO_RECIPIENT);
  assert.equal(cfg.token_decimals, 6);
  // $9.99 at 6 decimals = 9,990,000 base units.
  assert.equal(cfg.unlock.amount_base_units, '9990000');
  assert.equal(cfg.unlock.amount_display, '9.99 USDT');
  assert.equal(cfg.pitch_deck.amount_base_units, '9990000');
});

test('usdtBaseUnits converts cents to 6-decimal base units without float drift', () => {
  assert.equal(server.usdtBaseUnits(999), '9990000');
  assert.equal(server.usdtBaseUnits(500), '5000000');
  assert.equal(server.usdtBaseUnits(1), '10000');
});

test('verifyUsdtPayment confirms a matching USDT transfer to the receiving address', async () => {
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ value: '9990000' })] };
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.from, PAYER);
  assert.equal(result.value, '9990000');
});

test('verifyUsdtPayment accepts an overpayment (value greater than required)', async () => {
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ value: '20000000' })] };
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'confirmed');
});

test('verifyUsdtPayment returns pending when the transaction is not mined yet', async () => {
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt: null }) });
  assert.equal(result.status, 'pending');
});

test('verifyUsdtPayment fails a reverted transaction', async () => {
  const receipt = { status: '0x0', blockNumber: '0xff0', logs: [] };
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'failed');
  assert.match(result.reason, /failed on-chain/);
});

test('verifyUsdtPayment fails when the transfer went to a different recipient', async () => {
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ to: '0x9999999999999999999999999999999999999999', value: '9990000' })] };
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'failed');
});

test('verifyUsdtPayment fails when the transfer was a different token contract', async () => {
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ contract: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', value: '9990000' })] };
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'failed');
});

test('verifyUsdtPayment fails when the amount is below the required price', async () => {
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ value: '9989999' })] };
  const result = await server.verifyUsdtPayment(GOOD_TX, '9990000', { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'failed');
});

test('verifyUsdtPayment fails a malformed transaction hash without calling the RPC', async () => {
  const result = await server.verifyUsdtPayment('not-a-hash', '9990000', { rpc: async () => { throw new Error('should not be called'); } });
  assert.equal(result.status, 'failed');
});

test('verifySignaturePayment (test mode) confirms a gasless wallet signature over the canonical message', async () => {
  const wallet = Wallet.createRandom();
  const message = server.cryptoSignatureMessage('val-123', 'pitch_deck');
  const signature = await wallet.signMessage(message);
  const result = server.verifySignaturePayment('val-123', 'pitch_deck', { signature, address: wallet.address });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.from, wallet.address.toLowerCase());
});

test('verifySignaturePayment fails when the claimed address does not match the signer', async () => {
  const wallet = Wallet.createRandom();
  const signature = await wallet.signMessage(server.cryptoSignatureMessage('val-123', 'unlock'));
  const result = server.verifySignaturePayment('val-123', 'unlock', { signature, address: '0x0000000000000000000000000000000000000001' });
  assert.equal(result.status, 'failed');
});

test('verifySignaturePayment rejects a signature made for a different validation (no cross-use)', async () => {
  const wallet = Wallet.createRandom();
  // Signed for validation A, but presented for validation B → recovered signer differs.
  const signature = await wallet.signMessage(server.cryptoSignatureMessage('val-A', 'unlock'));
  const result = server.verifySignaturePayment('val-B', 'unlock', { signature, address: wallet.address });
  assert.equal(result.status, 'failed');
});

test('verifySignaturePayment fails when the signature or address is missing', () => {
  assert.equal(server.verifySignaturePayment('v', 'unlock', {}).status, 'failed');
  assert.equal(server.verifySignaturePayment('v', 'unlock', { signature: '0xabc' }).status, 'failed');
});

test('verifyCryptoUnlock marks a session paid after a confirmed on-chain payment', async () => {
  const validationId = 'crypto-unlock-test-1';
  server.saveWebSession({ validation_id: validationId, pitch: 'AI concierge for clinics', preview: server.buildPreviewReport('AI concierge for clinics') });
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ value: '9990000' })] };

  const result = await server.verifyCryptoUnlock(validationId, GOOD_TX, { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'confirmed');
  const saved = server.getWebSession(validationId);
  assert.equal(saved.paid, true);
  assert.equal(saved.payment_method, 'okx_crypto');
  assert.equal(saved.crypto_tx_hash, GOOD_TX);
});

test('verifyCryptoUnlock rejects replaying the same tx hash for a different validation', async () => {
  const otherValidation = 'crypto-unlock-test-2';
  server.saveWebSession({ validation_id: otherValidation, pitch: 'Another idea', preview: server.buildPreviewReport('Another idea') });
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ value: '9990000' })] };

  await assert.rejects(
    () => server.verifyCryptoUnlock(otherValidation, GOOD_TX, { rpc: mockRpc({ receipt }) }),
    /already been used/
  );
  assert.notEqual(server.getWebSession(otherValidation).paid, true);
});

test('verifyCryptoUnlock returns pending (does not mark paid) while the tx is unconfirmed', async () => {
  const validationId = 'crypto-unlock-pending';
  server.saveWebSession({ validation_id: validationId, pitch: 'Pending idea', preview: server.buildPreviewReport('Pending idea') });
  const result = await server.verifyCryptoUnlock(validationId, `0x${'b'.repeat(64)}`, { rpc: mockRpc({ receipt: null }) });
  assert.equal(result.status, 'pending');
  assert.notEqual(server.getWebSession(validationId).paid, true);
});

test('verifyPitchDeckCryptoPaid marks the pitch deck paid after a confirmed payment', async () => {
  const validationId = 'crypto-deck-test-1';
  server.saveWebSession({ validation_id: validationId, pitch: 'Deck idea', preview: server.buildPreviewReport('Deck idea'), paid: true });
  const receipt = { status: '0x1', blockNumber: '0xff0', logs: [transferLog({ value: '9990000' })] };

  const result = await server.verifyPitchDeckCryptoPaid(validationId, `0x${'c'.repeat(64)}`, { rpc: mockRpc({ receipt }) });
  assert.equal(result.status, 'confirmed');
  const saved = server.getWebSession(validationId);
  assert.equal(saved.pitch_deck_paid, true);
  assert.equal(saved.pitch_deck_payment_method, 'okx_crypto');
});

test('verifyCryptoUnlock is idempotent for an already-paid session without touching the RPC (the /success crypto_tx recovery path)', async () => {
  const validationId = 'crypto-unlock-idempotent';
  server.saveWebSession({ validation_id: validationId, pitch: 'Paid idea', preview: server.buildPreviewReport('Paid idea'), paid: true });
  const result = await server.verifyCryptoUnlock(validationId, `0x${'d'.repeat(64)}`, {
    rpc: async () => { throw new Error('RPC must not be called for an already-paid session'); }
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.session.paid, true);
});

test('verifyPitchDeckCryptoPaid is idempotent for an already-deck-paid session without touching the RPC', async () => {
  const validationId = 'crypto-deck-idempotent';
  server.saveWebSession({ validation_id: validationId, pitch: 'Deck idea', preview: server.buildPreviewReport('Deck idea'), paid: true, pitch_deck_paid: true });
  const result = await server.verifyPitchDeckCryptoPaid(validationId, `0x${'e'.repeat(64)}`, {
    rpc: async () => { throw new Error('RPC must not be called for an already-deck-paid session'); }
  });
  assert.equal(result.status, 'confirmed');
  assert.equal(result.session.pitch_deck_paid, true);
});

