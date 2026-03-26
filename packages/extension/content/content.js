// Key detection patterns per provider
const KEY_PATTERNS = [
  { pattern: /sk-proj-[A-Za-z0-9_-]{20,}/, provider: 'openai' },
  { pattern: /sk-[A-Za-z0-9_-]{40,}/, provider: 'openai' },
  { pattern: /sk-ant-[A-Za-z0-9_-]{20,}/, provider: 'anthropic' },
  { pattern: /AIza[A-Za-z0-9_-]{30,}/, provider: 'google' },
  { pattern: /gsk_[A-Za-z0-9]{20,}/, provider: 'groq' },
];

// Detect current provider from URL
function detectProvider() {
  const host = window.location.hostname;
  if (host.includes('openai.com')) return 'openai';
  if (host.includes('anthropic.com')) return 'anthropic';
  if (host.includes('google.com') || host.includes('aistudio.google.com')) return 'google';
  if (host.includes('groq.com')) return 'groq';
  if (host.includes('mistral.ai')) return 'mistral';
  if (host.includes('together.xyz')) return 'together';
  return null;
}

let detectedKeys = new Set();

function scanForKeys() {
  const provider = detectProvider();
  if (!provider) return;

  // Get all text nodes
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode);

  // Also check input values and code blocks
  const codeElements = document.querySelectorAll('code, pre, input[type="text"], input[type="password"], .api-key, [data-testid*="key"]');

  for (const el of codeElements) {
    const text = el.value || el.textContent || '';
    for (const { pattern, provider: keyProvider } of KEY_PATTERNS) {
      const match = text.match(pattern);
      if (match && !detectedKeys.has(match[0])) {
        detectedKeys.add(match[0]);
        showStoreButton(el, match[0], keyProvider || provider);
      }
    }
  }
}

function showStoreButton(element, key, provider) {
  // Don't add duplicate buttons
  if (element.parentElement?.querySelector('.vp-store-btn')) return;

  const btn = document.createElement('button');
  btn.className = 'vp-store-btn';
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
      <circle cx="12" cy="12" r="3.5"/>
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>
      <line x1="15.5" y1="12" x2="18" y2="12" stroke-linecap="round"/>
    </svg>
    Store in VaultProof
  `;

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();

    btn.textContent = 'Storing...';
    btn.disabled = true;

    // Get API key from storage
    chrome.runtime.sendMessage({ action: 'getApiKey' }, async (response) => {
      if (!response?.apiKey) {
        btn.innerHTML = 'Connect VaultProof first';
        btn.addEventListener('click', () => {
          window.open('https://vaultproof.dev/app/login', '_blank');
        }, { once: true });
        return;
      }

      chrome.runtime.sendMessage({
        action: 'storeKey',
        data: { provider, apiKey: key, label: `${provider} key (auto-detected)`, vpApiKey: response.apiKey }
      }, (storeResponse) => {
        if (storeResponse?.success) {
          btn.innerHTML = '&#10003; Stored in VaultProof';
          btn.classList.add('vp-store-btn-success');
        } else {
          btn.innerHTML = 'Failed — try again';
          btn.disabled = false;
        }
      });
    });
  });

  // Insert after the element
  if (element.parentElement) {
    element.parentElement.style.position = 'relative';
    element.parentElement.appendChild(btn);
  }
}

// Scan on load and on DOM changes (for SPA pages)
scanForKeys();
const observer = new MutationObserver(() => {
  setTimeout(scanForKeys, 500);
});
observer.observe(document.body, { childList: true, subtree: true });
