(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const session = window.VaultProofSession;
  const ACCENT = '#00e5ff';
  const SUCCESS = '#22e6a8';
  const DANGER = '#fb7185';
  const GRID = 'rgba(148,163,184,0.14)';
  const MUTED = 'rgba(235,245,255,0.42)';
  const MAX_VISIBLE_ROWS = 120;

  let token = (session && session.getAccessToken())
    || localStorage.getItem('vaultproof_token');
  const user = (session && session.getUser())
    || JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let activityChart = null;
  let allLogs = [];
  let currentDays = '30';

  if (!token && !(session && session.hasRefreshToken())) {
    window.location.href = 'login';
    return;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function tryRefreshToken() {
    if (refreshPromise) return refreshPromise;

    refreshPromise = (async () => {
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
        refreshPromise = null;
      }
    })();

    return refreshPromise;
  }

  async function apiFetch(base, path) {
    try {
      const res = await fetch(`${base}${path}`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401) {
        if (!refreshAttempted) {
          refreshAttempted = true;
          const refreshed = await tryRefreshToken();
          if (refreshed) return apiFetch(base, path);
        }
        refreshAttempted = false;
        window.location.href = 'login';
        return null;
      }
      refreshAttempted = false;
      return res.ok ? res.json() : null;
    } catch {
      return null;
    }
  }

  function logout() {
    Object.keys(localStorage).forEach((key) => {
      if (key.includes('auth-token')) localStorage.removeItem(key);
    });
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('vaultproof_') || key.startsWith('sb-')) localStorage.removeItem(key);
    });
    sessionStorage.clear();
    window.location.replace('/app/login?logout=1');
  }

  function unwrapPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    if (data.data && typeof data.data === 'object') return unwrapPayload(data.data);
    if (data.result && typeof data.result === 'object') return unwrapPayload(data.result);
    return data;
  }

  function normalizeOverview(data) {
    const payload = unwrapPayload(data) || {};
    return {
      totalProjects: Number(payload.totalProjects || payload.total_projects || 0),
      totalKeys: Number(payload.totalKeys || payload.total_keys || 0),
      totalCalls: Number(payload.totalCalls || payload.total_calls || 0),
      providerCount: Number(payload.providerCount || payload.provider_count || payload.activeApps || 0),
      errorRate: Number(payload.errorRate || payload.error_rate || 0),
    };
  }

  function normalizeUsage(data) {
    const payload = unwrapPayload(data) || {};
    const rows = Array.isArray(payload.usage) ? payload.usage : Array.isArray(payload.days) ? payload.days : [];
    return rows.filter((row) => row && row.date).map((row) => ({
      date: row.date,
      calls: Number(row.calls || 0),
      errors: Number(row.errors || 0),
    }));
  }

  function normalizeProjects(data) {
    const payload = unwrapPayload(data) || {};
    const rows = Array.isArray(payload.projects) ? payload.projects : [];
    return rows.map((project) => ({
      id: project.id,
      name: project.name || project.vp_proj_id || project.id,
      vpProjId: project.vp_proj_id || project.vpProjId || project.id,
      calls30d: Number(project.calls30d || project.calls_30d || 0),
      keysCount: Number(project.keysCount || project.keys_count || 0),
      status: project.status || 'idle',
    }));
  }

  function normalizeSummary(data) {
    const payload = unwrapPayload(data) || {};
    return {
      overview: normalizeOverview(payload.overview || payload),
      usage: normalizeUsage(payload.usage || payload),
      projects: normalizeProjects(payload.projects ? { projects: payload.projects } : payload),
    };
  }

  function normalizeLogs(data) {
    const payload = unwrapPayload(data) || {};
    const rows = Array.isArray(payload.logs) ? payload.logs : [];
    return rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return {
        id: row.id || '',
        timestamp: row.timestamp || '',
        projectId: row.projectId || row.project_id || null,
        projectName: row.projectName || row.project_name || row.appName || 'unknown project',
        keySlotId: row.keySlotId || row.key_slot_id || null,
        keyLabel: row.keyLabel || row.key_label || '—',
        provider: row.provider || 'unknown',
        endpoint: row.endpoint || '—',
        status: row.status || 'ok',
        latency: row.latency == null ? null : Number(row.latency),
        requestId: metadata.upstream_request_id || metadata.request_id || '',
        metadata,
      };
    });
  }

  function formatNum(value) {
    const num = Number(value || 0);
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}k`;
    return num.toLocaleString('en-US');
  }

  function formatTimestamp(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return `${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
  }

  function relTime(value) {
    if (!value) return '—';
    const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function formatLatency(value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    return `${Math.round(Number(value))} ms`;
  }

  function formatClock(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatBytes(value) {
    const num = Number(value || 0);
    if (!Number.isFinite(num) || num <= 0) return '—';
    if (num >= 1024 * 1024 * 1024) return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (num >= 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(2)} MB`;
    if (num >= 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${Math.round(num)} B`;
  }

  function requestMethod(log) {
    const metadata = log.metadata || {};
    const raw = metadata.method || metadata.http_method || metadata.request_method || metadata.verb || '';
    if (raw) return String(raw).toUpperCase().slice(0, 6);
    const endpoint = String(log.endpoint || '').trim();
    const match = endpoint.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i);
    return match ? match[1].toUpperCase() : 'CALL';
  }

  function requestPath(log) {
    const metadata = log.metadata || {};
    const raw = metadata.path || metadata.url_path || metadata.route || log.endpoint || '';
    return String(raw).replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+/i, '') || 'request';
  }

  function requestStatusCode(log) {
    const metadata = log.metadata || {};
    const code = Number(metadata.status || metadata.status_code || metadata.http_status || metadata.upstream_status || 0);
    if (Number.isFinite(code) && code > 0) return code;
    return log.status === 'error' ? 500 : 200;
  }

  function statusBadge(status) {
    const cls = status === 'error' ? 'status-error' : 'status-ok';
    const label = status === 'error' ? 'error' : 'ok';
    return `<span class="status-badge ${cls}"><span>●</span>${label}</span>`;
  }

  function providerBadge(provider) {
    return `<span class="provider-badge">${escapeHtml(provider)}</span>`;
  }

  function buildChart(rows) {
    const canvas = document.getElementById('activityChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (activityChart) activityChart.destroy();

    activityChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rows.map((row) => new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [
          {
            label: 'calls',
            data: rows.map((row) => row.calls),
            borderColor: ACCENT,
            backgroundColor: 'rgba(0,229,255,0.08)',
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'errors',
            data: rows.map((row) => row.errors),
            borderColor: DANGER,
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { color: GRID },
            border: { display: false },
            ticks: { color: MUTED, font: { family: "'Geist Mono', ui-monospace, monospace", size: 10 }, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: GRID },
            border: { display: false },
            beginAtZero: true,
            ticks: {
              color: MUTED,
              font: { family: "'Geist Mono', ui-monospace, monospace", size: 10 },
              callback(value) {
                return value >= 1000 ? `${Math.round(value / 1000)}k` : value;
              },
            },
          },
        },
      },
    });
  }

  function renderKpis(summary, logs) {
    const calls30d = summary.usage.reduce((sum, row) => sum + row.calls, 0);
    const errors30d = summary.usage.reduce((sum, row) => sum + row.errors, 0);
    const successRate = calls30d > 0 ? ((calls30d - errors30d) / calls30d) * 100 : 100;
    const recent30dLogs = logs.filter((log) => Date.now() - new Date(log.timestamp).getTime() <= 30 * 24 * 60 * 60 * 1000);
    const avgLatency = recent30dLogs.length
      ? recent30dLogs.reduce((sum, log) => sum + (Number.isFinite(log.latency) ? log.latency : 0), 0) / recent30dLogs.filter((log) => Number.isFinite(log.latency)).length || 0
      : 0;
    const activeProjects = summary.projects.filter((project) => project.calls30d > 0).length;

    setText('kpi-events', formatNum(calls30d));
    setText('kpi-events-sub', `${formatNum(errors30d)} error${errors30d === 1 ? '' : 's'} in the same window`);
    setText('kpi-success', `${successRate.toFixed(1)}%`);
    setText('kpi-success-sub', errors30d > 0 ? `${formatNum(errors30d)} failed calls` : 'clean request stream');
    setText('kpi-latency', avgLatency > 0 ? `${Math.round(avgLatency)} ms` : '—');
    setText('kpi-latency-sub', recent30dLogs.length ? 'average across recent requests' : 'no recent latency samples');
    setText('kpi-projects', formatNum(activeProjects));
    setText('kpi-projects-sub', `${formatNum(summary.projects.length)} total projects`);
    setText('pageMeta', `/ ${formatNum(logs.length)} loaded logs · ${formatNum(summary.overview.totalCalls)} all-time requests`);
    setText('streamStatus', logs.length ? `${formatNum(logs.length)} loaded` : 'no traffic');
  }

  function populateFilters(logs) {
    const projectSelect = document.getElementById('projectFilter');
    const providerSelect = document.getElementById('providerFilter');
    const projectMap = new Map();
    const providerSet = new Set();

    logs.forEach((log) => {
      if (log.projectId || log.projectName) {
        projectMap.set(log.projectId || log.projectName, log.projectName || 'unknown project');
      }
      if (log.provider) providerSet.add(log.provider);
    });

    projectSelect.innerHTML = '<option value="">All projects</option>' +
      Array.from(projectMap.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([value, label]) => (
        `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
      )).join('');

    providerSelect.innerHTML = '<option value="">All providers</option>' +
      Array.from(providerSet).sort().map((provider) => (
        `<option value="${escapeHtml(provider)}">${escapeHtml(provider)}</option>`
      )).join('');
  }

  function getFilteredLogs() {
    const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const project = document.getElementById('projectFilter').value;
    const provider = document.getElementById('providerFilter').value;
    const status = document.getElementById('statusFilter').value;

    let cutoff = 0;
    if (currentDays !== 'all') {
      cutoff = Date.now() - (Number(currentDays) * 24 * 60 * 60 * 1000);
    }

    return allLogs.filter((log) => {
      if (project && String(log.projectId || log.projectName) !== project) return false;
      if (provider && log.provider !== provider) return false;
      if (status && log.status !== status) return false;
      if (cutoff && new Date(log.timestamp).getTime() < cutoff) return false;
      if (!search) return true;

      const haystack = [
        log.projectName,
        log.provider,
        log.keyLabel,
        log.endpoint,
        log.requestId,
      ].join(' ').toLowerCase();

      return haystack.includes(search);
    });
  }

  function renderTable(logs) {
    const rowsEl = document.getElementById('activityRows');
    if (!logs.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty-state">No requests match the current filters.</td></tr>';
      return;
    }

    const visible = logs.slice(0, MAX_VISIBLE_ROWS);
    rowsEl.innerHTML = visible.map((log) => {
      const latencyClass = Number(log.latency) >= 2000 ? 'latency-hot' : Number(log.latency) >= 800 ? 'latency-warm' : '';
      return `
        <tr>
          <td class="mono">${escapeHtml(formatTimestamp(log.timestamp))}</td>
          <td>
            <div class="project-name">${escapeHtml(log.projectName || 'unknown project')}</div>
            <div class="project-id">${escapeHtml(log.projectId || '—')}</div>
          </td>
          <td>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">${providerBadge(log.provider)}<span class="mono">${escapeHtml(log.keyLabel)}</span></div>
          </td>
          <td class="endpoint">${escapeHtml(log.endpoint)}</td>
          <td>${statusBadge(log.status)}</td>
          <td class="mono ${latencyClass}">${escapeHtml(formatLatency(log.latency))}</td>
          <td class="request-id">${escapeHtml(log.requestId || '—')}</td>
        </tr>`;
    }).join('');
  }

  function renderEndpointPanel(logs) {
    const list = document.getElementById('endpointList');
    const counts = new Map();
    logs.forEach((log) => {
      const current = counts.get(log.endpoint) || { count: 0, errors: 0 };
      current.count += 1;
      if (log.status === 'error') current.errors += 1;
      counts.set(log.endpoint, current);
    });
    const rows = Array.from(counts.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6);

    setText('endpointCount', rows.length ? `${rows.length} hot paths` : 'quiet');

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No endpoint activity yet.</div>';
      return;
    }

    list.innerHTML = rows.map(([endpoint, value], index) => `
      <div class="stack-row">
        <div class="stack-rank">${index + 1}</div>
        <div class="stack-main">
          <div class="stack-title">${escapeHtml(endpoint)}</div>
          <div class="stack-sub">${formatNum(value.errors)} errors</div>
        </div>
        <div class="stack-value">${formatNum(value.count)}</div>
      </div>
    `).join('');
  }

  function renderErrorPanel(logs) {
    const list = document.getElementById('errorList');
    const errors = logs.filter((log) => log.status === 'error').slice(0, 6);
    setText('errorCount', errors.length ? `${formatNum(errors.length)} visible` : 'clean');

    if (!errors.length) {
      list.innerHTML = '<div class="empty-state">No recent request errors in this view.</div>';
      return;
    }

    list.innerHTML = errors.map((log, index) => `
      <div class="stack-row">
        <div class="stack-rank">${index + 1}</div>
        <div class="stack-main">
          <div class="stack-title">${escapeHtml(log.projectName)}</div>
          <div class="stack-sub">${escapeHtml(log.endpoint)} · ${escapeHtml(relTime(log.timestamp))}</div>
        </div>
        <div class="stack-value" style="color:var(--danger)">${escapeHtml(formatLatency(log.latency))}</div>
      </div>
    `).join('');
  }

  function renderFilterNote(logs) {
    const total = logs.length;
    const showing = Math.min(total, MAX_VISIBLE_ROWS);
    const parts = [`showing ${formatNum(showing)} of ${formatNum(total)}`];
    if (currentDays !== 'all') parts.push(`${currentDays}d window`);
    setText('filterNote', parts.join(' · '));
  }

  function renderLivePanel(logs) {
    const feed = document.getElementById('liveApiFeed');
    if (!feed) return;

    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recent = logs
      .filter((log) => {
        const time = new Date(log.timestamp).getTime();
        return Number.isFinite(time) && time >= oneHourAgo;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const statuses = recent.map(requestStatusCode);
    const errors = statuses.filter((status) => status >= 400).length;
    const errorRate = statuses.length ? (errors / statuses.length) * 100 : 0;
    const throttled = statuses.filter((status) => status === 429).length;
    const cacheRows = recent
      .map((log) => log.metadata && (log.metadata.cache_hit ?? log.metadata.cacheHit))
      .filter((value) => value !== undefined && value !== null);
    const cacheHits = cacheRows.filter((value) => value === true || value === 'true' || value === 1 || value === 'hit').length;
    const totalBytes = recent.reduce((sum, log) => {
      const metadata = log.metadata || {};
      return sum + Number(metadata.bytes || metadata.response_bytes || metadata.responseBytes || metadata.size || 0);
    }, 0);

    setText('liveErrorRate', statuses.length ? `${errorRate < 0.01 && errorRate > 0 ? '<0.01' : errorRate.toFixed(errorRate < 1 ? 2 : 1)}%` : '—');
    setText('liveActiveConns', statuses.length ? formatNum(statuses.length) : '—');
    setText('liveCacheHit', cacheRows.length ? `${((cacheHits / cacheRows.length) * 100).toFixed(1)}%` : '—');
    setText('liveBandwidth', formatBytes(totalBytes));
    setText('liveThrottled', statuses.length ? String(throttled) : '—');

    const rows = recent.slice(0, 22);
    if (!rows.length) {
      feed.innerHTML = '<div class="live-api-empty">No user API calls in the last hour. Calls will appear here after this account routes traffic through VaultProof.</div>';
      return;
    }

    feed.innerHTML = rows.map((log) => {
      const status = requestStatusCode(log);
      const statusClass = status >= 500 ? 'status-error' : status >= 400 ? 'status-warn' : '';
      return `
        <div class="live-api-row">
          <span class="live-time">${escapeHtml(formatClock(log.timestamp))}</span>
          <span class="live-method">${escapeHtml(requestMethod(log))}</span>
          <span class="live-path">${escapeHtml(requestPath(log))}</span>
          <span class="live-status ${statusClass}">${escapeHtml(status)}</span>
        </div>`;
    }).join('');
  }

  function renderAll() {
    const filtered = getFilteredLogs();
    renderFilterNote(filtered);
    renderTable(filtered);
    renderEndpointPanel(filtered);
    renderErrorPanel(filtered);
    renderLivePanel(allLogs);
  }

  function renderUnavailableState() {
    ['kpi-events', 'kpi-success', 'kpi-latency', 'kpi-projects'].forEach((id) => setText(id, '—'));
    [
      ['kpi-events-sub', 'activity data unavailable'],
      ['kpi-success-sub', 'activity data unavailable'],
      ['kpi-latency-sub', 'activity data unavailable'],
      ['kpi-projects-sub', 'activity data unavailable'],
    ].forEach(([id, value]) => setText(id, value));
    setText('pageMeta', '/ activity unavailable');
    setText('streamStatus', 'unavailable');
    setText('filterNote', 'could not load activity');
    setText('endpointCount', 'unavailable');
    setText('errorCount', 'unavailable');
    const rowsEl = document.getElementById('activityRows');
    const endpointList = document.getElementById('endpointList');
    const errorList = document.getElementById('errorList');
    if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="7" class="empty-state">We could not load activity right now.</td></tr>';
    if (endpointList) endpointList.innerHTML = '<div class="empty-state">Endpoint data is unavailable right now.</div>';
    if (errorList) errorList.innerHTML = '<div class="empty-state">Error data is unavailable right now.</div>';
    renderLivePanel([]);
  }

  function exportCsv() {
    const logs = getFilteredLogs();
    const rows = [
      ['timestamp', 'project_name', 'project_id', 'provider', 'key_label', 'endpoint', 'status', 'latency_ms', 'request_id'],
      ...logs.map((log) => [
        log.timestamp,
        log.projectName,
        log.projectId || '',
        log.provider,
        log.keyLabel,
        log.endpoint,
        log.status,
        log.latency == null ? '' : String(log.latency),
        log.requestId || '',
      ]),
    ];

    const csv = rows.map((row) => row.map((value) => {
      const stringValue = String(value == null ? '' : value);
      return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
    }).join(',')).join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'vaultproof-activity.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadActivity);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCsv);

    ['searchInput', 'projectFilter', 'providerFilter', 'statusFilter'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', renderAll);
      el.addEventListener('change', renderAll);
    });

    document.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
        chip.classList.add('active');
        currentDays = chip.getAttribute('data-days') || '30';
        renderAll();
      });
    });
  }

  function initHeader() {
    const email = user.email || '';
    setText('user-email', email || 'unknown user');
  }

  async function loadActivity() {
    setText('pageMeta', '/ loading…');
    setText('streamStatus', 'loading…');
    setText('filterNote', 'loading activity…');

    const [summaryRaw, logsRaw] = await Promise.all([
      apiFetch(INIT_API, '/projects/stats/dashboard?days=30&limit=12'),
      apiFetch(INIT_API, '/projects/stats/logs?days=90&limit=1000'),
    ]);

    if (!summaryRaw && !logsRaw) {
      allLogs = [];
      renderUnavailableState();
      buildChart([]);
      return;
    }

    const summary = normalizeSummary(summaryRaw);
    const logs = normalizeLogs(
      logsRaw || (summaryRaw && typeof summaryRaw === 'object' && Array.isArray(summaryRaw.logs)
        ? { logs: summaryRaw.logs }
        : null)
    );
    allLogs = logs;

    renderKpis(summary, logs);
    buildChart(summary.usage);
    populateFilters(logs);
    renderAll();
  }

  initHeader();
  bindEvents();
  loadActivity();
})();
