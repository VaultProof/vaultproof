export type EnterpriseAppNavPage =
  | 'dashboard'
  | 'projects'
  | 'activity'
  | 'alerts'
  | 'control'
  | 'verifier'
  | 'org'
  | 'members'
  | 'audit'
  | 'keys'
  | 'setup'
  | 'technical-guide'
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
        ${enterpriseAppNavLink(activePage, 'verifier', '/app/verifier', 'AI Proof Verifier', activePage === 'verifier' ? 'beta' : '')}
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
        ${enterpriseAppNavLink(activePage, 'setup', '/app/setup', 'Setup guide', activePage === 'setup' ? 'start' : '')}
        ${enterpriseAppNavLink(activePage, 'technical-guide', '/app/technical-guide', 'Technical guide')}
        ${enterpriseAppNavLink(activePage, 'settings', '/app/settings', 'Settings')}
        ${enterpriseAppNavLink(activePage, 'plans', '/app/plans', 'Plans')}
        ${enterpriseAppNavLink(activePage, 'scanner', '/app/scanner', 'Scanner')}
        ${enterpriseAppNavLink(activePage, 'runbooks', '/app/runbooks', 'Runbooks')}
        <a class="nav-link signout-link" href="/app/logout"><span>Sign out</span></a>
      </div>
      <div class="sidebar-card">
        <strong>Setup order</strong>
        Connect the org, invite the right people, configure projects, confirm readiness, then monitor daily use.
      </div>
      <button id="enterpriseThemeToggle" class="theme-toggle" type="button" aria-label="Switch to light mode" aria-pressed="false">
        <span class="theme-dot" aria-hidden="true"></span>
        <span id="enterpriseThemeToggleLabel">Dark mode</span>
      </button>
      ${ENTERPRISE_THEME_BOOT_SCRIPT}
    </aside>`;
}

export const ENTERPRISE_THEME_BOOT_SCRIPT = `<script>
    (function() {
      var key = 'vaultproof_enterprise_theme';
      function getStoredTheme() {
        try {
          var value = window.localStorage.getItem(key);
          return value === 'light' || value === 'dark' ? value : 'dark';
        } catch (error) {
          return 'dark';
        }
      }
      function setStoredTheme(theme) {
        try { window.localStorage.setItem(key, theme); } catch (error) {}
      }
      function updateToggle(theme) {
        var button = document.getElementById('enterpriseThemeToggle');
        var label = document.getElementById('enterpriseThemeToggleLabel');
        if (!button || !label) return;
        var isLight = theme === 'light';
        button.setAttribute('aria-pressed', isLight ? 'true' : 'false');
        button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
        label.textContent = isLight ? 'Light mode' : 'Dark mode';
      }
      function applyTheme(theme) {
        document.documentElement.setAttribute('data-enterprise-theme', theme);
        document.documentElement.style.colorScheme = theme;
        updateToggle(theme);
      }
      var initialTheme = getStoredTheme();
      applyTheme(initialTheme);
      window.__vaultproofApplyEnterpriseTheme = applyTheme;
      document.addEventListener('DOMContentLoaded', function() {
        applyTheme(getStoredTheme());
        var button = document.getElementById('enterpriseThemeToggle');
        if (!button) return;
        button.addEventListener('click', function() {
          var current = document.documentElement.getAttribute('data-enterprise-theme') || getStoredTheme();
          var next = current === 'light' ? 'dark' : 'light';
          setStoredTheme(next);
          applyTheme(next);
        });
      });
    })();
  </script>`;

export const ENTERPRISE_APP_SHELL_THEME = `
    /* enterprise-universal-sidebar */
    :root,
    html[data-enterprise-theme="dark"] {
      color-scheme: dark;
      --bg: #07110f;
      --bg-mid: rgba(237, 229, 204, 0.08);
      --bg-card: rgba(237, 229, 204, 0.08);
      --panel: rgba(237, 229, 204, 0.09);
      --panel-strong: rgba(237, 229, 204, 0.14);
      --card-bg: linear-gradient(180deg, rgba(237, 229, 204, 0.13), rgba(237, 229, 204, 0.055));
      --row-bg: rgba(3, 8, 7, 0.28);
      --sidebar-bg: rgba(3, 8, 7, 0.66);
      --sidebar-card-bg: linear-gradient(180deg, rgba(237, 229, 204, 0.1), rgba(3, 8, 7, 0.24));
      --control-bg: rgba(237, 229, 204, 0.08);
      --page-bg:
        radial-gradient(circle at 15% 10%, rgba(215, 168, 75, 0.24), transparent 32rem),
        radial-gradient(circle at 85% 0%, rgba(110, 231, 183, 0.16), transparent 28rem),
        linear-gradient(135deg, #06100e 0%, #10231d 45%, #050807 100%);
      --line: rgba(237, 229, 204, 0.16);
      --line-soft: rgba(237, 229, 204, 0.1);
      --rule: 1px solid rgba(237, 229, 204, 0.16);
      --hair: 1px solid rgba(237, 229, 204, 0.1);
      --text: #f4ecd5;
      --text-muted: #a9b7a6;
      --text-faint: #8f9b8b;
      --muted: #a9b7a6;
      --nav-text: #d8dfcf;
      --action-text: #e8ddbf;
      --gold: #d7a84b;
      --green: #6ee7b7;
      --red: #fb7185;
      --blue: #93c5fd;
      --ok: #6ee7b7;
      --warn: #d7a84b;
      --danger: #fb7185;
      --ink: #07110f;
      --option-bg: #ffffff;
      --option-text: #111827;
      --shadow: 0 22px 90px rgba(0, 0, 0, 0.2);
    }
    html[data-enterprise-theme="light"] {
      color-scheme: light;
      --bg: #f5efe3;
      --bg-mid: rgba(95, 73, 40, 0.07);
      --bg-card: rgba(255, 252, 246, 0.82);
      --panel: rgba(255, 252, 246, 0.72);
      --panel-strong: rgba(255, 252, 246, 0.92);
      --card-bg: linear-gradient(180deg, rgba(255, 252, 246, 0.96), rgba(239, 230, 214, 0.74));
      --row-bg: rgba(255, 252, 246, 0.78);
      --sidebar-bg: rgba(255, 250, 240, 0.88);
      --sidebar-card-bg: linear-gradient(180deg, rgba(255, 252, 246, 0.95), rgba(236, 225, 205, 0.72));
      --control-bg: rgba(255, 252, 246, 0.78);
      --page-bg:
        radial-gradient(circle at 16% 8%, rgba(189, 131, 46, 0.16), transparent 31rem),
        radial-gradient(circle at 86% 0%, rgba(22, 101, 72, 0.11), transparent 29rem),
        linear-gradient(135deg, #f8f2e8 0%, #eee4d2 48%, #fbf7ee 100%);
      --line: rgba(60, 48, 31, 0.18);
      --line-soft: rgba(60, 48, 31, 0.1);
      --rule: 1px solid rgba(60, 48, 31, 0.18);
      --hair: 1px solid rgba(60, 48, 31, 0.1);
      --text: #17130d;
      --text-muted: #4f594a;
      --text-faint: #6f7568;
      --muted: #4f594a;
      --nav-text: #2f352d;
      --action-text: #2f2617;
      --gold: #8a5a00;
      --green: #047857;
      --red: #b91c1c;
      --blue: #1d4ed8;
      --ok: #047857;
      --warn: #8a5a00;
      --danger: #b91c1c;
      --ink: #fff8ea;
      --option-bg: #fffaf0;
      --option-text: #17130d;
      --shadow: 0 20px 70px rgba(72, 56, 31, 0.13);
    }
    html[data-enterprise-theme] body {
      background: var(--page-bg) !important;
      color: var(--text) !important;
    }
    html[data-enterprise-theme] a,
    html[data-enterprise-theme] .row-title,
    html[data-enterprise-theme] .list-title,
    html[data-enterprise-theme] .resource-title,
    html[data-enterprise-theme] .member-email,
    html[data-enterprise-theme] .policy-title,
    html[data-enterprise-theme] .exec-title,
    html[data-enterprise-theme] .banner-title,
    html[data-enterprise-theme] h1,
    html[data-enterprise-theme] h2,
    html[data-enterprise-theme] h3 {
      color: var(--text);
    }
    html[data-enterprise-theme] .lead,
    html[data-enterprise-theme] .mini,
    html[data-enterprise-theme] .row-sub,
    html[data-enterprise-theme] .kpi-sub,
    html[data-enterprise-theme] .page-desc,
    html[data-enterprise-theme] .page-meta,
    html[data-enterprise-theme] .list-sub,
    html[data-enterprise-theme] .resource-copy,
    html[data-enterprise-theme] .banner-copy,
    html[data-enterprise-theme] .banner-note,
    html[data-enterprise-theme] .form-copy,
    html[data-enterprise-theme] .callout,
    html[data-enterprise-theme] .business-card p,
    html[data-enterprise-theme] .intent-card p,
    html[data-enterprise-theme] .action-card p,
    html[data-enterprise-theme] .feature-card p,
    html[data-enterprise-theme] .role-card p {
      color: var(--muted) !important;
    }
    html[data-enterprise-theme] select,
    html[data-enterprise-theme] button,
    html[data-enterprise-theme] input,
    html[data-enterprise-theme] textarea {
      background: var(--control-bg);
      color: var(--text);
      border-color: var(--line);
    }
    html[data-enterprise-theme] option {
      background: var(--option-bg);
      color: var(--option-text);
    }
    html[data-enterprise-theme] .card,
    html[data-enterprise-theme] .panel,
    html[data-enterprise-theme] .kpi-grid,
    html[data-enterprise-theme] .banner,
    html[data-enterprise-theme] .invite-panel,
    html[data-enterprise-theme] .action-strip,
    html[data-enterprise-theme] .member-card,
    html[data-enterprise-theme] .policy-card,
    html[data-enterprise-theme] .policy-provider-card,
    html[data-enterprise-theme] .exec-card,
    html[data-enterprise-theme] .resource-card,
    html[data-enterprise-theme] .checklist-box,
    html[data-enterprise-theme] .callout {
      background: var(--card-bg) !important;
      border-color: var(--line) !important;
      box-shadow: var(--shadow) !important;
      color: var(--text) !important;
    }
    html[data-enterprise-theme] .row,
    html[data-enterprise-theme] .list-row,
    html[data-enterprise-theme] .invite-row,
    html[data-enterprise-theme] .intent-card,
    html[data-enterprise-theme] .action-card,
    html[data-enterprise-theme] .feature-card,
    html[data-enterprise-theme] .role-card,
    html[data-enterprise-theme] .tabbar {
      background: var(--row-bg) !important;
      border-color: var(--line-soft) !important;
      color: var(--text) !important;
    }
    html[data-enterprise-theme] .empty,
    html[data-enterprise-theme] .notice,
    html[data-enterprise-theme] .error {
      background: var(--row-bg) !important;
      border-color: var(--line) !important;
      color: var(--muted) !important;
    }
    html[data-enterprise-theme] .action,
    html[data-enterprise-theme] .tab-button {
      color: var(--action-text) !important;
    }
    html[data-enterprise-theme] .primary,
    html[data-enterprise-theme] .tab-button.active,
    html[data-enterprise-theme] .action.primary {
      color: var(--ink) !important;
    }
    .shell, .layout { display: grid; grid-template-columns: 280px minmax(0, 1fr); min-height: 100vh; }
    .sidebar.enterprise-app-sidebar {
      display: flex;
      flex-direction: column;
      border-right: 1px solid var(--line);
      background: var(--sidebar-bg);
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
      color: var(--nav-text);
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
    .sidebar.enterprise-app-sidebar .signout-link {
      color: var(--red, #fb7185);
    }
    .sidebar.enterprise-app-sidebar .signout-link:hover {
      background: rgba(251, 113, 133, 0.1);
      border-color: rgba(251, 113, 133, 0.28);
      color: var(--red, #fb7185);
    }
    .sidebar.enterprise-app-sidebar .nav-pill {
      font-size: 10px;
      color: var(--green);
      border: 1px solid rgba(110, 231, 183, 0.24);
      border-radius: 999px;
      padding: 2px 7px;
    }
    .sidebar.enterprise-app-sidebar .sidebar-card {
      border: 1px solid var(--line-soft);
      border-radius: 18px;
      padding: 14px;
      background: var(--sidebar-card-bg);
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
    .sidebar.enterprise-app-sidebar .theme-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      margin-top: 14px;
      border-radius: 999px;
      padding: 10px 12px;
      border: 1px solid var(--line);
      background: var(--control-bg);
      color: var(--text);
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 750;
    }
    .sidebar.enterprise-app-sidebar .theme-toggle:hover {
      border-color: rgba(215, 168, 75, 0.45);
    }
    .sidebar.enterprise-app-sidebar .theme-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--gold);
      box-shadow: 0 0 0 4px rgba(215, 168, 75, 0.14);
    }
    @media (max-width: 980px) {
      .shell, .layout { grid-template-columns: 1fr; }
      .sidebar.enterprise-app-sidebar {
        position: relative;
        height: auto;
      }
    }
`;
