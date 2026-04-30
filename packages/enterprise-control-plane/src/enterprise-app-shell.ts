export type EnterpriseAppNavPage =
  | 'dashboard'
  | 'projects'
  | 'activity'
  | 'alerts'
  | 'control'
  | 'org'
  | 'members'
  | 'audit'
  | 'keys'
  | 'settings'
  | 'plans'
  | 'scanner'
  | 'runbooks';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function enterpriseAppNavLink(activePage: EnterpriseAppNavPage, page: EnterpriseAppNavPage, href: string, label: string, pill = ''): string {
  const active = activePage === page;
  return `<a class="nav-link${active ? ' active' : ''}" href="${href}"${active ? ' aria-current="page"' : ''}><span>${label}</span>${pill ? `<span class="nav-pill">${pill}</span>` : ''}</a>`;
}

export function renderEnterpriseAppSidebar(activePage: EnterpriseAppNavPage, subtitle = 'Azure confidential dashboard'): string {
  return `<aside class="sidebar enterprise-app-sidebar" data-enterprise-sidebar="universal">
      <div class="brand">
        <div class="mark">VP</div>
        <div>
          <div class="brand-title">VaultProof Enterprise</div>
          <div class="brand-sub">${escapeHtml(subtitle)}</div>
        </div>
      </div>
      <div class="nav-group">
        <div class="nav-label">workspace</div>
        ${enterpriseAppNavLink(activePage, 'dashboard', '/app/dashboard', 'Dashboard', activePage === 'dashboard' ? 'new' : '')}
        ${enterpriseAppNavLink(activePage, 'projects', '/app/projects', 'Projects')}
        ${enterpriseAppNavLink(activePage, 'activity', '/app/activity', 'Activity')}
        ${enterpriseAppNavLink(activePage, 'alerts', '/app/alerts', 'Alerts')}
        ${enterpriseAppNavLink(activePage, 'control', '/app/control', 'Control')}
        ${enterpriseAppNavLink(activePage, 'org', '/app/org', 'Org + SSO')}
      </div>
      <div class="nav-group">
        <div class="nav-label">evidence</div>
        ${enterpriseAppNavLink(activePage, 'members', '/app/members', 'Members')}
        ${enterpriseAppNavLink(activePage, 'audit', '/app/audit', 'Audit')}
        ${enterpriseAppNavLink(activePage, 'keys', '/app/keys', 'Provider slots')}
        <a class="nav-link" id="auditExportLink" href="/api/v1/enterprise/audit?format=csv&days=30"><span>Audit CSV</span></a>
        <a class="nav-link" id="accessReviewLink" href="/api/v1/enterprise/members/access-review?format=csv"><span>Access review CSV</span></a>
      </div>
      <div class="nav-group">
        <div class="nav-label">setup</div>
        ${enterpriseAppNavLink(activePage, 'settings', '/app/settings', 'Settings')}
        ${enterpriseAppNavLink(activePage, 'plans', '/app/plans', 'Plans')}
        ${enterpriseAppNavLink(activePage, 'scanner', '/app/scanner', 'Scanner')}
        ${enterpriseAppNavLink(activePage, 'runbooks', '/app/runbooks', 'Runbooks')}
      </div>
      <div class="sidebar-card">
        <strong>Setup order</strong>
        Connect the org, invite the right people, configure projects, confirm readiness, then monitor daily use.
      </div>
    </aside>`;
}

export const ENTERPRISE_APP_SHELL_THEME = `
    /* enterprise-universal-sidebar */
    .shell, .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
    .sidebar.enterprise-app-sidebar {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--line);
      background: rgba(3, 8, 7, 0.66);
      backdrop-filter: blur(18px);
      padding: 28px 20px;
      position: sticky;
      top: 0;
      height: 100vh;
      align-self: start;
      overflow-y: auto;
    }
    .sidebar.enterprise-app-sidebar .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 30px;
    }
    .sidebar.enterprise-app-sidebar .mark {
      width: 38px;
      height: 38px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      color: var(--ink);
      font-weight: 900;
      background: linear-gradient(135deg, var(--gold), #f3df95);
      box-shadow: 0 18px 60px rgba(215, 168, 75, 0.18);
      flex: 0 0 auto;
    }
    .sidebar.enterprise-app-sidebar .brand-title {
      font-weight: 850;
      letter-spacing: -0.03em;
      color: var(--text);
    }
    .sidebar.enterprise-app-sidebar .brand-sub {
      color: var(--muted);
      font-size: 12px;
      margin-top: 2px;
      font-weight: 500;
    }
    .sidebar.enterprise-app-sidebar .nav-group { margin: 24px 0; }
    .sidebar.enterprise-app-sidebar .nav-label {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      margin: 0 0 9px 10px;
    }
    .sidebar.enterprise-app-sidebar .nav-link {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 11px 12px;
      border-radius: 14px;
      color: #d8dfcf;
      margin-bottom: 4px;
      border: 1px solid transparent;
      text-decoration: none;
    }
    .sidebar.enterprise-app-sidebar .nav-link:hover,
    .sidebar.enterprise-app-sidebar .nav-link.active {
      background: var(--panel, rgba(237, 229, 204, 0.08));
      border-color: var(--line);
      color: var(--text);
    }
    .sidebar.enterprise-app-sidebar .nav-pill {
      font-size: 10px;
      color: var(--green);
      border: 1px solid rgba(110, 231, 183, 0.24);
      border-radius: 999px;
      padding: 2px 7px;
    }
    .sidebar.enterprise-app-sidebar .sidebar-card {
      border: 1px solid rgba(237, 229, 204, 0.12);
      border-radius: 18px;
      padding: 14px;
      background: linear-gradient(180deg, rgba(237, 229, 204, 0.1), rgba(3, 8, 7, 0.24));
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      margin-top: auto;
    }
    .sidebar.enterprise-app-sidebar .sidebar-card strong {
      display: block;
      color: var(--text);
      font-size: 13px;
      margin-bottom: 4px;
    }
    @media (max-width: 980px) {
      .shell, .layout { grid-template-columns: 1fr; }
      .sidebar.enterprise-app-sidebar {
        position: relative;
        height: auto;
      }
    }
`;
