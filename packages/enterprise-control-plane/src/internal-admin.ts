import type { EnterpriseControlPlaneEnv } from './config.js';
import { authenticateUser, type EnterpriseUserAuth } from './auth.js';
import { getSupabase } from './supabase.js';

const INTERNAL_AUTH_ERROR = 'VaultProof employee access required. Sign in with an approved employee account.';

type MaybeArray<T> = T | T[] | null | undefined;

interface InternalAdminAuthResult {
  auth: EnterpriseUserAuth;
  allowedEmails: string[];
  allowedDomains: string[];
}

function csvList(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeRows<T>(rows: MaybeArray<T>): T[] {
  if (!rows) return [];
  return Array.isArray(rows) ? rows : [rows];
}

function emailDomain(email: string): string {
  return email.trim().toLowerCase().split('@').pop() || '';
}

function isAllowedInternalAdminEmail(email: string, env: EnterpriseControlPlaneEnv): {
  ok: boolean;
  allowedEmails: string[];
  allowedDomains: string[];
} {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedEmails = csvList(env.internalAdminAllowedEmails);
  const allowedDomains = csvList(env.internalAdminAllowedDomains);
  const domain = emailDomain(normalizedEmail);

  return {
    ok: allowedEmails.includes(normalizedEmail) || (domain ? allowedDomains.includes(domain) : false),
    allowedEmails,
    allowedDomains,
  };
}

async function authorizeInternalAdmin(
  request: Request,
  env: EnterpriseControlPlaneEnv,
): Promise<InternalAdminAuthResult | Response> {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    return Response.json({ error: 'Internal admin API is not configured.' }, { status: 501 });
  }

  const auth = await authenticateUser(request, env);
  if (!auth) {
    return Response.json({ error: INTERNAL_AUTH_ERROR }, { status: 401 });
  }

  const allowed = isAllowedInternalAdminEmail(auth.email, env);
  if (!allowed.ok) {
    return Response.json({
      error: 'This account is not allowed to use the VaultProof internal admin console.',
    }, { status: 403 });
  }

  return {
    auth,
    allowedEmails: allowed.allowedEmails,
    allowedDomains: allowed.allowedDomains,
  };
}

async function getUserEmailMap(
  env: EnterpriseControlPlaneEnv,
  userIds: string[],
): Promise<Map<string, string | null>> {
  const supabase = getSupabase(env);
  const uniqueIds = [...new Set(userIds.filter(Boolean))].slice(0, 25);
  const results = await Promise.all(uniqueIds.map(async (userId) => {
    try {
      const { data, error } = await supabase.auth.admin.getUserById(userId);
      if (error) return [userId, null] as const;
      return [userId, data.user?.email || null] as const;
    } catch {
      return [userId, null] as const;
    }
  }));

  return new Map(results);
}

export function renderInternalAdminPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex,nofollow" />
  <title>VaultProof Internal Admin</title>
  <style>
    :root { color-scheme: dark; --bg:#070b10; --panel:rgba(235,241,255,.08); --panel-strong:rgba(235,241,255,.13); --line:rgba(235,241,255,.16); --text:#eef4ff; --muted:#a9b6c8; --gold:#d7a84b; --blue:#8ec5ff; --green:#72e3b5; --red:#fb7185; --ink:#07110f; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color:var(--text); background: radial-gradient(circle at 12% 10%, rgba(142,197,255,.22), transparent 28rem), radial-gradient(circle at 88% 0%, rgba(215,168,75,.16), transparent 30rem), linear-gradient(135deg, #060a10, #111827 52%, #050807); }
    a { color: inherit; text-decoration: none; }
    .shell { display:grid; grid-template-columns:280px 1fr; min-height:100vh; }
    .sidebar { border-right:1px solid var(--line); background:rgba(2,6,12,.72); padding:28px 20px; position:sticky; top:0; height:100vh; }
    .brand { display:flex; gap:12px; align-items:center; margin-bottom:28px; }
    .mark { width:38px; height:38px; border-radius:14px; display:grid; place-items:center; background:linear-gradient(135deg, var(--blue), #e9f5ff); color:#08111f; font-weight:900; }
    .brand-title { font-weight:850; letter-spacing:-.03em; }
    .brand-sub { color:var(--muted); font-size:12px; margin-top:2px; }
    .nav-label { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.12em; margin:22px 0 9px 10px; }
    .nav-link { display:flex; justify-content:space-between; padding:11px 12px; border-radius:14px; color:#dce8f9; border:1px solid transparent; margin-bottom:4px; }
    .nav-link:hover, .nav-link.active { background:var(--panel); border-color:var(--line); }
    .sidebar-note { margin-top:24px; border:1px solid var(--line); border-radius:18px; padding:14px; color:var(--muted); background:rgba(235,241,255,.06); font-size:12px; line-height:1.45; }
    .main { padding:30px; max-width:1400px; width:100%; }
    .topbar { display:flex; justify-content:space-between; gap:18px; align-items:flex-start; margin-bottom:22px; }
    .eyebrow { color:var(--blue); font-size:12px; font-weight:850; text-transform:uppercase; letter-spacing:.16em; }
    h1 { margin:8px 0 10px; font-size:clamp(38px, 5vw, 70px); line-height:.92; letter-spacing:-.07em; }
    .lead { color:var(--muted); max-width:780px; line-height:1.6; }
    button, select { border:1px solid var(--line); background:rgba(235,241,255,.08); color:var(--text); border-radius:13px; padding:11px 12px; font:inherit; }
    button { cursor:pointer; }
    .primary { background:linear-gradient(135deg, var(--blue), #e9f5ff); color:#08111f; border:0; font-weight:850; }
    .toolbar { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:10px; }
    .grid { display:grid; gap:16px; }
    .kpis { grid-template-columns:repeat(5, minmax(0,1fr)); margin-bottom:16px; }
    .two { grid-template-columns:minmax(0,1fr) minmax(360px,.8fr); }
    .card { border:1px solid var(--line); border-radius:24px; padding:20px; background:linear-gradient(180deg, var(--panel-strong), rgba(235,241,255,.05)); box-shadow:0 22px 90px rgba(0,0,0,.22); }
    .kpi-label { color:var(--muted); font-size:12px; text-transform:uppercase; letter-spacing:.1em; }
    .kpi-value { font-size:34px; font-weight:850; letter-spacing:-.05em; margin-top:8px; }
    .kpi-sub { color:var(--muted); font-size:13px; margin-top:6px; }
    .section-title { display:flex; justify-content:space-between; gap:12px; align-items:center; margin-bottom:14px; }
    .section-title h2 { margin:0; font-size:20px; letter-spacing:-.03em; }
    .mini { color:var(--muted); font-size:13px; }
    .list { display:grid; gap:10px; }
    .row { display:grid; grid-template-columns:1fr auto; gap:14px; align-items:start; border:1px solid rgba(235,241,255,.1); border-radius:17px; padding:14px; background:rgba(2,6,12,.3); }
    .row-title { font-weight:780; letter-spacing:-.02em; }
    .row-sub { color:var(--muted); font-size:13px; margin-top:5px; line-height:1.45; }
    .tag { display:inline-block; color:var(--blue); border:1px solid rgba(142,197,255,.24); border-radius:999px; padding:5px 8px; font-size:12px; margin:3px 4px 0 0; white-space:nowrap; }
    .tag.good { color:var(--green); border-color:rgba(114,227,181,.24); }
    .tag.warn { color:var(--gold); border-color:rgba(215,168,75,.28); }
    .tag.bad { color:var(--red); border-color:rgba(251,113,133,.28); }
    .notice, .empty { color:var(--muted); border:1px dashed rgba(235,241,255,.22); border-radius:18px; padding:18px; background:rgba(2,6,12,.24); }
    .notice.error { color:var(--red); border-color:rgba(251,113,133,.3); }
    .actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; }
    .action { border:1px solid var(--line); border-radius:14px; padding:10px 12px; background:rgba(235,241,255,.07); }
    @media (max-width: 1050px) { .shell { grid-template-columns:1fr; } .sidebar { position:relative; height:auto; } .topbar { flex-direction:column; } .toolbar { justify-content:flex-start; } .kpis, .two { grid-template-columns:1fr; } }
  </style>
</head>
<body>
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><div class="mark">VP</div><div><div class="brand-title">VaultProof Internal</div><div class="brand-sub">employee admin console</div></div></div>
      <div class="nav-label">manage</div>
      <a class="nav-link active" href="#businesses"><span>Businesses</span><span class="tag">read</span></a>
      <a class="nav-link" href="#users"><span>Users</span></a>
      <a class="nav-link" href="#sso"><span>SSO</span></a>
      <a class="nav-link" href="#support"><span>Support</span></a>
      <div class="nav-label">proof</div>
      <a class="nav-link" href="#runtime"><span>Runtime</span></a>
      <a class="nav-link" href="#audit"><span>Audit</span></a>
      <div class="sidebar-note"><strong>Safe first slice</strong><br />This console is read-only until internal admin audit tables, approval gates, and break-glass rules are in place.</div>
    </aside>
    <main class="main">
      <div class="topbar">
        <div>
          <div class="eyebrow">VaultProof employees only</div>
          <h1>Manage businesses safely.</h1>
          <p class="lead">See customer organizations, owners, users, projects, SSO rollout, readiness, and support signals without entering the customer-facing dashboard.</p>
        </div>
        <div class="toolbar">
          <button id="refreshBtn" class="primary" type="button">refresh</button>
          <a class="action" href="/app/login?internal_admin=true">employee sign in</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      <section class="grid kpis" id="runtime">
        <div class="card"><div class="kpi-label">businesses</div><div id="kpiBusinesses" class="kpi-value">...</div><div class="kpi-sub">active team orgs</div></div>
        <div class="card"><div class="kpi-label">users</div><div id="kpiUsers" class="kpi-value">...</div><div class="kpi-sub">org memberships</div></div>
        <div class="card"><div class="kpi-label">projects</div><div id="kpiProjects" class="kpi-value">...</div><div class="kpi-sub">active customer scopes</div></div>
        <div class="card"><div class="kpi-label">pending invites</div><div id="kpiInvites" class="kpi-value">...</div><div class="kpi-sub">need follow-up</div></div>
        <div class="card"><div class="kpi-label">SSO configured</div><div id="kpiSso" class="kpi-value">...</div><div class="kpi-sub">team orgs</div></div>
      </section>

      <section class="grid two">
        <div class="card" id="businesses">
          <div class="section-title"><h2>Businesses</h2><span id="businessMeta" class="mini"></span></div>
          <div id="businessList" class="list"><div class="empty">Loading businesses...</div></div>
        </div>
        <div class="card" id="support">
          <div class="section-title"><h2>Support queue</h2><span class="mini">safe triage</span></div>
          <div id="supportList" class="list"><div class="empty">Loading support signals...</div></div>
        </div>
      </section>

      <section class="grid two" style="margin-top:16px">
        <div class="card" id="users">
          <div class="section-title"><h2>Users and access</h2><span id="userMeta" class="mini"></span></div>
          <div id="userList" class="list"><div class="empty">Loading users...</div></div>
        </div>
        <div class="card" id="sso">
          <div class="section-title"><h2>SSO rollout</h2><span id="ssoMeta" class="mini"></span></div>
          <div id="ssoList" class="list"><div class="empty">Loading SSO status...</div></div>
        </div>
      </section>

      <section class="card" id="audit" style="margin-top:16px">
        <div class="section-title"><h2>Recent customer audit</h2><span class="mini">latest governance/runtime signals</span></div>
        <div id="auditList" class="list"><div class="empty">Loading audit...</div></div>
      </section>
    </main>
  </div>
  <script>
    (function() {
      var token = localStorage.getItem('vaultproof_token') || '';
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
      function notice(message) {
        var el = byId('notice');
        if (!el) return;
        el.style.display = message ? 'block' : 'none';
        el.innerHTML = message ? escapeHtml(message) + ' <a href="/app/login?internal_admin=true">Employee sign in</a>' : '';
      }
      async function fetchOverview() {
        var response = await fetch('/api/v1/internal-admin/overview', {
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json'
          }
        });
        var payload = await response.json().catch(function() { return null; });
        if (!response.ok) throw new Error((payload && payload.error) || 'Internal admin overview failed.');
        return payload;
      }
      function row(title, sub, tag, tone) {
        return '<div class="row"><div><div class="row-title">' + escapeHtml(title) + '</div><div class="row-sub">' + escapeHtml(sub || '') + '</div></div><span class="tag ' + (tone || '') + '">' + escapeHtml(tag || '') + '</span></div>';
      }
      function render(payload) {
        var summary = payload.summary || {};
        text('kpiBusinesses', number(summary.active_business_count));
        text('kpiUsers', number(summary.membership_count));
        text('kpiProjects', number(summary.active_project_count));
        text('kpiInvites', number(summary.pending_invitation_count));
        text('kpiSso', number(summary.sso_configured_count));
        text('businessMeta', number((payload.businesses || []).length) + ' businesses visible');
        text('userMeta', number(summary.admin_membership_count) + ' admins/owners');
        text('ssoMeta', number(summary.sso_configured_count) + ' configured');

        var businesses = Array.isArray(payload.businesses) ? payload.businesses : [];
        byId('businessList').innerHTML = businesses.length ? businesses.map(function(biz) {
          var sso = biz.sso || {};
          var sub = (biz.owner_email || 'owner unknown') + ' - ' + number(biz.member_count) + ' users - ' + number(biz.active_project_count) + ' projects - created ' + rel(biz.created_at);
          return row(biz.name || biz.slug || biz.id, sub, sso.status === 'configured' ? 'SSO ready' : 'SSO todo', sso.status === 'configured' ? 'good' : 'warn');
        }).join('') : '<div class="empty">No businesses found.</div>';

        var supportRows = businesses.filter(function(biz) {
          return biz.pending_invitation_count || !(biz.sso && biz.sso.status === 'configured') || biz.archived_at;
        });
        byId('supportList').innerHTML = supportRows.length ? supportRows.map(function(biz) {
          var reason = biz.archived_at ? 'archived customer' : biz.pending_invitation_count ? biz.pending_invitation_count + ' pending invites' : 'SSO not configured';
          return row(biz.name || biz.id, reason, biz.archived_at ? 'archived' : 'follow up', biz.archived_at ? 'bad' : 'warn');
        }).join('') : '<div class="empty">No support follow-ups from this snapshot.</div>';

        var users = Array.isArray(payload.users) ? payload.users : [];
        byId('userList').innerHTML = users.length ? users.slice(0, 12).map(function(user) {
          var sub = (user.email || user.user_id) + ' - ' + (user.organization_name || 'organization') + ' - joined ' + rel(user.created_at);
          var privileged = user.role === 'owner' || user.role === 'admin';
          return row(user.role, sub, privileged ? 'privileged' : 'standard', privileged ? 'warn' : 'good');
        }).join('') : '<div class="empty">No users found.</div>';

        var ssoRows = businesses.filter(function(biz) { return biz.sso; });
        byId('ssoList').innerHTML = ssoRows.length ? ssoRows.map(function(biz) {
          var sso = biz.sso || {};
          return row(biz.name || biz.id, (sso.company_domain || 'domain not set') + ' - ' + (sso.sso_provider || 'provider pending') + ' - ' + (sso.login_mode || 'mode pending'), sso.status || 'not started', sso.status === 'configured' ? 'good' : 'warn');
        }).join('') : '<div class="empty">No SSO settings found yet.</div>';

        var audit = Array.isArray(payload.recent_audit) ? payload.recent_audit : [];
        byId('auditList').innerHTML = audit.length ? audit.map(function(event) {
          return row(event.event_type || 'audit event', (event.organization_name || event.organization_id || 'unknown org') + ' - ' + (event.actor_email || 'system') + ' - ' + rel(event.created_at), event.target_type || 'audit', '');
        }).join('') : '<div class="empty">No recent audit events.</div>';
      }
      async function load() {
        if (!token) {
          notice('No employee session found.');
          return;
        }
        notice('');
        try {
          render(await fetchOverview());
        } catch (error) {
          notice(error && error.message ? error.message : 'Internal admin failed to load.');
        }
      }
      var refreshBtn = byId('refreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', load);
      load();
    })();
  </script>
</body>
</html>`;
}

export async function handleInternalAdminRoutes(
  request: Request,
  env: EnterpriseControlPlaneEnv,
  pathSegments: string[],
): Promise<Response | null> {
  if (request.method !== 'GET' || pathSegments.length !== 1 || pathSegments[0] !== 'overview') {
    return null;
  }

  const authorized = await authorizeInternalAdmin(request, env);
  if (authorized instanceof Response) return authorized;

  const supabase = getSupabase(env);
  const [
    orgResult,
    memberResult,
    projectResult,
    inviteResult,
    ssoResult,
    auditResult,
  ] = await Promise.all([
    supabase
      .from('organizations')
      .select('id, name, slug, kind, owner_user_id, created_at, updated_at, archived_at')
      .eq('kind', 'team')
      .order('created_at', { ascending: false })
      .limit(75),
    supabase
      .from('organization_members')
      .select('organization_id, user_id, role, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('projects')
      .select('id, organization_id, vp_proj_id, name, revoked_at, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_invitations')
      .select('id, organization_id, email, role, status, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_sso_settings')
      .select('organization_id, company_domain, sso_provider, login_mode, status, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000),
    supabase
      .from('organization_audit_events')
      .select('id, organization_id, actor_email, event_type, target_type, target_id, description, created_at')
      .order('created_at', { ascending: false })
      .limit(12),
  ]);

  const firstError = orgResult.error || memberResult.error || projectResult.error || inviteResult.error || ssoResult.error || auditResult.error;
  if (firstError) {
    return Response.json({ error: `Internal admin query failed: ${firstError.message}` }, { status: 500 });
  }

  const organizations = normalizeRows(orgResult.data as MaybeArray<{
    id: string;
    name: string | null;
    slug: string | null;
    kind: string;
    owner_user_id: string | null;
    created_at: string;
    updated_at: string | null;
    archived_at: string | null;
  }>);
  const members = normalizeRows(memberResult.data as MaybeArray<{
    organization_id: string;
    user_id: string;
    role: string;
    created_at: string;
  }>);
  const projects = normalizeRows(projectResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    vp_proj_id: string;
    name: string | null;
    revoked_at: string | null;
    created_at: string;
  }>);
  const invitations = normalizeRows(inviteResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    email: string;
    role: string;
    status: string;
    created_at: string;
  }>);
  const ssoRows = normalizeRows(ssoResult.data as MaybeArray<{
    organization_id: string;
    company_domain: string | null;
    sso_provider: string | null;
    login_mode: string | null;
    status: string | null;
    updated_at: string | null;
  }>);
  const auditRows = normalizeRows(auditResult.data as MaybeArray<{
    id: string;
    organization_id: string | null;
    actor_email: string | null;
    event_type: string;
    target_type: string | null;
    target_id: string | null;
    description: string | null;
    created_at: string;
  }>);

  const ownerEmailMap = await getUserEmailMap(env, organizations.map((organization) => organization.owner_user_id || ''));
  const memberEmailMap = await getUserEmailMap(env, members.map((member) => member.user_id));
  const orgById = new Map(organizations.map((organization) => [organization.id, organization]));
  const ssoByOrgId = new Map(ssoRows.map((row) => [row.organization_id, row]));
  const membersByOrg = new Map<string, typeof members>();
  const projectsByOrg = new Map<string, typeof projects>();
  const invitationsByOrg = new Map<string, typeof invitations>();

  for (const member of members) {
    const rows = membersByOrg.get(member.organization_id) || [];
    rows.push(member);
    membersByOrg.set(member.organization_id, rows);
  }
  for (const project of projects) {
    if (!project.organization_id) continue;
    const rows = projectsByOrg.get(project.organization_id) || [];
    rows.push(project);
    projectsByOrg.set(project.organization_id, rows);
  }
  for (const invitation of invitations) {
    if (!invitation.organization_id) continue;
    const rows = invitationsByOrg.get(invitation.organization_id) || [];
    rows.push(invitation);
    invitationsByOrg.set(invitation.organization_id, rows);
  }

  const activeBusinesses = organizations.filter((organization) => !organization.archived_at);
  const activeProjects = projects.filter((project) => !project.revoked_at);
  const pendingInvitations = invitations.filter((invitation) => invitation.status === 'pending');
  const configuredSso = ssoRows.filter((row) => row.status === 'configured');
  const adminMemberships = members.filter((member) => member.role === 'owner' || member.role === 'admin');

  const businesses = organizations.map((organization) => {
    const orgMembers = membersByOrg.get(organization.id) || [];
    const orgProjects = projectsByOrg.get(organization.id) || [];
    const orgInvitations = invitationsByOrg.get(organization.id) || [];
    const activeOrgProjects = orgProjects.filter((project) => !project.revoked_at);
    const pendingOrgInvitations = orgInvitations.filter((invitation) => invitation.status === 'pending');
    const sso = ssoByOrgId.get(organization.id) || null;
    return {
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      owner_user_id: organization.owner_user_id,
      owner_email: organization.owner_user_id ? ownerEmailMap.get(organization.owner_user_id) || null : null,
      created_at: organization.created_at,
      updated_at: organization.updated_at,
      archived_at: organization.archived_at,
      member_count: orgMembers.length,
      admin_count: orgMembers.filter((member) => member.role === 'owner' || member.role === 'admin').length,
      active_project_count: activeOrgProjects.length,
      pending_invitation_count: pendingOrgInvitations.length,
      sso,
    };
  });

  return Response.json({
    generated_at: new Date().toISOString(),
    mode: 'read_only',
    admin_actions_enabled: false,
    admin: {
      user_id: authorized.auth.userId,
      email: authorized.auth.email,
      allowlist: {
        emails_configured: authorized.allowedEmails.length,
        domains_configured: authorized.allowedDomains.length,
      },
    },
    summary: {
      business_count: organizations.length,
      active_business_count: activeBusinesses.length,
      membership_count: members.length,
      admin_membership_count: adminMemberships.length,
      active_project_count: activeProjects.length,
      pending_invitation_count: pendingInvitations.length,
      sso_configured_count: configuredSso.length,
    },
    businesses,
    users: members.slice(0, 100).map((member) => {
      const organization = orgById.get(member.organization_id);
      return {
        organization_id: member.organization_id,
        organization_name: organization?.name || null,
        user_id: member.user_id,
        email: memberEmailMap.get(member.user_id) || null,
        role: member.role,
        created_at: member.created_at,
      };
    }),
    recent_audit: auditRows.map((event) => ({
      ...event,
      organization_name: event.organization_id ? orgById.get(event.organization_id)?.name || null : null,
    })),
    guardrails: [
      'Browser never receives Supabase service-role credentials.',
      'Employee access requires an explicit email/domain allowlist.',
      'This first slice is read-only until internal admin audit and approval gates are added.',
    ],
  }, {
    headers: {
      'cache-control': 'no-store',
    },
  });
}
