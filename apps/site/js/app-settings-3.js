const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
    let token = localStorage.getItem('vaultproof_token');
    let _refreshAttempted = false;
    let _refreshPromise = null;

    function escapeHtml(str) {
      return (str == null ? '' : String(str))
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }
    const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');


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
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith('sb-') || !key.endsWith('-auth-token')) continue;
        const found = extractRefreshToken(localStorage.getItem(key));
        if (found) return found;
      }
      return null;
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
    document.getElementById('sidebarEmail').textContent = user.email || '—';
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

    // Token display
    const tokenDisplayEl = document.getElementById('tokenDisplay');
    if (tokenDisplayEl) tokenDisplayEl.value = token || '';
    let tokenVisible = false;

    function toggleTokenVisibility() {
      tokenVisible = !tokenVisible;
      if (tokenDisplayEl) tokenDisplayEl.type = tokenVisible ? 'text' : 'password';
      const eyeIcon = document.getElementById('eyeIcon');
      if (!eyeIcon) return;
      if (tokenVisible) {
        eyeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21"/>';
      } else {
        eyeIcon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>';
      }
    }

    function copyToken() {
      navigator.clipboard.writeText(token).then(() => {
        const msg = document.getElementById('copyMsg');
        if (!msg) return;
        msg.classList.remove('hidden');
        setTimeout(() => msg.classList.add('hidden'), 2000);
      });
    }

    // Load profile
    async function loadProfile() {
      try {
        const res = await apiFetch('/auth/me');
        if (!res) return;
        const data = await res.json();
        const profile = data.user || data;
        document.getElementById('profileEmail').textContent = profile.email || user.email || '—';
        document.getElementById('profileCreated').textContent = profile.createdAt
          ? new Date(profile.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
          : '—';
      } catch (e) {
        console.error('Failed to load profile:', e);
        document.getElementById('profileEmail').textContent = user.email || '—';
        showToast('Couldn\'t load profile — showing cached data', 'warning');
      }
    }

    // Load usage
    async function loadUsage() {
      try {
        const res = await apiFetch('/stats/overview');
        if (!res) return;
        const data = await res.json();
        const keysUsed = data.totalKeys || 0;
        const callsUsed = data.totalCalls || 0;

        // Store for later tier-based update
        window._usageData = { keysUsed, callsUsed };
        updateUsageBars(keysUsed, callsUsed);
      } catch (e) {
        console.error('Failed to load usage:', e);
        document.getElementById('keysUsed').textContent = '—';
        document.getElementById('callsUsed').textContent = '—';
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

    // Developer API Keys
    let newlyCreatedKey = '';

    function showCreateForm() {
      document.getElementById('createKeyForm').classList.remove('hidden');
      document.getElementById('newKeyLabel').focus();
    }

    function hideCreateForm() {
      document.getElementById('createKeyForm').classList.add('hidden');
      document.getElementById('newKeyLabel').value = '';
      document.getElementById('newKeyMode').value = 'live';
    }

    async function createDevKey() {
      const btn = document.getElementById('submitKeyBtn');
      const label = document.getElementById('newKeyLabel').value.trim() || 'SDK Key';
      const mode = document.getElementById('newKeyMode').value;
      btn.disabled = true;
      btn.textContent = 'Creating...';

      try {
        const res = await apiFetch('/dev-keys/create', {
          method: 'POST',
          body: JSON.stringify({ label, mode })
        });
        if (!res) { btn.disabled = false; btn.textContent = 'Create'; return; }

        if (res.ok) {
          const data = await res.json();
          newlyCreatedKey = data.key;
          document.getElementById('newKeyValue').textContent = data.key;
          document.getElementById('newKeyBox').classList.remove('hidden');
          hideCreateForm();
          loadDevKeys();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.message || 'Failed to create key');
        }
      } catch (e) {
        alert('Network error. Please try again.');
      }

      btn.disabled = false;
      btn.textContent = 'Create';
    }

    function copyNewKey() {
      navigator.clipboard.writeText(newlyCreatedKey).then(() => {
        const btn = event.currentTarget;
        const orig = btn.innerHTML;
        btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!';
        setTimeout(() => { btn.innerHTML = orig; }, 2000);
      });
    }

    async function loadDevKeys() {
      const loading = document.getElementById('devKeysLoading');
      const empty = document.getElementById('devKeysEmpty');
      const table = document.getElementById('devKeysTable');

      if (!loading || !empty || !table) return; // Elements not in DOM

      try {
        const res = await apiFetch('/dev-keys/list');
        if (!res) return;

        const data = await res.json();
        const keys = data.keys || [];

        loading.classList.add('hidden');

        if (keys.length === 0) {
          empty.classList.remove('hidden');
          table.classList.add('hidden');
          return;
        }

        empty.classList.add('hidden');
        table.classList.remove('hidden');
        table.innerHTML = keys.map(k => {
          const mode = k.mode || 'live';
          const modeBadge = mode === 'test'
            ? '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-gray-800/50 text-gray-400 border border-gray-700/50">test</span>'
            : '<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-indigo-900/30 text-indigo-400 border border-indigo-800/50">live</span>';
          return `
            <div class="dev-key-entry" data-key-id="${k.id}">
              <div class="flex items-center justify-between py-4 gap-4">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2 flex-wrap">
                    <code class="text-sm font-mono text-gray-300">${escapeHtml(k.key || k.maskedKey || k.masked_key || 'vp-proj-****')}</code>
                    ${k.label ? `<span class="text-xs text-gray-500 bg-[#0a0a0f] px-2 py-0.5 rounded-lg border border-[#1e1e2e]">${escapeHtml(k.label)}</span>` : ''}
                    ${modeBadge}
                  </div>
                  <div class="text-xs text-gray-600 mt-1.5">
                    Created ${new Date(k.createdAt || k.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${k.lastUsed || k.lastUsedAt || k.last_used_at ? ' &middot; Last used ' + new Date(k.lastUsed || k.lastUsedAt || k.last_used_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ' &middot; Never used'}
                  </div>
                </div>
                <div class="flex items-center gap-2">
                  <button onclick="toggleKeySettings('${k.id}')" class="px-3 py-1.5 text-xs text-gray-400 hover:text-indigo-400 border border-[#1e1e2e] hover:border-indigo-800 hover:bg-indigo-900/20 rounded-xl transition whitespace-nowrap flex items-center gap-1.5" title="Security Settings">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    Settings
                  </button>
                  <button onclick="revokeDevKey('${k.id}')" class="px-3 py-1.5 text-xs text-amber-400 hover:text-red-300 border border-red-900/50 hover:border-red-800 hover:bg-red-900/20 rounded-xl transition whitespace-nowrap">
                    Revoke
                  </button>
                </div>
              </div>
              <div id="keySettings-${k.id}" class="hidden fade-in mb-4">
                <div class="p-5 bg-[#0a0a0f] border border-[#1e1e2e] rounded-xl space-y-5">
                  <div class="flex items-center gap-2 mb-1">
                    <svg class="w-4 h-4 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                    <span class="text-sm font-semibold text-indigo-400">Security Settings</span>
                  </div>

                  <!-- IP Allowlist -->
                  <div>
                    <label class="block text-sm text-gray-300 mb-1 font-medium">Allowed IPs</label>
                    <p class="text-xs text-gray-500 mb-2">Restrict this key to specific IP addresses. Leave empty to allow all.</p>
                    <textarea id="keyIps-${k.id}" rows="2" placeholder="e.g., 203.0.113.1, 10.0.0.5" class="w-full px-4 py-2.5 bg-[#111118] border border-[#1e1e2e] rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#6366f1] transition font-mono resize-none">${escapeHtml(k.allowedIps || '')}</textarea>
                  </div>

                  <!-- Provider Restrictions -->
                  <div>
                    <label class="block text-sm text-gray-300 mb-1 font-medium">Allowed Providers</label>
                    <p class="text-xs text-gray-500 mb-2">Only allow this key to access specific providers.</p>
                    <div class="flex flex-wrap gap-3">
                      ${['openai', 'anthropic', 'google', 'together'].map(p => {
                        const checked = !k.allowedProviders || k.allowedProviders.includes(p) ? 'checked' : '';
                        const label = p.charAt(0).toUpperCase() + p.slice(1);
                        return `<label class="flex items-center gap-2 text-sm text-gray-300 cursor-pointer select-none">
                          <input type="checkbox" value="${p}" class="key-provider-${k.id} w-4 h-4 rounded bg-[#111118] border-[#1e1e2e] text-[#6366f1] focus:ring-[#6366f1] focus:ring-offset-0 accent-[#6366f1]" ${checked} />
                          ${label}
                        </label>`;
                      }).join('')}
                    </div>
                  </div>

                  <!-- Endpoint Restrictions -->
                  <div>
                    <label class="block text-sm text-gray-300 mb-1 font-medium">Allowed Endpoints</label>
                    <p class="text-xs text-gray-500 mb-2">Only allow specific API endpoints. Leave empty to allow all.</p>
                    <textarea id="keyEndpoints-${k.id}" rows="2" placeholder="e.g., /v1/chat/completions, /v1/models" class="w-full px-4 py-2.5 bg-[#111118] border border-[#1e1e2e] rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#6366f1] transition font-mono resize-none">${escapeHtml(k.allowedEndpoints || '')}</textarea>
                  </div>

                  <!-- Usage Alerts -->
                  <div>
                    <label class="block text-sm text-gray-300 mb-1 font-medium">Usage Alerts</label>
                    <p class="text-xs text-gray-500 mb-2">Get notified when usage exceeds threshold.</p>
                    <div class="flex flex-col sm:flex-row gap-3">
                      <div class="flex-1">
                        <label class="block text-xs text-gray-500 mb-1">Alert Email</label>
                        <input type="email" id="keyAlertEmail-${k.id}" placeholder="you@example.com" value="${escapeHtml(k.alertEmail || '')}" class="w-full px-4 py-2.5 bg-[#111118] border border-[#1e1e2e] rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#6366f1] transition" />
                      </div>
                      <div class="w-full sm:w-40">
                        <label class="block text-xs text-gray-500 mb-1">Threshold (calls/hr)</label>
                        <input type="number" id="keyAlertThreshold-${k.id}" placeholder="100" value="${k.alertThreshold || ''}" min="1" class="w-full px-4 py-2.5 bg-[#111118] border border-[#1e1e2e] rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#6366f1] transition" />
                      </div>
                    </div>
                  </div>

                  <!-- Webhook URL -->
                  <div>
                    <label class="block text-sm text-gray-300 mb-1 font-medium">Webhook URL</label>
                    <p class="text-xs text-gray-500 mb-2">Receive POST notifications when keys are used or revoked.</p>
                    <input type="url" id="keyWebhookUrl-${k.id}" placeholder="https://your-app.com/webhook" value="${escapeHtml(k.webhookUrl || '')}" class="w-full px-4 py-2.5 bg-[#111118] border border-[#1e1e2e] rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#6366f1] transition" />
                  </div>

                  <!-- Webhook Secret -->
                  <div>
                    <label class="block text-sm text-gray-300 mb-1 font-medium">Webhook Secret</label>
                    <p class="text-xs text-gray-500 mb-2">Used to sign webhook payloads. Save to generate.</p>
                    <input type="password" id="keyWebhookSecret-${k.id}" placeholder="Auto-generated on save" class="w-full px-4 py-2.5 bg-[#111118] border border-[#1e1e2e] rounded-xl text-sm text-white placeholder-gray-600 focus:outline-none focus:border-[#6366f1] transition font-mono" />
                    <div id="keyWebhookSecretReveal-${k.id}" class="hidden mt-2 p-2 bg-indigo-900/20 border border-indigo-800/40 rounded-lg">
                      <p class="text-xs text-indigo-400 mb-1">Save this secret — it won't be shown again:</p>
                      <code id="keyWebhookSecretValue-${k.id}" class="text-xs font-mono text-indigo-300 break-all"></code>
                    </div>
                  </div>

                  <!-- Save / Status -->
                  <div class="flex items-center gap-3 pt-1">
                    <button onclick="saveKeySettings('${k.id}')" id="saveKeySettingsBtn-${k.id}" class="px-4 py-2 bg-[#6366f1] hover:bg-[#5558e6] text-white rounded-xl text-sm font-medium transition btn-glow flex items-center gap-2">
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                      Save Settings
                    </button>
                    <span id="keySettingsMsg-${k.id}" class="text-xs hidden"></span>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');
      } catch (e) {
        console.error('Failed to load dev keys:', e);
        loading.innerHTML = '<div class="flex flex-col items-center gap-3"><span class="text-gray-400">Unable to load keys</span><button onclick="loadDevKeys()" class="px-4 py-2 bg-[#6366f1]/20 border border-[#6366f1]/30 text-[#6366f1] rounded-xl text-xs hover:bg-[#6366f1]/30 transition">Retry</button></div>';
      }
    }

    async function revokeDevKey(keyId) {
      if (!confirm('Revoke this API key? All SDK calls using it will stop working.')) return;

      try {
        const res = await apiFetch(`/dev-keys/${keyId}/revoke`, { method: 'POST' });
        if (!res) return;

        if (res.ok) {
          loadDevKeys();
        } else {
          const err = await res.json().catch(() => ({}));
          alert(err.message || 'Failed to revoke key');
        }
      } catch (e) {
        alert('Network error. Please try again.');
      }
    }

    // Security Settings per key
    function toggleKeySettings(keyId) {
      const panel = document.getElementById(`keySettings-${keyId}`);
      if (!panel) return;
      if (panel.classList.contains('hidden')) {
        // Close any other open panels
        document.querySelectorAll('[id^="keySettings-"]').forEach(el => {
          if (el.id !== `keySettings-${keyId}`) el.classList.add('hidden');
        });
        panel.classList.remove('hidden');
      } else {
        panel.classList.add('hidden');
      }
    }

    async function saveKeySettings(keyId) {
      const btn = document.getElementById(`saveKeySettingsBtn-${keyId}`);
      const msg = document.getElementById(`keySettingsMsg-${keyId}`);
      const origHTML = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<div class="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> Saving...';
      msg.classList.add('hidden');

      const allowedIps = (document.getElementById(`keyIps-${keyId}`)?.value || '').trim();
      const allowedEndpoints = (document.getElementById(`keyEndpoints-${keyId}`)?.value || '').trim();
      const alertEmail = (document.getElementById(`keyAlertEmail-${keyId}`)?.value || '').trim();
      const alertThreshold = parseInt(document.getElementById(`keyAlertThreshold-${keyId}`)?.value, 10) || null;

      const providerCheckboxes = document.querySelectorAll(`.key-provider-${keyId}:checked`);
      const allowedProviders = Array.from(providerCheckboxes).map(cb => cb.value).join(',');

      const webhookUrl = (document.getElementById(`keyWebhookUrl-${keyId}`)?.value || '').trim();
      let webhookSecret = (document.getElementById(`keyWebhookSecret-${keyId}`)?.value || '').trim();

      // Auto-generate webhook secret if URL is set but secret is empty
      let generatedSecret = null;
      if (webhookUrl && !webhookSecret) {
        const arr = new Uint8Array(16);
        crypto.getRandomValues(arr);
        webhookSecret = Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
        generatedSecret = webhookSecret;
      }

      const payload = {
        allowedIps: allowedIps.replace(/\s+/g, ''),
        allowedProviders,
        allowedEndpoints: allowedEndpoints.replace(/\s+/g, ''),
        alertEmail,
        alertThreshold
      };
      if (webhookUrl) payload.webhookUrl = webhookUrl;
      if (webhookSecret) payload.webhookSecret = webhookSecret;

      try {
        const res = await apiFetch(`/dev-keys/${keyId}/settings`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });

        if (!res) {
          btn.disabled = false;
          btn.innerHTML = origHTML;
          return;
        }

        if (res.ok) {
          msg.textContent = 'Settings saved';
          msg.className = 'text-xs text-emerald-400';
          msg.classList.remove('hidden');
          setTimeout(() => msg.classList.add('hidden'), 3000);

          // Show auto-generated webhook secret once
          if (generatedSecret) {
            const revealEl = document.getElementById(`keyWebhookSecretReveal-${keyId}`);
            const valueEl = document.getElementById(`keyWebhookSecretValue-${keyId}`);
            if (revealEl && valueEl) {
              valueEl.textContent = generatedSecret;
              revealEl.classList.remove('hidden');
              document.getElementById(`keyWebhookSecret-${keyId}`).value = generatedSecret;
            }
          }
        } else {
          const err = await res.json().catch(() => ({}));
          msg.textContent = err.message || 'Failed to save settings';
          msg.className = 'text-xs text-amber-400';
          msg.classList.remove('hidden');
        }
      } catch (e) {
        msg.textContent = 'Network error. Please try again.';
        msg.className = 'text-xs text-amber-400';
        msg.classList.remove('hidden');
      }

      btn.disabled = false;
      btn.innerHTML = origHTML;
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
          document.getElementById('billingTierBadge').textContent = 'Free Plan';
          if (document.getElementById('planBadge')) document.getElementById('planBadge').textContent = 'Free Plan';
          return;
        }
        const data = await res.json();
        const currentTier = data.tier || 'free';
        window._currentTier = currentTier;
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
        badge.textContent = currentTier === 'free' ? 'Free Plan' : currentTier.charAt(0).toUpperCase() + currentTier.slice(1) + ' Plan';

        // Update Plan & Usage section
        const planBadge = document.getElementById('planBadge');
        if (planBadge) {
          const planColor = tierColors[currentTier] || tierColors.free;
          planBadge.className = `inline-flex items-center px-3 py-1 rounded-xl text-sm font-medium capitalize ${planColor}`;
          planBadge.textContent = currentTier === 'free' ? 'Free Plan' : currentTier.charAt(0).toUpperCase() + currentTier.slice(1) + ' Plan';
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
            btn.className = btn.className.replace('bg-[#6366f1] hover:bg-[#5558e6]', 'bg-gray-800 cursor-not-allowed').replace('btn-glow', '');
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
        if (currentTier === 'pro') {
          document.getElementById('billingUpgradeCards').classList.add('hidden');
        }

        // Show manage billing if subscribed
        if (isSubscribed) {
          document.getElementById('billingManage').classList.remove('hidden');
        }
      } catch (e) {
        console.error('Failed to load billing status:', e);
        const badge = document.getElementById('billingTierBadge');
        badge.textContent = 'Free Plan';
        badge.className = 'inline-flex items-center px-3 py-1 rounded-xl bg-gray-700/30 text-gray-400 text-sm font-medium border border-gray-600/30 capitalize';
        const planBadge = document.getElementById('planBadge');
        if (planBadge) {
          planBadge.textContent = 'Free Plan';
          planBadge.className = 'inline-flex items-center px-3 py-1 rounded-xl bg-gray-700/30 text-gray-400 text-sm font-medium border border-gray-600/30';
        }
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
    checkBillingParams();
    loadProfile();
    loadUsage();
    loadBillingStatus();
    loadDevKeys();
    loadSafetyControls();
