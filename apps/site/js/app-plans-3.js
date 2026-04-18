const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
    let token = localStorage.getItem('vaultproof_token');
    const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
    const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
    let _refreshAttempted = false;
    let _refreshPromise = null;

    if (!token) { window.location.href = 'login'; }

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
      if (_refreshPromise) return _refreshPromise;
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) return false;

      _refreshPromise = (async function() {
        try {
          const res = await fetch(`${API}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
          });
          if (!res.ok) return false;
          const data = await res.json().catch(() => null);
          if (!data || !data.token) return false;
          token = data.token;
          localStorage.setItem('vaultproof_token', data.token);
          if (data.refreshToken) {
            localStorage.setItem('vaultproof_refresh_token', data.refreshToken);
          }
          return true;
        } catch {
          return false;
        } finally {
          _refreshPromise = null;
        }
      })();

      return _refreshPromise;
    }

    let isAnnual = false;
    let currentTier = 'free';

    // Sidebar
    const sidebarEl = document.getElementById('sidebar');
    const overlayEl = document.getElementById('sidebarOverlay');
    document.getElementById('sidebarEmail').textContent = user.email || '';
    document.getElementById('menuBtn').addEventListener('click', toggleMobileSidebar);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    function toggleMobileSidebar() {
      sidebarEl.classList.toggle('-translate-x-full');
      overlayEl.classList.toggle('hidden');
    }

    async function logout() {
      Object.keys(localStorage).forEach(function(key) {
        if (key.includes('auth-token')) localStorage.removeItem(key);
      });
      Object.keys(localStorage).forEach(function(key) {
        if (key.startsWith('vaultproof_') || key.startsWith('sb-')) localStorage.removeItem(key);
      });
      sessionStorage.clear();
      window.location.replace('/app/login?logout=1');
    }

    async function apiFetch(path, options) {
      options = options || {};
      var res = await fetch(API + path, Object.assign({}, options, {
        headers: Object.assign({ 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, options.headers || {})
      }));
      if (res.status === 401) {
        if (!_refreshAttempted) {
          _refreshAttempted = true;
          const refreshed = await tryRefreshToken();
          if (refreshed) return apiFetch(path, options);
        }
        _refreshAttempted = false;
        return null;
      }
      _refreshAttempted = false;
      return res;
    }

    // Toggle annual
    function toggleAnnual() {
      isAnnual = !isAnnual;
      var dot = document.getElementById('annualDot');
      var toggle = document.getElementById('annualToggle');
      if (isAnnual) {
        dot.style.left = '26px';
        dot.className = 'absolute top-0.5 w-5 h-5 bg-indigo-400 rounded-full transition-all';
        toggle.className = 'relative w-12 h-6 bg-indigo-500/30 rounded-full transition-colors';
      } else {
        dot.style.left = '2px';
        dot.className = 'absolute top-0.5 left-0.5 w-5 h-5 bg-gray-500 rounded-full transition-all';
        toggle.className = 'relative w-12 h-6 bg-[#1e1e2e] rounded-full transition-colors';
      }
      document.querySelectorAll('[data-monthly]').forEach(function(el) {
        el.textContent = isAnnual ? el.getAttribute('data-annual') : el.getAttribute('data-monthly');
      });
      document.querySelectorAll('[data-period]').forEach(function(el) {
        el.textContent = isAnnual ? '/yr' : '/mo';
      });
    }

    // Load current plan
    async function loadPlan() {
      try {
        var res = await apiFetch('/billing/status');
        if (!res || !res.ok) { showPlan('free', false); return; }
        var data = await res.json();
        currentTier = data.tier || 'free';
        showPlan(currentTier, data.hasSubscription);
      } catch {
        showPlan('free', false);
      }
    }

    var tierRank = { free: 0, starter: 1, pro: 2, enterprise: 3 };

    function showPlan(tier, hasSubscription) {
      var badge = document.getElementById('currentPlanBadge');
      var colors = {
        free: 'bg-gray-700/30 text-gray-400 border-gray-600/30',
        starter: 'bg-cyan-900/30 text-cyan-400 border-cyan-700/30',
        pro: 'bg-brand/15 text-brand border-brand/30',
        enterprise: 'bg-amber-900/30 text-amber-400 border-amber-700/30',
      };
      var c = colors[tier] || colors.free;
      badge.className = 'inline-flex items-center px-4 py-1.5 rounded-xl text-sm font-semibold capitalize ' + c;
      badge.textContent = tier === 'free' ? 'Free Plan' : tier.charAt(0).toUpperCase() + tier.slice(1) + ' Plan';

      var currentRank = tierRank[tier] || 0;

      // Update upgrade/downgrade buttons
      document.querySelectorAll('.billing-upgrade-btn').forEach(function(btn) {
        var btnTier = btn.getAttribute('data-tier');
        var btnRank = tierRank[btnTier] || 0;

        if (btnTier === tier) {
          btn.textContent = 'Current Plan';
          btn.disabled = true;
          btn.className = 'w-full px-4 py-2.5 bg-[#1e1e2e] text-gray-500 rounded-xl text-sm font-medium cursor-default';
        } else if (btnRank > currentRank) {
          btn.textContent = 'Upgrade to ' + btnTier.charAt(0).toUpperCase() + btnTier.slice(1);
          btn.disabled = false;
          btn.className = 'billing-upgrade-btn w-full px-4 py-2.5 bg-brand hover:bg-brand-hover text-white rounded-xl text-sm font-medium transition btn-glow';
        } else {
          btn.textContent = 'Downgrade to ' + btnTier.charAt(0).toUpperCase() + btnTier.slice(1);
          btn.disabled = false;
          btn.className = 'billing-upgrade-btn w-full px-4 py-2.5 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-300 rounded-xl text-sm font-medium transition border border-[#1e1e2e]';
        }
      });

      var freeBtn = document.getElementById('freeBtn');
      if (tier === 'free') {
        freeBtn.textContent = 'Current Plan';
        freeBtn.disabled = true;
      } else {
        freeBtn.textContent = 'Downgrade to Free';
        freeBtn.disabled = false;
        freeBtn.className = 'w-full px-4 py-2.5 bg-[#1e1e2e] hover:bg-[#2a2a3a] text-gray-300 rounded-xl text-sm font-medium transition border border-[#1e1e2e] cursor-pointer';
        freeBtn.onclick = function() { openBillingPortal(); };
      }

      if (hasSubscription) {
        document.getElementById('manageBtn').classList.remove('hidden');
      }
    }

    // Upgrade
    async function upgradeTier(tier) {
      var btn = document.querySelector('.billing-upgrade-btn[data-tier="' + tier + '"]');
      if (!btn) return;
      var origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Redirecting...';

      try {
        var res = await apiFetch('/billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ tier: tier, annual: isAnnual })
        });
        if (!res) { btn.disabled = false; btn.textContent = origText; alert('Please sign in again.'); return; }

        var data = await res.json().catch(function() { return {}; });

        if (res.ok && data.url) {
          try {
            var u = new URL(data.url);
            if (u.protocol === 'https:' && (u.hostname.endsWith('.stripe.com') || u.hostname === 'stripe.com')) {
              window.location.href = data.url;
              return;
            }
          } catch {}
        }

        alert(data.error || 'Failed to start checkout. Please try again.');
      } catch (e) {
        alert('Network error. Please try again.');
      }

      btn.disabled = false;
      btn.textContent = origText;
    }

    // Billing portal
    async function openBillingPortal() {
      try {
        var res = await apiFetch('/billing/portal', { method: 'POST' });
        if (!res) return;
        if (res.ok) {
          var data = await res.json();
          if (data.url) {
            var u = new URL(data.url);
            if (u.protocol === 'https:' && (u.hostname.endsWith('.stripe.com') || u.hostname === 'stripe.com')) {
              window.location.href = data.url;
            }
          }
        }
      } catch {
        alert('Failed to open billing portal.');
      }
    }

    // Check billing redirect params
    var params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success') {
      var msg = document.getElementById('billingMsg');
      msg.textContent = 'Payment successful! Your plan has been upgraded.';
      msg.className = 'mb-6 p-4 rounded-xl text-sm bg-green-900/30 text-green-400 border border-green-700/30';
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('billing') === 'cancel') {
      var msg = document.getElementById('billingMsg');
      msg.textContent = 'Checkout cancelled. No charges were made.';
      msg.className = 'mb-6 p-4 rounded-xl text-sm bg-amber-900/30 text-amber-400 border border-amber-700/30';
      window.history.replaceState({}, '', window.location.pathname);
    }

    loadPlan();
