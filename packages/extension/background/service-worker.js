// Inline Shamir GF(256) implementation (can't import npm modules in service worker)
// Simplified version — split string into 2 shares

const EXP = new Uint8Array(256);
const LOG = new Uint8Array(256);
(function initGF() {
  let x = 1;
  for (let i = 0; i < 256; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = x ^ (x << 1);
    if (x >= 256) x ^= 0x11d;
  }
  LOG[0] = 0;
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return EXP[(LOG[a] + LOG[b]) % 255];
}

function splitByte(secret, n, k) {
  const coeffs = [secret];
  for (let i = 1; i < k; i++) {
    coeffs.push(Math.floor(Math.random() * 256)); // Use crypto.getRandomValues in production
  }
  // Actually use crypto
  const randomBytes = new Uint8Array(k - 1);
  crypto.getRandomValues(randomBytes);
  for (let i = 1; i < k; i++) coeffs[i] = randomBytes[i - 1];

  const shares = [];
  for (let i = 1; i <= n; i++) {
    let y = 0;
    for (let j = 0; j < k; j++) {
      let term = coeffs[j];
      for (let m = 0; m < j; m++) {
        term = gfMul(term, i);
      }
      y ^= term;
    }
    shares.push({ x: i, y });
  }
  return shares;
}

function splitString(secret, n, k) {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(secret);
  const shareArrays = Array.from({ length: n }, () => []);

  for (const byte of bytes) {
    const shares = splitByte(byte, n, k);
    for (let i = 0; i < n; i++) {
      shareArrays[i].push(shares[i]);
    }
  }

  return shareArrays.map((points, i) => ({
    x: i + 1,
    points,
  }));
}

function serializeShare(share) {
  const bytes = [share.x];
  for (const p of share.points) {
    bytes.push(p.y);
  }
  return btoa(String.fromCharCode(...bytes));
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'storeKey') {
    handleStoreKey(message.data).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === 'getApiKey') {
    chrome.storage.local.get(['vp_api_key'], (result) => {
      sendResponse({ apiKey: result.vp_api_key || null });
    });
    return true;
  }

  if (message.action === 'autoConnect') {
    handleAutoConnect(message.data).then(sendResponse);
    return true;
  }
});

async function handleAutoConnect({ token, user }) {
  // Already connected?
  const { vp_api_key } = await chrome.storage.local.get(['vp_api_key']);
  if (vp_api_key) return;

  try {
    // Try to list existing dev keys first
    const listRes = await fetch('https://api.vaultproof.dev/api/v1/dev-keys/list', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (listRes.ok) {
      const listData = await listRes.json();
      if (listData.keys && listData.keys.length > 0) {
        // Can't use masked keys — need to create a new one for the extension
      }
    }

    // Create a new dev key for the extension
    const createRes = await fetch('https://api.vaultproof.dev/api/v1/dev-keys/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ label: 'Chrome Extension', mode: 'live' })
    });

    if (!createRes.ok) return;

    const devKey = await createRes.json();
    if (devKey.key && devKey.key.startsWith('vp_')) {
      await chrome.storage.local.set({
        vp_api_key: devKey.key,
        vp_token: token,
        vp_signed_in: true
      });
    }
  } catch {}
}

async function handleStoreKey({ provider, apiKey, label, vpApiKey }) {
  try {
    // Shamir split locally
    const shares = splitString(apiKey, 2, 2);
    const share1 = serializeShare(shares[0]);
    const share2 = serializeShare(shares[1]);

    const res = await fetch('https://api.vaultproof.dev/api/v1/sdk/store', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': vpApiKey,
      },
      body: JSON.stringify({ share1, share2, provider, label: label || `${provider} key` }),
    });

    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error || 'Store failed' };

    return { success: true, keyId: data.keyId };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
