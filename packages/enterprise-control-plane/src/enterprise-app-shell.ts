export type EnterpriseAppNavPage =
  | 'dashboard'
  | 'launch'
  | 'evidence'
  | 'projects'
  | 'inventory'
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
  | 'setup'
  | 'demo'
  | 'technical-guide'
  | 'security-review'
  | 'settings'
  | 'plans'
  | 'pilot'
  | 'pilot-success'
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
        page: 'launch',
        href: '/app/launch',
        label: 'Launch checklist',
        blurb: 'Customer go-live tasks, owners, and next actions.',
        activePill: 'ready',
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
        page: 'keys',
        href: '/app/keys',
        label: 'Provider slots',
        blurb: 'Provider key slots, material mode, and emergency revoke.',
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
        page: 'demo',
        href: '/app/demo',
        label: 'Demo script',
        blurb: 'Buyer walkthrough, proof path, and objection answers.',
        activePill: 'demo',
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
        page: 'pilot',
        href: '/app/pilot',
        label: 'Pilot proposal',
        blurb: 'Scope, price, owners, guardrails, and close copy.',
      },
      {
        page: 'pilot-success',
        href: '/app/pilot-success',
        label: 'Pilot success',
        blurb: 'Milestones, proof, blockers, and weekly update copy.',
      },
      {
        page: 'support',
        href: '/app/support',
        label: 'Launch support',
        blurb: 'Support model, escalation boundaries, and admin guardrails.',
      },
      {
        page: 'scanner',
        href: '/app/scanner',
        label: 'Scanner',
        blurb: 'Repository scanner launch checklist.',
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
        href: 'https://vaultproof.dev/docs',
        label: 'Docs',
        blurb: 'Public product docs and enterprise references.',
        external: true,
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
      --bg: #f6f7f2;
      --bg-mid: #edf1ea;
      --bg-card: rgba(255, 255, 255, 0.88);
      --paper: #fbfcf8;
      --surface: #f1f5ef;
      --panel: rgba(255, 255, 255, 0.76);
      --panel-strong: rgba(255, 255, 255, 0.96);
      --card-bg: #ffffff;
      --row-bg: #f7faf4;
      --sidebar-bg: #10231d;
      --sidebar-card-bg: #0a1914;
      --sidebar-text: #ffffff;
      --sidebar-muted: rgba(143, 224, 193, 0.78);
      --sidebar-link: rgba(255, 255, 255, 0.88);
      --sidebar-link-active-bg: rgba(143, 224, 193, 0.15);
      --sidebar-link-active-border: rgba(143, 224, 193, 0.40);
      --control-bg: rgba(255, 255, 255, 0.78);
      --page-bg: #f6f7f2;
      --line: rgba(32, 48, 39, 0.14);
      --line-soft: rgba(32, 48, 39, 0.09);
      --rule: 1px solid rgba(32, 48, 39, 0.14);
      --hair: 1px solid rgba(32, 48, 39, 0.09);
      --text: #17231d;
      --text-muted: #52625a;
      --text-faint: #7d8c84;
      --muted: #52625a;
      --soft: #7d8c84;
      --nav-text: #52625a;
      --action-text: #17231d;
      --gold: #176b4b;
      --accent: #176b4b;
      --accent-soft: rgba(23, 107, 75, 0.13);
      --green: #176b4b;
      --red: #b95d50;
      --blue: #168a9f;
      --ok: #176b4b;
      --warn: #8a5a13;
      --danger: #b95d50;
      --ink: #ffffff;
      --primary-bg: #8fe0c1;
      --primary-text: #10231d;
      --primary-border: #8fe0c1;
      --option-bg: #fbfcf8;
      --option-text: #17231d;
      --shadow: 0 22px 72px rgba(22, 35, 29, 0.12);
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
      border: 1px solid rgba(143, 224, 193, 0.18);
      border-radius: 22px;
      padding: 16px;
      box-shadow: 0 22px 70px rgba(16, 35, 29, 0.20);
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
      color: #8fe0c1;
      font-size: 12px;
      margin-top: 4px;
      font-weight: 400;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .workspace-card {
      border: 1px solid rgba(255, 255, 255, 0.10);
      background: rgba(255, 255, 255, 0.07);
      border-radius: 18px;
      padding: 16px;
      margin: 0 0 18px;
    }
    .sidebar.enterprise-app-sidebar .workspace-kicker {
      color: #8fe0c1;
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
      background: #0a1914;
      border-radius: 12px;
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
      border-radius: 14px;
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
      color: #8fe0c1;
      border: 1px solid rgba(143, 224, 193, 0.34);
      border-radius: 999px;
      padding: 2px 7px;
      font-weight: 400;
      text-transform: uppercase;
    }
    .sidebar.enterprise-app-sidebar .nav-active-dot {
      width: 7px;
      height: 7px;
      border-radius: 999px;
      background: #8fe0c1;
      box-shadow: 0 0 0 4px rgba(143, 224, 193, 0.13);
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
