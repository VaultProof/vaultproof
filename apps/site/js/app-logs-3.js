const API = window.location.hostname.includes('dev.vaultproof') ? 'https://staging-api.vaultproof.dev/api/v1' : 'https://api.vaultproof.dev/api/v1';
    let token = localStorage.getItem('vaultproof_token');
    const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
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
        if (key.startsWith('vaultproof_') || key.startsWith('sb-')) localStorage.removeItem(key);
      });
      sessionStorage.clear();
      window.location.href = 'login';
    }


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

    function formatTime(ts) {
      if (!ts) return '—';
      const d = new Date(ts);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + ' ' +
             d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function escapeHtml(str) {
      return (str == null ? '' : String(str))
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    }

    function providerBadge(provider) {
      const c = 'bg-indigo-900/50 text-indigo-400 border-indigo-800';
      return `<span class="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium border ${c}">${escapeHtml(provider || 'Unknown')}</span>`;
    }

    function statusBadge(status) {
      if ((status || '').toString().toLowerCase() === 'success' || (status || '').toString().toLowerCase() === 'ok' || status === 200 || status === '200') {
        return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-indigo-900/40 text-indigo-400 border border-indigo-800">
          <span class="w-1.5 h-1.5 rounded-full bg-indigo-400"></span>Success</span>`;
      }
      return `<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-red-900/40 text-red-400 border border-red-800">
        <span class="w-1.5 h-1.5 rounded-full bg-red-400"></span>Error</span>`;
    }

    function zkBadge(verified) {
      if (verified) {
        return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-[#6366f1]/15 text-[#6366f1] border border-indigo-800">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>Verified</span>`;
      }
      return `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-medium bg-gray-800/30 text-gray-500 border border-gray-700/30">Pending</span>`;
    }

    let allLogs = [];
    let allKeys = [];
    let currentPage = 1;
    let currentDateFilter = '30';
    const PAGE_SIZE = 25;

    function setDateFilter(value) {
      currentDateFilter = value;
      document.querySelectorAll('.date-pill').forEach(pill => {
        pill.classList.toggle('active', pill.dataset.days === value);
      });
      currentPage = 1;
      renderLogs();
    }

    function getFilteredLogs() {
      const search = document.getElementById('searchInput').value.toLowerCase();
      const keyFilter = document.getElementById('filterKey').value;
      const statusFilter = document.getElementById('filterStatus').value;
      const dateFilter = currentDateFilter;

      let logs = [...allLogs];

      if (search) {
        logs = logs.filter(l =>
          (l.appName || '').toLowerCase().includes(search) ||
          (l.keyLabel || '').toLowerCase().includes(search) ||
          (l.endpoint || '').toLowerCase().includes(search)
        );
      }

      if (keyFilter) {
        logs = logs.filter(l => l.keySlotId === keyFilter || l.keyLabel === keyFilter);
      }

      if (statusFilter) {
        logs = logs.filter(l => {
          const s = (l.status || '').toString().toLowerCase();
          if (statusFilter === 'success') return s === 'success' || s === 'ok' || s === '200';
          return s !== 'success' && s !== 'ok' && s !== '200';
        });
      }

      if (dateFilter !== 'all') {
        const days = parseInt(dateFilter);
        const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
        logs = logs.filter(l => new Date(l.timestamp).getTime() >= cutoff);
      }

      return logs;
    }

    function renderLogs() {
      const filtered = getFilteredLogs();
      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (currentPage > totalPages) currentPage = totalPages;

      const start = (currentPage - 1) * PAGE_SIZE;
      const page = filtered.slice(start, start + PAGE_SIZE);

      const tbody = document.getElementById('logsBody');
      const emptyState = document.getElementById('emptyState');
      const tableWrap = tbody.closest('.bg-\\[\\#111118\\]');

      if (allLogs.length === 0) {
        tbody.closest('table').closest('.bg-\\[\\#111118\\]').classList.add('hidden');
        emptyState.classList.remove('hidden');
        document.getElementById('paginationWrap').style.display = 'none';
        return;
      }

      tbody.closest('table').closest('.overflow-hidden').parentElement.classList.remove('hidden');
      emptyState.classList.add('hidden');

      if (page.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="px-5 py-16 text-center text-gray-600">
          <div class="flex flex-col items-center gap-3">
            <svg class="w-8 h-8 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <span>No logs match your filters</span>
          </div>
        </td></tr>`;
      } else {
        tbody.innerHTML = page.map((l, i) => `
          <tr class="border-b border-[#1e1e2e]/50 bg-[#111118] row-hover hover:bg-[#6366f1]/[0.03] transition-all row-animate" style="animation-delay: ${i * 30}ms">
            <td class="px-5 py-3.5 text-gray-400 whitespace-nowrap text-xs">${formatTime(l.timestamp)}</td>
            <td class="px-5 py-3.5 whitespace-nowrap">
              <div class="flex items-center gap-2">
                ${providerBadge(l.provider)}
                <span class="text-gray-300 text-xs">${escapeHtml(l.keyLabel || '—')}</span>
              </div>
            </td>
            <td class="px-5 py-3.5 text-gray-300 whitespace-nowrap text-sm">${escapeHtml(l.appName || '—')}</td>
            <td class="px-5 py-3.5 text-gray-400 whitespace-nowrap font-mono text-xs">${escapeHtml(l.endpoint || '—')}</td>
            <td class="px-5 py-3.5 whitespace-nowrap">${statusBadge(l.status)}</td>
            <td class="px-5 py-3.5 text-gray-400 whitespace-nowrap text-sm font-mono">${l.latency != null && isFinite(Number(l.latency)) ? String(Number(l.latency)) + '<span class="text-gray-600 text-xs ml-0.5">ms</span>' : '—'}</td>
            <td class="px-5 py-3.5 whitespace-nowrap">${zkBadge(l.zkProofVerified)}</td>
          </tr>
        `).join('');
      }

      // Pagination
      const wrap = document.getElementById('paginationWrap');
      wrap.style.display = filtered.length > 0 ? 'flex' : 'none';
      document.getElementById('paginationInfo').textContent = `Page ${currentPage} of ${totalPages} — ${filtered.length} total logs`;
      document.getElementById('prevBtn').disabled = currentPage <= 1;
      document.getElementById('nextBtn').disabled = currentPage >= totalPages;
    }

    function changePage(delta) {
      currentPage += delta;
      renderLogs();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Event listeners
    document.getElementById('searchInput').addEventListener('input', () => { currentPage = 1; renderLogs(); });
    document.getElementById('filterKey').addEventListener('change', () => { currentPage = 1; renderLogs(); });
    document.getElementById('filterStatus').addEventListener('change', () => { currentPage = 1; renderLogs(); });

    function exportCSV() {
      const filtered = getFilteredLogs();
      if (filtered.length === 0) { alert('No logs to export.'); return; }

      const headers = ['Timestamp', 'Provider', 'Key Label', 'App', 'Endpoint', 'Status', 'Latency (ms)', 'ZK Proof Verified'];
      const rows = filtered.map(l => [
        l.timestamp || '',
        l.provider || '',
        l.keyLabel || '',
        l.appName || '',
        l.endpoint || '',
        l.status || '',
        l.latency != null ? l.latency : '',
        l.zkProofVerified ? 'Yes' : 'No'
      ]);

      const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `vaultproof-logs-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }

    async function loadLogs() {
      try {
        const keysData = await apiFetch('/stats/by-key');
        if (!keysData || !keysData.keys) {
          allLogs = [];
          renderLogs();
          return;
        }

        allKeys = keysData.keys;

        // Populate key filter dropdown
        const filterKey = document.getElementById('filterKey');
        allKeys.forEach(k => {
          const opt = document.createElement('option');
          opt.value = k.id || k.keySlotId || k.label;
          opt.textContent = `${k.provider ? k.provider + ' — ' : ''}${k.label || 'Unnamed'}`;
          filterKey.appendChild(opt);
        });

        // Fetch logs for each key in parallel
        const logPromises = allKeys.map(async (k) => {
          const keyId = k.id || k.keySlotId;
          if (!keyId) return [];
          try {
            const data = await apiFetch(`/keys/${keyId}/logs`);
            const logs = Array.isArray(data) ? data : (data && data.logs ? data.logs : []);
            return logs.map(l => {
              let meta = {};
              try { meta = typeof l.metadata === 'string' ? JSON.parse(l.metadata) : (l.metadata || {}); } catch {}
              return {
                ...l,
                keyLabel: l.keyLabel || k.label,
                provider: l.provider || meta.provider || k.provider,
                keySlotId: keyId,
                appName: l.appName || l.appId || '—',
                endpoint: l.endpoint || meta.endpoint || l.action || '—',
                status: l.status || meta.status_code || meta.status || (l.action === 'api_call' || l.action === 'transparent_proxy' ? 'ok' : '—'),
                latency: l.latency ?? meta.latency_ms ?? meta.latencyMs ?? null,
                zkProofVerified: l.zkProofVerified ?? (l.action === 'nullifier_claim' || meta.zkProof ? true : null),
              };
            });
          } catch (e) {
            console.warn(`Failed to fetch logs for key ${keyId}:`, e);
            return [];
          }
        });

        const results = await Promise.all(logPromises);
        allLogs = results.flat().sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        currentPage = 1;
        renderLogs();
      } catch (e) {
        console.error('Failed to load logs:', e);
        document.getElementById('logsBody').innerHTML = '<tr><td colspan="7" class="text-center py-8"><div class="text-gray-400 mb-3">Unable to load logs</div><button onclick="loadLogs()" class="px-4 py-2 bg-[#6366f1]/20 border border-[#6366f1]/30 text-[#6366f1] rounded-xl text-sm hover:bg-[#6366f1]/30 transition">Retry</button></td></tr>';
      }
    }

    loadLogs();
