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

// Connects the wallet, ensures the right chain, and sends a USDT ERC-20
// transfer of amountBaseUnits to the configured receiving address. Returns the
// transaction hash. The actual on-chain confirmation + amount/recipient checks
// happen server-side in the verify endpoint — never trust this hash alone.
export async function payUsdt(cfg, amountBaseUnits) {
  const provider = getOkxProvider();
  if (!provider) {
    throw new Error('OKX Wallet was not detected. Install the OKX Wallet browser extension from okx.com, then reload this page.');
  }
  const accounts = await provider.request({ method: 'eth_requestAccounts' });
  const from = accounts && accounts[0];
  if (!from) throw new Error('No account was authorized in OKX Wallet.');

  await ensureChain(provider, cfg);

  // transfer(address,uint256): selector + padded recipient + padded amount.
  const recipient = pad64(String(cfg.receiving_address).replace(/^0x/, ''));
  const amountHex = pad64(BigInt(amountBaseUnits).toString(16));
  const data = `0xa9059cbb${recipient}${amountHex}`;

  return provider.request({
    method: 'eth_sendTransaction',
    params: [{ from, to: cfg.token_contract, data, value: '0x0' }]
  });
}

// Polls the server verify endpoint until the payment is confirmed on-chain
// (200) or definitively rejected (non-2xx). 202 means "still confirming".
export async function pollVerify(verifyUrl, txHash, { onPending } = {}) {
  const deadlineMs = Date.now() + 180000; // ~3 minutes
  let attempt = 0;
  while (Date.now() < deadlineMs) {
    const res = await fetch(verifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_hash: txHash })
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
  throw new Error('Timed out waiting for the transaction to confirm. If the payment went through, reload this page in a minute.');
}

// End-to-end helper: pay, then poll verification. Calls status callbacks so the
// caller can drive its own UI (button label, notes, toasts).
export async function payAndVerify({ cfg, amountBaseUnits, verifyUrl, onStatus }) {
  const say = (msg) => { if (onStatus) onStatus(msg); };
  say('Requesting payment in OKX Wallet…');
  const txHash = await payUsdt(cfg, amountBaseUnits);
  say('Transaction submitted. Confirming on-chain…');
  const result = await pollVerify(verifyUrl, txHash, { onPending: () => say('Waiting for on-chain confirmation…') });
  return { txHash, result };
}
