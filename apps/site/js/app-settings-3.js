const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
    // Route stats through the main API worker so browser code doesn't call init
    // routes directly across origins.
    const INIT_API = API;
    let token = localStorage.getItem('vaultproof_token');
    const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
    let _refreshAttempted = false;
    let _refreshPromise = null;

    const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');

    function syncUserChrome(emailValue) {
      const email = emailValue || user.email || '';
      const sidebarEmail = document.getElementById('sidebarEmail');
      if (sidebarEmail) sidebarEmail.textContent = email || '—';

      const emailLabel = document.getElementById('user-email');
      if (emailLabel) emailLabel.textContent = email || 'unknown user';
    }

    function syncSidebarUsage() {
      const metricValue = document.getElementById('usageMetricValue');
      const metricFill = document.getElementById('usageBarFill');
      const planLabel = document.getElementById('usagePlanLabel');
      const metricNote = document.getElementById('usageMetricNote');
      if (!metricValue || !metricFill || !planLabel || !metricNote) return;

      const tier = window._currentTier || 'free';
      const callsUsed = Number(window._usageData?.callsUsed || 0);
      const limits = {
        free: 10000,
        starter: 50000,
        pro: 500000,
        team: 2000000,
        enterprise: Infinity,
      };
      const limit = limits[tier] ?? limits.free;

      planLabel.textContent = formatTierLabel(tier).toLowerCase();
      metricValue.textContent = callsUsed.toLocaleString();
      metricNote.textContent = limit === Infinity
        ? 'unmetered call volume'
        : `${Math.max(limit - callsUsed, 0).toLocaleString()} calls left this month`;
      metricFill.style.width = limit === Infinity ? '12%' : `${Math.min(100, (callsUsed / limit) * 100)}%`;
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
      return tier === 'free'
        ? 'Free Plan'
        : tier.charAt(0).toUpperCase() + tier.slice(1) + ' Plan';
    }


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

    // Toast notification system
    function showToast(message, type = 'error') {
      const toast = document.getElementById('toast');
      const inner = document.getElementById('toastInner');
      const msg = document.getElementById('toastMsg');
      msg.textContent = message;
      const styles = {
        error: 'bg-red-900/80 border-red-800/50 text-red-200',
        warning: 'bg-yellow-900/80 border-yellow-800/50 text-yellow-200',
        info: 'bg-[#111118] border-[#1e1e2e] text-gray-300'
      };
      inner.className = `flex items-center gap-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm ${styles[type] || styles.error}`;
      toast.classList.remove('hidden');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => toast.classList.add('hidden'), 5000);
    }

    function showSessionExpired() {
      document.getElementById('sessionExpired').classList.remove('hidden');
    }


    const sidebarEl = document.getElementById('sidebar');
    const overlayEl = document.getElementById('sidebarOverlay');
    syncUserChrome();
    document.getElementById('menuBtn').addEventListener('click', toggleMobileSidebar);
    if (overlayEl) overlayEl.addEventListener('click', toggleMobileSidebar);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);

    function toggleMobileSidebar() {
      if (window.innerWidth > 900) return;
      sidebarEl.classList.toggle('is-open');
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


    async function apiFetch(path, options = {}) {
      try {
        const res = await fetch(`${API}${path}`, {
          ...options,
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        });
        if (res.status === 401) {
          // Try refreshing token once, then retry the request
          if (!_refreshAttempted) {
            _refreshAttempted = true;
            const refreshed = await tryRefreshToken();
            if (refreshed) return apiFetch(path, options);
          }
          showSessionExpired();
          return null;
        }
        _refreshAttempted = false; // Reset on success
        if (res.status === 429) {
          const data = await res.json().catch(() => ({}));
          showToast(data.error || 'Rate limited — try again in a moment', 'warning');
          return null;
        }
        if (res.status >= 500) {
          showToast('Something went wrong on our end. Please try again.', 'error');
          return null;
        }
        return res;
      } catch (e) {
        showToast('Connection lost — check your internet', 'error');
        return null;
      }
    }

    async function apiFetchInit(path) {
      try {
        const res = await fetch(`${INIT_API}${path}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          }
        });
        if (res.status === 401) {
          if (!_refreshAttempted) {
            _refreshAttempted = true;
            const refreshed = await tryRefreshToken();
            if (refreshed) return apiFetchInit(path);
          }
          showSessionExpired();
          return null;
        }
        _refreshAttempted = false;
        if (!res.ok) return null;
        return res.json();
      } catch {
        return null;
      }
    }

    // Load profile
    async function loadProfile() {
      try {
        const res = await apiFetch('/auth/me');
        if (!res) return;
        const data = await res.json();
        const profile = data.user || data;
        const email = profile.email || user.email || '—';
        document.getElementById('profileEmail').textContent = email;
        syncUserChrome(email);
        document.getElementById('profileCreated').textContent = profile.createdAt
          ? new Date(profile.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : '—';
      } catch (e) {
        console.error('Failed to load profile:', e);
        document.getElementById('profileEmail').textContent = user.email || '—';
        syncUserChrome();
        showToast('Couldn\'t load profile — showing cached data', 'warning');
      }
    }

    // Load usage
    async function loadUsage() {
      try {
        const data = await apiFetchInit('/stats/overview');
        if (!data) throw new Error('Failed to load init usage stats');
        const keysUsed = Number(data.totalKeys || 0);
        const callsUsed = Number(data.totalCalls || 0);

        // Store for later tier-based update
        window._usageData = { keysUsed, callsUsed };
        updateUsageBars(keysUsed, callsUsed);
        syncSidebarUsage();
      } catch (e) {
        console.error('Failed to load usage:', e);
        document.getElementById('keysUsed').textContent = '—';
        document.getElementById('callsUsed').textContent = '—';
        syncSidebarUsage();
        showToast('Unable to load usage data', 'warning');
      }
    }

    function updateUsageBars(keysUsed, callsUsed) {
      const tierLimits = {
        free: { keys: 3, calls: 10000 },
        starter: { keys: 10, calls: 50000 },
        pro: { keys: 100, calls: 500000 },
        team: { keys: 500, calls: 2000000 },
        enterprise: { keys: Infinity, calls: Infinity },
      };
      const tier = window._currentTier || 'free';
      const limits = tierLimits[tier] || tierLimits.free;

      const keysMax = limits.keys === Infinity ? 'Unlimited' : limits.keys.toLocaleString();
      const callsMax = limits.calls === Infinity ? 'Unlimited' : limits.calls.toLocaleString();

      document.getElementById('keysUsed').textContent = keysUsed;
      const keysParent = document.getElementById('keysUsed').parentElement;
      keysParent.innerHTML = `<span id="keysUsed">${keysUsed}</span> / ${keysMax}`;

      document.getElementById('callsUsed').textContent = callsUsed.toLocaleString();
      const callsParent = document.getElementById('callsUsed').parentElement;
      callsParent.innerHTML = `<span id="callsUsed">${callsUsed.toLocaleString()}</span> / ${callsMax}`;

      if (limits.keys === Infinity) {
        document.getElementById('keysBar').style.width = '5%';
      } else {
        document.getElementById('keysBar').style.width = Math.min(100, (keysUsed / limits.keys) * 100) + '%';
        if (keysUsed >= limits.keys) document.getElementById('keysBar').classList.replace('bg-[#6366f1]', 'bg-amber-500');
      }

      if (limits.calls === Infinity) {
        document.getElementById('callsBar').style.width = '5%';
      } else {
        document.getElementById('callsBar').style.width = Math.min(100, (callsUsed / limits.calls) * 100) + '%';
        if (callsUsed >= limits.calls * 0.9) document.getElementById('callsBar').classList.replace('bg-[#6366f1]', 'bg-amber-500');
      }
    }

    // Change password
    document.getElementById('passwordForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const msg = document.getElementById('passwordMsg');
      const currentPw = document.getElementById('currentPassword').value;
      const newPw = document.getElementById('newPassword').value;
      const confirmPw = document.getElementById('confirmPassword').value;

      if (newPw !== confirmPw) {
        msg.textContent = 'New passwords do not match.';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
        return;
      }

      if (newPw.length < 8) {
        msg.textContent = 'Password must be at least 8 characters.';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
        return;
      }

      try {
        const res = await apiFetch('/auth/password', {
          method: 'PUT',
          body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw })
        });
        if (!res) return;

        if (res.ok) {
          msg.textContent = 'Password updated successfully.';
          msg.className = 'text-sm text-indigo-400';
          msg.classList.remove('hidden');
          document.getElementById('passwordForm').reset();
        } else {
          const err = await res.json().catch(() => ({}));
          msg.textContent = err.message || `Failed to update password (${res.status})`;
          msg.className = 'text-sm text-amber-400';
          msg.classList.remove('hidden');
        }
      } catch (e) {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
      }
    });

    // Delete account flow
    function deleteAccountStep1() {
      document.getElementById('deleteConfirm1').classList.remove('hidden');
      document.getElementById('deleteConfirm2').classList.add('hidden');
    }

    function deleteAccountStep2() {
      document.getElementById('deleteConfirm1').classList.add('hidden');
      document.getElementById('deleteConfirm2').classList.remove('hidden');
      document.getElementById('deleteInput').focus();
    }

    function cancelDelete() {
      document.getElementById('deleteConfirm1').classList.add('hidden');
      document.getElementById('deleteConfirm2').classList.add('hidden');
    }

    async function confirmDelete() {
      const input = document.getElementById('deleteInput').value.trim();
      const msg = document.getElementById('deleteMsg');

      if (input !== 'DELETE') {
        msg.textContent = 'Please type "DELETE" to confirm.';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
        return;
      }

      try {
        const res = await apiFetch('/auth/account', { method: 'DELETE' });
        if (!res) return;

        if (res.ok) {
          try {
            const sb = window.supabase.createClient(
              'https://gwzkjiomemjlhtrdrlan.supabase.co',
              'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o'
            );
            await sb.auth.signOut();
          } catch {}
          localStorage.removeItem('vaultproof_token');
          localStorage.removeItem('vaultproof_user');
          window.location.href = 'login';
        } else {
          const err = await res.json().catch(() => ({}));
          msg.textContent = err.message || `Failed to delete account (${res.status})`;
          msg.className = 'text-sm text-amber-400';
          msg.classList.remove('hidden');
        }
      } catch (e) {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
      }
    }

    // Billing
    function checkBillingParams() {
      const params = new URLSearchParams(window.location.search);
      const msg = document.getElementById('billingMsg');
      if (params.get('billing') === 'success') {
        msg.textContent = 'Payment successful! Your plan has been upgraded.';
        msg.className = 'mb-4 p-3 rounded-xl text-sm bg-green-900/30 border border-green-800/50 text-green-400';
        msg.classList.remove('hidden');
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
      } else if (params.get('billing') === 'cancel') {
        msg.textContent = 'Checkout was cancelled. No changes were made to your plan.';
        msg.className = 'mb-4 p-3 rounded-xl text-sm bg-yellow-900/30 border border-yellow-800/50 text-yellow-400';
        msg.classList.remove('hidden');
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    async function loadBillingStatus() {
      try {
        const res = await apiFetch('/billing/status');
        if (!res || !res.ok) {
          // Fallback to free plan display
          window._currentTier = 'free';
          document.getElementById('billingTierBadge').textContent = 'Free Plan';
          if (document.getElementById('planBadge')) document.getElementById('planBadge').textContent = 'Free Plan';
          syncSidebarUsage();
          return;
        }
        const data = await res.json();
        const currentTier = normalizeTier(
          data.tier ||
          data.plan ||
          data.subscriptionTier ||
          data.subscription?.tier ||
          data.subscription?.plan ||
          data.customer?.tier
        );
        window._currentTier = currentTier;
        syncSidebarUsage();
        const isSubscribed = data.hasSubscription || data.subscribed || false;

        // Update badge
        const badge = document.getElementById('billingTierBadge');
        const tierColors = {
          free: 'bg-gray-700/30 text-gray-400 border-gray-600/30',
          starter: 'bg-cyan-900/30 text-cyan-400 border-cyan-700/30',
          pro: 'bg-[#6366f1]/15 text-[#6366f1] border-[#6366f1]/30',
          team: 'bg-purple-900/30 text-purple-400 border-purple-700/30',
          enterprise: 'bg-amber-900/30 text-amber-400 border-amber-700/30',
        };
        const colorClass = tierColors[currentTier] || tierColors.free;
        badge.className = `inline-flex items-center px-3 py-1 rounded-xl text-sm font-medium capitalize ${colorClass}`;
        badge.textContent = formatTierLabel(currentTier);

        // Update Plan & Usage section
        const planBadge = document.getElementById('planBadge');
        if (planBadge) {
          const planColor = tierColors[currentTier] || tierColors.free;
          planBadge.className = `inline-flex items-center px-3 py-1 rounded-xl text-sm font-medium capitalize ${planColor}`;
          planBadge.textContent = formatTierLabel(currentTier);
        }
        const tierLimits = {
          free: { keys: 3, calls: 10000 },
          starter: { keys: 10, calls: 50000 },
          pro: { keys: 100, calls: 500000 },
          team: { keys: 500, calls: 2000000 },
          enterprise: { keys: Infinity, calls: Infinity },
        };
        const limits = tierLimits[currentTier] || tierLimits.free;
        const keysLabel = limits.keys === Infinity ? 'Max' : limits.keys.toLocaleString();
        const callsLabel = limits.calls === Infinity ? 'Max' : limits.calls.toLocaleString();
        const keysUsedEl = document.getElementById('keysUsed');
        const callsUsedEl = document.getElementById('callsUsed');
        if (keysUsedEl) keysUsedEl.parentElement.innerHTML = `<span id="keysUsed">${keysUsedEl.textContent}</span> / ${keysLabel}`;
        if (callsUsedEl) callsUsedEl.parentElement.innerHTML = `<span id="callsUsed">${callsUsedEl.textContent}</span> / ${callsLabel}`;

        // Update upgrade buttons — hide current tier and below
        const tierOrder = ['free', 'starter', 'pro', 'team', 'enterprise'];
        const currentIdx = tierOrder.indexOf(currentTier);
        document.querySelectorAll('.billing-upgrade-btn').forEach(btn => {
          const btnTier = btn.getAttribute('data-tier');
          const btnIdx = tierOrder.indexOf(btnTier);
          if (btnIdx <= currentIdx) {
            btn.disabled = true;
            btn.textContent = btnTier === currentTier ? 'Current' : 'Included';
            btn.className = btn.className.replace('bg-[#6366f1] hover:bg-[#5558e6]', 'bg-gray-800 cursor-not-allowed');
            btn.classList.add('opacity-50');
          }
        });

        // Hide upgrade banner for paid tiers
        if (currentTier !== 'free') {
          const banner = document.getElementById('upgradeProBanner');
          if (banner) banner.classList.add('hidden');
        }

        // Re-render usage bars with correct tier limits
        if (window._usageData) {
          updateUsageBars(window._usageData.keysUsed, window._usageData.callsUsed);
        }

        // Check promo status
        try {
          const meRes = await apiFetch('/auth/me');
          if (meRes) {
            const meData = await meRes.json();
            if (meData.user?.promoCode) {
              window._promoCode = meData.user.promoCode;
              window._tierExpiresAt = meData.user.tierExpiresAt;
            }
          }
        } catch (e) {}

        // Show promo label if applicable
        if (window._promoCode) {
          const promoLabel = currentTier.charAt(0).toUpperCase() + currentTier.slice(1) + ' (Product Hunt)';
          if (planBadge) planBadge.textContent = promoLabel;
          badge.textContent = promoLabel;

          // Show expiry
          if (window._tierExpiresAt) {
            const expiryDate = new Date(window._tierExpiresAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const expiryEl = document.createElement('div');
            expiryEl.className = 'text-xs text-gray-500 mt-2';
            expiryEl.textContent = 'Promo expires: ' + expiryDate;
            if (planBadge) planBadge.parentElement.appendChild(expiryEl);
          }
        }

        // Hide upgrade cards and banner for promo users
        if (window._promoCode) {
          document.getElementById('billingUpgradeCards').classList.add('hidden');
          const promoBanner = document.getElementById('upgradeProBanner');
          if (promoBanner) promoBanner.classList.add('hidden');
        }

        // Hide upgrade cards entirely for top tier
        if (currentIdx >= tierOrder.indexOf('pro')) {
          document.getElementById('billingUpgradeCards').classList.add('hidden');
        }

        // Show manage billing if subscribed
        if (isSubscribed) {
          document.getElementById('billingManage').classList.remove('hidden');
        }
      } catch (e) {
        console.error('Failed to load billing status:', e);
        window._currentTier = 'free';
        const badge = document.getElementById('billingTierBadge');
        badge.textContent = 'Free Plan';
        badge.className = 'inline-flex items-center px-3 py-1 rounded-xl bg-gray-700/30 text-gray-400 text-sm font-medium border border-gray-600/30 capitalize';
        const planBadge = document.getElementById('planBadge');
        if (planBadge) {
          planBadge.textContent = 'Free Plan';
          planBadge.className = 'inline-flex items-center px-3 py-1 rounded-xl bg-gray-700/30 text-gray-400 text-sm font-medium border border-gray-600/30';
        }
        syncSidebarUsage();
      }
    }

    // Annual / Monthly toggle for settings page
    let isSettingsAnnual = false;
    function toggleSettingsAnnual() {
      isSettingsAnnual = !isSettingsAnnual;
      const dot = document.getElementById('settingsAnnualDot');
      const toggle = document.getElementById('settingsAnnualToggle');
      if (isSettingsAnnual) {
        dot.style.left = '26px';
        dot.className = 'absolute top-0.5 w-5 h-5 bg-indigo-400 rounded-full transition-all';
        toggle.className = 'relative w-12 h-6 bg-indigo-500/30 rounded-full transition-colors';
      } else {
        dot.style.left = '2px';
        dot.className = 'absolute top-0.5 left-0.5 w-5 h-5 bg-gray-500 rounded-full transition-all';
        toggle.className = 'relative w-12 h-6 bg-[#1e1e2e] rounded-full transition-colors';
      }
      document.querySelectorAll('[data-monthly]').forEach(function(el) {
        el.textContent = isSettingsAnnual ? el.getAttribute('data-annual') : el.getAttribute('data-monthly');
      });
      document.querySelectorAll('[data-period]').forEach(function(el) {
        el.textContent = isSettingsAnnual ? '/yr' : '/mo';
      });
    }

    function bindPageActions() {
      const toastCloseBtn = document.getElementById('toastCloseBtn');
      if (toastCloseBtn) {
        toastCloseBtn.addEventListener('click', () => {
          document.getElementById('toast').classList.add('hidden');
        });
      }

      const killSwitchBtn = document.getElementById('killSwitchBtn');
      if (killSwitchBtn) killSwitchBtn.addEventListener('click', showKillSwitchModal);

      const closeKillSwitchBtn = document.getElementById('closeKillSwitchBtn');
      if (closeKillSwitchBtn) closeKillSwitchBtn.addEventListener('click', closeKillSwitchModal);

      const confirmKillBtn = document.getElementById('confirmKillBtn');
      if (confirmKillBtn) confirmKillBtn.addEventListener('click', confirmKillSwitch);

      const resumeAllBtn = document.getElementById('resumeAllBtn');
      if (resumeAllBtn) resumeAllBtn.addEventListener('click', deactivateKillSwitch);

      const saveGlobalLimitsBtn = document.getElementById('saveGlobalLimitsBtn');
      if (saveGlobalLimitsBtn) saveGlobalLimitsBtn.addEventListener('click', saveGlobalLimits);

      const annualToggleBtn = document.getElementById('settingsAnnualToggle');
      if (annualToggleBtn) annualToggleBtn.addEventListener('click', toggleSettingsAnnual);

      document.querySelectorAll('.billing-upgrade-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tier = btn.getAttribute('data-tier');
          if (tier) upgradeTier(tier);
        });
      });

      const billingManageBtn = document.getElementById('billingManageBtn');
      if (billingManageBtn) billingManageBtn.addEventListener('click', openBillingPortal);

      const deleteBtn = document.getElementById('deleteBtn');
      if (deleteBtn) deleteBtn.addEventListener('click', deleteAccountStep1);

      const deleteConfirmStep1Btn = document.getElementById('deleteConfirmStep1Btn');
      if (deleteConfirmStep1Btn) deleteConfirmStep1Btn.addEventListener('click', deleteAccountStep2);

      const deleteCancel1Btn = document.getElementById('deleteCancel1Btn');
      if (deleteCancel1Btn) deleteCancel1Btn.addEventListener('click', cancelDelete);

      const deleteConfirmFinalBtn = document.getElementById('deleteConfirmFinalBtn');
      if (deleteConfirmFinalBtn) deleteConfirmFinalBtn.addEventListener('click', confirmDelete);

      const deleteCancel2Btn = document.getElementById('deleteCancel2Btn');
      if (deleteCancel2Btn) deleteCancel2Btn.addEventListener('click', cancelDelete);
    }

    async function upgradeTier(tier) {
      const btn = document.querySelector(`.billing-upgrade-btn[data-tier="${tier}"]`);
      const origText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Redirecting...';

      try {
        const res = await apiFetch('/billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ tier, annual: isSettingsAnnual })
        });
        if (!res) { btn.disabled = false; btn.textContent = origText; return; }

        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            try {
              const u = new URL(data.url);
              if (u.protocol === 'https:' && (u.hostname.endsWith('.stripe.com') || u.hostname === 'stripe.com')) {
                window.location.href = data.url;
                return;
              }
            } catch {}
            console.error('Billing redirect blocked: unexpected URL');
          }
        }

        const err = await res.json().catch(() => ({}));
        alert(err.error || err.message || 'Failed to start checkout');
      } catch (e) {
        alert('Network error. Please try again.');
      }

      btn.disabled = false;
      btn.textContent = origText;
    }

    async function openBillingPortal() {
      try {
        const res = await apiFetch('/billing/portal', { method: 'POST' });
        if (!res) return;

        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            try {
              const u = new URL(data.url);
              if (u.protocol === 'https:' && (u.hostname.endsWith('.stripe.com') || u.hostname === 'stripe.com')) {
                window.location.href = data.url;
                return;
              }
            } catch {}
            console.error('Billing redirect blocked: unexpected URL');
          }
        }

        const err = await res.json().catch(() => ({}));
        alert(err.error || err.message || 'Failed to open billing portal');
      } catch (e) {
        alert('Network error. Please try again.');
      }
    }

    // Kill switch
    function showKillSwitchModal() {
      document.getElementById('killSwitchModal').classList.remove('hidden');
      document.getElementById('killSwitchConfirm').value = '';
      document.getElementById('killSwitchPassword').value = '';
      document.getElementById('killSwitchError').classList.add('hidden');
      document.getElementById('confirmKillBtn').disabled = true;
    }

    function closeKillSwitchModal() {
      document.getElementById('killSwitchModal').classList.add('hidden');
    }

    function checkKillSwitchReady() {
      var stopOk = document.getElementById('killSwitchConfirm').value.toUpperCase() === 'STOP';
      var passOk = document.getElementById('killSwitchPassword').value.length >= 1;
      document.getElementById('confirmKillBtn').disabled = !(stopOk && passOk);
    }
    document.getElementById('killSwitchConfirm')?.addEventListener('input', checkKillSwitchReady);
    document.getElementById('killSwitchPassword')?.addEventListener('input', checkKillSwitchReady);

    async function confirmKillSwitch() {
      if (document.getElementById('killSwitchConfirm').value.toUpperCase() !== 'STOP') return;
      var password = document.getElementById('killSwitchPassword').value;
      var errEl = document.getElementById('killSwitchError');
      errEl.classList.add('hidden');

      // Verify password via Supabase
      try {
        var sb = window.supabase.createClient(
          'https://gwzkjiomemjlhtrdrlan.supabase.co',
          'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o'
        );
        var userJson = localStorage.getItem('vaultproof_user');
        var email = userJson ? JSON.parse(userJson).email : '';
        var { error } = await sb.auth.signInWithPassword({ email: email, password: password });
        if (error) {
          errEl.textContent = 'Incorrect password';
          errEl.classList.remove('hidden');
          return;
        }
      } catch {
        errEl.textContent = 'Password verification failed';
        errEl.classList.remove('hidden');
        return;
      }

      await apiFetch('/auth/kill-switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: true }) });
      closeKillSwitchModal();
      document.getElementById('killSwitchActive').classList.remove('hidden');
      document.getElementById('killSwitchBtn').classList.add('hidden');
    }

    async function deactivateKillSwitch() {
      if (!confirm('Resume all proxy calls?')) return;
      await apiFetch('/auth/kill-switch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) });
      document.getElementById('killSwitchActive').classList.add('hidden');
      document.getElementById('killSwitchBtn').classList.remove('hidden');
    }

    // Global limits
    async function saveGlobalLimits() {
      const daily = document.getElementById('globalDailyLimit').value;
      const monthly = document.getElementById('globalMonthlyLimit').value;
      const res = await apiFetch('/auth/global-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          globalDailyLimit: daily ? parseInt(daily) : null,
          globalMonthlyLimit: monthly ? parseInt(monthly) : null,
        }),
      });
      const status = document.getElementById('globalLimitStatus');
      if (res && res.ok) {
        status.textContent = 'Saved!';
        status.className = 'text-xs ml-3 text-indigo-400';
      } else {
        status.textContent = 'Failed';
        status.className = 'text-xs ml-3 text-amber-400';
      }
    }

    // Load kill switch + global limits state on page load
    async function loadSafetyControls() {
      try {
        const res = await apiFetch('/auth/me');
        if (!res) return;
        const data = await res.json();
        const user = data.user || data;
        if (user.killSwitch) {
          document.getElementById('killSwitchActive').classList.remove('hidden');
          document.getElementById('killSwitchBtn').classList.add('hidden');
        }
        if (user.globalDailyLimit) document.getElementById('globalDailyLimit').value = user.globalDailyLimit;
        if (user.globalMonthlyLimit) document.getElementById('globalMonthlyLimit').value = user.globalMonthlyLimit;
      } catch {}
    }

    // Init — refresh token first, then load data in parallel
    // Load everything immediately — apiFetch handles 401 with auto-refresh
    bindPageActions();
    checkBillingParams();
    loadProfile();
    loadUsage();
    loadBillingStatus();
    loadSafetyControls();
