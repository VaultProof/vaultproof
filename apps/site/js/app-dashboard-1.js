(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
  const session = window.VaultProofSession;
  const ACCENT = '#00e5ff';
  const ACTION_LABELS = {
    api_call: 'API Call',
    transparent_proxy: 'Proxy',
    key_retrieval: 'Key Retrieved',
    key_rotation: 'Key Rotated',
    nullifier_claim: 'ZK Proof',
    revoke: 'Revoked',
  };
  const ACTION_COLORS = {
    api_call: '#00e5ff',
    transparent_proxy: '#00e5ff',
    key_retrieval: '#22e6a8',
    key_rotation: '#f8c038',
    revoke: '#ff4f68',
  };
  const LIVE_REQUEST_ACTIONS = new Set([
    'api_call',
    'api_request',
    'http_request',
    'provider_call',
    'provider_request',
    'proxy_call',
    'proxy_request',
    'transparent_proxy',
    'upstream_request',
  ]);
  let token = (session && session.getAccessToken())
    || localStorage.getItem('vaultproof_token');
  const user = (session && session.getUser())
    || JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let currentProjectRows = [];
  let currentProjectFilter = 'all';
  let liveRequestRows = [];

  function cleanDashboardOrgParam() {
    const params = new URLSearchParams(window.location.search);
    const orgId = params.get('org');
    if (!orgId) return;
    if (/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(orgId)) {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
    }
    params.delete('org');
    const next = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', next);
  }

  cleanDashboardOrgParam();

  if (!token && !(session && session.hasRefreshToken())) {
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

  function formatClock(timestamp) {
    const date = timestamp ? new Date(timestamp) : new Date();
    if (Number.isNaN(date.getTime())) return '--:--:--';
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function parseMetadata(event) {
    if (!event || !event.metadata) return {};
    if (typeof event.metadata === 'string') {
      try {
        return JSON.parse(event.metadata) || {};
      } catch {
        return {};
      }
    }
    return event.metadata || {};
  }

  function requestLatencyFromEvent(event) {
    const metadata = parseMetadata(event);
    const latency = Number(metadata.latency_ms || metadata.latency || (event && (event.latency_ms || event.latency)));
    if (Number.isFinite(latency) && latency > 0) return latency;
    return null;
  }

  function hasOwnRequestSignal(event) {
    const metadata = parseMetadata(event);
    const path = metadata.endpoint || metadata.path || metadata.route || event?.path || event?.endpoint || event?.route;
    const status = metadata.status_code || metadata.status || event?.status_code || event?.status;
    const method = metadata.method || event?.method || event?.http_method;
    const latency = metadata.latency_ms || metadata.latency || event?.latency_ms || event?.latency;
    const requestId = metadata.request_id || metadata.requestId || metadata.upstream_request_id || event?.request_id || event?.requestId;
    return Boolean(
      path &&
      (status || method || latency || requestId || metadata.provider || event?.provider)
    );
  }

  function isUserApiCall(event) {
    if (!event) return false;
    const type = String(event.action || event.type || '').toLowerCase();
    if (type) return LIVE_REQUEST_ACTIONS.has(type);
    return hasOwnRequestSignal(event);
  }

  function normalizeRequestEvent(event, index) {
    const timestamp = extractTimestamp(event?.timestamp, event?.created_at, event?.createdAt, event?.started_at, event?.startedAt) || Date.now() - index * 1400;
    const metadata = parseMetadata(event);
    const rawPath = metadata.endpoint || metadata.path || metadata.route || event?.path || event?.endpoint || event?.route || '';
    const rawStatus = metadata.status_code || metadata.status || event?.status_code || event?.status;
    const rawMethod = metadata.method || event?.method || event?.http_method;
    const rawLatency = metadata.latency_ms || metadata.latency || event?.latency_ms || event?.latency;
    const cacheHitRaw = metadata.cache_hit ?? metadata.cacheHit;
    const bytes = Number(metadata.bytes || metadata.response_bytes || metadata.responseBytes || metadata.bandwidth_bytes || 0);
    const status = Number(rawStatus);
    const latency = Number(rawLatency);
    const path = rawPath ? String(rawPath).replace(/^https?:\/\/[^/]+/i, '') || '/api/proxy' : '';
    return {
      timestamp,
      method: rawMethod ? String(rawMethod).toUpperCase() : 'API',
      path,
      status: Number.isFinite(status) && status > 0 ? status : null,
      latency: Number.isFinite(latency) && latency > 0 ? latency : 0,
      cacheHit: typeof cacheHitRaw === 'boolean' ? cacheHitRaw : cacheHitRaw == null ? null : String(cacheHitRaw).toLowerCase() === 'true',
      bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 0,
    };
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
    if (count >= 5) return { label: 'critical', color: '#ff4f68', bg: 'rgba(255,79,104,0.10)' };
    if (count >= 2) return { label: 'high', color: '#f8c038', bg: 'rgba(248,192,56,0.10)' };
    return { label: 'medium', color: '#00e5ff', bg: 'rgba(0,229,255,0.10)' };
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
        status: project.status || (Number(project.keysCount || project.keys_count || 0) === 0 ? 'idle' : 'ready'),
      }));
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
      container.innerHTML = '<div class="table-row"><div class="status-empty">No projects match this filter.</div><div></div><div></div><div></div><div></div><div></div></div>';
      return;
    }

    container.innerHTML = rows.map((project) => {
      const sparkColor = project.status === 'alert'
        ? '#ff4f68'
        : project.status === 'ready'
          ? ACCENT
        : project.status === 'idle'
            ? 'rgba(247,251,255,0.28)'
            : ACCENT;
      const statusLabel = project.status === 'ready' ? 'ready' : project.status;
      const lastUsed = project.lastUsedAt ? relTime(project.lastUsedAt) : 'no calls';
      return `
        <div class="table-row ${project.status === 'alert' ? 'alert-row' : ''}">
          <div>
            <div class="proj-name">${escapeHtml(project.name || project.vpProjId || 'Untitled project')}</div>
            <div class="proj-id">${escapeHtml(project.vpProjId)}</div>
          </div>
          <div><span class="env-badge env-${safeClassSegment(project.env)}">${escapeHtml(project.env)}</span></div>
          <div class="cell-mono">${escapeHtml(`${formatNum(project.keysCount)} key${project.keysCount === 1 ? '' : 's'}`)}</div>
          <div class="cell-mono">${escapeHtml(lastUsed)}</div>
          <div class="cell-mono">${escapeHtml(formatNum(project.calls30d))}</div>
          <div class="status-cell ${project.status === 'idle' && project.keysCount === 0 ? 'status-empty' : ''}" style="color:${project.status === 'idle' && project.keysCount === 0 ? 'var(--text-muted)' : sparkColor}">● ${escapeHtml(statusLabel)}</div>
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
      alertsStatus.style.color = '#22e6a8';
      alertsList.innerHTML = '<div class="alert-item"><span class="alert-glyph" data-vp-no-translate style="color:#22e6a8">OK</span><div class="alert-text"><div class="alert-title">No open scanner alerts</div><div class="alert-meta">run a repo scan to surface findings here</div></div></div>';
      return;
    }

    alertsStatus.textContent = 'needs review';
    alertsStatus.style.color = '#ff4f68';
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

  function renderActivity(events) {
    const feed = document.getElementById('activity-feed');
    if (!feed) return;
    if (!events.length) {
      feed.innerHTML = '<div class="activity-row" style="color:var(--text-muted)"><span class="act-time">—</span><span class="act-tag">—</span><span>no recent activity</span></div>';
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

  function formatBytes(value) {
    if (!Number.isFinite(value) || value <= 0) return '—';
    if (value >= 1e12) return `${(value / 1e12).toFixed(2)} TB`;
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(1)} MB`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)} KB`;
    return `${Math.round(value)} B`;
  }

  function renderLiveStats(events) {
    if (!events.length) {
      setText('liveErrorRate', '—');
      setText('liveActiveConns', '—');
      setText('liveCacheHit', '—');
      setText('liveBandwidth', '—');
      setText('liveThrottled', '—');
      return;
    }

    const statuses = events.map((event) => Number(event.status)).filter((status) => Number.isFinite(status));
    const errorCount = statuses.filter((status) => status >= 400).length;
    const errorRate = statuses.length ? (errorCount / statuses.length) * 100 : 0;
    const cacheKnown = events.filter((event) => event.cacheHit !== null);
    const cacheHitRate = cacheKnown.length
      ? (cacheKnown.filter((event) => event.cacheHit).length / cacheKnown.length) * 100
      : null;
    const totalBytes = events.reduce((sum, event) => sum + Number(event.bytes || 0), 0);

    setText('liveErrorRate', statuses.length ? `${errorRate < 0.01 && errorRate > 0 ? '<0.01' : errorRate.toFixed(errorRate < 1 ? 2 : 1)}%` : '—');
    setText('liveActiveConns', formatNum(events.length));
    setText('liveCacheHit', cacheHitRate === null ? '—' : `${cacheHitRate.toFixed(1)}%`);
    setText('liveBandwidth', formatBytes(totalBytes));
    setText('liveThrottled', String(statuses.filter((status) => status === 429).length));
  }

  function renderLiveRequestRows() {
    const feed = document.getElementById('liveApiFeed');
    if (!feed) return;
    if (!liveRequestRows.length) {
      feed.innerHTML = '<div class="live-api-empty">No user API calls yet. Calls will appear here after this account routes traffic through VaultProof.</div>';
      return;
    }
    feed.innerHTML = liveRequestRows.slice(0, 22).map((row) => {
      const status = Number(row.status);
      const statusClass = status >= 500 ? 'status-error' : status >= 400 ? 'status-warn' : '';
      return `
        <div class="live-api-row">
          <span class="live-time">${escapeHtml(formatClock(row.timestamp))}</span>
          <span class="live-method">${escapeHtml(row.method)}</span>
          <span class="live-path">${escapeHtml(row.path || 'request')}</span>
          <span class="live-status ${statusClass}">${escapeHtml(row.status == null ? '—' : row.status)}</span>
        </div>`;
    }).join('');
  }

  function renderLiveRequests(events) {
    liveRequestRows = (events || [])
      .filter(isUserApiCall)
      .map(normalizeRequestEvent)
      .filter((event) => event.path || event.status != null)
      .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
    renderLiveStats(liveRequestRows);
    renderLiveRequestRows();
  }

  function renderKpis(overview, hasData) {
    if (!hasData) {
      ['kpi-keys', 'kpi-calls', 'kpi-providers', 'kpi-errors'].forEach((id) => setText(id, '—'));
      ['kpi-keys-sub', 'kpi-calls-sub', 'kpi-providers-sub', 'kpi-errors-sub'].forEach((id) => setText(id, 'unavailable'));
      renderActivity([]);
      renderLiveRequests([]);
      return;
    }

    const totalCalls = Number(overview.totalCalls || 0);
    const errorRate = Number(overview.errorRate || 0);
    const successRate = Math.max(0, 100 - errorRate);
    const recentEvents = overview.recentActivity || [];
    const apiEvents = recentEvents.filter(isUserApiCall);
    const latencies = apiEvents
      .map(requestLatencyFromEvent)
      .filter((latency) => Number.isFinite(latency) && latency > 0)
      .sort((a, b) => a - b);
    const p99 = latencies.length
      ? latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.99))]
      : null;
    const activeRoutes = Number(overview.activeApps || currentProjectRows.filter((project) => project.keysCount > 0 || project.calls30d > 0).length || currentProjectRows.length || 0);

    setText('kpi-keys', formatNum(totalCalls));
    setText('kpi-keys-sub', totalCalls ? 'from protected traffic' : 'no traffic yet');
    setText('kpi-calls', p99 == null ? '—' : `${Number(p99).toFixed(1)}ms`);
    setText('kpi-calls-sub', latencies.length ? `${formatNum(latencies.length)} sampled calls` : 'no latency events');
    setText('kpi-providers', `${successRate.toFixed(errorRate < 1 ? 2 : 1)}%`);
    setText('kpi-providers-sub', `${errorRate.toFixed(errorRate < 1 ? 2 : 1)}% error rate`);
    const errEl = document.getElementById('kpi-errors');
    if (errEl) {
      errEl.textContent = formatNum(activeRoutes);
      if (currentProjectRows.some((project) => project.status === 'alert')) errEl.classList.add('alert');
      else errEl.classList.remove('alert');
    }
    setText('kpi-errors-sub', `${formatNum(currentProjectRows.length)} project${currentProjectRows.length === 1 ? '' : 's'}`);
    renderActivity(recentEvents);
    renderLiveRequests(apiEvents);
  }

  function renderFatalDashboardFallback() {
    ['kpi-keys', 'kpi-calls', 'kpi-providers', 'kpi-errors'].forEach((id) => setText(id, '—'));
    ['kpi-keys-sub', 'kpi-calls-sub', 'kpi-providers-sub', 'kpi-errors-sub'].forEach((id) => setText(id, 'unavailable'));
    setText('alertsStatus', 'unavailable');
    renderActivity([]);
    renderLiveRequests([]);
  }

  async function loadDashboard() {
    const dashboardSummaryPromise = apiFetchInit('/projects/stats/dashboard?days=30&limit=8');
    const scansPromise = apiFetch('/scanner/scans');

    const dashboardSummaryRaw = await dashboardSummaryPromise;
    const dashboardSummary = normalizeDashboardSummary(dashboardSummaryRaw);
    const hasDashboardSummary = Boolean(
      dashboardSummaryRaw &&
      (dashboardSummary.projects.length || dashboardSummary.usage.length || dashboardSummary.logs.length || dashboardSummary.overview.totalCalls)
    );

    if (hasDashboardSummary) {
      currentProjectRows = normalizeProjectRows(dashboardSummary.projects);
      updatePageMeta(currentProjectRows);
      renderProjectRows();
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

      scansPromise
        .then((scansRaw) => {
          renderAlerts(normalizeScans(scansRaw));
        })
        .catch(() => {
          renderAlerts([]);
        });
      return;
    }

    const [overviewRaw, usageRaw, projectsRaw, keyStatsRaw, logsRaw, scansRaw] = await Promise.all([
      apiFetchInit('/projects/stats/overview'),
      apiFetchInit('/projects/stats/usage?days=30'),
      apiFetchInit('/projects'),
      apiFetchInit('/projects/stats/by-key'),
      apiFetchInit('/projects/stats/logs?days=30&limit=8'),
      scansPromise,
    ]);

    const projects = normalizeProjects(projectsRaw);
    const keyStats = normalizeKeyStats(keyStatsRaw);
    const scans = normalizeScans(scansRaw);
    const logs = normalizeLogs(logsRaw);
    const overview = normalizeOverview(overviewRaw);
    const usageRows = normalizeUsage(usageRaw);
    const fallbackOverview = buildFallbackOverview(overview, usageRows, keyStats, logs);

    currentProjectRows = await buildProjectRows(projects, keyStats);
    updatePageMeta(currentProjectRows);
    renderProjectRows();
    renderAlerts(scans);
    renderKpis(
      fallbackOverview,
      Boolean(overviewRaw || keyStats.size || usageRows.length || logs.length || projects.length)
    );
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
    const emailLabel = document.getElementById('user-email');
    if (emailLabel) emailLabel.textContent = email || 'unknown user';
    const signOutBtn = document.getElementById('signOutBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);
  }

  initHeader();
  bindFilters();
  loadDashboard().catch(renderFatalDashboardFallback);
})();
