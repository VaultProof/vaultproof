export type EnterpriseAppNavPage =
  | 'dashboard'
  | 'launch'
  | 'evidence'
  | 'projects'
  | 'inbox'
  | 'inventory'
  | 'policy'
  | 'rollout'
  | 'readiness'
  | 'health'
  | 'activity'
  | 'alerts'
  | 'control'
  | 'verifier'
  | 'org'
  | 'members'
  | 'audit'
  | 'keys'
  | 'docs'
  | 'setup'
  | 'demo'
  | 'technical-guide'
  | 'security-review'
  | 'settings'
  | 'entitlements'
  | 'onboarding'
  | 'plans'
  | 'pilot'
  | 'pilot-success'
  | 'testers'
  | 'release'
  | 'scanner'
  | 'support'
  | 'runbooks';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

interface EnterpriseSidebarNavItem {
  readonly page?: EnterpriseAppNavPage;
  readonly href: string;
  readonly label: string;
  readonly id?: string;
  readonly pill?: string;
  readonly activePill?: string;
  readonly className?: string;
  readonly external?: boolean;
  readonly children?: readonly EnterpriseSidebarNavItem[];
}

interface EnterpriseSidebarNavGroup {
  readonly label: string;
  readonly items: readonly EnterpriseSidebarNavItem[];
}

const ENTERPRISE_SIDEBAR_NAV_GROUPS: readonly EnterpriseSidebarNavGroup[] = [
  {
    label: 'workspace',
    items: [
      {
        page: 'dashboard',
        href: '/app/dashboard',
        label: 'Dashboard',
        activePill: 'new',
      },
      {
        page: 'keys',
        href: '/app/keys',
        label: 'Provider slots',
        children: [
          {
            page: 'keys',
            href: '/app/keys',
            label: 'Key inventory',
          },
          {
            page: 'scanner',
            href: '/app/scanner',
            label: 'Scanner',
            activePill: 'new',
          },
          {
            page: 'inventory',
            href: '/app/inventory',
            label: 'API Inventory',
            activePill: 'new',
          },
          {
            page: 'policy',
            href: '/app/policy',
            label: 'Policy Drift',
            activePill: 'new',
          },
        ],
      },
      {
        page: 'projects',
        href: '/app/projects',
        label: 'Workloads',
        children: [
          {
            page: 'projects',
            href: '/app/projects',
            label: 'Workloads',
          },
          {
            page: 'rollout',
            href: '/app/rollout',
            label: 'Rollout Manager',
            activePill: 'new',
          },
          {
            page: 'control',
            href: '/app/control',
            label: 'Control',
          },
          {
            page: 'verifier',
            href: '/app/verifier',
            label: 'AI Proof Verifier',
            pill: 'beta',
          },
        ],
      },
      {
        page: 'inbox',
        href: '/app/inbox',
        label: 'Inbox',
        activePill: 'chat',
      },
      {
        page: 'activity',
        href: '/app/activity',
        label: 'Monitor',
        children: [
          {
            page: 'activity',
            href: '/app/activity',
            label: 'Activity',
          },
          {
            page: 'alerts',
            href: '/app/alerts',
            label: 'Alerts',
          },
          {
            page: 'health',
            href: '/app/health',
            label: 'Health',
          },
          {
            page: 'readiness',
            href: '/app/readiness',
            label: 'Readiness',
          },
        ],
      },
    ],
  },
  {
    label: 'evidence',
    items: [
      {
        page: 'evidence',
        href: '/app/evidence',
        label: 'Evidence packet',
        activePill: 'proof',
        children: [
          {
            page: 'evidence',
            href: '/app/evidence',
            label: 'Evidence packet',
            activePill: 'proof',
          },
          {
            page: 'release',
            href: '/app/release',
            label: 'Release evidence',
            activePill: 'new',
          },
          {
            page: 'members',
            href: '/app/members',
            label: 'Members',
          },
          {
            page: 'audit',
            href: '/app/audit',
            label: 'Audit',
          },
          {
            id: 'auditExportLink',
            href: '/api/v1/enterprise/audit?format=csv&days=30',
            label: 'Audit CSV',
          },
          {
            id: 'accessReviewLink',
            href: '/api/v1/enterprise/members/access-review?format=csv',
            label: 'Access review CSV',
          },
        ],
      },
    ],
  },
  {
    label: 'guides',
    items: [
      {
        page: 'setup',
        href: '/app/setup',
        label: 'Setup guide',
        children: [
          {
            page: 'setup',
            href: '/app/setup',
            label: 'Setup guide',
          },
          {
            page: 'testers',
            href: '/app/testers',
            label: 'Tester readiness',
          },
          {
            page: 'technical-guide',
            href: '/app/technical-guide',
            label: 'Technical guide',
          },
          {
            page: 'security-review',
            href: '/app/security-review',
            label: 'Security review',
          },
          {
            page: 'runbooks',
            href: '/app/runbooks',
            label: 'Runbooks',
          },
        ],
      },
      {
        page: 'settings',
        href: '/app/settings',
        label: 'Settings',
      },
      {
        page: 'plans',
        href: '/app/plans',
        label: 'Plans',
      },
      {
        page: 'entitlements',
        href: '/app/entitlements',
        label: 'Entitlements',
        activePill: 'paid',
      },
      {
        page: 'scanner',
        href: '/app/scanner',
        label: 'Scanner',
        activePill: 'new',
      },
    ],
  },
  {
    label: 'help',
    items: [
      {
        page: 'docs',
        href: '/app/docs',
        label: 'Enterprise docs',
        activePill: 'docs',
      },
      {
        href: 'https://vaultproof.dev/status',
        label: 'Status',
        external: true,
      },
      {
        href: 'mailto:hello@vaultproof.dev',
        label: 'Support',
      },
      {
        href: '/app/logout',
        label: 'Sign out',
        className: 'signout-link',
      },
    ],
  },
];

interface EnterpriseRailItem {
  readonly label: string;
  readonly glyph: string;
  readonly href: string;
  readonly badge?: string;
  readonly page?: EnterpriseAppNavPage;
  readonly shortcut?: string;
}

const ENTERPRISE_RAIL_BRAND: EnterpriseRailItem = {
  label: 'VaultProof',
  glyph: 'VP',
  href: '/app/dashboard',
};

const ENTERPRISE_RAIL_ITEMS: readonly EnterpriseRailItem[] = [
  { label: 'Inbox', glyph: 'C', href: '/app/inbox', page: 'inbox', badge: '4' },
  { label: 'Dashboard', glyph: 'D', href: '/app/dashboard', page: 'dashboard' },
  { label: 'Keys', glyph: 'K', href: '/app/keys', page: 'keys' },
  { label: 'Evidence', glyph: 'E', href: '/app/evidence', page: 'evidence' },
  { label: 'Monitor', glyph: 'M', href: '/app/activity', page: 'activity' },
  { label: 'Settings', glyph: 'S', href: '/app/settings', page: 'settings' },
];

const ENTERPRISE_RAIL_BOTTOM_ITEMS: readonly EnterpriseRailItem[] = [
  { label: 'Search', glyph: '/', href: '/app/dashboard', shortcut: 'Cmd K' },
  { label: 'Docs', glyph: '?', href: '/app/docs', page: 'docs' },
  { label: 'Messages', glyph: 'C', href: '/app/inbox', page: 'inbox' },
  { label: 'Runbooks', glyph: '*', href: '/app/runbooks', page: 'runbooks' },
  { label: 'Profile', glyph: 'P', href: '/app/settings', page: 'settings' },
];

const ENTERPRISE_NAV_ICON_BY_PAGE: Partial<Record<EnterpriseAppNavPage, string>> = {
  dashboard: 'D',
  launch: 'L',
  evidence: 'E',
  projects: 'W',
  inbox: 'C',
  inventory: 'I',
  policy: 'P',
  rollout: 'R',
  readiness: 'G',
  health: 'H',
  activity: 'M',
  alerts: 'A',
  control: 'X',
  verifier: 'V',
  org: 'O',
  members: 'U',
  audit: 'Q',
  keys: 'K',
  docs: 'B',
  setup: '+',
  demo: 'P',
  'technical-guide': 'T',
  'security-review': 'S',
  settings: 'S',
  entitlements: '$',
  onboarding: 'O',
  plans: 'P',
  pilot: 'P',
  'pilot-success': 'P',
  testers: 'T',
  release: 'R',
  scanner: 'Z',
  support: '?',
  runbooks: 'R',
};

const ENTERPRISE_NAV_ICON_BY_LABEL: Record<string, string> = {
  'Audit CSV': 'CSV',
  'Access review CSV': 'CSV',
  Status: 'ST',
  Support: '?',
  'Sign out': 'OUT',
};

function enterpriseNavGlyph(item: EnterpriseSidebarNavItem): string {
  return item.page ? ENTERPRISE_NAV_ICON_BY_PAGE[item.page] || item.label.slice(0, 1).toUpperCase() : ENTERPRISE_NAV_ICON_BY_LABEL[item.label] || item.label.slice(0, 1).toUpperCase();
}

function enterpriseRailLink(activePage: EnterpriseAppNavPage, item: EnterpriseRailItem, className = ''): string {
  const active = item.page === activePage;
  const classes = ['rail-link', active ? 'active' : '', className].filter(Boolean).join(' ');
  return `<a class="${classes}" href="${escapeHtml(item.href)}" aria-label="${escapeHtml(item.label)}"${active ? ' aria-current="page"' : ''}>
          <span class="rail-glyph">${escapeHtml(item.glyph)}</span>
          <span class="rail-label">${escapeHtml(item.label)}</span>
          ${item.shortcut ? `<span class="rail-shortcut">${escapeHtml(item.shortcut)}</span>` : ''}
          ${item.badge ? `<span class="rail-badge">${escapeHtml(item.badge)}</span>` : ''}
        </a>`;
}

function enterpriseRailProgressLink(): string {
  return `<a class="rail-link rail-progress-link" href="/app/setup" aria-label="Get set up">
          <span class="rail-progress" aria-hidden="true"><span></span></span>
          <span class="rail-label">Get set up</span>
        </a>`;
}

function enterpriseSidebarNavItemHasActivePage(activePage: EnterpriseAppNavPage, item: EnterpriseSidebarNavItem): boolean {
  return item.page === activePage || Boolean(item.children?.some((child) => enterpriseSidebarNavItemHasActivePage(activePage, child)));
}

function enterpriseAppNavLink(activePage: EnterpriseAppNavPage, item: EnterpriseSidebarNavItem, depth = 0): string {
  const active = item.page === activePage;
  const childActive = Boolean(item.children?.some((child) => enterpriseSidebarNavItemHasActivePage(activePage, child)));
  const className = ['nav-link', depth > 0 ? 'nav-child-link' : '', active ? 'active' : '', item.className || ''].filter(Boolean).join(' ');
  const activePill = active && item.activePill ? item.activePill : '';
  const pill = item.pill || activePill;
  const isExternalUrl = item.external && /^https?:\/\//.test(item.href);
  const targetAttrs = isExternalUrl ? ' target="_blank" rel="noopener"' : '';
  if (item.children?.length) {
    const summaryClassName = ['nav-link', 'nav-submenu-summary', childActive || active ? 'active' : '', item.className || ''].filter(Boolean).join(' ');
    return `<details class="nav-submenu${childActive || active ? ' active-submenu' : ''}"${childActive || active ? ' open' : ''}>
          <summary class="${summaryClassName}">
            <span class="nav-row-icon" aria-hidden="true">${escapeHtml(enterpriseNavGlyph(item))}</span>
            <span class="nav-link-main">
              <span class="nav-link-label">${escapeHtml(item.label)}</span>
              ${pill ? `<span class="nav-pill">${escapeHtml(pill)}</span>` : childActive || active ? '<span class="nav-active-dot" aria-hidden="true"></span>' : ''}
            </span>
            <span class="nav-submenu-chevron" aria-hidden="true"></span>
          </summary>
          <div class="nav-submenu-links">
            ${item.children.map((child) => enterpriseAppNavLink(activePage, child, depth + 1)).join('')}
          </div>
        </details>`;
  }
  return `<a class="${className}"${item.id ? ` id="${escapeHtml(item.id)}"` : ''} href="${escapeHtml(item.href)}"${active ? ' aria-current="page"' : ''}${targetAttrs}>
          <span class="nav-row-icon" aria-hidden="true">${escapeHtml(enterpriseNavGlyph(item))}</span>
          <span class="nav-link-main">
            <span class="nav-link-label">${escapeHtml(item.label)}</span>
            ${pill ? `<span class="nav-pill">${escapeHtml(pill)}</span>` : active ? '<span class="nav-active-dot" aria-hidden="true"></span>' : ''}
          </span>
        </a>`;
}

function enterpriseSidebarGroupHasActivePage(activePage: EnterpriseAppNavPage, group: EnterpriseSidebarNavGroup): boolean {
  return group.items.some((item) => enterpriseSidebarNavItemHasActivePage(activePage, item));
}

function enterpriseSidebarNavGroup(activePage: EnterpriseAppNavPage, group: EnterpriseSidebarNavGroup): string {
  const open = enterpriseSidebarGroupHasActivePage(activePage, group) || group.label === 'workspace';
  const activeClass = enterpriseSidebarGroupHasActivePage(activePage, group) ? ' active-group' : '';
  return `<details class="nav-group${activeClass}"${open ? ' open' : ''}>
        <summary class="nav-group-summary">
          <span class="nav-label">${escapeHtml(group.label)}</span>
        </summary>
        <div class="nav-group-links">
          ${group.items.map((item) => enterpriseAppNavLink(activePage, item)).join('')}
        </div>
      </details>`;
}

export function renderEnterpriseAppSidebar(activePage: EnterpriseAppNavPage, _subtitle?: string): string {
  return `<aside class="sidebar enterprise-app-sidebar enterprise-dual-sidebar" data-enterprise-sidebar="universal" data-ui-kit="dark-dual-sidebar">
      <div class="enterprise-icon-rail" aria-label="Enterprise quick navigation">
        <div class="rail-top">
          <div class="rail-expanded-head">
            ${enterpriseRailLink(activePage, ENTERPRISE_RAIL_BRAND, 'rail-brand-link')}
            <button class="rail-pin-button" type="button" aria-label="Pin expanded navigation" title="Pin expanded navigation" aria-pressed="false">P</button>
          </div>
          ${ENTERPRISE_RAIL_ITEMS.map((item) => enterpriseRailLink(activePage, item)).join('')}
        </div>
        <div class="rail-bottom">
          ${enterpriseRailProgressLink()}
          ${ENTERPRISE_RAIL_BOTTOM_ITEMS.map((item) => enterpriseRailLink(activePage, item)).join('')}
          <span class="rail-status-dot" aria-hidden="true"></span>
        </div>
      </div>
      <div class="sidebar-panel">
        <div class="brand">
          <div class="brand-title">VaultProof Enterprise</div>
        </div>
        <div class="workspace-card">
          <a class="get-started-link" href="/app/setup">
            <span class="nav-row-icon" aria-hidden="true">?</span>
            <span>Get started</span>
          </a>
        </div>
        <nav class="nav-groups" aria-label="Enterprise workspace navigation">
          ${ENTERPRISE_SIDEBAR_NAV_GROUPS.map((group) => enterpriseSidebarNavGroup(activePage, group)).join('')}
        </nav>
        <div class="sidebar-update-card" aria-label="VaultProof updates">
          <span class="update-mark">VP</span>
          <span class="update-copy">
            <span class="update-title">VaultProof updates</span>
            <span class="update-note">Runtime release notes</span>
          </span>
        </div>
      </div>
    </aside>
    <script>
      (function() {
        var shell = document.querySelector('[data-enterprise-sidebar="universal"]');
        if (!shell) return;
        var rail = shell.querySelector('.enterprise-icon-rail');
        var button = shell.querySelector('.rail-pin-button');
        var storageKey = 'vaultproofEnterpriseRailPinned';
        function setPinned(pinned) {
          shell.classList.toggle('rail-pinned', pinned);
          if (button) button.setAttribute('aria-pressed', pinned ? 'true' : 'false');
          try { window.localStorage.setItem(storageKey, pinned ? 'true' : 'false'); } catch (_) {}
        }
        function setRailHover(active) {
          shell.classList.toggle('rail-hover', active);
        }
        function targetIsInsideRail(target) {
          return rail && target && target.nodeType && rail.contains(target);
        }
        try { setPinned(window.localStorage.getItem(storageKey) === 'true'); } catch (_) {}
        if (rail) {
          rail.addEventListener('pointerenter', function() { setRailHover(true); });
          rail.addEventListener('pointerleave', function(event) {
            if (targetIsInsideRail(event.relatedTarget)) return;
            setRailHover(false);
          });
          rail.addEventListener('focusin', function() { setRailHover(true); });
          rail.addEventListener('focusout', function(event) {
            if (targetIsInsideRail(event.relatedTarget)) return;
            setRailHover(false);
          });
        }
        shell.addEventListener('pointerleave', function() { setRailHover(false); });
        if (button) {
          button.addEventListener('click', function(event) {
            event.preventDefault();
            setPinned(!shell.classList.contains('rail-pinned'));
          });
        }
      })();
    </script>`;
}

export const ENTERPRISE_APP_SHELL_THEME = `
    /* enterprise-universal-sidebar */
    :root {
      color-scheme: dark;
      --background: #050607;
      --foreground: #f8fafc;
      --card: #11161c;
      --card-foreground: #f8fafc;
      --primary: #8ab4f8;
      --primary-foreground: #08111f;
      --secondary: #181b21;
      --secondary-foreground: #e8eef7;
      --muted-bg: #171b22;
      --muted-foreground: #a8b3c2;
      --accent-bg: #1c222b;
      --accent-foreground: #d7e7ff;
      --border: #2d3138;
      --input: #334155;
      --ring: #8ab4f8;
      --radius: 8px;
      --bg: var(--background);
      --bg-mid: #181b21;
      --bg-card: var(--card);
      --paper: var(--card);
      --surface: var(--muted-bg);
      --panel: var(--card);
      --panel-strong: var(--card);
      --card-bg: var(--card);
      --row-bg: var(--muted-bg);
      --sidebar-bg: var(--card);
      --sidebar-card-bg: var(--muted-bg);
      --sidebar-text: var(--foreground);
      --sidebar-muted: var(--muted-foreground);
      --sidebar-link: var(--muted-foreground);
      --sidebar-link-active-bg: var(--accent-bg);
      --sidebar-link-active-border: rgba(138, 180, 248, 0.26);
      --sidebar-link-active-text: var(--foreground);
      --sidebar-accent: var(--primary);
      --control-bg: var(--card);
      --page-bg: #050607;
      --line: var(--border);
      --line-soft: var(--border);
      --rule: 1px solid var(--border);
      --hair: 1px solid var(--border);
      --text: var(--foreground);
      --text-muted: var(--muted-foreground);
      --text-faint: var(--muted-foreground);
      --muted: var(--muted-foreground);
      --soft: var(--muted-foreground);
      --nav-text: var(--muted-foreground);
      --action-text: var(--foreground);
      --gold: var(--primary);
      --accent: var(--primary);
      --accent-soft: rgba(138, 180, 248, 0.14);
      --green: #4ade80;
      --red: #f87171;
      --blue: #93c5fd;
      --ok: #4ade80;
      --warn: #fbbf24;
      --danger: #f87171;
      --ink: var(--primary-foreground);
      --primary-bg: var(--primary);
      --primary-text: var(--primary-foreground);
      --primary-border: var(--primary);
      --option-bg: var(--card);
      --option-text: var(--foreground);
      --shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      --enterprise-shell-gap: 12px;
    }
    body {
      background: var(--page-bg) !important;
      color: var(--text) !important;
    }
    a,
    .row-title,
    .list-title,
    .resource-title,
    .member-email,
    .policy-title,
    .exec-title,
    .banner-title,
    h1,
    h2,
    h3 {
      color: var(--text);
    }
    .lead,
    .mini,
    .row-sub,
    .kpi-sub,
    .page-desc,
    .page-meta,
    .list-sub,
    .resource-copy,
    .banner-copy,
    .banner-note,
    .form-copy,
    .callout,
    .business-card p,
    .intent-card p,
    .action-card p,
    .feature-card p,
    .role-card p {
      color: var(--muted) !important;
    }
    select,
    button,
    input,
    textarea {
      background: var(--control-bg);
      color: var(--text);
      border-color: var(--line);
    }
    option {
      background: var(--option-bg);
      color: var(--option-text);
    }
    .card,
    .panel,
    .kpi-grid,
    .banner,
    .invite-panel,
    .action-strip,
    .member-card,
    .policy-card,
    .policy-provider-card,
    .exec-card,
    .resource-card,
    .checklist-box,
    .callout {
      background: var(--card-bg) !important;
      border-color: var(--line) !important;
      box-shadow: var(--shadow) !important;
      color: var(--text) !important;
    }
    .row,
    .list-row,
    .invite-row,
    .intent-card,
    .action-card,
    .feature-card,
    .role-card,
    .tabbar {
      background: var(--row-bg) !important;
      border-color: var(--line-soft) !important;
      color: var(--text) !important;
    }
    .empty,
    .notice,
    .error {
      background: var(--row-bg) !important;
      border-color: var(--line) !important;
      color: var(--muted) !important;
    }
    .action,
    .tab-button {
      color: var(--action-text) !important;
    }
    .primary,
    .tab-button.active,
    .action.primary {
      background: var(--primary-bg, var(--text)) !important;
      color: var(--primary-text, var(--bg)) !important;
      border-color: var(--primary-border, var(--text)) !important;
    }
    .sidebar:not(.enterprise-app-sidebar),
    #sidebar:not(.enterprise-app-sidebar) {
      display: none !important;
    }
    .toolbar #orgSelect {
      display: none !important;
    }
    /* enterprise-dual-sidebar-dark-mode */
    html,
    body {
      background: #050607 !important;
    }
    body {
      min-height: 100vh;
      overflow-x: auto;
    }
    .shell,
    .layout {
      display: grid !important;
      grid-template-columns: 312px minmax(0, 1fr) !important;
      gap: 8px !important;
      min-height: 100vh;
      max-width: none !important;
      width: 100% !important;
      margin: 0 !important;
      padding: var(--enterprise-shell-gap) 8px var(--enterprise-shell-gap) 8px !important;
      background: #050607 !important;
    }
    .main {
      min-height: calc(100vh - 24px) !important;
      min-width: 0;
      max-width: none !important;
      width: 100% !important;
      padding: 24px !important;
      border: 1px solid #242830 !important;
      border-radius: 18px !important;
      background: #181b21 !important;
      box-shadow: none !important;
      overflow: hidden;
    }
    main.main > .topbar,
    .page-header {
      background: #11161c !important;
      border-color: #2d3138 !important;
      border-radius: 14px !important;
      box-shadow: none !important;
    }
    .card,
    .panel,
    .kpi-grid,
    .banner,
    .invite-panel,
    .action-strip,
    .member-card,
    .policy-card,
    .policy-provider-card,
    .exec-card,
    .resource-card,
    .checklist-box,
    .doc-section,
    .callout {
      background: #11161c !important;
      border-color: #2d3138 !important;
      border-radius: 12px !important;
      box-shadow: none !important;
    }
    .row,
    .list-row,
    .invite-row,
    .intent-card,
    .action-card,
    .feature-card,
    .role-card,
    .tabbar,
    .event,
    .resource-link,
    .kpi-card,
    .control-kpi,
    .control-panel,
    .chart-shell,
    .inventory-row,
    .launch-check-row,
    .go-evidence-row,
    .evidence-callout,
    .entitlement-meter,
    .scanner-row,
    .release-row,
    .tester-row {
      background: #171b22 !important;
      border-color: #2a2f37 !important;
      border-radius: 10px !important;
      box-shadow: none !important;
    }
    select,
    button,
    input,
    textarea {
      background: #1c2027 !important;
      color: #f8fafc !important;
      border-color: #343941 !important;
    }
    input::placeholder,
    textarea::placeholder {
      color: #8b8d93 !important;
    }
    table,
    th,
    td,
    pre,
    code,
    .json-box,
    .code-block {
      background-color: #0d1117 !important;
      color: #e5e7eb !important;
      border-color: #2d3138 !important;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar {
      position: sticky;
      top: 12px;
      display: grid !important;
      grid-template-columns: 56px 240px;
      gap: 8px;
      width: 304px;
      height: calc(100vh - 24px);
      min-height: 620px;
      align-self: start;
      padding: 0;
      background: transparent;
      overflow: visible;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      font-weight: 400;
      line-height: 1.5;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar * {
      letter-spacing: 0 !important;
    }
    .enterprise-icon-rail {
      position: relative;
      z-index: 3;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      align-items: center;
      width: 56px;
      min-height: 100%;
      padding: 20px 8px 10px;
      overflow: hidden;
      border: 1px solid transparent;
      border-left: 0;
      border-radius: 0;
      background: #050607;
      box-shadow: none;
      transition: width 220ms ease, border-color 220ms ease, border-radius 220ms ease, background 220ms ease, box-shadow 220ms ease;
    }
    .enterprise-icon-rail:hover,
    .enterprise-icon-rail:focus-within,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .enterprise-icon-rail,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .enterprise-icon-rail {
      align-items: stretch;
      width: 196px;
      border-color: #242830;
      border-radius: 0 16px 16px 0;
      background: #11161c;
      box-shadow: 18px 0 42px rgba(0, 0, 0, 0.38);
    }
    .rail-top,
    .rail-bottom {
      display: grid;
      justify-items: center;
      gap: 12px;
      width: 100%;
    }
    .enterprise-icon-rail:hover .rail-top,
    .enterprise-icon-rail:hover .rail-bottom,
    .enterprise-icon-rail:focus-within .rail-top,
    .enterprise-icon-rail:focus-within .rail-bottom,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-top,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-bottom,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-top,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-bottom {
      justify-items: stretch;
    }
    .rail-expanded-head {
      display: grid;
      grid-template-columns: 40px 0;
      align-items: center;
      gap: 0;
      width: 100%;
      transition: grid-template-columns 220ms ease, gap 220ms ease;
    }
    .enterprise-icon-rail:hover .rail-expanded-head,
    .enterprise-icon-rail:focus-within .rail-expanded-head,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-expanded-head,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-expanded-head {
      grid-template-columns: minmax(0, 1fr) 30px;
      gap: 8px;
    }
    .rail-link {
      position: relative;
      display: grid;
      grid-template-columns: 22px minmax(0, 0fr);
      align-items: center;
      justify-content: center;
      column-gap: 0;
      width: 40px;
      min-width: 40px;
      height: 36px;
      padding: 0 8px;
      border: 1px solid transparent;
      border-radius: 8px;
      color: #8b8d93;
      background: transparent;
      text-decoration: none;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease, width 220ms ease, column-gap 220ms ease;
    }
    .enterprise-icon-rail:hover .rail-link,
    .enterprise-icon-rail:focus-within .rail-link,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-link,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-link {
      grid-template-columns: 22px minmax(0, 1fr) auto;
      justify-content: start;
      width: 100%;
      min-width: 0;
      column-gap: 8px;
    }
    .rail-link:hover,
    .rail-link.active {
      color: #ffffff;
      background: #181b21;
      border-color: #303640;
    }
    .rail-glyph {
      display: grid;
      place-items: center;
      width: 20px;
      height: 20px;
      border-radius: 6px;
      font-size: 9px;
      line-height: 1;
      font-weight: 700;
      letter-spacing: 0 !important;
    }
    .rail-link.active .rail-glyph {
      background: #f97316;
      color: #111318;
    }
    .rail-label {
      display: block;
      min-width: 0;
      max-width: 0;
      overflow: hidden;
      opacity: 0;
      white-space: nowrap;
      color: inherit;
      font-size: 14px;
      font-weight: 650;
      line-height: 1.1;
      transition: max-width 220ms ease, opacity 160ms ease;
    }
    .enterprise-icon-rail:hover .rail-label,
    .enterprise-icon-rail:focus-within .rail-label,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-label,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-label {
      max-width: 118px;
      opacity: 1;
    }
    .rail-brand-link .rail-label {
      font-weight: 750;
    }
    .rail-shortcut {
      display: none;
      padding: 2px 5px;
      border: 1px solid #303640;
      border-radius: 5px;
      background: #232832;
      color: #b3bac5;
      font-size: 10px;
      font-weight: 650;
      line-height: 1;
    }
    .enterprise-icon-rail:hover .rail-shortcut,
    .enterprise-icon-rail:focus-within .rail-shortcut,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-shortcut,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-shortcut {
      display: inline-flex;
    }
    .rail-badge {
      position: absolute;
      top: -4px;
      right: -2px;
      display: grid;
      min-width: 16px;
      height: 16px;
      place-items: center;
      padding: 0 4px;
      border-radius: 999px;
      background: #b4532d;
      color: #ffffff;
      font-size: 10px;
      font-weight: 700;
      line-height: 1;
      border: 1px solid #050607;
    }
    .enterprise-icon-rail:hover .rail-badge,
    .enterprise-icon-rail:focus-within .rail-badge,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-badge,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-badge {
      position: static;
      justify-self: end;
      margin-left: auto;
      border-color: #11161c;
    }
    .rail-pin-button {
      display: grid;
      width: 0;
      height: 30px;
      min-width: 0;
      padding: 0;
      place-items: center;
      overflow: hidden;
      border: 1px solid transparent !important;
      border-radius: 8px;
      background: transparent !important;
      color: #b3bac5 !important;
      font-size: 10px;
      font-weight: 800;
      line-height: 1;
      opacity: 0;
      transition: width 220ms ease, opacity 160ms ease, background 160ms ease, border-color 160ms ease, color 160ms ease;
    }
    .enterprise-icon-rail:hover .rail-pin-button,
    .enterprise-icon-rail:focus-within .rail-pin-button,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-pin-button,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-pin-button {
      width: 30px;
      opacity: 1;
    }
    .rail-pin-button:hover,
    .rail-pin-button:focus-visible,
    .rail-pin-button[aria-pressed="true"] {
      background: #181b21 !important;
      border-color: #303640 !important;
      color: #ffffff !important;
    }
    .rail-progress-link .rail-progress {
      flex: 0 0 auto;
    }
    .rail-progress {
      display: grid;
      width: 18px;
      height: 18px;
      place-items: center;
      border-radius: 999px;
      background: conic-gradient(#4ade80 0 72%, #303640 72% 100%);
    }
    .rail-progress span {
      width: 12px;
      height: 12px;
      border-radius: 999px;
      background: #11161c;
      border: 2px solid #11161c;
    }
    .rail-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      background: #4ade80;
      box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.12);
    }
    .enterprise-icon-rail:hover .rail-status-dot,
    .enterprise-icon-rail:focus-within .rail-status-dot,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-hover .rail-status-dot,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar.rail-pinned .rail-status-dot {
      justify-self: start;
      margin-left: 16px;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .sidebar-panel {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      height: 100%;
      padding: 12px;
      overflow: hidden;
      border: 1px solid #242830;
      border-radius: 16px;
      background: #11161c;
      color: #f8fafc;
      box-shadow: none;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .brand {
      margin: 0;
      padding: 6px 12px 12px;
      border: 0;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .brand-title {
      color: #ffffff;
      font-size: 19px;
      font-weight: 750;
      line-height: 1.2;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .workspace-card {
      display: grid;
      gap: 10px;
      margin: 0;
      padding: 0 0 14px;
      border: 0;
      border-bottom: 1px solid #303640;
      border-radius: 0;
      background: transparent;
    }
    .get-started-link {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 40px;
      padding: 8px 11px;
      border: 1px solid #303640;
      border-radius: 10px;
      background: #1b2027 !important;
      color: #f8fafc !important;
      font-size: 14px;
      font-weight: 650;
      text-decoration: none;
      transition: background 160ms ease, border-color 160ms ease;
    }
    .get-started-link:hover {
      background: #232832 !important;
      border-color: #3f4652;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-groups {
      display: grid;
      gap: 0;
      margin-top: 14px;
      padding-right: 2px;
      overflow-y: auto;
      scrollbar-width: thin;
      scrollbar-color: #303640 transparent;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group {
      margin: 0;
      border: 0;
      border-radius: 0;
      background: transparent !important;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group + .nav-group {
      margin-top: 16px;
      padding-top: 16px;
      border-top: 1px solid #303640;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group-summary {
      min-height: 24px;
      padding: 0 8px 6px;
      color: #8b8d93;
      background: transparent !important;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group-summary::-webkit-details-marker {
      display: none;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group-summary::after {
      width: 7px;
      height: 7px;
      border-color: #8b8d93;
      transform: rotate(45deg);
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group[open] > .nav-group-summary::after {
      transform: rotate(225deg);
      margin-top: 4px;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-label {
      color: #8b8d93;
      font-size: 11px;
      font-weight: 650;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .active-group .nav-label {
      color: #f8fafc;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-group-links {
      display: grid;
      gap: 3px;
      padding: 0;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-submenu {
      display: grid;
      margin: 0;
      border: 0;
      border-radius: 0;
      background: transparent !important;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-link {
      display: grid;
      grid-template-columns: 22px minmax(0, 1fr);
      column-gap: 9px;
      align-items: center;
      min-height: 33px;
      margin: 0;
      padding: 6px 9px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: #d7d9de;
      font-size: 14px;
      font-weight: 500;
      text-decoration: none;
      transition: background 160ms ease, border-color 160ms ease, color 160ms ease;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-submenu-summary {
      grid-template-columns: 22px minmax(0, 1fr) 10px;
      cursor: pointer;
      list-style: none;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-submenu-summary::-webkit-details-marker {
      display: none;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-submenu-chevron {
      width: 7px;
      height: 7px;
      justify-self: center;
      border-right: 2px solid currentColor;
      border-bottom: 2px solid currentColor;
      opacity: 0.9;
      transform: rotate(-45deg);
      transition: transform 160ms ease;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-submenu[open] > .nav-submenu-summary .nav-submenu-chevron {
      transform: rotate(45deg) translate(-1px, -1px);
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-submenu-links {
      display: grid;
      gap: 3px;
      margin: 2px 0 8px 29px;
      padding: 0 0 0 10px;
      border-left: 2px solid #303640;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-child-link {
      grid-template-columns: minmax(0, 1fr);
      min-height: 32px;
      padding: 6px 10px;
      color: #d7d9de;
      font-size: 14px;
      font-weight: 500;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-child-link .nav-row-icon {
      display: none;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-child-link .nav-link-main {
      gap: 8px;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-link:hover,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-link.active {
      background: #1c222b;
      border-color: #303640;
      color: #ffffff;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-child-link:hover,
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-child-link.active {
      background: #3a4049;
      border-color: #3f4652;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-row-icon {
      display: grid;
      width: 18px;
      height: 18px;
      place-items: center;
      border-radius: 5px;
      color: #ffffff;
      font-size: 8px;
      font-weight: 800;
      line-height: 1;
      background: transparent;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-link.active .nav-row-icon,
    .get-started-link .nav-row-icon {
      background: #f8fafc;
      color: #11161c;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-link-main {
      display: flex;
      min-width: 0;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-link-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-active-dot {
      width: 6px;
      height: 6px;
      box-shadow: none;
      background: #ffffff;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .nav-pill {
      border-color: #5b6371;
      background: #232832;
      color: #f8fafc;
      font-size: 9px;
      font-weight: 650;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .signout-link {
      color: #f87171;
    }
    .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar .signout-link:hover {
      background: rgba(248, 113, 113, 0.12);
      border-color: rgba(248, 113, 113, 0.28);
      color: #f87171;
    }
    .sidebar-update-card {
      position: relative;
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 48px;
      margin-top: auto;
      padding: 9px 10px;
      overflow: hidden;
      border: 1px solid rgba(249, 115, 22, 0.72);
      border-radius: 11px;
      background: linear-gradient(90deg, rgba(249, 115, 22, 0.10), rgba(168, 85, 247, 0.12));
      color: #ffffff;
    }
    .sidebar-update-card::after {
      content: "";
      position: absolute;
      right: -22px;
      width: 70px;
      height: 54px;
      border-radius: 999px;
      background: rgba(249, 115, 22, 0.24);
      filter: blur(16px);
    }
    .update-mark {
      display: grid;
      width: 16px;
      height: 16px;
      place-items: center;
      border-radius: 5px;
      background: #ffffff;
      color: #11161c;
      font-size: 7px;
      font-weight: 800;
      z-index: 1;
    }
    .update-copy {
      display: grid;
      min-width: 0;
      gap: 1px;
      z-index: 1;
    }
    .update-title {
      color: #ffffff;
      font-size: 13px;
      font-weight: 650;
      line-height: 1.15;
    }
    .update-note {
      color: #a8b3c2;
      font-size: 11px;
      font-weight: 500;
      line-height: 1.2;
    }
    @media (max-width: 980px) {
      .shell, .layout {
        grid-template-columns: 312px minmax(360px, 1fr) !important;
        width: max-content !important;
        min-width: 100vw !important;
        padding: 12px 8px 12px 8px !important;
      }
      .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar {
        order: 0;
        position: relative;
        height: calc(100vh - 24px);
        min-height: 620px;
        display: grid !important;
      }
      .main {
        order: 0;
      }
    }
`;
