import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';

const PUBLIC_SITE_ORIGIN = 'https://vaultproof.dev';
const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing. Sign in again to continue.';

function rewriteStaticAssetUrls(html: string): string {
  return html
    .replaceAll('src="/js/', `src="${PUBLIC_SITE_ORIGIN}/js/`)
    .replaceAll('href="/css/', `href="${PUBLIC_SITE_ORIGIN}/css/`)
    .replaceAll('href="/favicon.png"', `href="${PUBLIC_SITE_ORIGIN}/favicon.png"`)
    .replaceAll('href="/terms"', `href="${PUBLIC_SITE_ORIGIN}/terms"`)
    .replaceAll('href="/privacy"', `href="${PUBLIC_SITE_ORIGIN}/privacy"`);
}

function readWorkspaceFile(relativePath: string): string {
  const candidates = [
    join(process.cwd(), relativePath),
    join(process.cwd(), '..', '..', relativePath),
  ];
  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      return readFileSync(candidate, 'utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function readEnterpriseAppPage(filename: string): string {
  const html = readWorkspaceFile(join('apps/site/app', filename));
  return rewriteStaticAssetUrls(html);
}

const plannedEnterprisePages: Record<string, {
  title: string;
  kicker: string;
  summary: string;
  features: string[];
  primaryHref: string;
  primaryLabel: string;
}> = {
  members: {
    title: 'Members',
    kicker: 'access review',
    summary: 'Enterprise member management will bring org members, pending invites, project assignments, and SOC 2 access-review evidence into one Azure-hosted page.',
    features: ['Active members and roles', 'Pending invites and invite acceptance', 'Project assignment coverage', 'CSV/JSON access-review evidence'],
    primaryHref: '/api/v1/enterprise/members/access-review?format=csv',
    primaryLabel: 'export access review',
  },
  audit: {
    title: 'Audit',
    kicker: 'governance timeline',
    summary: 'Enterprise audit will show governance events and runtime proxy activity with exportable filters for customer security reviews.',
    features: ['Governance and runtime timeline', 'CSV export', 'Search and event-type filters', 'Attestation and executor metadata details'],
    primaryHref: '/api/v1/enterprise/audit?format=csv&days=30',
    primaryLabel: 'export audit CSV',
  },
  alerts: {
    title: 'Alerts',
    kicker: 'ops notifications',
    summary: 'Enterprise alerts will manage destinations, dispatch policy, delivery logs, and readiness drift notifications.',
    features: ['Email and webhook destinations', 'Dispatch policy status', 'Delivery logs', 'Policy run history'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
  activity: {
    title: 'Activity',
    kicker: 'runtime feed',
    summary: 'Enterprise activity will focus on recent executor/proxy events, status codes, latency, provider request IDs, and attestation evidence summaries.',
    features: ['Runtime request feed', 'Latency and status-code view', 'Provider request IDs', 'Attestation summary links'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
  projects: {
    title: 'Projects',
    kicker: 'inventory',
    summary: 'Enterprise projects will show project health, provider slots, origin policy, caller-lock coverage, and quick links into Control.',
    features: ['Project inventory', 'Provider slot status', 'Policy coverage', 'Control page shortcuts'],
    primaryHref: '/app/control',
    primaryLabel: 'open control',
  },
  keys: {
    title: 'Provider slots',
    kicker: 'secrets posture',
    summary: 'Enterprise provider slots will show active/revoked upstream providers, emergency revoke status, and rotation checklists without exposing raw provider secrets.',
    features: ['Active and revoked slots', 'Emergency revoke workflow', 'Rotation checklist', 'Secure Key Release posture notes'],
    primaryHref: '/app/control',
    primaryLabel: 'manage provider policy',
  },
  settings: {
    title: 'Settings',
    kicker: 'tenant defaults',
    summary: 'Enterprise settings will collect tenant-level preferences and security notices that do not belong in SSO setup.',
    features: ['Session/security notices', 'Dashboard preferences', 'Tenant defaults', 'Operational contact hints'],
    primaryHref: '/app/org',
    primaryLabel: 'open org settings',
  },
  plans: {
    title: 'Plans',
    kicker: 'enterprise packaging',
    summary: 'Enterprise plans will track rollout status, APIM/monitoring packaging, limits, and contract-facing governance notes.',
    features: ['APIM rollout status', 'Monitoring package status', 'Enterprise limits', 'Contract-facing plan notes'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
  scanner: {
    title: 'Scanner',
    kicker: 'repository security',
    summary: 'Enterprise scanner will become a separate repository/security scanning entry point once the scanner APIs are enterprise-safe.',
    features: ['Repository scan entry', 'Secret remediation workflow', 'Enterprise-safe scanner API integration', 'Provider rotation follow-up'],
    primaryHref: '/app/dashboard',
    primaryLabel: 'back to dashboard',
  },
};

function renderEnterpriseMembersPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Members - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.09); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --green: #6ee7b7; --red: #fb7185; --blue: #93c5fd; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 16% 8%, rgba(215,168,75,.24), transparent 30rem), linear-gradient(135deg, #06100e, #10231d 48%, #050807); }
    a { color: inherit; text-decoration: none; }
    .shell { display: grid; grid-template-columns: 270px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(3,8,7,.66); padding: 28px 20px; }
    .brand { font-weight: 850; letter-spacing: -.03em; margin-bottom: 28px; }
    .brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; font-weight: 500; }
    .nav-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; margin: 22px 0 9px 10px; }
    .nav-link { display: flex; justify-content: space-between; padding: 11px 12px; border-radius: 14px; margin-bottom: 4px; border: 1px solid transparent; color: #d8dfcf; }
    .nav-link:hover, .nav-link.active { background: var(--panel); border-color: var(--line); }
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 720px; }
    select, button, input { border: 1px solid var(--line); background: rgba(237,229,204,.08); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(244,236,213,.48); }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .danger { color: var(--red); border-color: rgba(251,113,133,.34); }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .form-row { display: grid; grid-template-columns: minmax(220px, 1fr) 150px auto; gap: 10px; align-items: center; }
    .inline-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
    .inline-actions select, .inline-actions button { padding: 8px 9px; font-size: 13px; border-radius: 11px; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(340px, .72fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(0,0,0,.2); }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; border: 1px solid rgba(237,229,204,.1); border-radius: 17px; padding: 13px; background: rgba(3,8,7,.28); }
    .row-title { font-weight: 760; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(147,197,253,.24); border-radius: 999px; padding: 5px 8px; }
    .tag.good { color: var(--green); border-color: rgba(110,231,183,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(215,168,75,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(237,229,204,.22); border-radius: 18px; padding: 18px; background: rgba(3,8,7,.2); }
    .notice.error { color: var(--red); border-color: rgba(251,113,133,.3); }
    @media (max-width: 980px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .kpis, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">VaultProof Enterprise<span>members + access</span></div>
      <div class="nav-label">workspace</div>
      <a class="nav-link" href="/app/dashboard">Dashboard</a>
      <a class="nav-link" href="/app/projects">Projects</a>
      <a class="nav-link" href="/app/control">Control</a>
      <a class="nav-link" href="/app/org">Org + SSO</a>
      <div class="nav-label">evidence</div>
      <a class="nav-link active" href="/app/members">Members</a>
      <a class="nav-link" href="/app/audit">Audit</a>
      <a class="nav-link" href="/app/alerts">Alerts</a>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">access review</div>
          <h1>Members</h1>
          <p class="lead">Review who has enterprise access, which projects they can touch, and whether any pending invites block rollout.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" id="accessReviewCsv" href="/api/v1/enterprise/members/access-review?format=csv">export CSV</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="card" id="adminPanel" style="display:none; margin-bottom:16px">
        <div class="section-title"><h2>Admin actions</h2><span class="mini">invite, role, project access</span></div>
        <form id="inviteForm" class="form-row">
          <input id="inviteEmail" type="email" autocomplete="email" placeholder="teammate@company.com" required />
          <select id="inviteRole" aria-label="Invite role">
            <option value="viewer">viewer</option>
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
          <button class="primary" type="submit">send invite</button>
        </form>
      </section>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">members</div><div class="kpi-value" id="kpiMembers">...</div><div class="kpi-sub" id="kpiMembersSub">loading</div></div>
        <div class="card"><div class="kpi-label">admins</div><div class="kpi-value" id="kpiAdmins">...</div><div class="kpi-sub">owners and admins</div></div>
        <div class="card"><div class="kpi-label">pending invites</div><div class="kpi-value" id="kpiInvites">...</div><div class="kpi-sub">waiting for acceptance</div></div>
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">access scopes</div></div>
      </section>

      <section class="grid two">
        <div class="card">
          <div class="section-title"><h2>Active members</h2><span id="membersMeta" class="mini"></span></div>
          <div id="membersList" class="list"><div class="empty">Loading members...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Pending invites</h2><span id="invitesMeta" class="mini"></span></div>
          <div id="invitesList" class="list"><div class="empty">Loading invites...</div></div>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="section-title"><h2>Project coverage</h2><span id="coverageMeta" class="mini"></span></div>
        <div id="coverageList" class="list"><div class="empty">Loading project coverage...</div></div>
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
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      async function apiJson(path, options) {
        var opts = options || {};
        opts.headers = Object.assign(headers(), opts.headers || {});
        var res = await fetch(path, opts);
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!select) return;
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderMembers(payload) {
        var members = Array.isArray(payload.members) ? payload.members : [];
        var invites = Array.isArray(payload.invitations) ? payload.invitations.filter(function(invite) { return invite.status === 'pending'; }) : [];
        var incomingInvites = Array.isArray(payload.pending_invitations_for_me) ? payload.pending_invitations_for_me : [];
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        var admins = members.filter(function(member) { return member.role === 'owner' || member.role === 'admin'; });
        var canManage = !!(payload.organization && payload.organization.can_manage_members);
        var adminPanel = byId('adminPanel');
        if (adminPanel) adminPanel.style.display = canManage ? 'block' : 'none';
        text('kpiMembers', number(members.length));
        text('kpiMembersSub', payload.organization ? payload.organization.name : 'active org');
        text('kpiAdmins', number(admins.length));
        text('kpiInvites', number(invites.length + incomingInvites.length));
        text('kpiProjects', number(projects.length));
        text('membersMeta', payload.organization && payload.organization.can_manage_members ? 'admin view' : 'read-only view');
        text('invitesMeta', (invites.length + incomingInvites.length) ? 'follow up' : 'clear');
        text('coverageMeta', projects.length + ' project scopes');
        var membersList = byId('membersList');
        if (membersList) {
          membersList.innerHTML = members.length ? members.map(function(member) {
            var access = Array.isArray(member.project_access) ? member.project_access : [];
            var roleControl = canManage ? '<div class="inline-actions"><select data-action="member-role" data-user-id="' + escapeHtml(member.user_id) + '">' + ['viewer','member','admin','owner'].map(function(role) {
              return '<option value="' + role + '"' + (member.role === role ? ' selected' : '') + '>' + role + '</option>';
            }).join('') + '</select><select data-action="project-pick" data-user-id="' + escapeHtml(member.user_id) + '"><option value="">assign project...</option>' + projects.map(function(project) {
              return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
            }).join('') + '</select><select data-action="project-role" data-user-id="' + escapeHtml(member.user_id) + '"><option value="viewer">viewer</option><option value="member">member</option><option value="admin">admin</option></select><button type="button" data-action="assign-project" data-user-id="' + escapeHtml(member.user_id) + '">assign</button></div>' : '<span class="tag good">' + escapeHtml(member.role) + '</span>';
            var projectBadges = access.length ? '<div class="row-sub">' + access.map(function(item) {
              var remove = canManage ? ' <button type="button" class="danger" data-action="remove-project" data-user-id="' + escapeHtml(member.user_id) + '" data-project-id="' + escapeHtml(item.project_id) + '">remove</button>' : '';
              return '<span class="tag">' + escapeHtml(item.project_name || item.vp_proj_id) + ' / ' + escapeHtml(item.role) + '</span>' + remove;
            }).join(' ') + '</div>' : '';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(member.email || member.user_id) + '</div><div class="row-sub">' + escapeHtml(member.role) + ' - ' + access.length + ' project scopes - joined ' + escapeHtml(rel(member.created_at)) + '</div>' + projectBadges + '</div>' + roleControl + '</div>';
          }).join('') : '<div class="empty">No members found.</div>';
        }
        var invitesList = byId('invitesList');
        if (invitesList) {
          var outgoingInviteRows = invites.map(function(invite) {
            var action = canManage ? '<button type="button" class="danger" data-action="revoke-invite" data-invite-id="' + escapeHtml(invite.id) + '">revoke</button>' : '<span class="tag warn">pending</span>';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(invite.email) + '</div><div class="row-sub">' + escapeHtml(invite.role) + ' - invited ' + escapeHtml(rel(invite.created_at)) + '</div></div>' + action + '</div>';
          });
          var incomingInviteRows = incomingInvites.map(function(invite) {
            var org = invite.organization || {};
            return '<div class="row"><div><div class="row-title">' + escapeHtml(org.name || 'Organization invite') + '</div><div class="row-sub">for ' + escapeHtml(invite.email) + ' as ' + escapeHtml(invite.role) + ' - invited ' + escapeHtml(rel(invite.created_at)) + '</div></div><button type="button" class="primary" data-action="accept-invite" data-invite-id="' + escapeHtml(invite.id) + '">accept</button></div>';
          });
          invitesList.innerHTML = outgoingInviteRows.concat(incomingInviteRows).length ? outgoingInviteRows.concat(incomingInviteRows).join('') : '<div class="empty">No pending invites.</div>';
        }
        var coverage = projects.map(function(project) {
          var assigned = members.filter(function(member) {
            return (member.project_access || []).some(function(access) { return access.project_id === project.id; });
          }).length;
          return { project: project, assigned: assigned };
        });
        var coverageList = byId('coverageList');
        if (coverageList) {
          coverageList.innerHTML = coverage.length ? coverage.map(function(item) {
            return '<div class="row"><div><div class="row-title">' + escapeHtml(item.project.name || item.project.vp_proj_id) + '</div><div class="row-sub">' + escapeHtml(item.project.vp_proj_id) + ' - created ' + escapeHtml(rel(item.project.created_at)) + '</div></div><span class="tag">' + number(item.assigned) + ' assigned</span></div>';
          }).join('') : '<div class="empty">No projects in this organization yet.</div>';
        }
      }
      async function load() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          var orgs = await fetchJson('/api/v1/enterprise/orgs');
          renderOrgSelector(orgs);
          var exportHref = '/api/v1/enterprise/members/access-review?format=csv';
          if (currentOrgId) exportHref += '&org=' + encodeURIComponent(currentOrgId);
          var exportLink = byId('accessReviewCsv');
          if (exportLink) exportLink.href = exportHref;
          renderMembers(await fetchJson('/api/v1/enterprise/members'));
        } catch (error) {
          notice(error && error.message ? error.message : 'Members failed to load.');
        }
      }
      var select = byId('orgSelect');
      if (select) select.addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        load();
      });
      var refresh = byId('refreshBtn');
      if (refresh) refresh.addEventListener('click', load);
      var inviteForm = byId('inviteForm');
      if (inviteForm) inviteForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        try {
          await apiJson('/api/v1/enterprise/members/invitations', {
            method: 'POST',
            body: JSON.stringify({
              email: byId('inviteEmail').value,
              role: byId('inviteRole').value
            })
          });
          byId('inviteEmail').value = '';
          await load();
        } catch (error) {
          notice(error && error.message ? error.message : 'Invite failed.');
        }
      });
      document.addEventListener('change', async function(event) {
        var target = event.target;
        if (!target || target.getAttribute('data-action') !== 'member-role') return;
        try {
          await apiJson('/api/v1/enterprise/members/' + encodeURIComponent(target.getAttribute('data-user-id')) + '/role', {
            method: 'POST',
            body: JSON.stringify({ role: target.value })
          });
          await load();
        } catch (error) {
          notice(error && error.message ? error.message : 'Role update failed.');
          await load();
        }
      });
      document.addEventListener('click', async function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        var action = target.getAttribute('data-action');
        try {
          if (action === 'revoke-invite') {
            await apiJson('/api/v1/enterprise/members/invitations/' + encodeURIComponent(target.getAttribute('data-invite-id')) + '/revoke', { method: 'POST' });
            await load();
          }
          if (action === 'accept-invite') {
            await apiJson('/api/v1/enterprise/members/invitations/' + encodeURIComponent(target.getAttribute('data-invite-id')) + '/accept', { method: 'POST' });
            await load();
          }
          if (action === 'assign-project') {
            var userId = target.getAttribute('data-user-id');
            var projectSelect = document.querySelector('select[data-action="project-pick"][data-user-id="' + CSS.escape(userId) + '"]');
            var roleSelect = document.querySelector('select[data-action="project-role"][data-user-id="' + CSS.escape(userId) + '"]');
            if (!projectSelect || !projectSelect.value) throw new Error('Choose a project first.');
            await apiJson('/api/v1/enterprise/members/' + encodeURIComponent(userId) + '/projects/' + encodeURIComponent(projectSelect.value) + '/access', {
              method: 'POST',
              body: JSON.stringify({ role: roleSelect ? roleSelect.value : 'viewer' })
            });
            await load();
          }
          if (action === 'remove-project') {
            await apiJson('/api/v1/enterprise/members/' + encodeURIComponent(target.getAttribute('data-user-id')) + '/projects/' + encodeURIComponent(target.getAttribute('data-project-id')) + '/access', { method: 'DELETE' });
            await load();
          }
        } catch (error) {
          notice(error && error.message ? error.message : 'Member action failed.');
        }
      });
      load();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseAuditPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Audit - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.09); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --green: #6ee7b7; --red: #fb7185; --blue: #93c5fd; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 12% 8%, rgba(147,197,253,.18), transparent 28rem), radial-gradient(circle at 82% 12%, rgba(215,168,75,.2), transparent 26rem), linear-gradient(135deg, #06100e, #10231d 50%, #050807); }
    a { color: inherit; text-decoration: none; }
    select, button, input { border: 1px solid var(--line); background: rgba(237,229,204,.08); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(244,236,213,.48); }
    .shell { display: grid; grid-template-columns: 270px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(3,8,7,.66); padding: 28px 20px; }
    .brand { font-weight: 850; letter-spacing: -.03em; margin-bottom: 28px; }
    .brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; font-weight: 500; }
    .nav-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; margin: 22px 0 9px 10px; }
    .nav-link { display: flex; justify-content: space-between; padding: 11px 12px; border-radius: 14px; margin-bottom: 4px; border: 1px solid transparent; color: #d8dfcf; }
    .nav-link:hover, .nav-link.active { background: var(--panel); border-color: var(--line); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 760px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(0,0,0,.2); }
    .filters { display: grid; grid-template-columns: 1.1fr .85fr .9fr .9fr 1.3fr auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .event { display: grid; grid-template-columns: 160px 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(237,229,204,.1); border-radius: 18px; padding: 14px; background: rgba(3,8,7,.28); }
    .event-time { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .event-title { font-weight: 780; letter-spacing: -.02em; }
    .event-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(147,197,253,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(110,231,183,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(215,168,75,.28); }
    .tag.bad { color: var(--red); border-color: rgba(251,113,133,.28); }
    details { margin-top: 8px; color: var(--muted); font-size: 13px; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid rgba(237,229,204,.12); border-radius: 14px; padding: 12px; background: rgba(0,0,0,.24); color: #d8dfcf; overflow: auto; }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(237,229,204,.22); border-radius: 18px; padding: 18px; background: rgba(3,8,7,.2); }
    .notice.error { color: var(--red); border-color: rgba(251,113,133,.3); }
    @media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .event { grid-template-columns: 1fr; } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">VaultProof Enterprise<span>audit evidence</span></div>
      <div class="nav-label">workspace</div>
      <a class="nav-link" href="/app/dashboard">Dashboard</a>
      <a class="nav-link" href="/app/projects">Projects</a>
      <a class="nav-link" href="/app/control">Control</a>
      <a class="nav-link" href="/app/org">Org + SSO</a>
      <div class="nav-label">evidence</div>
      <a class="nav-link" href="/app/members">Members</a>
      <a class="nav-link active" href="/app/audit">Audit</a>
      <a class="nav-link" href="/app/alerts">Alerts</a>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">governance timeline</div>
          <h1>Audit</h1>
          <p class="lead">Search governance changes and secure runtime proxy events from the enterprise control plane, then export the exact filtered view for evidence reviews.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" id="csvLink" href="/api/v1/enterprise/audit?format=csv&days=30">export CSV</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="card">
        <form id="filterForm" class="filters">
          <select id="projectFilter" aria-label="Project"><option value="">All projects</option></select>
          <select id="sourceFilter" aria-label="Source">
            <option value="all">all sources</option>
            <option value="governance">governance</option>
            <option value="proxy">proxy/runtime</option>
          </select>
          <select id="eventTypeFilter" aria-label="Event type">
            <option value="">all event types</option>
            <option value="proxy_request">proxy_request</option>
            <option value="proxy_error">proxy_error</option>
            <option value="enterprise_provider_key_revoked">provider revoked</option>
            <option value="organization_invitation_created">invite created</option>
            <option value="organization_member_role_updated">role updated</option>
            <option value="project_policy_updated">project policy updated</option>
          </select>
          <select id="daysFilter" aria-label="Days">
            <option value="7">last 7 days</option>
            <option value="30" selected>last 30 days</option>
            <option value="90">last 90 days</option>
          </select>
          <input id="searchFilter" type="search" placeholder="Search actor, path, provider..." />
          <button class="primary" type="submit">apply</button>
        </form>
      </section>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">total events</div><div class="kpi-value" id="kpiTotal">...</div><div class="kpi-sub" id="kpiWindow">loading</div></div>
        <div class="card"><div class="kpi-label">governance</div><div class="kpi-value" id="kpiGovernance">...</div><div class="kpi-sub">org + policy changes</div></div>
        <div class="card"><div class="kpi-label">proxy/runtime</div><div class="kpi-value" id="kpiProxy">...</div><div class="kpi-sub">secure execution requests</div></div>
        <div class="card"><div class="kpi-label">next page</div><div class="kpi-value" id="kpiMore">...</div><div class="kpi-sub">cursor availability</div></div>
      </section>

      <section class="card">
        <div class="section-title"><h2>Timeline</h2><span id="timelineMeta" class="mini"></span></div>
        <div id="eventList" class="list"><div class="empty">Loading audit events...</div></div>
        <div style="margin-top:14px"><button id="loadMoreBtn" type="button" style="display:none">load older events</button></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var nextBefore = '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function buildAuditPath(before) {
        var params = new URLSearchParams();
        params.set('days', byId('daysFilter').value || '30');
        params.set('limit', '100');
        var source = byId('sourceFilter').value || 'all';
        if (source !== 'all') params.set('source', source);
        if (byId('projectFilter').value) params.set('project_id', byId('projectFilter').value);
        if (byId('eventTypeFilter').value) params.set('event_type', byId('eventTypeFilter').value);
        if (byId('searchFilter').value.trim()) params.set('q', byId('searchFilter').value.trim());
        if (before) params.set('before', before);
        return '/api/v1/enterprise/audit?' + params.toString();
      }
      function updateCsvLink() {
        var href = buildAuditPath('').replace('/api/v1/enterprise/audit?', '/api/v1/enterprise/audit?format=csv&');
        byId('csvLink').href = href;
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderProjects(payload) {
        var select = byId('projectFilter');
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        select.innerHTML = '<option value="">All projects</option>' + projects.map(function(project) {
          return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
        }).join('');
      }
      function renderEvents(payload, append) {
        var summary = payload.summary || {};
        var events = Array.isArray(payload.events) ? payload.events : [];
        text('kpiTotal', number(summary.totalEvents));
        text('kpiGovernance', number(summary.governanceEvents));
        text('kpiProxy', number(summary.proxyEvents));
        text('kpiWindow', 'last ' + (payload.filters && payload.filters.days ? payload.filters.days : byId('daysFilter').value) + ' days');
        text('kpiMore', payload.has_more ? 'yes' : 'no');
        text('timelineMeta', payload.organization ? payload.organization.name : 'active organization');
        nextBefore = payload.next_before || '';
        byId('loadMoreBtn').style.display = nextBefore ? 'inline-block' : 'none';
        var list = byId('eventList');
        var html = events.map(function(event) {
          var project = event.project || {};
          var statusClass = event.status && Number(event.status) >= 400 ? 'bad' : event.source === 'governance' ? 'good' : 'warn';
          var metadata = event.metadata && Object.keys(event.metadata).length ? JSON.stringify(event.metadata, null, 2) : '';
          return '<article class="event"><div class="event-time">' + escapeHtml(rel(event.timestamp)) + '<br>' + escapeHtml(event.timestamp || '') + '</div><div><div class="event-title">' + escapeHtml(event.event_type) + '</div><div class="event-sub">' + escapeHtml(event.description || '') + '</div><div><span class="tag ' + statusClass + '">' + escapeHtml(event.source) + '</span>' + (event.actor ? '<span class="tag">' + escapeHtml(event.actor) + '</span>' : '') + (project.id ? '<span class="tag">' + escapeHtml(project.name || project.vp_proj_id || project.id) + '</span>' : '') + (event.status != null ? '<span class="tag">status ' + escapeHtml(event.status) + '</span>' : '') + '</div>' + (metadata ? '<details><summary>event metadata</summary><pre>' + escapeHtml(metadata) + '</pre></details>' : '') + '</div><a class="tag" href="' + escapeHtml(byId('csvLink').href) + '">CSV</a></article>';
        }).join('');
        if (append && list.querySelector('.event')) {
          list.insertAdjacentHTML('beforeend', html || '');
        } else {
          list.innerHTML = html || '<div class="empty">No audit events match these filters.</div>';
        }
      }
      async function loadBase() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        var orgs = await fetchJson('/api/v1/enterprise/orgs');
        renderOrgSelector(orgs);
        var projects = await fetchJson('/api/v1/enterprise/projects');
        renderProjects(projects);
      }
      async function loadAudit(append) {
        updateCsvLink();
        var payload = await fetchJson(buildAuditPath(append ? nextBefore : ''));
        renderEvents(payload, append);
      }
      async function reload() {
        try {
          await loadBase();
          await loadAudit(false);
        } catch (error) {
          notice(error && error.message ? error.message : 'Audit failed to load.');
        }
      }
      byId('filterForm').addEventListener('submit', function(event) {
        event.preventDefault();
        loadAudit(false).catch(function(error) { notice(error && error.message ? error.message : 'Audit failed to load.'); });
      });
      byId('loadMoreBtn').addEventListener('click', function() {
        loadAudit(true).catch(function(error) { notice(error && error.message ? error.message : 'Older audit events failed to load.'); });
      });
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseAlertsPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Alerts - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.09); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --green: #6ee7b7; --red: #fb7185; --blue: #93c5fd; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 16% 6%, rgba(251,113,133,.18), transparent 28rem), radial-gradient(circle at 82% 18%, rgba(215,168,75,.22), transparent 28rem), linear-gradient(135deg, #06100e, #10231d 50%, #050807); }
    a { color: inherit; text-decoration: none; }
    select, button, input { border: 1px solid var(--line); background: rgba(237,229,204,.08); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    button[disabled] { cursor: not-allowed; opacity: .58; }
    input::placeholder { color: rgba(244,236,213,.48); }
    .shell { display: grid; grid-template-columns: 270px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(3,8,7,.66); padding: 28px 20px; }
    .brand { font-weight: 850; letter-spacing: -.03em; margin-bottom: 28px; }
    .brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; font-weight: 500; }
    .nav-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; margin: 22px 0 9px 10px; }
    .nav-link { display: flex; justify-content: space-between; padding: 11px 12px; border-radius: 14px; margin-bottom: 4px; border: 1px solid transparent; color: #d8dfcf; }
    .nav-link:hover, .nav-link.active { background: var(--panel); border-color: var(--line); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 760px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, .85fr) minmax(0, 1.15fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(0,0,0,.2); }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(237,229,204,.1); border-radius: 18px; padding: 14px; background: rgba(3,8,7,.28); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(147,197,253,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(110,231,183,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(215,168,75,.28); }
    .tag.bad { color: var(--red); border-color: rgba(251,113,133,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(237,229,204,.22); border-radius: 18px; padding: 18px; background: rgba(3,8,7,.2); }
    .notice.error { color: var(--red); border-color: rgba(251,113,133,.3); }
    @media (max-width: 1100px) { .filters, .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">VaultProof Enterprise<span>alert operations</span></div>
      <div class="nav-label">workspace</div>
      <a class="nav-link" href="/app/dashboard">Dashboard</a>
      <a class="nav-link" href="/app/projects">Projects</a>
      <a class="nav-link" href="/app/control">Control</a>
      <a class="nav-link" href="/app/org">Org + SSO</a>
      <div class="nav-label">evidence</div>
      <a class="nav-link" href="/app/members">Members</a>
      <a class="nav-link" href="/app/audit">Audit</a>
      <a class="nav-link active" href="/app/alerts">Alerts</a>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">ops notifications</div>
          <h1>Alerts</h1>
          <p class="lead">Review alert destinations, dispatch policy, delivery logs, and policy dispatch runs from the enterprise control plane.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <button id="testSendBtn" type="button" disabled title="Load destinations before sending a test alert">test send</button>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">destinations</div><div class="kpi-value" id="kpiDestinations">...</div><div class="kpi-sub" id="kpiEnabled">loading</div></div>
        <div class="card"><div class="kpi-label">policy</div><div class="kpi-value" id="kpiPolicy">...</div><div class="kpi-sub" id="kpiSeverity">minimum severity</div></div>
        <div class="card"><div class="kpi-label">deliveries</div><div class="kpi-value" id="kpiDeliveries">...</div><div class="kpi-sub">filtered delivery logs</div></div>
        <div class="card"><div class="kpi-label">dispatch runs</div><div class="kpi-value" id="kpiRuns">...</div><div class="kpi-sub" id="kpiCooldown">policy cadence</div></div>
      </section>

      <section class="grid two">
        <div class="card">
          <div class="section-title"><h2>Dispatch policy</h2><span id="policyMeta" class="mini"></span></div>
          <div id="policyDetails" class="list"><div class="empty">Loading policy...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Destinations</h2><span id="destinationMeta" class="mini"></span></div>
          <div id="destinationList" class="list"><div class="empty">Loading destinations...</div></div>
        </div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="section-title"><h2>Delivery logs</h2><span id="deliveryMeta" class="mini"></span></div>
        <form id="deliveryFilterForm" class="filters">
          <select id="activityWindow" aria-label="Activity window">
            <option value="24h">last 24h</option>
            <option value="7d" selected>last 7d</option>
            <option value="30d">last 30d</option>
            <option value="all">all time</option>
          </select>
          <select id="deliveryStatus" aria-label="Delivery status">
            <option value="all">all statuses</option>
            <option value="delivered">delivered</option>
            <option value="failed">failed</option>
            <option value="skipped">skipped</option>
          </select>
          <select id="deliveryChannel" aria-label="Delivery channel">
            <option value="all">all channels</option>
            <option value="email">email</option>
            <option value="webhook">webhook</option>
          </select>
          <select id="deliveryKind" aria-label="Delivery kind">
            <option value="all">all kinds</option>
            <option value="test_send">test send</option>
            <option value="policy_dispatch">policy dispatch</option>
          </select>
          <input id="deliverySearch" type="search" placeholder="Search delivery detail..." />
          <button class="primary" type="submit">apply</button>
        </form>
        <div id="deliveryList" class="list"><div class="empty">Loading delivery logs...</div></div>
        <div style="margin-top:14px"><button id="loadMoreDeliveriesBtn" type="button" style="display:none">load older deliveries</button></div>
      </section>

      <section class="card" style="margin-top:16px">
        <div class="section-title"><h2>Dispatch runs</h2><span id="runMeta" class="mini"></span></div>
        <div id="runList" class="list"><div class="empty">Loading dispatch runs...</div></div>
        <div style="margin-top:14px"><button id="loadMoreRunsBtn" type="button" style="display:none">load older runs</button></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var nextDeliveryBefore = '';
      var nextRunBefore = '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      async function postJson(path, body) {
        var res = await fetch(path, { method: 'POST', headers: headers(), body: JSON.stringify(body || {}) });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function buildAlertsPath(extra) {
        var params = new URLSearchParams();
        params.set('activity_window', byId('activityWindow').value || '7d');
        params.set('delivery_limit', '20');
        params.set('run_limit', '20');
        if (byId('deliveryStatus').value !== 'all') params.set('delivery_status', byId('deliveryStatus').value);
        if (byId('deliveryChannel').value !== 'all') params.set('delivery_channel', byId('deliveryChannel').value);
        if (byId('deliveryKind').value !== 'all') params.set('delivery_kind', byId('deliveryKind').value);
        if (byId('deliverySearch').value.trim()) params.set('delivery_q', byId('deliverySearch').value.trim());
        if (extra && extra.deliveryBefore) params.set('delivery_before', extra.deliveryBefore);
        if (extra && extra.runBefore) params.set('run_before', extra.runBefore);
        return '/api/v1/enterprise/alerts?' + params.toString();
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function statusTag(status) {
        var cls = status === 'delivered' || status === 'dispatched' ? 'good' : status === 'failed' ? 'bad' : 'warn';
        return '<span class="tag ' + cls + '">' + escapeHtml(status || 'unknown') + '</span>';
      }
      function renderPayload(payload, appendMode) {
        var destinations = Array.isArray(payload.destinations) ? payload.destinations : [];
        var deliveries = Array.isArray(payload.delivery_logs) ? payload.delivery_logs : [];
        var runs = Array.isArray(payload.dispatch_runs) ? payload.dispatch_runs : [];
        var policy = payload.policy || {};
        var deliveryMeta = payload.delivery_logs_meta || {};
        var runMeta = payload.dispatch_runs_meta || {};
        var enabledCount = destinations.filter(function(destination) { return destination.enabled; }).length;
        text('kpiDestinations', number(destinations.length));
        text('kpiEnabled', enabledCount + ' enabled');
        text('kpiPolicy', policy.dispatch_enabled ? 'on' : 'off');
        text('kpiSeverity', 'minimum ' + (policy.minimum_severity || 'warning'));
        text('kpiDeliveries', number(deliveryMeta.total || deliveries.length));
        text('kpiRuns', number(runMeta.total || runs.length));
        text('kpiCooldown', payload.dispatch_status && payload.dispatch_status.cooldown_active ? 'cooldown active' : 'eligible');
        text('policyMeta', payload.can_manage ? 'admin view' : 'read-only view');
        text('destinationMeta', enabledCount + ' enabled of ' + destinations.length);
        text('deliveryMeta', (deliveryMeta.filters && deliveryMeta.filters.activity_window ? deliveryMeta.filters.activity_window : '7d') + ' window');
        text('runMeta', (runMeta.filters && runMeta.filters.activity_window ? runMeta.filters.activity_window : '7d') + ' window');
        var firstEnabledDestination = destinations.find(function(destination) { return destination.enabled; });
        var testSendBtn = byId('testSendBtn');
        testSendBtn.disabled = !payload.can_manage || !firstEnabledDestination;
        testSendBtn.dataset.destinationId = firstEnabledDestination ? firstEnabledDestination.id : '';
        testSendBtn.title = !payload.can_manage
          ? 'Only admins can test alert delivery'
          : firstEnabledDestination
            ? 'Send a test alert to ' + (firstEnabledDestination.label || firstEnabledDestination.channel_type)
            : 'No enabled alert destinations are configured';
        byId('policyDetails').innerHTML = '<div class="row"><div><div class="row-title">Policy dispatch is ' + escapeHtml(policy.dispatch_enabled ? 'enabled' : 'disabled') + '</div><div class="row-sub">Minimum severity ' + escapeHtml(policy.minimum_severity || 'warning') + ' - minimum interval ' + number(policy.min_interval_minutes || 0) + ' minutes - next eligible ' + escapeHtml(payload.dispatch_status && payload.dispatch_status.next_eligible_at ? rel(payload.dispatch_status.next_eligible_at) : 'now') + '</div></div>' + statusTag(policy.dispatch_enabled ? 'dispatched' : 'skipped') + '</div>';
        byId('destinationList').innerHTML = destinations.length ? destinations.map(function(destination) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(destination.label || destination.channel_type) + '</div><div class="row-sub">' + escapeHtml(destination.channel_type) + ' - ' + escapeHtml(destination.target_masked || '') + ' - updated ' + escapeHtml(rel(destination.updated_at || destination.created_at)) + '</div></div>' + statusTag(destination.enabled ? 'delivered' : 'skipped') + '</div>';
        }).join('') : '<div class="empty">No alert destinations configured yet.</div>';
        var deliveryHtml = deliveries.map(function(delivery) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(delivery.delivery_kind) + ' / ' + escapeHtml(delivery.channel_type) + '</div><div class="row-sub">' + escapeHtml(delivery.detail || '') + ' - ' + escapeHtml(rel(delivery.delivered_at)) + (delivery.response_status ? ' - HTTP ' + escapeHtml(delivery.response_status) : '') + '</div></div>' + statusTag(delivery.status) + '</div>';
        }).join('');
        if (appendMode === 'deliveries' && byId('deliveryList').querySelector('.row')) {
          byId('deliveryList').insertAdjacentHTML('beforeend', deliveryHtml);
        } else if (appendMode !== 'runs') {
          byId('deliveryList').innerHTML = deliveryHtml || '<div class="empty">No delivery logs match these filters.</div>';
        }
        var runHtml = runs.map(function(run) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(run.trigger_source) + ' dispatch - ' + escapeHtml(run.reason || 'policy check') + '</div><div class="row-sub">' + escapeHtml(rel(run.checked_at)) + ' - alerts ' + number(run.dispatched_alert_count) + ' - destinations ' + number(run.destination_count) + ' - delivered ' + number(run.delivered_count) + ' - failed ' + number(run.failed_count) + ' - skipped ' + number(run.skipped_count) + '</div></div>' + statusTag(run.status) + '</div>';
        }).join('');
        if (appendMode === 'runs' && byId('runList').querySelector('.row')) {
          byId('runList').insertAdjacentHTML('beforeend', runHtml);
        } else if (appendMode !== 'deliveries') {
          byId('runList').innerHTML = runHtml || '<div class="empty">No dispatch runs match these filters.</div>';
        }
        nextDeliveryBefore = deliveryMeta.next_before || '';
        nextRunBefore = runMeta.next_before || '';
        byId('loadMoreDeliveriesBtn').style.display = nextDeliveryBefore ? 'inline-block' : 'none';
        byId('loadMoreRunsBtn').style.display = nextRunBefore ? 'inline-block' : 'none';
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          renderOrgSelector(await fetchJson('/api/v1/enterprise/orgs'));
          renderPayload(await fetchJson(buildAlertsPath()), '');
        } catch (error) {
          notice(error && error.message ? error.message : 'Alerts failed to load.');
        }
      }
      byId('deliveryFilterForm').addEventListener('submit', function(event) {
        event.preventDefault();
        fetchJson(buildAlertsPath()).then(function(payload) { renderPayload(payload, ''); }).catch(function(error) { notice(error && error.message ? error.message : 'Alerts failed to load.'); });
      });
      byId('loadMoreDeliveriesBtn').addEventListener('click', function() {
        fetchJson(buildAlertsPath({ deliveryBefore: nextDeliveryBefore })).then(function(payload) { renderPayload(payload, 'deliveries'); }).catch(function(error) { notice(error && error.message ? error.message : 'Older deliveries failed to load.'); });
      });
      byId('loadMoreRunsBtn').addEventListener('click', function() {
        fetchJson(buildAlertsPath({ runBefore: nextRunBefore })).then(function(payload) { renderPayload(payload, 'runs'); }).catch(function(error) { notice(error && error.message ? error.message : 'Older dispatch runs failed to load.'); });
      });
      byId('testSendBtn').addEventListener('click', function() {
        var destinationId = byId('testSendBtn').dataset.destinationId || '';
        byId('testSendBtn').disabled = true;
        postJson('/api/v1/enterprise/alerts/test-send', { destination_id: destinationId })
          .then(function(payload) {
            notice('Test alert ' + (payload.status || 'sent') + ': ' + (payload.detail || 'delivery recorded'));
            return reload();
          })
          .catch(function(error) {
            notice(error && error.message ? error.message : 'Test alert failed.');
          })
          .finally(function() {
            byId('testSendBtn').disabled = !byId('testSendBtn').dataset.destinationId;
          });
      });
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseOperationsPage(pageName: 'activity' | 'projects' | 'keys'): string {
  const pageTitle = pageName === 'activity' ? 'Activity' : pageName === 'projects' ? 'Projects' : 'Provider Slots';
  const pageKicker = pageName === 'activity' ? 'runtime feed' : pageName === 'projects' ? 'project inventory' : 'secrets posture';
  const pageLead = pageName === 'activity'
    ? 'Review secure proxy/runtime events, status codes, latency, provider request IDs, and attestation evidence hints.'
    : pageName === 'projects'
      ? 'Track enterprise projects, provider coverage, caller-lock policy, traffic health, and quick links into Control.'
      : 'Review active provider slots, trigger emergency revoke, and keep rotation posture visible without exposing upstream secrets.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(pageTitle)} - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.09); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --green: #6ee7b7; --red: #fb7185; --blue: #93c5fd; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 12% 8%, rgba(110,231,183,.18), transparent 28rem), radial-gradient(circle at 84% 16%, rgba(215,168,75,.2), transparent 28rem), linear-gradient(135deg, #06100e, #10231d 50%, #050807); }
    a { color: inherit; text-decoration: none; }
    select, button, input { border: 1px solid var(--line); background: rgba(237,229,204,.08); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(244,236,213,.48); }
    .shell { display: grid; grid-template-columns: 270px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(3,8,7,.66); padding: 28px 20px; }
    .brand { font-weight: 850; letter-spacing: -.03em; margin-bottom: 28px; }
    .brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; font-weight: 500; }
    .nav-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; margin: 22px 0 9px 10px; }
    .nav-link { display: flex; justify-content: space-between; padding: 11px 12px; border-radius: 14px; margin-bottom: 4px; border: 1px solid transparent; color: #d8dfcf; }
    .nav-link:hover, .nav-link.active { background: var(--panel); border-color: var(--line); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 780px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .danger { color: var(--red); border-color: rgba(251,113,133,.34); }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(0,0,0,.2); }
    .filters { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(150px, .7fr) minmax(180px, 1fr) auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(237,229,204,.1); border-radius: 18px; padding: 14px; background: rgba(3,8,7,.28); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(147,197,253,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(110,231,183,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(215,168,75,.28); }
    .tag.bad { color: var(--red); border-color: rgba(251,113,133,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(237,229,204,.22); border-radius: 18px; padding: 18px; background: rgba(3,8,7,.2); }
    .notice.error { color: var(--red); border-color: rgba(251,113,133,.3); }
    @media (max-width: 1100px) { .filters, .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">VaultProof Enterprise<span>${escapeHtml(pageKicker)}</span></div>
      <div class="nav-label">workspace</div>
      <a class="nav-link" href="/app/dashboard">Dashboard</a>
      <a class="nav-link${pageName === 'projects' ? ' active' : ''}" href="/app/projects">Projects</a>
      <a class="nav-link${pageName === 'activity' ? ' active' : ''}" href="/app/activity">Activity</a>
      <a class="nav-link" href="/app/control">Control</a>
      <a class="nav-link" href="/app/org">Org + SSO</a>
      <div class="nav-label">evidence</div>
      <a class="nav-link" href="/app/members">Members</a>
      <a class="nav-link" href="/app/audit">Audit</a>
      <a class="nav-link" href="/app/alerts">Alerts</a>
      <a class="nav-link${pageName === 'keys' ? ' active' : ''}" href="/app/keys">Provider slots</a>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">${escapeHtml(pageKicker)}</div>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p class="lead">${escapeHtml(pageLead)}</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" href="/app/control">open control</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">active scopes</div></div>
        <div class="card"><div class="kpi-label">provider slots</div><div class="kpi-value" id="kpiKeys">...</div><div class="kpi-sub" id="kpiProviders">active providers</div></div>
        <div class="card"><div class="kpi-label">calls</div><div class="kpi-value" id="kpiCalls">...</div><div class="kpi-sub">all-time proxy logs</div></div>
        <div class="card"><div class="kpi-label">denied</div><div class="kpi-value" id="kpiDenied">...</div><div class="kpi-sub">401 / 403 / 429</div></div>
      </section>

      <section id="activityPanel" class="card" style="display:none">
        <div class="section-title"><h2>Runtime activity</h2><span id="activityMeta" class="mini"></span></div>
        <form id="activityFilterForm" class="filters">
          <select id="activityProjectFilter" aria-label="Project"><option value="">All projects</option></select>
          <select id="activityStatusFilter" aria-label="Status">
            <option value="">all statuses</option>
            <option value="proxy_request">successful</option>
            <option value="proxy_error">errors</option>
          </select>
          <input id="activitySearch" type="search" placeholder="Search provider, path, method..." />
          <button class="primary" type="submit">apply</button>
        </form>
        <div id="activityList" class="list"><div class="empty">Loading activity...</div></div>
      </section>

      <section id="projectsPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Project inventory</h2><span id="projectMeta" class="mini"></span></div>
          <div id="projectList" class="list"><div class="empty">Loading projects...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Project health</h2><span id="healthMeta" class="mini"></span></div>
          <div id="healthList" class="list"><div class="empty">Loading health...</div></div>
        </div>
      </section>

      <section id="keysPanel" class="card" style="display:none">
        <div class="section-title"><h2>Provider slots</h2><span id="keyMeta" class="mini"></span></div>
        <div id="keyList" class="list"><div class="empty">Loading provider slots...</div></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var PAGE_MODE = '${pageName}';
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var cachedProjects = [];
      var cachedOverview = {};
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path, options) {
        var opts = options || {};
        opts.headers = Object.assign(headers(), opts.headers || {});
        var res = await fetch(path, opts);
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function statusTag(value) {
        var n = Number(value || 0);
        var cls = n >= 400 ? 'bad' : n >= 300 ? 'warn' : 'good';
        return '<span class="tag ' + cls + '">' + escapeHtml(value == null ? 'unknown' : value) + '</span>';
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function updateKpis() {
        var slotCount = cachedProjects.reduce(function(total, project) { return total + ((project.provider_slots || []).length); }, 0);
        text('kpiProjects', number(cachedProjects.length));
        text('kpiKeys', number(slotCount));
        text('kpiProviders', (cachedOverview.providers || []).join(', ') || 'no active slots');
        text('kpiCalls', number(cachedOverview.totalCalls));
        text('kpiDenied', number(cachedOverview.deniedCalls));
      }
      function renderProjectOptions() {
        var select = byId('activityProjectFilter');
        if (!select) return;
        select.innerHTML = '<option value="">All projects</option>' + cachedProjects.map(function(project) {
          return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
        }).join('');
      }
      function renderProjects() {
        byId('projectsPanel').style.display = PAGE_MODE === 'projects' ? 'grid' : 'none';
        if (PAGE_MODE !== 'projects') return;
        text('projectMeta', cachedProjects.length + ' active projects');
        var projectList = byId('projectList');
        projectList.innerHTML = cachedProjects.length ? cachedProjects.map(function(project) {
          var policy = project.caller_lock_policy || {};
          var providers = (project.provider_slots || []).map(function(slot) { return slot.slug || slot.provider; });
          return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id) + '</div><div class="row-sub">' + escapeHtml(project.vp_proj_id) + ' - ' + escapeHtml(project.project_role) + ' via ' + escapeHtml(project.access_via) + ' - created ' + escapeHtml(rel(project.created_at)) + '</div><div><span class="tag ' + (project.strict_origin ? 'good' : 'warn') + '">' + (project.strict_origin ? 'strict origin' : 'origin relaxed') + '</span><span class="tag">' + providers.length + ' provider slots</span><span class="tag">' + (policy.rate_limit_per_minute ? policy.rate_limit_per_minute + '/min' : 'no project rate cap') + '</span></div></div><a class="tag" href="/app/control">control</a></div>';
        }).join('') : '<div class="empty">No active enterprise projects yet.</div>';
        var health = Array.isArray(cachedOverview.projectHealth) ? cachedOverview.projectHealth : [];
        text('healthMeta', (cachedOverview.healthWindowDays || 7) + 'd window');
        byId('healthList').innerHTML = health.length ? health.map(function(project) {
          var cls = project.denied || project.errors ? 'bad' : project.calls ? 'good' : 'warn';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id) + '</div><div class="row-sub">calls ' + number(project.calls) + ' - errors ' + number(project.errors) + ' - denied ' + number(project.denied) + ' - last ' + escapeHtml(rel(project.lastActivity)) + '</div></div><span class="tag ' + cls + '">' + (project.calls ? 'traffic' : 'idle') + '</span></div>';
        }).join('') : '<div class="empty">No project health data yet.</div>';
      }
      async function renderActivity() {
        byId('activityPanel').style.display = PAGE_MODE === 'activity' ? 'block' : 'none';
        if (PAGE_MODE !== 'activity') return;
        var params = new URLSearchParams({ source: 'proxy', limit: '100', days: '30' });
        if (byId('activityProjectFilter').value) params.set('project_id', byId('activityProjectFilter').value);
        if (byId('activityStatusFilter').value) params.set('event_type', byId('activityStatusFilter').value);
        if (byId('activitySearch').value.trim()) params.set('q', byId('activitySearch').value.trim());
        var payload = await fetchJson('/api/v1/enterprise/audit?' + params.toString());
        var events = Array.isArray(payload.events) ? payload.events : [];
        text('activityMeta', events.length + ' proxy events');
        byId('activityList').innerHTML = events.length ? events.map(function(event) {
          var meta = event.metadata || {};
          var project = event.project || {};
          return '<div class="row"><div><div class="row-title">' + escapeHtml(event.description || event.event_type) + '</div><div class="row-sub">' + escapeHtml(rel(event.timestamp)) + ' - ' + escapeHtml(project.name || project.vp_proj_id || 'unknown project') + ' - ' + escapeHtml(meta.provider || meta.slug || 'unknown provider') + ' - ' + escapeHtml(meta.latency_ms == null ? 'latency n/a' : meta.latency_ms + 'ms') + (meta.provider_request_id ? ' - request ' + escapeHtml(meta.provider_request_id) : '') + '</div></div>' + statusTag(event.status) + '</div>';
        }).join('') : '<div class="empty">No runtime activity matches these filters.</div>';
      }
      function renderKeys() {
        byId('keysPanel').style.display = PAGE_MODE === 'keys' ? 'block' : 'none';
        if (PAGE_MODE !== 'keys') return;
        var rows = [];
        cachedProjects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) {
            rows.push({ project: project, slot: slot });
          });
        });
        text('keyMeta', rows.length + ' active provider slots');
        byId('keyList').innerHTML = rows.length ? rows.map(function(item) {
          var policy = item.project.caller_lock_policy || {};
          var override = policy.provider_overrides && policy.provider_overrides[item.slot.slug || item.slot.provider];
          var canAdmin = item.project.project_role === 'owner' || item.project.project_role === 'admin';
          var action = canAdmin ? '<button type="button" class="danger" data-action="revoke-slot" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">emergency revoke</button>' : '<span class="tag warn">read-only</span>';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(item.slot.slug || item.slot.provider) + '</div><div class="row-sub">' + escapeHtml(item.project.name || item.project.vp_proj_id) + ' - provider ' + escapeHtml(item.slot.provider) + ' - key id ' + escapeHtml(item.slot.key_id) + '</div><div><span class="tag good">active</span><span class="tag">' + (override ? 'provider override' : 'project policy') + '</span><span class="tag">rotation: manual checklist</span><span class="tag">SKR: executor-bound</span></div></div>' + action + '</div>';
        }).join('') : '<div class="empty">No active provider slots found.</div>';
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          renderOrgSelector(await fetchJson('/api/v1/enterprise/orgs'));
          var results = await Promise.all([
            fetchJson('/api/v1/enterprise/projects'),
            fetchJson('/api/v1/enterprise/projects/stats/overview')
          ]);
          cachedProjects = Array.isArray(results[0].projects) ? results[0].projects : [];
          cachedOverview = results[1] || {};
          updateKpis();
          renderProjectOptions();
          renderProjects();
          renderKeys();
          await renderActivity();
        } catch (error) {
          notice(error && error.message ? error.message : 'Enterprise operations failed to load.');
        }
      }
      if (byId('activityFilterForm')) {
        byId('activityFilterForm').addEventListener('submit', function(event) {
          event.preventDefault();
          renderActivity().catch(function(error) { notice(error && error.message ? error.message : 'Activity failed to load.'); });
        });
      }
      document.addEventListener('click', async function(event) {
        var target = event.target;
        if (!target || !target.getAttribute || target.getAttribute('data-action') !== 'revoke-slot') return;
        var reason = prompt('Reason for emergency revoke?');
        if (reason === null) return;
        try {
          await fetchJson('/api/v1/enterprise/projects/' + encodeURIComponent(target.getAttribute('data-project-id')) + '/providers/' + encodeURIComponent(target.getAttribute('data-slug')) + '/revoke', {
            method: 'POST',
            body: JSON.stringify({ reason: reason || 'Emergency revoke from enterprise dashboard' })
          });
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Provider revoke failed.');
        }
      });
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function renderEnterpriseSupportPage(pageName: 'settings' | 'plans' | 'scanner' | 'runbooks'): string {
  const pageTitle = pageName === 'settings' ? 'Settings' : pageName === 'plans' ? 'Plans' : pageName === 'scanner' ? 'Scanner' : 'Runbooks';
  const pageKicker = pageName === 'settings' ? 'tenant defaults' : pageName === 'plans' ? 'enterprise packaging' : pageName === 'scanner' ? 'repository security' : 'operator commands';
  const pageLead = pageName === 'settings'
    ? 'Review tenant defaults, organization identity, SSO state, and production readiness without falling back to the consumer dashboard.'
    : pageName === 'plans'
      ? 'Track enterprise rollout packaging, Azure/APIM readiness, usage posture, and contract-facing guardrails.'
      : pageName === 'scanner'
        ? 'Prepare repository scanning for enterprise use while keeping scanner actions disabled until enterprise-safe scanner APIs are available.'
        : 'Review production verification, evidence, deploy, secret, TLS, APIM, SSH, and cleanup runbooks before making live infrastructure changes.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(pageTitle)} - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.09); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --green: #6ee7b7; --red: #fb7185; --blue: #93c5fd; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 18% 8%, rgba(215,168,75,.2), transparent 28rem), radial-gradient(circle at 86% 16%, rgba(147,197,253,.18), transparent 28rem), linear-gradient(135deg, #06100e, #10231d 50%, #050807); }
    a { color: inherit; text-decoration: none; }
    select, button { border: 1px solid var(--line); background: rgba(237,229,204,.08); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    button[disabled] { cursor: not-allowed; opacity: .58; }
    .shell { display: grid; grid-template-columns: 270px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid var(--line); background: rgba(3,8,7,.66); padding: 28px 20px; }
    .brand { font-weight: 850; letter-spacing: -.03em; margin-bottom: 28px; }
    .brand span { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; font-weight: 500; }
    .nav-label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; margin: 22px 0 9px 10px; }
    .nav-link { display: flex; justify-content: space-between; padding: 11px 12px; border-radius: 14px; margin-bottom: 4px; border: 1px solid transparent; color: #d8dfcf; }
    .nav-link:hover, .nav-link.active { background: var(--panel); border-color: var(--line); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 780px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(0,0,0,.2); }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(237,229,204,.1); border-radius: 18px; padding: 14px; background: rgba(3,8,7,.28); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(147,197,253,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(110,231,183,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(215,168,75,.28); }
    .tag.bad { color: var(--red); border-color: rgba(251,113,133,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(237,229,204,.22); border-radius: 18px; padding: 18px; background: rgba(3,8,7,.2); }
    .notice.error { color: var(--red); border-color: rgba(251,113,133,.3); }
    @media (max-width: 1100px) { .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .kpis, .two { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand">VaultProof Enterprise<span>${escapeHtml(pageKicker)}</span></div>
      <div class="nav-label">workspace</div>
      <a class="nav-link" href="/app/dashboard">Dashboard</a>
      <a class="nav-link" href="/app/projects">Projects</a>
      <a class="nav-link" href="/app/activity">Activity</a>
      <a class="nav-link" href="/app/control">Control</a>
      <a class="nav-link" href="/app/org">Org + SSO</a>
      <div class="nav-label">evidence</div>
      <a class="nav-link" href="/app/members">Members</a>
      <a class="nav-link" href="/app/audit">Audit</a>
      <a class="nav-link" href="/app/alerts">Alerts</a>
      <a class="nav-link" href="/app/keys">Provider slots</a>
      <div class="nav-label">admin</div>
      <a class="nav-link${pageName === 'settings' ? ' active' : ''}" href="/app/settings">Settings</a>
      <a class="nav-link${pageName === 'plans' ? ' active' : ''}" href="/app/plans">Plans</a>
      <a class="nav-link${pageName === 'scanner' ? ' active' : ''}" href="/app/scanner">Scanner</a>
      <a class="nav-link${pageName === 'runbooks' ? ' active' : ''}" href="/app/runbooks">Runbooks</a>
    </aside>

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">${escapeHtml(pageKicker)}</div>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p class="lead">${escapeHtml(pageLead)}</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" href="/app/dashboard">dashboard</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">production</div><div class="kpi-value" id="kpiProduction">...</div><div class="kpi-sub">control plane + executor</div></div>
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">active scopes</div></div>
        <div class="card"><div class="kpi-label">members</div><div class="kpi-value" id="kpiMembers">...</div><div class="kpi-sub" id="kpiOrgRole">org role</div></div>
        <div class="card"><div class="kpi-label">calls</div><div class="kpi-value" id="kpiCalls">...</div><div class="kpi-sub">proxy traffic</div></div>
      </section>

      <section id="settingsPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Organization defaults</h2><span id="settingsMeta" class="mini"></span></div><div id="settingsList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Security notices</h2><span class="mini">enterprise safe</span></div><div id="securityList" class="list"></div></div>
      </section>

      <section id="plansPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Rollout package</h2><span id="planMeta" class="mini"></span></div><div id="planList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Contract guardrails</h2><span class="mini">evidence pack</span></div><div id="guardrailList" class="list"></div></div>
      </section>

      <section id="scannerPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Enterprise scanner status</h2><span class="mini">not enabled</span></div><div id="scannerList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Safe launch checklist</h2><span class="mini">before wiring APIs</span></div><div id="scannerChecklist" class="list"></div></div>
      </section>

      <section id="runbooksPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Safe verification commands</h2><span class="mini">read-only checks</span></div><div id="runbooksSafeList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Gated infrastructure actions</h2><span class="mini">operator approval</span></div><div id="runbooksGatedList" class="list"></div></div>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var PAGE_MODE = '${pageName}';
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) { var n = Number(value || 0); return Number.isFinite(n) ? n.toLocaleString() : '0'; }
      function rel(value) {
        if (!value) return 'never';
        var diff = Date.now() - new Date(value).getTime();
        if (!Number.isFinite(diff)) return String(value);
        var mins = Math.max(0, Math.round(diff / 60000));
        if (mins < 60) return mins + 'm ago';
        var hours = Math.round(mins / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function headers() {
        var h = { 'Content-Type': 'application/json' };
        if (token) h.Authorization = 'Bearer ' + token;
        if (currentOrgId) h['x-vaultproof-organization'] = currentOrgId;
        return h;
      }
      async function fetchJson(path) {
        var res = await fetch(path, { headers: headers() });
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        message = friendlyErrorMessage(message);
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login">Sign in</a>' : '';
      }
      function row(title, sub, tag, tone) {
        return '<div class="row"><div><div class="row-title">' + escapeHtml(title) + '</div><div class="row-sub">' + escapeHtml(sub || '') + '</div></div><span class="tag ' + (tone || '') + '">' + escapeHtml(tag || 'ready') + '</span></div>';
      }
      function renderOrgSelector(payload) {
        var select = byId('orgSelect');
        var orgs = Array.isArray(payload.organizations) ? payload.organizations : [];
        if (!orgs.length) {
          select.innerHTML = '<option value="">No orgs</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var selected = orgs.find(function(org) { return org.id === currentOrgId; })
          || orgs.find(function(org) { return org.id === payload.active_organization_id; })
          || orgs.find(function(org) { return org.kind && org.kind !== 'personal'; })
          || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
        }
      }
      function renderPanels(orgPayload, readiness, overview) {
        var org = orgPayload.organization || {};
        var sso = orgPayload.sso_status || {};
        var productionReady = readiness.production_ready === true;
        text('kpiProduction', productionReady ? 'yes' : 'no');
        text('kpiProjects', number(org.project_count || overview.totalProjects));
        text('kpiMembers', number(org.member_count));
        text('kpiOrgRole', org.role || 'member');
        text('kpiCalls', number(overview.totalCalls));
        byId('settingsPanel').style.display = PAGE_MODE === 'settings' ? 'grid' : 'none';
        byId('plansPanel').style.display = PAGE_MODE === 'plans' ? 'grid' : 'none';
        byId('scannerPanel').style.display = PAGE_MODE === 'scanner' ? 'grid' : 'none';
        byId('runbooksPanel').style.display = PAGE_MODE === 'runbooks' ? 'grid' : 'none';
        if (PAGE_MODE === 'settings') {
          text('settingsMeta', org.kind || 'organization');
          byId('settingsList').innerHTML = [
            row('Organization name', org.name || 'Organization', org.role || 'member', 'good'),
            row('Organization slug', org.slug || 'not set', org.can_archive ? 'owner controls' : 'standard', org.can_archive ? 'good' : 'warn'),
            row('SSO rollout', sso.provider_status || 'not_started', sso.login_mode || 'assisted', sso.provider_status === 'configured' ? 'good' : 'warn'),
            row('Last SSO membership resolution', sso.last_membership_resolution_email || 'none recorded', sso.last_membership_resolution || 'pending', sso.last_membership_resolution ? 'good' : 'warn')
          ].join('');
          byId('securityList').innerHTML = [
            row('Production readiness', productionReady ? 'Control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; '), productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('Origin lock', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'Front Door/custom origin lock configured.' : 'Origin lock is not configured.', readiness.control_plane && readiness.control_plane.origin_lock_required ? 'required' : 'optional', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'good' : 'warn'),
            row('Dashboard session storage', 'Enterprise pages read the Supabase session from local storage and never load the B2C dashboard shell.', 'enterprise only', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'plans') {
          text('planMeta', productionReady ? 'production package' : 'pre-production');
          byId('planList').innerHTML = [
            row('Azure confidential runtime', productionReady ? 'Secure executor is production-ready.' : 'Runtime needs blocker review.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('APIM / Front Door package', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'Origin protection is configured for enterprise edge routing.' : 'Edge/origin lock still needs final packaging.', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'ready' : 'todo', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'good' : 'warn'),
            row('Usage posture', number(overview.totalCalls) + ' calls, ' + number(overview.errorCalls) + ' errors, ' + number(overview.deniedCalls) + ' denied.', (overview.errorRate || 0).toFixed ? (overview.errorRate || 0).toFixed(1) + '% error' : 'usage', (overview.errorCalls || overview.deniedCalls) ? 'warn' : 'good')
          ].join('');
          byId('guardrailList').innerHTML = [
            row('SOC 2 access evidence', 'Members page exports access review evidence and audit page exports governance/runtime CSV.', 'available', 'good'),
            row('Plan limits', 'Enterprise commercial limits are not enforced by this control plane yet; keep contract terms external until billing APIs exist.', 'manual', 'warn'),
            row('Customer rollout notes', 'Use /app/readiness, /app/audit, /app/members, and /app/keys as the contract-facing evidence bundle.', 'ready', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'scanner') {
          byId('scannerList').innerHTML = [
            row('Enterprise scanner APIs', 'No enterprise-safe scanner endpoint is enabled on this control plane yet.', 'disabled', 'warn'),
            row('B2C scanner isolation', 'This page intentionally avoids consumer scanner endpoints and external API fallbacks.', 'isolated', 'good'),
            row('Recommended interim flow', 'Run local scanner tooling during onboarding, then attach sanitized reports to the enterprise audit package.', 'manual', 'warn')
          ].join('');
          byId('scannerChecklist').innerHTML = [
            row('Tenant scoping', 'Scanner results must be scoped to organization/project before enabling browser actions.', 'required', 'warn'),
            row('Finding redaction', 'Secrets and provider tokens must be masked before rendering or exporting.', 'required', 'warn'),
            row('Remediation workflow', 'PR creation, ignore/allowlist, and migration actions need enterprise audit events.', 'required', 'warn')
          ].join('');
        }
        if (PAGE_MODE === 'runbooks') {
          byId('runbooksSafeList').innerHTML = [
            row('Hardening status', 'npm run status:enterprise-hardening runs the safe verifier, TLS preflight, APIM plan, alternate-access prep/check, SSH plan, and Container Apps inventory in one read-only pass.', 'read-only', 'good'),
            row('Production verifier', 'npm run verify:enterprise-production checks Azure, Front Door, APIM sidecar, monitoring, TLS origin posture, and live readiness.', 'read-only', 'good'),
            row('Evidence bundle', 'npm run evidence:enterprise-production captures timestamped infrastructure, app, readiness, and monitoring evidence for review.', 'read-only', 'good'),
            row('Evidence validator', 'npm run validate:enterprise-evidence validates the latest evidence bundle before customer or compliance handoff.', 'read-only', 'good'),
            row('Live app QA', 'npm run qa:enterprise-live-app checks enterprise app pages, internal links, auth-safe rendering, and production readiness.', 'read-only', 'good'),
            row('Secret rotation preparation', 'npm run prepare:enterprise-secret-rotation plans the install order and can generate fresh executor signing material without printing secrets.', 'read-only', 'good'),
            row('Private origin preparation', 'npm run prepare:enterprise-private-origin inventories Front Door, APIM, VM network posture, and Private Link migration choices without changing Azure.', 'read-only', 'good'),
            row('APIM JWT validation preparation', 'npm run prepare:enterprise-apim-jwt plans Supabase or Entra JWT validation settings before enabling APIM validate-jwt.', 'read-only', 'good'),
            row('Origin TLS certificate plan', 'npm run prepare:enterprise-origin-cert plans VM CSR generation, signed certificate install, self-signed marker removal, and local TLS checks.', 'read-only', 'good'),
            row('Origin TLS preparation plan', 'npm run prepare:enterprise-origin-tls previews DNS, NSG 443, and APIM backend steps before the HTTPS origin cutover.', 'read-only', 'good'),
            row('Origin TLS preflight', 'npm run verify:enterprise-origin-tls checks DNS, NSG 443, nginx, certificate SAN/trust, and local origin health before HttpsOnly cutover.', 'read-only', 'good'),
            row('Alternate access preparation', 'npm run prepare:enterprise-alternate-access plans boot diagnostics and Bastion setup with confirmation-gated live actions.', 'read-only', 'good'),
            row('Alternate access readiness', 'npm run verify:enterprise-alternate-access checks Bastion, boot diagnostics/serial-console prerequisites, Defender JIT visibility, and SSH NSG posture before public SSH closure.', 'read-only', 'good'),
            row('Execution dry run', 'npm run qa:enterprise-live-execute validates auth, policy, signing, and executor reachability without dispatching real provider work.', 'safe default', 'good')
          ].join('');
          byId('runbooksGatedList').innerHTML = [
            row('Deploy to Confidential VM', 'npm run deploy:enterprise-vm copies code, rebuilds, and restarts selected systemd services on the CVM.', 'operator', 'warn'),
            row('Secret verification and rotation', 'npm run verify:enterprise-secrets checks installed env posture after the prepared rotation bundle is installed; Supabase key rotation and live env installs remain operator actions.', 'operator', 'warn'),
            row('TLS origin cutover', 'npm run cutover:enterprise-origin-tls plans the Front Door HTTPS origin cutover and requires strict preflight plus confirmation-gated enable/rollback.', 'blocked', 'warn'),
            row('APIM cutover', 'npm run cutover:enterprise-apim previews APIM route cutover and requires confirmation-gated enable/rollback before Front Door changes.', 'blocked', 'warn'),
            row('SSH hardening', 'npm run harden:enterprise-ssh can plan, close, or reopen bootstrap SSH with readiness, alternate-access, and confirmation gates.', 'approval', 'warn'),
            row('Container Apps cleanup', 'npm run cleanup:enterprise-container-apps inventories the old prototype resources and requires action-specific confirmation before ingress disable/restore/delete.', 'approval', 'warn')
          ].join('');
        }
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          renderOrgSelector(await fetchJson('/api/v1/enterprise/orgs'));
          var results = await Promise.all([
            fetchJson('/api/v1/enterprise/orgs/current'),
            fetchJson('/readiness'),
            fetchJson('/api/v1/enterprise/projects/stats/overview')
          ]);
          renderPanels(results[0], results[1], results[2] || {});
        } catch (error) {
          notice(error && error.message ? error.message : 'Enterprise admin page failed to load.');
        }
      }
      byId('refreshBtn').addEventListener('click', reload);
      byId('orgSelect').addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        reload();
      });
      reload();
    })();
  </script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderEnterprisePlannedAppPage(pageName: string, env: EnterpriseControlPlaneEnv = {}): string | null {
  if (pageName === 'members') return injectEnterpriseAnalytics(renderEnterpriseMembersPage(), env, 'members');
  if (pageName === 'audit') return injectEnterpriseAnalytics(renderEnterpriseAuditPage(), env, 'audit');
  if (pageName === 'alerts') return injectEnterpriseAnalytics(renderEnterpriseAlertsPage(), env, 'alerts');
  if (pageName === 'activity' || pageName === 'projects' || pageName === 'keys') {
    return injectEnterpriseAnalytics(renderEnterpriseOperationsPage(pageName), env, pageName);
  }
  if (pageName === 'settings' || pageName === 'plans' || pageName === 'scanner' || pageName === 'runbooks') {
    return injectEnterpriseAnalytics(renderEnterpriseSupportPage(pageName), env, pageName);
  }

  const page = plannedEnterprisePages[pageName];
  if (!page) return null;

  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(page.title)} - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.09); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --green: #6ee7b7; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 20% 10%, rgba(215,168,75,.22), transparent 28rem), linear-gradient(135deg, #06100e, #10231d 48%, #050807); }
    a { color: inherit; text-decoration: none; }
    .shell { min-height: 100vh; display: grid; place-items: center; padding: 28px; }
    .card { width: min(940px, 100%); border: 1px solid var(--line); border-radius: 30px; background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); padding: clamp(24px, 5vw, 48px); box-shadow: 0 28px 100px rgba(0,0,0,.24); }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 10px 0 12px; font-size: clamp(40px, 7vw, 82px); letter-spacing: -.075em; line-height: .9; }
    .summary { color: var(--muted); font-size: 17px; line-height: 1.65; max-width: 760px; }
    .grid { margin-top: 28px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .feature { border: 1px solid rgba(237,229,204,.12); border-radius: 18px; padding: 14px; background: rgba(3,8,7,.26); color: #e7ddc2; }
    .actions { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { border: 1px solid var(--line); border-radius: 15px; padding: 12px 14px; background: rgba(237,229,204,.08); }
    .btn.primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .note { margin-top: 20px; color: var(--muted); font-size: 13px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main class="shell">
    <section class="card">
      <div class="kicker">${escapeHtml(page.kicker)}</div>
      <h1>${escapeHtml(page.title)}</h1>
      <p class="summary">${escapeHtml(page.summary)}</p>
      <div class="grid">
        ${page.features.map((feature) => `<div class="feature">${escapeHtml(feature)}</div>`).join('')}
      </div>
      <div class="actions">
        <a class="btn primary" href="${escapeHtml(page.primaryHref)}">${escapeHtml(page.primaryLabel)}</a>
        <a class="btn" href="/app/dashboard">dashboard</a>
        <a class="btn" href="/app/control">control</a>
        <a class="btn" href="/app/org">org + SSO</a>
      </div>
      <div class="note">Navigation baseline is live. This page is scheduled for API-backed enterprise features in Phase 6 of the build plan.</div>
    </section>
  </main>
</body>
</html>`, env, pageName);
}

export function renderEnterpriseControlPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(readEnterpriseAppPage('control.html'), env, 'control');
}

export function renderEnterpriseOrgPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(readEnterpriseAppPage('org.html'), env, 'org');
}
