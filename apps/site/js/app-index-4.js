// ── Auth ──
    const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
    // Route stats through the main API worker so browser code doesn't call init
    // routes directly across origins.
    const INIT_API = API;
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

    // Shared UI helpers
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
      inner.className = `flex items-center gap-3 px-4 py-3 rounded-lg border text-sm shadow-lg backdrop-blur-sm ${styles[type] || styles.error}`;
      toast.classList.remove('hidden');
      clearTimeout(toast._timer);
      toast._timer = setTimeout(() => toast.classList.add('hidden'), 5000);
    }

    function showSessionExpired() {
      document.getElementById('sessionExpired').classList.remove('hidden');
    }


    // ── User info ──
    const email = user.email || '';
    document.getElementById('sidebarEmail').textContent = email || 'user@example.com';
    document.getElementById('userAvatar').textContent = (email || 'U').charAt(0).toUpperCase();

    // ── Sidebar ──
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const mainWrapper = document.getElementById('mainWrapper');

    document.getElementById('menuBtn').addEventListener('click', toggleMobileSidebar);
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', logout);

    function toggleMobileSidebar() {
      sidebar.classList.toggle('-translate-x-full');
      overlay.classList.toggle('hidden');
    }

    // Collapse sidebar on screens < 1024
    function handleResize() {
      if (window.innerWidth < 1024) {
        sidebar.classList.add('-translate-x-full');
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded');
        mainWrapper.style.marginLeft = '0';
        overlay.classList.add('hidden');
      } else {
        sidebar.classList.remove('-translate-x-full');
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded');
        mainWrapper.style.marginLeft = '220px';
      }
    }
    window.addEventListener('resize', handleResize);
    handleResize();

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

    // ── API helper ──

    async function apiFetch(path) {
      try {
        const res = await fetch(`${API}${path}`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.status === 401) {
          if (!_refreshAttempted) {
            _refreshAttempted = true;
            const refreshed = await tryRefreshToken();
            if (refreshed) return apiFetch(path);
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
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      } catch (e) {
        if (e.message && e.message.startsWith('HTTP')) {
          showToast('Something went wrong on our end', 'error');
        } else {
          showToast('Connection lost — check your internet', 'error');
        }
        return null;
      }
    }

    async function apiFetchInit(path) {
      try {
        const res = await fetch(`${INIT_API}${path}`, {
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
        });
        if (res.status === 401) {
          if (!_refreshAttempted) {
            _refreshAttempted = true;
            const refreshed = await tryRefreshToken();
            if (refreshed) return apiFetchInit(path);
          }
          _refreshAttempted = false;
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

    function normalizeOverviewData(data) {
      const safe = data || {};
      return {
        totalKeys: Number(safe.totalKeys || 0),
        activeApps: Number(safe.activeApps || safe.providerCount || 0),
        totalCalls: Number(safe.totalCalls || 0),
        errorRate: Number(safe.errorRate || 0),
        recentActivity: Array.isArray(safe.recentActivity) ? safe.recentActivity : [],
      };
    }

    function normalizeUsageData(data) {
      const rows = (data && (data.usage || data.days)) || [];
      return rows
        .filter((row) => row && row.date)
        .map((row) => ({
          date: row.date,
          calls: Number(row.calls || 0),
          errors: Number(row.errors || 0),
        }));
    }

    function normalizeKeyData(data) {
      const rows = (data && data.keys) || [];
      return rows.filter((key) => key && key.id);
    }

    // ── Utilities ──
    function escapeHtml(str) {
      return (str == null ? '' : String(str))
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function relativeTime(ts) {
      if (!ts) return '--';
      const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
      if (diff < 60) return `${diff}s ago`;
      if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
      if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
      return `${Math.floor(diff / 86400)}d ago`;
    }

    function formatDate(ts) {
      if (!ts) return '--';
      return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function formatNumber(n) {
      if (n == null) return '0';
      return Number(n).toLocaleString();
    }

    function providerColor(p) {
      // All providers use indigo — differentiated by label text, not color
      return { bg: 'bg-indigo-500/10', text: 'text-indigo-400', border: 'border-indigo-500/20' };
    }

    function activityColor(type) {
      const map = {
        api_call: { bg: 'bg-indigo-500/15', text: 'text-indigo-400', dot: 'bg-indigo-400' },
        transparent_proxy: { bg: 'bg-cyan-500/15', text: 'text-cyan-400', dot: 'bg-cyan-400' },
        key_retrieval: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
        key_retrieval_batch: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: 'bg-emerald-400' },
        key_rotation: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: 'bg-amber-400' },
        nullifier_claim: { bg: 'bg-purple-500/15', text: 'text-purple-400', dot: 'bg-purple-400' },
        revoke: { bg: 'bg-red-500/15', text: 'text-red-400', dot: 'bg-red-400' },
      };
      return map[type] || { bg: 'bg-gray-500/15', text: 'text-gray-400', dot: 'bg-gray-400' };
    }

    // ── Sparkline renderer ──
    function drawSparkline(canvas, data, color) {
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width;
      const h = canvas.height;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);

      if (!data || data.length < 2) return;
      const max = Math.max(...data, 1);
      const min = Math.min(...data, 0);
      const range = max - min || 1;
      const step = w / (data.length - 1);

      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      data.forEach((v, i) => {
        const x = i * step;
        const y = h - ((v - min) / range) * (h - 2) - 1;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }

    // ── Load Overview Stats ──
    async function loadOverview() {
      const [dataRaw, usageRaw] = await Promise.all([
        apiFetchInit('/stats/overview'),
        apiFetchInit('/stats/usage?days=10'),
      ]);
      const data = normalizeOverviewData(dataRaw);
      if (!dataRaw) {
        showToast('Unable to load live dashboard stats', 'warning');
      }

      document.getElementById('statKeys').textContent = formatNumber(data.totalKeys);
      document.getElementById('statApps').textContent = formatNumber(data.activeApps);
      document.getElementById('statCalls').textContent = formatNumber(data.totalCalls);
      document.getElementById('statErrors').textContent = (data.errorRate ?? 0).toFixed(1) + '%';

      const usageRows = normalizeUsageData(usageRaw);
      const sparkData = {
        keys: [],
        apps: [],
        calls: usageRows.map((d) => d.calls || 0),
        errors: usageRows.map((d) => d.errors || 0),
      };
      document.querySelectorAll('.sparkline').forEach(c => {
        const stat = c.dataset.stat;
        const colors = { keys: '#6366f1', apps: '#10b981', calls: '#06b6d4', errors: '#ef4444' };
        drawSparkline(c, sparkData[stat] || [], colors[stat] || '#6366f1');
      });

      // Activity feed
      loadActivityFeed(data.recentActivity || []);
    }

    function loadActivityFeed(events) {
      const feed = document.getElementById('activityFeed');
      if (!events.length) {
        feed.innerHTML = '<div class="text-center text-gray-600 text-sm py-8">No recent activity</div>';
        return;
      }
      const actionLabels = {
        api_call: 'API Call',
        transparent_proxy: 'Proxy Call',
        key_retrieval: 'Key Retrieved',
        key_retrieval_batch: 'Batch Retrieve',
        key_rotation: 'Key Rotated',
        nullifier_claim: 'ZK Proof Call',
        revoke: 'Key Revoked',
      };
      feed.innerHTML = events.map((ev, i) => {
        const type = ev.action || ev.type || 'unknown';
        const c = activityColor(type);
        const keyLabel = escapeHtml((ev.keySlot && ev.keySlot.label) || ev.keyLabel || '--');
        const provider = escapeHtml((ev.keySlot && ev.keySlot.provider) || '');
        let description = ev.description || '';
        if (!description && ev.metadata) {
          try {
            const meta = typeof ev.metadata === 'string' ? JSON.parse(ev.metadata) : ev.metadata;
            description = meta.endpoint || meta.provider || '';
          } catch {}
        }
        description = escapeHtml(description || provider || ev.appId || '--');
        return `
          <div class="flex gap-3 p-2.5 rounded-md hover:bg-white/[0.03] transition anim-fade-up" style="animation-delay:${600 + i * 80}ms">
            <div class="flex-shrink-0 mt-0.5">
              <div class="w-2 h-2 rounded-full ${c.dot} mt-1.5"></div>
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 mb-0.5">
                <span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${c.bg} ${c.text}">${actionLabels[type] || type}</span>
              </div>
              <p class="text-sm text-gray-300 truncate">${description}</p>
              <div class="flex items-center gap-2 mt-1 text-xs text-gray-500">
                <span>${relativeTime(ev.timestamp)}</span>
                <span class="text-gray-600">&middot;</span>
                <span class="font-mono text-gray-500 truncate">${keyLabel}</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    // ── Load Usage Chart ──
    let _usageChart = null;

    async function loadUsageChart() {
      const chartLoading = document.getElementById('chartLoading');
      chartLoading.classList.remove('hidden');
      chartLoading.innerHTML = '<div class="h-6 w-6 border-2 border-brand border-t-transparent rounded-full animate-spin"></div>';

      const numDays = document.getElementById('chartDays')?.value || '30';
      const dataRaw = await apiFetchInit('/stats/usage?days=' + numDays);
      const days = normalizeUsageData(dataRaw);

      if (!days.length) {
        if (_usageChart) { _usageChart.destroy(); _usageChart = null; }
        chartLoading.classList.remove('hidden');
        chartLoading.innerHTML = '<div class="text-sm text-gray-500">No usage data yet</div>';
        return;
      }

      const labels = days.map(d => {
        const dt = new Date(d.date);
        return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      });
      const callsData = days.map(d => d.calls || 0);
      const errorsData = days.map(d => d.errors || 0);

      if (_usageChart) { _usageChart.destroy(); _usageChart = null; }

      const ctx = document.getElementById('usageChart').getContext('2d');
      _usageChart = new Chart(ctx, {
        type: 'line',
        data: {
          labels,
          datasets: [
            {
              label: 'API Calls',
              data: callsData,
              borderColor: '#06b6d4',
              backgroundColor: 'rgba(6, 182, 212, 0.08)',
              fill: true,
              tension: 0.4,
              pointRadius: 0,
              pointHoverRadius: 5,
              pointHoverBackgroundColor: '#06b6d4',
              borderWidth: 2
            },
            {
              label: 'Errors',
              data: errorsData,
              borderColor: '#ef4444',
              backgroundColor: 'rgba(239, 68, 68, 0.05)',
              fill: false,
              tension: 0.4,
              pointRadius: 3,
              pointBackgroundColor: '#ef4444',
              pointBorderColor: '#ef4444',
              borderWidth: 1.5,
              pointHoverRadius: 6
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 1000, easing: 'easeOutQuart' },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              display: true,
              position: 'top',
              align: 'end',
              labels: {
                color: '#6b7280',
                font: { family: 'Inter', size: 12 },
                boxWidth: 12,
                boxHeight: 2,
                padding: 16
              }
            },
            tooltip: {
              backgroundColor: '#1e1e2e',
              titleColor: '#e5e7eb',
              bodyColor: '#9ca3af',
              borderColor: '#2a2a3a',
              borderWidth: 1,
              cornerRadius: 8,
              padding: 12,
              titleFont: { family: 'Inter', size: 13, weight: '600' },
              bodyFont: { family: 'Inter', size: 12 }
            }
          },
          scales: {
            x: {
              grid: { color: '#1e1e2e', drawBorder: false },
              ticks: {
                color: '#6b7280',
                font: { family: 'Inter', size: 11 },
                maxTicksLimit: 10
              },
              border: { display: false }
            },
            y: {
              grid: { color: '#1e1e2e', drawBorder: false },
              ticks: {
                color: '#6b7280',
                font: { family: 'Inter', size: 11 }
              },
              border: { display: false },
              beginAtZero: true
            }
          }
        }
      });
      chartLoading.classList.add('hidden');
    }

    // ── Load API Keys Table ──
    async function loadKeys() {
      const dataRaw = await apiFetchInit('/stats/by-key');
      const keys = normalizeKeyData(dataRaw);
      if (!dataRaw) showToast('Unable to load keys', 'warning');
      const tbody = document.getElementById('keysBody');

      if (!keys.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-10 text-center text-gray-600">
          No keys found. <a href="/app/keys" class="text-brand hover:underline">Create your first key</a>
        </td></tr>`;
        return;
      }

      tbody.innerHTML = keys.map((k, i) => {
        const pc = providerColor(k.provider);
        const isActive = (k.status || 'active').toLowerCase() === 'active';
        const masked = `${escapeHtml(k.keyPrefix || 'sk_live_')}${'••••'}${escapeHtml(k.keySuffix || '****')}`;
        return `
          <tr class="key-row border-b border-border/50 table-row-anim" style="animation-delay:${500 + i * 50}ms">
            <td class="px-4 py-3">
              <div class="font-medium text-sm">${escapeHtml(k.label || 'Unnamed Key')}</div>
              <div class="key-mask font-mono text-xs text-gray-500 mt-0.5 cursor-default">
                <span class="key-masked">${masked}</span>
              </div>
            </td>
            <td class="px-4 py-3">
              <span class="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border ${pc.bg} ${pc.text} ${pc.border}">${escapeHtml(k.provider || 'Unknown')}</span>
            </td>
            <td class="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">${formatDate(k.createdAt || k.created)}</td>
            <td class="px-4 py-3 text-gray-400 text-sm whitespace-nowrap">${k.lastUsed ? relativeTime(k.lastUsed) : 'Never'}</td>
            <td class="px-4 py-3 text-sm font-medium">${formatNumber(k.callsThisMonth)}</td>
            <td class="px-4 py-3">
              ${isActive
                ? '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"><span class="w-1.5 h-1.5 rounded-full bg-indigo-400 pulse-active"></span>Active</span>'
                : '<span class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20"><span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Revoked</span>'
              }
            </td>
            <td class="px-4 py-3">
              <div class="flex items-center gap-1">
                <button title="Rotate key" class="p-1.5 text-gray-500 hover:text-indigo-400 hover:bg-indigo-400/5 rounded-lg transition">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
                </button>
                <button title="Revoke key" class="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/5 rounded-lg transition">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/></svg>
                </button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    // ── Notifications ──
    const NOTIF_READ_KEY = 'vaultproof_notif_read';

    function getReadIds() {
      try { return JSON.parse(localStorage.getItem(NOTIF_READ_KEY) || '[]'); } catch { return []; }
    }

    async function loadNotifications() {
      try {
        const res = await fetch('/notifications.json?t=' + Date.now());
        if (!res.ok) return;
        const notifs = await res.json();
        const readIds = getReadIds();
        const unread = notifs.filter(n => !readIds.includes(n.id));

        // Show/hide red dot
        document.getElementById('notifDot').classList.toggle('hidden', unread.length === 0);

        // Render list
        const list = document.getElementById('notifList');
        if (notifs.length === 0) {
          list.innerHTML = '<div class="px-4 py-6 text-center text-sm text-gray-500">No notifications</div>';
          return;
        }

        const typeColors = {
          update: 'bg-indigo-500/20 text-indigo-400',
          maintenance: 'bg-gray-500/20 text-gray-400',
          alert: 'bg-red-500/20 text-red-400',
          info: 'bg-indigo-500/20 text-indigo-400'
        };

        list.innerHTML = notifs.map(n => {
          const isUnread = !readIds.includes(n.id);
          const colors = typeColors[n.type] || typeColors.info;
          const safeLink = n.link && /^(https:\/\/|\/[^\/])/.test(String(n.link).trim()) ? n.link : '';
          return `
            <div class="px-4 py-3 border-b border-border/50 hover:bg-white/[0.02] transition ${isUnread ? '' : 'opacity-60'}">
              <div class="flex items-start gap-3">
                ${isUnread ? '<span class="mt-1.5 w-2 h-2 rounded-full bg-brand flex-shrink-0"></span>' : '<span class="mt-1.5 w-2 h-2 flex-shrink-0"></span>'}
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-xs font-medium px-1.5 py-0.5 rounded ${colors}">${escapeHtml(n.type)}</span>
                    <span class="text-xs text-gray-600">${escapeHtml(n.date)}</span>
                  </div>
                  <p class="text-sm font-medium text-white">${escapeHtml(n.title)}</p>
                  <p class="text-xs text-gray-400 mt-0.5">${escapeHtml(n.message)}</p>
                  ${safeLink ? `<a href="${escapeHtml(safeLink)}" class="text-xs text-brand hover:text-brand-hover mt-1 inline-block">Learn more &rarr;</a>` : ''}
                </div>
              </div>
            </div>`;
        }).join('');
      } catch {}
    }

    function toggleNotifications() {
      const dd = document.getElementById('notifDropdown');
      dd.classList.toggle('hidden');
    }

    function markAllRead() {
      fetch('/notifications.json?t=' + Date.now())
        .then(r => r.json())
        .then(notifs => {
          localStorage.setItem(NOTIF_READ_KEY, JSON.stringify(notifs.map(n => n.id)));
          document.getElementById('notifDot').classList.add('hidden');
          loadNotifications();
        }).catch(() => {});
    }

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      const dd = document.getElementById('notifDropdown');
      const bell = document.getElementById('notifBell');
      if (!dd.contains(e.target) && !bell.contains(e.target)) {
        dd.classList.add('hidden');
      }
    });

    // ── Onboarding Checklist ──
    function dismissOnboarding() {
      localStorage.setItem('vaultproof_onboarding_dismissed', 'true');
      document.getElementById('onboardingChecklist').classList.add('hidden');
    }

    function markOnboardingStep(checkId, done) {
      const el = document.getElementById(checkId);
      if (!el) return;
      if (done) {
        el.classList.remove('border-gray-600', 'text-transparent');
        el.classList.add('border-indigo-500', 'bg-indigo-500', 'text-white');
      }
    }

    async function checkOnboarding() {
      if (localStorage.getItem('vaultproof_onboarding_dismissed') === 'true') return;

      // Step 1 (ran init): user has at least one project
      // Step 2 (keys stored): project has at least one protected key
      // Step 3 (first proxy call): usage has started
      let initOverview, initKeys;
      try { initOverview = await apiFetchInit('/stats/overview'); } catch { initOverview = null; }
      try { initKeys = await apiFetchInit('/stats/by-key'); } catch { initKeys = null; }

      const totalKeys = Number(initOverview?.totalKeys || (initKeys?.keys || []).length || 0);
      const totalCalls = Number(initOverview?.totalCalls || 0);
      const hasProject = Number(initOverview?.totalProjects || 0) > 0;
      const hasKeys = totalKeys > 0;
      const hasProxyCalls = totalCalls > 0;

      markOnboardingStep('onb-check-project', hasProject);
      markOnboardingStep('onb-check-storekey', hasKeys);
      markOnboardingStep('onb-check-proxy', hasProxyCalls);

      const allDone = hasProject && hasKeys && hasProxyCalls;
      if (allDone) return;

      document.getElementById('onboardingChecklist').classList.remove('hidden');
    }

    // ── Promo Feedback Nudge ──
    async function checkPromoFeedback() {
      try {
        const data = await apiFetch('/promo/feedback/status');
        if (!data) return;
        if (data.isPromo && !data.submittedThisWeek) {
          document.getElementById('feedbackNudge').classList.remove('hidden');
        }
      } catch (e) { /* silently ignore for non-promo users */ }
    }

    async function submitFeedback() {
      const text = document.getElementById('feedbackText').value.trim();
      if (!text) return;
      try {
        await fetch(`${API}/promo/feedback`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ feedback: text }),
        });
        document.getElementById('feedbackNudge').classList.add('hidden');
      } catch (e) { console.error('Feedback submit failed:', e); }
    }

    function dismissFeedback() {
      document.getElementById('feedbackNudge').classList.add('hidden');
    }

    // ── Welcome modal ──
    async function checkWelcome() {
      if (localStorage.getItem('vp_welcomed')) return;
      document.getElementById('welcomeModal').classList.remove('hidden');
    }

    function dismissWelcome() {
      localStorage.setItem('vp_welcomed', '1');
      document.getElementById('welcomeModal').classList.add('hidden');
      if (window.maybeStartAppTour) window.maybeStartAppTour();
    }

    async function redeemWelcomePromo() {
      const input = document.getElementById('welcomePromoInput');
      const code = input.value.trim().toUpperCase();
      const msg = document.getElementById('welcomePromoMsg');
      if (!code) { input.focus(); return; }
      if (!/^[A-Z0-9_-]{1,50}$/.test(code)) {
        msg.textContent = 'Invalid code format.';
        msg.className = 'text-xs text-red-400 mt-2';
        return;
      }
      const btn = document.getElementById('welcomePromoBtn');
      btn.disabled = true;
      btn.textContent = 'Redeeming…';
      msg.textContent = '';
      try {
        const res = await fetch(`${API}/promo/redeem`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          msg.textContent = 'Pro access activated — enjoy VaultProof!';
          msg.className = 'text-xs text-green-400 mt-2';
          btn.textContent = 'Redeemed!';
          input.disabled = true;
          localStorage.removeItem('vp_promo');
        } else {
          msg.textContent = data.error || 'Could not redeem code.';
          msg.className = 'text-xs text-red-400 mt-2';
          btn.disabled = false;
          btn.textContent = 'Apply';
        }
      } catch (e) {
        msg.textContent = 'Network error — try again.';
        msg.className = 'text-xs text-red-400 mt-2';
        btn.disabled = false;
        btn.textContent = 'Apply';
      }
    }

    // ── Init — load immediately, apiFetch retries once after refreshing auth ──
    loadOverview();
    loadUsageChart();
    loadKeys();
    loadNotifications();
    checkOnboarding();
    // checkPromoFeedback(); // PH promo ended
