import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sessionStorePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'preferences-web-sessions-')), 'sessions.json');

process.env.WEB_DISABLE_SERVER_LISTEN = '1';
process.env.WEB_SESSION_STORE_PATH = sessionStorePath;
process.env.PREFERENCES_AI_API_KEY = 'test-preferences-key';
process.env.STRIPE_SECRET_KEY = '';
process.env.HERMES_PREVIEW_USE_CLI = '1';

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

