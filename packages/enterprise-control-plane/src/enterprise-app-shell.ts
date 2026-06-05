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

const ENTERPRISE_SIDEBAR_SUBTITLE = 'confidential dashboard';

interface EnterpriseSidebarNavItem {
  readonly page?: EnterpriseAppNavPage;
  readonly href: string;
  readonly label: string;
  readonly blurb: string;
  readonly id?: string;
  readonly pill?: string;
  readonly activePill?: string;
  readonly className?: string;
  readonly external?: boolean;
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
        blurb: 'Runtime posture, access, evidence, and urgent actions.',
        activePill: 'new',
      },
      {
        page: 'keys',
        href: '/app/keys',
        label: 'Provider slots',
        blurb: 'Provider key slots, exposure response, material mode, and emergency revoke.',
      },
      {
        page: 'projects',
        href: '/app/projects',
        label: 'Workloads',
        blurb: 'Protected apps, usage, policy, and provider slot posture.',
      },
      {
        page: 'inbox',
        href: '/app/inbox',
        label: 'Inbox',
        blurb: 'Live customer conversations, SLA triage, and account context.',
        activePill: 'chat',
      },
      {
        page: 'inventory',
        href: '/app/inventory',
        label: 'API Inventory',
        blurb: 'Protected API catalog, owners, risk, review status, and evidence.',
        activePill: 'new',
      },
      {
        page: 'policy',
        href: '/app/policy',
        label: 'Policy Drift',
        blurb: 'Control gaps, accepted-risk records, owners, expiry, and launch blockers.',
        activePill: 'new',
      },
      {
        page: 'rollout',
        href: '/app/rollout',
        label: 'Rollout Manager',
        blurb: 'Workload cutover, canary status, owners, rollback, and evidence.',
        activePill: 'new',
      },
      {
        page: 'readiness',
        href: '/app/readiness',
        label: 'Readiness',
        blurb: 'Production gate for runtime, executor, and key custody.',
      },
      {
        page: 'health',
        href: '/app/health',
        label: 'Health',
        blurb: 'Lightweight status for the control plane and edge.',
      },
      {
        page: 'activity',
        href: '/app/activity',
        label: 'Activity',
        blurb: 'Runtime events, request IDs, latency, and outcomes.',
      },
      {
        page: 'alerts',
        href: '/app/alerts',
        label: 'Alerts',
        blurb: 'Destinations, delivery tests, and incident notices.',
      },
      {
        page: 'control',
        href: '/app/control',
        label: 'Control',
        blurb: 'Project policy, caller lock, limits, and secure execution.',
      },
      {
        page: 'verifier',
        href: '/app/verifier',
        label: 'AI Proof Verifier',
        blurb: 'Register external models and validate proof bundles.',
        pill: 'beta',
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
        blurb: 'Readiness, access, audit, policy, and proof exports.',
        activePill: 'proof',
      },
      {
        page: 'release',
        href: '/app/release',
        label: 'Release evidence',
        blurb: 'Build tags, approvals, verification, rollback, and customer-safe release proof.',
        activePill: 'new',
      },
      {
        page: 'members',
        href: '/app/members',
        label: 'Members',
        blurb: 'People, invitations, roles, and project assignments.',
      },
      {
        page: 'audit',
        href: '/app/audit',
        label: 'Audit',
        blurb: 'Governance and runtime events for review.',
      },
      {
        id: 'auditExportLink',
        href: '/api/v1/enterprise/audit?format=csv&days=30',
        label: 'Audit CSV',
        blurb: 'Download the last 30 days of audit evidence.',
      },
      {
        id: 'accessReviewLink',
        href: '/api/v1/enterprise/members/access-review?format=csv',
        label: 'Access review CSV',
        blurb: 'Export members, roles, and project access.',
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
        blurb: 'Implementation guide for enterprise rollout.',
      },
      {
        page: 'testers',
        href: '/app/testers',
        label: 'Tester readiness',
        blurb: 'Tester roster, login readiness, scenario assignments, feedback, and blockers.',
      },
      {
        page: 'technical-guide',
        href: '/app/technical-guide',
        label: 'Technical guide',
        blurb: 'Identity, network, custody, attestation, and debugging.',
      },
      {
        page: 'security-review',
        href: '/app/security-review',
        label: 'Security review',
        blurb: 'Security and procurement packet with customer-safe proof.',
      },
      {
        page: 'settings',
        href: '/app/settings',
        label: 'Settings',
        blurb: 'Tenant defaults and organization notices.',
      },
      {
        page: 'plans',
        href: '/app/plans',
        label: 'Plans',
        blurb: 'Package limits, rollout readiness, and customer guardrails.',
      },
      {
        page: 'entitlements',
        href: '/app/entitlements',
        label: 'Entitlements',
        blurb: 'Contract capacity, support tier, renewal, and usage guardrails.',
        activePill: 'paid',
      },
      {
        page: 'scanner',
        href: '/app/scanner',
        label: 'Scanner',
        blurb: 'Redacted repository exposure findings, owners, rotation, and evidence.',
        activePill: 'new',
      },
      {
        page: 'runbooks',
        href: '/app/runbooks',
        label: 'Runbooks',
        blurb: 'Deploy, evidence, rotation, DNS, edge, and cleanup.',
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
        blurb: 'Enterprise-only docs for setup, SSO, exposure response, evidence, and operations.',
        activePill: 'docs',
      },
      {
        href: 'https://vaultproof.dev/status',
        label: 'Status',
        blurb: 'Service availability and incident updates.',
        external: true,
      },
      {
        href: 'mailto:hello@vaultproof.dev',
        label: 'Support',
        blurb: 'Reach the VaultProof team.',
      },
      {
        href: '/app/logout',
        label: 'Sign out',
        blurb: 'End the current enterprise session.',
        className: 'signout-link',
      },
    ],
  },
];

function enterpriseAppNavLink(activePage: EnterpriseAppNavPage, item: EnterpriseSidebarNavItem): string {
  const active = item.page === activePage;
  const className = ['nav-link', active ? 'active' : '', item.className || ''].filter(Boolean).join(' ');
  const activePill = active && item.activePill ? item.activePill : '';
  const pill = item.pill || activePill;
  const isExternalUrl = item.external && /^https?:\/\//.test(item.href);
  const targetAttrs = isExternalUrl ? ' target="_blank" rel="noopener"' : '';
  return `<a class="${className}"${item.id ? ` id="${escapeHtml(item.id)}"` : ''} href="${escapeHtml(item.href)}"${active ? ' aria-current="page"' : ''}${targetAttrs}>
          <span class="nav-link-main">
            <span class="nav-link-label">${escapeHtml(item.label)}</span>
            ${pill ? `<span class="nav-pill">${escapeHtml(pill)}</span>` : active ? '<span class="nav-active-dot" aria-hidden="true"></span>' : ''}
          </span>
          <span class="nav-link-blurb">${escapeHtml(item.blurb)}</span>
        </a>`;
}

function enterpriseSidebarGroupHasActivePage(activePage: EnterpriseAppNavPage, group: EnterpriseSidebarNavGroup): boolean {
  return group.items.some((item) => item.page === activePage);
}

function enterpriseSidebarNavGroup(activePage: EnterpriseAppNavPage, group: EnterpriseSidebarNavGroup): string {
  const open = enterpriseSidebarGroupHasActivePage(activePage, group) || group.label === 'workspace';
  const activeClass = enterpriseSidebarGroupHasActivePage(activePage, group) ? ' active-group' : '';
  return `<details class="nav-group${activeClass}"${open ? ' open' : ''}>
        <summary class="nav-group-summary">
          <span class="nav-label">${escapeHtml(group.label)}</span>
          <span class="nav-group-count">${group.items.length}</span>
        </summary>
        <div class="nav-group-links">
          ${group.items.map((item) => enterpriseAppNavLink(activePage, item)).join('')}
        </div>
      </details>`;
}

export function renderEnterpriseAppSidebar(activePage: EnterpriseAppNavPage, _subtitle = ENTERPRISE_SIDEBAR_SUBTITLE): string {
  const sidebarSubtitle = ENTERPRISE_SIDEBAR_SUBTITLE;

  return `<aside class="sidebar enterprise-app-sidebar" data-enterprise-sidebar="universal" data-ui-kit="shadcn-studio">
      <div class="sidebar-panel">
        <div class="brand">
          <div class="brand-title">VaultProof Enterprise</div>
          <div class="brand-sub">${escapeHtml(sidebarSubtitle)}</div>
        </div>
        <div class="workspace-card">
          <div class="workspace-kicker">Organization Workspace</div>
          <div class="workspace-title">Provisioned organization</div>
          <p>VaultProof creates and manages the enterprise workspace for each organization.</p>
          <span>Workspace selection is controlled by the organization.</span>
        </div>
        <nav class="nav-groups" aria-label="Enterprise workspace navigation">
          ${ENTERPRISE_SIDEBAR_NAV_GROUPS.map((group) => enterpriseSidebarNavGroup(activePage, group)).join('')}
        </nav>
      </div>
    </aside>`;
}

export const ENTERPRISE_APP_SHELL_THEME = `
    /* enterprise-universal-sidebar */
    :root {
      color-scheme: dark;
      --background: #0b0f14;
      --foreground: #f8fafc;
      --card: #111827;
      --card-foreground: #f8fafc;
      --primary: #8ab4f8;
      --primary-foreground: #08111f;
      --secondary: #1b2432;
      --secondary-foreground: #e8eef7;
      --muted-bg: #151d29;
      --muted-foreground: #a8b3c2;
      --accent-bg: #18243a;
      --accent-foreground: #d7e7ff;
      --border: #2a3442;
      --input: #334155;
      --ring: #8ab4f8;
      --radius: 8px;
      --bg: var(--background);
      --bg-mid: #121a25;
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
      --page-bg: var(--background);
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
    .shell, .layout {
      display: grid;
      grid-template-columns: 300px minmax(0, 1fr);
      gap: 20px;
      min-height: 100vh;
      max-width: 1480px;
      margin: 0 auto;
      padding: 16px 24px;
    }
    .main {
      min-width: 0;
    }
    .toolbar #orgSelect {
      display: none !important;
    }
    .sidebar.enterprise-app-sidebar {
      display: block !important;
      border: 0;
      background: transparent;
      padding: 0;
      min-height: auto;
      align-self: start;
      overflow: visible;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      font-weight: 400;
      line-height: 1.5;
    }
    .sidebar.enterprise-app-sidebar,
    .sidebar.enterprise-app-sidebar * {
      letter-spacing: 0 !important;
    }
    .sidebar.enterprise-app-sidebar .sidebar-panel {
      background: var(--sidebar-bg);
      color: var(--sidebar-text);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 12px;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.28);
      overflow: visible;
    }
    .sidebar.enterprise-app-sidebar .brand {
      margin-bottom: 10px;
      padding: 8px 8px 12px;
      border-bottom: 1px solid var(--border);
    }
    .sidebar.enterprise-app-sidebar .brand-title {
      font-weight: 600;
      font-size: 16px;
      line-height: 1.12;
      letter-spacing: 0;
      color: var(--sidebar-text);
    }
    .sidebar.enterprise-app-sidebar .brand-sub {
      color: var(--sidebar-muted);
      font-size: 12px;
      margin-top: 4px;
      font-weight: 500;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .workspace-card {
      border: 1px solid var(--border);
      background: var(--sidebar-card-bg);
      border-radius: var(--radius);
      padding: 12px;
      margin: 0 0 12px;
    }
    .sidebar.enterprise-app-sidebar .workspace-kicker {
      color: var(--sidebar-accent);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .workspace-title {
      color: var(--sidebar-text);
      font-size: 15px;
      font-weight: 600;
      margin-top: 8px;
    }
    .sidebar.enterprise-app-sidebar .workspace-card p {
      color: var(--sidebar-muted) !important;
      margin: 4px 0 10px;
      font-size: 13px;
      line-height: 1.45;
    }
    .sidebar.enterprise-app-sidebar .workspace-card span {
      display: inline-flex;
      color: var(--sidebar-muted);
      border: 1px solid var(--border);
      background: var(--card);
      border-radius: var(--radius);
      padding: 8px 10px;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
    }
    .sidebar.enterprise-app-sidebar .nav-groups {
      display: grid;
      gap: 6px;
    }
    .sidebar.enterprise-app-sidebar .nav-group {
      margin: 0;
      border: 1px solid transparent;
      border-radius: var(--radius);
      background: transparent;
      overflow: hidden;
    }
    .sidebar.enterprise-app-sidebar .nav-group[open] {
      background: var(--muted-bg);
      border-color: var(--border);
    }
    .sidebar.enterprise-app-sidebar .nav-group.active-group {
      border-color: var(--sidebar-link-active-border);
    }
    .sidebar.enterprise-app-sidebar .nav-group-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-height: 38px;
      padding: 9px 10px;
      cursor: pointer;
      list-style: none;
      user-select: none;
    }
    .sidebar.enterprise-app-sidebar .nav-group-summary::-webkit-details-marker {
      display: none;
    }
    .sidebar.enterprise-app-sidebar .nav-group-summary::after {
      content: "";
      width: 8px;
      height: 8px;
      border-right: 1.5px solid var(--sidebar-muted);
      border-bottom: 1.5px solid var(--sidebar-muted);
      transform: rotate(45deg);
      transition: transform 160ms ease;
      flex: 0 0 auto;
      margin-left: auto;
    }
    .sidebar.enterprise-app-sidebar .nav-group[open] > .nav-group-summary::after {
      transform: rotate(225deg);
      margin-top: 5px;
    }
    .sidebar.enterprise-app-sidebar .nav-group-summary:hover,
    .sidebar.enterprise-app-sidebar .nav-group.active-group > .nav-group-summary {
      background: var(--accent-bg);
    }
    .sidebar.enterprise-app-sidebar .nav-label {
      color: var(--sidebar-muted);
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0;
      margin: 0;
    }
    .sidebar.enterprise-app-sidebar .active-group .nav-label {
      color: var(--sidebar-accent);
    }
    .sidebar.enterprise-app-sidebar .nav-group-count {
      color: var(--sidebar-muted);
      border: 1px solid var(--border);
      background: var(--card);
      border-radius: 999px;
      padding: 2px 7px;
      font-size: 11px;
      line-height: 1.2;
      flex: 0 0 auto;
    }
    .sidebar.enterprise-app-sidebar .nav-group-links {
      display: grid;
      gap: 4px;
      padding: 0 6px 6px;
    }
    .sidebar.enterprise-app-sidebar .nav-link {
      display: block;
      padding: 9px 10px;
      border-radius: var(--radius);
      color: var(--sidebar-link, var(--nav-text));
      margin: 0;
      border: 1px solid transparent;
      text-decoration: none;
      font-size: 14px;
      font-weight: 600;
      line-height: 1.25;
    }
    .sidebar.enterprise-app-sidebar .nav-link-main {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    .sidebar.enterprise-app-sidebar .nav-link-label {
      min-width: 0;
    }
    .sidebar.enterprise-app-sidebar .nav-link-blurb {
      display: block;
      color: var(--sidebar-muted);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.25rem;
      margin-top: 4px;
    }
    .sidebar.enterprise-app-sidebar .nav-link:hover,
    .sidebar.enterprise-app-sidebar .nav-link.active {
      background: var(--sidebar-link-active-bg, var(--panel));
      border-color: var(--sidebar-link-active-border, var(--line));
      color: var(--sidebar-link-active-text, var(--text));
    }
    .sidebar.enterprise-app-sidebar .nav-link:hover .nav-link-blurb,
    .sidebar.enterprise-app-sidebar .nav-link.active .nav-link-blurb {
      color: var(--sidebar-muted);
    }
    .sidebar.enterprise-app-sidebar .signout-link {
      color: var(--red);
    }
    .sidebar.enterprise-app-sidebar .signout-link:hover {
      background: rgba(248, 113, 113, 0.12);
      border-color: rgba(248, 113, 113, 0.28);
      color: var(--red);
    }
    .sidebar.enterprise-app-sidebar .nav-pill {
      font-size: 10px;
      color: var(--accent-foreground);
      border: 1px solid rgba(138, 180, 248, 0.26);
      background: var(--accent-bg);
      border-radius: 999px;
      padding: 2px 7px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .nav-active-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: var(--sidebar-accent);
      box-shadow: 0 0 0 4px rgba(138, 180, 248, 0.16);
      flex: 0 0 auto;
    }
    @media (max-width: 980px) {
      .shell, .layout {
        grid-template-columns: 1fr;
        padding: 12px;
      }
      .sidebar.enterprise-app-sidebar {
        order: 2;
        position: relative;
        height: auto;
        min-height: auto;
        display: flex !important;
      }
      .main {
        order: 1;
      }
    }
`;
