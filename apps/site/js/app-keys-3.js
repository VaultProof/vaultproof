(function() {
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
    const session = window.VaultProofSession;
    let token = (session && session.getAccessToken())
      || localStorage.getItem('vaultproof_token');
    const user = (session && session.getUser())
      || JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
    let _refreshAttempted = false;
    let _refreshPromise = null;

    if (!token && !(session && session.hasRefreshToken())) {
      window.location.href = 'login';
    }

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

    // --- UI helpers ---
    function showToast(message, type = 'error') {
      const toast = document.getElementById('toast');
      const inner = document.getElementById('toastInner');
      const msg = document.getElementById('toastMsg');
      msg.textContent = message;
      const styles = {
        success: 'toast-success',
        error: 'toast-error',
        warning: 'toast-warning',
        info: 'toast-info'
      };
      inner.className = 'toast-card ' + (styles[type] || styles.error);
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
    const userEmail = document.getElementById('user-email');
    if (userEmail) userEmail.textContent = user.email || 'unknown user';
    document.getElementById('menuBtn').addEventListener('click', toggleMobileSidebar);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);

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
      deepl:       { badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-300' },
      'deepl-pro': { badge: 'bg-green-500/10 text-green-300 border-green-500/20', dot: 'bg-green-300' },
      xai:         { badge: 'bg-gray-500/10 text-gray-300 border-gray-500/20', dot: 'bg-gray-300' },
      openrouter:  { badge: 'bg-violet-500/10 text-violet-400 border-violet-500/20', dot: 'bg-violet-400' },
      resend:      { badge: 'bg-teal-500/10 text-teal-400 border-teal-500/20', dot: 'bg-teal-400' },
      sendgrid:    { badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', dot: 'bg-blue-400' },
      linear:      { badge: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20', dot: 'bg-indigo-400' },
      notion:      { badge: 'bg-gray-500/10 text-gray-300 border-gray-500/20', dot: 'bg-gray-300' },
      github:      { badge: 'bg-gray-500/10 text-gray-300 border-gray-500/20', dot: 'bg-gray-300' },
      minimax:     { badge: 'bg-rose-500/10 text-rose-300 border-rose-500/20', dot: 'bg-rose-300' },
      voyage:      { badge: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20', dot: 'bg-emerald-300' },
      jina:        { badge: 'bg-amber-500/10 text-amber-300 border-amber-500/20', dot: 'bg-amber-300' },
      ai21:        { badge: 'bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20', dot: 'bg-fuchsia-300' },
      assemblyai:  { badge: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20', dot: 'bg-cyan-300' },
      gitlab:      { badge: 'bg-orange-500/10 text-orange-300 border-orange-500/20', dot: 'bg-orange-300' },
      launchdarkly:{ badge: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20', dot: 'bg-yellow-300' },
      snyk:        { badge: 'bg-violet-500/10 text-violet-300 border-violet-500/20', dot: 'bg-violet-300' },
      pagerduty:   { badge: 'bg-lime-500/10 text-lime-300 border-lime-500/20', dot: 'bg-lime-300' },
      honeycomb:   { badge: 'bg-orange-500/10 text-orange-300 border-orange-500/20', dot: 'bg-orange-300' },
    };

    const providerDisplayNames = {
      openai: 'OpenAI', anthropic: 'Anthropic', stripe: 'Stripe', groq: 'Groq',
      mistral: 'Mistral', together: 'Together', fireworks: 'Fireworks', deepseek: 'DeepSeek',
      deepl: 'DeepL API Free', 'deepl-pro': 'DeepL API Pro',
      xai: 'xAI', openrouter: 'OpenRouter', resend: 'Resend', sendgrid: 'SendGrid',
      linear: 'Linear', notion: 'Notion', github: 'GitHub', minimax: 'MiniMax',
      voyage: 'Voyage AI', jina: 'Jina AI', ai21: 'AI21', assemblyai: 'AssemblyAI',
      gitlab: 'GitLab', launchdarkly: 'LaunchDarkly', snyk: 'Snyk',
      pagerduty: 'PagerDuty', honeycomb: 'Honeycomb',
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
        var res = await apiFetch(API + '/projects/stats/overview');
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
        container.innerHTML = '<div class="load-error"><div class="load-error-title">Unable to load VaultProof tokens</div><button type="button" data-action="retry-load-projects" class="btn btn-outline">retry</button></div>';
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
            keysHtml = '<div class="keys-empty">' +
              '<p class="text-sm text-gray-500">No keys attached to this token yet.</p>' +
              '<p class="text-xs text-gray-600 mt-2">Install the CLI from <code class="text-indigo-400 font-mono">vaultproof.dev/install</code>, then run <code class="text-indigo-400 font-mono">vaultproof-init</code>, or</p>' +
              '<button type="button" data-action="open-add-key-modal" data-project-id="' + escapeHtml(projId) + '" class="keys-add-empty">Add a key manually</button>' +
            '</div>';
          } else {
            keysHtml = '<div class="keys-list">' +
              keys.map(function(key) {
                var keyId = key.id || '';
                keyId = /^[a-f0-9-]+$/i.test(keyId) ? keyId : '';
                var envVarName = key.env_var || key.slug || (key.provider ? key.provider.toUpperCase() + '_API_KEY' : '\u2014');
                return '<div class="keys-key-row">' +
                  '<div class="keys-key-main">' +
                    providerBadge(key.provider) +
                    '<div class="keys-key-copy">' +
                      '<div class="keys-key-title">' + escapeHtml(envVarName) + '</div>' +
                      '<div class="keys-key-url">' + escapeHtml(key.upstream_base_url || '\u2014') + '</div>' +
                    '</div>' +
                  '</div>' +
                  '<div class="keys-key-actions">' +
                    '<span class="keys-key-date">' + formatDate(key.created_at) + '</span>' +
                    '<button type="button" data-action="open-rotate-key-modal" data-project-id="' + escapeHtml(projId) + '" data-key-id="' + escapeHtml(keyId) + '" data-provider="' + escapeHtml(key.provider || '') + '" class="keys-row-action">' +
                      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>' +
                      'Rotate' +
                    '</button>' +
                    '<button type="button" data-action="confirm-delete-key" data-project-id="' + escapeHtml(projId) + '" data-key-id="' + escapeHtml(keyId) + '" data-provider="' + escapeHtml(key.provider || '') + '" class="keys-row-action keys-row-danger">' +
                      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>' +
                      'Delete' +
                    '</button>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>';
          }
        }

        return '<div class="keys-project-card anim-card" style="animation-delay:' + delay + 'ms">' +
          // Project header
          '<div class="keys-project-header" data-action="toggle-project" data-project-id="' + escapeHtml(projId) + '">' +
            '<div class="keys-project-layout">' +
              '<div class="keys-project-main">' +
                '<div class="keys-project-icon">' +
                  '<svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>' +
                '</div>' +
                '<div class="keys-project-copy">' +
                  (name ? '<h3 class="keys-project-title">' + escapeHtml(name) + '</h3>' : '') +
                  '<div class="keys-project-id-row">' +
                    '<code class="keys-project-code">' + escapeHtml(vpProjId) + '</code>' +
                    '<button type="button" data-action="copy-text" data-text="' + escapeHtml(vpProjId) + '" class="keys-icon-button" title="Copy VaultProof token">' +
                      '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>' +
                    '</button>' +
                  '</div>' +
                '</div>' +
              '</div>' +
              '<div class="keys-project-actions">' +
                '<span class="keys-count-pill">' + keys.length + ' key' + (keys.length !== 1 ? 's' : '') + '</span>' +
                '<span class="keys-created">Created ' + created + '</span>' +
                '<button type="button" data-action="open-add-key-modal" data-project-id="' + escapeHtml(projId) + '" class="keys-icon-button" title="Add key">' +
                  '<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/></svg>' +
                '</button>' +
                '<button type="button" data-action="confirm-delete-project" data-project-id="' + escapeHtml(projId) + '" data-vp-proj-id="' + escapeHtml(vpProjId) + '" class="keys-icon-button keys-icon-danger" title="Delete token">' +
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
        'Delete VaultProof Token',
        'Delete VaultProof token ' + vpProjId + '? All keys attached to this token will be permanently revoked. Any apps using this token will stop working immediately. This cannot be undone.',
        'Delete Token',
        function() { deleteProject(projId); }
      );
    }

    async function deleteProject(projId) {
      try {
        var res = await apiFetch(API + '/projects/' + projId, { method: 'DELETE' });
        if (!res) return;
        if (!res.ok) {
          var data = await res.json().catch(function() { return {}; });
          showToast(data.error || 'Failed to delete token', 'error');
          return;
        }
        showToast('VaultProof token deleted', 'success');
        expandedProjectId = null;
        delete projectKeysMap[projId];
        loadProjects();
        loadStats();
      } catch (err) {
        showToast('Failed to delete token: ' + err.message, 'error');
      }
    }

    // --- Delete key ---
    function confirmDeleteKey(projId, keyId, provider) {
      var providerName = providerDisplayNames[(provider || '').toLowerCase()] || provider || 'this';
      showConfirm(
        'Delete Key',
        'Delete the ' + providerName + ' key? The encrypted shares will be permanently destroyed. You will need to run vaultproof-init again to re-add this key. This cannot be undone.',
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
      var share1 = '';
      var share2 = '';

      // Validate IDs
      projId = /^[a-f0-9-]+$/i.test(projId) ? projId : '';
      keyId = /^[a-f0-9-]+$/i.test(keyId) ? keyId : '';

      if (!projId || !keyId) {
        msg.textContent = 'Invalid token or key ID';
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
        share1 = shamirSerialize(shares[0]);
        share2 = shamirSerialize(shares[1]);

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
        newKey = '';
        share1 = '';
        share2 = '';
        document.getElementById('rotateNewKey').value = '';
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
      deepl: { upstream: 'https://api-free.deepl.com', header: 'Authorization', template: 'DeepL-Auth-Key {key}' },
      'deepl-pro': { upstream: 'https://api.deepl.com', header: 'Authorization', template: 'DeepL-Auth-Key {key}' },
      xai: { upstream: 'https://api.x.ai', header: 'Authorization', template: 'Bearer {key}' },
      openrouter: { upstream: 'https://openrouter.ai', header: 'Authorization', template: 'Bearer {key}' },
      digitalocean: { upstream: 'https://api.digitalocean.com', header: 'Authorization', template: 'Bearer {key}' },
      netlify: { upstream: 'https://api.netlify.com', header: 'Authorization', template: 'Bearer {key}' },
      render: { upstream: 'https://api.render.com', header: 'Authorization', template: 'Bearer {key}' },
      heroku: { upstream: 'https://api.heroku.com', header: 'Authorization', template: 'Bearer {key}', extra: { Accept: 'application/vnd.heroku+json; version=3' } },
      fastly: { upstream: 'https://api.fastly.com', header: 'Fastly-Key', template: '{key}' },
      'terraform-cloud': { upstream: 'https://app.terraform.io', header: 'Authorization', template: 'Bearer {key}' },
      pulumi: { upstream: 'https://api.pulumi.com', header: 'Authorization', template: 'token {key}', extra: { Accept: 'application/vnd.pulumi+8', 'Content-Type': 'application/json' } },
      'npm-registry': { upstream: 'https://registry.npmjs.org', header: 'Authorization', template: 'Bearer {key}' },
      turso: { upstream: 'https://api.turso.tech', header: 'Authorization', template: 'Bearer {key}' },
      railway: { upstream: 'https://backboard.railway.com/graphql/v2', header: 'Authorization', template: 'Bearer {key}' },
      fly: { upstream: 'https://api.machines.dev', header: 'Authorization', template: 'Bearer {key}' },
      circleci: { upstream: 'https://circleci.com/api/v2', header: 'Circle-Token', template: '{key}' },
      buildkite: { upstream: 'https://api.buildkite.com/v2', header: 'Authorization', template: 'Bearer {key}' },
      semgrep: { upstream: 'https://semgrep.dev/api', header: 'Authorization', template: 'Bearer {key}' },
      sonarcloud: { upstream: 'https://sonarcloud.io', header: 'Authorization', template: 'Bearer {key}' },
      betterstack: { upstream: 'https://uptime.betterstack.com/api/v2', header: 'Authorization', template: 'Bearer {key}' },
      logsnag: { upstream: 'https://api.logsnag.com', header: 'Authorization', template: 'Bearer {key}' },
      raygun: { upstream: 'https://api.raygun.com', header: 'Authorization', template: 'Bearer {key}' },
      doppler: { upstream: 'https://api.doppler.com', header: 'Authorization', template: 'Bearer {key}' },
      plausible: { upstream: 'https://plausible.io', header: 'Authorization', template: 'Bearer {key}' },
      webflow: { upstream: 'https://api.webflow.com', header: 'Authorization', template: 'Bearer {key}' },
      svix: { upstream: 'https://api.svix.com', header: 'Authorization', template: 'Bearer {key}' },
      knock: { upstream: 'https://api.knock.app', header: 'Authorization', template: 'Bearer {key}' },
      hume: { upstream: 'https://api.hume.ai', header: 'X-Hume-Api-Key', template: '{key}' },
      runpod: { upstream: 'https://rest.runpod.io/v1', header: 'Authorization', template: 'Bearer {key}' },
      browserbase: { upstream: 'https://api.browserbase.com', header: 'X-BB-API-Key', template: '{key}' },
      paystack: { upstream: 'https://api.paystack.co', header: 'Authorization', template: 'Bearer {key}' },
      lemonsqueezy: { upstream: 'https://api.lemonsqueezy.com', header: 'Authorization', template: 'Bearer {key}', extra: { Accept: 'application/vnd.api+json', 'Content-Type': 'application/vnd.api+json' } },
      figma: { upstream: 'https://api.figma.com', header: 'X-Figma-Token', template: '{key}' },
      asana: { upstream: 'https://app.asana.com', header: 'Authorization', template: 'Bearer {key}' },
      clickup: { upstream: 'https://api.clickup.com', header: 'Authorization', template: '{key}' },
      monday: { upstream: 'https://api.monday.com', header: 'Authorization', template: '{key}', extra: { 'Content-Type': 'application/json' } },
      todoist: { upstream: 'https://api.todoist.com', header: 'Authorization', template: 'Bearer {key}' },
      coda: { upstream: 'https://coda.io', header: 'Authorization', template: 'Bearer {key}' },
      shortcut: { upstream: 'https://api.app.shortcut.com', header: 'Shortcut-Token', template: '{key}' },
      klaviyo: { upstream: 'https://a.klaviyo.com', header: 'Authorization', template: 'Klaviyo-API-Key {key}', extra: { revision: '2025-04-15' } },
      iterable: { upstream: 'https://api.iterable.com', header: 'Api-Key', template: '{key}' },
      onesignal: { upstream: 'https://api.onesignal.com', header: 'Authorization', template: 'Key {key}' },
      novu: { upstream: 'https://api.novu.co', header: 'Authorization', template: 'ApiKey {key}' },
      opsgenie: { upstream: 'https://api.opsgenie.com', header: 'Authorization', template: 'GenieKey {key}' },
      statuspage: { upstream: 'https://api.statuspage.io', header: 'Authorization', template: 'OAuth {key}' },
      telnyx: { upstream: 'https://api.telnyx.com', header: 'Authorization', template: 'Bearer {key}' },
      messagebird: { upstream: 'https://rest.messagebird.com', header: 'Authorization', template: 'AccessKey {key}' },
      datocms: { upstream: 'https://site-api.datocms.com', header: 'Authorization', template: 'Bearer {key}', extra: { Accept: 'application/json', 'X-Api-Version': '3' } },
      storyblok: { upstream: 'https://mapi.storyblok.com', header: 'Authorization', template: '{key}' },
      linode: { upstream: 'https://api.linode.com', header: 'Authorization', template: 'Bearer {key}' },
      vultr: { upstream: 'https://api.vultr.com', header: 'Authorization', template: 'Bearer {key}' },
      hetzner: { upstream: 'https://api.hetzner.cloud', header: 'Authorization', template: 'Bearer {key}' },
      scaleway: { upstream: 'https://api.scaleway.com', header: 'X-Auth-Token', template: '{key}' },
      'brave-search': { upstream: 'https://api.search.brave.com', header: 'X-Subscription-Token', template: '{key}' },
      apify: { upstream: 'https://api.apify.com', header: 'Authorization', template: 'Bearer {key}' },
      flagsmith: { upstream: 'https://api.flagsmith.com', header: 'Authorization', template: 'Token {key}' },
      splitio: { upstream: 'https://api.split.io', header: 'Authorization', template: 'Bearer {key}' },
      'fal-ai': { upstream: 'https://fal.run', header: 'Authorization', template: 'Key {key}' },
      serper: { upstream: 'https://google.serper.dev', header: 'X-API-KEY', template: '{key}' },
      axiom: { upstream: 'https://api.axiom.co', header: 'Authorization', template: 'Bearer {key}' },
      rollbar: { upstream: 'https://api.rollbar.com', header: 'X-Rollbar-Access-Token', template: '{key}' },
      bugsnag: { upstream: 'https://api.bugsnag.com', header: 'Authorization', template: 'token {key}', extra: { 'X-Version': '2' } },
      codecov: { upstream: 'https://codecov.io', header: 'Authorization', template: 'bearer {key}' },
      aiven: { upstream: 'https://api.aiven.io', header: 'Authorization', template: 'aivenv1 {key}' },
      cockroachdb: { upstream: 'https://cockroachlabs.cloud', header: 'Authorization', template: 'Bearer {key}' },
      'datastax-astra': { upstream: 'https://api.astra.datastax.com', header: 'Authorization', template: 'Bearer {key}' },
      mollie: { upstream: 'https://api.mollie.com', header: 'Authorization', template: 'Bearer {key}' },
      gocardless: { upstream: 'https://api.gocardless.com', header: 'Authorization', template: 'Bearer {key}', extra: { 'GoCardless-Version': '2015-07-06' } },
      mercadopago: { upstream: 'https://api.mercadopago.com', header: 'Authorization', template: 'Bearer {key}' },
      wise: { upstream: 'https://api.transferwise.com', header: 'Authorization', template: 'Bearer {key}' },
      shippo: { upstream: 'https://api.goshippo.com', header: 'Authorization', template: 'ShippoToken {key}' },
      shipengine: { upstream: 'https://api.shipengine.com', header: 'API-Key', template: '{key}' },
      front: { upstream: 'https://api2.frontapp.com', header: 'Authorization', template: 'Bearer {key}' },
      helpscout: { upstream: 'https://api.helpscout.net', header: 'Authorization', template: 'Bearer {key}' },
      calendly: { upstream: 'https://api.calendly.com', header: 'Authorization', template: 'Bearer {key}' },
      typeform: { upstream: 'https://api.typeform.com', header: 'Authorization', template: 'Bearer {key}' },
      productboard: { upstream: 'https://api.productboard.com', header: 'Authorization', template: 'Bearer {key}' },
      dropbox: { upstream: 'https://api.dropboxapi.com', header: 'Authorization', template: 'Bearer {key}' },
      box: { upstream: 'https://api.box.com', header: 'Authorization', template: 'Bearer {key}' },
      pinata: { upstream: 'https://api.pinata.cloud', header: 'Authorization', template: 'Bearer {key}' },
      deepinfra: { upstream: 'https://api.deepinfra.com', header: 'Authorization', template: 'Bearer {key}' },
      cartesia: { upstream: 'https://api.cartesia.ai', header: 'X-API-Key', template: '{key}' },
      unstructured: { upstream: 'https://api.unstructuredapp.io', header: 'unstructured-api-key', template: '{key}' },
      'luma-ai': { upstream: 'https://api.lumalabs.ai', header: 'Authorization', template: 'Bearer {key}' },
      portkey: { upstream: 'https://api.portkey.ai', header: 'x-portkey-api-key', template: '{key}' },
      braintrust: { upstream: 'https://api.braintrust.dev', header: 'Authorization', template: 'Bearer {key}' },
      edenai: { upstream: 'https://api.edenai.run', header: 'Authorization', template: 'Bearer {key}' },
      virustotal: { upstream: 'https://www.virustotal.com', header: 'x-apikey', template: '{key}' },
      ipinfo: { upstream: 'https://api.ipinfo.io', header: 'Authorization', template: 'Bearer {key}' },
      apollo: { upstream: 'https://api.apollo.io', header: 'X-Api-Key', template: '{key}' },
      buttondown: { upstream: 'https://api.buttondown.com', header: 'Authorization', template: 'Token {key}' },
      'coinbase-commerce': { upstream: 'https://api.commerce.coinbase.com', header: 'X-CC-Api-Key', template: '{key}' },
      lokalise: { upstream: 'https://api.lokalise.com', header: 'X-Api-Token', template: '{key}' },
      crowdin: { upstream: 'https://api.crowdin.com', header: 'Authorization', template: 'Bearer {key}' },
      bunny: { upstream: 'https://api.bunny.net', header: 'AccessKey', template: '{key}' },
      prerender: { upstream: 'https://service.prerender.io', header: 'X-Prerender-Token', template: '{key}' },
      sambanova: { upstream: 'https://api.sambanova.ai', header: 'Authorization', template: 'Bearer {key}' },
      'nvidia-nim': { upstream: 'https://integrate.api.nvidia.com', header: 'Authorization', template: 'Bearer {key}' },
      friendli: { upstream: 'https://api.friendli.ai', header: 'Authorization', template: 'Bearer {key}' },
      hyperbolic: { upstream: 'https://api.hyperbolic.xyz', header: 'Authorization', template: 'Bearer {key}' },
      vapi: { upstream: 'https://api.vapi.ai', header: 'Authorization', template: 'Bearer {key}' },
      retell: { upstream: 'https://api.retellai.com', header: 'Authorization', template: 'Bearer {key}' },
      'rev-ai': { upstream: 'https://api.rev.ai/speechtotext/v1', header: 'Authorization', template: 'Bearer {key}' },
      speechmatics: { upstream: 'https://asr.api.speechmatics.com', header: 'Authorization', template: 'Bearer {key}' },
      gladia: { upstream: 'https://api.gladia.io', header: 'x-gladia-key', template: '{key}' },
      soniox: { upstream: 'https://api.soniox.com', header: 'Authorization', template: 'Bearer {key}' },
      'resemble-ai': { upstream: 'https://app.resemble.ai/api/v2', header: 'Authorization', template: 'Bearer {key}' },
      infobip: { upstream: 'https://api.infobip.com', header: 'Authorization', template: 'App {key}' },
      fauna: { upstream: 'https://db.fauna.com', header: 'Authorization', template: 'Bearer {key}' },
      zilliz: { upstream: 'https://api.cloud.zilliz.com', header: 'Authorization', template: 'Bearer {key}' },
      pipedream: { upstream: 'https://api.pipedream.com/v1', header: 'Authorization', template: 'Bearer {key}' },
      attio: { upstream: 'https://api.attio.com/v2', header: 'Authorization', template: 'Bearer {key}' },
      phrase: { upstream: 'https://api.phrase.com/v2', header: 'Authorization', template: 'token {key}' },
      transifex: { upstream: 'https://rest.api.transifex.com', header: 'Authorization', template: 'Bearer {key}' },
      revenuecat: { upstream: 'https://api.revenuecat.com', header: 'Authorization', template: 'Bearer {key}' },
      qovery: { upstream: 'https://api.qovery.com', header: 'Authorization', template: 'Token {key}' },
      northflank: { upstream: 'https://api.northflank.com/v1', header: 'Authorization', template: 'Bearer {key}' },
      koyeb: { upstream: 'https://app.koyeb.com/v1', header: 'Authorization', template: 'Bearer {key}' },
      'deno-deploy': { upstream: 'https://api.deno.com/v1', header: 'Authorization', template: 'Bearer {key}' },
      resend: { upstream: 'https://api.resend.com', header: 'Authorization', template: 'Bearer {key}' },
      sendgrid: { upstream: 'https://api.sendgrid.com', header: 'Authorization', template: 'Bearer {key}' },
      linear: { upstream: 'https://api.linear.app', header: 'Authorization', template: '{key}' },
      notion: { upstream: 'https://api.notion.com', header: 'Authorization', template: 'Bearer {key}', extra: { 'Notion-Version': '2022-06-28' } },
      github: { upstream: 'https://api.github.com', header: 'Authorization', template: 'Bearer {key}' },
      minimax: { upstream: 'https://api.minimax.io', header: 'Authorization', template: 'Bearer {key}' },
      voyage: { upstream: 'https://api.voyageai.com', header: 'Authorization', template: 'Bearer {key}' },
      jina: { upstream: 'https://api.jina.ai', header: 'Authorization', template: 'Bearer {key}' },
      ai21: { upstream: 'https://api.ai21.com', header: 'Authorization', template: 'Bearer {key}' },
      assemblyai: { upstream: 'https://api.assemblyai.com', header: 'Authorization', template: '{key}' },
      gitlab: { upstream: 'https://gitlab.com', header: 'PRIVATE-TOKEN', template: '{key}' },
      launchdarkly: { upstream: 'https://app.launchdarkly.com', header: 'Authorization', template: '{key}' },
      snyk: { upstream: 'https://api.snyk.io', header: 'Authorization', template: 'token {key}' },
      pagerduty: { upstream: 'https://api.pagerduty.com', header: 'Authorization', template: 'Token token={key}' },
      honeycomb: { upstream: 'https://api.honeycomb.io', header: 'X-Honeycomb-Team', template: '{key}' }
    };

    var DEFAULT_ENV_VARS = {
      openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', stripe: 'STRIPE_SECRET_KEY',
      groq: 'GROQ_API_KEY', mistral: 'MISTRAL_API_KEY', together: 'TOGETHER_API_KEY',
      fireworks: 'FIREWORKS_API_KEY', deepseek: 'DEEPSEEK_API_KEY', xai: 'XAI_API_KEY',
      deepl: 'DEEPL_API_KEY', 'deepl-pro': 'DEEPL_API_KEY',
      openrouter: 'OPENROUTER_API_KEY', digitalocean: 'DIGITALOCEAN_TOKEN',
      netlify: 'NETLIFY_AUTH_TOKEN', render: 'RENDER_API_KEY', heroku: 'HEROKU_API_KEY',
      fastly: 'FASTLY_API_TOKEN', 'terraform-cloud': 'TERRAFORM_CLOUD_TOKEN',
      pulumi: 'PULUMI_ACCESS_TOKEN', 'npm-registry': 'NPM_TOKEN',
      turso: 'TURSO_API_TOKEN', railway: 'RAILWAY_API_TOKEN', fly: 'FLY_API_TOKEN',
      circleci: 'CIRCLE_TOKEN', buildkite: 'BUILDKITE_API_TOKEN',
      semgrep: 'SEMGREP_APP_TOKEN', sonarcloud: 'SONAR_TOKEN',
      betterstack: 'BETTERSTACK_API_TOKEN', logsnag: 'LOGSNAG_API_TOKEN',
      raygun: 'RAYGUN_PAT', doppler: 'DOPPLER_TOKEN',
      plausible: 'PLAUSIBLE_API_KEY', webflow: 'WEBFLOW_API_TOKEN',
      svix: 'SVIX_AUTH_TOKEN', knock: 'KNOCK_API_KEY', hume: 'HUME_API_KEY',
      runpod: 'RUNPOD_API_KEY', browserbase: 'BROWSERBASE_API_KEY',
      paystack: 'PAYSTACK_SECRET_KEY', lemonsqueezy: 'LEMONSQUEEZY_API_KEY',
      figma: 'FIGMA_TOKEN', asana: 'ASANA_ACCESS_TOKEN', clickup: 'CLICKUP_API_TOKEN',
      monday: 'MONDAY_API_KEY', todoist: 'TODOIST_API_TOKEN', coda: 'CODA_API_TOKEN',
      shortcut: 'SHORTCUT_API_TOKEN', klaviyo: 'KLAVIYO_PRIVATE_API_KEY',
      iterable: 'ITERABLE_API_KEY', onesignal: 'ONESIGNAL_REST_API_KEY',
      novu: 'NOVU_SECRET_KEY', opsgenie: 'OPSGENIE_API_KEY',
      statuspage: 'STATUSPAGE_API_KEY', telnyx: 'TELNYX_API_KEY',
      messagebird: 'MESSAGEBIRD_ACCESS_KEY', datocms: 'DATOCMS_API_TOKEN',
      storyblok: 'STORYBLOK_PERSONAL_TOKEN', linode: 'LINODE_TOKEN',
      vultr: 'VULTR_API_KEY', hetzner: 'HCLOUD_TOKEN', scaleway: 'SCW_SECRET_KEY',
      'brave-search': 'BRAVE_SEARCH_API_KEY', apify: 'APIFY_TOKEN',
      flagsmith: 'FLAGSMITH_API_KEY', splitio: 'SPLIT_API_KEY',
      'fal-ai': 'FAL_KEY', serper: 'SERPER_API_KEY', axiom: 'AXIOM_TOKEN',
      rollbar: 'ROLLBAR_ACCESS_TOKEN', bugsnag: 'BUGSNAG_AUTH_TOKEN',
      codecov: 'CODECOV_TOKEN', aiven: 'AIVEN_TOKEN',
      cockroachdb: 'COCKROACHDB_CLOUD_API_KEY',
      'datastax-astra': 'ASTRA_DB_APPLICATION_TOKEN', mollie: 'MOLLIE_API_KEY',
      gocardless: 'GOCARDLESS_ACCESS_TOKEN', mercadopago: 'MERCADOPAGO_ACCESS_TOKEN',
      wise: 'WISE_API_TOKEN', shippo: 'SHIPPO_API_TOKEN',
      shipengine: 'SHIPENGINE_API_KEY', front: 'FRONT_API_TOKEN',
      helpscout: 'HELPSCOUT_ACCESS_TOKEN', calendly: 'CALENDLY_ACCESS_TOKEN',
      typeform: 'TYPEFORM_PERSONAL_TOKEN', productboard: 'PRODUCTBOARD_ACCESS_TOKEN',
      dropbox: 'DROPBOX_ACCESS_TOKEN', box: 'BOX_ACCESS_TOKEN', pinata: 'PINATA_JWT',
      deepinfra: 'DEEPINFRA_API_KEY', cartesia: 'CARTESIA_API_KEY',
      unstructured: 'UNSTRUCTURED_API_KEY', 'luma-ai': 'LUMA_AGENTS_API_KEY',
      portkey: 'PORTKEY_API_KEY', braintrust: 'BRAINTRUST_API_KEY',
      edenai: 'EDENAI_API_KEY', virustotal: 'VIRUSTOTAL_API_KEY',
      ipinfo: 'IPINFO_TOKEN', apollo: 'APOLLO_API_KEY',
      buttondown: 'BUTTONDOWN_API_KEY', 'coinbase-commerce': 'COINBASE_COMMERCE_API_KEY',
      lokalise: 'LOKALISE_API_TOKEN', crowdin: 'CROWDIN_PERSONAL_TOKEN',
      bunny: 'BUNNY_API_KEY', prerender: 'PRERENDER_TOKEN',
      sambanova: 'SAMBANOVA_API_KEY', 'nvidia-nim': 'NVIDIA_API_KEY',
      friendli: 'FRIENDLI_TOKEN', hyperbolic: 'HYPERBOLIC_API_KEY',
      vapi: 'VAPI_API_KEY', retell: 'RETELL_API_KEY',
      'rev-ai': 'REVAI_ACCESS_TOKEN', speechmatics: 'SPEECHMATICS_API_KEY',
      gladia: 'GLADIA_API_KEY', soniox: 'SONIOX_API_KEY',
      'resemble-ai': 'RESEMBLE_API_KEY', infobip: 'INFOBIP_API_KEY',
      fauna: 'FAUNA_SECRET', zilliz: 'ZILLIZ_API_KEY',
      pipedream: 'PIPEDREAM_API_KEY', attio: 'ATTIO_API_TOKEN',
      phrase: 'PHRASE_ACCESS_TOKEN', transifex: 'TRANSIFEX_API_TOKEN',
      revenuecat: 'REVENUECAT_SECRET_API_KEY', qovery: 'QOVERY_API_TOKEN',
      northflank: 'NORTHFLANK_API_TOKEN', koyeb: 'KOYEB_API_TOKEN',
      'deno-deploy': 'DENO_DEPLOY_TOKEN',
      resend: 'RESEND_API_KEY', sendgrid: 'SENDGRID_API_KEY',
      linear: 'LINEAR_API_KEY', notion: 'NOTION_API_KEY', github: 'GITHUB_TOKEN',
      minimax: 'MINIMAX_API_KEY', voyage: 'VOYAGE_API_KEY', jina: 'JINA_API_KEY',
      ai21: 'AI21_API_KEY', assemblyai: 'ASSEMBLYAI_API_KEY', gitlab: 'GITLAB_TOKEN',
      launchdarkly: 'LAUNCHDARKLY_ACCESS_TOKEN', snyk: 'SNYK_TOKEN',
      pagerduty: 'PAGERDUTY_API_KEY', honeycomb: 'HONEYCOMB_API_KEY'
    };

    // Detection patterns, ordered most-specific-first (same as providers.json)
    var KEY_PATTERNS = [
      { id: 'anthropic', label: 'Anthropic', re: /^sk-ant-api\d{2}-[A-Za-z0-9_-]{80,}$/ },
      { id: 'groq', label: 'Groq', re: /^gsk_[A-Za-z0-9]{40,}$/ },
      { id: 'xai', label: 'xAI (Grok)', re: /^xai-[A-Za-z0-9]{40,}$/ },
      { id: 'openrouter', label: 'OpenRouter', re: /^sk-or-v1-[A-Za-z0-9]{40,}$/ },
      { id: 'deepl', label: 'DeepL API Free', re: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:fx$/ },
      { id: 'deepl-pro', label: 'DeepL API Pro', re: /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/ },
      { id: 'fireworks', label: 'Fireworks AI', re: /^fw_[A-Za-z0-9]{24,}$/ },
      { id: 'resend', label: 'Resend', re: /^re_[A-Za-z0-9_]{24,}$/ },
      { id: 'sendgrid', label: 'SendGrid', re: /^SG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}$/ },
      { id: 'linear', label: 'Linear', re: /^lin_api_[A-Za-z0-9]{32,}$/ },
      { id: 'notion', label: 'Notion', re: /^(?:secret_|ntn_)[A-Za-z0-9]{40,}$/ },
      { id: 'github', label: 'GitHub', re: /^(?:ghp_|github_pat_|ghs_|gho_|ghu_)[A-Za-z0-9_]{36,}$/ },
      { id: 'digitalocean', label: 'DigitalOcean', re: /^(?:dop|doo)_v1_[A-Za-z0-9]{40,}$/ },
      { id: 'heroku', label: 'Heroku', re: /^HRKU-[A-Za-z0-9._-]{20,}$/ },
      { id: 'npm-registry', label: 'npm Registry', re: /^npm_[A-Za-z0-9_-]{20,}$/ },
      { id: 'figma', label: 'Figma', re: /^figd_[A-Za-z0-9._-]{20,}$/ },
      { id: 'datastax-astra', label: 'DataStax Astra', re: /^AstraCS:[A-Za-z0-9._:-]{20,}$/ },
      { id: 'cartesia', label: 'Cartesia', re: /^sk_car_[A-Za-z0-9._:-]{20,}$/ },
      { id: 'friendli', label: 'FriendliAI', re: /^flp_[A-Za-z0-9._:-]{20,}$/ },
      { id: 'nvidia-nim', label: 'NVIDIA NIM', re: /^nvapi-[A-Za-z0-9._:-]{20,}$/ },
      { id: 'revenuecat', label: 'RevenueCat', re: /^(?:sk|atk)_[A-Za-z0-9._:-]{20,}$/ },
      { id: 'deno-deploy', label: 'Deno Deploy', re: /^ddo_[A-Za-z0-9._:-]{20,}$/ },
      { id: 'minimax', label: 'MiniMax', re: /^sk-cp-[A-Za-z0-9._-]{20,}$/ },
      { id: 'voyage', label: 'Voyage AI', re: /^pa-[A-Za-z0-9_-]{32,}$/ },
      { id: 'jina', label: 'Jina AI', re: /^jina_[A-Za-z0-9_-]{20,}$/ },
      { id: 'gitlab', label: 'GitLab', re: /^glpat-[A-Za-z0-9_-]{20,}$/ },
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
        labelEl.className = '';
        labelEl.textContent = 'Detected: ' + detected.label;
        providerSelect.value = detected.id;
        if (!envInput.value || Object.values(DEFAULT_ENV_VARS).includes(envInput.value)) {
          envInput.value = DEFAULT_ENV_VARS[detected.id] || '';
        }
      } else if (value.length > 10) {
        detectedEl.classList.remove('hidden');
        labelEl.textContent = 'Provider not recognized - select manually below';
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
      btn.disabled = true; btn.textContent = 'creating...';
      try {
        var name = document.getElementById('newProjectName').value.trim();
        var res = await apiFetch(API + '/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name || undefined })
        });
        if (!res) { btn.disabled = false; btn.textContent = 'create token'; return; }
        if (!res.ok) throw new Error((await res.json().catch(function() { return {}; })).error || 'Failed');
        var data = await res.json();
        closeCreateProjectModal();
        showToast('VaultProof token ' + data.vp_proj_id + ' created', 'success');
        loadProjects();
        loadStats();
      } catch(err) {
        document.getElementById('createProjectMsg').textContent = err.message;
        document.getElementById('createProjectMsg').className = 'text-sm text-red-400';
        document.getElementById('createProjectMsg').classList.remove('hidden');
      } finally {
        btn.disabled = false; btn.textContent = 'create token';
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
      var keyValue = '';
      var share1 = '';
      var share2 = '';
      try {
        var projectId = document.getElementById('addKeyProjectId').value;
        var provider = document.getElementById('addKeyProvider').value;
        var envVar = document.getElementById('addKeyEnvVar').value.trim();
        keyValue = document.getElementById('addKeyValue').value;
        if (!provider) throw new Error('Select a provider');
        if (!keyValue) throw new Error('Paste an API key');
        var config = PROVIDER_CONFIG[provider];
        if (!config) throw new Error('Unknown provider');
        // Shamir split
        var shares = shamirSplit(new TextEncoder().encode(keyValue), 2, 2);
        share1 = shamirSerialize(shares[0]);
        share2 = shamirSerialize(shares[1]);
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
        keyValue = '';
        share1 = '';
        share2 = '';
        document.getElementById('addKeyValue').value = '';
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
})();
