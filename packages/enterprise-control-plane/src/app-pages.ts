import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_SITE_ORIGIN = 'https://vaultproof.dev';

function rewriteStaticAssetUrls(html: string): string {
  return html
    .replaceAll('src="/js/', `src="${PUBLIC_SITE_ORIGIN}/js/`)
    .replaceAll('href="/css/', `href="${PUBLIC_SITE_ORIGIN}/css/`)
    .replaceAll('href="/favicon.png"', `href="${PUBLIC_SITE_ORIGIN}/favicon.png"`)
    .replaceAll('href="/terms"', `href="${PUBLIC_SITE_ORIGIN}/terms"`)
    .replaceAll('href="/privacy"', `href="${PUBLIC_SITE_ORIGIN}/privacy"`);
}

function readEnterpriseAppPage(filename: string): string {
  const html = readFileSync(join(process.cwd(), 'apps/site/app', filename), 'utf8');
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
        if (!res.ok) throw new Error((payload && payload.error) || ('Request failed: ' + res.status));
        return payload && payload.data ? payload.data : payload;
      }
      async function apiJson(path, options) {
        var opts = options || {};
        opts.headers = Object.assign(headers(), opts.headers || {});
        var res = await fetch(path, opts);
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error((payload && payload.error) || ('Request failed: ' + res.status));
        return payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
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
        if (!res.ok) throw new Error((payload && payload.error) || ('Request failed: ' + res.status));
        return payload && payload.data ? payload.data : payload;
      }
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderEnterprisePlannedAppPage(pageName: string): string | null {
  if (pageName === 'members') return renderEnterpriseMembersPage();
  if (pageName === 'audit') return renderEnterpriseAuditPage();

  const page = plannedEnterprisePages[pageName];
  if (!page) return null;

  return `<!doctype html>
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
</html>`;
}

export function renderEnterpriseControlPage(): string {
  return readEnterpriseAppPage('control.html');
}

export function renderEnterpriseOrgPage(): string {
  return readEnterpriseAppPage('org.html');
}
