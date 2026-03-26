/**
 * VaultProof Bridge — runs on vaultproof.dev pages
 *
 * Detects when user logs in and sends the auth token to the extension.
 * The extension then auto-creates a developer key so the user doesn't
 * have to copy/paste anything.
 */

function checkAndSendToken() {
  const token = localStorage.getItem('vaultproof_token');
  const user = localStorage.getItem('vaultproof_user');

  if (token && user) {
    chrome.runtime.sendMessage({
      action: 'autoConnect',
      data: { token, user: JSON.parse(user) }
    });
  }
}

// Check immediately
checkAndSendToken();

// Also watch for changes (login happens async)
window.addEventListener('storage', (e) => {
  if (e.key === 'vaultproof_token' && e.newValue) {
    checkAndSendToken();
  }
});

// Poll briefly after page load (OAuth redirects set localStorage after a delay)
let checks = 0;
const interval = setInterval(() => {
  checkAndSendToken();
  checks++;
  if (checks > 10) clearInterval(interval);
}, 1000);
