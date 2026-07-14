const form = document.querySelector('#validate-form');
const submitButton = document.querySelector('#submit-button');
const statusCard = document.querySelector('#status-card');
const statusTitle = document.querySelector('#status-title');
const statusText = document.querySelector('#status-text');
const statusTimerEl = document.querySelector('#status-timer');
const progressFill = document.querySelector('#progress-fill');
const progressStepsEl = document.querySelector('#progress-steps');
const result = document.querySelector('#result');
const retryButton = document.querySelector('#retry-provisioning');
const pitchInput = document.querySelector('#pitch');
const charCount = document.querySelector('#char-count');
const toastStack = document.querySelector('#toast-stack');
let currentValidationId = '';

const stages = [
  { title: 'Generating ASP positioning…', detail: 'Preparing pitch-specific market intelligence and service packaging notes.' },
  { title: 'Building custom Preferences AI survey…', detail: 'Preparing pitch-specific market intelligence and service packaging notes.' },
  { title: 'Saving dashboard survey asset…', detail: 'The server is contacting Preferences AI and Stripe. This can take a minute.' },
  { title: 'Estimating digital population cost…', detail: 'The server is contacting Preferences AI and Stripe. This can take a minute.' },
  { title: 'Packaging Stripe unlock for the ASP demo…', detail: 'The server is contacting Preferences AI and Stripe. This can take a minute.' }
];
let stageTimer;
let elapsedTimer;
let elapsedSeconds = 0;

/* ---------- Background parallax ---------- */
const blobs = document.querySelectorAll('.blob');
if (blobs.length) {
  window.addEventListener('pointermove', (event) => {
    const px = (event.clientX / window.innerWidth - 0.5) * 2;
    const py = (event.clientY / window.innerHeight - 0.5) * 2;
    blobs.forEach((blob, index) => {
      const strength = (index + 1) * 8;
      blob.style.transform = `translate(${px * strength}px, ${py * strength}px)`;
    });
  });
}

/* ---------- Textarea character count + example chips ---------- */
function updateCharCount() {
  const len = pitchInput.value.length;
  charCount.textContent = `${len} / 1000`;
  charCount.classList.toggle('near-limit', len > 900);
}
pitchInput.addEventListener('input', updateCharCount);
updateCharCount();

document.querySelectorAll('#example-chips .chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    pitchInput.value = chip.dataset.pitch || '';
    updateCharCount();
    pitchInput.focus();
  });
});

/* ---------- Busy-state buttons (label/spinner as persistent nodes so ripple isn't wiped) ---------- */
function setupButtonState(button, idleLabel) {
  const spinner = document.createElement('span');
  spinner.className = 'btn-spinner hidden';
  const label = document.createElement('span');
  label.className = 'btn-label';
  label.textContent = idleLabel;
  button.textContent = '';
  button.appendChild(spinner);
  button.appendChild(label);
  return { spinner, label, idleLabel };
}

function setButtonBusy(state, busy, busyLabel) {
  state.spinner.classList.toggle('hidden', !busy);
  state.label.textContent = busy ? busyLabel : state.idleLabel;
}

const submitState = setupButtonState(submitButton, 'Generate ASP validation preview');
const retryState = setupButtonState(retryButton, 'Retry live provisioning');

/* ---------- Button ripple ---------- */
function attachRipple(button) {
  button.addEventListener('click', (event) => {
    if (button.disabled) return;
    const rect = button.getBoundingClientRect();
    const ripple = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ripple.className = 'ripple';
    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    button.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
}
attachRipple(submitButton);
attachRipple(retryButton);

/* ---------- Toasts ---------- */
function showToast(kind, title, message) {
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.innerHTML = `<div><strong>${title}</strong><p></p></div><button type="button" class="toast-close" aria-label="Dismiss">✕</button>`;
  toast.querySelector('p').textContent = message || '';
  toastStack.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 7000);
}

/* ---------- Progress timeline ---------- */
function renderSteps() {
  progressStepsEl.replaceChildren();
  stages.forEach((stage) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="step-dot"></span><span></span>`;
    li.querySelector('span:last-child').textContent = stage.title;
    progressStepsEl.appendChild(li);
  });
}

function setStep(index) {
  const items = progressStepsEl.children;
  for (let i = 0; i < items.length; i++) {
    items[i].classList.toggle('done', i < index);
    items[i].classList.toggle('active', i === index);
  }
  progressFill.style.width = `${((index + 1) / stages.length) * 100}%`;
}

function completeSteps() {
  const items = progressStepsEl.children;
  for (let i = 0; i < items.length; i++) items[i].classList.add('done');
  progressFill.style.width = '100%';
}

function formatElapsed(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function setBusy(isBusy) {
  submitButton.disabled = isBusy;
  setButtonBusy(submitState, isBusy, 'Generating…');
  if (isBusy) {
    statusCard.classList.remove('hidden');
  }
}

function startStages() {
  renderSteps();
  let index = 0;
  setStep(index);
  statusTitle.textContent = stages[index].title;
  statusText.textContent = 'Your ASP preview will appear once survey and checkout assets are ready.';

  elapsedSeconds = 0;
  statusTimerEl.textContent = formatElapsed(elapsedSeconds);
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    elapsedSeconds += 1;
    statusTimerEl.textContent = formatElapsed(elapsedSeconds);
  }, 1000);

  clearInterval(stageTimer);
  stageTimer = setInterval(() => {
    index = Math.min(index + 1, stages.length - 1);
    setStep(index);
    statusTitle.textContent = stages[index].title;
    statusText.textContent = stages[index].detail;
  }, 15000);
}

function stopStages() {
  clearInterval(stageTimer);
  clearInterval(elapsedTimer);
  stageTimer = undefined;
  elapsedTimer = undefined;
}

function text(id, value) {
  document.querySelector(id).textContent = value || '—';
}

/* ---------- Animated count-up for affinity percentages ---------- */
function animateAffinity(valueId, fillId, rawValue) {
  const match = String(rawValue || '').match(/[\d.]+/);
  const target = match ? Math.max(0, Math.min(100, parseFloat(match[0]))) : null;
  const valueEl = document.querySelector(valueId);
  const fillEl = document.querySelector(fillId);

  if (target === null) {
    valueEl.textContent = rawValue || '—';
    fillEl.style.width = '0%';
    return;
  }

  const duration = 900;
  const start = Date.now();
  const suffix = String(rawValue).trim().endsWith('%') ? '%' : '';
  fillEl.style.width = `${target}%`;

  const timer = setInterval(() => {
    const progress = Math.min(1, (Date.now() - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = (target * eased).toFixed(1).replace(/\.0$/, '');
    valueEl.textContent = `${current}${suffix}`;
    if (progress >= 1) {
      valueEl.textContent = `${target}${suffix}`;
      clearInterval(timer);
    }
  }, 30);
}

/* ---------- Confetti ---------- */
function launchConfetti() {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  document.body.appendChild(layer);
  const colors = ['#8f7cff', '#36e7c4', '#ffd166', '#58f29b', '#b8ff6a'];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement('span');
    piece.className = 'confetti-piece';
    const size = 6 + Math.random() * 6;
    piece.style.width = `${size}px`;
    piece.style.height = `${size * 0.4}px`;
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[i % colors.length];
    piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
    piece.style.animationDelay = `${Math.random() * 0.4}s`;
    layer.appendChild(piece);
  }
  setTimeout(() => layer.remove(), 4200);
}

/* ---------- Copy validation id ---------- */
const copyButton = document.querySelector('#copy-validation-id');
copyButton.addEventListener('click', async () => {
  if (!currentValidationId) return;
  try {
    await navigator.clipboard.writeText(currentValidationId);
    copyButton.textContent = 'Copied!';
    copyButton.classList.add('copied');
    setTimeout(() => {
      copyButton.textContent = 'Copy';
      copyButton.classList.remove('copied');
    }, 1600);
  } catch (error) {
    showToast('error', 'Copy failed', 'Your browser blocked clipboard access.');
  }
});

function render(data) {
  currentValidationId = data.validation_id || '';
  const preview = data.preview || {};
  result.classList.remove('hidden');
  text('#result-pitch', data.pitch);
  text('#result-category', `Category: ${preview.pitch_category || data.pitch_category || 'general_consumer'}`);
  text('#demo-a', preview.demographic_a);
  text('#demo-b', preview.demographic_b);
  animateAffinity('#affinity-a', '#affinity-a-fill', preview.affinity_a);
  animateAffinity('#affinity-b', '#affinity-b-fill', preview.affinity_b);
  text('#validation-id-text', data.validation_id);
  text('#survey-id', data.survey_id || 'Created after live API provisioning');
  text('#simulation-id', data.simulation_id || data.simulation_status || 'Pending / not launched');

  const estimate = data.estimate;
  text('#estimate', estimate ? `${estimate.respondents || '—'} respondents / ${estimate.pru_cost || '—'} PRU` : 'Not available');

  const summaryList = document.querySelector('#summary-list');
  summaryList.replaceChildren();
  (preview.summary_matrix || []).forEach((item, index) => {
    const li = document.createElement('li');
    li.textContent = item;
    li.style.animationDelay = `${index * 90}ms`;
    summaryList.appendChild(li);
  });

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

  if (data.preview_source === 'hermes_agent' || preview.preview_source === 'hermes_agent') {
    assetCopy.textContent = `${assetCopy.textContent} Free preview source: Hermes Agent.`.trim();
  } else if (data.preview_error || preview.preview_error) {
    const detail = String(data.preview_error || preview.preview_error).slice(0, 220);
    assetCopy.textContent = `Free preview used local fallback because Hermes Agent did not return a usable JSON preview: ${detail}${detail.length >= 220 ? '…' : ''}`;
  }

  retryButton.classList.toggle('hidden', data.live_status !== 'failed' || !currentValidationId);
  retryButton.disabled = false;
  setButtonBusy(retryState, false);

  const checkoutLink = document.querySelector('#checkout-link');
  const checkoutNote = document.querySelector('#checkout-note');
  if (data.checkout_url) {
    checkoutLink.href = data.checkout_url;
    checkoutLink.classList.remove('disabled');
    checkoutLink.classList.add('cta-pulse');
    checkoutLink.textContent = 'Pay $9.99 to unlock ASP report';
    checkoutNote.textContent = 'Stripe returns you to this Preferences ASP Concierge with the unlocked dashboard links after payment.';
  } else {
    checkoutLink.href = '#';
    checkoutLink.classList.add('disabled');
    checkoutLink.classList.remove('cta-pulse');
    checkoutLink.textContent = 'Checkout unavailable';
    checkoutNote.textContent = data.checkout_error || 'Set STRIPE_SECRET_KEY to enable paid unlock links.';
  }

  if (data.live_status === 'created') {
    launchConfetti();
    showToast('success', 'ASP assets ready', 'Preferences AI survey and simulation resources were provisioned successfully.');
  } else if (data.live_status === 'failed') {
    showToast('error', 'Live provisioning needs attention', data.live_error ? data.live_error.slice(0, 160) : 'The free preview still works; retry once the API is healthy.');
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
    completeSteps();
    render(data);
    statusCard.classList.add('hidden');
  } catch (error) {
    statusCard.classList.remove('hidden');
    statusTitle.textContent = 'Validation failed';
    statusText.textContent = error.message;
    showToast('error', 'Validation failed', error.message);
  } finally {
    stopStages();
    setBusy(false);
  }
});

retryButton.addEventListener('click', async () => {
  if (!currentValidationId) return;
  retryButton.disabled = true;
  setButtonBusy(retryState, true, 'Retrying…');
  statusCard.classList.remove('hidden');
  renderSteps();
  setStep(2);
  statusTitle.textContent = 'Retrying live Preferences AI ASP provisioning…';
  statusText.textContent = 'Reusing your saved ASP preview and validation ID. This can take 1-3 minutes.';
  elapsedSeconds = 0;
  statusTimerEl.textContent = formatElapsed(elapsedSeconds);
  clearInterval(elapsedTimer);
  elapsedTimer = setInterval(() => {
    elapsedSeconds += 1;
    statusTimerEl.textContent = formatElapsed(elapsedSeconds);
  }, 1000);

  try {
    const response = await fetch(`/api/session/${encodeURIComponent(currentValidationId)}/retry`, { method: 'POST' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || `Retry failed with HTTP ${response.status}`);
    completeSteps();
    render(data);
    statusCard.classList.add('hidden');
  } catch (error) {
    statusCard.classList.remove('hidden');
    statusTitle.textContent = 'Retry failed';
    statusText.textContent = error.message;
    showToast('error', 'Retry failed', error.message);
    retryButton.disabled = false;
    setButtonBusy(retryState, false);
  } finally {
    clearInterval(elapsedTimer);
  }
});
