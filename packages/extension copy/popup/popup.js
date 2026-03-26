const API = 'https://api.vaultproof.dev/api/v1';

// Check auth state
async function init() {
  const { vp_token, vp_api_key } = await chrome.storage.local.get(['vp_token', 'vp_api_key']);
  if (!vp_api_key) {
    showLoginView();
  } else {
    showMainView(vp_api_key);
  }
}

function showLoginView() {
  // Show connect button, hide main content
  document.getElementById('loginView').style.display = 'block';
  document.getElementById('mainView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'none';
}

async function showMainView(apiKey) {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'none';
  document.getElementById('mainView').style.display = 'block';
  loadKeys(apiKey);
}

async function loadKeys(apiKey) {
  try {
    const res = await fetch(`${API}/sdk/keys`, {
      headers: { 'X-API-Key': apiKey }
    });
    const data = await res.json();
    renderKeys(data.keys || []);
  } catch (e) {
    document.getElementById('keyList').innerHTML = '<p class="error">Failed to load keys</p>';
  }
}

function renderKeys(keys) {
  const list = document.getElementById('keyList');
  if (keys.length === 0) {
    list.innerHTML = '<p class="empty">No keys stored yet</p>';
    return;
  }
  list.innerHTML = keys.map(k => `
    <div class="key-item">
      <span class="key-provider">${k.provider}</span>
      <span class="key-label">${k.label || 'Unnamed'}</span>
      <span class="key-id">${k.id.slice(0, 8)}</span>
    </div>
  `).join('');
}

async function storeKey() {
  const { vp_api_key } = await chrome.storage.local.get(['vp_api_key']);
  const provider = document.getElementById('provider').value;
  const apiKey = document.getElementById('apiKeyInput').value;
  const label = document.getElementById('labelInput').value;

  if (!apiKey) return;

  const btn = document.getElementById('storeBtn');
  btn.textContent = 'Storing...';
  btn.disabled = true;

  // Send to background worker for Shamir splitting + API call
  chrome.runtime.sendMessage({
    action: 'storeKey',
    data: { provider, apiKey, label, vpApiKey: vp_api_key }
  }, (response) => {
    btn.textContent = 'Store Key';
    btn.disabled = false;
    if (response.success) {
      document.getElementById('apiKeyInput').value = '';
      document.getElementById('labelInput').value = '';
      document.getElementById('storeStatus').textContent = 'Key stored!';
      document.getElementById('storeStatus').className = 'status success';
      loadKeys(vp_api_key);
    } else {
      document.getElementById('storeStatus').textContent = response.error || 'Failed';
      document.getElementById('storeStatus').className = 'status error';
    }
  });
}

function connect() {
  chrome.tabs.create({ url: 'https://vaultproof.dev/app/login' });
}

function openDashboard() {
  chrome.tabs.create({ url: 'https://vaultproof.dev/app' });
}

async function disconnect() {
  await chrome.storage.local.remove(['vp_token', 'vp_api_key']);
  showLoginView();
}

// Settings: save API key
async function saveApiKey() {
  const key = document.getElementById('vpKeyInput').value.trim();
  if (!key.startsWith('vp_')) {
    const status = document.getElementById('settingsStatus');
    status.textContent = 'Key must start with vp_live_ or vp_test_';
    status.className = '';
    return;
  }
  await chrome.storage.local.set({ vp_api_key: key });
  const status = document.getElementById('settingsStatus');
  status.textContent = 'Saved!';
  status.className = 'saved';
  showMainView(key);
}

function showSettingsView() {
  document.getElementById('loginView').style.display = 'none';
  document.getElementById('mainView').style.display = 'none';
  document.getElementById('settingsView').style.display = 'block';
}

document.addEventListener('DOMContentLoaded', () => {
  init();

  // Login view
  document.getElementById('connectBtn').addEventListener('click', connect);
  document.getElementById('showSettingsBtn').addEventListener('click', showSettingsView);

  // Settings view
  document.getElementById('saveKeyBtn').addEventListener('click', saveApiKey);
  document.getElementById('backToLoginBtn').addEventListener('click', showLoginView);

  // Main view
  document.getElementById('storeBtn').addEventListener('click', storeKey);
  document.getElementById('dashboardBtn').addEventListener('click', openDashboard);
  document.getElementById('disconnectBtn').addEventListener('click', disconnect);
});
