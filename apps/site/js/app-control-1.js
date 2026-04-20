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
  let currentProjectsPayload = null;
  let currentMembersPayload = null;
  let currentOverviewPayload = null;
  let currentAuditPayload = null;
  let currentAlertsPayload = null;

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function $(id) { return document.getElementById(id); }

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }
  function setMessage(el, text, tone) {
    if (!el) return;
    el.textContent = text || '';
    el.className = `policy-message${tone ? ` ${tone}` : ''}`;
  }
  function setButtonState(button, disabled, label) {
    if (!button) return;
    button.disabled = Boolean(disabled);
    if (label) button.textContent = label;
  }
  function setExportMessage(text, tone) {
    const el = $('controlExportMsg');
    if (!el) return;
    el.textContent = text || '';
    el.className = `action-msg${tone ? ` ${tone}` : ''}`;
  }
  function toast(message, tone) {
    if (!message || !window.VaultproofToast || typeof window.VaultproofToast.show !== 'function') return;
    window.VaultproofToast.show(message, tone || 'neutral', 'Control');
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
    if (currentOrganizationId) {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrganizationId);
    } else {
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);
    }
  }

  function syncOrganizationUrl(orgId) {
    const params = new URLSearchParams(window.location.search);
    if (orgId) {
      params.set('org', orgId);
    } else {
      params.delete('org');
    }
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
    if (status) {
      status.textContent = current
        ? `${current.kind === 'personal' ? 'solo workspace' : 'shared org'}`
        : 'Org loading…';
    }
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
      return {
        ok: res.ok,
        status: res.status,
        data,
      };
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
  function slugify(value) {
    return String(value || 'control')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'control';
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

  function severityTone(severity) {
    if (severity === 'critical') return 'danger';
    if (severity === 'warning' || severity === 'high') return 'warn';
    return 'ok';
  }

  function classifyWorkspace(membersPayload, overviewPayload, alertsPayload) {
    const org = membersPayload?.organization || null;
    const members = membersPayload?.members || [];
    const projects = overviewPayload?.projectHealth || [];
    const activeAlerts = overviewPayload?.alerts || [];

    if (!org) {
      return {
        label: 'unknown workspace',
        title: 'No active organization found',
        copy: 'This control surface appears after an organization is available. Solo users can stay in Projects, while shared-workspace users land here for governance and operations.',
        note: 'No org resolved from the current session.',
      };
    }

    if (org.kind === 'personal') {
      return {
        label: 'solo dev workspace',
        title: `${org.name} is still in solo mode`,
        copy: 'You can keep using the regular Projects dashboard, but this control surface is ready for the moment you add a team org, invite members, or route business traffic through shared policy and audit flows.',
        note: 'Team and business users can land here without replacing the solo dashboard.',
      };
    }

    const hasBusinessSignals = members.length >= 8 || activeAlerts.length >= 3 || (alertsPayload?.destinations || []).length > 0 || projects.length >= 4;
    if (hasBusinessSignals) {
      return {
        label: 'business workspace',
        title: `${org.name} is operating in business mode`,
        copy: 'This dashboard keeps member access, delivery policy, audit review, and runtime posture together so admins can operate the account like a real control plane instead of a personal key vault.',
        note: 'Best operator destination for owners, admins, and security reviewers.',
      };
    }

    return {
      label: 'team workspace',
      title: `${org.name} is operating in team mode`,
      copy: 'This route separates shared team controls from the solo project surface. It is meant for invites, audit review, policy oversight, and the next step toward business-grade rollout.',
      note: 'A clean home for shared-workspace governance once the org is active.',
    };
  }

  function renderUsageBox(membersPayload, overviewPayload) {
    const members = membersPayload?.members || [];
    const org = membersPayload?.organization || null;
    const used = members.length;
    const cap = org?.kind === 'team' ? 25 : 5;
    const percent = Math.max(6, Math.min(100, cap ? (used / cap) * 100 : 0));
    setText('usagePlanLabel', org?.kind === 'team' ? 'team control' : 'solo control');
    setText('usageMetricLabel', 'members');
    setText('usageMetricValue', `${used}`);
    const bar = $('usageBarFill');
    if (bar) bar.style.width = `${percent}%`;
    const withTraffic = (overviewPayload?.projectHealth || []).filter((project) => project.calls > 0).length;
    setText('usageMetricNote', `${withTraffic} active project${withTraffic === 1 ? '' : 's'} in current workspace`);
  }

  function renderBanner(membersPayload, overviewPayload, alertsPayload) {
    const workspace = classifyWorkspace(membersPayload, overviewPayload, alertsPayload);
    setText('segmentKicker', workspace.label);
    setText('segmentTitle', workspace.title);
    setText('segmentCopy', workspace.copy);
    setText('segmentNote', workspace.note);
  }
  function renderIncomingInvites(membersPayload) {
    const panel = $('incomingInvitePanel');
    const list = $('incomingInviteList');
    const invites = membersPayload?.pending_invitations_for_me || [];
    setText('incomingInviteStatus', `${invites.length} pending`);
    if (!panel || !list) return;
    panel.classList.toggle('hidden', !invites.length);
    if (!invites.length) {
      list.innerHTML = '<div class="empty">No incoming invites.</div>';
      return;
    }
    list.innerHTML = invites.map((invite) => `
      <div class="invite-row">
        <div class="invite-main">
          <div class="invite-title">${escapeHtml(invite.organization?.name || 'Team invite')}</div>
          <div class="invite-sub">${escapeHtml(invite.role)} · invited ${relTime(invite.created_at)}</div>
        </div>
        <div class="invite-actions">
          <button type="button" class="btn-primary" data-invite-accept="${escapeHtml(invite.id)}">accept invite</button>
        </div>
      </div>
    `).join('');
  }

  function renderKpis(membersPayload, overviewPayload) {
    const org = membersPayload?.organization || null;
    const members = membersPayload?.members || [];
    const invitations = membersPayload?.invitations || [];
    const pendingInvites = invitations.filter((invite) => invite.status === 'pending');
    const posture = overviewPayload?.pilotReview || null;
    const postureTone = posture?.status === 'healthy' ? 'ok' : posture?.status === 'watch' ? 'warn' : posture?.status === 'action_needed' ? 'danger' : '';

    setText('kpi-org', org?.name || '—');
    setText('kpi-org-sub', org ? `${org.kind} · role ${org.current_role}` : 'organization unavailable');

    setText('kpi-members', formatNum(members.length));
    setText('kpi-members-sub', `${members.filter((member) => member.role === 'admin' || member.role === 'owner').length} admin/owner seats`);

    setText('kpi-invites', formatNum(pendingInvites.length));
    setText('kpi-invites-sub', pendingInvites.length ? 'pending access requests' : 'no pending invites');

    const postureEl = $('kpi-posture');
    if (postureEl) {
      postureEl.textContent = posture ? posture.status.replace(/_/g, ' ') : 'setup';
      postureEl.className = `kpi-value ${postureTone}`.trim();
    }
    setText('kpi-posture-sub', posture?.headline || 'no pilot review yet');
    setText('pageMeta', org ? `/ ${org.name}` : '/ control');
  }

  function renderMembers(membersPayload) {
    const members = membersPayload?.members || [];
    const invitations = membersPayload?.invitations || [];
    const grid = $('membersGrid');
    setText('membersStatus', `${members.length} members · ${invitations.filter((invite) => invite.status === 'pending').length} pending`);

    if (!grid) return;
    if (!members.length) {
      grid.innerHTML = '<div class="empty">No team members yet.</div>';
      return;
    }

    const cards = members.slice(0, 6).map((member) => {
      const projects = (member.project_access || []).slice(0, 3).map((project) => (
        `<span class="member-project">${escapeHtml(project.project_name || project.vp_proj_id)} · ${escapeHtml(project.role)}</span>`
      )).join('');

      return `
        <div class="member-card">
          <div class="member-email">${escapeHtml(member.email || member.user_id)}</div>
          <div class="member-meta">${escapeHtml(member.role)} · joined ${relTime(member.created_at)}</div>
          <div class="member-projects">${projects || '<span class="member-project">no project access yet</span>'}</div>
        </div>
      `;
    }).join('');

    grid.innerHTML = cards;
  }

  function canManageProjectPolicy(project) {
    return project?.project_role === 'owner' || project?.project_role === 'admin';
  }

  function normalizeOriginsForTextarea(value) {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .join('\n');
  }

  function renderProjectPolicies(projectsPayload) {
    const list = $('policyList');
    const projects = projectsPayload?.projects || [];
    const writableCount = projects.filter(canManageProjectPolicy).length;
    setText('policyStatus', `${projects.length} project${projects.length === 1 ? '' : 's'} · ${writableCount} writable`);

    if (!list) return;
    if (!projects.length) {
      list.innerHTML = '<div class="empty">No projects yet. Create one in the Projects view, then come back here to manage origin policy.</div>';
      return;
    }

    list.innerHTML = projects.map((project) => {
      const canManage = canManageProjectPolicy(project);
      const origins = normalizeOriginsForTextarea(project.allowed_origins);
      const policyTone = project.strict_origin ? 'warn' : 'neutral';
      const policyLabel = project.strict_origin ? 'strict origin lock' : 'observing origins';
      return `
        <div class="policy-card" data-policy-card="${escapeHtml(project.id)}">
          <div class="policy-head">
            <div>
              <div class="policy-title">${escapeHtml(project.name || project.vp_proj_id)}</div>
              <div class="policy-meta">${escapeHtml(project.vp_proj_id)} · ${escapeHtml(project.project_role || 'viewer')} access · created ${relTime(project.created_at)}</div>
            </div>
            <div class="policy-badges">
              <span class="pill ${policyTone}">${escapeHtml(policyLabel)}</span>
              <span class="pill neutral">${project.allowed_origins ? `${escapeHtml(String(project.allowed_origins.split(',').filter(Boolean).length))} origin${project.allowed_origins.split(',').filter(Boolean).length === 1 ? '' : 's'}` : 'no origin list'}</span>
            </div>
          </div>
          <div class="policy-grid">
            <div class="policy-field">
              <label class="policy-label" for="policyOrigins-${escapeHtml(project.id)}">Allowed origins</label>
              <textarea id="policyOrigins-${escapeHtml(project.id)}" class="policy-textarea" data-policy-origins="${escapeHtml(project.id)}" ${canManage ? '' : 'disabled'} placeholder="https://app.example.com&#10;https://admin.example.com">${escapeHtml(origins)}</textarea>
              <div class="policy-hint">One origin per line. Leave blank to allow requests without an origin allowlist.</div>
              <label class="policy-checkbox-row">
                <input type="checkbox" data-policy-strict="${escapeHtml(project.id)}" ${project.strict_origin ? 'checked' : ''} ${canManage ? '' : 'disabled'}>
                Enforce strict origin lock for this project
              </label>
            </div>
            <div class="policy-actions">
              <button type="button" class="btn-primary" data-policy-save="${escapeHtml(project.id)}" ${canManage ? '' : 'disabled'}>${canManage ? 'save policy' : 'read only'}</button>
              <div class="policy-message" data-policy-message="${escapeHtml(project.id)}">${canManage ? 'Admins can update origin policy here.' : 'You can review policy here, but only project admins can change it.'}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderHealth(overviewPayload) {
    const list = $('healthList');
    const review = overviewPayload?.pilotReview || null;
    const projectHealth = overviewPayload?.projectHealth || [];
    setText('healthStatus', review ? review.status.replace(/_/g, ' ') : 'setup');

    if (!list) return;
    if (!projectHealth.length) {
      list.innerHTML = '<div class="empty">No project health available yet.</div>';
      return;
    }

    list.innerHTML = projectHealth.slice(0, 6).map((project, index) => {
      const tone = project.denied > 0 || project.errors > 0 ? (project.denied >= 5 || project.errors >= 10 ? 'danger' : 'warn') : 'ok';
      const state = project.denied > 0 || project.errors > 0
        ? `${project.denied} denied · ${project.errors} errors`
        : `${project.calls} calls · stable`;
      return `
        <div class="list-row">
          <div class="list-rank">0${index + 1}</div>
          <div class="list-main">
            <div class="list-title">${escapeHtml(project.name || project.vp_proj_id)}</div>
            <div class="list-sub">${escapeHtml(project.vp_proj_id)} · ${relTime(project.lastActivity)}</div>
          </div>
          <div class="list-meta"><span class="pill ${tone}">${escapeHtml(state)}</span></div>
        </div>
      `;
    }).join('');
  }

  function renderAudit(auditPayload) {
    const list = $('auditList');
    const events = auditPayload?.events || [];
    setText('auditStatus', `${auditPayload?.summary?.totalEvents || 0} recent events`);
    if (!list) return;
    if (!events.length) {
      list.innerHTML = '<div class="empty">No recent audit activity.</div>';
      return;
    }
    list.innerHTML = events.slice(0, 8).map((event, index) => `
      <div class="list-row">
        <div class="list-rank">0${index + 1}</div>
        <div class="list-main">
          <div class="list-title">${escapeHtml(event.description || event.event_type)}</div>
          <div class="list-sub">${escapeHtml(event.source)} · ${escapeHtml(event.actor || 'system')} · ${relTime(event.timestamp)}</div>
        </div>
        <div class="list-meta">${event.status ? `<span class="pill ${event.status >= 400 ? 'danger' : 'ok'}">${escapeHtml(String(event.status))}</span>` : '<span class="pill neutral">event</span>'}</div>
      </div>
    `).join('');
  }

  function renderDispatch(alertsPayload, overviewPayload) {
    const list = $('dispatchList');
    const destinations = alertsPayload?.destinations || [];
    const dispatchRuns = alertsPayload?.dispatch_runs || [];
    const alerts = overviewPayload?.alerts || [];
    const policy = alertsPayload?.policy || null;
    const dispatchStatus = alertsPayload?.dispatch_status || null;

    setText('dispatchStatus', `${destinations.filter((item) => item.enabled).length} enabled destinations`);
    if (!list) return;

    const rows = [];
    rows.push(`
      <div class="list-row">
        <div class="list-rank">01</div>
        <div class="list-main">
          <div class="list-title">Dispatch policy</div>
          <div class="list-sub">${policy?.dispatch_enabled ? 'enabled' : 'disabled'} · threshold ${escapeHtml(policy?.minimum_severity || 'warning')} · cooldown ${escapeHtml(String(policy?.min_interval_minutes || 60))}m</div>
        </div>
        <div class="list-meta"><span class="pill ${policy?.dispatch_enabled ? 'ok' : 'warn'}">${policy?.dispatch_enabled ? 'active' : 'off'}</span></div>
      </div>
    `);

    rows.push(`
      <div class="list-row">
        <div class="list-rank">02</div>
        <div class="list-main">
          <div class="list-title">Current signal</div>
          <div class="list-sub">${alerts.length} active alert${alerts.length === 1 ? '' : 's'} · next eligible ${dispatchStatus?.next_eligible_at ? relTime(dispatchStatus.next_eligible_at) : 'now'}</div>
        </div>
        <div class="list-meta"><span class="pill ${alerts.length ? 'warn' : 'ok'}">${alerts.length ? 'attention' : 'clear'}</span></div>
      </div>
    `);

    if (dispatchRuns.length) {
      dispatchRuns.slice(0, 3).forEach((run, index) => {
        rows.push(`
          <div class="list-row">
            <div class="list-rank">0${index + 3}</div>
            <div class="list-main">
              <div class="list-title">${escapeHtml(run.trigger_source)} dispatch ${escapeHtml(run.status)}</div>
              <div class="list-sub">${escapeHtml(run.dispatched_alert_count)} alerts · ${escapeHtml(run.delivered_count)} delivered · ${relTime(run.checked_at)}</div>
            </div>
            <div class="list-meta"><span class="pill ${run.status === 'failed' ? 'danger' : run.status === 'skipped' ? 'warn' : 'ok'}">${escapeHtml(run.status)}</span></div>
          </div>
        `);
      });
    }

    list.innerHTML = rows.join('');
  }

  function buildPilotChecklistItems() {
    const membersPayload = currentMembersPayload || {};
    const projectsPayload = currentProjectsPayload || {};
    const overviewPayload = currentOverviewPayload || {};
    const alertsPayload = currentAlertsPayload || {};
    const org = membersPayload.organization || {};
    const members = membersPayload.members || [];
    const pendingInvites = (membersPayload.invitations || []).filter((invite) => invite.status === 'pending');
    const projects = projectsPayload.projects || [];
    const projectHealth = overviewPayload.projectHealth || [];
    const destinations = alertsPayload.destinations || [];
    const posture = overviewPayload.pilotReview || {};

    return [
      {
        done: org.kind && org.kind !== 'personal',
        label: org.kind && org.kind !== 'personal'
          ? `Shared org is active as ${org.name || 'team org'}.`
          : 'Create or switch into a shared org before starting an enterprise pilot.',
      },
      {
        done: members.length >= 2,
        label: members.length >= 2
          ? `${members.length} members are already in the workspace.`
          : 'Invite at least one teammate so the pilot reflects shared access instead of solo setup.',
      },
      {
        done: projects.length >= 1,
        label: projects.length >= 1
          ? `${projects.length} project${projects.length === 1 ? '' : 's'} connected for the pilot.`
          : 'Create the first shared project for the customer workflow you want to protect.',
      },
      {
        done: projects.some((project) => Boolean(project.allowed_origins) || project.strict_origin),
        label: projects.some((project) => Boolean(project.allowed_origins) || project.strict_origin)
          ? 'Origin policy is configured on at least one shared project.'
          : 'Set origin policy on the pilot project so the rollout includes real runtime controls.',
      },
      {
        done: projectHealth.some((project) => Number(project.calls || 0) > 0),
        label: projectHealth.some((project) => Number(project.calls || 0) > 0)
          ? 'Pilot traffic is reaching VaultProof and producing runtime health data.'
          : 'Send real pilot traffic through the project so runtime posture and denied-request data appear.',
      },
      {
        done: destinations.some((destination) => destination.enabled),
        label: destinations.some((destination) => destination.enabled)
          ? `${destinations.filter((destination) => destination.enabled).length} alert destination${destinations.filter((destination) => destination.enabled).length === 1 ? '' : 's'} enabled.`
          : 'Enable at least one alert destination so pilot issues reach the customer team outside the dashboard.',
      },
      {
        done: pendingInvites.length === 0 && posture.status && posture.status !== 'setup',
        label: pendingInvites.length === 0 && posture.status && posture.status !== 'setup'
          ? `Pilot review is ${String(posture.status).replace(/_/g, ' ')} with no pending invites blocking rollout.`
          : 'Clear pending invites and review the pilot status before presenting rollout results.',
      },
    ];
  }

  function renderPilotKit() {
    const resourcesEl = $('pilotKitResources');
    const checklistEl = $('pilotChecklistList');
    const org = currentMembersPayload?.organization || null;
    const workspace = classifyWorkspace(currentMembersPayload || {}, currentOverviewPayload || {}, currentAlertsPayload || {});
    const items = buildPilotChecklistItems();
    const completed = items.filter((item) => item.done).length;
    const resourceCards = [
      {
        title: 'Enterprise demo',
        copy: 'Use the enterprise demo for buyer walkthroughs and architecture framing before a pilot review.',
        href: '/enterprise-demo',
        label: 'open enterprise demo',
      },
      {
        title: 'Docs',
        copy: 'Share setup and implementation docs when the customer team is wiring the first protected project.',
        href: '/docs',
        label: 'open docs',
      },
      {
        title: 'Security',
        copy: 'Send the security page when buyers ask how VaultProof handles proxying, origin lock, and operational controls.',
        href: '/security',
        label: 'open security',
      },
      {
        title: 'Org setup',
        copy: 'Use the org page for ownership transfer, archive controls, and team-admin setup before rollout starts.',
        href: currentOrganizationId ? `/app/org?org=${encodeURIComponent(currentOrganizationId)}` : '/app/org',
        label: 'open org settings',
      },
    ];

    setText('pilotKitStatus', `${completed}/${items.length} rollout checks done`);

    if (resourcesEl) {
      resourcesEl.innerHTML = resourceCards.map((card) => `
        <div class="resource-card">
          <div class="resource-title">${escapeHtml(card.title)}</div>
          <div class="resource-copy">${escapeHtml(card.copy)}</div>
          <a class="resource-link" href="${escapeHtml(card.href)}">${escapeHtml(card.label)}</a>
        </div>
      `).join('');
    }

    if (checklistEl) {
      checklistEl.innerHTML = items.map((item) => `
        <div class="checklist-item">
          <span class="checklist-mark ${item.done ? 'done' : 'todo'}">${item.done ? '[x]' : '[ ]'}</span>
          <span>${escapeHtml(item.label)}</span>
        </div>
      `).join('');
    }

    const pageMeta = $('pageMeta');
    if (pageMeta && org?.name) {
      pageMeta.textContent = `/ ${org.name} · ${workspace.label}`;
    }
  }

  function buildPilotBrief() {
    const org = currentMembersPayload?.organization || {};
    const members = currentMembersPayload?.members || [];
    const pendingInvites = (currentMembersPayload?.invitations || []).filter((invite) => invite.status === 'pending');
    const projects = currentProjectsPayload?.projects || [];
    const posture = currentOverviewPayload?.pilotReview || {};
    const projectHealth = currentOverviewPayload?.projectHealth || [];
    const destinations = currentAlertsPayload?.destinations || [];
    const checklistItems = buildPilotChecklistItems();

    return [
      'VaultProof Pilot Checklist',
      `Organization: ${org.name || 'Unknown org'}`,
      `Workspace type: ${org.kind || 'unknown'} · role ${org.current_role || 'unknown'}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
      '',
      'Current state',
      `- Members: ${members.length}`,
      `- Pending invites: ${pendingInvites.length}`,
      `- Projects: ${projects.length}`,
      `- Projects with traffic: ${projectHealth.filter((project) => Number(project.calls || 0) > 0).length}`,
      `- Enabled alert destinations: ${destinations.filter((destination) => destination.enabled).length}`,
      `- Pilot status: ${posture.status || 'setup'}`,
      `- Pilot headline: ${posture.headline || 'No pilot headline yet'}`,
      `- Recommendation: ${posture.recommendation || 'Complete the checklist below before the customer review.'}`,
      '',
      'Pilot checklist',
      ...checklistItems.map((item) => `- ${item.done ? '[x]' : '[ ]'} ${item.label}`),
      '',
      'Useful links',
      '- Enterprise demo: /enterprise-demo',
      '- Docs: /docs',
      '- Security: /security',
      `- Org settings: ${currentOrganizationId ? `/app/org?org=${currentOrganizationId}` : '/app/org'}`,
    ].join('\n');
  }

  function buildControlReport() {
    const membersPayload = currentMembersPayload || {};
    const overviewPayload = currentOverviewPayload || {};
    const auditPayload = currentAuditPayload || {};
    const alertsPayload = currentAlertsPayload || {};
    const org = membersPayload.organization || {};
    const members = membersPayload.members || [];
    const invites = (membersPayload.invitations || []).filter((invite) => invite.status === 'pending');
    const projects = currentProjectsPayload?.projects || [];
    const posture = overviewPayload.pilotReview || {};
    const alertPolicy = alertsPayload.policy || {};
    const dispatchRuns = alertsPayload.dispatch_runs || [];
    const auditEvents = auditPayload.events || [];

    return [
      'VaultProof Control Report',
      `Organization: ${org.name || 'Unknown org'}`,
      `Workspace: ${org.kind || 'unknown'} · role ${org.current_role || 'unknown'}`,
      `Generated: ${formatTimestamp(new Date().toISOString())}`,
      '',
      'Summary',
      `- Members: ${members.length}`,
      `- Pending invites: ${invites.length}`,
      `- Projects: ${projects.length}`,
      `- Security posture: ${posture.status || 'setup'}`,
      `- Headline: ${posture.headline || 'No pilot review yet'}`,
      `- Dispatch policy: ${alertPolicy.dispatch_enabled ? 'enabled' : 'disabled'} · ${alertPolicy.minimum_severity || 'warning'} · ${alertPolicy.min_interval_minutes || 60}m cooldown`,
      '',
      'Projects',
      ...(projects.length ? projects.slice(0, 10).map((project) => `- ${project.name || project.vp_proj_id} · ${project.project_role || 'viewer'} · ${project.strict_origin ? 'strict origin' : 'observing origins'}`) : ['- none']),
      '',
      'Recent governance',
      ...(auditEvents.length ? auditEvents.slice(0, 8).map((event) => `- ${formatTimestamp(event.timestamp)} · ${event.description || event.event_type || 'event'} · ${event.source || 'unknown'}`) : ['- none']),
      '',
      'Recent dispatch',
      ...(dispatchRuns.length ? dispatchRuns.slice(0, 5).map((run) => `- ${formatTimestamp(run.checked_at)} · ${run.trigger_source} · ${run.status} · ${run.dispatched_alert_count || 0} alerts`) : ['- none']),
    ].join('\n');
  }

  function buildControlJson() {
    return JSON.stringify({
      generated_at: new Date().toISOString(),
      members: currentMembersPayload || {},
      projects: currentProjectsPayload || {},
      overview: currentOverviewPayload || {},
      audit: currentAuditPayload || {},
      alerts: currentAlertsPayload || {},
    }, null, 2);
  }

  function getControlExportBaseName() {
    return `${slugify(currentMembersPayload?.organization?.name || 'vaultproof')}-control`;
  }

  async function copyControlReport() {
    try {
      const copied = await copyText(buildControlReport());
      setExportMessage(copied ? 'Control report copied.' : 'Could not copy control report.', copied ? 'ok' : 'danger');
      toast(copied ? 'Control report copied.' : 'Could not copy control report.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy control report.', 'danger');
      toast('Could not copy control report.', 'danger');
    }
  }

  function downloadControlReport() {
    downloadTextFile(`${getControlExportBaseName()}-report.txt`, buildControlReport(), 'text/plain;charset=utf-8');
    setExportMessage('Control report downloaded.', 'ok');
    toast('Control report downloaded.', 'ok');
  }

  function downloadControlJson() {
    downloadTextFile(`${getControlExportBaseName()}-snapshot.json`, buildControlJson(), 'application/json;charset=utf-8');
    setExportMessage('Control JSON downloaded.', 'ok');
    toast('Control JSON downloaded.', 'ok');
  }

  async function copyPilotChecklist() {
    try {
      const copied = await copyText(buildPilotBrief());
      setExportMessage(copied ? 'Pilot checklist copied.' : 'Could not copy pilot checklist.', copied ? 'ok' : 'danger');
      toast(copied ? 'Pilot checklist copied.' : 'Could not copy pilot checklist.', copied ? 'ok' : 'danger');
    } catch {
      setExportMessage('Could not copy pilot checklist.', 'danger');
      toast('Could not copy pilot checklist.', 'danger');
    }
  }

  function downloadPilotChecklist() {
    downloadTextFile(`${getControlExportBaseName()}-pilot-brief.txt`, buildPilotBrief(), 'text/plain;charset=utf-8');
    setExportMessage('Pilot brief downloaded.', 'ok');
    toast('Pilot brief downloaded.', 'ok');
  }

  async function saveProjectPolicy(projectId, trigger) {
    const originsEl = document.querySelector(`[data-policy-origins="${projectId}"]`);
    const strictEl = document.querySelector(`[data-policy-strict="${projectId}"]`);
    const messageEl = document.querySelector(`[data-policy-message="${projectId}"]`);
    const project = (currentProjectsPayload?.projects || []).find((item) => item.id === projectId);

    if (!originsEl || !strictEl || !messageEl || !project) return;

    const origins = String(originsEl.value || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .join(',');

    setButtonState(trigger, true, 'saving...');
    setMessage(messageEl, 'Saving project policy…', '');

    const res = await apiFetch(INIT_API, `/projects/${encodeURIComponent(projectId)}`, {
      method: 'PUT',
      body: {
        allowed_origins: origins,
        strict_origin: Boolean(strictEl.checked),
      },
    });

    if (!res?.ok) {
      const errorMessage = res?.data?.error || (res?.status === 403 ? 'You do not have permission to change this project.' : 'Could not save project policy.');
      setButtonState(trigger, false, 'save policy');
      setMessage(messageEl, errorMessage, 'danger');
      toast(errorMessage, 'danger');
      return;
    }

    await load();
    const nextMessageEl = document.querySelector(`[data-policy-message="${projectId}"]`);
    const nextButton = document.querySelector(`[data-policy-save="${projectId}"]`);
    setMessage(nextMessageEl, `Saved policy for ${project.name || project.vp_proj_id}.`, 'ok');
    setButtonState(nextButton, false, 'save policy');
    toast(`Saved policy for ${project.name || project.vp_proj_id}.`, 'ok');
  }

  async function load() {
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

    const [membersPayload, projectsPayload, overviewPayload, auditPayload, alertsPayload] = await Promise.all([
      apiFetch(INIT_API, '/members'),
      apiFetch(INIT_API, '/projects'),
      apiFetch(INIT_API, '/projects/stats/overview'),
      apiFetch(INIT_API, '/audit?days=7&limit=8'),
      apiFetch(INIT_API, '/alerts?activity_window=7d&delivery_limit=5&run_limit=5'),
    ]);

    const membersData = unwrapPayload(membersPayload?.data) || {};
    const projectsData = unwrapPayload(projectsPayload?.data) || {};
    const overviewData = unwrapPayload(overviewPayload?.data) || {};
    const auditData = unwrapPayload(auditPayload?.data) || {};
    const alertsData = unwrapPayload(alertsPayload?.data) || {};
    currentMembersPayload = membersData;
    currentProjectsPayload = projectsData;
    currentOverviewPayload = overviewData;
    currentAuditPayload = auditData;
    currentAlertsPayload = alertsData;

    renderBanner(membersData, overviewData, alertsData);
    renderIncomingInvites(membersData);
    renderUsageBox(membersData, overviewData);
    renderKpis(membersData, overviewData);
    renderMembers(membersData);
    renderProjectPolicies(projectsData);
    renderPilotKit();
    renderHealth(overviewData);
    renderAudit(auditData);
    renderDispatch(alertsData, overviewData);
  }

  function bind() {
    const signOutBtn = $('signOutBtn');
    const refreshBtn = $('refreshBtn');
    const orgSelect = $('orgSelect');
    const copyControlReportBtn = $('copyControlReportBtn');
    const downloadControlReportBtn = $('downloadControlReportBtn');
    const downloadControlJsonBtn = $('downloadControlJsonBtn');
    const copyPilotChecklistBtn = $('copyPilotChecklistBtn');
    const downloadPilotChecklistBtn = $('downloadPilotChecklistBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);
    if (refreshBtn) refreshBtn.addEventListener('click', function() { load(); });
    if (copyControlReportBtn) copyControlReportBtn.addEventListener('click', function() { copyControlReport(); });
    if (downloadControlReportBtn) downloadControlReportBtn.addEventListener('click', function() { downloadControlReport(); });
    if (downloadControlJsonBtn) downloadControlJsonBtn.addEventListener('click', function() { downloadControlJson(); });
    if (copyPilotChecklistBtn) copyPilotChecklistBtn.addEventListener('click', function() { copyPilotChecklist(); });
    if (downloadPilotChecklistBtn) downloadPilotChecklistBtn.addEventListener('click', function() { downloadPilotChecklist(); });
    if (orgSelect) {
      orgSelect.addEventListener('change', function(event) {
        const nextOrgId = event.target.value || '';
        persistOrganizationSelection(nextOrgId);
        syncOrganizationUrl(currentOrganizationId);
        renderOrganizationSelector();
        load();
      });
    }
    document.addEventListener('click', async function(event) {
      const acceptBtn = event.target.closest('[data-invite-accept]');
      if (acceptBtn) {
        const invitationId = acceptBtn.getAttribute('data-invite-accept');
        setButtonState(acceptBtn, true, 'accepting...');
        const res = await apiFetch(INIT_API, `/members/invitations/${encodeURIComponent(invitationId)}/accept`, {
          method: 'POST',
          includeOrganization: false,
        });
        if (!res?.ok) {
          setButtonState(acceptBtn, false, 'accept invite');
          toast(res?.data?.error || 'Could not accept invite.', 'danger');
          return;
        }
        await load();
        toast('Invite accepted. Your team access is active now.', 'ok');
        return;
      }

      const savePolicyBtn = event.target.closest('[data-policy-save]');
      if (savePolicyBtn) {
        const projectId = savePolicyBtn.getAttribute('data-policy-save');
        if (projectId) await saveProjectPolicy(projectId, savePolicyBtn);
        return;
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
