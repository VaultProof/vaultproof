// --- Split-key encryption engine (Shamir GF(256)) ---
    var _EXP = new Uint8Array(512), _LOG = new Uint8Array(256);
    (function() {
      var x = 1;
      for (var i = 0; i < 255; i++) {
        _EXP[i] = x; _LOG[x] = i;
        x = x ^ (x << 1) ^ (x >= 128 ? 0x11b : 0); x &= 0xff;
      }
      for (var i = 255; i < 512; i++) _EXP[i] = _EXP[i - 255];
    })();
    function gfMul(a, b) { return (a === 0 || b === 0) ? 0 : _EXP[_LOG[a] + _LOG[b]]; }
    function gfDiv(a, b) { if (b === 0) throw new Error('div0'); return a === 0 ? 0 : _EXP[(_LOG[a] + 255 - _LOG[b]) % 255]; }
    function evalPoly(c, x) { var r = 0; for (var i = c.length - 1; i >= 0; i--) r = (gfMul(r, x) ^ c[i]); return r; }
    function shamirSplit(secret, n, k) {
      var shares = []; for (var i = 0; i < n; i++) shares.push({ x: i + 1, y: new Uint8Array(secret.length) });
      for (var b = 0; b < secret.length; b++) {
        var coeffs = new Uint8Array(k); coeffs[0] = secret[b];
        var rand = crypto.getRandomValues(new Uint8Array(k - 1));
        for (var j = 1; j < k; j++) coeffs[j] = rand[j - 1];
        for (var i = 0; i < n; i++) shares[i].y[b] = evalPoly(coeffs, shares[i].x);
      }
      return shares;
    }
    function shamirSerialize(share) {
      var buf = new Uint8Array(1 + share.y.length); buf[0] = share.x; buf.set(share.y, 1);
      return btoa(String.fromCharCode.apply(null, buf));
    }

    const API = window.location.hostname.includes('dev.vaultproof')
      ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
      : 'https://init.vaultproof.dev/api/v1/init';
    let token = localStorage.getItem('vaultproof_token');
    const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
    let _refreshAttempted = false;
    let _refreshPromise = null;

    if (!token) { window.location.href = 'login'; }

    // --- Confirm modal state ---
    let _confirmCallback = null;

    function showConfirm(title, message, actionLabel, callback) {
      document.getElementById('confirmTitle').textContent = title;
      document.getElementById('confirmMessage').textContent = message;
      document.getElementById('confirmActionBtn').textContent = actionLabel;
      _confirmCallback = callback;
      document.getElementById('confirmModal').classList.remove('hidden');
      document.getElementById('confirmModal').classList.add('flex');
    }

    function closeConfirmModal() {
      document.getElementById('confirmModal').classList.add('hidden');
      document.getElementById('confirmModal').classList.remove('flex');
      _confirmCallback = null;
    }

    function executeConfirm() {
      if (_confirmCallback) _confirmCallback();
      closeConfirmModal();
    }

    // --- Auth helpers ---
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
          const res = await fetch(API + '/auth/refresh', {
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

    // --- UI helpers ---
    function showToast(message, type = 'error') {
      const toast = document.getElementById('toast');
      const inner = document.getElementById('toastInner');
      const msg = document.getElementById('toastMsg');
      msg.textContent = message;
      const styles = {
        success: 'bg-green-900/80 border-green-800/50 text-green-200',
        error: 'bg-red-900/80 border-red-800/50 text-red-200',
        warning: 'bg-yellow-900/80 border-yellow-800/50 text-yellow-200',
        info: 'bg-[#111118] border-[#1e1e2e] text-gray-300'
      };
      inner.className = 'flex items-center gap-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm ' + (styles[type] || styles.error);
      toast.classList.remove('hidden');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => toast.classList.add('hidden'), 5000);
    }

    function showSessionExpired() {
      document.getElementById('sessionExpired').classList.remove('hidden');
    }

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

    // --- API client ---
    async function apiFetch(url, options = {}) {
      try {
        const res = await fetch(url, {
          ...options,
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json',
            ...(options.headers || {})
          }
        });
        if (res.status === 401) {
          if (!_refreshAttempted) {
            _refreshAttempted = true;
            const refreshed = await tryRefreshToken();
            if (refreshed) return apiFetch(url, options);
          }
          _refreshAttempted = false;
          showSessionExpired();
          return null;
        }
        _refreshAttempted = false;
        if (res.status === 429) {
          showToast('Rate limited -- try again in a moment', 'warning');
          return null;
        }
        if (res.status >= 500) {
          showToast('Something went wrong on our end', 'error');
          return null;
        }
        return res;
      } catch (e) {
        showToast('Connection lost -- check your internet', 'error');
        return null;
      }
    }

    // --- Utility helpers ---
    function escapeHtml(str) {
      return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
    }

    function escapeJs(str) {
      return (str || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/</g,'\\x3c').replace(/>/g,'\\x3e').replace(/\r/g,'\\r').replace(/\n/g,'\\n');
    }

    function formatDate(ts) {
      if (!ts) return '\u2014';
      var d = new Date(ts);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function copyText(text) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('Copied to clipboard', 'success');
      });
    }

    // --- Provider badges ---
    const providerColors = {
      openai:      { badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', dot: 'bg-emerald-400' },
      anthropic:   { badge: 'bg-orange-500/10 text-orange-400 border-orange-500/20', dot: 'bg-orange-400' },
      stripe:      { badge: 'bg-purple-500/10 text-purple-400 border-purple-500/20', dot: 'bg-purple-400' },
      groq:        { badge: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20', dot: 'bg-cyan-400' },
      mistral:     { badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-400' },
      together:    { badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', dot: 'bg-indigo-400' },
      fireworks:   { badge: 'bg-red-500/10 text-red-400 border-red-500/20', dot: 'bg-red-400' },
      deepseek:    { badge: 'bg-sky-500/10 text-sky-400 border-sky-500/20', dot: 'bg-sky-400' },
      xai:         { badge: 'bg-gray-500/10 text-gray-300 border-gray-500/20', dot: 'bg-gray-300' },
      openrouter:  { badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20', dot: 'bg-violet-400' },
      resend:      { badge: 'bg-teal-500/10 text-teal-400 border-teal-500/20', dot: 'bg-teal-400' },
      sendgrid:    { badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-400' },
      linear:      { badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', dot: 'bg-indigo-400' },
      notion:      { badge: 'bg-gray-500/10 text-gray-300 border-gray-500/20', dot: 'bg-gray-300' },
      github:      { badge: 'bg-gray-500/10 text-gray-300 border-gray-500/20', dot: 'bg-gray-300' },
    };

    const providerDisplayNames = {
      openai: 'OpenAI', anthropic: 'Anthropic', stripe: 'Stripe', groq: 'Groq',
      mistral: 'Mistral', together: 'Together', fireworks: 'Fireworks', deepseek: 'DeepSeek',
      xai: 'xAI', openrouter: 'OpenRouter', resend: 'Resend', sendgrid: 'SendGrid',
      linear: 'Linear', notion: 'Notion', github: 'GitHub',
    };

    function providerBadge(provider) {
      var p = (provider || '').toLowerCase();
      var c = providerColors[p] || { badge: 'bg-gray-500/10 text-gray-400 border-gray-500/20', dot: 'bg-gray-400' };
      var name = providerDisplayNames[p] || provider || 'Unknown';
      return '<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ' + c.badge + '">' +
        '<span class="w-1.5 h-1.5 rounded-full ' + c.dot + '"></span>' +
        escapeHtml(name) +
      '</span>';
    }

    // --- State ---
    let allProjects = [];
    let projectKeysMap = {}; // projectId -> [keys]
    let expandedProjectId = null;

    // --- Stats ---
    async function loadStats() {
      try {
        var res = await apiFetch(API + '/projects/stats');
        if (!res || !res.ok) return;
        var data = await res.json();
        document.getElementById('statProjects').textContent = data.totalProjects || 0;
        document.getElementById('statKeys').textContent = data.totalKeys || 0;
        document.getElementById('statProviders').textContent = data.providerCount || 0;
      } catch (e) {
        // Stats are non-critical
      }
    }

    // --- Projects ---
    async function loadProjects() {
      var container = document.getElementById('projectsContainer');
      var loading = document.getElementById('projectsLoading');
      var empty = document.getElementById('emptyState');

      try {
        var res = await apiFetch(API + '/projects');
        if (!res) return;
        var data = await res.json();
        allProjects = data.projects || [];

        if (loading) loading.remove();

        if (allProjects.length === 0) {
          container.innerHTML = '';
          empty.classList.remove('hidden');
          return;
        }

        empty.classList.add('hidden');
        renderProjects();

        // Load keys for expanded project or all projects
        for (var i = 0; i < allProjects.length; i++) {
          loadProjectKeys(allProjects[i].id);
        }
      } catch (err) {
        if (loading) loading.remove();
        container.innerHTML = '<div class="text-center py-12"><div class="text-gray-400 mb-3">Unable to load projects</div><button type="button" data-action="retry-load-projects" class="px-4 py-2 bg-[#6366f1]/20 border border-[#6366f1]/30 text-[#6366f1] rounded-xl text-sm hover:bg-[#6366f1]/30 transition">Retry</button></div>';
      }
    }

    async function loadProjectKeys(projectId) {
      try {
        var res = await apiFetch(API + '/projects/' + projectId + '/keys');
        if (!res || !res.ok) return;
        var data = await res.json();
        projectKeysMap[projectId] = data.keys || [];
        renderProjects();
      } catch (e) {
        // Non-critical
      }
    }

    function renderProjects() {
      var container = document.getElementById('projectsContainer');
      var empty = document.getElementById('emptyState');

      if (allProjects.length === 0) {
        container.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');

      container.innerHTML = allProjects.map(function(proj, idx) {
        var projId = proj.id;
        // Validate projId
        projId = /^[a-f0-9-]+$/i.test(projId) ? projId : '';
        var vpProjId = proj.vp_proj_id || '';
        var name = proj.name || '';
        var created = formatDate(proj.created_at);
        var keys = projectKeysMap[projId] || [];
        var isExpanded = expandedProjectId === projId;
        var delay = Math.min(idx * 80, 400);

        var keysHtml = '';
        if (isExpanded) {
          if (keys.length === 0) {
            keysHtml = '<div class="px-5 py-6 border-t border-border text-center">' +
              '<p class="text-sm text-gray-500">No keys in this project yet.</p>' +
              '<p class="text-xs text-gray-600 mt-2">Run <code class="text-indigo-400 font-mono">npx @vaultproof/init</code> to scan and protect all keys at once, or</p>' +
              '<button type="button" data-action="open-add-key-modal" data-project-id="' + escapeHtml(projId) + '" class="mt-2 px-4 py-2 bg-brand/10 border border-brand/20 text-brand text-sm rounded-lg hover:bg-brand/20 transition">Add a key manually</button>' +
            '</div>';
          } else {
            keysHtml = '<div class="border-t border-border">' +
              keys.map(function(key) {
                var keyId = key.id || '';
                keyId = /^[a-f0-9-]+$/i.test(keyId) ? keyId : '';
                var envVarName = key.env_var || key.slug || (key.provider ? key.provider.toUpperCase() + '_API_KEY' : '\u2014');
                return '<div class="flex items-center justify-between py-3 px-4 border-b border-border last:border-b-0">' +
                  '<div class="flex items-center gap-3 min-w-0 flex-1">' +
                    providerBadge(key.provider) +
                    '<div class="min-w-0">' +
                      '<div class="text-sm font-mono text-white truncate">' + escapeHtml(envVarName) + '</div>' +
                      '<div class="text-xs text-gray-600 truncate">' + escapeHtml(key.upstream_base_url || '\u2014') + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="flex items-center gap-2 flex-shrink-0 ml-4">' +
                    '<span class="text-xs text-gray-600 hidden sm:inline">' + formatDate(key.created_at) + '</span>' +
                    '<button type="button" data-action="open-rotate-key-modal" data-project-id="' + escapeHtml(projId) + '" data-key-id="' + escapeHtml(keyId) + '" data-provider="' + escapeHtml(key.provider || '') + '" class="px-2.5 py-1.5 text-xs text-indigo-400 hover:text-indigo-300 border border-indigo-900/50 hover:border-indigo-800 hover:bg-indigo-900/20 rounded-lg transition whitespace-nowrap flex items-center gap-1">' +
                      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>' +
                      'Rotate' +
                    '</button>' +
                    '<button type="button" data-action="confirm-delete-key" data-project-id="' + escapeHtml(projId) + '" data-key-id="' + escapeHtml(keyId) + '" data-provider="' + escapeHtml(key.provider || '') + '" class="px-2.5 py-1.5 text-xs text-red-400 hover:text-red-300 border border-red-900/50 hover:border-red-800 hover:bg-red-900/20 rounded-lg transition whitespace-nowrap flex items-center gap-1">' +
                      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
                      'Delete' +
                    '</button>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>';
          }
        }

        return '<div class="anim-card bg-card border border-border rounded-lg overflow-hidden hover:border-gray-600 transition-all duration-200 mb-4" style="animation-delay:' + delay + 'ms">' +
          // Project header
          '<div class="p-5 cursor-pointer" data-action="toggle-project" data-project-id="' + escapeHtml(projId) + '">' +
            '<div class="flex items-center justify-between">' +
              '<div class="flex items-center gap-3 min-w-0">' +
                '<div class="w-10 h-10 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center flex-shrink-0">' +
                  '<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>' +
                '</div>' +
                '<div class="min-w-0">' +
                  (name ? '<h3 class="font-semibold text-white text-base truncate">' + escapeHtml(name) + '</h3>' : '') +
                  '<div class="flex items-center gap-2 mt-0.5">' +
                    '<code class="text-xs font-mono text-indigo-400">' + escapeHtml(vpProjId) + '</code>' +
                    '<button type="button" data-action="copy-text" data-text="' + escapeHtml(vpProjId) + '" class="text-gray-500 hover:text-gray-300 transition p-0.5" title="Copy project ID">' +
                      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="flex items-center gap-3 flex-shrink-0">' +
                '<span class="text-xs text-gray-500">' + keys.length + ' key' + (keys.length !== 1 ? 's' : '') + '</span>' +
                '<span class="text-xs text-gray-600">Created ' + created + '</span>' +
                '<button type="button" data-action="open-add-key-modal" data-project-id="' + escapeHtml(projId) + '" class="p-1.5 text-gray-600 hover:text-indigo-400 transition rounded" title="Add key">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>' +
                '</button>' +
                '<button type="button" data-action="confirm-delete-project" data-project-id="' + escapeHtml(projId) + '" data-vp-proj-id="' + escapeHtml(vpProjId) + '" class="p-1.5 text-gray-600 hover:text-red-400 transition rounded" title="Delete project">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
                '</button>' +
                '<svg class="w-4 h-4 text-gray-500 transition-transform duration-200 ' + (isExpanded ? 'rotate-180' : '') + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>' +
              '</div>' +
            '</div>' +
          '</div>' +
          // Expandable keys section
          (isExpanded ? keysHtml : '') +
        '</div>';
      }).join('');
    }

    function toggleProject(projId) {
      if (expandedProjectId === projId) {
        expandedProjectId = null;
      } else {
        expandedProjectId = projId;
      }
      renderProjects();
    }

    // --- Delete project ---
    function confirmDeleteProject(projId, vpProjId) {
      showConfirm(
        'Delete Project',
        'Delete project ' + vpProjId + '? All keys in this project will be permanently revoked. Any apps using this project ID will stop working immediately. This cannot be undone.',
        'Delete Project',
        function() { deleteProject(projId); }
      );
    }

    async function deleteProject(projId) {
      try {
        var res = await apiFetch(API + '/projects/' + projId, { method: 'DELETE' });
        if (!res) return;
        if (!res.ok) {
          var data = await res.json().catch(function() { return {}; });
          showToast(data.error || 'Failed to delete project', 'error');
          return;
        }
        showToast('Project deleted', 'success');
        expandedProjectId = null;
        delete projectKeysMap[projId];
        loadProjects();
        loadStats();
      } catch (err) {
        showToast('Failed to delete project: ' + err.message, 'error');
      }
    }

    // --- Delete key ---
    function confirmDeleteKey(projId, keyId, provider) {
      var providerName = providerDisplayNames[(provider || '').toLowerCase()] || provider || 'this';
      showConfirm(
        'Delete Key',
        'Delete the ' + providerName + ' key? The encrypted shares will be permanently destroyed. You will need to run npx @vaultproof/init again to re-add this key. This cannot be undone.',
        'Delete Key',
        function() { deleteKey(projId, keyId); }
      );
    }

    async function deleteKey(projId, keyId) {
      try {
        var res = await apiFetch(API + '/projects/' + projId + '/keys/' + keyId, { method: 'DELETE' });
        if (!res) return;
        if (!res.ok) {
          var data = await res.json().catch(function() { return {}; });
          showToast(data.error || 'Failed to delete key', 'error');
          return;
        }
        showToast('Key deleted', 'success');
        loadProjectKeys(projId);
        loadStats();
      } catch (err) {
        showToast('Failed to delete key: ' + err.message, 'error');
      }
    }

    // --- Rotate key ---
    function openRotateKeyModal(projId, keyId, provider) {
      document.getElementById('rotateProjectId').value = projId;
      document.getElementById('rotateKeyId').value = keyId;
      document.getElementById('rotateKeyProvider').value = provider;
      document.getElementById('rotateModal').classList.remove('hidden');
      document.getElementById('rotateModal').classList.add('flex');
      document.getElementById('rotateNewKey').value = '';
      document.getElementById('rotateMsg').classList.add('hidden');
    }

    function closeRotateModal() {
      document.getElementById('rotateModal').classList.add('hidden');
      document.getElementById('rotateModal').classList.remove('flex');
      document.getElementById('rotateForm').reset();
      document.getElementById('rotateMsg').classList.add('hidden');
    }

    document.getElementById('rotateForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var msg = document.getElementById('rotateMsg');
      var btn = document.getElementById('rotateBtn');
      var projId = document.getElementById('rotateProjectId').value;
      var keyId = document.getElementById('rotateKeyId').value;
      var newKey = document.getElementById('rotateNewKey').value.trim();

      // Validate IDs
      projId = /^[a-f0-9-]+$/i.test(projId) ? projId : '';
      keyId = /^[a-f0-9-]+$/i.test(keyId) ? keyId : '';

      if (!projId || !keyId) {
        msg.textContent = 'Invalid project or key ID';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
        return;
      }
      if (!newKey) {
        msg.textContent = 'Please paste the new API key value';
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
        return;
      }
      msg.classList.add('hidden');
      btn.textContent = 'Splitting...';
      btn.disabled = true;

      try {
        // Split the new key client-side
        var shares = shamirSplit(new TextEncoder().encode(newKey), 2, 2);
        var share1 = shamirSerialize(shares[0]);
        var share2 = shamirSerialize(shares[1]);

        btn.textContent = 'Uploading...';

        var res = await apiFetch(API + '/projects/' + projId + '/keys/' + keyId + '/rotate', {
          method: 'PUT',
          body: JSON.stringify({ share1: share1, share2: share2 })
        });
        if (!res) {
          btn.textContent = 'Split & Rotate';
          btn.disabled = false;
          return;
        }
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to rotate key');

        showToast('Key rotated successfully', 'success');
        closeRotateModal();
        loadProjectKeys(projId);
      } catch (err) {
        msg.textContent = err.message;
        msg.className = 'text-sm text-amber-400';
        msg.classList.remove('hidden');
      } finally {
        btn.textContent = 'Split & Rotate';
        btn.disabled = false;
      }
    });

    // --- Provider config for dashboard key creation ---
    var PROVIDER_CONFIG = {
      openai: { upstream: 'https://api.openai.com', header: 'Authorization', template: 'Bearer {key}' },
      anthropic: { upstream: 'https://api.anthropic.com', header: 'x-api-key', template: '{key}', extra: { 'anthropic-version': '2023-06-01' } },
      stripe: { upstream: 'https://api.stripe.com', header: 'Authorization', template: 'Bearer {key}' },
      groq: { upstream: 'https://api.groq.com', header: 'Authorization', template: 'Bearer {key}' },
      mistral: { upstream: 'https://api.mistral.ai', header: 'Authorization', template: 'Bearer {key}' },
      together: { upstream: 'https://api.together.xyz', header: 'Authorization', template: 'Bearer {key}' },
      fireworks: { upstream: 'https://api.fireworks.ai', header: 'Authorization', template: 'Bearer {key}' },
      deepseek: { upstream: 'https://api.deepseek.com', header: 'Authorization', template: 'Bearer {key}' },
      xai: { upstream: 'https://api.x.ai', header: 'Authorization', template: 'Bearer {key}' },
      openrouter: { upstream: 'https://openrouter.ai', header: 'Authorization', template: 'Bearer {key}' },
      resend: { upstream: 'https://api.resend.com', header: 'Authorization', template: 'Bearer {key}' },
      sendgrid: { upstream: 'https://api.sendgrid.com', header: 'Authorization', template: 'Bearer {key}' },
      linear: { upstream: 'https://api.linear.app', header: 'Authorization', template: '{key}' },
      notion: { upstream: 'https://api.notion.com', header: 'Authorization', template: 'Bearer {key}', extra: { 'Notion-Version': '2022-06-28' } },
      github: { upstream: 'https://api.github.com', header: 'Authorization', template: 'Bearer {key}' }
    };

    var DEFAULT_ENV_VARS = {
      openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', stripe: 'STRIPE_SECRET_KEY',
      groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', together: 'TOGETHER_API_KEY',
      fireworks: 'FIREWORKS_API_KEY', deepseek: 'DEEPSEEK_API_KEY', xai: 'XAI_API_KEY',
      openrouter: 'OPENROUTER_API_KEY', resend: 'RESEND_API_KEY', sendgrid: 'SENDGRID_API_KEY',
      linear: 'LINEAR_API_KEY', notion: 'NOTION_API_KEY', github: 'GITHUB_TOKEN'
    };

    // Detection patterns — ordered most-specific-first (same as providers.json)
    var KEY_PATTERNS = [
      { id: 'anthropic', label: 'Anthropic', re: /^sk-ant-api\d{2}-[A-Za-z0-9_-]{80,}$/ },
      { id: 'groq', label: 'Groq', re: /^gsk_[A-Za-z0-9]{40,}$/ },
      { id: 'xai', label: 'xAI (Grok)', re: /^xai-[A-Za-z0-9]{40,}$/ },
      { id: 'openrouter', label: 'OpenRouter', re: /^sk-or-v1-[A-Za-z0-9]{40,}$/ },
      { id: 'fireworks', label: 'Fireworks AI', re: /^fw_[A-Za-z0-9]{24,}$/ },
      { id: 'resend', label: 'Resend', re: /^re_[A-Za-z0-9_]{24,}$/ },
      { id: 'sendgrid', label: 'SendGrid', re: /^SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/ },
      { id: 'linear', label: 'Linear', re: /^lin_api_[A-Za-z0-9]{32,}$/ },
      { id: 'notion', label: 'Notion', re: /^(?:secret_|ntn_)[A-Za-z0-9]{40,}$/ },
      { id: 'github', label: 'GitHub', re: /^(?:ghp_|github_pat_|ghs_|gho_|ghu_)[A-Za-z0-9_]{36,}$/ },
      { id: 'stripe', label: 'Stripe', re: /^sk_(?:live|test)_[A-Za-z0-9]{20,}$/ },
      { id: 'openai', label: 'OpenAI', re: /^sk-(?:proj-[A-Za-z0-9_-]{20,}|[A-Za-z0-9]{48,})$/ },
    ];

    function detectProvider(value) {
      for (var i = 0; i < KEY_PATTERNS.length; i++) {
        if (KEY_PATTERNS[i].re.test(value)) return KEY_PATTERNS[i];
      }
      return null;
    }

    // Auto-detect provider when key is pasted
    document.getElementById('addKeyValue').addEventListener('input', function() {
      var value = this.value.trim();
      var detected = detectProvider(value);
      var detectedEl = document.getElementById('addKeyDetected');
      var labelEl = document.getElementById('addKeyDetectedLabel');
      var providerSelect = document.getElementById('addKeyProvider');
      var envInput = document.getElementById('addKeyEnvVar');

      if (detected) {
        detectedEl.classList.remove('hidden');
        labelEl.textContent = 'Detected: ' + detected.label;
        providerSelect.value = detected.id;
        if (!envInput.value || Object.values(DEFAULT_ENV_VARS).includes(envInput.value)) {
          envInput.value = DEFAULT_ENV_VARS[detected.id] || '';
        }
      } else if (value.length > 10) {
        detectedEl.classList.remove('hidden');
        labelEl.textContent = 'Provider not recognized — select manually below';
        labelEl.className = 'text-amber-400';
      } else {
        detectedEl.classList.add('hidden');
      }
    });

    // Also auto-fill env var when provider is manually selected
    document.getElementById('addKeyProvider').addEventListener('change', function() {
      var envInput = document.getElementById('addKeyEnvVar');
      if (!envInput.value || Object.values(DEFAULT_ENV_VARS).includes(envInput.value)) {
        envInput.value = DEFAULT_ENV_VARS[this.value] || '';
      }
    });

    // --- Create Project modal ---
    function openCreateProjectModal() {
      document.getElementById('newProjectName').value = '';
      document.getElementById('createProjectMsg').classList.add('hidden');
      document.getElementById('createProjectModal').classList.remove('hidden');
      document.getElementById('createProjectModal').classList.add('flex');
      document.getElementById('newProjectName').focus();
    }

    function closeCreateProjectModal() {
      document.getElementById('createProjectModal').classList.add('hidden');
      document.getElementById('createProjectModal').classList.remove('flex');
    }

    document.getElementById('createProjectForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('createProjectBtn');
      btn.disabled = true; btn.textContent = 'Creating...';
      try {
        var name = document.getElementById('newProjectName').value.trim();
        var res = await apiFetch(API + '/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name || undefined })
        });
        if (!res) { btn.disabled = false; btn.textContent = 'Create Project'; return; }
        if (!res.ok) throw new Error((await res.json().catch(function() { return {}; })).error || 'Failed');
        var data = await res.json();
        closeCreateProjectModal();
        showToast('Project ' + data.vp_proj_id + ' created', 'success');
        loadProjects();
        loadStats();
      } catch(err) {
        document.getElementById('createProjectMsg').textContent = err.message;
        document.getElementById('createProjectMsg').className = 'text-sm text-red-400';
        document.getElementById('createProjectMsg').classList.remove('hidden');
      } finally {
        btn.disabled = false; btn.textContent = 'Create Project';
      }
    });

    // --- Add Key modal ---
    function openAddKeyModal(projectId) {
      document.getElementById('addKeyProjectId').value = projectId;
      document.getElementById('addKeyProvider').value = '';
      document.getElementById('addKeyEnvVar').value = '';
      document.getElementById('addKeyValue').value = '';
      document.getElementById('addKeyMsg').classList.add('hidden');
      document.getElementById('addKeyModal').classList.remove('hidden');
      document.getElementById('addKeyModal').classList.add('flex');
    }

    function closeAddKeyModal() {
      document.getElementById('addKeyModal').classList.add('hidden');
      document.getElementById('addKeyModal').classList.remove('flex');
      document.getElementById('addKeyValue').value = '';
    }

    document.getElementById('addKeyForm').addEventListener('submit', async function(e) {
      e.preventDefault();
      var btn = document.getElementById('addKeyBtn');
      btn.disabled = true; btn.textContent = 'Splitting...';
      try {
        var projectId = document.getElementById('addKeyProjectId').value;
        var provider = document.getElementById('addKeyProvider').value;
        var envVar = document.getElementById('addKeyEnvVar').value.trim();
        var keyValue = document.getElementById('addKeyValue').value;
        if (!provider) throw new Error('Select a provider');
        if (!keyValue) throw new Error('Paste an API key');
        var config = PROVIDER_CONFIG[provider];
        if (!config) throw new Error('Unknown provider');
        // Shamir split
        var shares = shamirSplit(new TextEncoder().encode(keyValue), 2, 2);
        var share1 = shamirSerialize(shares[0]);
        var share2 = shamirSerialize(shares[1]);
        var body = {
          provider: provider,
          slug: provider,
          share1: share1,
          share2: share2,
          env_var: envVar || DEFAULT_ENV_VARS[provider] || '',
          upstream_base_url: config.upstream,
          auth_header_name: config.header,
          auth_header_template: config.template
        };
        if (config.extra) body.extra_headers = config.extra;
        var res = await apiFetch(API + '/projects/' + projectId + '/keys', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res) { btn.disabled = false; btn.textContent = 'Split & Protect'; return; }
        if (!res.ok) throw new Error((await res.json().catch(function() { return {}; })).error || 'Failed');
        closeAddKeyModal();
        showToast((envVar || provider) + ' protected via Shamir splitting', 'success');
        loadProjectKeys(projectId);
        loadStats();
      } catch(err) {
        document.getElementById('addKeyMsg').textContent = err.message;
        document.getElementById('addKeyMsg').className = 'text-sm text-red-400';
        document.getElementById('addKeyMsg').classList.remove('hidden');
      } finally {
        btn.disabled = false; btn.textContent = 'Split & Protect';
      }
    });

    // --- CSP-safe click handlers (replace inline onclick attributes) ---
    document.addEventListener('click', function(event) {
      var actionEl = event.target.closest('[data-action]');
      if (!actionEl) return;

      var action = actionEl.getAttribute('data-action');
      if (!action) return;

      if (action === 'toggle-mobile-sidebar') {
        toggleMobileSidebar();
        return;
      }
      if (action === 'close-create-project-modal') {
        closeCreateProjectModal();
        return;
      }
      if (action === 'close-add-key-modal') {
        closeAddKeyModal();
        return;
      }
      if (action === 'close-rotate-modal') {
        closeRotateModal();
        return;
      }
      if (action === 'close-confirm-modal') {
        closeConfirmModal();
        return;
      }
      if (action === 'execute-confirm') {
        executeConfirm();
        return;
      }
      if (action === 'close-toast') {
        document.getElementById('toast').classList.add('hidden');
        return;
      }
      if (action === 'dismiss-init-tip') {
        var tip = document.getElementById('initTip');
        if (tip) tip.remove();
        return;
      }
      if (action === 'open-create-project-modal') {
        openCreateProjectModal();
        return;
      }
      if (action === 'copy-text') {
        copyText(actionEl.getAttribute('data-text') || '');
        return;
      }
      if (action === 'retry-load-projects') {
        loadProjects();
        return;
      }
      if (action === 'toggle-project') {
        var toggleProjectId = actionEl.getAttribute('data-project-id') || '';
        if (toggleProjectId) toggleProject(toggleProjectId);
        return;
      }
      if (action === 'open-add-key-modal') {
        var addProjectId = actionEl.getAttribute('data-project-id') || '';
        if (addProjectId) openAddKeyModal(addProjectId);
        return;
      }
      if (action === 'open-rotate-key-modal') {
        var rotateProjectId = actionEl.getAttribute('data-project-id') || '';
        var rotateKeyId = actionEl.getAttribute('data-key-id') || '';
        var rotateProvider = actionEl.getAttribute('data-provider') || '';
        if (rotateProjectId && rotateKeyId) openRotateKeyModal(rotateProjectId, rotateKeyId, rotateProvider);
        return;
      }
      if (action === 'confirm-delete-key') {
        var deleteKeyProjectId = actionEl.getAttribute('data-project-id') || '';
        var deleteKeyId = actionEl.getAttribute('data-key-id') || '';
        var deleteProvider = actionEl.getAttribute('data-provider') || '';
        if (deleteKeyProjectId && deleteKeyId) confirmDeleteKey(deleteKeyProjectId, deleteKeyId, deleteProvider);
        return;
      }
      if (action === 'confirm-delete-project') {
        var deleteProjectId = actionEl.getAttribute('data-project-id') || '';
        var deleteVpProjId = actionEl.getAttribute('data-vp-proj-id') || '';
        if (deleteProjectId) confirmDeleteProject(deleteProjectId, deleteVpProjId);
      }
    });

    // --- Initialize ---
    loadProjects();
    loadStats();
