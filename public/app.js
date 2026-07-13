const form = document.querySelector('#validate-form');
const submitButton = document.querySelector('#submit-button');
const statusCard = document.querySelector('#status-card');
const statusTitle = document.querySelector('#status-title');
const statusText = document.querySelector('#status-text');
const result = document.querySelector('#result');
const retryButton = document.querySelector('#retry-provisioning');
let currentValidationId = '';

const stages = [
  'Generating ASP positioning…',
  'Building custom Preferences AI survey…',
  'Saving dashboard survey asset…',
  'Estimating digital population cost…',
  'Packaging Stripe unlock for the ASP demo…'
];
let stageTimer;

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  submitButton.textContent = isBusy ? 'Generating…' : 'Generate ASP validation preview';
  if (isBusy) {
    statusCard.classList.remove('hidden');
  }
}

function startStages() {
  let index = 0;
  statusTitle.textContent = stages[index];
  statusText.textContent = 'Your ASP preview will appear once survey and checkout assets are ready.';
  clearInterval(stageTimer);
  stageTimer = setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    statusTitle.textContent = stages[index];
    statusText.textContent = index >= 3
      ? 'The server is contacting Preferences AI and Stripe. This can take a minute.'
      : 'Preparing pitch-specific market intelligence and service packaging notes.';
  }, 15000);
}

function stopStages() {
  clearInterval(stageTimer);
  stageTimer = undefined;
}

function text(id, value) {
  document.querySelector(id).textContent = value || '—';
}

function render(data) {
  currentValidationId = data.validation_id || '';
  const preview = data.preview || {};
  result.classList.remove('hidden');
  text('#result-pitch', data.pitch);
  text('#result-category', `Category: ${preview.pitch_category || data.pitch_category || 'general_consumer'}`);
  text('#demo-a', preview.demographic_a);
  text('#demo-b', preview.demographic_b);
  text('#affinity-a', preview.affinity_a);
  text('#affinity-b', preview.affinity_b);
  text('#validation-id', data.validation_id);
  text('#survey-id', data.survey_id || 'Created after live API provisioning');
  text('#simulation-id', data.simulation_id || data.simulation_status || 'Pending / not launched');

  const estimate = data.estimate;
  text('#estimate', estimate ? `${estimate.respondents || '—'} respondents / ${estimate.pru_cost || '—'} PRU` : 'Not available');

  const summaryList = document.querySelector('#summary-list');
  summaryList.replaceChildren();
  for (const item of preview.summary_matrix || []) {
    const li = document.createElement('li');
    li.textContent = item;
    summaryList.appendChild(li);
  }

  const assetHeading = document.querySelector('#asset-heading');
  const assetCopy = document.querySelector('#asset-copy');
  if (data.live_status === 'created') {
    assetHeading.textContent = 'Dashboard assets are ready';
    assetCopy.textContent = data.simulation_message || 'The generated survey and simulation metadata are saved for paid ASP unlock.';
  } else if (data.live_status === 'skipped') {
    assetHeading.textContent = 'Preview generated locally';
    assetCopy.textContent = data.simulation_message || 'Set PREFERENCES_AI_API_KEY to provision live Preferences AI assets.';
  } else if (data.live_status === 'failed') {
    assetHeading.textContent = 'Preview ready, live provisioning needs attention';
    assetCopy.textContent = data.live_error
      ? `Preferences AI returned a transient error: ${data.live_error.slice(0, 180)}${data.live_error.length > 180 ? '…' : ''}`
      : 'The free preview still works. Retry once the Preferences AI API is healthy.';
  } else {
    assetHeading.textContent = 'Preview generated';
    assetCopy.textContent = data.simulation_message || '';
  }

  retryButton.classList.toggle('hidden', data.live_status !== 'failed' || !currentValidationId);
  retryButton.disabled = false;
  retryButton.textContent = 'Retry live provisioning';

  const checkoutLink = document.querySelector('#checkout-link');
  const checkoutNote = document.querySelector('#checkout-note');
  if (data.checkout_url) {
    checkoutLink.href = data.checkout_url;
    checkoutLink.classList.remove('disabled');
    checkoutLink.textContent = 'Pay $9.99 to unlock ASP report';
    checkoutNote.textContent = 'Stripe returns you to this Preferences ASP Concierge with the unlocked dashboard links after payment.';
  } else {
    checkoutLink.href = '#';
    checkoutLink.classList.add('disabled');
    checkoutLink.textContent = 'Checkout unavailable';
    checkoutNote.textContent = data.checkout_error || 'Set STRIPE_SECRET_KEY to enable paid unlock links.';
  }

  result.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const pitch = new FormData(form).get('pitch')?.toString().trim();
  if (!pitch) return;

  setBusy(true);
  startStages();
  result.classList.add('hidden');

  try {
    const response = await fetch('/api/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pitch })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}`);
    render(data);
    statusCard.classList.add('hidden');
  } catch (error) {
    statusCard.classList.remove('hidden');
    statusTitle.textContent = 'Validation failed';
    statusText.textContent = error.message;
  } finally {
    stopStages();
    setBusy(false);
  }
});

retryButton.addEventListener('click', async () => {
  if (!currentValidationId) return;
  retryButton.disabled = true;
  retryButton.textContent = 'Retrying…';
  statusCard.classList.remove('hidden');
  statusTitle.textContent = 'Retrying live Preferences AI ASP provisioning…';
  statusText.textContent = 'Reusing your saved ASP preview and validation ID. This can take 1-3 minutes.';

  try {
    const response = await fetch(`/api/session/${encodeURIComponent(currentValidationId)}/retry`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Retry failed with HTTP ${response.status}`);
    render(data);
    statusCard.classList.add('hidden');
  } catch (error) {
    statusCard.classList.remove('hidden');
    statusTitle.textContent = 'Retry failed';
    statusText.textContent = error.message;
    retryButton.disabled = false;
    retryButton.textContent = 'Retry live provisioning';
  }
});
