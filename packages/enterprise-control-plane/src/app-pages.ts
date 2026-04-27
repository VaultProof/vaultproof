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

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function renderEnterprisePlannedAppPage(pageName: string): string | null {
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
