import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const appJs = fs.readFileSync(path.join(process.cwd(), 'public', 'app.js'), 'utf8');

test('submit error status remains visible after loading controls reset', () => {
  assert.match(appJs, /function setBusy\(isBusy\) \{[\s\S]*?if \(isBusy\) \{[\s\S]*?statusCard\.classList\.remove\('hidden'\);[\s\S]*?\}/);
  assert.doesNotMatch(appJs, /statusCard\.classList\.toggle\('hidden', !isBusy\)/);
  assert.match(appJs, /catch \(error\) \{[\s\S]*?statusCard\.classList\.remove\('hidden'\);[\s\S]*?statusTitle\.textContent = 'Validation failed';[\s\S]*?\} finally \{/);
});

test('landing page is a standalone MVP without hackathon affiliation copy', () => {
  const html = fs.readFileSync(path.join(process.cwd(), 'public', 'index.html'), 'utf8');
  assert.match(html, /Preferences ASP Concierge/);
  assert.match(html, /Agent Service Provider/);
  // OKX Wallet is an intentional payment method; only hackathon campaign
  // branding must stay out.
  assert.match(html, /OKX Wallet/);
  assert.doesNotMatch(html, /#OKXAI/i);
  assert.doesNotMatch(html, /Hackathon/i);
  assert.doesNotMatch(html, /Build X/i);
  assert.doesNotMatch(html, /hackathon-panel/);
});

test('browser status copy is standalone and not campaign-branded', () => {
  assert.doesNotMatch(appJs, /#OKXAI/i);
  assert.doesNotMatch(appJs, /Hackathon/i);
  assert.doesNotMatch(appJs, /Build X/i);
  assert.match(appJs, /Generating ASP positioning/);
});

test('browser reports whether free preview used Hermes Agent or local fallback', () => {
  assert.match(appJs, /Free preview source: Hermes Agent/);
  assert.match(appJs, /function friendlyPreviewErrorMessage/);
  assert.match(appJs, /assetCopy\.textContent = `\$\{assetCopy\.textContent\} \$\{friendlyPreviewErrorMessage\(rawError\)\}`/);
});

test('raw upstream preview/provisioning errors are logged to console.debug, not shown to end users', () => {
  assert.doesNotMatch(appJs, /assetCopy\.textContent = `Free preview used local fallback because Hermes Agent[\s\S]*?\$\{detail\}/);
  assert.match(appJs, /console\.debug\('Hermes preview generation error \(local fallback used\):', rawError\)/);
  assert.match(appJs, /console\.debug\('Preferences AI provisioning error:', data\.live_error\)/);
});
