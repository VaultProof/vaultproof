const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
const session = window.VaultProofSession;
let token = (session && session.getAccessToken())
  || localStorage.getItem('vaultproof_token');
const user = (session && session.getUser())
  || JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
let refreshAttempted = false;
let refreshPromise = null;
let isAnnual = false;
let currentTier = 'free';
let usageData = { keysUsed: 0, callsUsed: 0 };

const tierLimits = {
  free: { keys: 3, calls: 10000 },
  starter: { keys: 10, calls: 50000 },
  pro: { keys: 100, calls: 500000 },
  team: { keys: 500, calls: 2000000 },
  enterprise: { keys: Infinity, calls: Infinity },
};

if (!token && !(session && session.hasRefreshToken())) {
  window.location.href = 'login';
}

async function tryRefreshToken() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async function() {
    try {
      const refreshedToken = session
        ? await session.refresh()
        : '';
      if (!refreshedToken) return false;
      token = refreshedToken;
      return true;
    } catch {
      return false;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

function normalizeTier(value) {
  const tier = String(value || '').trim().toLowerCase();
  if (!tier) return 'free';
  if (tier.includes('enterprise')) return 'enterprise';
  if (tier.includes('team')) return 'team';
  if (tier.includes('pro')) return 'pro';
  if (tier.includes('starter')) return 'starter';
  if (tier.includes('free')) return 'free';
  return 'free';
}

function formatTierLabel(tier) {
  return tier === 'free' ? 'Free Plan' : `${tier.charAt(0).toUpperCase()}${tier.slice(1)} Plan`;
}

function syncUserChrome(emailValue) {
  const email = emailValue || user.email || '';
  const sidebarEmail = document.getElementById('sidebarEmail');
  if (sidebarEmail) sidebarEmail.textContent = email || '—';

  const emailLabel = document.getElementById('user-email');
  if (emailLabel) emailLabel.textContent = email || 'unknown user';
}

const sidebarEl = document.getElementById('sidebar');
const overlayEl = document.getElementById('sidebarOverlay');

function toggleMobileSidebar() {
  if (window.innerWidth > 900) return;
  sidebarEl.classList.toggle('is-open');
  overlayEl.classList.toggle('hidden');
}

async function logout() {
  Object.keys(localStorage).forEach((key) => {
    if (key.includes('auth-token')) localStorage.removeItem(key);
  });
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith('vaultproof_') || key.startsWith('sb-')) localStorage.removeItem(key);
  });
  sessionStorage.clear();
  window.location.replace('/app/login?logout=1');
}

async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    });

    if (res.status === 401) {
      if (!refreshAttempted) {
        refreshAttempted = true;
        const refreshed = await tryRefreshToken();
        if (refreshed) return apiFetch(path, options);
      }
      refreshAttempted = false;
      return null;
    }

    refreshAttempted = false;
    return res;
  } catch {
    return null;
  }
}

function toggleAnnual() {
  isAnnual = !isAnnual;
  const toggle = document.getElementById('annualToggle');
  if (toggle) toggle.classList.toggle('active', isAnnual);

  document.querySelectorAll('[data-monthly]').forEach((el) => {
    el.textContent = isAnnual ? el.getAttribute('data-annual') : el.getAttribute('data-monthly');
  });
  document.querySelectorAll('[data-period]').forEach((el) => {
    el.textContent = isAnnual ? '/yr' : '/mo';
  });
}

function showBillingMessage(text, tone) {
  const msg = document.getElementById('billingMsg');
  if (!msg) return;
  const themes = {
    success: {
      bg: 'rgba(22, 163, 74, 0.08)',
      border: 'rgba(22, 163, 74, 0.18)',
      color: '#15803d',
    },
    warning: {
      bg: 'rgba(161, 98, 7, 0.08)',
      border: 'rgba(161, 98, 7, 0.18)',
      color: '#a16207',
    },
  };
  const theme = themes[tone] || themes.warning;
  msg.textContent = text;
  msg.style.display = 'block';
  msg.style.background = theme.bg;
  msg.style.borderColor = theme.border;
  msg.style.color = theme.color;
}

function formatLimit(value) {
  return value === Infinity ? 'Unlimited' : value.toLocaleString();
}

function meterWidth(used, limit) {
  if (limit === Infinity) return used > 0 ? 8 : 0;
  if (!limit) return 0;
  return Math.min(100, (used / limit) * 100);
}

function updateUsageDisplay() {
  const limits = tierLimits[currentTier] || tierLimits.free;
  const keysUsed = Number(usageData.keysUsed || 0);
  const callsUsed = Number(usageData.callsUsed || 0);

  const keysUsedEl = document.getElementById('keysUsed');
  const keysLimitEl = document.getElementById('keysLimit');
  const keysBar = document.getElementById('keysBar');
  const callsUsedEl = document.getElementById('callsUsed');
  const callsLimitEl = document.getElementById('callsLimit');
  const callsBar = document.getElementById('callsBar');
  const usageNote = document.getElementById('usageNote');

  if (keysUsedEl) keysUsedEl.textContent = keysUsed.toLocaleString();
  if (keysLimitEl) keysLimitEl.textContent = formatLimit(limits.keys);
  if (keysBar) keysBar.style.width = `${meterWidth(keysUsed, limits.keys)}%`;

  if (callsUsedEl) callsUsedEl.textContent = callsUsed.toLocaleString();
  if (callsLimitEl) callsLimitEl.textContent = formatLimit(limits.calls);
  if (callsBar) callsBar.style.width = `${meterWidth(callsUsed, limits.calls)}%`;

  if (usageNote) {
    if (limits.calls === Infinity) {
      usageNote.textContent = 'Enterprise usage uses custom billing and support limits.';
    } else {
      const callsLeft = Math.max(limits.calls - callsUsed, 0).toLocaleString();
      usageNote.textContent = `${callsLeft} API calls left in the current monthly allowance.`;
    }
  }
}

const tierRank = { free: 0, starter: 1, pro: 2, team: 3, enterprise: 4 };

function showPlan(tier, hasSubscription, expiresAt) {
  currentTier = normalizeTier(tier);
  updateUsageDisplay();

  const badge = document.getElementById('currentPlanBadge');
  const planExpiry = document.getElementById('planExpiry');
  const colors = {
    free: { bg: 'rgba(100, 116, 139, 0.1)', color: '#64748b', border: 'rgba(100, 116, 139, 0.15)' },
    starter: { bg: 'rgba(8, 145, 178, 0.08)', color: '#0e7490', border: 'rgba(8, 145, 178, 0.18)' },
    pro: { bg: 'rgba(217, 119, 6, 0.08)', color: '#b45309', border: 'rgba(217, 119, 6, 0.18)' },
    team: { bg: 'rgba(126, 34, 206, 0.08)', color: '#7e22ce', border: 'rgba(126, 34, 206, 0.16)' },
    enterprise: { bg: 'rgba(146, 64, 14, 0.08)', color: '#92400e', border: 'rgba(146, 64, 14, 0.18)' },
  };
  const tone = colors[currentTier] || colors.free;
  if (badge) {
    badge.textContent = formatTierLabel(currentTier);
    badge.style.background = tone.bg;
    badge.style.color = tone.color;
    badge.style.borderColor = tone.border;
  }

  if (planExpiry) {
    if (expiresAt) {
      const formatted = new Date(expiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
      planExpiry.textContent = `renewal / expiry ${formatted}`;
    } else {
      planExpiry.textContent = currentTier === 'free'
        ? 'no active paid subscription'
        : 'billing is active';
    }
  }

  const manageBtn = document.getElementById('manageBillingBtn');
  if (manageBtn) manageBtn.classList.toggle('hidden', !hasSubscription);

  const currentRank = tierRank[currentTier] || 0;
  document.querySelectorAll('.billing-upgrade-btn').forEach((btn) => {
    const btnTier = btn.getAttribute('data-tier');
    const btnRank = tierRank[btnTier] || 0;

    if (btnTier === currentTier) {
      btn.textContent = 'Current Plan';
      btn.disabled = true;
      btn.className = 'billing-upgrade-btn btn-outline';
      btn.style.cursor = 'default';
    } else if (btnRank > currentRank) {
      btn.textContent = `Upgrade to ${btnTier.charAt(0).toUpperCase()}${btnTier.slice(1)}`;
      btn.disabled = false;
      btn.className = 'billing-upgrade-btn btn-primary';
      btn.style.cursor = 'pointer';
    } else {
      btn.textContent = `Move to ${btnTier.charAt(0).toUpperCase()}${btnTier.slice(1)}`;
      btn.disabled = false;
      btn.className = 'billing-upgrade-btn btn-outline';
      btn.style.cursor = 'pointer';
    }
  });

  const freeBtn = document.getElementById('freeBtn');
  if (freeBtn) {
    if (currentTier === 'free') {
      freeBtn.textContent = 'Current Plan';
      freeBtn.disabled = true;
      freeBtn.className = 'btn-outline';
      freeBtn.style.cursor = 'default';
    } else {
      freeBtn.textContent = 'Move to Free';
      freeBtn.disabled = false;
      freeBtn.className = 'btn-outline';
      freeBtn.style.cursor = 'pointer';
    }
  }
}

async function loadPlan() {
  try {
    const res = await apiFetch('/billing/status');
    if (!res || !res.ok) {
      showPlan('free', false);
      return;
    }

    const data = await res.json().catch(() => ({}));
    const tier = normalizeTier(
      data.tier ||
      data.plan ||
      data.subscriptionTier ||
      (data.subscription && (data.subscription.tier || data.subscription.plan)) ||
      (data.customer && data.customer.tier) ||
      user.tier
    );
    const hasSubscription = Boolean(data.hasSubscription || data.subscribed || data.subscription);
    const expiresAt = data.currentPeriodEnd || data.expiresAt || data.subscription?.current_period_end || data.subscription?.expires_at || null;
    showPlan(tier, hasSubscription, expiresAt);
  } catch {
    showPlan('free', false);
  }
}

async function loadUsage() {
  try {
    const res = await apiFetch('/stats/overview');
    if (!res || !res.ok) {
      updateUsageDisplay();
      return;
    }

    const data = await res.json().catch(() => ({}));
    usageData = {
      keysUsed: Number(data.totalKeys || data.keysUsed || 0),
      callsUsed: Number(data.totalCalls || data.callsUsed || 0),
    };
    updateUsageDisplay();
  } catch {
    updateUsageDisplay();
  }
}

async function upgradeTier(tier) {
  const btn = document.querySelector(`.billing-upgrade-btn[data-tier="${tier}"]`);
  if (!btn) return;
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Redirecting...';

  try {
    const res = await apiFetch('/billing/checkout', {
      method: 'POST',
      body: JSON.stringify({ tier, annual: isAnnual }),
    });
    if (!res) {
      btn.disabled = false;
      btn.textContent = originalText;
      alert('Please sign in again.');
      return;
    }

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.url) {
      try {
        const u = new URL(data.url);
        if (u.protocol === 'https:' && (u.hostname.endsWith('.stripe.com') || u.hostname === 'stripe.com')) {
          window.location.href = data.url;
          return;
        }
      } catch {}
    }

    alert(data.error || 'Failed to start checkout. Please try again.');
  } catch {
    alert('Network error. Please try again.');
  }

  btn.disabled = false;
  btn.textContent = originalText;
}

async function openBillingPortal() {
  try {
    const res = await apiFetch('/billing/portal', { method: 'POST' });
    if (!res) return;
    if (res.ok) {
      const data = await res.json().catch(() => ({}));
      if (data.url) {
        try {
          const u = new URL(data.url);
          if (u.protocol === 'https:' && (u.hostname.endsWith('.stripe.com') || u.hostname === 'stripe.com')) {
            window.location.href = data.url;
            return;
          }
        } catch {}
      }
    }
    alert('Failed to open billing portal.');
  } catch {
    alert('Failed to open billing portal.');
  }
}

function bindPageActions() {
  syncUserChrome();

  const menuBtn = document.getElementById('menuBtn');
  if (menuBtn) menuBtn.addEventListener('click', toggleMobileSidebar);
  if (overlayEl) overlayEl.addEventListener('click', toggleMobileSidebar);

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  const signOutBtn = document.getElementById('signOutBtn');
  if (signOutBtn) signOutBtn.addEventListener('click', logout);

  const annualToggle = document.getElementById('annualToggle');
  if (annualToggle) annualToggle.addEventListener('click', toggleAnnual);

  const freeBtn = document.getElementById('freeBtn');
  if (freeBtn) {
    freeBtn.addEventListener('click', () => {
      if (currentTier !== 'free') openBillingPortal();
    });
  }

  const manageBillingBtn = document.getElementById('manageBillingBtn');
  if (manageBillingBtn) manageBillingBtn.addEventListener('click', openBillingPortal);

  document.querySelectorAll('.billing-upgrade-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tier = btn.getAttribute('data-tier');
      if (tier) upgradeTier(tier);
    });
  });
}

const params = new URLSearchParams(window.location.search);
if (params.get('billing') === 'success') {
  showBillingMessage('Payment successful. Your plan is updating now.', 'success');
  window.history.replaceState({}, '', window.location.pathname);
} else if (params.get('billing') === 'cancel') {
  showBillingMessage('Checkout was cancelled. No charge was made.', 'warning');
  window.history.replaceState({}, '', window.location.pathname);
}

bindPageActions();
loadPlan();
loadUsage();
