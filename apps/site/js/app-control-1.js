(function() {
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const INIT_API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
    : 'https://init.vaultproof.dev/api/v1/init';
  const SUPABASE_AUTH_STORAGE_KEY = 'sb-gwzkjiomemjlhtrdrlan-auth-token';

  let token = localStorage.getItem('vaultproof_token');
  const user = JSON.parse(localStorage.getItem('vaultproof_user') || '{}');
  let refreshAttempted = false;
  let refreshPromise = null;

  if (!token) {
    window.location.href = 'login';
    return;
  }

  function $(id) { return document.getElementById(id); }

  function setText(id, value) {
    const el = $(id);
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
        copy: 'This control surface appears after an organization is available. Solo users can stay in Projects, while SSO users can land here later.',
        note: 'No org resolved from the current session.',
      };
    }

    if (org.kind === 'personal') {
      return {
        label: 'solo dev workspace',
        title: `${org.name} is still in solo mode`,
        copy: 'You can keep using the regular Projects dashboard, but this control surface is ready for the moment you add a team org, invite members, or route business traffic through shared policy and audit flows.',
        note: 'SSO can route team/business users here later without replacing the solo dashboard.',
      };
    }

    const hasBusinessSignals = members.length >= 8 || activeAlerts.length >= 3 || (alertsPayload?.destinations || []).length > 0 || projects.length >= 4;
    if (hasBusinessSignals) {
      return {
        label: 'business workspace',
        title: `${org.name} is operating in business mode`,
        copy: 'This dashboard keeps member access, delivery policy, audit review, and runtime posture together so admins can operate the account like a real control plane instead of a personal key vault.',
        note: 'Best future SSO destination for owners, admins, and security reviewers.',
      };
    }

    return {
      label: 'team workspace',
      title: `${org.name} is operating in team mode`,
      copy: 'This route separates shared team controls from the solo project surface. It is meant for invites, audit review, policy oversight, and the next step toward business-grade rollout.',
      note: 'A clean home for team SSO once you enable it.',
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

  async function load() {
    setText('user-email', user.email || 'loading...');
    const avatar = $('user-avatar');
    if (avatar) avatar.textContent = (user.email || 'VP').charAt(0).toUpperCase();

    const [membersPayload, overviewPayload, auditPayload, alertsPayload] = await Promise.all([
      apiFetch(INIT_API, '/members'),
      apiFetch(INIT_API, '/projects/stats/overview'),
      apiFetch(INIT_API, '/audit?days=7&limit=8'),
      apiFetch(INIT_API, '/alerts?activity_window=7d&delivery_limit=5&run_limit=5'),
    ]);

    const membersData = unwrapPayload(membersPayload) || {};
    const overviewData = unwrapPayload(overviewPayload) || {};
    const auditData = unwrapPayload(auditPayload) || {};
    const alertsData = unwrapPayload(alertsPayload) || {};

    renderBanner(membersData, overviewData, alertsData);
    renderUsageBox(membersData, overviewData);
    renderKpis(membersData, overviewData);
    renderMembers(membersData);
    renderHealth(overviewData);
    renderAudit(auditData);
    renderDispatch(alertsData, overviewData);
  }

  function bind() {
    const signOutBtn = $('signOutBtn');
    const refreshBtn = $('refreshBtn');
    if (signOutBtn) signOutBtn.addEventListener('click', logout);
    if (refreshBtn) refreshBtn.addEventListener('click', function() { load(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { bind(); load(); });
  } else {
    bind();
    load();
  }
})();
