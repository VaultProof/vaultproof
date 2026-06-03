const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
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

    function showToast(message, type = 'error') {
      const toast = document.getElementById('toast');
      const inner = document.getElementById('toastInner');
      const msg = document.getElementById('toastMsg');
      msg.textContent = message;
      const styles = {
        error: 'bg-red-900/80 border-red-800/50 text-red-200',
        warning: 'bg-yellow-900/80 border-yellow-800/50 text-yellow-200',
        info: 'bg-[#111118] border-[#1e1e2e] text-gray-300',
        success: 'bg-green-900/80 border-green-800/50 text-green-200'
      };
      inner.className = `flex items-center gap-3 px-4 py-3 rounded-xl border text-sm shadow-lg backdrop-blur-sm ${styles[type] || styles.error}`;
      toast.classList.remove('hidden');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => toast.classList.add('hidden'), 5000);
    }

    function showSessionExpired() {
      document.getElementById('sessionExpired').classList.remove('hidden');
    }

    function normalizeTier(value) {
      var tier = String(value || '').trim().toLowerCase();
      if (!tier) return 'free';
      if (tier.indexOf('enterprise') !== -1) return 'enterprise';
      if (tier.indexOf('team') !== -1) return 'team';
      if (tier.indexOf('pro') !== -1) return 'pro';
      if (tier.indexOf('starter') !== -1) return 'starter';
      if (tier.indexOf('free') !== -1) return 'free';
      return 'free';
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
          showToast('Rate limited — try again in a moment', 'warning');
          return null;
        }
        if (res.status >= 500) {
          showToast('Something went wrong on our end', 'error');
          return null;
        }
        return res;
      } catch (e) {
        showToast('Connection lost — check your internet', 'error');
        return null;
      }
    }

    async function safeJson(res) {
      try {
        return await res.json();
      } catch {
        return {};
      }
    }

    function formatTime(ts) {
      if (!ts) return '\u2014';
      var d = new Date(ts);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    function timeAgo(ts) {
      if (!ts) return '';
      var diff = Date.now() - new Date(ts).getTime();
      var mins = Math.floor(diff / 60000);
      if (mins < 1) return 'just now';
      if (mins < 60) return mins + 'm ago';
      var hrs = Math.floor(mins / 60);
      if (hrs < 24) return hrs + 'h ago';
      var days = Math.floor(hrs / 24);
      if (days < 30) return days + 'd ago';
      return Math.floor(days / 30) + 'mo ago';
    }

    // --- State management ---
    let allRepos = [];
    let currentScanId = null;
    let currentScanData = null;
    let ghConnected = false;
    let migrationResult = null;
    let userTier = 'free';

    const PLATFORM_INSTRUCTIONS = {
      'Vercel': 'Go to Vercel \u2192 Your Project \u2192 Settings \u2192 Environment Variables',
      'Railway': 'Go to Railway \u2192 Your Service \u2192 Variables',
      'Fly.io': 'Run: fly secrets set VAULTPROOF_PROJECT_ID=<your-project-id>',
      'Render': 'Go to Render \u2192 Your Service \u2192 Environment',
      'Netlify': 'Go to Netlify \u2192 Site settings \u2192 Environment variables',
      'Docker': 'Add -e VAULTPROOF_PROJECT_ID=<your-project-id> to your docker run command',
      'Docker Compose': 'Add VAULTPROOF_PROJECT_ID=<your-project-id> to your environment section',
      'Kubernetes': 'Create/update a Secret and map VAULTPROOF_PROJECT_ID + *_BASE_URL env vars in your Deployment',
      'Helm': 'Set VAULTPROOF_PROJECT_ID and *_BASE_URL in values.yaml, then template into env or Secret',
      'GitHub Actions': 'Go to GitHub \u2192 Your Repo \u2192 Settings \u2192 Secrets \u2192 Actions',
      'GitLab CI': 'Go to GitLab \u2192 Settings \u2192 CI/CD \u2192 Variables and add VAULTPROOF_PROJECT_ID + *_BASE_URL',
      'CircleCI': 'Go to Project Settings \u2192 Environment Variables and add VAULTPROOF_PROJECT_ID + *_BASE_URL',
      'Heroku': 'Run: heroku config:set VAULTPROOF_PROJECT_ID=<your-project-id>',
    };

    function showState(state) {
      document.getElementById('stateNotConnected').classList.toggle('hidden', state !== 'not-connected');
      document.getElementById('stateConnecting').classList.toggle('hidden', state !== 'connecting');
      document.getElementById('stateRepoList').classList.toggle('hidden', state !== 'repo-list');
      document.getElementById('stateScanResults').classList.toggle('hidden', state !== 'scan-results');
    }

    // --- GitHub Connect ---
    async function connectGitHub() {
      var res = await apiFetch(API + '/scanner/github/connect');
      if (!res) return;
      var data = await safeJson(res);
      if (!data.url) { showToast('Failed to get GitHub connect URL'); return; }
      // Validate URL — only allow GitHub OAuth URLs
      try {
        var parsed = new URL(data.url);
        if (parsed.hostname !== 'github.com') { showToast('Invalid redirect URL'); return; }
      } catch { showToast('Invalid redirect URL'); return; }
      window.location.href = data.url;
    }

    async function handleGitHubCallback(code, state) {
      if (!code || !state) { showToast('GitHub callback missing parameters'); return; }
      showState('connecting');
      var res = await apiFetch(API + '/scanner/github/callback', {
        method: 'POST',
        body: JSON.stringify({ code: code, state: state })
      });
      if (!res) { showState('not-connected'); return; }
      var data = await safeJson(res);
      if (res.ok) {
        ghConnected = true;
        showToast('GitHub connected successfully', 'success');
        loadRepoList();
      } else {
        showState('not-connected');
        showToast(data.error || 'Failed to connect GitHub');
      }
    }

    async function disconnectGitHub() {
      var res = await apiFetch(API + '/scanner/github/disconnect', { method: 'DELETE' });
      if (!res) return;
      if (res.ok) {
        ghConnected = false;
        showState('not-connected');
        showToast('GitHub disconnected', 'info');
      } else {
        var data = await safeJson(res);
        showToast(data.error || 'Failed to disconnect');
      }
    }

    // --- Repo List ---
    async function loadRepoList() {
      var res = await apiFetch(API + '/scanner/repos');
      if (!res) return;
      var data = await safeJson(res);
      if (!res.ok) {
        if (res.status === 404 || res.status === 403) {
          showState('not-connected');
          return;
        }
        showToast(data.error || 'Failed to load repos');
        return;
      }

      allRepos = data.repos || data || [];
      if (data.username) {
        document.getElementById('ghUsername').textContent = data.username;
      }
      ghConnected = true;
      renderRepos(allRepos);
      showState('repo-list');
      loadScanHistory();
    }

    function renderRepos(repos) {
      var grid = document.getElementById('repoGrid');
      var empty = document.getElementById('repoEmpty');
      if (!repos.length) {
        grid.innerHTML = '';
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');
      grid.innerHTML = repos.map(function(r, i) {
        var vis = r.private ? '<span class="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 text-xs rounded-full">Private</span>' : '<span class="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded-full">Public</span>';
        var repoName = r.fullName || r.full_name || r.name || '';
        return '<div class="bg-card border border-border rounded-xl p-4 flex items-center justify-between anim-card" style="animation-delay:' + (i * 0.03) + 's">' +
          '<div class="min-w-0 flex-1">' +
            '<div class="flex items-center gap-2 mb-1">' +
              '<p class="text-sm font-semibold text-white truncate">' + escapeHtml(repoName) + '</p>' +
              vis +
            '</div>' +
            '<p class="text-xs text-gray-500">Updated ' + timeAgo(r.updatedAt || r.updated_at) + '</p>' +
          '</div>' +
          '<div class="flex items-center">' +
            '<button data-repo="' + escapeHtml(repoName) + '" class="scan-repo-btn ml-3 px-4 py-2 bg-brand/10 hover:bg-brand/20 text-brand text-sm font-medium rounded-xl transition flex-shrink-0">Scan</button>' +
          '</div>' +
        '</div>';
      }).join('');
      // Event delegation for scan buttons
      grid.querySelectorAll('.scan-repo-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { startScan(btn.getAttribute('data-repo')); });
      });
    }

    function filterRepos() {
      var q = document.getElementById('repoSearch').value.toLowerCase();
      if (!q) { renderRepos(allRepos); return; }
      renderRepos(allRepos.filter(function(r) {
        return (r.fullName || r.full_name || r.name || '').toLowerCase().indexOf(q) > -1;
      }));
    }

    // --- Scan History ---
    async function loadScanHistory() {
      var res = await apiFetch(API + '/scanner/scans');
      if (!res) return;
      var data = await res.json();
      var scans = data.scans || data || [];
      var tbody = document.getElementById('scanHistoryBody');
      var table = document.getElementById('scanHistoryRows');
      var empty = document.getElementById('scanHistoryEmpty');

      if (!scans.length) {
        table.classList.add('hidden');
        empty.classList.remove('hidden');
        return;
      }
      empty.classList.add('hidden');
      table.classList.remove('hidden');

      tbody.innerHTML = scans.map(function(s) {
        var statusBadge = s.status === 'completed'
          ? '<span class="px-2 py-0.5 bg-green-500/10 text-green-400 text-xs rounded-full">Completed</span>'
          : s.status === 'scanning'
          ? '<span class="px-2 py-0.5 bg-yellow-500/10 text-yellow-400 text-xs rounded-full">Scanning</span>'
          : '<span class="px-2 py-0.5 bg-red-500/10 text-red-400 text-xs rounded-full">' + escapeHtml(s.status || 'Unknown') + '</span>';
        var count = s.findings_count != null ? s.findings_count : (s.findings ? s.findings.length : '—');
        return '<tr class="border-b border-border hover:bg-white/[0.02] transition">' +
          '<td class="px-4 py-3 text-white font-medium">' + escapeHtml(s.repo_full_name || s.repoFullName || '') + '</td>' +
          '<td class="px-4 py-3 text-gray-400">' + formatTime(s.startedAt || s.started_at || s.createdAt || s.created_at) + '</td>' +
          '<td class="px-4 py-3 text-gray-400">' + count + '</td>' +
          '<td class="px-4 py-3">' + statusBadge + '</td>' +
          '<td class="px-4 py-3 text-right"><button data-scan-id="' + escapeHtml(s.id) + '" class="view-scan-btn text-brand hover:underline text-xs">View</button></td>' +
        '</tr>';
      }).join('');
      // Event delegation for view buttons
      tbody.querySelectorAll('.view-scan-btn').forEach(function(btn) {
        btn.addEventListener('click', function() { viewScanResults(btn.getAttribute('data-scan-id')); });
      });
    }

    // --- Scan Step Animation Helpers ---
    var scanCancelled = false;
    var scanElapsedTimer = null;
    var scanPollInterval = null;

    function resetScanProgress() {
      scanCancelled = false;
      document.getElementById('scanProgressBar').style.width = '0%';
      document.getElementById('scanStatusText').textContent = 'Connecting to repository...';
      document.getElementById('scanElapsed').textContent = '0s elapsed';
      document.getElementById('scanCountKeys').textContent = '0';
      document.getElementById('scanCountSdk').textContent = '0';
      document.getElementById('scanCountHttp').textContent = '0';
    }

    function startElapsedTimer() {
      var start = Date.now();
      if (scanElapsedTimer) clearInterval(scanElapsedTimer);
      scanElapsedTimer = setInterval(function() {
        var secs = Math.floor((Date.now() - start) / 1000);
        document.getElementById('scanElapsed').textContent = secs + 's elapsed';
      }, 1000);
    }

    function stopElapsedTimer() {
      if (scanElapsedTimer) { clearInterval(scanElapsedTimer); scanElapsedTimer = null; }
    }

    function setScanProgress(pct, status) {
      document.getElementById('scanProgressBar').style.width = Math.min(pct, 95) + '%';
      if (status) document.getElementById('scanStatusText').textContent = status;
    }

    function completeScanProgress() {
      document.getElementById('scanProgressBar').style.width = '100%';
      document.getElementById('scanProgressShimmer').style.display = 'none';
      document.getElementById('scanStatusText').textContent = 'Scan complete!';
      stopElapsedTimer();
    }

    function cancelScan() {
      scanCancelled = true;
      if (scanPollInterval) { clearInterval(scanPollInterval); scanPollInterval = null; }
      stopElapsedTimer();
      document.getElementById('scanProgress').classList.add('hidden');
      document.getElementById('summaryCards').style.opacity = '1';
      showToast('Scan cancelled', 'info');
    }

    function updateScanLiveCounter(findings) {
      if (!findings) return;
      var keys = findings.filter(function(f) { return f.mode !== 'sdk-init' && f.mode !== 'http-url' && (f.maskedValue || f.masked_value); }).length;
      var sdk = findings.filter(function(f) { return f.mode === 'sdk-init'; }).length;
      var http = findings.filter(function(f) { return f.mode === 'http-url'; }).length;
      document.getElementById('scanCountKeys').textContent = keys;
      document.getElementById('scanCountSdk').textContent = sdk;
      document.getElementById('scanCountHttp').textContent = http;
    }

    // --- Start Scan ---
    async function startScan(repoFullName) {
      showState('scan-results');
      document.getElementById('scanResultRepo').textContent = repoFullName;
      document.getElementById('scanSpinner').classList.add('hidden');
      document.getElementById('findingsSection').classList.add('hidden');
      document.getElementById('migrationResults').classList.add('hidden');
      document.getElementById('migrationProgress').classList.add('hidden');
      document.getElementById('envChecklist').classList.add('hidden');
      document.getElementById('summaryCards').style.opacity = '0.3';

      // Show progress UI
      document.getElementById('scanProgress').classList.remove('hidden');
      resetScanProgress();
      startElapsedTimer();
      setScanProgress(5, 'Connecting to repository...');

      var res = await apiFetch(API + '/scanner/scan', {
        method: 'POST',
        body: JSON.stringify({ repoFullName: repoFullName })
      });

      if (scanCancelled) return;

      if (!res) {
        stopElapsedTimer();
        document.getElementById('scanProgress').classList.add('hidden');
        document.getElementById('summaryCards').style.opacity = '1';
        showToast('Failed to start scan');
        return;
      }

      var data = await res.json();
      if (!res.ok) {
        stopElapsedTimer();
        document.getElementById('scanProgress').classList.add('hidden');
        document.getElementById('summaryCards').style.opacity = '1';
        showToast(data.error || 'Scan failed');
        return;
      }

      setScanProgress(15, 'Scan started, fetching files...');
      currentScanId = data.scanId || data.id;

      if (data.status === 'completed' || data.findings) {
        updateScanLiveCounter(data.findings || []);
        completeScanProgress();
        setTimeout(function() {
          document.getElementById('scanProgress').classList.add('hidden');
          renderScanResults(data);
        }, 600);
      } else {
        pollScanStatus(currentScanId);
      }
    }

    function pollScanStatus(scanId) {
      var attempts = 0;
      var maxAttempts = 90;
      var statusMessages = [
        { pct: 20, msg: 'Scanning .env files...' },
        { pct: 35, msg: 'Scanning source code for hardcoded keys...' },
        { pct: 50, msg: 'Checking git history for leaked keys...' },
        { pct: 65, msg: 'Detecting SDK patterns and API URLs...' },
        { pct: 78, msg: 'Verifying detected keys...' },
        { pct: 88, msg: 'Finalizing results...' },
      ];

      scanPollInterval = setInterval(async function() {
        if (scanCancelled) { clearInterval(scanPollInterval); scanPollInterval = null; return; }
        attempts++;

        // Gradually advance progress bar
        var msgIdx = Math.min(Math.floor(attempts / 3), statusMessages.length - 1);
        setScanProgress(statusMessages[msgIdx].pct, statusMessages[msgIdx].msg);

        if (attempts > maxAttempts) {
          clearInterval(scanPollInterval); scanPollInterval = null;
          stopElapsedTimer();
          document.getElementById('scanProgress').classList.add('hidden');
          document.getElementById('summaryCards').style.opacity = '1';
          showToast('Scan timed out. Please try again.');
          return;
        }
        var res = await apiFetch(API + '/scanner/scans/' + scanId);
        if (!res) { clearInterval(scanPollInterval); scanPollInterval = null; stopElapsedTimer(); return; }
        var data = await res.json();
        if (data.status === 'completed' || data.findings) {
          clearInterval(scanPollInterval); scanPollInterval = null;
          updateScanLiveCounter(data.findings || []);
          completeScanProgress();
          setTimeout(function() {
            document.getElementById('scanProgress').classList.add('hidden');
            renderScanResults(data);
          }, 600);
        } else if (data.status === 'failed') {
          clearInterval(scanPollInterval); scanPollInterval = null;
          stopElapsedTimer();
          document.getElementById('scanProgress').classList.add('hidden');
          document.getElementById('summaryCards').style.opacity = '1';
          showToast(data.error || 'Scan failed');
        }
      }, 2000);
    }

    async function viewScanResults(scanId) {
      showState('scan-results');
      document.getElementById('scanSpinner').classList.remove('hidden');
      document.getElementById('scanProgress').classList.add('hidden');
      document.getElementById('findingsSection').classList.add('hidden');
      document.getElementById('migrationResults').classList.add('hidden');
      document.getElementById('migrationProgress').classList.add('hidden');
      document.getElementById('envChecklist').classList.add('hidden');
      document.getElementById('summaryCards').style.opacity = '0.3';

      var res = await apiFetch(API + '/scanner/scans/' + scanId);
      if (!res) {
        document.getElementById('scanSpinner').classList.add('hidden');
        return;
      }
      var data = await res.json();
      currentScanId = scanId;
      document.getElementById('scanResultRepo').textContent = data.repo_full_name || data.repoFullName || '';
      renderScanResults(data);
    }

    // --- Render Scan Results ---
    function renderScanResults(data) {
      currentScanData = data;
      document.getElementById('scanSpinner').classList.add('hidden');
      document.getElementById('scanProgress').classList.add('hidden');
      document.getElementById('summaryCards').style.opacity = '1';

      var findings = data.findings || [];
      var keyFindings = findings.filter(function(f) { return f.type === 'key' || (!f.type && f.source !== 'git_history' && (f.maskedValue || f.masked_value || f.envName || f.env_name || f.key_name || f.keyName)); });
      var sdkFindings = findings.filter(function(f) { return f.type === 'sdk-init'; });
      var httpFindings = findings.filter(function(f) { return f.type === 'http-url'; });
      var envRefFindings = findings.filter(function(f) { return f.type === 'env-ref'; });
      var codeChangeFindings = sdkFindings.concat(httpFindings).concat(envRefFindings);
      var historyFindings = findings.filter(function(f) { return f.source === 'git_history'; });
      var codeFindings = findings.filter(function(f) { return f.source !== 'git_history'; });

      var active = findings.filter(function(f) { return f.status === 'active'; }).length;
      var revoked = findings.filter(function(f) { return f.status === 'revoked'; }).length;
      var unknown = findings.length - active - revoked;

      document.getElementById('sumTotal').textContent = findings.length;
      document.getElementById('sumActive').textContent = active;
      document.getElementById('sumRevoked').textContent = revoked;
      document.getElementById('sumUnknown').textContent = unknown;

      // Decide which view: migration wizard (if code-level findings) or legacy table
      var hasMigrationFindings = keyFindings.length > 0 && codeChangeFindings.length > 0;

      if (hasMigrationFindings) {
        // Show the migration results view
        document.getElementById('findingsSection').classList.add('hidden');
        document.getElementById('migrationResults').classList.remove('hidden');
        renderMigrationResults(keyFindings, codeChangeFindings, historyFindings, data.platforms || []);
      } else {
        // Fallback: show legacy table view
        document.getElementById('findingsSection').classList.remove('hidden');
        document.getElementById('migrationResults').classList.add('hidden');
        renderLegacyFindings(codeFindings, historyFindings);
      }

    }

    // --- Migration Results View ---
    function renderMigrationResults(keyFindings, codeChangeFindings, historyFindings, platforms) {
      // Render key cards
      var keysContainer = document.getElementById('migrationKeysCards');
      document.getElementById('migrationKeysCount').textContent = keyFindings.length + ' found';

      keysContainer.innerHTML = keyFindings.map(function(f, i) {
        var pInfo = f.providerInfo || f.provider_info;
        var pName = pInfo ? pInfo.name : (f.provider || 'Unknown');
        var masked = f.maskedValue || f.masked_value || '****';
        var envName = f.envName || f.env_name || f.key_name || f.keyName || '';
        var filePath = f.file || '';

        return '<div class="bg-card border border-border rounded-2xl p-4 anim-fade-up" style="animation-delay:' + (i * 0.05) + 's">' +
          '<div class="flex items-start justify-between gap-3 mb-3">' +
            '<div class="flex items-center gap-2 min-w-0">' +
              '<label class="flex items-center gap-2 cursor-pointer">' +
                '<input type="checkbox" class="migrate-key-cb rounded border-gray-600" data-key-idx="' + i + '" checked>' +
                '<span class="px-2 py-0.5 bg-brand/10 text-brand text-xs font-medium rounded-full flex-shrink-0">' + escapeHtml(pName) + '</span>' +
              '</label>' +
              '<span class="text-xs text-gray-500 truncate">' + escapeHtml(filePath) + '</span>' +
            '</div>' +
            '<span class="text-xs text-gray-500 flex-shrink-0">Store in VaultProof</span>' +
          '</div>' +
          '<div class="flex items-center gap-2 mb-3">' +
            '<span class="text-xs font-mono text-white bg-surface px-2 py-1 rounded-lg">' + escapeHtml(envName) + '</span>' +
            '<span class="text-xs font-mono text-gray-500">' + escapeHtml(masked) + '</span>' +
          '</div>' +
          '<div class="mt-2">' +
            '<div class="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-xl">' +
              '<svg class="w-4 h-4 text-brand flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
              '<span class="text-xs text-gray-400">You will store this key securely via the <a href="/app/keys.html" class="text-brand hover:underline">Keys page</a> after migration.</span>' +
            '</div>' +
          '</div>' +
        '</div>';
      }).join('');

      // Render code change cards grouped by file
      var changesContainer = document.getElementById('migrationChangesCards');
      var changesSection = document.getElementById('migrationChangesSection');

      if (codeChangeFindings.length > 0) {
        changesSection.classList.remove('hidden');
        document.getElementById('migrationChangesCount').textContent = codeChangeFindings.length + ' changes';

        // Group by file
        var byFile = {};
        codeChangeFindings.forEach(function(f, i) {
          var file = f.file || 'unknown';
          if (!byFile[file]) byFile[file] = [];
          byFile[file].push({ finding: f, index: i });
        });

        var html = '';
        var fileKeys = Object.keys(byFile);
        fileKeys.forEach(function(file, fIdx) {
          var group = byFile[file];
          html += '<div class="bg-card border border-border rounded-2xl overflow-hidden anim-fade-up" style="animation-delay:' + (fIdx * 0.05 + 0.1) + 's">' +
            '<div class="px-4 py-3 border-b border-border flex items-center gap-2">' +
              '<svg class="w-4 h-4 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>' +
              '<span class="text-xs font-mono text-gray-300">' + escapeHtml(file) + '</span>' +
              '<span class="text-xs text-gray-600 ml-auto">' + group.length + ' change' + (group.length !== 1 ? 's' : '') + '</span>' +
            '</div>' +
            '<div class="divide-y divide-border">';

          group.forEach(function(item) {
            var f = item.finding;
            var typeLabel = f.type === 'sdk-init' ? 'SDK Init' : f.type === 'http-url' ? 'HTTP URL' : 'Env Ref';
            var typeBg = f.type === 'sdk-init' ? 'bg-purple-500/10 text-purple-400' : f.type === 'http-url' ? 'bg-cyan-500/10 text-cyan-400' : 'bg-yellow-500/10 text-yellow-400';
            var before = f.before || f.original || f.maskedValue || f.masked_value || '';
            var after = f.after || f.replacement || 'vaultproof.get("' + (f.provider || 'KEY') + '")';
            var line = f.line ? ':' + f.line : '';

            html += '<div class="px-4 py-3">' +
              '<div class="flex items-center gap-2 mb-2">' +
                '<label class="flex items-center gap-2 cursor-pointer">' +
                  '<input type="checkbox" class="migrate-change-cb rounded border-gray-600" data-change-idx="' + item.index + '" checked>' +
                  '<span class="px-2 py-0.5 ' + typeBg + ' text-xs font-medium rounded-full">' + typeLabel + '</span>' +
                '</label>' +
                '<span class="text-xs text-gray-500">line' + escapeHtml(line) + '</span>' +
              '</div>' +
              '<div class="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono">' +
                '<div class="bg-red-900/10 border border-red-900/20 rounded-lg px-3 py-2">' +
                  '<span class="text-red-400/60 text-[10px] uppercase tracking-wider block mb-1">Before</span>' +
                  '<span class="text-red-300 break-all">' + escapeHtml(before) + '</span>' +
                '</div>' +
                '<div class="bg-green-900/10 border border-green-900/20 rounded-lg px-3 py-2">' +
                  '<span class="text-green-400/60 text-[10px] uppercase tracking-wider block mb-1">After</span>' +
                  '<span class="text-green-300 break-all">' + escapeHtml(after) + '</span>' +
                '</div>' +
              '</div>' +
            '</div>';
          });

          html += '</div></div>';
        });

        changesContainer.innerHTML = html;
      } else {
        changesSection.classList.add('hidden');
      }

      // Git history warning
      var gitWarning = document.getElementById('migrationGitWarning');
      if (historyFindings.length > 0) {
        gitWarning.classList.remove('hidden');
      } else {
        gitWarning.classList.add('hidden');
      }

      updateMigrateButton();
    }

    function togglePasswordVisibility(btn) {
      var input = btn.parentElement.querySelector('input');
      var eyeOpen = btn.querySelector('.eye-open');
      var eyeClosed = btn.querySelector('.eye-closed');
      if (input.type === 'password') {
        input.type = 'text';
        eyeOpen.classList.add('hidden');
        eyeClosed.classList.remove('hidden');
      } else {
        input.type = 'password';
        eyeOpen.classList.remove('hidden');
        eyeClosed.classList.add('hidden');
      }
    }

    function updateMigrateButton() {
      var keyChecked = document.querySelectorAll('.migrate-key-cb:checked').length;
      var changeChecked = document.querySelectorAll('.migrate-change-cb:checked').length;
      var btn = document.getElementById('migrateBtn');
      btn.disabled = (keyChecked + changeChecked) === 0;
    }

    // --- Legacy findings table (fallback) ---
    function renderLegacyFindings(codeFindings, historyFindings) {
      document.getElementById('findingsSection').classList.remove('hidden');

      var tbody = document.getElementById('findingsBody');
      var table = document.getElementById('findingsTable');
      var emptyEl = document.getElementById('findingsEmpty');
      document.getElementById('findingsCount').textContent = codeFindings.length + ' finding' + (codeFindings.length !== 1 ? 's' : '');

      if (!codeFindings.length) {
        table.classList.add('hidden');
        emptyEl.classList.remove('hidden');
      } else {
        emptyEl.classList.add('hidden');
        table.classList.remove('hidden');
        tbody.innerHTML = codeFindings.map(function(f, i) {
          var statusIcon = f.status === 'active'
            ? '<span class="w-5 h-5 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center" title="Active"><svg class="w-3 h-3 text-red-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg></span>'
            : f.status === 'revoked'
            ? '<span class="w-5 h-5 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center" title="Revoked"><svg class="w-3 h-3 text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></span>'
            : '<span class="w-5 h-5 rounded-full bg-gray-500/10 border border-gray-500/20 flex items-center justify-center" title="Unknown"><span class="text-xs text-gray-400">?</span></span>';

          var pInfo = f.providerInfo || f.provider_info;
          var pName = pInfo ? pInfo.name : (f.provider || 'Unknown');
          var detailRow = '';
          if (pInfo) {
            detailRow = '<tr class="border-b border-border hidden" id="detail-' + i + '">' +
              '<td colspan="8" class="px-4 py-3 bg-[#0d0d14]">' +
                '<div class="pl-8 space-y-2 text-xs">' +
                  '<p class="text-white font-medium">' + escapeHtml(pInfo.name) + ' \u2014 ' + escapeHtml(pInfo.desc) + '</p>' +
                  '<p class="text-red-400">Risk: ' + escapeHtml(pInfo.risk) + '</p>' +
                  '<div class="text-gray-400"><p class="font-medium text-gray-300 mb-1">How to fix:</p><ol class="list-decimal pl-4 space-y-0.5">' +
                    pInfo.steps.map(function(s) { return '<li>' + escapeHtml(s) + '</li>'; }).join('') +
                  '</ol></div>' +
                  (f.rotationUrl || f.rotation_url ? '<a href="' + escapeHtml(f.rotationUrl || f.rotation_url) + '" target="_blank" rel="noopener" class="text-brand hover:underline inline-block mt-1">Open ' + escapeHtml(pInfo.name) + ' dashboard &rarr;</a>' : '') +
                '</div>' +
              '</td>' +
            '</tr>';
          }

          return '<tr class="border-b border-border hover:bg-white/[0.02] transition cursor-pointer" data-toggle-detail="' + i + '">' +
            '<td class="px-4 py-3" data-stop-row-toggle="1"><input type="checkbox" class="finding-cb rounded border-gray-600" data-idx="' + i + '" data-provider="' + escapeHtml(f.provider || '') + '" data-status="' + escapeHtml(f.status || '') + '"></td>' +
            '<td class="px-4 py-3">' + statusIcon + '</td>' +
            '<td class="px-4 py-3 text-white font-medium text-xs font-mono">' + escapeHtml(f.envName || f.env_name || f.key_name || f.keyName || '') + '</td>' +
            '<td class="px-4 py-3 text-gray-400 text-xs">' + escapeHtml(pName) + '</td>' +
            '<td class="px-4 py-3 text-gray-400 text-xs font-mono">' + escapeHtml((f.file || '') + (f.line ? ':' + f.line : '')) + '</td>' +
            '<td class="px-4 py-3 text-gray-400 text-xs">' + escapeHtml(f.source || 'code') + '</td>' +
            '<td class="px-4 py-3 text-gray-400 text-xs">' + escapeHtml(f.mode || '') + '</td>' +
            '<td class="px-4 py-3 text-right" data-stop-row-toggle="1">' +
              '<select class="bg-[#111118] border border-[#1e1e2e] rounded-lg px-2 py-1 text-xs text-gray-100 focus:outline-none focus:border-brand/50" data-finding-idx="' + i + '">' +
                '<option value="store">Store in VaultProof</option>' +
                '<option value="pr">Create PR</option>' +
                '<option value="ignore">Ignore</option>' +
                '<option value="allowlist">Add to Allowlist</option>' +
              '</select>' +
            '</td>' +
          '</tr>' + detailRow;
        }).join('');
      }

      // Git history findings — actionable cards
      var histSection = document.getElementById('gitHistorySection');
      if (historyFindings.length) {
        histSection.classList.remove('hidden');
        document.getElementById('gitHistoryCards').innerHTML = historyFindings.map(function(f, idx) {
          var hInfo = f.providerInfo || f.provider_info || {};
          var hName = hInfo.name || f.provider || 'Unknown';
          var masked = f.maskedValue || f.masked_value || '';
          var ha = f.historyAction || f.history_action || '';
          var badge = '';
          if (ha === 'revoke-guided') badge = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-900/40 text-green-400 border border-green-700/30">Revoked</span>';
          else if (ha === 'store-rewrite') badge = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-900/40 text-blue-400 border border-blue-700/30">Stored</span>';
          else if (ha === 'dismissed') badge = '<span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-800 text-gray-400 border border-gray-700/30">Dismissed</span>';

          var stepsJson = escapeHtml(JSON.stringify(hInfo.revocationSteps || []));
          var noteText = escapeHtml(hInfo.revocationNote || '');
          var rotUrl = escapeHtml(f.rotationUrl || hInfo.rotationUrl || '');
          var cliSteps = escapeHtml(hInfo.cliSteps || '');
          var usageCheckUrl = escapeHtml(hInfo.usageCheckUrl || '');
          var usageCheckNote = escapeHtml(hInfo.usageCheckNote || '');

          return '<div class="bg-card border border-border rounded-xl p-4 flex flex-col sm:flex-row sm:items-center gap-3" data-history-idx="' + idx + '">' +
            '<div class="flex-1 min-w-0">' +
              '<div class="flex items-center gap-2 mb-1">' +
                '<span class="text-sm font-medium text-white">' + escapeHtml(hName) + '</span>' +
                badge +
              '</div>' +
              '<p class="text-xs font-mono text-gray-400 truncate">' + escapeHtml(f.envName || f.env_name || '') + (masked ? ' &mdash; ' + escapeHtml(masked) : '') + '</p>' +
            '</div>' +
            '<div class="flex items-center gap-2 flex-shrink-0">' +
              (ha === 'dismissed' ? '' :
                '<button data-history-action="revoke" data-finding-id="' + escapeHtml(f.id) + '" data-provider-name="' + escapeHtml(hName) + '" data-steps="' + stepsJson + '" data-note="' + noteText + '" data-url="' + rotUrl + '" data-cli-steps="' + cliSteps + '" data-usage-check-url="' + usageCheckUrl + '" data-usage-check-note="' + usageCheckNote + '" class="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-medium transition whitespace-nowrap">Revoke + Rotate</button>' +
                '<button data-history-action="store" data-finding-id="' + escapeHtml(f.id) + '" class="px-3 py-1.5 bg-brand hover:bg-brand-hover text-white rounded-lg text-xs font-medium transition whitespace-nowrap">Store in VaultProof</button>'
              ) +
              (ha ? '' : '<button data-history-action="dismiss" data-finding-id="' + escapeHtml(f.id) + '" class="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-100 rounded-lg text-xs font-medium transition whitespace-nowrap">Dismiss</button>') +
            '</div>' +
          '</div>';
        }).join('');
      } else {
        histSection.classList.add('hidden');
      }

      updateBulkBar();
    }

    function toggleSelectAll() {
      var checked = document.getElementById('selectAll').checked;
      document.querySelectorAll('.finding-cb').forEach(function(cb) { cb.checked = checked; });
      updateBulkBar();
    }

    function toggleDetail(idx) {
      var row = document.getElementById('detail-' + idx);
      if (row) row.classList.toggle('hidden');
    }

    // ── Git History Finding Actions ──

    var _revokeModalFindingId = null;

    function openRevokeModal(findingId, providerName, steps, note, url, cliSteps, usageCheckUrl, usageCheckNote) {
      _revokeModalFindingId = findingId;
      document.getElementById('revokeModalTitle').textContent = providerName + ' Key';

      // Phase 1: revoke steps
      var stepsEl = document.getElementById('revokeModalSteps');
      var stepsArr = typeof steps === 'string' ? JSON.parse(steps) : (steps || []);
      stepsEl.innerHTML = stepsArr.map(function(s) {
        return '<li>' + escapeHtml(s) + '</li>';
      }).join('');

      // Note
      var noteEl = document.getElementById('revokeModalNote');
      if (note) {
        noteEl.textContent = note;
        noteEl.classList.remove('hidden');
      } else {
        noteEl.classList.add('hidden');
      }

      // CLI block (AWS etc.)
      var cliBlock = document.getElementById('revokeModalCliBlock');
      var cliCode = document.getElementById('revokeModalCliCode');
      if (cliSteps) {
        cliCode.textContent = cliSteps;
        cliBlock.classList.remove('hidden');
      } else {
        cliBlock.classList.add('hidden');
      }

      // Provider dashboard link
      var linkEl = document.getElementById('revokeModalLink');
      if (url) {
        linkEl.href = url;
        linkEl.classList.remove('hidden');
      } else {
        linkEl.classList.add('hidden');
      }

      // Phase 2: usage check
      var usageNoteEl = document.getElementById('revokeUsageNote');
      usageNoteEl.textContent = usageCheckNote || 'Check the provider\'s logs for requests you didn\'t make — especially at unusual times or from unknown IPs.';

      var usageLinkEl = document.getElementById('revokeUsageLink');
      if (usageCheckUrl) {
        usageLinkEl.href = usageCheckUrl;
        usageLinkEl.classList.remove('hidden');
      } else {
        usageLinkEl.classList.add('hidden');
      }

      var modal = document.getElementById('revokeGuideModal');
      modal.style.display = 'flex';
      modal.classList.remove('hidden');
    }

    function closeRevokeModal() {
      var modal = document.getElementById('revokeGuideModal');
      modal.style.display = 'none';
      modal.classList.add('hidden');
      _revokeModalFindingId = null;
    }

    async function confirmRevoked() {
      if (!_revokeModalFindingId) return;
      var findingId = _revokeModalFindingId;
      try {
        var res = await apiFetch('/api/scanner/findings/' + findingId + '/history-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'revoke-guided' }),
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Key marked as revoked', 'success');
        closeRevokeModal();
        // Refresh scan data to update badges
        if (currentScanData && currentScanData.id) {
          loadScan(currentScanData.id);
        }
      } catch (e) {
        showToast('Failed to update finding', 'error');
      }
    }

    async function storeHistoryFinding(findingId) {
      try {
        var res = await apiFetch('/api/scanner/findings/' + findingId + '/history-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'store-rewrite' }),
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Finding marked for storage in VaultProof', 'success');
        if (currentScanData && currentScanData.id) {
          loadScan(currentScanData.id);
        }
      } catch (e) {
        showToast('Failed to update finding', 'error');
      }
    }

    async function dismissHistoryFinding(findingId, btn) {
      if (btn) btn.disabled = true;
      try {
        var res = await apiFetch('/api/scanner/findings/' + findingId + '/history-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'dismissed' }),
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Finding dismissed', 'success');
        if (currentScanData && currentScanData.id) {
          loadScan(currentScanData.id);
        }
      } catch (e) {
        showToast('Failed to dismiss finding', 'error');
        if (btn) btn.disabled = false;
      }
    }

    function updatePrButton() {
      var selected = document.querySelectorAll('.finding-cb:checked').length;
      var btn = document.getElementById('createPrBtn');
      btn.disabled = selected === 0;
      btn.textContent = selected ? 'Create PR for selected (' + selected + ')' : 'Create PR for selected';
    }

    function updateBulkBar() {
      updatePrButton();
      var selected = document.querySelectorAll('.finding-cb:checked').length;
      var bar = document.getElementById('bulkActionBar');
      if (selected >= 2) {
        bar.classList.remove('hidden');
        document.getElementById('bulkCount').textContent = selected + ' findings selected';
      } else {
        bar.classList.add('hidden');
      }
    }

    async function bulkIgnore() {
      var codeFindings = (currentScanData.findings || []).filter(function(f) { return f.source !== 'git_history'; });
      var findingIds = [];
      document.querySelectorAll('.finding-cb:checked').forEach(function(cb) {
        var idx = parseInt(cb.dataset.idx);
        if (codeFindings[idx] && codeFindings[idx].id) {
          findingIds.push(codeFindings[idx].id);
        }
      });

      if (findingIds.length === 0) {
        showToast('No findings selected', 'error');
        return;
      }

      var btn = document.getElementById('bulkIgnoreBtn');
      btn.disabled = true;
      btn.textContent = 'Ignoring...';

      try {
        var resp = await apiFetch(API + '/scanner/findings/bulk-ignore', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ findingIds: findingIds }),
        });

        if (!resp.ok) {
          var err = await resp.json().catch(function() { return { error: 'Unknown error' }; });
          throw new Error(err.error || 'Failed to ignore findings');
        }

        var result = await resp.json();
        showToast(result.ignored + ' finding' + (result.ignored !== 1 ? 's' : '') + ' ignored', 'success');

        // Update local state and re-render
        findingIds.forEach(function(id) {
          var f = currentScanData.findings.find(function(f) { return f.id === id; });
          if (f) f.action = 'ignored';
        });

        var code = currentScanData.findings.filter(function(f) { return f.source !== 'git_history'; });
        var hist = currentScanData.findings.filter(function(f) { return f.source === 'git_history'; });
        renderLegacyFindings(code, hist);
      } catch (e) {
        showToast(e.message || 'Failed to ignore findings', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Ignore Selected';
      }
    }

    // --- Allowlist Management ---
    var allowlistData = [];

    function toggleAllowlistPanel() {
      var panel = document.getElementById('allowlistPanel');
      if (panel.classList.contains('hidden')) {
        panel.classList.remove('hidden');
        loadAllowlists();
      } else {
        panel.classList.add('hidden');
      }
    }

    async function loadAllowlists() {
      var repo = currentScanData ? (currentScanData.repo_full_name || currentScanData.repoFullName || '') : '';
      if (!repo) {
        allowlistData = [];
        renderAllowlistTable();
        return;
      }
      var query = new URLSearchParams();
      query.set('repo', repo);
      query.set('repo_full_name', repo);
      var url = API + '/scanner/allowlists?' + query.toString();
      var res = await apiFetch(url);
      if (!res) return;
      var data = await safeJson(res);
      allowlistData = data.allowlists || [];
      renderAllowlistTable();
    }

    function renderAllowlistTable() {
      var tbody = document.getElementById('allowlistBody');
      var table = document.getElementById('allowlistTable');
      var empty = document.getElementById('allowlistEmpty');
      var count = document.getElementById('allowlistCount');

      if (!allowlistData.length) {
        table.classList.add('hidden');
        empty.classList.remove('hidden');
        count.textContent = '';
        return;
      }

      table.classList.remove('hidden');
      empty.classList.add('hidden');
      count.textContent = allowlistData.length + ' entries';

      tbody.innerHTML = allowlistData.map(function(entry) {
        var scope = entry.repo_full_name ? escapeHtml(entry.repo_full_name) : 'Global';
        var typeLabel = entry.pattern_type === 'file_path' ? 'File Path' : 'Env Name';
        return '<tr class="border-b border-border hover:bg-white/[0.02]">' +
          '<td class="px-3 py-2 text-xs font-mono text-white">' + escapeHtml(entry.pattern) + '</td>' +
          '<td class="px-3 py-2 text-xs text-gray-400">' + typeLabel + '</td>' +
          '<td class="px-3 py-2 text-xs text-gray-400">' + scope + '</td>' +
          '<td class="px-3 py-2 text-xs text-gray-500">' + escapeHtml(entry.reason || '') + '</td>' +
          '<td class="px-3 py-2 text-right">' +
            '<button data-allowlist-delete="' + escapeHtml(entry.id) + '" class="text-red-300 hover:text-red-200 text-xs">Delete</button>' +
          '</td>' +
        '</tr>';
      }).join('');
    }

    async function addAllowlistEntry(patternType, pattern) {
      // If called from a finding action, patternType and pattern are provided
      if (!patternType) {
        patternType = document.getElementById('alPatternType').value;
        pattern = document.getElementById('alPattern').value.trim();
      }
      if (!pattern) {
        showToast('Pattern is required', 'warning');
        return;
      }
      var scopeEl = document.getElementById('alScope');
      var scope = scopeEl ? scopeEl.value : 'global';
      var repo = null;
      if (scope === 'repo' && currentScanData) {
        repo = currentScanData.repo_full_name || currentScanData.repoFullName || null;
      }
      var reason = '';
      var reasonEl = document.getElementById('alReason');
      if (reasonEl) reason = reasonEl.value.trim();

      try {
        var res = await apiFetch(API + '/scanner/allowlists', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            patternType: patternType,
            pattern_type: patternType,
            pattern: pattern,
            repo: repo,
            repoFullName: repo,
            repo_full_name: repo,
            reason: reason
          }),
        });
        if (!res || !res.ok) throw new Error('Failed');
        showToast('Added to allowlist', 'success');
        // Clear form
        var patternInput = document.getElementById('alPattern');
        var reasonInput = document.getElementById('alReason');
        if (patternInput) patternInput.value = '';
        if (reasonInput) reasonInput.value = '';
        loadAllowlists();
      } catch (e) {
        showToast('Failed to add allowlist entry', 'error');
      }
    }

    async function deleteAllowlistEntry(id) {
      try {
        var res = await apiFetch(API + '/scanner/allowlists/' + id, { method: 'DELETE' });
        if (!res || !res.ok) throw new Error('Failed');
        showToast('Allowlist entry removed', 'success');
        loadAllowlists();
      } catch (e) {
        showToast('Failed to delete allowlist entry', 'error');
      }
    }

    function handleAllowlistFromFinding(select) {
      var idx = parseInt(select.getAttribute('data-finding-idx'), 10);
      var codeFindings = (currentScanData.findings || []).filter(function(f) { return f.source !== 'git_history'; });
      var f = codeFindings[idx];
      if (!f) return;

      var envName = f.envName || f.env_name || f.key_name || f.keyName || '';
      var filePath = f.file || '';

      // Prefer env_name if available, otherwise file_path
      if (envName) {
        addAllowlistEntry('env_name', envName);
      } else if (filePath) {
        addAllowlistEntry('file_path', filePath);
      } else {
        showToast('No pattern available for this finding', 'warning');
      }
      // Reset select
      select.value = 'store';
    }

    // --- CSV Export ---
    function exportCsv() {
      if (userTier === 'free' || userTier === 'starter') {
        showToast('CSV export is available on Pro and Enterprise plans', 'warning');
        return;
      }
      var findings = (currentScanData && currentScanData.findings) || [];
      if (!findings.length) { showToast('No findings to export'); return; }
      var headers = ['Provider','Env Name','File','Line','Mode','Status','Source','Action','Masked Value'];
      var rows = findings.map(function(f) {
        return [
          f.provider || '',
          f.env_name || f.envName || '',
          f.file || '',
          f.line || '',
          f.mode || '',
          f.verified || f.status || '',
          f.source || '',
          f.action || '',
          f.masked_value || f.maskedValue || ''
        ].map(function(v) { return '"' + String(v).replace(/"/g, '""') + '"'; }).join(',');
      });
      var csv = headers.join(',') + '\n' + rows.join('\n');
      var blob = new Blob([csv], { type: 'text/csv' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = ((currentScanData.repo_full_name || currentScanData.repoFullName || 'scan').replace('/', '-')) + '-' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

    // --- PR Modal ---
    function openPrModal() {
      var modal = document.getElementById('prModal');
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      document.getElementById('prModalBody').classList.remove('hidden');
      document.getElementById('prSuccess').classList.add('hidden');

      var container = document.getElementById('prFindings');
      var codeFindings = (currentScanData.findings || []).filter(function(f) { return f.source !== 'git_history'; });
      var selectedIdxs = [];
      document.querySelectorAll('.finding-cb:checked').forEach(function(cb) {
        selectedIdxs.push(parseInt(cb.dataset.idx));
      });

      container.innerHTML = selectedIdxs.map(function(idx) {
        var f = codeFindings[idx];
        if (!f) return '';
        return '<div class="bg-surface border border-border rounded-xl p-3">' +
          '<div class="flex items-center justify-between mb-2">' +
            '<span class="text-xs font-mono text-white">' + escapeHtml(f.key_name || f.keyName || '') + '</span>' +
            '<span class="text-xs text-gray-500">' + escapeHtml(f.file || '') + '</span>' +
          '</div>' +
          '<select class="w-full bg-[#111118] border border-[#1e1e2e] rounded-lg px-3 py-2 text-xs text-gray-100 focus:outline-none focus:border-brand/50" data-pr-idx="' + idx + '">' +
            '<option value="vaultproof">Replace with VaultProof</option>' +
            '<option value="todo">Replace with TODO</option>' +
          '</select>' +
        '</div>';
      }).join('');
    }

    function closePrModal() {
      var modal = document.getElementById('prModal');
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }

    async function submitPr() {
      var btn = document.getElementById('prSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Creating PR...';

      var replacements = [];
      document.querySelectorAll('[data-pr-idx]').forEach(function(sel) {
        replacements.push({
          findingIndex: parseInt(sel.dataset.prIdx),
          mode: sel.value
        });
      });

      var res = await apiFetch(API + '/scanner/scans/' + currentScanId + '/create-pr', {
        method: 'POST',
        body: JSON.stringify({ replacements: replacements })
      });

      btn.disabled = false;
      btn.textContent = 'Create PR';

      if (!res) return;
      var data = await res.json();
      if (res.ok) {
        document.getElementById('prModalBody').classList.add('hidden');
        document.getElementById('prSuccess').classList.remove('hidden');
        var link = document.getElementById('prUrl');
        link.href = data.pr_url || data.prUrl || '#';
        link.textContent = data.pr_url || data.prUrl || 'View PR';
        showToast('Pull request created!', 'success');
      } else {
        showToast(data.error || 'Failed to create PR');
      }
    }

    // --- Migration Flow ---
    function setMigrateStepState(stepId, state, resultText) {
      var el = document.getElementById(stepId);
      if (!el) return;
      el.className = el.className.replace(/step-(pending|active|done)/g, '').trim();
      el.classList.add('step-' + state);
      var iconEl = el.querySelector('.step-icon');
      if (state === 'active') {
        iconEl.innerHTML = '<svg class="w-4 h-4 text-brand spinner" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
      } else if (state === 'done') {
        iconEl.innerHTML = '<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>';
      } else {
        iconEl.innerHTML = '<svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>';
      }
      if (resultText != null) {
        el.querySelector('.step-result').textContent = resultText;
      }
    }

    function resetMigrateSteps() {
      ['migrateStep-store', 'migrateStep-devkey', 'migrateStep-code', 'migrateStep-pr'].forEach(function(id) {
        setMigrateStepState(id, 'pending', '');
      });
    }

    async function startMigration() {
      var findings = currentScanData.findings || [];
      var keyFindings = findings.filter(function(f) { return f.type === 'key' || (!f.type && f.source !== 'git_history' && (f.maskedValue || f.masked_value || f.envName || f.env_name || f.key_name || f.keyName)); });
      var sdkFindings = findings.filter(function(f) { return f.type === 'sdk-init'; });
      var httpFindings = findings.filter(function(f) { return f.type === 'http-url'; });
      var envRefFindings = findings.filter(function(f) { return f.type === 'env-ref'; });
      var codeChangeFindings = sdkFindings.concat(httpFindings).concat(envRefFindings);

      // Collect checked key findings (no raw keys; users store keys via the Keys page after migration)
      var selectedKeys = [];
      document.querySelectorAll('.migrate-key-cb:checked').forEach(function(cb) {
        var idx = parseInt(cb.dataset.keyIdx);
        var f = keyFindings[idx];
        if (f) {
          selectedKeys.push({
            finding: f,
            action: 'store'
          });
        }
      });

      // Collect checked code changes
      var selectedChanges = [];
      document.querySelectorAll('.migrate-change-cb:checked').forEach(function(cb) {
        var idx = parseInt(cb.dataset.changeIdx);
        var f = codeChangeFindings[idx];
        if (f) {
          selectedChanges.push({
            finding: f,
            action: 'apply'
          });
        }
      });

      if (selectedKeys.length === 0 && selectedChanges.length === 0) {
        showToast('Please select at least one item to migrate', 'warning');
        return;
      }

      // No raw key validation needed — keys are stored separately via /app/keys

      // Switch to migration progress view
      document.getElementById('migrationResults').classList.add('hidden');
      document.getElementById('migrationProgress').classList.remove('hidden');
      resetMigrateSteps();

      // Animate step 1: Storing keys
      setMigrateStepState('migrateStep-store', 'active');

      // Build request payload (no rawKeys — keys are stored separately via /app/keys)
      var payload = {
        findings: selectedKeys.map(function(k) {
          return {
            id: k.finding.id,
            type: k.finding.type || 'key',
            provider: k.finding.provider,
            envName: k.finding.envName || k.finding.env_name || k.finding.key_name || k.finding.keyName,
            action: 'store'
          };
        }).concat(selectedChanges.map(function(c) {
          return {
            id: c.finding.id,
            type: c.finding.type,
            file: c.finding.file,
            line: c.finding.line,
            action: 'apply'
          };
        }))
      };

      // Small delay to show animation
      await new Promise(function(r) { setTimeout(r, 600); });
      setMigrateStepState('migrateStep-store', 'done', selectedKeys.length + ' key' + (selectedKeys.length !== 1 ? 's' : '') + ' identified');

      // Step 2: Creating developer key
      setMigrateStepState('migrateStep-devkey', 'active');
      await new Promise(function(r) { setTimeout(r, 400); });

      // Make the actual API call
      var res = await apiFetch(API + '/scanner/scans/' + currentScanId + '/migrate', {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (!res) {
        setMigrateStepState('migrateStep-devkey', 'pending');
        document.getElementById('migrationProgress').classList.add('hidden');
        document.getElementById('migrationResults').classList.remove('hidden');
        showToast('Migration failed. Please try again.');
        return;
      }

      var data = await res.json();
      if (!res.ok) {
        setMigrateStepState('migrateStep-devkey', 'pending');
        document.getElementById('migrationProgress').classList.add('hidden');
        document.getElementById('migrationResults').classList.remove('hidden');
        showToast(data.error || 'Migration failed');
        return;
      }

      migrationResult = data;
      var devKey = data.devKey || data.dev_key || data.apiKey || data.api_key || '';
      var devKeyShort = devKey ? devKey.substring(0, 15) + '...' : 'vp-proj-xxx';

      setMigrateStepState('migrateStep-devkey', 'done', devKeyShort + ' created');

      // Step 3: Code changes
      setMigrateStepState('migrateStep-code', 'active');
      await new Promise(function(r) { setTimeout(r, 500); });
      var filesChanged = data.filesChanged || data.files_changed || selectedChanges.length;
      setMigrateStepState('migrateStep-code', 'done', filesChanged + ' file' + (filesChanged !== 1 ? 's' : '') + ' updated');

      // Step 4: PR created
      setMigrateStepState('migrateStep-pr', 'active');
      await new Promise(function(r) { setTimeout(r, 400); });
      var prUrl = data.prUrl || data.pr_url || '';
      var prNumber = data.prNumber || data.pr_number || '';
      setMigrateStepState('migrateStep-pr', 'done', prNumber ? 'PR #' + prNumber + ' created' : 'PR created');

      // Transition to env checklist
      await new Promise(function(r) { setTimeout(r, 800); });
      document.getElementById('migrationProgress').classList.add('hidden');
      showEnvChecklist(data, selectedKeys);
    }

    function showEnvChecklist(data, selectedKeys) {
      document.getElementById('envChecklist').classList.remove('hidden');

      var devKey = data.devKey || data.dev_key || data.apiKey || data.api_key || '';
      var prUrl = data.prUrl || data.pr_url || '';
      var platforms = currentScanData.platforms || data.platforms || [];

      // Populate "Store your keys" section
      if (selectedKeys.length > 0) {
        document.getElementById('storeKeysSection').classList.remove('hidden');
        document.getElementById('storeKeysList').innerHTML = selectedKeys.map(function(k) {
          var envName = k.finding.envName || k.finding.env_name || k.finding.key_name || k.finding.keyName || '';
          var provider = k.finding.provider || 'unknown';
          return '<div class="flex items-center gap-3 px-3 py-2 bg-surface border border-border rounded-xl">' +
            '<span class="px-2 py-0.5 bg-brand/10 text-brand text-xs font-medium rounded-full">' + escapeHtml(provider) + '</span>' +
            '<span class="text-sm font-mono text-white">' + escapeHtml(envName) + '</span>' +
          '</div>';
        }).join('');
      }

      // Remove these
      var removeList = document.getElementById('envRemoveList');
      var envNamesToRemove = selectedKeys.map(function(k) {
        return k.finding.envName || k.finding.env_name || k.finding.key_name || k.finding.keyName || '';
      }).filter(function(n) { return n; });

      if (envNamesToRemove.length > 0) {
        document.getElementById('envRemoveSection').classList.remove('hidden');
        removeList.innerHTML = envNamesToRemove.map(function(name, i) {
          return '<div class="flex items-center gap-2">' +
            '<input type="checkbox" id="envRemove-' + i + '" class="env-task-cb rounded border-gray-600">' +
            '<label for="envRemove-' + i + '" class="text-sm font-mono text-red-400 cursor-pointer">' + escapeHtml(name) + '</label>' +
          '</div>';
        }).join('');
      } else {
        document.getElementById('envRemoveSection').classList.add('hidden');
      }

      // Add this
      var addList = document.getElementById('envAddList');
      var devKeyDisplay = devKey || 'vp-proj-xxx';
      addList.innerHTML = '<div class="flex items-center gap-2">' +
        '<input type="checkbox" id="envAdd-0" class="env-task-cb rounded border-gray-600">' +
        '<label for="envAdd-0" class="text-sm font-mono text-green-400 cursor-pointer">VAULTPROOF_PROJECT_ID = ' + escapeHtml(devKeyDisplay) + '</label>' +
        '<button data-copy-text="' + escapeHtml(devKeyDisplay) + '" class="ml-2 px-2 py-1 bg-surface border border-border rounded-lg text-xs text-gray-200 hover:text-white hover:border-brand/30 transition flex items-center gap-1">' +
          '<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>' +
          'Copy' +
        '</button>' +
      '</div>';

      // Keep these (env refs not affected)
      var findings = currentScanData.findings || [];
      var envRefFindings = findings.filter(function(f) { return f.type === 'env-ref'; });
      var keptEnvs = (data.keptEnvVars || data.kept_env_vars || []);
      // If backend doesn't provide them, derive from findings that are env-refs not in remove list
      if (!keptEnvs.length) {
        keptEnvs = envRefFindings
          .map(function(f) { return f.envName || f.env_name || ''; })
          .filter(function(n) { return n && envNamesToRemove.indexOf(n) === -1; });
        // Deduplicate
        keptEnvs = keptEnvs.filter(function(v, i, a) { return a.indexOf(v) === i; });
      }

      var keepSection = document.getElementById('envKeepSection');
      if (keptEnvs.length > 0) {
        keepSection.classList.remove('hidden');
        document.getElementById('envKeepList').innerHTML = keptEnvs.map(function(name) {
          return '<div class="flex items-center gap-2">' +
            '<span class="w-4 h-4 flex items-center justify-center text-gray-600">&bull;</span>' +
            '<span class="text-sm font-mono text-gray-400">' + escapeHtml(name) + '</span>' +
            '<span class="text-xs text-gray-600">— not affected</span>' +
          '</div>';
        }).join('');
      } else {
        keepSection.classList.add('hidden');
      }

      // Platform instructions
      var platformSection = document.getElementById('platformInstructions');
      if (platforms.length > 0) {
        platformSection.classList.remove('hidden');
        document.getElementById('platformList').innerHTML = platforms.map(function(p) {
          var instruction = PLATFORM_INSTRUCTIONS[p] || 'Check your ' + p + ' dashboard for environment variable settings.';
          // Replace placeholder with actual key
          instruction = instruction.replace(/<your-key>/g, devKeyDisplay);
          return '<div class="flex items-start gap-3 bg-surface border border-border rounded-xl px-4 py-3">' +
            '<span class="px-2 py-0.5 bg-brand/10 text-brand text-xs font-medium rounded-full flex-shrink-0 mt-0.5">' + escapeHtml(p) + '</span>' +
            '<span class="text-sm text-gray-400">' + escapeHtml(instruction) + '</span>' +
          '</div>';
        }).join('');
      } else {
        platformSection.classList.add('hidden');
      }

      // PR link
      var prLink = document.getElementById('mergePrLink');
      prLink.href = prUrl || '#';

      updateMergeButton();
    }

    function updateMergeButton() {
      var allTasks = document.querySelectorAll('.env-task-cb');
      var checkedTasks = document.querySelectorAll('.env-task-cb:checked');
      var btn = document.getElementById('mergePrBtn');
      btn.disabled = allTasks.length > 0 && checkedTasks.length < allTasks.length;
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text).then(function() {
        showToast('Copied to clipboard', 'success');
      }).catch(function() {
        // Fallback
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Copied to clipboard', 'success');
      });
    }

    function showRepoList() {
      showState('repo-list');
      // Reset migration views
      document.getElementById('migrationResults').classList.add('hidden');
      document.getElementById('migrationProgress').classList.add('hidden');
      document.getElementById('envChecklist').classList.add('hidden');
      document.getElementById('scanProgress').classList.add('hidden');
      loadScanHistory();
    }

    // --- Utility ---
    function escapeHtml(str) {
      var div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    }

    function escapeJs(str) {
      return (str || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'\\"').replace(/</g,'\\x3c').replace(/>/g,'\\x3e').replace(/\r/g,'\\r').replace(/\n/g,'\\n');
    }

    function bindUiEvents() {
      function bindClick(id, handler) {
        var el = document.getElementById(id);
        if (el) el.addEventListener('click', handler);
      }

      bindClick('sidebarOverlay', toggleMobileSidebar);
      bindClick('bulkIgnoreBtn', bulkIgnore);
      bindClick('bulkCreatePrBtn', openPrModal);
      bindClick('prCloseBtn', closePrModal);
      bindClick('prCancelBtn', closePrModal);
      bindClick('prSubmitBtn', submitPr);
      bindClick('toastCloseBtn', function() { document.getElementById('toast').classList.add('hidden'); });
      bindClick('connectGitHubBtn', connectGitHub);
      bindClick('disconnectGitHubBtn', disconnectGitHub);
      bindClick('scanResultBackBtn', showRepoList);
      bindClick('cancelScanBtn', cancelScan);
      bindClick('exportCsvBtn', exportCsv);
      bindClick('toggleAllowlistBtn', toggleAllowlistPanel);
      bindClick('addAllowlistBtn', function() { addAllowlistEntry(); });
      bindClick('revokeCloseBtn', closeRevokeModal);
      bindClick('revokeConfirmBtn', confirmRevoked);
      bindClick('createPrBtn', openPrModal);
      bindClick('legacyBackToReposBtn', showRepoList);
      bindClick('migrationBackToReposBtn', showRepoList);
      bindClick('migrateBtn', startMigration);

      var repoSearch = document.getElementById('repoSearch');
      if (repoSearch) repoSearch.addEventListener('input', filterRepos);
      var selectAll = document.getElementById('selectAll');
      if (selectAll) selectAll.addEventListener('change', toggleSelectAll);

      document.addEventListener('change', function(event) {
        var target = event.target;
        if (!target) return;
        if (target.classList && target.classList.contains('finding-cb')) {
          updateBulkBar();
          return;
        }
        if (target.classList && (target.classList.contains('migrate-key-cb') || target.classList.contains('migrate-change-cb'))) {
          updateMigrateButton();
          return;
        }
        if (target.classList && target.classList.contains('env-task-cb')) {
          updateMergeButton();
          return;
        }
        if (target.matches && target.matches('[data-finding-idx]') && target.value === 'allowlist') {
          handleAllowlistFromFinding(target);
        }
      });

      document.addEventListener('click', function(event) {
        var target = event.target;
        if (!target) return;
        if (target.closest('[data-stop-row-toggle]')) return;

        var detailTrigger = target.closest('[data-toggle-detail]');
        if (detailTrigger) {
          toggleDetail(detailTrigger.getAttribute('data-toggle-detail'));
          return;
        }

        var historyAction = target.closest('[data-history-action]');
        if (historyAction) {
          var action = historyAction.getAttribute('data-history-action');
          var findingId = historyAction.getAttribute('data-finding-id');
          if (action === 'revoke') {
            openRevokeModal(
              findingId,
              historyAction.getAttribute('data-provider-name'),
              historyAction.getAttribute('data-steps'),
              historyAction.getAttribute('data-note'),
              historyAction.getAttribute('data-url'),
              historyAction.getAttribute('data-cli-steps'),
              historyAction.getAttribute('data-usage-check-url'),
              historyAction.getAttribute('data-usage-check-note')
            );
            return;
          }
          if (action === 'store') {
            storeHistoryFinding(findingId);
            return;
          }
          if (action === 'dismiss') {
            dismissHistoryFinding(findingId, historyAction);
            return;
          }
        }

        var allowlistDelete = target.closest('[data-allowlist-delete]');
        if (allowlistDelete) {
          deleteAllowlistEntry(allowlistDelete.getAttribute('data-allowlist-delete'));
          return;
        }

        var copyBtn = target.closest('[data-copy-text]');
        if (copyBtn) {
          copyToClipboard(copyBtn.getAttribute('data-copy-text'));
        }
      });
    }

    // --- Init ---
    (async function init() {
      bindUiEvents();
      // Fetch user tier for feature gating
      try {
        userTier = normalizeTier(user.tier || user.plan);
        var billingRes = await apiFetch(API + '/billing/status');
        if (billingRes && billingRes.ok) {
          var billingData = await safeJson(billingRes);
          userTier = normalizeTier(
            billingData.tier ||
            billingData.plan ||
            (billingData.subscription && billingData.subscription.tier) ||
            (billingData.customer && billingData.customer.tier) ||
            userTier
          );
        }
        if (userTier === 'free' || userTier === 'starter') {
          var badge = document.getElementById('csvProBadge');
          if (badge) badge.classList.remove('hidden');
        }
      } catch(e) {}

      // Handle GitHub callback on page load
      var params = new URLSearchParams(window.location.search);
      var code = params.get('code');
      var state = params.get('state');
      if (code && state) {
        // Clean URL
        window.history.replaceState({}, '', window.location.pathname);
        await handleGitHubCallback(code, state);
        return;
      }

      // Check if already connected by trying to load repos
      var res = await apiFetch(API + '/scanner/repos');
      if (res && res.ok) {
        var data = await safeJson(res);
        allRepos = data.repos || data || [];
        if (data.username) {
          document.getElementById('ghUsername').textContent = data.username;
        }
        ghConnected = true;
        renderRepos(allRepos);
        showState('repo-list');
        loadScanHistory();
      } else {
        showState('not-connected');
      }
    })();
