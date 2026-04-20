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
  let currentAlertsPayload = null;
  let currentOverviewPayload = null;
  let runNextBefore = null;
  let deliveryNextBefore = null;

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function $(id) { return document.getElementById(id); }
  function setText(id, value) { const el = $(id); if (el) el.textContent = value; }
  function setMessage(id, text, tone) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = `form-msg${tone ? ` ${tone}` : ''}`;
  }
  function toast(message, tone) {
    if (!message || !window.VaultproofToast || typeof window.VaultproofToast.show !== 'function') return;
    window.VaultproofToast.show(message, tone || 'neutral', 'Alerts');
  }
  function setButtonState(button, disabled, label) {
    if (!button) return;
    button.disabled = Boolean(disabled);
    if (label) button.textContent = label;
  }
  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
  function slugify(value) {
    return String(value || 'alerts')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'alerts';
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
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
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
  function setExportMessage(text, tone) {
    const el = $('exportMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `action-msg${tone ? ` ${tone}` : ''}`;
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
        method: opts.method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(opts.includeOrganization !== false && currentOrganizationId ? { 'x-vaultproof-organization': currentOrganizationId } : {}),
        },
        ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
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
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data };
    } catch {
      return null;
    }
  }
  function logout() {
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith('vaultproof_') || key.startsWith('sb-') || key.includes('auth-token')) localStorage.removeItem(key);
    });
    sessionStorage.clear();
    window.location.replace('/app/login?logout=1');
  }
  function toneForSeverity(value) {
    if (value === 'critical') return 'danger';
    if (value === 'warning') return 'warn';
    return 'ok';
  }
  function toneForStatus(value) {
    if (value === 'failed') return 'danger';
    if (value === 'skipped') return 'warn';
    if (value === 'dispatched' || value === 'delivered') return 'ok';
    return 'neutral';
  }
  function getFilterState() {
    return {
      activity_window: $('activityWindow')?.value || '7d',
      run_status: $('runStatusFilter')?.value || 'all',
      run_trigger: $('runTriggerFilter')?.value || 'all',
      delivery_status: $('deliveryStatusFilter')?.value || 'all',
      delivery_channel: $('deliveryChannelFilter')?.value || 'all',
      delivery_kind: $('deliveryKindFilter')?.value || 'all',
    };
  }
  function csvEscape(value) {
    const stringValue = String(value == null ? '' : value);
    return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
  }
  function downloadTextFile(filename, content, type) {
    const blob = new Blob([content], { type: type || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
  async function copyText(content) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(content);
      return true;
    }
    const textarea = document.createElement('textarea');
    textarea.value = content;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'absolute';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  }
  function buildOperationsReport() {
    const alertsPayload = currentAlertsPayload || {};
    const overviewPayload = currentOverviewPayload || {};
    const org = alertsPayload.organization || {};
    const policy = alertsPayload.policy || {};
    const status = alertsPayload.dispatch_status || {};
    const destinations = alertsPayload.destinations || [];
    const runs = alertsPayload.dispatch_runs || [];
    const deliveries = alertsPayload.delivery_logs || [];
    const alerts = overviewPayload.alerts || [];
    const filters = getFilterState();
    const enabledDestinations = destinations.filter((item) => item.enabled).length;
    const failedDeliveries = deliveries.filter((item) => item.status === 'failed').length;
    const skippedDeliveries = deliveries.filter((item) => item.status === 'skipped').length;

    return [
      `VaultProof Alerts Operations Report`,
      `Organization: ${org.name || 'Unknown org'}`,
      `Workspace: ${org.kind || 'unknown'} · role ${org.current_role || 'unknown'}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
      `Filter scope: window ${filters.activity_window}, runs ${filters.run_status}/${filters.run_trigger}, deliveries ${filters.delivery_status}/${filters.delivery_channel}/${filters.delivery_kind}`,
      '',
      `Policy`,
      `- Dispatch enabled: ${policy.dispatch_enabled ? 'yes' : 'no'}`,
      `- Minimum severity: ${policy.minimum_severity || 'warning'}`,
      `- Cooldown minutes: ${policy.min_interval_minutes || 60}`,
      `- Last dispatch: ${status.last_policy_dispatch_at ? formatTimestamp(status.last_policy_dispatch_at) : 'never'}`,
      `- Next eligible: ${status.next_eligible_at ? formatTimestamp(status.next_eligible_at) : 'now'}`,
      '',
      `Current signal`,
      `- Active alerts: ${alerts.length}`,
      `- Enabled destinations: ${enabledDestinations} of ${destinations.length}`,
      `- Dispatch runs in scope: ${runs.length}`,
      `- Delivery logs in scope: ${deliveries.length}`,
      `- Failed deliveries: ${failedDeliveries}`,
      `- Skipped deliveries: ${skippedDeliveries}`,
      '',
      `Active alerts`,
      ...(alerts.length ? alerts.slice(0, 12).map((alert, index) => `- ${index + 1}. ${alert.severity || 'info'} · ${alert.title || alert.type || 'alert'} · ${alert.project_name || alert.project_id || 'org signal'}`) : ['- none']),
      '',
      `Destinations`,
      ...(destinations.length ? destinations.map((destination) => `- ${destination.label} · ${destination.channel_type} · ${destination.target_masked} · ${destination.enabled ? 'enabled' : 'paused'}`) : ['- none']),
      '',
      `Recent dispatch runs`,
      ...(runs.length ? runs.slice(0, 8).map((run) => `- ${formatTimestamp(run.checked_at)} · ${run.trigger_source} · ${run.status} · ${run.dispatched_alert_count || 0} alerts · ${run.delivered_count || 0} delivered`) : ['- none']),
      '',
      `Recent delivery logs`,
      ...(deliveries.length ? deliveries.slice(0, 8).map((delivery) => `- ${formatTimestamp(delivery.delivered_at)} · ${delivery.channel_type} · ${delivery.delivery_kind} · ${delivery.status} · ${delivery.detail || 'delivery event'}`) : ['- none']),
    ].join('\n');
  }
  function buildDispatchRunsCsv() {
    const rows = [
      ['checked_at', 'trigger_source', 'status', 'reason', 'dispatched_alert_count', 'destination_count', 'delivered_count', 'failed_count', 'skipped_count', 'next_eligible_at'],
      ...((currentAlertsPayload?.dispatch_runs || []).map((run) => [
        run.checked_at,
        run.trigger_source,
        run.status,
        run.reason,
        run.dispatched_alert_count,
        run.destination_count,
        run.delivered_count,
        run.failed_count,
        run.skipped_count,
        run.next_eligible_at,
      ])),
    ];
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  }
  function buildDeliveryLogsCsv() {
    const rows = [
      ['delivered_at', 'channel_type', 'delivery_kind', 'status', 'response_status', 'detail'],
      ...((currentAlertsPayload?.delivery_logs || []).map((delivery) => [
        delivery.delivered_at,
        delivery.channel_type,
        delivery.delivery_kind,
        delivery.status,
        delivery.response_status,
        delivery.detail,
      ])),
    ];
    return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
  }
  function buildJsonExport() {
    return JSON.stringify({
      generated_at: new Date().toISOString(),
      filters: getFilterState(),
      alerts: currentAlertsPayload || {},
      overview: currentOverviewPayload || {},
    }, null, 2);
  }
  function getExportBaseName() {
    return `${slugify(currentAlertsPayload?.organization?.name || 'vaultproof')}-alerts`;
  }
  function renderBanner(alertsPayload, overviewPayload) {
    const org = alertsPayload?.organization || null;
    const policy = alertsPayload?.policy || null;
    const activeAlerts = overviewPayload?.alerts || [];
    const dispatchEnabled = Boolean(policy?.dispatch_enabled);
    const currentMode = org?.kind === 'personal' ? 'solo workspace' : 'shared alert control';
    setText('segmentKicker', currentMode);
    setText('segmentTitle', org ? `${org.name} alert operations` : 'Alert operations');
    setText('segmentCopy', dispatchEnabled
      ? `Policy dispatch is enabled at the ${policy.minimum_severity} threshold with a ${policy.min_interval_minutes} minute cooldown. There are ${activeAlerts.length} active alert signals in the current org window.`
      : 'Policy dispatch is currently disabled. You can still test destinations manually, review current alert signals, and tighten the automation policy here.');
    setText('segmentNote', dispatchEnabled
      ? 'Scheduled and manual dispatch share the same backend path, cooldown rules, and delivery logs.'
      : 'Enable dispatch once the destination list and severity threshold look right for this organization.');
  }
  function renderUsageBox(alertsPayload) {
    const destinations = alertsPayload?.destinations || [];
    const enabled = destinations.filter((item) => item.enabled).length;
    const percent = destinations.length ? Math.max(6, Math.min(100, (enabled / destinations.length) * 100)) : 6;
    setText('usagePlanLabel', 'alert operations');
    setText('usageMetricLabel', 'destinations');
    setText('usageMetricValue', `${enabled}`);
    const bar = $('usageBarFill');
    if (bar) bar.style.width = `${percent}%`;
    setText('usageMetricNote', `${destinations.length} total configured for this organization`);
  }
  function renderKpis(alertsPayload, overviewPayload) {
    const org = alertsPayload?.organization || null;
    const activeAlerts = overviewPayload?.alerts || [];
    const destinations = alertsPayload?.destinations || [];
    const enabledDestinations = destinations.filter((item) => item.enabled).length;
    const dispatchRuns = alertsPayload?.dispatch_runs || [];
    const deliveryLogs = alertsPayload?.delivery_logs || [];
    const lastDispatch = alertsPayload?.dispatch_status?.last_policy_dispatch_at || null;
    const failedDeliveries = deliveryLogs.filter((item) => item.status === 'failed').length;
    const skippedDeliveries = deliveryLogs.filter((item) => item.status === 'skipped').length;

    setText('pageMeta', org ? `/ ${org.name}` : '/ alerts');
    setText('kpi-alerts', formatNum(activeAlerts.length));
    setText('kpi-alerts-sub', activeAlerts.length ? 'current pilot alerts' : 'no active pilot alerts');
    setText('kpi-destinations', formatNum(enabledDestinations));
    setText('kpi-destinations-sub', `${destinations.length} configured destination${destinations.length === 1 ? '' : 's'}`);
    setText('kpi-dispatch', lastDispatch ? relTime(lastDispatch) : 'never');
    setText('kpi-dispatch-sub', dispatchRuns.length ? `${dispatchRuns[0].status} via ${dispatchRuns[0].trigger_source}` : 'no dispatch runs yet');
    const healthEl = $('kpi-health');
    if (healthEl) {
      healthEl.textContent = failedDeliveries ? `${failedDeliveries} failed` : skippedDeliveries ? `${skippedDeliveries} skipped` : 'clear';
      healthEl.className = `kpi-value ${failedDeliveries ? 'danger' : skippedDeliveries ? 'warn' : 'ok'}`.trim();
    }
    setText('kpi-health-sub', failedDeliveries ? 'delivery failures need review' : skippedDeliveries ? 'email or policy skips in range' : 'recent delivery path looks healthy');
  }
  function renderPolicy(alertsPayload) {
    const policy = alertsPayload?.policy || {};
    const status = alertsPayload?.dispatch_status || {};
    const canManage = Boolean(alertsPayload?.can_manage);
    const dispatchEnabled = $('dispatchEnabled');
    const minimumSeverity = $('minimumSeverity');
    const minIntervalMinutes = $('minIntervalMinutes');
    if (dispatchEnabled) {
      dispatchEnabled.checked = Boolean(policy.dispatch_enabled);
      dispatchEnabled.disabled = !canManage;
    }
    if (minimumSeverity) {
      minimumSeverity.value = policy.minimum_severity || 'warning';
      minimumSeverity.disabled = !canManage;
    }
    if (minIntervalMinutes) {
      minIntervalMinutes.value = String(policy.min_interval_minutes || 60);
      minIntervalMinutes.disabled = !canManage;
    }
    setText('policyStatus', status.cooldown_active ? `cooldown until ${relTime(status.next_eligible_at)}` : policy.dispatch_enabled ? 'dispatch enabled' : 'dispatch disabled');
    setMessage('policyMsg', canManage
      ? `Next eligible dispatch ${status.next_eligible_at ? relTime(status.next_eligible_at) : 'is available now'}.`
      : 'You can review alert policy here, but only admins can change it.', canManage ? '' : 'warn');
    const savePolicyBtn = $('savePolicyBtn');
    const testAllBtn = $('testAllBtn');
    const dispatchCurrentBtn = $('dispatchCurrentBtn');
    if (savePolicyBtn) savePolicyBtn.disabled = !canManage;
    if (testAllBtn) testAllBtn.disabled = !canManage;
    if (dispatchCurrentBtn) dispatchCurrentBtn.disabled = !canManage;
  }
  function renderDestinations(alertsPayload) {
    const list = $('destinationsList');
    const destinations = alertsPayload?.destinations || [];
    const canManage = Boolean(alertsPayload?.can_manage);
    const destinationLabel = $('destinationLabel');
    const destinationChannel = $('destinationChannel');
    const destinationTarget = $('destinationTarget');
    const addDestinationBtn = $('addDestinationBtn');
    if (destinationLabel) destinationLabel.disabled = !canManage;
    if (destinationChannel) destinationChannel.disabled = !canManage;
    if (destinationTarget) destinationTarget.disabled = !canManage;
    if (addDestinationBtn) addDestinationBtn.disabled = !canManage;
    setText('destinationsStatus', `${destinations.length} configured · ${destinations.filter((item) => item.enabled).length} enabled`);
    if (!list) return;
    if (!destinations.length) {
      list.innerHTML = '<div class="empty">No destinations yet. Add an email or webhook target to start testing alert delivery.</div>';
      return;
    }
    list.innerHTML = destinations.map((destination) => `
      <div class="destination-card">
        <div class="destination-head">
          <div>
            <div class="destination-title">${escapeHtml(destination.label)}</div>
            <div class="destination-meta">${escapeHtml(destination.channel_type)} · ${escapeHtml(destination.target_masked)} · updated ${relTime(destination.updated_at || destination.created_at)}</div>
          </div>
          <span class="pill ${destination.enabled ? 'ok' : 'warn'}">${destination.enabled ? 'enabled' : 'paused'}</span>
        </div>
        <div class="destination-actions">
          <button type="button" class="btn-outline" data-destination-toggle="${escapeHtml(destination.id)}" data-next-enabled="${destination.enabled ? 'false' : 'true'}" ${canManage ? '' : 'disabled'}>${destination.enabled ? 'pause' : 'enable'}</button>
          <button type="button" class="btn-outline" data-destination-test="${escapeHtml(destination.id)}" ${canManage ? '' : 'disabled'}>test send</button>
          <button type="button" class="btn-danger" data-destination-delete="${escapeHtml(destination.id)}" ${canManage ? '' : 'disabled'}>remove</button>
        </div>
      </div>
    `).join('');
  }
  function renderSignals(overviewPayload) {
    const list = $('signalList');
    const alerts = overviewPayload?.alerts || [];
    setText('signalStatus', `${alerts.length} active`);
    if (!list) return;
    if (!alerts.length) {
      list.innerHTML = '<div class="empty">No active alerts for the current org window.</div>';
      return;
    }
    list.innerHTML = alerts.map((alert, index) => `
      <div class="list-row">
        <div class="list-rank">${String(index + 1).padStart(2, '0')}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(alert.title || alert.type || 'active alert')}</div>
          <div class="list-sub">${escapeHtml(alert.project_name || alert.project_id || 'org signal')} · ${escapeHtml(alert.description || alert.reason || 'current pilot signal')}</div>
        </div>
        <div class="list-meta"><span class="pill ${toneForSeverity(alert.severity)}">${escapeHtml(alert.severity || 'info')}</span></div>
      </div>
    `).join('');
  }
  function renderRuns(alertsPayload) {
    const list = $('runsList');
    const runs = alertsPayload?.dispatch_runs || [];
    setText('runsStatus', `${alertsPayload?.dispatch_runs_meta?.total || runs.length} in range`);
    if (!list) return;
    if (!runs.length) {
      list.innerHTML = '<div class="empty">No dispatch runs match the current filters.</div>';
      return;
    }
    list.innerHTML = runs.map((run, index) => `
      <div class="list-row">
        <div class="list-rank">${String(index + 1).padStart(2, '0')}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(run.trigger_source)} dispatch ${escapeHtml(run.status)}</div>
          <div class="list-sub">${escapeHtml(String(run.dispatched_alert_count || 0))} alerts · ${escapeHtml(String(run.delivered_count || 0))} delivered · ${escapeHtml(String(run.failed_count || 0))} failed · ${relTime(run.checked_at)}</div>
        </div>
        <div class="list-meta"><span class="pill ${toneForStatus(run.status)}">${escapeHtml(run.status)}</span></div>
      </div>
    `).join('');
  }
  function renderDeliveries(alertsPayload) {
    const list = $('deliveryList');
    const deliveries = alertsPayload?.delivery_logs || [];
    setText('deliveryStatus', `${alertsPayload?.delivery_logs_meta?.total || deliveries.length} in range`);
    if (!list) return;
    if (!deliveries.length) {
      list.innerHTML = '<div class="empty">No delivery logs match the current filters.</div>';
      return;
    }
    list.innerHTML = deliveries.map((delivery, index) => `
      <div class="list-row">
        <div class="list-rank">${String(index + 1).padStart(2, '0')}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(delivery.channel_type)} ${escapeHtml(delivery.delivery_kind)}</div>
          <div class="list-sub">${escapeHtml(delivery.detail || 'delivery event')} · ${delivery.response_status ? `status ${escapeHtml(String(delivery.response_status))} · ` : ''}${relTime(delivery.delivered_at)}</div>
        </div>
        <div class="list-meta"><span class="pill ${toneForStatus(delivery.status)}">${escapeHtml(delivery.status)}</span></div>
      </div>
    `).join('');
  }
  function buildAlertsQuery() {
    const params = new URLSearchParams();
    params.set('activity_window', $('activityWindow')?.value || '7d');
    params.set('run_status', $('runStatusFilter')?.value || 'all');
    params.set('run_trigger', $('runTriggerFilter')?.value || 'all');
    params.set('delivery_status', $('deliveryStatusFilter')?.value || 'all');
    params.set('delivery_channel', $('deliveryChannelFilter')?.value || 'all');
    params.set('delivery_kind', $('deliveryKindFilter')?.value || 'all');
    params.set('run_limit', '8');
    params.set('delivery_limit', '8');
    if (arguments[0] === 'runs' && runNextBefore) params.set('run_before', runNextBefore);
    if (arguments[0] === 'deliveries' && deliveryNextBefore) params.set('delivery_before', deliveryNextBefore);
    return params.toString();
  }
  function renderPaging(alertsPayload) {
    const runsMeta = alertsPayload?.dispatch_runs_meta || {};
    const deliveriesMeta = alertsPayload?.delivery_logs_meta || {};
    const runsBtn = $('loadMoreRunsBtn');
    const deliveriesBtn = $('loadMoreDeliveriesBtn');
    if (runsBtn) {
      runsBtn.hidden = !runsMeta.has_more;
      runsBtn.disabled = false;
      runsBtn.textContent = 'load more runs';
    }
    if (deliveriesBtn) {
      deliveriesBtn.hidden = !deliveriesMeta.has_more;
      deliveriesBtn.disabled = false;
      deliveriesBtn.textContent = 'load more deliveries';
    }
  }
  function mergeAlertsPayload(nextAlertsData, loadMoreKind) {
    if (!loadMoreKind || !currentAlertsPayload) {
      runNextBefore = nextAlertsData?.dispatch_runs_meta?.next_before || null;
      deliveryNextBefore = nextAlertsData?.delivery_logs_meta?.next_before || null;
      return nextAlertsData;
    }

    const merged = Object.assign({}, currentAlertsPayload, nextAlertsData);
    if (loadMoreKind === 'runs') {
      merged.dispatch_runs = (currentAlertsPayload.dispatch_runs || []).concat(nextAlertsData.dispatch_runs || []);
      merged.dispatch_runs_meta = nextAlertsData.dispatch_runs_meta || currentAlertsPayload.dispatch_runs_meta || {};
      merged.delivery_logs = currentAlertsPayload.delivery_logs || [];
      merged.delivery_logs_meta = currentAlertsPayload.delivery_logs_meta || {};
      runNextBefore = merged.dispatch_runs_meta?.next_before || null;
    }
    if (loadMoreKind === 'deliveries') {
      merged.delivery_logs = (currentAlertsPayload.delivery_logs || []).concat(nextAlertsData.delivery_logs || []);
      merged.delivery_logs_meta = nextAlertsData.delivery_logs_meta || currentAlertsPayload.delivery_logs_meta || {};
      merged.dispatch_runs = currentAlertsPayload.dispatch_runs || [];
      merged.dispatch_runs_meta = currentAlertsPayload.dispatch_runs_meta || {};
      deliveryNextBefore = merged.delivery_logs_meta?.next_before || null;
    }
    return merged;
  }
  async function load(loadMoreKind) {
    setText('user-email', user.email || 'loading...');
    const avatar = $('user-avatar');
    if (avatar) avatar.textContent = (user.email || 'VP').charAt(0).toUpperCase();

    const orgsPayload = await apiFetch(INIT_API, '/orgs', { includeOrganization: false });
    const orgsData = unwrapPayload(orgsPayload?.data) || {};
    availableOrganizations = Array.isArray(orgsData.organizations) ? orgsData.organizations : [];
    const selectedOrganization = chooseOrganization(availableOrganizations, orgsData.active_organization_id || null);
    persistOrganizationSelection(selectedOrganization?.id || null);
    syncOrganizationUrl(currentOrganizationId);
    renderOrganizationSelector();

    const [alertsPayload, overviewPayload] = await Promise.all([
      apiFetch(INIT_API, `/alerts?${buildAlertsQuery(loadMoreKind)}`),
      apiFetch(INIT_API, '/projects/stats/overview'),
    ]);

    const alertsData = unwrapPayload(alertsPayload?.data) || {};
    const overviewData = unwrapPayload(overviewPayload?.data) || {};
    currentAlertsPayload = mergeAlertsPayload(alertsData, loadMoreKind);
    currentOverviewPayload = overviewData;

    renderBanner(currentAlertsPayload, overviewData);
    renderUsageBox(currentAlertsPayload);
    renderKpis(currentAlertsPayload, overviewData);
    renderPolicy(currentAlertsPayload);
    renderDestinations(currentAlertsPayload);
    renderSignals(overviewData);
    renderRuns(currentAlertsPayload);
    renderDeliveries(currentAlertsPayload);
    renderPaging(currentAlertsPayload);
  }
  async function savePolicy() {
    const savePolicyBtn = $('savePolicyBtn');
    setButtonState(savePolicyBtn, true, 'saving...');
    setMessage('policyMsg', 'Saving alert policy…', '');
    const res = await apiFetch(INIT_API, '/alerts/policy', {
      method: 'PUT',
      body: {
        dispatch_enabled: Boolean($('dispatchEnabled')?.checked),
        minimum_severity: $('minimumSeverity')?.value || 'warning',
        min_interval_minutes: Number($('minIntervalMinutes')?.value || 60),
      },
    });
    if (!res?.ok) {
      setButtonState(savePolicyBtn, false, 'save policy');
      const message = res?.data?.error || 'Could not update alert policy.';
      setMessage('policyMsg', message, 'danger');
      toast(message, 'danger');
      return;
    }
    await load();
    setButtonState($('savePolicyBtn'), false, 'save policy');
    setMessage('policyMsg', 'Alert policy saved.', 'ok');
    toast('Alert policy saved.', 'ok');
  }
  async function addDestination() {
    const addDestinationBtn = $('addDestinationBtn');
    setButtonState(addDestinationBtn, true, 'adding...');
    setMessage('destinationMsg', 'Creating destination…', '');
    const res = await apiFetch(INIT_API, '/alerts', {
      method: 'POST',
      body: {
        channel_type: $('destinationChannel')?.value || 'webhook',
        label: $('destinationLabel')?.value || '',
        target: $('destinationTarget')?.value || '',
      },
    });
    if (!res?.ok) {
      setButtonState(addDestinationBtn, false, 'add destination');
      const message = res?.data?.error || 'Could not create alert destination.';
      setMessage('destinationMsg', message, 'danger');
      toast(message, 'danger');
      return;
    }
    if ($('destinationLabel')) $('destinationLabel').value = '';
    if ($('destinationTarget')) $('destinationTarget').value = '';
    await load();
    setButtonState($('addDestinationBtn'), false, 'add destination');
    setMessage('destinationMsg', 'Destination added.', 'ok');
    toast('Destination added.', 'ok');
  }
  async function testSend(destinationId, trigger) {
    setButtonState(trigger, true, 'sending...');
    const res = await apiFetch(INIT_API, '/alerts/test-send', {
      method: 'POST',
      body: destinationId ? { destination_id: destinationId } : {},
    });
    if (!res?.ok) {
      setButtonState(trigger, false, destinationId ? 'test send' : 'send test alerts');
      const message = res?.data?.error || 'Could not send test alerts.';
      setMessage('policyMsg', message, 'danger');
      toast(message, 'danger');
      return;
    }
    await load();
    if (!destinationId) setButtonState($('testAllBtn'), false, 'send test alerts');
    setMessage('policyMsg', 'Test alert payload sent.', 'ok');
    toast('Test alert payload sent.', 'ok');
  }
  async function dispatchCurrent(trigger) {
    setButtonState(trigger, true, 'dispatching...');
    setMessage('policyMsg', 'Dispatching current alerts…', '');
    const res = await apiFetch(INIT_API, '/alerts/dispatch-current', { method: 'POST', body: {} });
    if (!res?.ok) {
      setButtonState(trigger, false, 'dispatch current');
      const message = res?.data?.error || 'Could not dispatch current alerts.';
      setMessage('policyMsg', message, 'danger');
      toast(message, 'danger');
      return;
    }
    await load();
    setButtonState($('dispatchCurrentBtn'), false, 'dispatch current');
    const resultMessage = res?.data?.reason || 'Current alerts dispatched.';
    setMessage('policyMsg', resultMessage, res?.data?.skipped ? 'warn' : 'ok');
    toast(resultMessage, res?.data?.skipped ? 'warn' : 'ok');
  }
  async function updateDestination(destinationId, enabled, trigger) {
    setButtonState(trigger, true, enabled ? 'enabling...' : 'pausing...');
    const res = await apiFetch(INIT_API, `/alerts/${encodeURIComponent(destinationId)}`, {
      method: 'PUT',
      body: { enabled },
    });
    if (!res?.ok) {
      setButtonState(trigger, false, enabled ? 'enable' : 'pause');
      const message = res?.data?.error || 'Could not update destination.';
      setMessage('destinationMsg', message, 'danger');
      toast(message, 'danger');
      return;
    }
    await load();
    const message = enabled ? 'Destination enabled.' : 'Destination paused.';
    setMessage('destinationMsg', message, 'ok');
    toast(message, 'ok');
  }
  async function deleteDestination(destinationId, trigger) {
    setButtonState(trigger, true, 'removing...');
    const res = await apiFetch(INIT_API, `/alerts/${encodeURIComponent(destinationId)}`, { method: 'DELETE' });
    if (!res?.ok) {
      setButtonState(trigger, false, 'remove');
      const message = res?.data?.error || 'Could not remove destination.';
      setMessage('destinationMsg', message, 'danger');
      toast(message, 'danger');
      return;
    }
    await load();
    setMessage('destinationMsg', 'Destination removed.', 'ok');
    toast('Destination removed.', 'ok');
  }
  async function copyReport() {
    try {
      const copied = await copyText(buildOperationsReport());
      setExportMessage(copied ? 'Operations report copied.' : 'Could not copy report.', copied ? 'ok' : 'danger');
      toast(copied ? 'Operations report copied.' : 'Could not copy report.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy report.', 'danger');
      toast('Could not copy report.', 'danger');
    }
  }
  function downloadReport() {
    downloadTextFile(`${getExportBaseName()}-report.txt`, buildOperationsReport(), 'text/plain;charset=utf-8');
    setExportMessage('Operations report downloaded.', 'ok');
    toast('Operations report downloaded.', 'ok');
  }
  function downloadRunsCsv() {
    downloadTextFile(`${getExportBaseName()}-dispatch-runs.csv`, buildDispatchRunsCsv(), 'text/csv;charset=utf-8');
    setExportMessage('Dispatch runs CSV downloaded.', 'ok');
    toast('Dispatch runs CSV downloaded.', 'ok');
  }
  function downloadDeliveriesCsv() {
    downloadTextFile(`${getExportBaseName()}-delivery-logs.csv`, buildDeliveryLogsCsv(), 'text/csv;charset=utf-8');
    setExportMessage('Delivery logs CSV downloaded.', 'ok');
    toast('Delivery logs CSV downloaded.', 'ok');
  }
  function downloadJson() {
    downloadTextFile(`${getExportBaseName()}-snapshot.json`, buildJsonExport(), 'application/json;charset=utf-8');
    setExportMessage('Alert snapshot JSON downloaded.', 'ok');
    toast('Alert snapshot JSON downloaded.', 'ok');
  }
  function bind() {
    if ($('signOutBtn')) $('signOutBtn').addEventListener('click', logout);
    if ($('refreshBtn')) $('refreshBtn').addEventListener('click', function() { load(); });
    if ($('savePolicyBtn')) $('savePolicyBtn').addEventListener('click', savePolicy);
    if ($('addDestinationBtn')) $('addDestinationBtn').addEventListener('click', addDestination);
    if ($('testAllBtn')) $('testAllBtn').addEventListener('click', function(event) { testSend(null, event.currentTarget); });
    if ($('dispatchCurrentBtn')) $('dispatchCurrentBtn').addEventListener('click', function(event) { dispatchCurrent(event.currentTarget); });
    if ($('copyReportBtn')) $('copyReportBtn').addEventListener('click', copyReport);
    if ($('downloadReportBtn')) $('downloadReportBtn').addEventListener('click', downloadReport);
    if ($('downloadRunsBtn')) $('downloadRunsBtn').addEventListener('click', downloadRunsCsv);
    if ($('downloadDeliveriesBtn')) $('downloadDeliveriesBtn').addEventListener('click', downloadDeliveriesCsv);
    if ($('downloadJsonBtn')) $('downloadJsonBtn').addEventListener('click', downloadJson);
    if ($('loadMoreRunsBtn')) $('loadMoreRunsBtn').addEventListener('click', function(event) {
      setButtonState(event.currentTarget, true, 'loading...');
      load('runs');
    });
    if ($('loadMoreDeliveriesBtn')) $('loadMoreDeliveriesBtn').addEventListener('click', function(event) {
      setButtonState(event.currentTarget, true, 'loading...');
      load('deliveries');
    });
    if ($('orgSelect')) {
      $('orgSelect').addEventListener('change', function(event) {
        const nextOrgId = event.target.value || '';
        persistOrganizationSelection(nextOrgId);
        syncOrganizationUrl(currentOrganizationId);
        renderOrganizationSelector();
        runNextBefore = null;
        deliveryNextBefore = null;
        currentAlertsPayload = null;
        load();
      });
    }
    ['activityWindow', 'runStatusFilter', 'runTriggerFilter', 'deliveryStatusFilter', 'deliveryChannelFilter', 'deliveryKindFilter'].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener('change', function() {
        runNextBefore = null;
        deliveryNextBefore = null;
        currentAlertsPayload = null;
        load();
      });
    });
    document.addEventListener('click', async function(event) {
      const toggleBtn = event.target.closest('[data-destination-toggle]');
      if (toggleBtn) {
        const destinationId = toggleBtn.getAttribute('data-destination-toggle');
        const nextEnabled = toggleBtn.getAttribute('data-next-enabled') === 'true';
        if (destinationId) await updateDestination(destinationId, nextEnabled, toggleBtn);
        return;
      }
      const testBtn = event.target.closest('[data-destination-test]');
      if (testBtn) {
        const destinationId = testBtn.getAttribute('data-destination-test');
        if (destinationId) await testSend(destinationId, testBtn);
        return;
      }
      const deleteBtn = event.target.closest('[data-destination-delete]');
      if (deleteBtn) {
        const destinationId = deleteBtn.getAttribute('data-destination-delete');
        if (destinationId) await deleteDestination(destinationId, deleteBtn);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { bind(); load(); });
  } else {
    bind();
    load();
  }
})();
