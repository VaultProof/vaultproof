(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
  const ACCENT = '#d97706';
  const CALL_LIMITS = {
    free: 10000,
    starter: 50000,
    pro: 500000,
    team: 2000000,
    enterprise: Infinity,
  };
  const MAX_VISIBLE_ROWS = 120;
  const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
  const SEVERITY_STYLES = {
    critical: { label: 'critical', color: '#b91c1c', bg: 'rgba(185,28,28,0.08)', rank: 4 },
    high: { label: 'high', color: '#c2410c', bg: 'rgba(194,65,12,0.08)', rank: 3 },
    medium: { label: 'medium', color: '#a16207', bg: 'rgba(161,98,7,0.08)', rank: 2 },
    low: { label: 'low', color: '#525252', bg: 'rgba(82,82,82,0.08)', rank: 1 },
  };

  let token = localStorage.getItem('vaultproof_token');
  const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let alertsChart = null;
  let allAlerts = [];
  let currentDays = '30';

  if (!token) {
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

  function extractRefreshToken(value) {
    if (!value) return null;
    if (typeof value === 'string') {
      try {
        return extractRefreshToken(JSON.parse(value));
      } catch {
        return null;
      }
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
    return localStorage.getItem('vaultproof_refresh_token') ||
      extractRefreshToken(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
  }

  async function tryRefreshToken() {
    if (refreshPromise) return refreshPromise;
    const refreshToken = getStoredRefreshToken();
    if (!refreshToken) return false;

    refreshPromise = (async () => {
      try {
        const res = await fetch(`${API}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const data = await res.json().catch(() => null);
        if (!data || !data.token) return false;
        token = data.token;
        localStorage.setItem('vaultproof_token', data.token);
        if (data.refreshToken) localStorage.setItem('vaultproof_refresh_token', data.refreshToken);
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
      totalCalls: Number(payload.totalCalls || payload.total_calls || 0),
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
    }));
  }

  function normalizeSummary(data) {
    const payload = unwrapPayload(data) || {};
    return {
      overview: normalizeOverview(payload.overview || payload),
      usage: normalizeUsage(payload.usage || payload),
      projects: normalizeProjects(payload.projects ? { projects: payload.projects } : payload),
      logs: normalizeLogs(payload.logs || payload),
    };
  }

  function normalizeLogs(data) {
    const payload = unwrapPayload(data) || {};
    const rows = Array.isArray(payload.logs)
      ? payload.logs
      : Array.isArray(payload.items)
        ? payload.items
        : Array.isArray(payload)
          ? payload
          : [];
    return rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
      return {
        id: row.id || '',
        timestamp: row.timestamp || '',
        projectId: row.projectId || row.project_id || null,
        projectName: row.projectName || row.project_name || row.appName || 'unknown project',
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

  function normalizeScans(data) {
    const payload = unwrapPayload(data) || {};
    if (Array.isArray(payload.scans)) return payload.scans;
    if (Array.isArray(payload.items)) return payload.items;
    return Array.isArray(payload) ? payload : [];
  }

  function resolveTier(billing) {
    const payload = unwrapPayload(billing) || {};
    const raw = String(
      payload.tier ||
      payload.plan ||
      payload.subscriptionTier ||
      payload.subscription?.tier ||
      payload.customer?.tier ||
      user.tier ||
      user.plan ||
      ''
    ).trim().toLowerCase();

    if (raw.includes('enterprise')) return 'enterprise';
    if (raw.includes('team')) return 'team';
    if (raw.includes('pro')) return 'pro';
    if (raw.includes('starter')) return 'starter';
    return 'free';
  }

  function formatTierLabel(tier) {
    return tier === 'free' ? 'free plan' : `${tier} plan`;
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

  function extractTimestamp() {
    for (let i = 0; i < arguments.length; i += 1) {
      const value = arguments[i];
      if (!value) continue;
      const ts = new Date(value).getTime();
      if (!Number.isNaN(ts)) return ts;
    }
    return null;
  }

  function getSeverityMeta(level) {
    return SEVERITY_STYLES[level] || SEVERITY_STYLES.low;
  }

  function severityFromCount(count) {
    if (count >= 10) return SEVERITY_STYLES.critical;
    if (count >= 5) return SEVERITY_STYLES.high;
    if (count >= 2) return SEVERITY_STYLES.medium;
    return SEVERITY_STYLES.low;
  }

  function parseSeverity(value) {
    const level = String(value || '').trim().toLowerCase();
    if (SEVERITY_STYLES[level]) return SEVERITY_STYLES[level];
    return null;
  }

  function getFindingCount(scan) {
    return Number(scan.findings_count != null ? scan.findings_count : Array.isArray(scan.findings) ? scan.findings.length : 0);
  }

  function getRepoName(scan) {
    return scan.repo_full_name || scan.repoFullName || scan.repo || 'repository';
  }

  function getHighestFindingSeverity(scan) {
    if (!Array.isArray(scan.findings)) return null;
    let best = null;
    scan.findings.forEach((finding) => {
      const current = parseSeverity(finding && finding.severity);
      if (!current) return;
      if (!best || current.rank > best.rank) best = current;
    });
    return best;
  }

  function sourceBadge(source) {
    const label = source === 'scanner' ? 'scanner' : 'runtime';
    return `<span class="source-badge">${label}</span>`;
  }

  function severityBadge(level) {
    const meta = getSeverityMeta(level);
    return `<span class="severity-badge" style="color:${meta.color};background:${meta.bg}">${meta.label}</span>`;
  }

  function buildScannerAlerts(scans) {
    return scans
      .filter((scan) => getFindingCount(scan) > 0)
      .map((scan) => {
        const count = getFindingCount(scan);
        const severity = getHighestFindingSeverity(scan) || severityFromCount(count);
        const repoName = getRepoName(scan);
        const timestamp = extractTimestamp(scan.startedAt, scan.started_at, scan.createdAt, scan.created_at, scan.completedAt, scan.completed_at);
        return {
          id: `scan:${scan.id || repoName}:${timestamp || count}`,
          source: 'scanner',
          severity: severity.label,
          severityRank: severity.rank,
          timestamp: timestamp ? new Date(timestamp).toISOString() : '',
          affected: repoName,
          affectedKey: repoName,
          title: `${count} leaked secret finding${count === 1 ? '' : 's'}`,
          signal: `${count} finding${count === 1 ? '' : 's'} · ${scan.status || 'scan complete'}`,
          nextStep: 'review findings, rotate exposed keys, and clean any leaked history',
          detail: scan.branch || scan.default_branch || 'repository scan',
          sourceRef: repoName,
          projectName: '',
          projectId: null,
        };
      });
  }

  function buildRuntimeAlerts(logs) {
    const grouped = new Map();

    logs.filter((log) => log.status === 'error').forEach((log) => {
      const key = [log.projectId || log.projectName, log.endpoint, log.provider].join('::');
      const current = grouped.get(key) || {
        projectId: log.projectId || null,
        projectName: log.projectName || 'unknown project',
        endpoint: log.endpoint || '—',
        provider: log.provider || 'unknown',
        count: 0,
        lastTimestamp: '',
        latency: null,
        requestId: '',
      };
      current.count += 1;
      if (!current.lastTimestamp || log.timestamp > current.lastTimestamp) {
        current.lastTimestamp = log.timestamp;
        current.latency = log.latency;
        current.requestId = log.requestId || '';
      }
      grouped.set(key, current);
    });

    return Array.from(grouped.values()).map((group) => {
      const severity = severityFromCount(group.count >= 10 ? group.count : group.count >= 5 ? group.count : Math.max(group.count, 2));
      return {
        id: `runtime:${group.projectId || group.projectName}:${group.endpoint}:${group.provider}`,
        source: 'runtime',
        severity: severity.label,
        severityRank: severity.rank,
        timestamp: group.lastTimestamp,
        affected: group.projectName,
        affectedKey: group.projectId || group.projectName,
        title: `${group.count} failing proxy request${group.count === 1 ? '' : 's'}`,
        signal: `${group.count} error${group.count === 1 ? '' : 's'} · ${formatLatency(group.latency)}${group.requestId ? ` · ${group.requestId}` : ''}`,
        nextStep: 'check upstream credentials, route config, and provider health before retrying',
        detail: `${group.provider} · ${group.endpoint}`,
        sourceRef: `${group.provider} ${group.endpoint}`,
        projectName: group.projectName,
        projectId: group.projectId,
      };
    });
  }

  function compareAlerts(a, b) {
    if (b.severityRank !== a.severityRank) return b.severityRank - a.severityRank;
    return new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime();
  }

  function buildChartRows(alerts) {
    const days = 30;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - (days - 1));

    const rows = Array.from({ length: days }, (_, idx) => {
      const date = new Date(start);
      date.setDate(start.getDate() + idx);
      return {
        date: date.toISOString().slice(0, 10),
        scanner: 0,
        runtime: 0,
      };
    });
    const byDate = new Map(rows.map((row) => [row.date, row]));

    alerts.forEach((alert) => {
      if (!alert.timestamp) return;
      const date = String(alert.timestamp).slice(0, 10);
      const bucket = byDate.get(date);
      if (!bucket) return;
      if (alert.source === 'scanner') bucket.scanner += 1;
      else bucket.runtime += 1;
    });

    return rows;
  }

  function buildChart(rows) {
    const canvas = document.getElementById('alertsChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (alertsChart) alertsChart.destroy();

    alertsChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: rows.map((row) => new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        datasets: [
          {
            label: 'scanner',
            data: rows.map((row) => row.scanner),
            borderColor: '#b91c1c',
            backgroundColor: 'rgba(185,28,28,0.06)',
            fill: true,
            tension: 0.35,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: 'runtime',
            data: rows.map((row) => row.runtime),
            borderColor: ACCENT,
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
            grid: { color: '#e7e5de' },
            border: { display: false },
            ticks: { color: '#8a8a82', font: { family: "'JetBrains Mono', ui-monospace, monospace", size: 10 }, maxTicksLimit: 8 },
          },
          y: {
            grid: { color: '#e7e5de' },
            border: { display: false },
            beginAtZero: true,
            ticks: {
              color: '#8a8a82',
              font: { family: "'JetBrains Mono', ui-monospace, monospace", size: 10 },
            },
          },
        },
      },
    });
  }

  function renderUsageBox(summary, tier) {
    const calls30d = summary.usage.reduce((sum, row) => sum + row.calls, 0);
    const limit = CALL_LIMITS[tier] || CALL_LIMITS.free;
    setText('usagePlanLabel', formatTierLabel(tier));
    setText('usageMetricLabel', 'all calls');
    setText('usageMetricValue', formatNum(summary.overview.totalCalls));
    setText(
      'usageMetricNote',
      limit === Infinity
        ? `last 30d ${formatNum(calls30d)}`
        : `last 30d ${formatNum(calls30d)} of ${formatNum(limit)} included`
    );
    const fill = document.getElementById('usageBarFill');
    if (fill) {
      const ratio = limit === Infinity ? 100 : Math.min(100, limit > 0 ? (calls30d / limit) * 100 : 0);
      fill.style.width = `${ratio}%`;
      fill.style.background = ratio >= 90 ? '#b91c1c' : ACCENT;
    }
  }

  function populateFilters(alerts) {
    const projectSelect = document.getElementById('projectFilter');
    const affectedMap = new Map();

    alerts.forEach((alert) => {
      if (alert.affectedKey) affectedMap.set(alert.affectedKey, alert.affected);
    });

    projectSelect.innerHTML = '<option value="">all surfaces</option>' +
      Array.from(affectedMap.entries()).sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([value, label]) => (
        `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`
      )).join('');
  }

  function getFilteredAlerts() {
    const search = (document.getElementById('searchInput').value || '').trim().toLowerCase();
    const source = document.getElementById('sourceFilter').value;
    const severity = document.getElementById('severityFilter').value;
    const affected = document.getElementById('projectFilter').value;

    let cutoff = 0;
    if (currentDays !== 'all') {
      cutoff = Date.now() - (Number(currentDays) * 24 * 60 * 60 * 1000);
    }

    return allAlerts.filter((alert) => {
      if (source && alert.source !== source) return false;
      if (severity && alert.severity !== severity) return false;
      if (affected && alert.affectedKey !== affected) return false;
      if (cutoff && new Date(alert.timestamp).getTime() < cutoff) return false;
      if (!search) return true;

      const haystack = [
        alert.title,
        alert.affected,
        alert.detail,
        alert.signal,
        alert.nextStep,
        alert.sourceRef,
      ].join(' ').toLowerCase();

      return haystack.includes(search);
    });
  }

  function renderKpis(alerts) {
    const open = alerts.length;
    const critical = alerts.filter((alert) => alert.severity === 'critical').length;
    const affectedProjects = new Set(alerts.filter((alert) => alert.source === 'runtime').map((alert) => alert.affectedKey)).size;
    const repos = new Set(alerts.filter((alert) => alert.source === 'scanner').map((alert) => alert.affectedKey)).size;
    const scannerCount = alerts.filter((alert) => alert.source === 'scanner').length;
    const runtimeCount = alerts.filter((alert) => alert.source === 'runtime').length;

    setText('kpi-open', formatNum(open));
    setText('kpi-open-sub', `${formatNum(scannerCount)} scanner · ${formatNum(runtimeCount)} runtime`);
    setText('kpi-critical', formatNum(critical));
    setText('kpi-critical-sub', open ? `${formatNum(open - critical)} below critical` : 'no incidents in queue');
    setText('kpi-projects', formatNum(affectedProjects));
    setText('kpi-projects-sub', runtimeCount ? 'projects with failing routes' : 'no runtime incidents');
    setText('kpi-repos', formatNum(repos));
    setText('kpi-repos-sub', repos ? 'repositories with exposed findings' : 'scanner queue is clear');
    setText('pageMeta', open ? `/ ${formatNum(open)} open · newest ${relTime(alerts[0].timestamp)}` : '/ no open alerts');
    setText('queueStatus', open ? `${formatNum(open)} open` : 'clear');
  }

  function renderTable(alerts) {
    const rowsEl = document.getElementById('alertsRows');
    if (!alerts.length) {
      rowsEl.innerHTML = '<tr><td colspan="7" class="empty-state">No alerts match the current filters.</td></tr>';
      return;
    }

    const visible = alerts.slice(0, MAX_VISIBLE_ROWS);
    rowsEl.innerHTML = visible.map((alert) => `
      <tr>
        <td class="mono">${escapeHtml(formatTimestamp(alert.timestamp))}</td>
        <td>${sourceBadge(alert.source)}</td>
        <td>${severityBadge(alert.severity)}</td>
        <td>
          <div class="alert-title">${escapeHtml(alert.title)}</div>
          <div class="alert-sub">${escapeHtml(alert.detail || '—')}</div>
        </td>
        <td>
          <div class="surface-name">${escapeHtml(alert.affected)}</div>
          <div class="surface-sub">${escapeHtml(alert.source === 'scanner' ? 'repository' : alert.projectId || 'runtime route')}</div>
        </td>
        <td class="signal-note">${escapeHtml(alert.signal)}</td>
        <td class="next-step">${escapeHtml(alert.nextStep)}</td>
      </tr>
    `).join('');
  }

  function renderSeverityPanel(alerts) {
    const list = document.getElementById('severityList');
    const counts = new Map(SEVERITY_ORDER.map((level) => [level, 0]));
    alerts.forEach((alert) => counts.set(alert.severity, (counts.get(alert.severity) || 0) + 1));
    const rows = SEVERITY_ORDER
      .map((level) => ({ level, count: counts.get(level) || 0, meta: getSeverityMeta(level) }))
      .filter((row) => row.count > 0);

    setText('severityCount', rows.length ? `${formatNum(alerts.length)} total` : 'clear');

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No active severity buckets.</div>';
      return;
    }

    list.innerHTML = rows.map((row, index) => `
      <div class="stack-row">
        <div class="stack-rank">${index + 1}</div>
        <div class="stack-main">
          <div class="stack-title" style="color:${row.meta.color}">${row.meta.label}</div>
          <div class="stack-sub">${Math.round((row.count / alerts.length) * 100)}% of open queue</div>
        </div>
        <div class="stack-value">${formatNum(row.count)}</div>
      </div>
    `).join('');
  }

  function renderSurfacePanel(alerts) {
    const list = document.getElementById('surfaceList');
    const counts = new Map();
    alerts.forEach((alert) => {
      const current = counts.get(alert.affected) || { count: 0, source: alert.source };
      current.count += 1;
      current.source = alert.source;
      counts.set(alert.affected, current);
    });
    const rows = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count).slice(0, 6);

    setText('surfaceCount', rows.length ? `${rows.length} visible` : 'clear');

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No affected surfaces in this view.</div>';
      return;
    }

    list.innerHTML = rows.map(([name, value], index) => `
      <div class="stack-row">
        <div class="stack-rank">${index + 1}</div>
        <div class="stack-main">
          <div class="stack-title">${escapeHtml(name)}</div>
          <div class="stack-sub">${escapeHtml(value.source === 'scanner' ? 'scanner exposure' : 'runtime issue')}</div>
        </div>
        <div class="stack-value">${formatNum(value.count)}</div>
      </div>
    `).join('');
  }

  function renderRecentPanel(alerts) {
    const list = document.getElementById('recentList');
    const rows = alerts.slice(0, 6);
    setText('recentCount', rows.length ? `${rows.length} recent` : 'clear');

    if (!rows.length) {
      list.innerHTML = '<div class="empty-state">No recent detections in this view.</div>';
      return;
    }

    list.innerHTML = rows.map((alert, index) => {
      const severity = getSeverityMeta(alert.severity);
      return `
        <div class="stack-row">
          <div class="stack-rank">${index + 1}</div>
          <div class="stack-main">
            <div class="stack-title">${escapeHtml(alert.title)}</div>
            <div class="stack-sub">${escapeHtml(alert.affected)} · ${escapeHtml(relTime(alert.timestamp))}</div>
          </div>
          <div class="stack-value" style="color:${severity.color}">${severity.label}</div>
        </div>
      `;
    }).join('');
  }

  function renderFilterNote(alerts) {
    const total = alerts.length;
    const showing = Math.min(total, MAX_VISIBLE_ROWS);
    const parts = [`showing ${formatNum(showing)} of ${formatNum(total)}`];
    if (currentDays !== 'all') parts.push(`${currentDays}d window`);
    setText('filterNote', parts.join(' · '));
  }

  function renderAll() {
    const filtered = getFilteredAlerts().sort(compareAlerts);
    renderFilterNote(filtered);
    renderKpis(filtered);
    renderTable(filtered);
    renderSeverityPanel(filtered);
    renderSurfacePanel(filtered);
    renderRecentPanel(filtered);
    buildChart(buildChartRows(filtered));
  }

  function exportCsv() {
    const alerts = getFilteredAlerts().sort(compareAlerts);
    const rows = [
      ['timestamp', 'source', 'severity', 'title', 'affected', 'detail', 'signal', 'next_step'],
      ...alerts.map((alert) => [
        alert.timestamp,
        alert.source,
        alert.severity,
        alert.title,
        alert.affected,
        alert.detail,
        alert.signal,
        alert.nextStep,
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
    link.download = 'vaultproof-alerts.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function renderUnavailableState(summary, tier) {
    renderUsageBox(summary, tier);
    ['kpi-open', 'kpi-critical', 'kpi-projects', 'kpi-repos'].forEach((id) => setText(id, '—'));
    ['kpi-open-sub', 'kpi-critical-sub', 'kpi-projects-sub', 'kpi-repos-sub'].forEach((id) => setText(id, 'alerts unavailable'));
    setText('pageMeta', '/ alerts unavailable');
    setText('queueStatus', 'unavailable');
    setText('filterNote', 'could not load alerts');
    setText('severityCount', 'unavailable');
    setText('surfaceCount', 'unavailable');
    setText('recentCount', 'unavailable');
    const rowsEl = document.getElementById('alertsRows');
    const severityList = document.getElementById('severityList');
    const surfaceList = document.getElementById('surfaceList');
    const recentList = document.getElementById('recentList');
    if (rowsEl) rowsEl.innerHTML = '<tr><td colspan="7" class="empty-state">We could not load alerts right now.</td></tr>';
    if (severityList) severityList.innerHTML = '<div class="empty-state">Severity data is unavailable right now.</div>';
    if (surfaceList) surfaceList.innerHTML = '<div class="empty-state">Surface data is unavailable right now.</div>';
    if (recentList) recentList.innerHTML = '<div class="empty-state">Recent detections are unavailable right now.</div>';
    buildChart(buildChartRows([]));
  }

  function bindEvents() {
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);

    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadAlerts);

    const exportBtn = document.getElementById('exportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCsv);

    ['searchInput', 'sourceFilter', 'severityFilter', 'projectFilter'].forEach((id) => {
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
    const avatar = document.getElementById('user-avatar');
    if (avatar) avatar.textContent = (email || 'U').charAt(0).toUpperCase();
  }

  async function loadAlerts() {
    setText('pageMeta', '/ loading…');
    setText('queueStatus', 'loading…');
    setText('filterNote', 'loading alerts…');

    const [summaryRaw, logsRaw, scansRaw, billingRaw] = await Promise.all([
      apiFetch(INIT_API, '/projects/stats/dashboard?days=30&limit=12'),
      apiFetch(INIT_API, '/projects/stats/logs?days=90&limit=1200'),
      apiFetch(API, '/scanner/scans'),
      apiFetch(API, '/billing/status'),
    ]);

    const summary = normalizeSummary(summaryRaw);
    const logs = normalizeLogs(logsRaw || (summaryRaw && typeof summaryRaw === 'object' && Array.isArray(summaryRaw.logs) ? { logs: summaryRaw.logs } : null));
    const scans = normalizeScans(scansRaw);
    const tier = resolveTier(billingRaw);

    if (!summaryRaw && !logsRaw && !scansRaw) {
      allAlerts = [];
      renderUnavailableState(summary, tier);
      return;
    }

    allAlerts = buildScannerAlerts(scans).concat(buildRuntimeAlerts(logs)).sort(compareAlerts);
    renderUsageBox(summary, tier);
    populateFilters(allAlerts);
    renderAll();
  }

  initHeader();
  bindEvents();
  loadAlerts();
})();
