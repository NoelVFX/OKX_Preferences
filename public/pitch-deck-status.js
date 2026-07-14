import { getCryptoConfig, getOkxProvider, payAndVerify } from '/crypto-pay.js';

function showToast(kind, title, message) {
  const stack = document.querySelector('#toast-stack');
  if (!stack) return;
  const toast = document.createElement('div');
  toast.className = `toast ${kind}`;
  toast.innerHTML = '<div><strong></strong><p></p></div><button type="button" class="toast-close" aria-label="Dismiss">✕</button>';
  toast.querySelector('strong').textContent = title;
  toast.querySelector('p').textContent = message || '';
  stack.appendChild(toast);
  const dismiss = () => {
    toast.classList.add('leaving');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  toast.querySelector('.toast-close').addEventListener('click', dismiss);
  setTimeout(dismiss, 7000);
}

function launchConfetti() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
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

/* ---------- Retry survey/simulation provisioning when its link is still pending ---------- */
const surveyRefresh = document.querySelector('#survey-refresh');
if (surveyRefresh) {
  const validationId = document.querySelector('#survey-pending')?.dataset.validationId;
  surveyRefresh.addEventListener('click', async (event) => {
    event.preventDefault();
    if (!validationId) { window.location.reload(); return; }
    surveyRefresh.textContent = 'Refreshing…';
    try {
      await fetch(`/api/session/${encodeURIComponent(validationId)}/retry`, { method: 'POST' });
    } catch (error) {
      console.debug('Survey provisioning retry failed:', error);
    }
    window.location.reload();
  });
}

/* ---------- Poll simulation → deck readiness (in-progress state) ---------- */
const panel = document.querySelector('#pitch-deck-panel[data-status-url]');
if (panel) {
  const statusUrl = panel.dataset.statusUrl;
  const downloadUrl = panel.dataset.downloadUrl;
  const progressFill = document.querySelector('#deck-progress-fill');
  const statusText = document.querySelector('#deck-status-text');
  let pollTimer;

  function markReady() {
    clearInterval(pollTimer);
    panel.innerHTML = `
      <h3>Investor pitch deck</h3>
      <p>Hermes Agent generated a downloadable pitch deck (.pptx) from this concept's validation data.</p>
      <a class="button-link cta-pulse" id="deck-action" href="${downloadUrl}">Download pitch deck (.pptx)</a>
    `;
    launchConfetti();
    showToast('success', 'Pitch deck ready', 'Hermes Agent finished generating your investor pitch deck.');
  }

  async function poll() {
    try {
      const response = await fetch(statusUrl);
      const data = await response.json();
      if (!data.paid) {
        clearInterval(pollTimer);
        return;
      }
      if (data.desired_respondent_count) {
        const pct = Math.min(100, Math.round(((data.respondent_count || 0) / data.desired_respondent_count) * 100));
        if (progressFill) progressFill.style.width = `${pct}%`;
        if (statusText) statusText.textContent = `Simulation progress: ${data.respondent_count || 0} / ${data.desired_respondent_count} respondents.`;
      }
      if (data.deck_ready) markReady();
    } catch (error) {
      console.debug('Pitch deck status poll failed:', error);
    }
  }

  poll();
  pollTimer = setInterval(poll, 7000);
}

/* ---------- OKX Wallet crypto payment for the pitch deck (pay state) ---------- */
const deckCryptoBtn = document.querySelector('#deck-crypto-pay');
if (deckCryptoBtn) {
  const validationId = deckCryptoBtn.dataset.validationId;
  const label = document.querySelector('#deck-crypto-label');
  const note = document.querySelector('#deck-crypto-note');
  let busy = false;

  (async () => {
    try {
      const cfg = await getCryptoConfig();
      if (!cfg.enabled) { deckCryptoBtn.classList.add('hidden'); return; }
      if (note) note.textContent = getOkxProvider()
        ? `Sends ${cfg.pitch_deck.amount_display} on ${cfg.chain_name} to generate your pitch deck.`
        : 'Install the OKX Wallet browser extension to pay with crypto.';
    } catch (error) {
      console.debug('Crypto config unavailable:', error);
    }
  })();

  deckCryptoBtn.addEventListener('click', async () => {
    if (busy) return;
    if (!getOkxProvider()) {
      showToast('error', 'OKX Wallet not found', 'Install the OKX Wallet browser extension, then reload this page.');
      return;
    }
    busy = true;
    deckCryptoBtn.disabled = true;
    const restore = label ? label.textContent : '';
    try {
      const cfg = await getCryptoConfig();
      const { txHash, result } = await payAndVerify({
        cfg,
        amountBaseUnits: cfg.pitch_deck.amount_base_units,
        verifyUrl: `/api/session/${encodeURIComponent(validationId)}/pitch-deck/crypto/verify`,
        onStatus: (msg) => { if (note) note.textContent = msg; if (label) label.textContent = 'Processing…'; }
      });
      if (result.paid) {
        showToast('success', 'Payment confirmed', 'Your USDT payment was verified on-chain. Preparing your pitch deck…');
        // Carry the tx hash so /success can re-verify on-chain if this request
        // lands on a serverless instance that lost the just-saved session.
        window.location.href = `/success?validation_id=${encodeURIComponent(validationId)}&deck_crypto_tx=${encodeURIComponent(txHash)}`;
      }
    } catch (error) {
      const message = error?.code === 4001 ? 'Payment request was rejected in OKX Wallet.' : (error?.message || 'Crypto payment failed.');
      console.debug('Deck crypto payment error:', error);
      showToast('error', 'Crypto payment failed', message);
      if (note) note.textContent = message;
      if (label) label.textContent = restore;
    } finally {
      busy = false;
      deckCryptoBtn.disabled = false;
    }
  });
}
