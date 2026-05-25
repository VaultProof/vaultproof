export type EnterpriseAppNavPage =
  | 'dashboard'
  | 'launch'
  | 'evidence'
  | 'projects'
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
        label: 'Projects',
        blurb: 'Project inventory, usage, and provider slot posture.',
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
        href: '/readiness',
        label: 'Readiness',
        blurb: 'Production gate for runtime, executor, and key custody.',
        external: true,
      },
      {
        page: 'health',
        href: '/health',
        label: 'Health',
        blurb: 'Lightweight status for the control plane and edge.',
        external: true,
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
      {
        page: 'org',
        href: '/app/org',
        label: 'Org + SSO',
        blurb: 'Enterprise identity, Entra SSO, roles, and domains.',
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
        label: 'Pilot testers',
        blurb: 'Tester roster, login readiness, scenario assignments, feedback, and blockers.',
        activePill: 'paid',
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
        blurb: 'Copyable buyer packet for security and procurement review.',
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
        blurb: 'Launch readiness, limits, and handoff notes.',
      },
      {
        page: 'entitlements',
        href: '/app/entitlements',
        label: 'Entitlements',
        blurb: 'Contract capacity, support tier, renewal, and paid-user guardrails.',
        activePill: 'paid',
      },
      {
        page: 'pilot',
        href: '/app/pilot',
        label: 'Pilot proposal',
        blurb: 'Scope, price, owners, guardrails, and close copy.',
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

function enterpriseSidebarNavGroup(activePage: EnterpriseAppNavPage, group: EnterpriseSidebarNavGroup): string {
  return `<div class="nav-group">
        <div class="nav-label">${escapeHtml(group.label)}</div>
        ${group.items.map((item) => enterpriseAppNavLink(activePage, item)).join('')}
      </div>`;
}

export function renderEnterpriseAppSidebar(activePage: EnterpriseAppNavPage, _subtitle = ENTERPRISE_SIDEBAR_SUBTITLE): string {
  const sidebarSubtitle = ENTERPRISE_SIDEBAR_SUBTITLE;

  return `<aside class="sidebar enterprise-app-sidebar" data-enterprise-sidebar="universal">
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
      color-scheme: light;
      --bg: #f5f7fb;
      --bg-mid: #e9eff5;
      --bg-card: rgba(255, 255, 255, 0.92);
      --paper: #ffffff;
      --surface: #eef3f7;
      --panel: rgba(255, 255, 255, 0.86);
      --panel-strong: rgba(255, 255, 255, 0.98);
      --card-bg: #ffffff;
      --row-bg: #f8fafc;
      --sidebar-bg: #18201f;
      --sidebar-card-bg: #101615;
      --sidebar-text: #ffffff;
      --sidebar-muted: rgba(188, 216, 210, 0.74);
      --sidebar-link: rgba(255, 255, 255, 0.88);
      --sidebar-link-active-bg: rgba(20, 184, 166, 0.16);
      --sidebar-link-active-border: rgba(94, 234, 212, 0.42);
      --control-bg: rgba(255, 255, 255, 0.92);
      --page-bg: #f5f7fb;
      --line: rgba(26, 40, 52, 0.14);
      --line-soft: rgba(26, 40, 52, 0.08);
      --rule: 1px solid rgba(26, 40, 52, 0.14);
      --hair: 1px solid rgba(26, 40, 52, 0.08);
      --text: #17202a;
      --text-muted: #526170;
      --text-faint: #7a8794;
      --muted: #526170;
      --soft: #7a8794;
      --nav-text: #526170;
      --action-text: #17202a;
      --gold: #0f766e;
      --accent: #0f766e;
      --accent-soft: rgba(20, 184, 166, 0.12);
      --green: #15803d;
      --red: #dc2626;
      --blue: #2563eb;
      --ok: #15803d;
      --warn: #b45309;
      --danger: #dc2626;
      --ink: #ffffff;
      --primary-bg: #14b8a6;
      --primary-text: #052f2b;
      --primary-border: #14b8a6;
      --option-bg: #ffffff;
      --option-text: #17202a;
      --shadow: 0 18px 54px rgba(26, 40, 52, 0.10);
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
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 8px;
      padding: 16px;
      box-shadow: 0 24px 70px rgba(26, 40, 52, 0.22);
      overflow: visible;
    }
    .sidebar.enterprise-app-sidebar .brand {
      margin-bottom: 14px;
      padding: 4px 4px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.10);
    }
    .sidebar.enterprise-app-sidebar .brand-title {
      font-weight: 600;
      font-size: 16px;
      line-height: 1.12;
      letter-spacing: 0;
      color: var(--sidebar-text, var(--text));
    }
    .sidebar.enterprise-app-sidebar .brand-sub {
      color: #5eead4;
      font-size: 12px;
      margin-top: 4px;
      font-weight: 400;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .workspace-card {
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(255, 255, 255, 0.07);
      border-radius: 8px;
      padding: 16px;
      margin: 0 0 18px;
    }
    .sidebar.enterprise-app-sidebar .workspace-kicker {
      color: #5eead4;
      font-size: 11px;
      font-weight: 400;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .workspace-title {
      color: var(--sidebar-text);
      font-size: 18px;
      font-weight: 600;
      margin-top: 12px;
    }
    .sidebar.enterprise-app-sidebar .workspace-card p {
      color: rgba(255, 255, 255, 0.70) !important;
      margin: 4px 0 14px;
      font-size: 14px;
      line-height: 1.5rem;
    }
    .sidebar.enterprise-app-sidebar .workspace-card span {
      display: inline-flex;
      color: rgba(255, 255, 255, 0.60);
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: var(--sidebar-card-bg);
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 12px;
      font-weight: 400;
      line-height: 1.25rem;
    }
    .sidebar.enterprise-app-sidebar .nav-groups {
      display: grid;
      gap: 16px;
    }
    .sidebar.enterprise-app-sidebar .nav-group { margin: 0; }
    .sidebar.enterprise-app-sidebar .nav-label {
      color: rgba(255, 255, 255, 0.35);
      font-size: 11px;
      font-weight: 400;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      margin: 0 0 8px 10px;
    }
    .sidebar.enterprise-app-sidebar .nav-link {
      display: block;
      padding: 10px 12px;
      border-radius: 8px;
      color: var(--sidebar-link, var(--nav-text));
      margin-bottom: 5px;
      border: 1px solid rgba(255, 255, 255, 0.08);
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
      color: rgba(255, 255, 255, 0.55);
      font-size: 12px;
      font-weight: 400;
      line-height: 1.25rem;
      margin-top: 4px;
    }
    .sidebar.enterprise-app-sidebar .nav-link:hover,
    .sidebar.enterprise-app-sidebar .nav-link.active {
      background: var(--sidebar-link-active-bg, var(--panel));
      border-color: var(--sidebar-link-active-border, var(--line));
      color: var(--sidebar-text, var(--text));
    }
    .sidebar.enterprise-app-sidebar .nav-link:hover .nav-link-blurb,
    .sidebar.enterprise-app-sidebar .nav-link.active .nav-link-blurb {
      color: rgba(255, 255, 255, 0.55);
    }
    .sidebar.enterprise-app-sidebar .signout-link {
      color: #ffd1c9;
    }
    .sidebar.enterprise-app-sidebar .signout-link:hover {
      background: rgba(255, 209, 201, 0.12);
      border-color: rgba(255, 209, 201, 0.26);
      color: #ffffff;
    }
    .sidebar.enterprise-app-sidebar .nav-pill {
      font-size: 10px;
      color: #5eead4;
      border: 1px solid rgba(94, 234, 212, 0.34);
      border-radius: 999px;
      padding: 2px 7px;
      font-weight: 400;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .nav-active-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #5eead4;
      box-shadow: 0 0 0 4px rgba(94, 234, 212, 0.13);
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
