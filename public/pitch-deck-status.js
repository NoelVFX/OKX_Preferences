const panel = document.querySelector('#pitch-deck-panel[data-status-url]');
if (panel) {
  const statusUrl = panel.dataset.statusUrl;
  const downloadUrl = panel.dataset.downloadUrl;
  const progressFill = document.querySelector('#deck-progress-fill');
  const statusText = document.querySelector('#deck-status-text');
  let pollTimer;

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
