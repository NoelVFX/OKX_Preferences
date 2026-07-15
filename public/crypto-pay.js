// Vanilla OKX Wallet (EIP-1193) payment helper — no dependencies, no build step.
// The OKX Wallet browser extension injects window.okxwallet, a standard
// EIP-1193 provider, so we talk to it directly instead of pulling in
// RainbowKit/Wagmi (which would require a React/Next.js rewrite).

let cachedConfig = null;

export async function getCryptoConfig() {
  if (cachedConfig) return cachedConfig;
  const res = await fetch('/api/crypto/config');
  cachedConfig = await res.json();
  return cachedConfig;
}

export function getOkxProvider() {
  return (typeof window !== 'undefined' && window.okxwallet) || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad64(hexNo0x) {
  return hexNo0x.toLowerCase().padStart(64, '0');
}

// Must stay byte-identical to cryptoSignatureMessage() in server.js.
function signatureMessage(validationId, purpose) {
  const label = purpose === 'pitch_deck' ? 'Investor pitch deck' : 'Dashboard unlock';
  return `Preferences ASP Concierge payment authorization\nProduct: ${label}\nValidation: ${validationId}`;
}

async function ensureChain(provider, cfg) {
  const current = await provider.request({ method: 'eth_chainId' });
  if (String(current).toLowerCase() === String(cfg.chain_id_hex).toLowerCase()) return;
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chain_id_hex }] });
  } catch (error) {
    // 4902 = chain not added to the wallet yet; add it, then switch.
    if (error && (error.code === 4902 || error.code === -32603)) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: cfg.chain_id_hex,
          chainName: cfg.chain_name,
          nativeCurrency: { name: cfg.native_currency, symbol: cfg.native_currency, decimals: 18 },
          rpcUrls: [cfg.rpc_url],
          blockExplorerUrls: cfg.block_explorer_url ? [cfg.block_explorer_url] : []
        }]
      });
      await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: cfg.chain_id_hex }] });
    } else {
      throw error;
    }
  }
}

// Connects the wallet and produces payment proof for the server to verify.
// - test mode (payment_kind 'signature'): a gasless personal_sign — no
//   transaction, no gas, no tokens. Returns { body: { signature, address } }.
// - otherwise: a USDT ERC-20 transfer of amountBaseUnits, returning
//   { txHash, body: { tx_hash } }.
// The real amount/recipient/signer checks always happen server-side.
async function collectPayment({ cfg, amountBaseUnits, validationId, purpose, onStatus }) {
  const say = (msg) => { if (onStatus) onStatus(msg); };
  const provider = getOkxProvider();
  if (!provider) {
    throw new Error('OKX Wallet was not detected. Install the OKX Wallet browser extension from okx.com, then reload this page.');
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const from = accounts && accounts[0];
  if (!from) throw new Error('No account was authorized in OKX Wallet.');

  if (cfg.payment_kind === 'signature') {
    say('Confirm the payment in OKX Wallet…');
    const message = signatureMessage(validationId, purpose);
    const signature = await provider.request({ method: 'personal_sign', params: [message, from] });
    return { txHash: '', body: { signature, address: from } };
  }

  await ensureChain(provider, cfg);
  say('Confirm the payment in OKX Wallet…');
  // transfer(address,uint256): selector + padded recipient + padded amount.
  const recipient = pad64(String(cfg.receiving_address).replace(/^0x/, ''));
  const amountHex = pad64(BigInt(amountBaseUnits).toString(16));
  const data = `0xa9059cbb${recipient}${amountHex}`;
  const txHash = await provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: cfg.token_contract, data, value: '0x0' }]
  });
  return { txHash, body: { tx_hash: txHash } };
}

// Posts the proof to the server verify endpoint until it is accepted (200) or
// rejected (non-2xx). 202 means "still confirming" (on-chain mode only).
export async function pollVerify(verifyUrl, body, { onPending } = {}) {
  const deadlineMs = Date.now() + 180000; // ~3 minutes
  let attempt = 0;
  while (Date.now() < deadlineMs) {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.status === 202) {
      attempt += 1;
      if (onPending) onPending(attempt);
      await sleep(4000);
      continue;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Verification failed (HTTP ${res.status}).`);
    return data;
  }
  throw new Error('Timed out waiting for confirmation. If it went through, reload this page in a minute.');
}

// End-to-end helper: collect the wallet proof, then verify it server-side.
// Calls onStatus so the caller can drive its own UI (button label, notes).
export async function payAndVerify({ cfg, amountBaseUnits, verifyUrl, validationId, purpose, onStatus }) {
  const say = (msg) => { if (onStatus) onStatus(msg); };
  const { txHash, body } = await collectPayment({ cfg, amountBaseUnits, validationId, purpose, onStatus });
  say('Verifying…');
  const result = await pollVerify(verifyUrl, body, { onPending: () => say('Waiting for confirmation…') });
  return { txHash, result };
}
