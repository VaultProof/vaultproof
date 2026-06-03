const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
let token = localStorage.getItem('vaultproof_token');
const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
let refreshAttempted = false;
let refreshPromise = null;
let isAnnual = false;
let currentTier = 'free';

if (!token) window.location.href = 'login';

function extractRefreshToken(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return extractRefreshToken(JSON.parse(value)); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractRefreshToken(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value === 'object') {
    if (typeof value.refresh_token === 'string' && value.refresh_token) return value.refresh_token;
    for (const key in value) {
      const found = extractRefreshToken(value[key]);
      if (found) return found;
    }
  }
  return null;
}

function getStoredRefreshToken() {
  const explicit = localStorage.getItem('vaultproof_refresh_token');
  if (explicit) return explicit;
  return extractRefreshToken(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
}

async function tryRefreshToken() {
  if (refreshPromise) return refreshPromise;
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  refreshPromise = (async function() {
    try {
      const res = await fetch(`${API}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      const data = await res.json().catch(() => null);
      if (!data || !data.token) return false;
      token = data.token;
      localStorage.setItem('vaultproof_token', data.token);
      if (data.refreshToken) localStorage.setItem('vaultproof_refresh_token', data.refreshToken);
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

function syncSidebarUsage() {
  const usagePlanLabel = document.getElementById('usagePlanLabel');
  const usageMetricValue = document.getElementById('usageMetricValue');
  const usageMetricNote = document.getElementById('usageMetricNote');
  const usageBarFill = document.getElementById('usageBarFill');
  if (!usagePlanLabel || !usageMetricValue || !usageMetricNote || !usageBarFill) return;

  const rank = { free: 18, starter: 42, pro: 76, team: 90, enterprise: 100 };
  usagePlanLabel.textContent = formatTierLabel(currentTier).toLowerCase();
  usageMetricValue.textContent = currentTier;
  usageMetricNote.textContent = currentTier === 'free'
    ? 'upgrade for more volume and controls'
    : currentTier === 'enterprise'
      ? 'custom billing and support path'
      : 'self-serve billing is active';
  usageBarFill.style.width = `${rank[currentTier] || 18}%`;
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

const tierRank = { free: 0, starter: 1, pro: 2, team: 3, enterprise: 4 };

function showPlan(tier, hasSubscription, expiresAt) {
  currentTier = normalizeTier(tier);
  syncSidebarUsage();

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
