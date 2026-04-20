(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';
  const ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';

  let token = localStorage.getItem('vaultproof_token');
  const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;
  let currentOrganizationId = null;
  let availableOrganizations = [];
  let nextBefore = null;
  let events = [];
  let latestAuditPayload = null;

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function $(id) { return document.getElementById(id); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
  function toast(message, tone) {
    if (!message || !window.VaultproofToast || typeof window.VaultproofToast.show !== 'function') return;
    window.VaultproofToast.show(message, tone || 'neutral', 'Audit');
  }
  function slugify(value) {
    return String(value || 'audit')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'audit';
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function formatNum(value) {
    const num = Number(value || 0);
    if (num >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
    if (num >= 1e3) return `${(num / 1e3).toFixed(1)}k`;
    return num.toLocaleString('en-US');
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
  function unwrapPayload(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
    if (data.data && typeof data.data === 'object') return unwrapPayload(data.data);
    if (data.result && typeof data.result === 'object') return unwrapPayload(data.result);
    return data;
  }
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
    return localStorage.getItem('vaultproof_refresh_token') || extractRefreshToken(localStorage.getItem(SUPABASE_AUTH_STORAGE_KEY));
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
  function getRequestedOrganizationId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('org') || localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
  }
  function persistOrganizationSelection(orgId) {
    currentOrganizationId = orgId || null;
    if (currentOrganizationId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrganizationId);
    else localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
  }
  function syncOrganizationUrl(orgId) {
    const params = new URLSearchParams(window.location.search);
    if (orgId) params.set('org', orgId);
    else params.delete('org');
    const next = `${window.location.pathname}${params.toString() ? '?' + params.toString() : ''}`;
    window.history.replaceState({}, '', next);
  }
  function chooseOrganization(orgs, activeOrganizationId) {
    const requestedId = getRequestedOrganizationId();
    const requested = orgs.find((org) => org.id === requestedId) || null;
    if (requested) return requested;
    const active = orgs.find((org) => org.id === activeOrganizationId) || null;
    if (active && active.kind !== 'personal') return active;
    const shared = orgs.find((org) => org.kind && org.kind !== 'personal') || null;
    if (shared) return shared;
    return active || orgs[0] || null;
  }
  function renderOrganizationSelector() {
    const select = $('orgSelect');
    const status = $('orgSwitcherStatus');
    if (!select) return;
    if (!availableOrganizations.length) {
      select.innerHTML = '<option value="">No orgs available</option>';
      select.disabled = true;
      if (status) status.textContent = 'No org loaded';
      return;
    }
    select.innerHTML = availableOrganizations.map((org) => {
      const suffix = org.kind === 'personal' ? 'solo' : org.role;
      return `<option value="${escapeHtml(org.id)}">${escapeHtml(org.name)} · ${escapeHtml(suffix)}</option>`;
    }).join('');
    select.disabled = false;
    select.value = currentOrganizationId || availableOrganizations[0].id;
    const current = availableOrganizations.find((org) => org.id === select.value) || null;
    if (status) status.textContent = current ? `${current.kind === 'personal' ? 'solo workspace' : 'shared org'}` : 'Org loading…';
  }
  async function apiFetch(base, path, options) {
    const opts = options || {};
    try {
      const res = await fetch(`${base}${path}`, {
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(opts.includeOrganization !== false && currentOrganizationId ? { 'x-vaultproof-organization': currentOrganizationId } : {}),
        },
      });
      if (res.status === 401) {
        if (!refreshAttempted) {
          refreshAttempted = true;
          const refreshed = await tryRefreshToken();
          if (refreshed) return apiFetch(base, path, opts);
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
      if (key.startsWith('vaultproof_') || key.startsWith('sb-') || key.includes('auth-token')) {
        localStorage.removeItem(key);
      }
    });
    sessionStorage.clear();
    window.location.replace('/app/login?logout=1');
  }
  function renderUsageBox(summary) {
    const total = Number(summary?.totalEvents || events.length || 0);
    const percent = Math.max(6, Math.min(100, total ? total / 2 : 6));
    setText('usagePlanLabel', 'audit feed');
    setText('usageMetricLabel', 'events');
    setText('usageMetricValue', formatNum(total));
    const bar = $('usageBarFill');
    if (bar) bar.style.width = `${percent}%`;
    setText('usageMetricNote', `${summary?.governanceEvents || 0} governance · ${summary?.proxyEvents || 0} proxy`);
  }
  function renderEventTypeOptions(eventList) {
    const select = $('eventTypeFilter');
    if (!select) return;
    const currentValue = select.value;
    const types = Array.from(new Set(eventList.map((event) => event.event_type).filter(Boolean))).sort();
    select.innerHTML = '<option value="">all event types</option>' + types.map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join('');
    select.value = types.includes(currentValue) ? currentValue : '';
  }
  function renderKpis(payload) {
    const org = payload?.organization || null;
    const summary = payload?.summary || {};
    setText('pageMeta', org ? `/ ${org.name}` : '/ audit');
    setText('kpi-org', org?.name || '—');
    setText('kpi-org-sub', org ? `${org.kind} · audit timeline` : 'organization unavailable');
    setText('kpi-events', formatNum(events.length));
    setText('kpi-events-sub', payload?.has_more ? 'more available' : 'timeline loaded');
    setText('kpi-governance', formatNum(summary.governanceEvents || 0));
    setText('kpi-governance-sub', 'membership, policy, and org events');
    setText('kpi-proxy', formatNum(summary.proxyEvents || 0));
    setText('kpi-proxy-sub', 'runtime access events');
    setText('timelineStatus', `${events.length} loaded`);
    setText('mixStatus', `${summary.totalEvents || events.length} total in range`);
    renderUsageBox(summary);
  }
  function toneForEvent(event) {
    if (event.source === 'proxy') {
      return event.status && event.status >= 400 ? 'danger' : 'ok';
    }
    if ((event.event_type || '').includes('removed') || (event.event_type || '').includes('archived')) return 'warn';
    if ((event.event_type || '').includes('revoked') || (event.event_type || '').includes('failed')) return 'danger';
    return 'neutral';
  }
  function renderTimeline() {
    const list = $('timelineList');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="empty">No audit events match the current filters.</div>';
      return;
    }
    list.innerHTML = events.map((event, index) => {
      const tone = toneForEvent(event);
      const sourceTone = event.source === 'proxy' ? 'ok' : 'neutral';
      const sourceMeta = event.source === 'proxy'
        ? [event.provider, event.method, event.upstream_path].filter(Boolean).join(' · ')
        : [event.actor, event.target_type, event.target_id].filter(Boolean).join(' · ');
      return `
        <div class="event-row">
          <div class="event-rank">${String(index + 1).padStart(2, '0')}</div>
          <div class="event-main">
            <div class="event-title">${escapeHtml(event.description || event.event_type || 'event')}</div>
            <div class="event-sub">${escapeHtml(event.source || 'unknown')} · ${relTime(event.timestamp)} · ${escapeHtml(sourceMeta || 'no extra metadata')}</div>
            <div class="event-meta">
              <span class="pill ${sourceTone}">${escapeHtml(event.source || 'event')}</span>
              <span class="pill ${tone}">${escapeHtml(event.event_type || 'unknown')}</span>
              ${event.status ? `<span class="pill ${event.status >= 400 ? 'danger' : 'ok'}">${escapeHtml(String(event.status))}</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
  function renderMix() {
    const list = $('mixList');
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="empty">No event mix available yet.</div>';
      return;
    }
    const counts = events.reduce((acc, event) => {
      const key = event.event_type || 'unknown';
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const rows = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    list.innerHTML = rows.map(([eventType, count], index) => `
      <div class="list-row">
        <div class="list-rank">${String(index + 1).padStart(2, '0')}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(eventType)}</div>
          <div class="list-sub">${count === 1 ? 'single event' : `${count} events`} in current timeline</div>
        </div>
        <div class="list-meta"><span class="pill neutral">${escapeHtml(String(count))}</span></div>
      </div>
    `).join('');
  }
  function buildReport() {
    const org = latestAuditPayload?.organization || null;
    const summary = latestAuditPayload?.summary || {};
    const source = $('sourceFilter')?.value || 'all';
    const eventType = $('eventTypeFilter')?.value || 'all';
    const q = $('searchInput')?.value.trim() || '';
    const lines = [
      `VaultProof Audit Report`,
      `Organization: ${org?.name || 'Unknown'}`,
      `Loaded events: ${events.length}`,
      `Governance events: ${summary.governanceEvents || 0}`,
      `Proxy events: ${summary.proxyEvents || 0}`,
      `Source filter: ${source}`,
      `Event type filter: ${eventType}`,
      `Search: ${q || 'none'}`,
      '',
      'Recent events:',
    ];
    events.slice(0, 25).forEach((event, index) => {
      const meta = event.source === 'proxy'
        ? [event.provider, event.method, event.upstream_path].filter(Boolean).join(' · ')
        : [event.actor, event.target_type, event.target_id].filter(Boolean).join(' · ');
      lines.push(`${String(index + 1).padStart(2, '0')}. ${event.description || event.event_type || 'event'} | ${event.source || 'unknown'} | ${event.timestamp || ''} | ${meta || 'no metadata'}`);
    });
    return lines.join('\n');
  }
  function buildJsonExport() {
    return JSON.stringify({
      organization: latestAuditPayload?.organization || null,
      summary: latestAuditPayload?.summary || null,
      filters: {
        source: $('sourceFilter')?.value || '',
        event_type: $('eventTypeFilter')?.value || '',
        q: $('searchInput')?.value.trim() || '',
      },
      events,
    }, null, 2);
  }
  async function copyReport() {
    const text = buildReport();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast('Audit report copied.', 'ok');
    } catch {
      toast('Could not copy audit report.', 'danger');
    }
  }
  function downloadJson() {
    const orgName = latestAuditPayload?.organization?.name || 'audit';
    const blob = new Blob([buildJsonExport()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${slugify(orgName)}-audit-export.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    toast('Audit JSON downloaded.', 'ok');
  }
  function buildAuditPath(loadMore) {
    const params = new URLSearchParams();
    params.set('days', '30');
    params.set('limit', '40');
    const source = $('sourceFilter')?.value || '';
    const eventType = $('eventTypeFilter')?.value || '';
    const q = $('searchInput')?.value.trim() || '';
    if (source) params.set('source', source);
    if (eventType) params.set('event_type', eventType);
    if (q) params.set('q', q);
    if (loadMore && nextBefore) params.set('before', nextBefore);
    return `/audit?${params.toString()}`;
  }
  async function loadAudit(loadMore) {
    const payload = await apiFetch(INIT_API, buildAuditPath(loadMore));
    const data = unwrapPayload(payload) || {};
    latestAuditPayload = data;
    const freshEvents = data.events || [];
    events = loadMore ? events.concat(freshEvents) : freshEvents;
    nextBefore = data.next_before || null;
    renderEventTypeOptions(events);
    renderKpis(data);
    renderTimeline();
    renderMix();
    const loadMoreBtn = $('loadMoreBtn');
    if (loadMoreBtn) loadMoreBtn.disabled = !data.has_more;
  }
  async function load() {
    setText('user-email', user.email || 'loading...');
    const avatar = $('user-avatar');
    if (avatar) avatar.textContent = (user.email || 'VP').charAt(0).toUpperCase();

    const orgsPayload = await apiFetch(INIT_API, '/orgs', { includeOrganization: false });
    const orgsData = unwrapPayload(orgsPayload) || {};
    availableOrganizations = Array.isArray(orgsData.organizations) ? orgsData.organizations : [];
    const selected = chooseOrganization(availableOrganizations, orgsData.active_organization_id || null);
    persistOrganizationSelection(selected?.id || null);
    syncOrganizationUrl(currentOrganizationId);
    renderOrganizationSelector();
    await loadAudit(false);
  }
  function bind() {
    const signOutBtn = $('signOutBtn');
    const refreshBtn = $('refreshBtn');
    const loadMoreBtn = $('loadMoreBtn');
    const copyReportBtn = $('copyReportBtn');
    const downloadJsonBtn = $('downloadJsonBtn');
    const orgSelect = $('orgSelect');
    const sourceFilter = $('sourceFilter');
    const eventTypeFilter = $('eventTypeFilter');
    const searchInput = $('searchInput');
    let searchDebounce = null;

    if (signOutBtn) signOutBtn.addEventListener('click', logout);
    if (refreshBtn) refreshBtn.addEventListener('click', function() { loadAudit(false); });
    if (loadMoreBtn) loadMoreBtn.addEventListener('click', function() { loadAudit(true); });
    if (copyReportBtn) copyReportBtn.addEventListener('click', function() { copyReport(); });
    if (downloadJsonBtn) downloadJsonBtn.addEventListener('click', function() { downloadJson(); });
    if (orgSelect) {
      orgSelect.addEventListener('change', function(event) {
        persistOrganizationSelection(event.target.value || '');
        syncOrganizationUrl(currentOrganizationId);
        renderOrganizationSelector();
        load();
      });
    }
    if (sourceFilter) sourceFilter.addEventListener('change', function() { loadAudit(false); });
    if (eventTypeFilter) eventTypeFilter.addEventListener('change', function() { loadAudit(false); });
    if (searchInput) {
      searchInput.addEventListener('input', function() {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(function() { loadAudit(false); }, 250);
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { bind(); load(); });
  } else {
    bind();
    load();
  }
})();
