(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
  const ACCENT = '#c2410c';
  const ACTION_LABELS = {
    api_call: 'API Call',
    transparent_proxy: 'Proxy',
    key_retrieval: 'Key Retrieved',
    key_rotation: 'Key Rotated',
    nullifier_claim: 'ZK Proof',
    revoke: 'Revoked',
  };
  const ACTION_COLORS = {
    api_call: '#536276',
    transparent_proxy: '#536276',
    key_retrieval: '#15803d',
    key_rotation: ACCENT,
    revoke: '#b91c1c',
  };
  const CALL_LIMITS = {
    free: 10000,
    starter: 50000,
    pro: 500000,
    team: 2000000,
    enterprise: Infinity,
  };

  let token = localStorage.getItem('vaultproof_token');
  const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let usageChart = null;
  let currentProjectRows = [];
  let currentProjectFilter = 'all';

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeClassSegment(value) {
    return String(value || 'unknown').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
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
    return tier === 'free' ? 'free plan' : `${tier} plan`;
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
        if (!data?.token) return false;
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

  async function apiFetch(path) {
    try {
      const res = await fetch(`${API}${path}`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401) {
        if (!refreshAttempted) {
          refreshAttempted = true;
          if (await tryRefreshToken()) return apiFetch(path);
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

  async function apiFetchInit(path) {
    try {
      const res = await fetch(`${INIT_API}${path}`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.status === 401) {
        if (!refreshAttempted) {
          refreshAttempted = true;
          if (await tryRefreshToken()) return apiFetchInit(path);
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

  function formatNum(value) {
    if (value == null) return '0';
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`;
    return Number(value).toLocaleString();
  }

  function relTime(timestamp) {
    if (!timestamp) return '—';
    const seconds = Math.floor((Date.now() - new Date(timestamp)) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  }

  function unwrapPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    if (data.data && typeof data.data === 'object') return unwrapPayload(data.data);
    if (data.result && typeof data.result === 'object') return unwrapPayload(data.result);
    if (data.overview && typeof data.overview === 'object') return unwrapPayload(data.overview);
    return data;
  }

  function normalizeUsage(data) {
    const payload = unwrapPayload(data);
    return ((payload && (payload.usage || payload.days)) || [])
      .filter((row) => row && row.date)
      .map((row) => ({
        date: row.date,
        calls: Number(row.calls || 0),
        errors: Number(row.errors || 0),
      }));
  }

  function normalizeProjects(data) {
    const payload = unwrapPayload(data);
    if (Array.isArray(payload?.projects)) return payload.projects;
    if (Array.isArray(payload?.items)) return payload.items;
    return Array.isArray(payload) ? payload : [];
  }

  function normalizeDashboardSummary(data) {
    const payload = unwrapPayload(data) || {};
    return {
      overview: normalizeOverview(payload.overview || payload),
      usage: normalizeUsage(payload.usage || payload),
      logs: normalizeLogs(payload.logs || payload),
      projects: normalizeProjects(payload.projects || payload),
    };
  }

  function normalizeKeyStats(data) {
    const stats = new Map();
    const payload = unwrapPayload(data);
    const rows = Array.isArray(payload?.keys)
      ? payload.keys
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
    rows.forEach((row) => {
      const id = row?.id || row?.keyId;
      if (id) stats.set(String(id), row);
    });
    return stats;
  }

  function normalizeScans(data) {
    const payload = unwrapPayload(data);
    if (Array.isArray(payload?.scans)) return payload.scans;
    if (Array.isArray(payload?.items)) return payload.items;
    return Array.isArray(payload) ? payload : [];
  }

  function normalizeLogs(data) {
    const payload = unwrapPayload(data);
    if (Array.isArray(payload?.logs)) return payload.logs;
    if (Array.isArray(payload?.items)) return payload.items;
    return Array.isArray(payload) ? payload : [];
  }

  function normalizeOverview(data) {
    const payload = unwrapPayload(data) || {};
    return {
      totalKeys: Number(payload.totalKeys || payload.total_keys || 0),
      totalCalls: Number(payload.totalCalls || payload.total_calls || 0),
      activeApps: Number(payload.activeApps || payload.active_apps || payload.providerCount || payload.provider_count || 0),
      errorRate: Number(payload.errorRate || payload.error_rate || 0),
      recentActivity: Array.isArray(payload.recentActivity)
        ? payload.recentActivity
        : Array.isArray(payload.recent_activity)
          ? payload.recent_activity
          : [],
    };
  }

  function normalizeEnv(value) {
    const env = String(value || '').trim().toLowerCase();
    if (env.includes('prod')) return 'production';
    if (env.includes('stag')) return 'staging';
    if (env.includes('dev')) return 'development';
    return 'unknown';
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

  function resolveTier(billing) {
    const payload = unwrapPayload(billing) || {};
    return normalizeTier(
      payload?.tier ||
      payload?.plan ||
      payload?.subscriptionTier ||
      payload?.subscription?.tier ||
      payload?.subscription?.plan ||
      payload?.customer?.tier ||
      user?.tier ||
      user?.plan
    );
  }

  function buildFallbackOverview(overview, rows, keyStats, logs) {
    const providersFromKeys = new Set(
      Array.from(keyStats.values()).map((row) => row?.provider).filter(Boolean)
    );
    const totalCalls = rows.reduce((sum, row) => sum + Number(row.calls || 0), 0);
    const totalErrors = rows.reduce((sum, row) => sum + Number(row.errors || 0), 0);
    return {
      totalKeys: overview.totalKeys || keyStats.size,
      totalCalls: overview.totalCalls || totalCalls,
      activeApps: overview.activeApps || providersFromKeys.size,
      errorRate: overview.totalCalls || rows.length
        ? overview.errorRate || (totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0)
        : 0,
      recentActivity: overview.recentActivity.length ? overview.recentActivity : logs,
    };
  }

  function formatAlertSeverity(count) {
    if (count >= 5) return { label: 'critical', color: '#b91c1c', bg: 'rgba(185,28,28,0.08)' };
    if (count >= 2) return { label: 'high', color: '#c2410c', bg: 'rgba(194,65,12,0.08)' };
    return { label: 'medium', color: '#a16207', bg: 'rgba(161,98,7,0.08)' };
  }

  function buildDistributionBars(values, color) {
    const nonZero = values.filter((value) => value > 0);
    if (!nonZero.length) return '<span class="status-empty">—</span>';
    const max = Math.max.apply(null, nonZero);
    return values.slice(0, 12).map((value) => {
      const height = Math.max(6, Math.round((value / max) * 30));
      return `<div class="spark-bar" style="height:${height}px;background:${color};opacity:${value > 0 ? 1 : 0.25}"></div>`;
    }).join('');
  }

  async function buildProjectRows(projects, keyStats) {
    const rows = await Promise.all(projects.map(async (project) => {
      if (!project?.id) return null;
      const res = await apiFetchInit(`/projects/${project.id}/keys`);
      const keys = Array.isArray(res?.keys) ? res.keys : [];
      const matchedStats = keys.map((key) => keyStats.get(String(key.id)) || key);
      const calls30d = matchedStats.reduce(
        (sum, stat) => sum + Number(stat?.callsThisMonth || stat?.calls_this_month || 0),
        0
      );
      const lastUsedAt = matchedStats.reduce((latest, stat) => {
        const ts = extractTimestamp(stat?.lastUsed, stat?.last_used, stat?.lastUsedAt, stat?.last_used_at);
        return ts && (!latest || ts > latest) ? ts : latest;
      }, null);
      return {
        id: project.id,
        vpProjId: project.vp_proj_id || project.vpProjId || project.project_id || project.id,
        name: project.name || project.vp_proj_id || project.id,
        env: normalizeEnv(project.environment || project.env || project.stage || project.mode),
        keysCount: keys.length,
        calls30d,
        lastUsedAt,
        createdAt: extractTimestamp(project.created_at, project.createdAt),
        sparkValues: matchedStats.map((stat) => Number(stat?.callsThisMonth || stat?.calls_this_month || 0)),
        status: keys.length === 0 ? 'idle' : calls30d > 0 ? 'healthy' : 'ready',
      };
    }));
    return rows.filter(Boolean);
  }

  function normalizeProjectRows(projects) {
    return projects
      .filter((project) => project && project.id)
      .map((project) => ({
        id: project.id,
        vpProjId: project.vpProjId || project.vp_proj_id || project.project_id || project.id,
        name: project.name || project.vp_proj_id || project.id,
        env: normalizeEnv(project.environment || project.env || project.stage || project.mode),
        keysCount: Number(project.keysCount || project.keys_count || 0),
        calls30d: Number(project.calls30d || project.calls_30d || 0),
        lastUsedAt: extractTimestamp(project.lastUsedAt, project.last_used_at, project.lastUsed, project.last_used),
        createdAt: extractTimestamp(project.createdAt, project.created_at),
        sparkValues: Array.isArray(project.sparkValues)
          ? project.sparkValues.map((value) => Number(value || 0))
          : Array.isArray(project.spark_values)
            ? project.spark_values.map((value) => Number(value || 0))
            : [],
        status: project.status || (Number(project.keysCount || project.keys_count || 0) === 0 ? 'idle' : 'ready'),
      }));
  }

  function renderUsageSummary(overview, usageRows, tier) {
    const totalCalls = Number(overview?.totalCalls || 0);
    const calls30d = usageRows.reduce((sum, row) => sum + Number(row.calls || 0), 0);
    const limit = CALL_LIMITS[tier] || CALL_LIMITS.free;
    setText('usagePlanLabel', formatTierLabel(tier));
    setText('usageMetricLabel', 'all calls');
    setText('usageMetricValue', formatNum(totalCalls));
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
      fill.style.background = ratio >= 90 ? '#b91c1c' : 'var(--accent)';
    }
  }

  function renderProjectRows() {
    const container = document.getElementById('project-rows');
    if (!container) return;
    const rows = currentProjectRows.filter((project) => {
      if (currentProjectFilter === 'all') return true;
      if (currentProjectFilter === 'idle') return project.status === 'idle';
      return project.env === currentProjectFilter;
    });
    if (!rows.length) {
      container.innerHTML = '<div class="table-row"><div class="status-empty">No projects match this filter.</div><div></div><div></div><div></div><div></div><div></div><div></div></div>';
      return;
    }

    container.innerHTML = rows.map((project) => {
      const sparkColor = project.status === 'alert'
        ? '#b91c1c'
        : project.status === 'ready'
          ? ACCENT
          : project.status === 'idle'
            ? '#bcc9d8'
            : ACCENT;
      const bars = buildDistributionBars(project.sparkValues, sparkColor);
      const statusLabel = project.status === 'ready' ? 'ready' : project.status;
      const lastUsedLabel = project.lastUsedAt
        ? relTime(project.lastUsedAt)
        : project.createdAt
          ? `created ${relTime(project.createdAt)}`
          : '—';
      return `
        <div class="table-row ${project.status === 'alert' ? 'alert-row' : ''}">
          <div>
            <div class="proj-name">${escapeHtml(project.name)}</div>
            <div class="proj-id">${escapeHtml(project.vpProjId)}</div>
          </div>
          <div><span class="env-badge env-${safeClassSegment(project.env)}">${escapeHtml(project.env)}</span></div>
          <div class="cell-mono">${project.keysCount}</div>
          <div class="cell-mono">${formatNum(project.calls30d)}</div>
          <div class="sparkline">${bars}</div>
          <div class="last-call">${escapeHtml(lastUsedLabel)}</div>
          <div class="status-cell ${project.status === 'idle' && project.keysCount === 0 ? 'status-empty' : ''}" style="color:${project.status === 'idle' && project.keysCount === 0 ? 'var(--text-faint)' : sparkColor}">● ${escapeHtml(statusLabel)}</div>
        </div>`;
    }).join('');
  }

  function renderAlerts(scans) {
    const alertScans = scans
      .filter((scan) => Number(scan.findings_count != null ? scan.findings_count : scan.findings?.length || 0) > 0)
      .sort((a, b) => {
        const aTs = extractTimestamp(a.startedAt, a.started_at, a.createdAt, a.created_at) || 0;
        const bTs = extractTimestamp(b.startedAt, b.started_at, b.createdAt, b.created_at) || 0;
        return bTs - aTs;
      });

    setText('alertsCount', String(alertScans.length));
    setText('sidebarAlertsCount', String(alertScans.length));

    const alertsStatus = document.getElementById('alertsStatus');
    const alertsList = document.getElementById('alertsList');
    if (!alertsStatus || !alertsList) return;

    if (!alertScans.length) {
      alertsStatus.textContent = 'clear';
      alertsStatus.style.color = '#15803d';
      alertsList.innerHTML = '<div class="alert-item"><span class="alert-glyph" data-vp-no-translate style="color:#15803d">OK</span><div class="alert-text"><div class="alert-title">No open scanner alerts</div><div class="alert-meta">run a repo scan to surface findings here</div></div></div>';
      return;
    }

    alertsStatus.textContent = 'needs review';
    alertsStatus.style.color = '#b91c1c';
    alertsList.innerHTML = alertScans.slice(0, 4).map((scan) => {
      const findingsCount = Number(scan.findings_count != null ? scan.findings_count : scan.findings?.length || 0);
      const severity = formatAlertSeverity(findingsCount);
      const repoName = scan.repo_full_name || scan.repoFullName || 'repository';
      const scanTime = extractTimestamp(scan.startedAt, scan.started_at, scan.createdAt, scan.created_at);
      return `
        <div class="alert-item">
          <span class="alert-glyph" data-vp-no-translate style="color:${severity.color}">!!</span>
          <div class="alert-text">
            <div class="alert-title">${findingsCount} scanner finding${findingsCount === 1 ? '' : 's'}</div>
            <div class="alert-meta">${escapeHtml(repoName)} · ${escapeHtml(scanTime ? relTime(scanTime) : 'recently scanned')}</div>
          </div>
          <span class="alert-badge" style="color:${severity.color};background:${severity.bg}">${escapeHtml(severity.label)}</span>
          <a class="alert-review" href="/app/scanner">review →</a>
        </div>`;
    }).join('');
  }

  function updatePageMeta(projectRows) {
    const activeProjects = projectRows.filter((project) => project.keysCount > 0 || project.calls30d > 0).length;
    setText('pageMeta', `/ ${projectRows.length} total · ${activeProjects} active`);
  }

  function buildChart(labels, calls, errors) {
    const mono = "'Geist Mono', 'SFMono-Regular', Consolas, monospace";
    const rule = '#d7e0eb';
    const canvas = document.getElementById('usageChart');
    if (!canvas || typeof Chart === 'undefined') return;
    const ctx = canvas.getContext('2d');
    if (usageChart) usageChart.destroy();
    usageChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'calls',
            data: calls,
            borderColor: ACCENT,
            backgroundColor: 'rgba(194,65,12,0.07)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: ACCENT,
            borderWidth: 2,
          },
          {
            label: 'errors',
            data: errors,
            borderColor: '#b91c1c',
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#b91c1c',
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#fff',
            titleColor: '#142235',
            bodyColor: '#536276',
            borderColor: rule,
            borderWidth: 1,
            cornerRadius: 4,
            padding: 10,
            titleFont: { family: mono, size: 11 },
            bodyFont: { family: mono, size: 11 },
          },
        },
        scales: {
          x: {
            grid: { color: rule },
            ticks: { color: '#8290a3', font: { family: mono, size: 10 }, maxTicksLimit: 8 },
            border: { display: false },
          },
          y: {
            grid: { color: rule },
            ticks: {
              color: '#8290a3',
              font: { family: mono, size: 10 },
              callback(value) {
                return value >= 1000 ? `${(value / 1000).toFixed(0)}k` : value;
              },
            },
            border: { display: false },
            beginAtZero: true,
          },
        },
      },
    });
  }

  function demoChart() {
    const labels = [];
    const calls = [];
    const errors = [];
    for (let i = 29; i >= 0; i -= 1) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      labels.push(date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      const base = 60000 + Math.sin(i * 0.4) * 20000;
      calls.push(Math.round(base));
      errors.push(Math.round(base * 0.008));
    }
    buildChart(labels, calls, errors);
  }

  function renderActivity(events) {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    if (!events.length) {
      feed.innerHTML = '<div class="activity-row" style="color:var(--text-faint)"><span class="act-time">—</span><span class="act-tag">—</span><span>no recent activity</span></div>';
      return;
    }
    feed.innerHTML = events.slice(0, 8).map((event) => {
      const type = event.action || event.type || 'unknown';
      const label = ACTION_LABELS[type] || type;
      const color = ACTION_COLORS[type] || '#525252';
      let description = event.description || '';
      if (!description && event.metadata) {
        try {
          const metadata = typeof event.metadata === 'string' ? JSON.parse(event.metadata) : event.metadata;
          description = metadata.endpoint || metadata.provider || '';
        } catch {
          description = '';
        }
      }
      description = description || (event.keySlot && event.keySlot.provider) || event.appId || '—';
      const ts = relTime(extractTimestamp(event.timestamp, event.created_at, event.createdAt, event.started_at, event.startedAt));
      return `<div class="activity-row"><span class="act-time">${escapeHtml(ts)}</span><span class="act-tag">${escapeHtml(label)}</span><span style="color:${color}">${escapeHtml(description)}</span></div>`;
    }).join('');
  }

  function renderKpis(overview, hasData) {
    if (!hasData) {
      ['kpi-keys', 'kpi-calls', 'kpi-providers', 'kpi-errors'].forEach((id) => setText(id, '—'));
      ['kpi-keys-sub', 'kpi-calls-sub', 'kpi-providers-sub', 'kpi-errors-sub'].forEach((id) => setText(id, 'unavailable'));
      renderActivity([]);
      return;
    }

    setText('kpi-keys', formatNum(overview.totalKeys || 0));
    setText('kpi-keys-sub', 'encrypted at rest');
    setText('kpi-calls', formatNum(overview.totalCalls || 0));
    setText('kpi-calls-sub', 'all time');
    setText('kpi-providers', formatNum(overview.activeApps || 0));
    setText('kpi-providers-sub', 'connected');
    const errRate = Number(overview.errorRate || 0).toFixed(1);
    const errEl = document.getElementById('kpi-errors');
    if (errEl) {
      errEl.textContent = `${errRate}%`;
      if (parseFloat(errRate) > 1) errEl.classList.add('alert');
      else errEl.classList.remove('alert');
    }
    setText('kpi-errors-sub', 'of proxied calls');
    renderActivity(overview.recentActivity || []);
  }

  function renderChart(rows) {
    if (rows.length) {
      const labels = rows.map((row) => new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
      buildChart(labels, rows.map((row) => row.calls), rows.map((row) => row.errors));
      return;
    }
    demoChart();
  }

  function renderFatalDashboardFallback() {
    ['kpi-keys', 'kpi-calls', 'kpi-providers', 'kpi-errors'].forEach((id) => setText(id, '—'));
    ['kpi-keys-sub', 'kpi-calls-sub', 'kpi-providers-sub', 'kpi-errors-sub'].forEach((id) => setText(id, 'unavailable'));
    setText('usageMetricNote', 'unable to load usage');
    setText('alertsStatus', 'unavailable');
    renderActivity([]);
  }

  async function loadDashboard() {
    const dashboardSummaryPromise = apiFetchInit('/projects/stats/dashboard?days=30&limit=8');
    const billingPromise = apiFetch('/billing/status');
    const scansPromise = apiFetch('/scanner/scans');

    const dashboardSummaryRaw = await dashboardSummaryPromise;
    const dashboardSummary = normalizeDashboardSummary(dashboardSummaryRaw);
    const hasDashboardSummary = Boolean(
      dashboardSummaryRaw &&
      (dashboardSummary.projects.length || dashboardSummary.usage.length || dashboardSummary.logs.length || dashboardSummary.overview.totalCalls)
    );

    if (hasDashboardSummary) {
      renderUsageSummary(dashboardSummary.overview, dashboardSummary.usage, resolveTier(null));
      renderKpis(
        dashboardSummary.overview,
        Boolean(
          dashboardSummary.overview.totalCalls ||
          dashboardSummary.overview.totalKeys ||
          dashboardSummary.usage.length ||
          dashboardSummary.logs.length ||
          dashboardSummary.projects.length
        )
      );
      renderChart(dashboardSummary.usage);

      currentProjectRows = normalizeProjectRows(dashboardSummary.projects);
      updatePageMeta(currentProjectRows);
      renderProjectRows();

      billingPromise
        .then((billingRaw) => {
          renderUsageSummary(dashboardSummary.overview, dashboardSummary.usage, resolveTier(billingRaw));
        })
        .catch(() => {});

      scansPromise
        .then((scansRaw) => {
          renderAlerts(normalizeScans(scansRaw));
        })
        .catch(() => {});
      return;
    }

    const [overviewRaw, usageRaw, projectsRaw, keyStatsRaw, logsRaw, billingRaw, scansRaw] = await Promise.all([
      apiFetchInit('/projects/stats/overview'),
      apiFetchInit('/projects/stats/usage?days=30'),
      apiFetchInit('/projects'),
      apiFetchInit('/projects/stats/by-key'),
      apiFetchInit('/projects/stats/logs?days=30&limit=8'),
      billingPromise,
      scansPromise,
    ]);

    const projects = normalizeProjects(projectsRaw);
    const keyStats = normalizeKeyStats(keyStatsRaw);
    const scans = normalizeScans(scansRaw);
    const logs = normalizeLogs(logsRaw);
    const overview = normalizeOverview(overviewRaw);
    const usageRows = normalizeUsage(usageRaw);
    const tier = resolveTier(billingRaw);
    const fallbackOverview = buildFallbackOverview(overview, usageRows, keyStats, logs);

    renderUsageSummary(fallbackOverview, usageRows, tier);
    renderAlerts(scans);
    renderKpis(
      fallbackOverview,
      Boolean(overviewRaw || keyStats.size || usageRows.length || logs.length || projects.length)
    );
    renderChart(usageRows);

    currentProjectRows = await buildProjectRows(projects, keyStats);
    updatePageMeta(currentProjectRows);
    renderProjectRows();
  }

  function bindFilters() {
    document.querySelectorAll('.filter-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
        chip.classList.add('active');
        currentProjectFilter = chip.getAttribute('data-filter') || 'all';
        renderProjectRows();
      });
    });
  }

  function initHeader() {
    const email = user.email || '';
    const avatar = document.getElementById('user-avatar');
    const emailLabel = document.getElementById('user-email');
    if (emailLabel) emailLabel.textContent = email || 'unknown user';
    if (avatar) avatar.textContent = (email || 'U').charAt(0).toUpperCase();
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);
  }

  initHeader();
  bindFilters();
  loadDashboard().catch(renderFatalDashboardFallback);
})();
