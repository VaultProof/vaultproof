import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';

const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing. Sign in again to continue.';

export function renderEnterpriseDashboardPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Enterprise Dashboard - VaultProof</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07110f;
      --panel: rgba(237, 229, 204, 0.08);
      --panel-strong: rgba(237, 229, 204, 0.14);
      --line: rgba(237, 229, 204, 0.16);
      --text: #f4ecd5;
      --muted: #a9b7a6;
      --gold: #d7a84b;
      --green: #6ee7b7;
      --red: #fb7185;
      --blue: #93c5fd;
      --ink: #07110f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 10%, rgba(215, 168, 75, 0.24), transparent 32rem),
        radial-gradient(circle at 85% 0%, rgba(110, 231, 183, 0.16), transparent 28rem),
        linear-gradient(135deg, #06100e 0%, #10231d 45%, #050807 100%);
    }
    a { color: inherit; text-decoration: none; }
    .shell { display: grid; grid-template-columns: 280px 1fr; min-height: 100vh; }
    .sidebar {
      border-right: 1px solid var(--line);
      background: rgba(3, 8, 7, 0.66);
      backdrop-filter: blur(18px);
      padding: 28px 20px;
      position: sticky;
      top: 0;
      height: 100vh;
    }
    .brand { display: flex; align-items: center; gap: 12px; margin-bottom: 30px; }
    .mark {
      width: 38px; height: 38px; border-radius: 14px;
      display: grid; place-items: center;
      color: var(--ink); font-weight: 900;
      background: linear-gradient(135deg, var(--gold), #f3df95);
      box-shadow: 0 18px 60px rgba(215, 168, 75, 0.18);
    }
    .brand-title { font-weight: 850; letter-spacing: -0.03em; }
    .brand-sub { color: var(--muted); font-size: 12px; margin-top: 2px; }
    .nav-group { margin: 24px 0; }
    .nav-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; margin: 0 0 9px 10px; }
    .nav-link {
      display: flex; justify-content: space-between; align-items: center;
      padding: 11px 12px; border-radius: 14px; color: #d8dfcf;
      margin-bottom: 4px; border: 1px solid transparent;
    }
    .nav-link:hover, .nav-link.active { background: var(--panel); border-color: var(--line); }
    .nav-pill { font-size: 10px; color: var(--green); border: 1px solid rgba(110, 231, 183, 0.24); border-radius: 999px; padding: 2px 7px; }
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .topbar {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
      margin-bottom: 26px;
    }
    .eyebrow { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: 0.16em; font-weight: 800; }
    h1 { font-size: clamp(34px, 5vw, 66px); letter-spacing: -0.07em; line-height: 0.92; margin: 8px 0 12px; max-width: 760px; }
    .lead { color: var(--muted); max-width: 760px; font-size: 16px; line-height: 1.6; }
    .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    select, button {
      border: 1px solid var(--line);
      background: rgba(237, 229, 204, 0.08);
      color: var(--text);
      border-radius: 13px;
      padding: 11px 12px;
      font: inherit;
    }
    option { color: #111827; }
    button { cursor: pointer; }
    .primary {
      background: linear-gradient(135deg, var(--gold), #f3df95);
      color: var(--ink);
      border: 0;
      font-weight: 800;
    }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr); }
    .card {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, var(--panel-strong), rgba(237, 229, 204, 0.055));
      border-radius: 24px;
      padding: 20px;
      box-shadow: 0 22px 90px rgba(0, 0, 0, 0.2);
    }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -0.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); margin-top: 6px; font-size: 13px; }
    .status-pill {
      display: inline-flex; align-items: center; gap: 8px;
      border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 800;
      background: rgba(110, 231, 183, 0.1); color: var(--green); border: 1px solid rgba(110, 231, 183, 0.24);
    }
    .status-pill.warn { background: rgba(215, 168, 75, 0.1); color: var(--gold); border-color: rgba(215, 168, 75, 0.28); }
    .status-pill.bad { background: rgba(251, 113, 133, 0.12); color: var(--red); border-color: rgba(251, 113, 133, 0.28); }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -0.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row {
      display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center;
      border: 1px solid rgba(237, 229, 204, 0.1);
      border-radius: 17px; padding: 13px;
      background: rgba(3, 8, 7, 0.28);
    }
    .row-title { font-weight: 750; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(147, 197, 253, 0.24); border-radius: 999px; padding: 5px 8px; }
    .empty, .error {
      color: var(--muted);
      border: 1px dashed rgba(237, 229, 204, 0.22);
      border-radius: 18px;
      padding: 18px;
      background: rgba(3, 8, 7, 0.2);
    }
    .error { color: var(--red); border-color: rgba(251, 113, 133, 0.3); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .action { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; color: #e8ddbf; background: rgba(237, 229, 204, 0.07); }
    .action.primary { color: var(--ink); }
    @media (max-width: 980px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar { position: relative; height: auto; }
      .topbar { flex-direction: column; }
      .toolbar { justify-content: flex-start; }
      .kpis, .two { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">
        <div class="mark">VP</div>
        <div>
          <div class="brand-title">VaultProof Enterprise</div>
          <div class="brand-sub">Azure confidential dashboard</div>
        </div>
      </div>
      <div class="nav-group">
        <div class="nav-label">workspace</div>
        <a class="nav-link active" href="/app/dashboard"><span>Dashboard</span><span class="nav-pill">new</span></a>
        <a class="nav-link" href="/app/projects"><span>Projects</span></a>
        <a class="nav-link" href="/app/activity"><span>Activity</span></a>
        <a class="nav-link" href="/app/alerts"><span>Alerts</span></a>
        <a class="nav-link" href="/app/control"><span>Control</span></a>
        <a class="nav-link" href="/app/org"><span>Org + SSO</span></a>
      </div>
      <div class="nav-group">
        <div class="nav-label">evidence</div>
        <a class="nav-link" href="/app/members"><span>Members</span></a>
        <a class="nav-link" href="/app/audit"><span>Audit</span></a>
        <a class="nav-link" href="/app/keys"><span>Provider slots</span></a>
        <a class="nav-link" id="auditExportLink" href="/api/v1/enterprise/audit?format=csv&days=30"><span>Audit CSV</span></a>
        <a class="nav-link" id="accessReviewLink" href="/api/v1/enterprise/members/access-review?format=csv"><span>Access review CSV</span></a>
      </div>
      <div class="nav-group">
        <div class="nav-label">setup</div>
        <a class="nav-link" href="/app/settings"><span>Settings</span></a>
        <a class="nav-link" href="/app/plans"><span>Plans</span></a>
        <a class="nav-link" href="/app/scanner"><span>Scanner</span></a>
      </div>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="eyebrow">enterprise command center</div>
          <h1>Enterprise dashboard.</h1>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="action primary" href="/app/control">open control</a>
        </div>
      </div>

      <div id="authNotice" class="error" style="display:none"></div>

      <section class="grid kpis" aria-label="Enterprise KPIs">
        <div class="card"><div class="kpi-label">production runtime</div><div id="kpiRuntime" class="kpi-value">...</div><div id="kpiRuntimeSub" class="kpi-sub">checking Front Door to CVM</div></div>
        <div class="card"><div class="kpi-label">projects</div><div id="kpiProjects" class="kpi-value">...</div><div id="kpiProjectsSub" class="kpi-sub">enterprise scopes</div></div>
        <div class="card"><div class="kpi-label">members</div><div id="kpiMembers" class="kpi-value">...</div><div id="kpiMembersSub" class="kpi-sub">active org access</div></div>
        <div class="card"><div class="kpi-label">30d calls</div><div id="kpiCalls" class="kpi-value">...</div><div id="kpiCallsSub" class="kpi-sub">proxy activity</div></div>
      </section>

      <section class="grid two">
        <div class="card">
          <div class="section-title">
            <h2>Confidential runtime posture</h2>
            <span id="runtimePill" class="status-pill warn">checking</span>
          </div>
          <div id="runtimeDetail" class="mini">Waiting for readiness...</div>
          <div class="actions">
            <a class="action" href="/readiness" target="_blank" rel="noopener">open readiness JSON</a>
            <a class="action" href="/health" target="_blank" rel="noopener">open health JSON</a>
          </div>
        </div>

        <div class="card">
          <div class="section-title">
            <h2>Organization</h2>
            <span id="orgRole" class="tag">...</span>
          </div>
          <div id="orgDetail" class="mini">Loading organization...</div>
          <div class="actions">
            <a class="action" href="/app/org">manage SSO</a>
            <a class="action" href="/app/control">policy control</a>
          </div>
        </div>
      </section>

      <section class="grid two" style="margin-top:16px">
        <div class="card">
          <div class="section-title"><h2>Project health</h2><span id="projectHealthMeta" class="mini"></span></div>
          <div id="projectHealthList" class="list"><div class="empty">Loading projects...</div></div>
        </div>

        <div class="card">
          <div class="section-title"><h2>Access and alerts</h2><span id="accessMeta" class="mini"></span></div>
          <div id="accessList" class="list"><div class="empty">Loading access...</div></div>
        </div>
      </section>

      <section class="grid two" style="margin-top:16px">
        <div class="card">
          <div class="section-title"><h2>Recent audit</h2><a class="mini" href="/api/v1/enterprise/audit?format=csv&days=30">export CSV</a></div>
          <div id="auditList" class="list"><div class="empty">Loading audit...</div></div>
        </div>

        <div class="card">
          <div class="section-title"><h2>Recent runtime activity</h2><span id="activityMeta" class="mini"></span></div>
          <div id="activityList" class="list"><div class="empty">Loading activity...</div></div>
        </div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) {
        var n = Number(value || 0);
        return Number.isFinite(n) ? n.toLocaleString() : '0';
      }
      function relativeTime(value) {
        if (!value) return 'never';
        var ts = new Date(value).getTime();
        if (!Number.isFinite(ts)) return String(value);
        var diff = Date.now() - ts;
        var minutes = Math.round(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return minutes + 'm ago';
        var hours = Math.round(minutes / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function authHeaders() {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (currentOrgId) headers['x-vaultproof-organization'] = currentOrgId;
        return headers;
      }
      async function fetchJson(path, options) {
        var res = await fetch(path, Object.assign({}, options || {}, { headers: Object.assign(authHeaders(), (options && options.headers) || {}) }));
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function setNotice(message) {
        var el = byId('authNotice');
        if (!el) return;
        if (!message) {
          el.style.display = 'none';
          el.textContent = '';
          return;
        }
        message = friendlyErrorMessage(message);
        el.style.display = 'block';
        el.innerHTML = escapeHtml(message) + ' <a href="/app/login">Sign in</a>';
      }
      function renderReadiness(payload) {
        var ready = payload && payload.production_ready === true;
        text('kpiRuntime', ready ? 'ready' : 'watch');
        text('kpiRuntimeSub', ready ? 'Azure confidential production' : 'needs review');
        var pill = byId('runtimePill');
        if (pill) {
          pill.textContent = ready ? 'production ready' : 'not production ready';
          pill.className = 'status-pill ' + (ready ? '' : 'bad');
        }
        var blockers = Array.isArray(payload && payload.production_blockers) ? payload.production_blockers : [];
        text('runtimeDetail', ready
          ? 'Front Door, control plane, executor, attestation, replay protection, and Secure Key Release all report production-ready.'
          : (blockers.length ? blockers.join(' | ') : 'Readiness is incomplete.'));
      }
      function renderOrgSelector(orgs, activeId) {
        var select = byId('orgSelect');
        if (!select) return;
        if (!orgs.length) {
          select.innerHTML = '<option value="">No enterprise org</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var requested = orgs.find(function(org) { return org.id === currentOrgId; });
        var active = orgs.find(function(org) { return org.id === activeId; });
        var team = orgs.find(function(org) { return org.kind && org.kind !== 'personal'; });
        var selected = requested || active || team || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderOrganization(payload) {
        var org = payload && payload.organization ? payload.organization : null;
        if (!org) {
          text('orgRole', 'none');
          text('orgDetail', 'No active enterprise organization found.');
          return;
        }
        text('orgRole', org.role || 'member');
        text('orgDetail', (org.name || 'Organization') + ' - ' + number(org.member_count) + ' members - ' + number(org.project_count) + ' projects');
        text('kpiMembersSub', (payload.sso_status && payload.sso_status.provider_status === 'configured') ? 'SSO configured' : 'SSO not fully configured');
      }
      function renderOverview(overview) {
        overview = overview || {};
        text('kpiProjects', number(overview.totalProjects));
        text('kpiProjectsSub', number(overview.totalKeys) + ' active key slots');
        text('kpiCalls', number(overview.totalCalls));
        text('kpiCallsSub', number(overview.deniedCalls) + ' denied / ' + number(overview.errorCalls) + ' errors');
        var review = overview.pilotReview || {};
        text('projectHealthMeta', review.headline || '');
        text('activityMeta', number((overview.recentActivity || []).length) + ' recent events');
        var projects = Array.isArray(overview.projectHealth) ? overview.projectHealth : [];
        var projectList = byId('projectHealthList');
        if (projectList) {
          projectList.innerHTML = projects.length ? projects.slice(0, 6).map(function(project) {
            var status = project.denied || project.errors ? 'watch' : project.calls ? 'healthy' : 'setup';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id || project.project_id) + '</div><div class="row-sub">' + number(project.calls) + ' calls - ' + number(project.errors) + ' errors - last ' + escapeHtml(relativeTime(project.lastActivity)) + '</div></div><span class="tag">' + status + '</span></div>';
          }).join('') : '<div class="empty">No project health data yet.</div>';
        }
        var activityList = byId('activityList');
        var activity = Array.isArray(overview.recentActivity) ? overview.recentActivity : [];
        if (activityList) {
          activityList.innerHTML = activity.length ? activity.slice(0, 6).map(function(item) {
            var meta = item.metadata || {};
            var slot = item.keySlot || {};
            return '<div class="row"><div><div class="row-title">' + escapeHtml(item.description || item.action || 'runtime event') + '</div><div class="row-sub">' + escapeHtml(slot.provider || 'provider') + ' - ' + escapeHtml(relativeTime(item.timestamp)) + '</div></div><span class="tag">' + escapeHtml(meta.status_code || 'ok') + '</span></div>';
          }).join('') : '<div class="empty">No runtime traffic yet.</div>';
        }
      }
      function renderMembers(payload) {
        var members = Array.isArray(payload && payload.members) ? payload.members : [];
        var invites = Array.isArray(payload && payload.invitations) ? payload.invitations.filter(function(invite) { return invite.status === 'pending'; }) : [];
        text('kpiMembers', number(members.length));
        text('accessMeta', number(invites.length) + ' pending invites');
        var accessList = byId('accessList');
        if (!accessList) return;
        var admins = members.filter(function(member) { return member.role === 'owner' || member.role === 'admin'; }).length;
        accessList.innerHTML =
          '<div class="row"><div><div class="row-title">Admins and owners</div><div class="row-sub">People who can manage access and policy.</div></div><span class="tag">' + number(admins) + '</span></div>' +
          '<div class="row"><div><div class="row-title">Pending invites</div><div class="row-sub">Invitations still waiting for acceptance.</div></div><span class="tag">' + number(invites.length) + '</span></div>';
      }
      function renderAudit(payload) {
        var events = Array.isArray(payload && payload.events) ? payload.events : [];
        var list = byId('auditList');
        if (!list) return;
        list.innerHTML = events.length ? events.slice(0, 6).map(function(event) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(event.event_type || event.source || 'audit event') + '</div><div class="row-sub">' + escapeHtml(event.actor_email || 'system') + ' - ' + escapeHtml(relativeTime(event.created_at || event.timestamp)) + '</div></div><span class="tag">' + escapeHtml(event.source || 'audit') + '</span></div>';
        }).join('') : '<div class="empty">No audit events in this window.</div>';
      }
      async function loadDashboard() {
        if (!token) {
          setNotice('Enterprise session missing.');
          return;
        }
        setNotice('');
        try {
          var readinessPromise = fetchJson('/readiness');
          var orgsPayload = await fetchJson('/api/v1/enterprise/orgs');
          var orgs = Array.isArray(orgsPayload.organizations) ? orgsPayload.organizations : [];
          renderOrgSelector(orgs, orgsPayload.active_organization_id || '');
          var results = await Promise.allSettled([
            readinessPromise,
            fetchJson('/api/v1/enterprise/orgs/current'),
            fetchJson('/api/v1/enterprise/projects/stats/overview'),
            fetchJson('/api/v1/enterprise/members'),
            fetchJson('/api/v1/enterprise/audit?limit=6&days=30')
          ]);
          if (results[0].status === 'fulfilled') renderReadiness(results[0].value);
          if (results[1].status === 'fulfilled') renderOrganization(results[1].value);
          if (results[2].status === 'fulfilled') renderOverview(results[2].value);
          if (results[3].status === 'fulfilled') renderMembers(results[3].value);
          if (results[4].status === 'fulfilled') renderAudit(results[4].value);
          if (results.some(function(result) { return result.status === 'rejected'; })) {
            var failed = results.filter(function(result) { return result.status === 'rejected'; }).map(function(result) { return result.reason && result.reason.message; }).filter(Boolean);
            setNotice('Some dashboard panels could not load: ' + failed.join(' | '));
          }
        } catch (error) {
          setNotice(error && error.message ? error.message : 'Dashboard failed to load.');
        }
      }
      var refreshBtn = byId('refreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', loadDashboard);
      var orgSelect = byId('orgSelect');
      if (orgSelect) orgSelect.addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        loadDashboard();
      });
      loadDashboard();
    })();
  </script>
</body>
</html>`, env, 'dashboard');
}
