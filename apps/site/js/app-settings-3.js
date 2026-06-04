const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
    const session = window.VaultProofSession;
    let token = (session && session.getAccessToken())
      || localStorage.getItem('vaultproof_token');
    let _refreshAttempted = false;
    let _refreshPromise = null;

    const user = (session && session.getUser())
      || JSON.parse(localStorage.getItem('vaultproof_user') || '{}');

    function syncUserChrome(emailValue) {
      const email = emailValue || user.email || '';
      const emailLabel = document.getElementById('user-email');
      if (emailLabel) emailLabel.textContent = email || 'unknown user';
    }

    if (!token && !(session && session.hasRefreshToken())) {
      window.location.href = 'login';
    }

    async function tryRefreshToken() {
      if (_refreshPromise) return _refreshPromise;

      _refreshPromise = (async function() {
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


    syncUserChrome();
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);

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
    loadProfile();
    loadSafetyControls();
