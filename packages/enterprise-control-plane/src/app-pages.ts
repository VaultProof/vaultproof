import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';
import {
  ENTERPRISE_APP_SHELL_THEME,
  renderEnterpriseAppSidebar,
  type EnterpriseAppNavPage,
} from './enterprise-app-shell.js';

const PUBLIC_SITE_ORIGIN = 'https://vaultproof.dev';
const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing. Sign in again to continue.';
const DEMO_SUPABASE_CALLBACK_URL = 'https://gwzkjiomemjlhtrdrlan.supabase.co/auth/v1/callback';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rewriteStaticAssetUrls(html: string): string {
  return html
    .replaceAll('src="/js/', `src="${PUBLIC_SITE_ORIGIN}/js/`)
    .replaceAll('href="/css/', `href="${PUBLIC_SITE_ORIGIN}/css/`)
    .replaceAll('href="/favicon.png"', `href="${PUBLIC_SITE_ORIGIN}/favicon.png"`)
    .replaceAll('href="/terms"', `href="${PUBLIC_SITE_ORIGIN}/terms"`)
    .replaceAll('href="/privacy"', `href="${PUBLIC_SITE_ORIGIN}/privacy"`);
}

function removePublicSiteTheme(html: string): string {
  const publicSiteThemePattern = new RegExp(
    `\\s*<link\\s+rel="stylesheet"\\s+href="${escapeRegExp(PUBLIC_SITE_ORIGIN)}/css/site-theme\\.css"\\s*>`,
    'g',
  );
  return html.replace(publicSiteThemePattern, '');
}

const LEGACY_STATIC_SIDEBAR_ARTIFACTS = [
  'id="sidebar"',
  'id="sidebarOverlay"',
  '.sidebar-group',
  '.sidebar-head',
  '.sidebar-item',
  '.sidebar-nav-item',
  '.sidebar-label',
  '.sidebar-dot',
  '.sidebar-overlay',
  '.sidebar-bottom',
  'sidebar-nav-item',
  'sidebar-label',
  'sidebar-overlay',
  'sidebar-bottom',
  '.usage-box',
  '.usage-label',
  '.usage-row',
  '.usage-bar-track',
  '.usage-bar-fill',
  '.usage-reset',
];

function removeLegacyStaticSidebarArtifacts(html: string): string {
  return html
    .split('\n')
    .filter((line) => !LEGACY_STATIC_SIDEBAR_ARTIFACTS.some((artifact) => line.includes(artifact)))
    .join('\n');
}

function replaceOrInjectEnterpriseSidebar(html: string, activePage: EnterpriseAppNavPage, subtitle: string): string {
  const sidebar = renderEnterpriseAppSidebar(activePage, subtitle);
  const replaced = html.replace(/<aside\b[^>]*class="[^"]*\bsidebar\b[^"]*"[^>]*>[\s\S]*?<\/aside>/, sidebar);
  if (replaced !== html) return replaced;
  return html.replace('<div class="layout">', `<div class="layout">\n      ${sidebar}`);
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

const ENTERPRISE_RENDERED_APP_BASE_THEME = `
    :root {
      color-scheme: light;
      --bg: #f6f7f2;
      --panel: rgba(255, 255, 255, 0.76);
      --line: rgba(32, 48, 39, 0.14);
      --line-soft: rgba(32, 48, 39, 0.09);
      --text: #17231d;
      --muted: #52625a;
      --soft: #7d8c84;
      --gold: #176b4b;
      --green: #176b4b;
      --red: #b95d50;
      --blue: #168a9f;
      --ink: #17231d;
      --primary-bg: #8fe0c1;
      --primary-text: #10231d;
      --primary-border: #8fe0c1;
      --warn: #8a5a13;
      --page-bg: #f6f7f2;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background: var(--page-bg);
    }
    a { color: inherit; text-decoration: none; }
    .toolbar a,
    a.primary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      padding: 0 14px;
      border: 1px solid var(--line);
      border-radius: 13px;
      font: inherit;
      line-height: 1;
      white-space: nowrap;
    }
`;

const ENTERPRISE_STATIC_APP_THEME = `
    :root {
      color-scheme: light;
      --accent: #176b4b;
      --accent-soft: rgba(23, 107, 75, 0.13);
      --bg: #f6f7f2;
      --bg-mid: #edf1ea;
      --bg-card: rgba(255, 255, 255, 0.88);
      --paper: #fbfcf8;
      --surface: #f1f5ef;
      --rule: 1px solid rgba(32, 48, 39, 0.14);
      --hair: 1px solid rgba(32, 48, 39, 0.09);
      --line: rgba(32, 48, 39, 0.14);
      --text: #17231d;
      --text-muted: #52625a;
      --text-faint: #7d8c84;
      --muted: #52625a;
      --soft: #7d8c84;
      --gold: #176b4b;
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
      --page-bg: #f6f7f2;
      --display: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --body: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }
    html, body {
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--body);
    }
    .page {
      max-width: none;
      margin: 0;
      background: transparent;
      border: 0;
      min-height: 100vh;
    }
    .page > .topbar { display: none !important; }
    .page .layout { min-height: 100vh; }
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .page-title { color: var(--text); font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; font-weight: 850; }
    .page-desc, .page-meta, .list-sub, .resource-copy, .banner-copy, .banner-note, .form-copy, .callout { color: var(--muted); }
    .panel, .kpi-grid, .banner, .invite-panel, .action-strip, .member-card, .policy-card, .policy-provider-card, .exec-card, .resource-card, .checklist-box, .callout {
      border: 1px solid var(--line);
      background: #ffffff;
      border-radius: 24px;
      box-shadow: 0 22px 72px rgba(48,76,71,.16);
      color: var(--text);
    }
    .panel-head, .list-row, .invite-row { border-color: rgba(48, 76, 71, 0.12); }
    .resource-title, .list-title, .member-email, .policy-title, .exec-title, .banner-title { color: var(--text); }
    .org-select, .form-input, .form-select, .policy-input, .policy-textarea, select, input, textarea {
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
      border-radius: 13px;
    }
    option { color: #111827; }
    .btn-primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; border-radius: 13px; }
    .btn-outline, .btn-danger { background: rgba(255, 255, 255, 0.78); color: var(--text); border: 1px solid var(--line); border-radius: 13px; }
    .btn-danger { color: var(--red); border-color: rgba(251, 113, 133, 0.34); }
    .subnav-link { background: rgba(255, 255, 255, 0.78); color: var(--muted); border: 1px solid var(--line); }
    .subnav-link.active { color: var(--ink); background: linear-gradient(135deg, var(--gold), #f3df95); border-color: transparent; }
    .pill.neutral { background: rgba(255, 255, 255, 0.78); color: var(--muted); }
    .pill.ok { background: rgba(62, 93, 87, 0.1); color: var(--green); border-color: rgba(62, 93, 87, 0.24); }
    .pill.warn { background: rgba(213, 169, 20, 0.1); color: var(--gold); border-color: rgba(213, 169, 20, 0.28); }
    .pill.danger { background: rgba(251, 113, 133, 0.12); color: var(--red); border-color: rgba(251, 113, 133, 0.28); }
    .kpi-cell + .kpi-cell { border-left-color: rgba(48, 76, 71, 0.12); }
    .empty { color: var(--muted); }
    .resource-link { color: var(--gold); }
    @media (max-width: 980px) {
      .main { padding: 24px 18px; }
    }
`;

const ENTERPRISE_STATIC_APP_POLISH_THEME = `
    /* enterprise-static-theme-polish */
    .main {
      color: var(--text) !important;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      font-size: 16px !important;
      font-weight: 400 !important;
    }
    .main,
    .main * {
      letter-spacing: 0 !important;
    }
    main.main > .topbar,
    .page-header {
      border: 1px solid var(--line) !important;
      background: #fbfcf8 !important;
      border-radius: 20px !important;
      padding: 20px !important;
      box-shadow: none !important;
    }
    h1,
    .page-title {
      color: var(--text) !important;
      font-size: 1.875rem !important;
      font-weight: 600 !important;
      line-height: 2.25rem !important;
    }
    @media (min-width: 640px) {
      h1,
      .page-title {
        font-size: 2.6rem !important;
      }
    }
    h2,
    h3,
    .control-title,
    .section-title h2,
    .doc-section h2,
    .doc-section h3 {
      color: var(--text) !important;
      font-weight: 600 !important;
      line-height: 1.2 !important;
    }
    .kicker,
    .doc-kicker,
    .banner-kicker,
    .page-heading::before,
    .org-switcher-label,
    .action-strip-label,
    .kpi-label,
    .panel-head,
    .checklist-title,
    .slot-form label {
      color: #7d8c84 !important;
      font-weight: 400 !important;
    }
    .lead,
    .page-desc,
    .page-meta,
    .list-sub,
    .resource-copy,
    .banner-copy,
    .banner-note,
    .form-copy,
    .callout,
    .row-sub,
    .event-sub,
    .event-time,
    .kpi-sub,
    .summary {
      color: var(--muted) !important;
      font-size: 14px !important;
      line-height: 1.6 !important;
      font-weight: 400 !important;
    }
    @media (min-width: 640px) {
      .lead,
      .page-desc,
      .page-meta,
      .summary {
        font-size: 16px !important;
      }
    }
    .row-sub,
    .event-sub,
    .event-time,
    .kpi-sub,
    .mini,
    .resource-copy,
    .list-sub,
    .banner-note,
    .form-copy {
      color: #5f6f67 !important;
      font-size: 13px !important;
      line-height: 1.45 !important;
    }
    .primary,
    .btn-primary,
    .btn.primary,
    .subnav-link.active,
    button.primary,
    a.primary {
      background: var(--primary-bg) !important;
      color: var(--primary-text) !important;
      border-color: var(--primary-border) !important;
      font-weight: 600 !important;
      box-shadow: none !important;
    }
    .btn-outline,
    .btn-danger,
    .action,
    .subnav-link,
    button,
    select,
    input,
    textarea {
      font-weight: 500 !important;
    }
    .card,
    .panel,
    .kpi-cell,
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
    .doc-section {
      background: #ffffff !important;
      border-color: var(--line) !important;
      box-shadow: 0 18px 48px rgba(22, 35, 29, 0.10) !important;
    }
    .action-strip,
    .list-row,
    .invite-row,
    .row,
    .event,
    .role-card,
    .feature,
    .member-project,
    .pill {
      background: #f7faf4 !important;
    }
    .kpi-value {
      font-weight: 600 !important;
    }
    .row-title,
    .event-title,
    .list-title,
    .resource-title,
    .member-email,
    .policy-title,
    .exec-title,
    .banner-title {
      font-weight: 600 !important;
    }
    .tag,
    .pill,
    .feature-tag {
      font-weight: 400 !important;
    }
    .tag.warn,
    .pill.warn,
    .feature-tag.pending {
      color: var(--warn) !important;
      border-color: rgba(138, 90, 19, 0.30) !important;
      background: rgba(138, 90, 19, 0.08) !important;
    }
    .resource-link,
    .doc-section code,
    .doc-note strong {
      color: var(--green) !important;
    }
    .doc-note {
      border-left-color: var(--primary-bg) !important;
      background: rgba(143, 224, 193, 0.12) !important;
    }
`;

const ENTERPRISE_CONTROL_PAGE_THEME = `
    /* control-dashboard-theme */
    .page-header {
      margin-bottom: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(48, 76, 71, 0.10);
    }
    .page-heading::before {
      content: "Enterprise operations";
      width: max-content;
      padding: 6px 10px;
      border: 1px solid rgba(213, 169, 20, 0.26);
      border-radius: 999px;
      background: rgba(213, 169, 20, 0.1);
      color: var(--gold);
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .page-actions {
      align-items: flex-end;
      gap: 12px;
      flex: 1 1 420px;
    }
    .org-switcher {
      min-width: 280px;
      padding: 12px;
      border: 1px solid rgba(48, 76, 71, 0.14);
      border-radius: 18px;
      background: rgba(247, 250, 244, 0.82);
    }
    .org-switcher-label,
    .action-strip-label,
    .kpi-label,
    .panel-head,
    .banner-kicker,
    .checklist-title {
      color: rgba(52, 81, 76, 0.58);
      font-weight: 850;
      letter-spacing: .12em;
    }
    .org-switcher-status { color: var(--muted); }
    .page-desc {
      max-width: 780px;
      margin: 0 0 18px;
      color: rgba(52, 81, 76, 0.72);
      font-size: 15px;
      line-height: 1.65;
    }
    .subnav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: max-content;
      max-width: 100%;
      margin: 0 0 16px;
      padding: 7px;
      border: 1px solid rgba(48, 76, 71, 0.14);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.66);
      box-shadow: inset 0 1px 0 rgba(52, 81, 76, 0.05);
    }
    .subnav-link {
      padding: 9px 12px;
      border-radius: 13px;
      background: transparent;
      border-color: transparent;
      color: rgba(52, 81, 76, 0.68);
      font-weight: 800;
    }
    .subnav-link:hover {
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
    }
    .subnav-link.active {
      color: var(--ink);
      box-shadow: 0 12px 34px rgba(213, 169, 20, 0.18);
    }
    .action-strip {
      margin-bottom: 18px;
      padding: 14px;
      border-radius: 22px;
      background:
        linear-gradient(135deg, rgba(213, 169, 20, 0.12), transparent 48%),
        rgba(255, 255, 255, 0.72);
    }
    .action-strip .btn-outline {
      min-height: 38px;
      background: rgba(255, 255, 255, 0.68);
    }
    .action-msg {
      color: var(--muted);
      min-height: 18px;
    }
    .banner {
      grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr);
      gap: 20px;
      margin-bottom: 18px;
      padding: 22px;
      border-radius: 28px;
      background:
        radial-gradient(circle at 18% 0%, rgba(213, 169, 20, 0.22), transparent 28rem),
        linear-gradient(180deg, rgba(48, 76, 71, 0.14), rgba(247, 250, 244, 0.86));
    }
    .banner-title {
      font-size: clamp(28px, 4vw, 44px);
      letter-spacing: -.06em;
      line-height: 1;
    }
    .banner-copy {
      max-width: 680px;
      font-size: 14px;
      line-height: 1.65;
    }
    .banner-note {
      border-left: 1px solid rgba(48, 76, 71, 0.14);
      padding-left: 18px;
      color: rgba(52, 81, 76, 0.70);
    }
    .kpi-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
      border: 0;
      border-radius: 0;
      overflow: visible;
      background: transparent;
      box-shadow: none;
    }
    .kpi-cell {
      min-height: 150px;
      padding: 18px;
      border: 1px solid rgba(48, 76, 71, 0.14);
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(48, 76, 71, 0.12), rgba(247, 250, 244, 0.78)),
        rgba(247, 250, 244, 0.78);
      box-shadow: 0 18px 70px rgba(0, 0, 0, 0.16);
    }
    .kpi-cell + .kpi-cell { border-left: 1px solid rgba(48, 76, 71, 0.14); }
    .kpi-value {
      margin-top: 10px;
      color: var(--text);
      font-size: clamp(30px, 4vw, 44px);
      letter-spacing: -.055em;
      line-height: .95;
    }
    .kpi-sub {
      margin-top: 12px;
      color: rgba(52, 81, 76, 0.62);
      line-height: 1.45;
      white-space: normal;
    }
    .grid {
      grid-template-columns: minmax(0, 1.08fr) minmax(360px, .92fr);
      gap: 18px;
    }
    .stack { gap: 18px; }
    .panel {
      border-radius: 26px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 250, 244, 0.76)),
        rgba(247, 250, 244, 0.72);
    }
    .panel-head {
      min-height: 54px;
      padding: 16px 18px;
      border-bottom: 1px solid rgba(48, 76, 71, 0.10);
      background: rgba(247, 250, 244, 0.72);
    }
    .panel-head-right {
      color: var(--muted);
      font-weight: 700;
    }
    .list,
    .policy-list,
    .exec-list,
    .resource-grid,
    .member-grid,
    .invite-list {
      padding: 14px;
    }
    .list-row {
      padding: 13px 4px;
      border-bottom: 1px dashed rgba(48, 76, 71, 0.12);
    }
    .member-card,
    .policy-card,
    .policy-provider-card,
    .exec-card,
    .resource-card,
    .checklist-box {
      border-radius: 18px;
      background: rgba(247, 250, 244, 0.82);
      border-color: rgba(48, 76, 71, 0.12);
    }
    .member-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .member-project,
    .pill {
      border-color: rgba(48, 76, 71, 0.16);
      background: rgba(255, 255, 255, 0.68);
    }
    .policy-grid {
      grid-template-columns: minmax(0, 1fr) minmax(120px, auto);
    }
    .policy-label,
    .policy-hint,
    .member-meta,
    .exec-meta,
    .list-rank,
    .list-meta,
    .invite-sub {
      color: rgba(52, 81, 76, 0.55);
    }
    .policy-message,
    .exec-message {
      color: var(--muted);
    }
    .checklist-box {
      margin: 0 14px 14px;
    }
    .checklist-item {
      color: rgba(52, 81, 76, 0.68);
    }
    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .page-header { gap: 14px; }
      .page-actions { align-items: stretch; flex-basis: 100%; }
      .org-switcher { min-width: 100%; }
      .banner { grid-template-columns: 1fr; }
      .banner-note {
        border-left: 0;
        border-top: 1px solid rgba(48, 76, 71, 0.14);
        padding-left: 0;
        padding-top: 16px;
      }
      .kpi-grid,
      .member-grid,
      .policy-provider-grid,
      .policy-grid {
        grid-template-columns: 1fr;
      }
      .subnav { width: 100%; }
      .subnav-link { flex: 1 1 130px; text-align: center; }
    }
`;

const ENTERPRISE_ORG_PAGE_THEME = `
    /* org-dashboard-theme */
    .page-header {
      margin-bottom: 18px;
      padding-bottom: 18px;
      border-bottom: 1px solid rgba(48, 76, 71, 0.10);
    }
    .page-heading::before {
      content: "Organization setup";
      width: max-content;
      padding: 6px 10px;
      border: 1px solid rgba(213, 169, 20, 0.26);
      border-radius: 999px;
      background: rgba(213, 169, 20, 0.1);
      color: var(--gold);
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 850;
      letter-spacing: .12em;
      text-transform: uppercase;
    }
    .page-actions {
      align-items: flex-end;
      gap: 12px;
      flex: 1 1 460px;
    }
    .org-switcher {
      min-width: 280px;
      padding: 12px;
      border: 1px solid rgba(48, 76, 71, 0.14);
      border-radius: 18px;
      background: rgba(247, 250, 244, 0.82);
    }
    .org-switcher-label,
    .action-strip-label,
    .kpi-label,
    .panel-head,
    .banner-kicker,
    .form-label,
    .checklist-title {
      color: rgba(52, 81, 76, 0.58);
      font-weight: 850;
      letter-spacing: .12em;
    }
    .page-desc {
      max-width: 820px;
      margin: 0 0 18px;
      color: rgba(52, 81, 76, 0.72);
      font-size: 15px;
      line-height: 1.65;
    }
    .subnav {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      width: max-content;
      max-width: 100%;
      margin: 0 0 16px;
      padding: 7px;
      border: 1px solid rgba(48, 76, 71, 0.14);
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.66);
      box-shadow: inset 0 1px 0 rgba(52, 81, 76, 0.05);
    }
    .subnav-link {
      padding: 9px 12px;
      border-radius: 13px;
      background: transparent;
      border-color: transparent;
      color: rgba(52, 81, 76, 0.68);
      font-weight: 800;
    }
    .subnav-link:hover {
      background: rgba(255, 255, 255, 0.78);
      color: var(--text);
    }
    .subnav-link.active {
      color: var(--ink);
      box-shadow: 0 12px 34px rgba(213, 169, 20, 0.18);
    }
    .action-strip {
      margin-bottom: 18px;
      padding: 14px;
      border-radius: 22px;
      background:
        linear-gradient(135deg, rgba(62, 93, 87, 0.1), transparent 46%),
        rgba(255, 255, 255, 0.72);
    }
    .action-strip .btn-outline {
      min-height: 38px;
      background: rgba(255, 255, 255, 0.68);
    }
    .action-msg,
    .form-msg,
    .form-hint,
    .org-switcher-status {
      color: var(--muted);
    }
    .banner {
      grid-template-columns: minmax(0, 1.1fr) minmax(260px, .9fr);
      gap: 20px;
      margin-bottom: 18px;
      padding: 22px;
      border-radius: 28px;
      background:
        radial-gradient(circle at 18% 0%, rgba(62, 93, 87, 0.18), transparent 28rem),
        radial-gradient(circle at 78% 0%, rgba(213, 169, 20, 0.18), transparent 24rem),
        linear-gradient(180deg, rgba(48, 76, 71, 0.14), rgba(247, 250, 244, 0.86));
    }
    .banner-title {
      font-size: clamp(28px, 4vw, 44px);
      letter-spacing: -.06em;
      line-height: 1;
    }
    .banner-copy {
      max-width: 680px;
      font-size: 14px;
      line-height: 1.65;
    }
    .banner-note {
      border-left: 1px solid rgba(48, 76, 71, 0.14);
      padding-left: 18px;
      color: rgba(52, 81, 76, 0.70);
    }
    .kpi-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 18px;
      border: 0;
      border-radius: 0;
      overflow: visible;
      background: transparent;
      box-shadow: none;
    }
    .kpi-cell {
      min-height: 150px;
      padding: 18px;
      border: 1px solid rgba(48, 76, 71, 0.14);
      border-radius: 24px;
      background:
        linear-gradient(180deg, rgba(48, 76, 71, 0.12), rgba(247, 250, 244, 0.78)),
        rgba(247, 250, 244, 0.78);
      box-shadow: 0 18px 70px rgba(0, 0, 0, 0.16);
    }
    .kpi-cell + .kpi-cell { border-left: 1px solid rgba(48, 76, 71, 0.14); }
    .kpi-value {
      margin-top: 10px;
      color: var(--text);
      font-size: clamp(30px, 4vw, 42px);
      letter-spacing: -.055em;
      line-height: .95;
      overflow-wrap: anywhere;
    }
    .kpi-sub {
      margin-top: 12px;
      color: rgba(52, 81, 76, 0.62);
      line-height: 1.45;
      white-space: normal;
    }
    .grid {
      grid-template-columns: minmax(0, 1.02fr) minmax(390px, .98fr);
      gap: 18px;
    }
    .stack { gap: 18px; }
    .panel {
      border-radius: 26px;
      overflow: hidden;
      background:
        linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(247, 250, 244, 0.76)),
        rgba(247, 250, 244, 0.72);
    }
    .panel-head {
      min-height: 54px;
      padding: 16px 18px;
      border-bottom: 1px solid rgba(48, 76, 71, 0.10);
      background: rgba(247, 250, 244, 0.72);
    }
    .panel-head-right {
      color: var(--muted);
      font-weight: 700;
    }
    .form-card,
    .resource-grid,
    .list {
      padding: 14px;
    }
    .form-card {
      gap: 14px;
    }
    .form-grid {
      gap: 12px;
    }
    .form-field {
      gap: 7px;
    }
    .form-input,
    .form-select,
    .org-select {
      min-height: 42px;
      border-radius: 14px;
      background: rgba(247, 250, 244, 0.84);
      border-color: rgba(48, 76, 71, 0.16);
      color: var(--text);
    }
    .form-input::placeholder {
      color: rgba(52, 81, 76, 0.34);
    }
    .form-input:disabled,
    .form-select:disabled,
    .org-select:disabled {
      background: rgba(247, 250, 244, 0.78);
      color: rgba(52, 81, 76, 0.42);
    }
    .form-inline {
      gap: 10px;
    }
    .form-copy,
    .callout,
    .resource-copy {
      color: rgba(52, 81, 76, 0.68);
      line-height: 1.55;
    }
    .callout,
    .resource-card,
    .checklist-box {
      border-radius: 18px;
      background: rgba(247, 250, 244, 0.82);
      border-color: rgba(48, 76, 71, 0.12);
    }
    .callout strong {
      color: var(--text);
    }
    .resource-card {
      padding: 14px;
    }
    .resource-title,
    .list-title {
      color: var(--text);
    }
    .resource-link {
      color: var(--gold);
      font-weight: 800;
    }
    .checklist-box {
      margin: 0 14px 14px;
    }
    .checklist-item {
      color: rgba(52, 81, 76, 0.68);
    }
    .list-row {
      padding: 13px 4px;
      border-bottom: 1px dashed rgba(48, 76, 71, 0.12);
    }
    .list-rank,
    .list-meta,
    .list-sub {
      color: rgba(52, 81, 76, 0.55);
    }
    .pill {
      border-color: rgba(48, 76, 71, 0.16);
      background: rgba(255, 255, 255, 0.68);
    }
    .btn-danger {
      background: rgba(251, 113, 133, 0.1);
      color: var(--red);
      border-color: rgba(251, 113, 133, 0.32);
      border-radius: 13px;
    }
    .btn-danger:hover {
      background: rgba(251, 113, 133, 0.16);
    }
    @media (max-width: 1180px) {
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
    }
    @media (max-width: 760px) {
      .page-header { gap: 14px; }
      .page-actions { align-items: stretch; flex-basis: 100%; }
      .org-switcher { min-width: 100%; }
      .banner { grid-template-columns: 1fr; }
      .banner-note {
        border-left: 0;
        border-top: 1px solid rgba(48, 76, 71, 0.14);
        padding-left: 0;
        padding-top: 16px;
      }
      .kpi-grid,
      .form-grid {
        grid-template-columns: 1fr;
      }
      .subnav { width: 100%; }
      .subnav-link { flex: 1 1 130px; text-align: center; }
      .page-actions > * { flex: 1 1 150px; }
    }
`;

const ENTERPRISE_STATIC_PAGE_THEMES: Partial<Record<EnterpriseAppNavPage, string>> = {
  control: ENTERPRISE_CONTROL_PAGE_THEME,
  org: ENTERPRISE_ORG_PAGE_THEME,
};

const ENTERPRISE_STATIC_CANONICAL_ORG_URL_SCRIPT = `<script>
    /* enterprise-static-canonical-org-url */
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var nativeReplaceState = window.history.replaceState;
      var nativePushState = window.history.pushState;

      function canonicalizeAppUrl(value) {
        if (value === undefined || value === null || value === '') return value;
        try {
          var url = new URL(String(value), window.location.href);
          if (url.origin !== window.location.origin) return value;
          if (url.pathname !== '/app/control' && url.pathname !== '/app/org') return value;
          var orgId = url.searchParams.get('org');
          if (orgId) window.localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, orgId);
          url.searchParams.delete('org');
          return url.pathname + url.search + url.hash;
        } catch (error) {
          return value;
        }
      }

      window.history.replaceState = function(state, title, url) {
        if (arguments.length < 3) return nativeReplaceState.call(window.history, state, title);
        return nativeReplaceState.call(window.history, state, title, canonicalizeAppUrl(url));
      };
      window.history.pushState = function(state, title, url) {
        if (arguments.length < 3) return nativePushState.call(window.history, state, title);
        return nativePushState.call(window.history, state, title, canonicalizeAppUrl(url));
      };

      var canonical = canonicalizeAppUrl(window.location.href);
      var current = window.location.pathname + window.location.search + window.location.hash;
      if (canonical && canonical !== current) {
        nativeReplaceState.call(window.history, window.history.state || {}, '', canonical);
      }
    })();
  </script>`;

function applyEnterpriseStaticAppTheme(html: string, activePage: EnterpriseAppNavPage, subtitle: string): string {
  const pageSpecificTheme = ENTERPRISE_STATIC_PAGE_THEMES[activePage] ?? '';

  return removeLegacyStaticSidebarArtifacts(replaceOrInjectEnterpriseSidebar(removePublicSiteTheme(html), activePage, subtitle))
    .replace('</style>', `${ENTERPRISE_APP_SHELL_THEME}${ENTERPRISE_STATIC_APP_THEME}${pageSpecificTheme}${ENTERPRISE_STATIC_APP_POLISH_THEME}\n  </style>`)
    .replace('</head>', `${ENTERPRISE_STATIC_CANONICAL_ORG_URL_SCRIPT}\n</head>`);
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
    summary: 'Enterprise member management will bring org members, pending invites, project assignments, and SOC 2 access-review evidence into one GCP-hosted page.',
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
    features: ['Active and revoked slots', 'Emergency revoke workflow', 'Rotation checklist', 'Cloud KMS posture notes'],
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
    summary: 'Enterprise plans will track rollout status, GCP edge and monitoring packaging, limits, and contract-facing governance notes.',
    features: ['GCP edge rollout status', 'Monitoring package status', 'Enterprise limits', 'Contract-facing plan notes'],
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
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 720px; }
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(52,81,76,.48); }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .danger { color: var(--red); border-color: rgba(185,93,80,.34); }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .form-row { display: grid; grid-template-columns: minmax(220px, 1fr) minmax(240px, .42fr) auto; gap: 10px; align-items: center; }
    .inline-actions { display: flex; gap: 8px; justify-content: flex-end; align-items: center; flex-wrap: wrap; }
    .inline-actions select, .inline-actions button { padding: 8px 9px; font-size: 13px; border-radius: 11px; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(340px, .72fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,250,244,.86)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(48,76,71,.16); }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center; border: 1px solid rgba(48,76,71,.10); border-radius: 17px; padding: 13px; background: rgba(247,250,244,.84); }
    .row-title { font-weight: 760; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(22,138,159,.24); border-radius: 999px; padding: 5px 8px; }
    .tag.good { color: var(--green); border-color: rgba(62,93,87,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(213,169,20,.28); }
    .role-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .role-card { border: 1px solid rgba(48,76,71,.10); border-radius: 17px; padding: 13px; background: rgba(247,250,244,.80); }
    .role-card strong { display: block; margin-bottom: 5px; }
    .role-card p { color: var(--muted); font-size: 13px; line-height: 1.45; margin: 0 0 9px; }
    .role-card .tag { display: inline-block; margin: 0 5px 5px 0; }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(48,76,71,.22); border-radius: 18px; padding: 18px; background: rgba(247,250,244,.78); }
    .notice.error { color: var(--red); border-color: rgba(185,93,80,.3); }
    @media (max-width: 980px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .kpis, .two, .role-grid, .form-row { grid-template-columns: 1fr; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('members', 'members + access')}

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
        <div class="section-title"><h2>IAM actions</h2><span class="mini">invite, role, project access</span></div>
        <form id="inviteForm" class="form-row">
          <input id="inviteEmail" type="email" autocomplete="email" placeholder="teammate@company.com" required />
          <select id="inviteRole" aria-label="Invite role">
            <option value="viewer">Viewer - read-only</option>
            <option value="auditor">Auditor - evidence review</option>
            <option value="developer">Developer - assigned project work</option>
            <option value="iam_admin">IAM Admin - users and SSO</option>
            <option value="security_admin">Security Admin - policy and evidence</option>
            <option value="platform_admin">Platform Admin - runtime and gateway</option>
          </select>
          <button class="primary" type="submit">send invite</button>
        </form>
      </section>

      <section class="grid kpis">
        <div class="card"><div class="kpi-label">members</div><div class="kpi-value" id="kpiMembers">...</div><div class="kpi-sub" id="kpiMembersSub">loading</div></div>
        <div class="card"><div class="kpi-label">privileged roles</div><div class="kpi-value" id="kpiAdmins">...</div><div class="kpi-sub">owner, admin, IAM, security, platform</div></div>
        <div class="card"><div class="kpi-label">pending invites</div><div class="kpi-value" id="kpiInvites">...</div><div class="kpi-sub">waiting for acceptance</div></div>
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">access scopes</div></div>
      </section>

      <section class="card" style="margin-bottom:16px">
        <div class="section-title"><h2>Role guide</h2><span class="mini">least-privilege IAM model</span></div>
        <div id="roleGuideList" class="role-grid"><div class="empty">Loading role guide...</div></div>
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
      var roleDefinitions = {
        organization_roles: [
          { value: 'owner', label: 'Owner', summary: 'Full workspace control and final break-glass authority.', permissions: ['all controls'], privileged: true },
          { value: 'admin', label: 'Admin', summary: 'Legacy broad admin role.', permissions: ['members', 'projects', 'policy', 'evidence'], legacy: true, privileged: true },
          { value: 'iam_admin', label: 'IAM Admin', summary: 'Manages users, roles, project access, and SSO setup.', permissions: ['invite users', 'change roles', 'assign projects'], privileged: true },
          { value: 'security_admin', label: 'Security Admin', summary: 'Owns policy, provider slot controls, alerts, and evidence.', permissions: ['security policy', 'provider revoke', 'evidence'], privileged: true },
          { value: 'platform_admin', label: 'Platform Admin', summary: 'Runs gateway, runtime, DNS/edge, and production readiness.', permissions: ['runtime', 'gateway', 'project controls'], privileged: true },
          { value: 'developer', label: 'Developer', summary: 'Builds and tests assigned project integrations.', permissions: ['assigned projects'] },
          { value: 'auditor', label: 'Auditor', summary: 'Read-only compliance reviewer for audit and evidence.', permissions: ['audit', 'evidence'] },
          { value: 'member', label: 'Member', summary: 'Legacy contributor role.', permissions: ['assigned project work'], legacy: true },
          { value: 'viewer', label: 'Viewer', summary: 'Read-only business visibility.', permissions: ['read only'] }
        ],
        project_roles: [
          { value: 'owner', label: 'Project Owner', summary: 'Full control for one project.', permissions: ['policy', 'provider slots', 'execution'], privileged: true },
          { value: 'admin', label: 'Project Admin', summary: 'Legacy broad project admin role.', permissions: ['policy', 'provider slots', 'execution'], legacy: true, privileged: true },
          { value: 'project_admin', label: 'Project Admin', summary: 'Configures one project without org-wide IAM.', permissions: ['policy', 'provider slots'], privileged: true },
          { value: 'operator', label: 'Operator', summary: 'Runs approved traffic and reviews activity.', permissions: ['execution', 'activity'] },
          { value: 'developer', label: 'Developer', summary: 'Builds and tests without changing security policy.', permissions: ['execution', 'activity'] },
          { value: 'auditor', label: 'Auditor', summary: 'Read-only reviewer for one project.', permissions: ['evidence', 'activity'] },
          { value: 'member', label: 'Member', summary: 'Legacy project contributor role.', permissions: ['execution'], legacy: true },
          { value: 'viewer', label: 'Viewer', summary: 'Read-only project visibility.', permissions: ['read only'] }
        ]
      };
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
      function roleList(scope) {
        return scope === 'project' ? roleDefinitions.project_roles : roleDefinitions.organization_roles;
      }
      function roleDefinition(scope, value) {
        return (roleList(scope) || []).find(function(role) { return role.value === value; }) || { value: value, label: value, summary: '', permissions: [] };
      }
      function roleLabel(scope, value) {
        return roleDefinition(scope, value).label || value;
      }
      function isPrivilegedOrgRole(value) {
        return !!roleDefinition('organization', value).privileged;
      }
      function renderRoleOptions(scope, selected, includeOwner) {
        return (roleList(scope) || []).filter(function(role) {
          return includeOwner || role.value !== 'owner';
        }).map(function(role) {
          var label = role.label || role.value;
          var suffix = role.summary ? ' - ' + role.summary : '';
          return '<option value="' + escapeHtml(role.value) + '"' + (selected === role.value ? ' selected' : '') + '>' + escapeHtml(label + suffix) + '</option>';
        }).join('');
      }
      function renderRoleGuide() {
        var el = byId('roleGuideList');
        if (!el) return;
        var roles = (roleDefinitions.organization_roles || []).filter(function(role) {
          return role.value !== 'admin' && role.value !== 'member';
        });
        el.innerHTML = roles.map(function(role) {
          var permissions = Array.isArray(role.permissions) ? role.permissions : [];
          return '<div class="role-card"><strong>' + escapeHtml(role.label || role.value) + '</strong><p>' + escapeHtml(role.summary || '') + '</p><div>' + permissions.slice(0, 4).map(function(permission) {
            return '<span class="tag ' + (role.privileged ? 'warn' : '') + '">' + escapeHtml(permission) + '</span>';
          }).join('') + '</div></div>';
        }).join('');
      }
      function refreshInviteRoleOptions() {
        var inviteRole = byId('inviteRole');
        if (inviteRole) inviteRole.innerHTML = renderRoleOptions('organization', inviteRole.value || 'viewer', false);
      }
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
        var res = await fetch(path, Object.assign({}, options || {}, { headers: Object.assign(headers(), (options && options.headers) || {}) }));
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
        if (payload.role_definitions) {
          roleDefinitions = {
            organization_roles: Array.isArray(payload.role_definitions.organization_roles) ? payload.role_definitions.organization_roles : roleDefinitions.organization_roles,
            project_roles: Array.isArray(payload.role_definitions.project_roles) ? payload.role_definitions.project_roles : roleDefinitions.project_roles
          };
        }
        refreshInviteRoleOptions();
        renderRoleGuide();
        var members = Array.isArray(payload.members) ? payload.members : [];
        var invites = Array.isArray(payload.invitations) ? payload.invitations.filter(function(invite) { return invite.status === 'pending'; }) : [];
        var incomingInvites = Array.isArray(payload.pending_invitations_for_me) ? payload.pending_invitations_for_me : [];
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        var admins = members.filter(function(member) { return isPrivilegedOrgRole(member.role); });
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
            var roleControl = canManage ? '<div class="inline-actions"><select data-action="member-role" data-user-id="' + escapeHtml(member.user_id) + '">' + renderRoleOptions('organization', member.role, true)
              + '</select><select data-action="project-pick" data-user-id="' + escapeHtml(member.user_id) + '"><option value="">assign project...</option>' + projects.map(function(project) {
              return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
            }).join('') + '</select><select data-action="project-role" data-user-id="' + escapeHtml(member.user_id) + '">' + renderRoleOptions('project', 'viewer', true) + '</select><button type="button" data-action="assign-project" data-user-id="' + escapeHtml(member.user_id) + '">assign</button></div>' : '<span class="tag good">' + escapeHtml(roleLabel('organization', member.role)) + '</span>';
            var projectBadges = access.length ? '<div class="row-sub">' + access.map(function(item) {
              var remove = canManage ? ' <button type="button" class="danger" data-action="remove-project" data-user-id="' + escapeHtml(member.user_id) + '" data-project-id="' + escapeHtml(item.project_id) + '">remove</button>' : '';
              return '<span class="tag">' + escapeHtml(item.project_name || item.vp_proj_id) + ' / ' + escapeHtml(roleLabel('project', item.role)) + '</span>' + remove;
            }).join(' ') + '</div>' : '';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(member.email || member.user_id) + '</div><div class="row-sub">' + escapeHtml(roleLabel('organization', member.role)) + ' - ' + access.length + ' project scopes - joined ' + escapeHtml(rel(member.created_at)) + '</div>' + projectBadges + '</div>' + roleControl + '</div>';
          }).join('') : '<div class="empty">No members found.</div>';
        }
        var invitesList = byId('invitesList');
        if (invitesList) {
          var outgoingInviteRows = invites.map(function(invite) {
            var action = canManage ? '<button type="button" class="danger" data-action="revoke-invite" data-invite-id="' + escapeHtml(invite.id) + '">revoke</button>' : '<span class="tag warn">pending</span>';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(invite.email) + '</div><div class="row-sub">' + escapeHtml(roleLabel('organization', invite.role)) + ' - invited ' + escapeHtml(rel(invite.created_at)) + '</div></div>' + action + '</div>';
          });
          var incomingInviteRows = incomingInvites.map(function(invite) {
            var org = invite.organization || {};
            return '<div class="row"><div><div class="row-title">' + escapeHtml(org.name || 'Organization invite') + '</div><div class="row-sub">for ' + escapeHtml(invite.email) + ' as ' + escapeHtml(roleLabel('organization', invite.role)) + ' - invited ' + escapeHtml(rel(invite.created_at)) + '</div></div><button type="button" class="primary" data-action="accept-invite" data-invite-id="' + escapeHtml(invite.id) + '">accept</button></div>';
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
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(52,81,76,.48); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 760px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,250,244,.86)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(48,76,71,.16); }
    .filters { display: grid; grid-template-columns: 1.1fr .85fr .9fr .9fr 1.3fr auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .event { display: grid; grid-template-columns: 160px 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .event-time { color: var(--muted); font-size: 13px; line-height: 1.45; }
    .event-title { font-weight: 780; letter-spacing: -.02em; }
    .event-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(22,138,159,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(62,93,87,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(213,169,20,.28); }
    .tag.bad { color: var(--red); border-color: rgba(185,93,80,.28); }
    details { margin-top: 8px; color: var(--muted); font-size: 13px; }
    pre { white-space: pre-wrap; word-break: break-word; border: 1px solid rgba(48,76,71,.12); border-radius: 14px; padding: 12px; background: rgba(48,76,71,.18); color: #4e6862; overflow: auto; }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(48,76,71,.22); border-radius: 18px; padding: 18px; background: rgba(247,250,244,.78); }
    .notice.error { color: var(--red); border-color: rgba(185,93,80,.3); }
    @media (max-width: 1100px) { .filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .event { grid-template-columns: 1fr; } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis { grid-template-columns: 1fr; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('audit', 'audit evidence')}

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
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    button[disabled] { cursor: not-allowed; opacity: .58; }
    input::placeholder { color: rgba(52,81,76,.48); }
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
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,250,244,.86)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(48,76,71,.16); }
    .filters { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)) auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .row-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(22,138,159,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(62,93,87,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(213,169,20,.28); }
    .tag.bad { color: var(--red); border-color: rgba(185,93,80,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(48,76,71,.22); border-radius: 18px; padding: 18px; background: rgba(247,250,244,.78); }
    .notice.error { color: var(--red); border-color: rgba(185,93,80,.3); }
    .slot-form { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .slot-form label { display: grid; gap: 7px; color: var(--muted); font-size: 12px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
    .slot-form input, .slot-form select { width: 100%; }
    .slot-form .wide { grid-column: span 2; }
    .slot-form-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-top: 14px; }
    .slot-form-note { color: var(--muted); font-size: 13px; line-height: 1.45; margin: 0; }
    @media (max-width: 1100px) { .filters, .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two, .slot-form { grid-template-columns: 1fr; } .slot-form .wide { grid-column: auto; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('alerts', 'alert operations')}

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

function renderEnterpriseOperationsPage(pageName: 'activity' | 'projects' | 'inventory' | 'policy' | 'rollout' | 'keys'): string {
  const pageTitle = pageName === 'activity' ? 'Activity' : pageName === 'projects' ? 'Projects' : pageName === 'inventory' ? 'API Inventory' : pageName === 'policy' ? 'Policy Drift' : pageName === 'rollout' ? 'Rollout Manager' : 'Provider Slots';
  const pageKicker = pageName === 'activity' ? 'runtime feed' : pageName === 'projects' ? 'project inventory' : pageName === 'inventory' ? 'api inventory' : pageName === 'policy' ? 'accepted risk' : pageName === 'rollout' ? 'workload cutover' : 'secrets posture';
  const pageLead = pageName === 'activity'
    ? 'Review secure proxy/runtime events, status codes, latency, provider request IDs, and attestation evidence hints.'
    : pageName === 'projects'
      ? 'Track enterprise projects, provider coverage, caller-lock policy, traffic health, and quick links into Control.'
      : pageName === 'inventory'
        ? 'Catalog protected API surfaces by project, provider slot, owner, environment, risk, policy posture, traffic evidence, and review status without storing secrets.'
        : pageName === 'policy'
          ? 'Review caller-lock drift, missing controls, demo-only risk, accepted exceptions, owners, expiry dates, and remaining blockers before paid traffic.'
          : pageName === 'rollout'
            ? 'Move one customer workload into VaultProof with app and gateway owners, test status, canary percentage, rollback path, blockers, and customer-safe evidence.'
            : 'Review active provider slots, trigger emergency revoke, and keep rotation posture visible without exposing upstream secrets.';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(pageTitle)} - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    option { color: #111827; }
    button { cursor: pointer; }
    input::placeholder { color: rgba(52,81,76,.48); }
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: flex-start; margin-bottom: 22px; }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 8px 0 8px; font-size: clamp(38px, 6vw, 74px); line-height: .92; letter-spacing: -.075em; }
    .lead { color: var(--muted); line-height: 1.6; max-width: 780px; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .danger { color: var(--red); border-color: rgba(185,93,80,.34); }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,250,244,.86)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(48,76,71,.16); }
    .filters { display: grid; grid-template-columns: minmax(180px, 1fr) minmax(150px, .7fr) minmax(180px, 1fr) auto; gap: 10px; margin-bottom: 16px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .inventory-row { display: grid; gap: 14px; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .inventory-head { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 14px; align-items: start; }
    .inventory-fields { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .inventory-field { display: grid; gap: 5px; min-width: 0; }
    .inventory-field.wide { grid-column: span 2; }
    .inventory-field label { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
    .inventory-field input, .inventory-field select { width: 100%; min-width: 0; }
    .inventory-field textarea { width: 100%; min-height: 74px; resize: vertical; border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    .row-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; align-items: start; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(22,138,159,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(62,93,87,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(213,169,20,.28); }
    .tag.bad { color: var(--red); border-color: rgba(185,93,80,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(48,76,71,.22); border-radius: 18px; padding: 18px; background: rgba(247,250,244,.78); }
    .notice.error { color: var(--red); border-color: rgba(185,93,80,.3); }
    @media (max-width: 1100px) { .filters, .kpis, .two, .inventory-fields { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two, .inventory-head, .inventory-fields { grid-template-columns: 1fr; } .inventory-field.wide { grid-column: auto; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar(pageName, pageKicker)}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="kicker">${escapeHtml(pageKicker)}</div>
          <h1>${escapeHtml(pageTitle)}</h1>
          <p class="lead">${escapeHtml(pageLead)}</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          ${pageName === 'keys' ? '<button id="openProviderSlotForm" class="primary" type="button">add slot</button>' : ''}
          ${pageName === 'inventory' ? '<button id="copyInventoryJsonBtn" class="primary" type="button">copy inventory JSON</button>' : ''}
          ${pageName === 'policy' ? '<button id="copyPolicyJsonBtn" class="primary" type="button">copy policy JSON</button>' : ''}
          ${pageName === 'rollout' ? '<button id="copyRolloutJsonBtn" class="primary" type="button">copy rollout JSON</button>' : ''}
          <button id="refreshBtn" type="button">refresh</button>
          <a class="primary" href="/app/control">open control</a>
        </div>
      </div>

      <div id="notice" class="notice error" style="display:none"></div>

      ${pageName === 'keys' ? `
      <section id="providerSlotFormPanel" class="card" style="display:none;margin-bottom:16px">
        <div class="section-title"><h2>Add provider slot</h2><span class="mini">demo material</span></div>
        <form id="providerSlotForm">
          <div class="slot-form">
            <label>Project
              <select id="slotProject" required></select>
            </label>
            <label>Provider
              <input id="slotProvider" list="providerSlotOptions" value="openai" required maxlength="64" />
            </label>
            <label>Slug
              <input id="slotSlug" value="openai" required maxlength="64" />
            </label>
            <label class="wide">Upstream base URL
              <input id="slotUpstream" value="https://api.openai.com" required />
            </label>
            <label>Auth header
              <input id="slotHeaderName" value="authorization" required />
            </label>
            <label class="wide">Auth template
              <input id="slotHeaderTemplate" value="Bearer {key}" required />
            </label>
          </div>
          <datalist id="providerSlotOptions">
            <option value="openai"></option>
            <option value="anthropic"></option>
            <option value="resend"></option>
            <option value="sendgrid"></option>
            <option value="mailgun"></option>
            <option value="postmark"></option>
            <option value="aws-ses"></option>
            <option value="stripe"></option>
            <option value="twilio"></option>
            <option value="snowflake"></option>
          </datalist>
          <div class="slot-form-actions">
            <button class="primary" type="submit">create slot</button>
            <button id="cancelProviderSlotForm" type="button">cancel</button>
            <p class="slot-form-note">Real provider keys stay out of this browser flow until sealed ingest is enabled.</p>
          </div>
        </form>
      </section>` : ''}

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

      <section id="inventoryPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>API inventory board</h2><span id="inventoryMeta" class="mini">metadata-only</span></div>
          <div id="inventoryList" class="list"><div class="empty">Loading API inventory...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Inventory evidence</h2><span class="mini">no secrets</span></div>
          <div id="inventorySummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Review workflow</h2><span class="mini">customer handoff</span></div>
          <div id="inventoryWorkflowList" class="list"></div>
        </div>
      </section>

      <section id="policyPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Policy drift board</h2><span id="policyMeta" class="mini">accepted-risk records</span></div>
          <div id="policyList" class="list"><div class="empty">Loading policy drift...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Exception evidence</h2><span class="mini">no secrets</span></div>
          <div id="policySummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Review workflow</h2><span class="mini">paid-user ready</span></div>
          <div id="policyWorkflowList" class="list"></div>
        </div>
      </section>

      <section id="rolloutPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Integration rollout board</h2><span id="rolloutMeta" class="mini">workload cutover</span></div>
          <div id="rolloutList" class="list"><div class="empty">Loading integration rollout...</div></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Rollout evidence</h2><span class="mini">no secrets</span></div>
          <div id="rolloutSummaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Cutover workflow</h2><span class="mini">customer-safe</span></div>
          <div id="rolloutWorkflowList" class="list"></div>
        </div>
      </section>

      ${pageName === 'keys' ? `
      <section id="apiProxyTestPanel" class="card" style="display:none;margin-bottom:16px">
        <div class="section-title"><h2>Customer API proxy test kit</h2><span id="apiProxyTestMeta" class="mini">copy-safe</span></div>
        <div id="apiProxyTestList" class="list"><div class="empty">Loading self-test kit...</div></div>
      </section>

      <section id="emailKeyDemoPanel" class="grid two" style="display:none;margin-bottom:16px">
        <div class="card">
          <div class="section-title"><h2>Email API key demo</h2><span class="mini">required for demo</span></div>
          <div id="emailKeyDemoList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Protected email policy</h2><span class="mini">no raw keys</span></div>
          <div class="list">
            <div class="row"><div><div class="row-title">What this proves</div><div class="row-sub">The customer app sends through VaultProof without storing, viewing, copying, logging, or emailing the raw email-provider key.</div></div><span class="tag good">use-only</span></div>
            <div class="row"><div><div class="row-title">Policy boundary</div><div class="row-sub">Lock sender domains, recipient allowlists, template IDs, gateway markers, and per-minute limits before live sends.</div></div><span class="tag warn">policy</span></div>
            <div class="row"><div><div class="row-title">Policy denial evidence</div><div class="row-sub">Blocked email attempts record sender domain, recipient domains, recipient count, template IDs, caller-lock facts, and protected-secret classification without writing the raw email payload.</div></div><span class="tag bad">deny + audit</span></div>
            <div class="row"><div><div class="row-title">Demo path</div><div class="row-sub">Use protected email dry-run first. Live sandbox send should wait until a sealed provider key is loaded with the local ingest helper.</div></div><span class="tag">dry-run first</span></div>
          </div>
        </div>
      </section>` : ''}

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
      var cachedInventoryRows = [];
      var cachedPolicyRows = [];
      var cachedRolloutRows = [];
      var providerDefaults = {
        openai: { upstream: 'https://api.openai.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/models' },
        anthropic: { upstream: 'https://api.anthropic.com', header: 'x-api-key', template: '{key}', demoPath: '/v1/messages' },
        resend: { upstream: 'https://api.resend.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/emails' },
        sendgrid: { upstream: 'https://api.sendgrid.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/v3/mail/send' },
        mailgun: { upstream: 'https://api.mailgun.net', header: 'authorization', template: 'Basic {key}', emailPath: '/v3/example.com/messages' },
        postmark: { upstream: 'https://api.postmarkapp.com', header: 'x-postmark-server-token', template: '{key}', emailPath: '/email' },
        'aws-ses': { upstream: 'https://email.us-east-1.amazonaws.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/' },
        stripe: { upstream: 'https://api.stripe.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/v1/customers' },
        twilio: { upstream: 'https://api.twilio.com', header: 'authorization', template: 'Basic {key}', demoPath: '/2010-04-01/Accounts.json' },
        snowflake: { upstream: 'https://snowflakecomputing.com', header: 'authorization', template: 'Bearer {key}', demoPath: '/api/v2/statements' }
      };
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
      function isEmailProvider(value) {
        return ['resend', 'sendgrid', 'mailgun', 'postmark', 'aws-ses', 'aws_ses'].indexOf(String(value || '').trim().toLowerCase()) !== -1;
      }
      function slotIsEmailProvider(slot) {
        return isEmailProvider(slot.provider) || isEmailProvider(slot.slug);
      }
      function emailProviderLabel(value) {
        var provider = String(value || '').trim().toLowerCase();
        return provider === 'aws-ses' || provider === 'aws_ses' ? 'AWS SES' : provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : 'Email provider';
      }
      function emailDemoPath(slot) {
        var provider = String(slot.provider || slot.slug || '').trim().toLowerCase();
        var defaults = providerDefaults[provider] || providerDefaults[String(slot.slug || '').trim().toLowerCase()] || {};
        return defaults.emailPath || '/emails';
      }
      function providerDemoPath(slot) {
        if (slotIsEmailProvider(slot)) return emailDemoPath(slot);
        var provider = String(slot.provider || slot.slug || '').trim().toLowerCase();
        var defaults = providerDefaults[provider] || providerDefaults[String(slot.slug || '').trim().toLowerCase()] || {};
        return defaults.demoPath || '/';
      }
      function toBase64Utf8(value) {
        return btoa(unescape(encodeURIComponent(value)));
      }
      function demoEmailPayload(slot, options) {
        var provider = String(slot.provider || slot.slug || '').trim().toLowerCase();
        var recipient = options && options.blocked ? 'blocked@untrusted.example' : 'security-review@example.com';
        if (provider === 'sendgrid') {
          return {
            personalizations: [{ to: [{ email: recipient }] }],
            from: { email: 'demo@vaultproof.dev' },
            template_id: 'vaultproof-demo',
            subject: 'VaultProof protected email dry-run',
            content: [{ type: 'text/plain', value: 'VaultProof policy validated this email-provider call without exposing the raw key.' }]
          };
        }
        if (provider === 'mailgun') {
          return {
            from: 'VaultProof Demo <demo@vaultproof.dev>',
            to: recipient,
            subject: 'VaultProof protected email dry-run',
            text: 'VaultProof policy validated this email-provider call without exposing the raw key.'
          };
        }
        if (provider === 'postmark') {
          return {
            From: 'demo@vaultproof.dev',
            To: recipient,
            TemplateId: 'vaultproof-demo',
            Subject: 'VaultProof protected email dry-run',
            TextBody: 'VaultProof policy validated this email-provider call without exposing the raw key.'
          };
        }
        if (provider === 'aws-ses' || provider === 'aws_ses') {
          return {
            Source: 'demo@vaultproof.dev',
            Destination: { ToAddresses: [recipient] },
            Template: 'vaultproof-demo',
            Message: {
              Subject: { Data: 'VaultProof protected email dry-run' },
              Body: { Text: { Data: 'VaultProof policy validated this email-provider call without exposing the raw key.' } }
            }
          };
        }
        return {
          from: 'VaultProof Demo <demo@vaultproof.dev>',
          to: [recipient],
          subject: 'VaultProof protected email dry-run',
          text: 'VaultProof policy validated this email-provider call without exposing the raw key.'
        };
      }
      function proxySelfTestBody(slot, options) {
        if (slotIsEmailProvider(slot)) {
          return {
            method: 'POST',
            upstream_path: emailDemoPath(slot),
            headers: { 'content-type': 'application/json' },
            body_base64: toBase64Utf8(JSON.stringify(demoEmailPayload(slot, options || {}))),
            dry_run: true
          };
        }
        return {
          method: 'GET',
          upstream_path: providerDemoPath(slot),
          dry_run: true
        };
      }
      function proxySelfTestSnippet(project, slot, options) {
        var slug = slot.slug || slot.provider;
        var path = '/api/v1/enterprise/projects/' + encodeURIComponent(project.id) + '/providers/' + encodeURIComponent(slug) + '/execute';
        var headers = {
          authorization: 'Bearer YOUR_VAULTPROOF_SESSION_JWT',
          'content-type': 'application/json',
          'x-vaultproof-organization': currentOrgId || project.organization_id || 'YOUR_ORGANIZATION_ID',
          'x-vaultproof-customer-gateway': 'vaultproof-managed',
          'x-vaultproof-client-class': 'browser'
        };
        return [
          'fetch(' + JSON.stringify(location.origin + path) + ', {',
          '  method: "POST",',
          '  headers: ' + JSON.stringify(headers, null, 2).replace(/\\n/g, '\\n  ') + ',',
          '  body: JSON.stringify(' + JSON.stringify(proxySelfTestBody(slot, options || {}), null, 2).replace(/\\n/g, '\\n  ') + ')',
          '}).then(async (response) => ({',
          '  status: response.status,',
          '  body: await response.json().catch(() => null)',
          '}));'
        ].join('\\n');
      }
      function copyToClipboard(value, label) {
        function done() { notice((label || 'Value') + ' copied. No raw provider keys, encrypted shares, bearer tokens, OAuth secrets, request bodies, response bodies, or customer payloads are included.'); }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done).catch(function() { fallbackCopy(value); done(); });
          return;
        }
        fallbackCopy(value);
        done();
      }
      function fallbackCopy(value) {
        var textarea = document.createElement('textarea');
        textarea.value = value;
        textarea.setAttribute('readonly', 'readonly');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
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
        var liveSlotCount = cachedProjects.reduce(function(total, project) {
          return total + (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'sealed-live'; }).length;
        }, 0);
        var demoSlotCount = cachedProjects.reduce(function(total, project) {
          return total + (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'demo-placeholder'; }).length;
        }, 0);
        text('kpiProjects', number(cachedProjects.length));
        text('kpiKeys', number(slotCount));
        text('kpiProviders', slotCount ? (liveSlotCount + ' live sealed / ' + demoSlotCount + ' demo') : 'no active slots');
        text('kpiCalls', number(cachedOverview.totalCalls));
        text('kpiDenied', number(cachedOverview.deniedCalls));
      }
      function renderProjectOptions() {
        var select = byId('activityProjectFilter');
        if (select) {
          select.innerHTML = '<option value="">All projects</option>' + cachedProjects.map(function(project) {
            return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + '</option>';
          }).join('');
        }
        var slotProject = byId('slotProject');
        if (slotProject) {
          slotProject.innerHTML = cachedProjects.length ? cachedProjects.map(function(project) {
            return '<option value="' + escapeHtml(project.id) + '">' + escapeHtml(project.name || project.vp_proj_id) + ' - ' + escapeHtml(project.project_role || 'member') + '</option>';
          }).join('') : '<option value="">No projects</option>';
          slotProject.disabled = !cachedProjects.length;
        }
      }
      function inventoryStorageKey() {
        return 'vaultproof_api_inventory::' + (currentOrgId || 'default');
      }
      function redactInventoryNote(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key)/i.test(textValue)) {
          return '[redacted: note contained secret-like material]';
        }
        return textValue;
      }
      function readInventoryAnnotations() {
        try {
          var parsed = JSON.parse(localStorage.getItem(inventoryStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writeInventoryAnnotations(value) {
        localStorage.setItem(inventoryStorageKey(), JSON.stringify(value || {}));
      }
      function saveInventoryField(target) {
        var rowId = target.getAttribute('data-inventory-row-id');
        var field = target.getAttribute('data-inventory-field');
        if (!rowId || !field) return;
        var annotations = readInventoryAnnotations();
        var current = annotations[rowId] && typeof annotations[rowId] === 'object' ? annotations[rowId] : {};
        current[field] = target.value || '';
        current.updated_at = new Date().toISOString();
        annotations[rowId] = current;
        writeInventoryAnnotations(annotations);
        cachedInventoryRows = buildInventoryRows();
        if (field === 'review_status' || field === 'next_review_date') {
          renderInventory();
        } else {
          renderInventorySummary();
        }
      }
      function projectHealthMap() {
        var map = {};
        (Array.isArray(cachedOverview.projectHealth) ? cachedOverview.projectHealth : []).forEach(function(item) {
          if (item && item.project_id) map[item.project_id] = item;
        });
        return map;
      }
      function arrayLength(value) {
        return Array.isArray(value) ? value.filter(Boolean).length : 0;
      }
      function mergePolicy(project, slot) {
        var base = project.caller_lock_policy || {};
        var slug = slot && (slot.slug || slot.provider);
        var override = slug && base.provider_overrides && base.provider_overrides[slug] && typeof base.provider_overrides[slug] === 'object'
          ? base.provider_overrides[slug]
          : {};
        return Object.assign({}, base, override || {});
      }
      function policySummary(policy, project, slot) {
        var checks = [
          project.strict_origin === true,
          arrayLength(policy.allowed_customer_gateways) > 0,
          arrayLength(policy.allowed_methods) > 0,
          arrayLength(policy.allowed_upstream_hosts) > 0 || arrayLength(policy.allowed_upstream_path_prefixes) > 0,
          Boolean(slot && (policy.allowed_providers || []).indexOf(slot.provider) !== -1) || Boolean(slot)
        ];
        var passed = checks.filter(Boolean).length;
        return {
          passed: passed,
          total: checks.length,
          complete: passed >= 4,
          label: passed + '/' + checks.length + ' caller-lock controls'
        };
      }
      function isReviewDue(annotation) {
        if (!annotation || !annotation.next_review_date) return false;
        var reviewTime = new Date(annotation.next_review_date + 'T23:59:59Z').getTime();
        return Number.isFinite(reviewTime) && reviewTime < Date.now();
      }
      function inventoryRowId(project, slot) {
        return project.id + '::' + (slot ? (slot.key_id || slot.slug || slot.provider) : 'missing-provider');
      }
      function inventoryDefaultPath(slot) {
        if (!slot) return 'not mapped';
        return slotIsEmailProvider(slot) ? emailDemoPath(slot) : providerDemoPath(slot);
      }
      function buildInventoryRows() {
        var annotations = readInventoryAnnotations();
        var health = projectHealthMap();
        var rows = [];
        cachedProjects.forEach(function(project) {
          var slots = Array.isArray(project.provider_slots) && project.provider_slots.length ? project.provider_slots : [null];
          slots.forEach(function(slot) {
            var rowId = inventoryRowId(project, slot);
            var annotation = annotations[rowId] && typeof annotations[rowId] === 'object' ? annotations[rowId] : {};
            var projectHealth = health[project.id] || {};
            var policy = mergePolicy(project, slot);
            var coverage = policySummary(policy, project, slot);
            var calls = Number(projectHealth.calls || 0);
            var errors = Number(projectHealth.errors || 0);
            var denied = Number(projectHealth.denied || 0);
            var lastActivity = projectHealth.lastActivity || null;
            var lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : NaN;
            var stale = calls > 0 && Number.isFinite(lastActivityMs) && Date.now() - lastActivityMs > 30 * 24 * 60 * 60 * 1000;
            var statuses = [];
            if (!slot) statuses.push({ label: 'missing provider slot', tone: 'bad' });
            if (slot && slot.material_ready === true && project.strict_origin === true && coverage.complete) statuses.push({ label: 'protected', tone: 'good' });
            if (slot && slot.material_mode === 'demo-placeholder') statuses.push({ label: 'demo placeholder', tone: 'warn' });
            if (!coverage.complete) statuses.push({ label: 'policy incomplete', tone: 'warn' });
            if (!calls) statuses.push({ label: 'no recent traffic', tone: 'warn' });
            if (stale) statuses.push({ label: 'stale', tone: 'warn' });
            if (isReviewDue(annotation) || !annotation.review_status || annotation.review_status === 'needs_review') statuses.push({ label: 'review due', tone: 'warn' });
            if (annotation.review_status === 'approved') statuses.push({ label: 'review approved', tone: 'good' });
            if (annotation.review_status === 'blocked') statuses.push({ label: 'blocked', tone: 'bad' });
            if (annotation.review_status === 'exception') statuses.push({ label: 'exception noted', tone: 'warn' });
            rows.push({
              id: rowId,
              project: {
                id: project.id,
                name: project.name || project.vp_proj_id,
                vp_proj_id: project.vp_proj_id,
                role: project.project_role,
                strict_origin: project.strict_origin === true,
                allowed_origins: project.allowed_origins || null
              },
              provider: slot ? {
                key_id: slot.key_id,
                provider: slot.provider,
                slug: slot.slug || slot.provider,
                material_mode: slot.material_mode || 'missing',
                material_ready: slot.material_ready === true,
                default_path: inventoryDefaultPath(slot)
              } : null,
              policy: {
                caller_lock_controls: coverage.label,
                complete: coverage.complete,
                rate_limit_per_minute: policy.rate_limit_per_minute || null,
                allowed_methods: Array.isArray(policy.allowed_methods) ? policy.allowed_methods : [],
                allowed_upstream_hosts: Array.isArray(policy.allowed_upstream_hosts) ? policy.allowed_upstream_hosts : [],
                allowed_upstream_path_prefixes: Array.isArray(policy.allowed_upstream_path_prefixes) ? policy.allowed_upstream_path_prefixes : [],
                allowed_customer_gateways: Array.isArray(policy.allowed_customer_gateways) ? policy.allowed_customer_gateways : []
              },
              traffic: {
                calls: calls,
                errors: errors,
                denied: denied,
                last_seen_at: lastActivity,
                stale: stale
              },
              annotation: annotation,
              statuses: statuses
            });
          });
        });
        return rows;
      }
      function selectedOption(value, expected) {
        return String(value || '') === expected ? ' selected' : '';
      }
      function inventoryInput(row, field, label, placeholder) {
        var annotation = row.annotation || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="' + escapeHtml(field) + '" value="' + escapeHtml(annotation[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function inventorySelect(row, field, label, options) {
        var annotation = row.annotation || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(annotation[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderInventoryStatusTags(row) {
        return row.statuses.map(function(status) {
          return '<span class="tag ' + escapeHtml(status.tone) + '">' + escapeHtml(status.label) + '</span>';
        }).join('');
      }
      function renderInventoryRow(row) {
        var annotation = row.annotation || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? provider.slug + ' / ' + provider.provider : 'no provider slot';
        var traffic = row.traffic || {};
        var policy = row.policy || {};
        return '<div class="inventory-row" data-inventory-card="' + escapeHtml(row.id) + '">' +
          '<div class="inventory-head"><div><div class="row-title">' + escapeHtml(row.project.name) + ' - ' + escapeHtml(providerLabel) + '</div>' +
          '<div class="row-sub">' + escapeHtml(row.project.vp_proj_id) + ' - default path ' + escapeHtml(provider.default_path || 'not mapped') + ' - last seen ' + escapeHtml(rel(traffic.last_seen_at)) + ' - calls ' + number(traffic.calls) + ' / errors ' + number(traffic.errors) + ' / denied ' + number(traffic.denied) + '</div>' +
          '<div>' + renderInventoryStatusTags(row) + '<span class="tag">' + escapeHtml(policy.caller_lock_controls || 'policy not reported') + '</span><span class="tag">' + escapeHtml(provider.material_mode || 'missing material') + '</span></div></div>' +
          '<div class="row-actions"><a class="tag" href="/app/control">control</a><a class="tag" href="/app/keys">provider slots</a><a class="tag" href="/app/activity">activity</a></div></div>' +
          '<div class="inventory-fields">' +
          inventoryInput(row, 'business_owner', 'business owner', 'Security owner') +
          inventoryInput(row, 'technical_owner', 'technical owner', 'Platform owner') +
          inventorySelect(row, 'environment', 'environment', [
            { value: '', label: 'unset' },
            { value: 'demo', label: 'demo' },
            { value: 'dev', label: 'dev' },
            { value: 'staging', label: 'staging' },
            { value: 'production', label: 'production' }
          ]) +
          inventoryInput(row, 'business_service', 'business service', 'Billing, support, AI assistant') +
          inventorySelect(row, 'data_sensitivity', 'data sensitivity', [
            { value: '', label: 'unset' },
            { value: 'public', label: 'public' },
            { value: 'internal', label: 'internal' },
            { value: 'confidential', label: 'confidential' },
            { value: 'restricted', label: 'restricted' }
          ]) +
          inventorySelect(row, 'risk', 'risk', [
            { value: '', label: 'unset' },
            { value: 'low', label: 'low' },
            { value: 'medium', label: 'medium' },
            { value: 'high', label: 'high' },
            { value: 'critical', label: 'critical' }
          ]) +
          inventorySelect(row, 'review_status', 'review status', [
            { value: 'needs_review', label: 'needs review' },
            { value: 'approved', label: 'approved' },
            { value: 'exception', label: 'exception' },
            { value: 'blocked', label: 'blocked' }
          ]) +
          '<div class="inventory-field"><label>next review</label><input type="date" data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="next_review_date" value="' + escapeHtml(annotation.next_review_date || '') + '" /></div>' +
          '<div class="inventory-field wide"><label>review notes</label><textarea data-inventory-row-id="' + escapeHtml(row.id) + '" data-inventory-field="note" placeholder="Metadata-only note. Do not paste secrets, request bodies, response bodies, or customer payloads.">' + escapeHtml(annotation.note || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>policy evidence</label><div class="row-sub">Origins: ' + escapeHtml(row.project.strict_origin ? 'strict' : 'relaxed') + '. Methods: ' + escapeHtml((policy.allowed_methods || []).join(', ') || 'not set') + '. Hosts: ' + escapeHtml((policy.allowed_upstream_hosts || []).join(', ') || 'not set') + '. Paths: ' + escapeHtml((policy.allowed_upstream_path_prefixes || []).join(', ') || 'not set') + '. Gateways: ' + escapeHtml((policy.allowed_customer_gateways || []).join(', ') || 'not set') + '.</div></div>' +
          '</div></div>';
      }
      function inventorySummary() {
        var rows = cachedInventoryRows;
        return {
          total: rows.length,
          protected: rows.filter(function(row) { return row.statuses.some(function(status) { return status.label === 'protected'; }); }).length,
          missing_provider_slot: rows.filter(function(row) { return !row.provider; }).length,
          policy_incomplete: rows.filter(function(row) { return !row.policy.complete; }).length,
          no_recent_traffic: rows.filter(function(row) { return Number(row.traffic.calls || 0) === 0; }).length,
          review_due: rows.filter(function(row) { return row.statuses.some(function(status) { return status.label === 'review due'; }); }).length,
          blocked: rows.filter(function(row) { return row.annotation && row.annotation.review_status === 'blocked'; }).length
        };
      }
      function inventoryEvidencePacket() {
        var summary = inventorySummary();
        return {
          packet_type: 'vaultproof_enterprise_api_inventory',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/inventory',
          organization_id: currentOrgId || null,
          summary: summary,
          rows: cachedInventoryRows.map(function(row) {
            return {
              id: row.id,
              project: row.project,
              provider: row.provider,
              policy: row.policy,
              traffic: row.traffic,
              annotation: {
                business_owner: row.annotation.business_owner || null,
                technical_owner: row.annotation.technical_owner || null,
                environment: row.annotation.environment || null,
                business_service: row.annotation.business_service || null,
                data_sensitivity: row.annotation.data_sensitivity || null,
                risk: row.annotation.risk || null,
                review_status: row.annotation.review_status || 'needs_review',
                next_review_date: row.annotation.next_review_date || null,
                updated_at: row.annotation.updated_at || null,
                note: redactInventoryNote(row.annotation.note)
              },
              statuses: row.statuses.map(function(status) { return status.label; })
            };
          }),
          workflow_links: {
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            launch: '/app/launch',
            evidence: '/app/evidence',
            audit_csv_30_days: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'),
            access_review_csv: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv')
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function evidenceExportHref(path) {
        if (!currentOrgId) return path;
        var joiner = path.indexOf('?') === -1 ? '?' : '&';
        return path + joiner + 'org=' + encodeURIComponent(currentOrgId);
      }
      function renderInventorySummary() {
        if (PAGE_MODE !== 'inventory') return;
        var summary = inventorySummary();
        byId('inventorySummaryList').innerHTML = [
          '<div class="row"><div><div class="row-title">API inventory status</div><div class="row-sub">' + number(summary.total) + ' metadata-only API surfaces are derived from projects and provider slots. ' + number(summary.protected) + ' currently look protected.</div></div><span class="tag ' + (summary.protected ? 'good' : 'warn') + '">' + number(summary.protected) + ' protected</span></div>',
          '<div class="row"><div><div class="row-title">Open review items</div><div class="row-sub">' + number(summary.missing_provider_slot) + ' missing provider slot, ' + number(summary.policy_incomplete) + ' policy incomplete, ' + number(summary.no_recent_traffic) + ' with no recent traffic, ' + number(summary.review_due) + ' due for review.</div></div><span class="tag warn">review due</span></div>',
          '<div class="row"><div><div class="row-title">Secret boundary</div><div class="row-sub">Inventory records are metadata-only and exclude raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.</div></div><span class="tag good">redacted</span></div>'
        ].join('');
        byId('inventoryWorkflowList').innerHTML = [
          '<div class="row"><div><div class="row-title">Control policy</div><div class="row-sub">Confirm origins, provider allowlists, upstream hosts, path prefixes, gateways, and rate limits.</div></div><a class="tag good" href="/app/control">control</a></div>',
          '<div class="row"><div><div class="row-title">Provider slots</div><div class="row-sub">Review material mode, rotation status, protected email dry-run, and emergency revoke posture.</div></div><a class="tag good" href="/app/keys">provider slots</a></div>',
          '<div class="row"><div><div class="row-title">Traffic and audit evidence</div><div class="row-sub">Use Activity, Audit CSV, and Access Review CSV for customer-safe review exports.</div></div><span><a class="tag" href="/app/activity">activity</a><a class="tag" href="' + escapeHtml(evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30')) + '">audit CSV</a><a class="tag" href="' + escapeHtml(evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv')) + '">access review CSV</a></span></div>',
          '<div class="row"><div><div class="row-title">Launch and evidence packets</div><div class="row-sub">Use Launch and Evidence to show remaining blockers before pilot traffic.</div></div><span><a class="tag" href="/app/launch">launch</a><a class="tag" href="/app/evidence">evidence</a></span></div>'
        ].join('');
      }
      function renderInventory() {
        var panel = byId('inventoryPanel');
        if (panel) panel.style.display = PAGE_MODE === 'inventory' ? 'grid' : 'none';
        if (PAGE_MODE !== 'inventory') return;
        cachedInventoryRows = buildInventoryRows();
        text('inventoryMeta', cachedInventoryRows.length + ' API surfaces');
        byId('inventoryList').innerHTML = cachedInventoryRows.length ? cachedInventoryRows.map(renderInventoryRow).join('') : '<div class="empty">No projects or provider slots are visible yet. Create one project and provider slot before the customer API inventory review.</div>';
        renderInventorySummary();
      }
      function copyInventoryJson() {
        cachedInventoryRows = buildInventoryRows();
        copyToClipboard(JSON.stringify(inventoryEvidencePacket(), null, 2), 'API inventory JSON');
      }
      function policyStorageKey() {
        return 'vaultproof_policy_exceptions::' + (currentOrgId || 'default');
      }
      function readPolicyExceptions() {
        try {
          var parsed = JSON.parse(localStorage.getItem(policyStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writePolicyExceptions(value) {
        localStorage.setItem(policyStorageKey(), JSON.stringify(value || {}));
      }
      function redactPolicyText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key)/i.test(textValue)) {
          return '[redacted: policy note contained secret-like material]';
        }
        return textValue;
      }
      function policyExceptionActive(exception) {
        if (!exception || ['accepted_demo', 'approved'].indexOf(exception.approval_status || '') === -1) return false;
        if (!exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires >= Date.now();
      }
      function policyExceptionExpired(exception) {
        if (!exception || !exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires < Date.now();
      }
      function policySeverityRank(value) {
        return { critical: 4, high: 3, medium: 2, low: 1 }[String(value || '').toLowerCase()] || 0;
      }
      function policyRowStatus(row) {
        var exception = row.exception || {};
        if (exception.approval_status === 'blocked') return 'blocked';
        if (policyExceptionActive(exception)) return exception.approval_status === 'approved' ? 'approved exception' : 'demo accepted';
        if (policyExceptionExpired(exception)) return 'expired exception';
        return 'open drift';
      }
      function policyRowTone(row) {
        var status = policyRowStatus(row);
        if (status === 'approved exception' || status === 'demo accepted') return 'good';
        if (status === 'blocked' || row.severity === 'critical') return 'bad';
        return 'warn';
      }
      function addPolicyRow(rows, inventoryRow, controlId, title, detail, severity, action) {
        var exceptions = readPolicyExceptions();
        var id = inventoryRow.id + '::' + controlId;
        var exception = exceptions[id] && typeof exceptions[id] === 'object' ? exceptions[id] : {};
        rows.push({
          id: id,
          api_surface_id: inventoryRow.id,
          control_id: controlId,
          title: title,
          detail: detail,
          severity: severity,
          action: action,
          project: inventoryRow.project,
          provider: inventoryRow.provider,
          policy: inventoryRow.policy,
          traffic: inventoryRow.traffic,
          inventory_annotation: inventoryRow.annotation || {},
          exception: exception
        });
      }
      function buildPolicyRows() {
        var rows = [];
        buildInventoryRows().forEach(function(inventoryRow) {
          var annotation = inventoryRow.annotation || {};
          var provider = inventoryRow.provider || {};
          var policy = inventoryRow.policy || {};
          var traffic = inventoryRow.traffic || {};
          var ownerMissing = !annotation.business_owner || !annotation.technical_owner;
          if (!inventoryRow.provider) {
            addPolicyRow(rows, inventoryRow, 'missing-provider-slot', 'Missing provider slot', 'This project has no mapped provider slot, so VaultProof cannot prove which upstream API is protected.', 'critical', 'Create a provider slot in /app/keys, then map the caller policy in /app/control.');
          }
          if (inventoryRow.provider && provider.material_mode === 'demo-placeholder') {
            addPolicyRow(rows, inventoryRow, 'demo-placeholder-material', 'Demo-only provider material', 'The provider slot uses demo placeholder material. That is acceptable for a demo only when explicitly accepted and dated.', 'high', 'Rotate to sealed live material before paid customer data, or record a demo-only exception with an expiry.');
          }
          if (inventoryRow.project && inventoryRow.project.strict_origin !== true) {
            addPolicyRow(rows, inventoryRow, 'strict-origin-missing', 'Strict origin not enabled', 'Strict origin enforcement is not active for this project, which weakens browser-origin binding.', 'critical', 'Enable strict origin and confirm allowed origins in /app/control.');
          }
          if (!Array.isArray(policy.allowed_customer_gateways) || policy.allowed_customer_gateways.length === 0) {
            addPolicyRow(rows, inventoryRow, 'gateway-lock-missing', 'Customer gateway lock missing', 'No approved customer gateway marker is visible for this API surface.', 'high', 'Add allowed_customer_gateways in /app/control or document the accepted demo gateway path.');
          }
          if (!Array.isArray(policy.allowed_methods) || policy.allowed_methods.length === 0) {
            addPolicyRow(rows, inventoryRow, 'method-lock-missing', 'Allowed methods not set', 'The caller-lock policy does not report an allowed HTTP method list for this surface.', 'medium', 'Set the smallest allowed method list in /app/control.');
          }
          if ((!Array.isArray(policy.allowed_upstream_hosts) || policy.allowed_upstream_hosts.length === 0) && (!Array.isArray(policy.allowed_upstream_path_prefixes) || policy.allowed_upstream_path_prefixes.length === 0)) {
            addPolicyRow(rows, inventoryRow, 'upstream-scope-missing', 'Upstream scope not set', 'No upstream host or path-prefix restriction is visible for this protected provider path.', 'high', 'Set allowed upstream hosts or path prefixes in /app/control.');
          }
          if (ownerMissing) {
            addPolicyRow(rows, inventoryRow, 'inventory-owner-missing', 'Owner metadata missing', 'Business owner and technical owner are required before a buyer can treat this API as operationally owned.', 'medium', 'Open /app/inventory and set both owners for this API surface.');
          }
          if (Number(traffic.calls || 0) === 0) {
            addPolicyRow(rows, inventoryRow, 'traffic-evidence-missing', 'No recent traffic evidence', 'No proxy traffic is visible for this API surface, so the demo cannot prove live runtime behavior yet.', 'medium', 'Run a dry-run request from /app/keys and review /app/activity.');
          }
          if (traffic.stale) {
            addPolicyRow(rows, inventoryRow, 'traffic-evidence-stale', 'Traffic evidence is stale', 'The last observed proxy activity is older than 30 days.', 'medium', 'Run a fresh dry-run or low-volume test and review /app/activity.');
          }
          if (isReviewDue(annotation) || !annotation.review_status || annotation.review_status === 'needs_review') {
            addPolicyRow(rows, inventoryRow, 'inventory-review-due', 'Inventory review due', 'The API inventory row is not approved or the next review date has passed.', 'medium', 'Approve, block, or record an exception from /app/inventory.');
          }
          if (annotation.review_status === 'blocked') {
            addPolicyRow(rows, inventoryRow, 'inventory-blocked', 'Inventory row blocked', 'The API inventory record is explicitly blocked and should hold launch until resolved.', 'critical', 'Resolve the blocker or record a signed accepted-risk decision with owner and expiry.');
          }
        });
        return rows.sort(function(a, b) {
          return policySeverityRank(b.severity) - policySeverityRank(a.severity) || a.title.localeCompare(b.title);
        });
      }
      function policySelect(row, field, label, options) {
        var exception = row.exception || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(exception[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function policyInput(row, field, label, placeholder) {
        var exception = row.exception || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="' + escapeHtml(field) + '" value="' + escapeHtml(exception[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function renderPolicyRow(row) {
        var exception = row.exception || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? provider.slug + ' / ' + provider.provider : 'no provider slot';
        var status = policyRowStatus(row);
        var tone = policyRowTone(row);
        var expired = policyExceptionExpired(exception);
        return '<div class="inventory-row" data-policy-card="' + escapeHtml(row.id) + '">' +
          '<div class="inventory-head"><div><div class="row-title">' + escapeHtml(row.title) + '</div>' +
          '<div class="row-sub">' + escapeHtml(row.project.name) + ' - ' + escapeHtml(providerLabel) + ' - ' + escapeHtml(row.detail) + '</div>' +
          '<div><span class="tag ' + tone + '">' + escapeHtml(status) + '</span><span class="tag ' + (row.severity === 'critical' ? 'bad' : row.severity === 'high' ? 'warn' : '') + '">' + escapeHtml(row.severity) + '</span><span class="tag">' + escapeHtml(row.control_id) + '</span>' + (expired ? '<span class="tag bad">expired</span>' : '') + '</div></div>' +
          '<div class="row-actions"><a class="tag" href="/app/control">control</a><a class="tag" href="/app/inventory">inventory</a><a class="tag" href="/app/keys">provider slots</a><a class="tag" href="/app/activity">activity</a></div></div>' +
          '<div class="inventory-fields">' +
          policySelect(row, 'approval_status', 'exception status', [
            { value: '', label: 'open' },
            { value: 'accepted_demo', label: 'accepted for demo' },
            { value: 'approved', label: 'approved exception' },
            { value: 'blocked', label: 'blocked' }
          ]) +
          policyInput(row, 'owner', 'exception owner', row.inventory_annotation.technical_owner || row.inventory_annotation.business_owner || 'Security owner') +
          policySelect(row, 'risk_level', 'risk level', [
            { value: '', label: 'unset' },
            { value: 'low', label: 'low' },
            { value: 'medium', label: 'medium' },
            { value: 'high', label: 'high' },
            { value: 'critical', label: 'critical' }
          ]) +
          '<div class="inventory-field"><label>expiration date</label><input type="date" data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="expires_at" value="' + escapeHtml(exception.expires_at || '') + '" /></div>' +
          '<div class="inventory-field wide"><label>accepted-risk reason</label><textarea data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="reason" placeholder="Metadata only. Do not paste secrets, request bodies, response bodies, or customer payloads.">' + escapeHtml(exception.reason || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>compensating control</label><textarea data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="compensating_control" placeholder="Temporary control, monitoring owner, or rollout guardrail.">' + escapeHtml(exception.compensating_control || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>next action</label><textarea data-policy-row-id="' + escapeHtml(row.id) + '" data-policy-field="next_action" placeholder="' + escapeHtml(row.action) + '">' + escapeHtml(exception.next_action || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>recommended action</label><div class="row-sub">' + escapeHtml(row.action) + '</div></div>' +
          '</div></div>';
      }
      function savePolicyField(target, rerender) {
        var rowId = target.getAttribute('data-policy-row-id');
        var field = target.getAttribute('data-policy-field');
        if (!rowId || !field) return;
        var exceptions = readPolicyExceptions();
        var current = exceptions[rowId] && typeof exceptions[rowId] === 'object' ? exceptions[rowId] : {};
        current[field] = target.value || '';
        current.updated_at = new Date().toISOString();
        exceptions[rowId] = current;
        writePolicyExceptions(exceptions);
        cachedPolicyRows = buildPolicyRows();
        if (rerender || field === 'approval_status' || field === 'expires_at') {
          renderPolicy();
        } else {
          renderPolicySummary();
        }
      }
      function policySummary() {
        var rows = cachedPolicyRows;
        var activeExceptions = rows.filter(function(row) { return policyExceptionActive(row.exception); });
        var criticalOpen = rows.filter(function(row) {
          return (row.severity === 'critical' || row.severity === 'high') && !policyExceptionActive(row.exception) && policyRowStatus(row) !== 'blocked';
        });
        return {
          total: rows.length,
          critical: rows.filter(function(row) { return row.severity === 'critical'; }).length,
          high: rows.filter(function(row) { return row.severity === 'high'; }).length,
          active_exceptions: activeExceptions.length,
          expired_exceptions: rows.filter(function(row) { return policyExceptionExpired(row.exception); }).length,
          blocked: rows.filter(function(row) { return policyRowStatus(row) === 'blocked'; }).length,
          launch_status: criticalOpen.length || rows.some(function(row) { return policyRowStatus(row) === 'blocked'; }) ? 'hold' : 'ready'
        };
      }
      function policyEvidencePacket() {
        var summary = policySummary();
        return {
          packet_type: 'vaultproof_enterprise_policy_drift',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/policy',
          organization_id: currentOrgId || null,
          status: summary.launch_status,
          summary: summary,
          rows: cachedPolicyRows.map(function(row) {
            return {
              id: row.id,
              api_surface_id: row.api_surface_id,
              control_id: row.control_id,
              title: row.title,
              severity: row.severity,
              status: policyRowStatus(row),
              project: row.project,
              provider: row.provider,
              action: row.action,
              exception: {
                approval_status: row.exception.approval_status || null,
                owner: row.exception.owner || null,
                risk_level: row.exception.risk_level || null,
                expires_at: row.exception.expires_at || null,
                updated_at: row.exception.updated_at || null,
                reason: redactPolicyText(row.exception.reason),
                compensating_control: redactPolicyText(row.exception.compensating_control),
                next_action: redactPolicyText(row.exception.next_action)
              }
            };
          }),
          workflow_links: {
            policy_drift: '/app/policy',
            api_inventory: '/app/inventory',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            launch: '/app/launch',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function renderPolicySummary() {
        if (PAGE_MODE !== 'policy') return;
        var summary = policySummary();
        byId('policySummaryList').innerHTML = [
          '<div class="row"><div><div class="row-title">Policy drift status</div><div class="row-sub">' + number(summary.total) + ' drift rows, ' + number(summary.critical) + ' critical, ' + number(summary.high) + ' high, ' + number(summary.active_exceptions) + ' active accepted-risk records.</div></div><span class="tag ' + (summary.launch_status === 'ready' ? 'good' : 'bad') + '">' + escapeHtml(summary.launch_status) + '</span></div>',
          '<div class="row"><div><div class="row-title">Exception hygiene</div><div class="row-sub">' + number(summary.expired_exceptions) + ' expired exceptions and ' + number(summary.blocked) + ' blocked rows. Every paid-user exception needs owner, reason, compensating control, expiration date, and next action.</div></div><span class="tag warn">review</span></div>',
          '<div class="row"><div><div class="row-title">Secret boundary</div><div class="row-sub">Policy drift evidence excludes raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.</div></div><span class="tag good">redacted</span></div>'
        ].join('');
        byId('policyWorkflowList').innerHTML = [
          '<div class="row"><div><div class="row-title">Close policy gaps</div><div class="row-sub">Fix strict origin, gateway lock, method lock, upstream scope, and provider-slot posture in Control and Provider Slots.</div></div><span><a class="tag good" href="/app/control">control</a><a class="tag good" href="/app/keys">provider slots</a></span></div>',
          '<div class="row"><div><div class="row-title">Own every API surface</div><div class="row-sub">Use API Inventory to set business owner, technical owner, data sensitivity, risk, review status, and next review date.</div></div><a class="tag good" href="/app/inventory">inventory</a></div>',
          '<div class="row"><div><div class="row-title">Prove runtime behavior</div><div class="row-sub">Run dry-run or low-volume traffic and review Activity before the customer walkthrough.</div></div><a class="tag" href="/app/activity">activity</a></div>',
          '<div class="row"><div><div class="row-title">Launch packet</div><div class="row-sub">Export vaultproof_enterprise_policy_drift into Evidence and Security Review before paid traffic.</div></div><span><a class="tag" href="/app/evidence">evidence</a><a class="tag" href="/app/security-review">security review</a></span></div>'
        ].join('');
      }
      function renderPolicy() {
        var panel = byId('policyPanel');
        if (panel) panel.style.display = PAGE_MODE === 'policy' ? 'grid' : 'none';
        if (PAGE_MODE !== 'policy') return;
        cachedPolicyRows = buildPolicyRows();
        text('policyMeta', cachedPolicyRows.length + ' drift rows');
        byId('policyList').innerHTML = cachedPolicyRows.length ? cachedPolicyRows.map(renderPolicyRow).join('') : '<div class="empty">No active policy drift is visible from the current projects, provider slots, inventory metadata, policy settings, and traffic evidence.</div>';
        renderPolicySummary();
      }
      function copyPolicyJson() {
        cachedPolicyRows = buildPolicyRows();
        copyToClipboard(JSON.stringify(policyEvidencePacket(), null, 2), 'Policy drift JSON');
      }
      function rolloutStorageKey() {
        return 'vaultproof_integration_rollouts::' + (currentOrgId || 'default');
      }
      function readRolloutState() {
        try {
          var parsed = JSON.parse(localStorage.getItem(rolloutStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function writeRolloutState(value) {
        localStorage.setItem(rolloutStorageKey(), JSON.stringify(value || {}));
      }
      function redactRolloutText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:)/i.test(textValue)) {
          return '[redacted: rollout note contained secret-like material]';
        }
        return textValue;
      }
      function rolloutPercent(value) {
        var parsed = Number(value || 0);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
      function rolloutSnippet(row) {
        if (!row.provider) return 'Create a provider slot before generating the protected-call snippet.';
        var slug = row.provider.slug || row.provider.provider || 'provider';
        var path = '/api/v1/enterprise/projects/' + encodeURIComponent(row.project.id) + '/providers/' + encodeURIComponent(slug) + '/execute';
        var headers = {
          authorization: 'Bearer YOUR_VAULTPROOF_SESSION_JWT',
          'content-type': 'application/json',
          'x-vaultproof-organization': currentOrgId || 'YOUR_ORGANIZATION_ID',
          'x-vaultproof-customer-gateway': 'vaultproof-managed',
          'x-vaultproof-client-class': 'server'
        };
        var body = {
          method: 'GET',
          upstream_path: row.provider.default_path || '/',
          dry_run: true
        };
        return [
          'fetch(' + JSON.stringify(location.origin + path) + ', {',
          '  method: "POST",',
          '  headers: ' + JSON.stringify(headers, null, 2).replace(/\\n/g, '\\n  ') + ',',
          '  body: JSON.stringify(' + JSON.stringify(body, null, 2).replace(/\\n/g, '\\n  ') + ')',
          '}).then(async (response) => ({',
          '  status: response.status,',
          '  body: await response.json().catch(() => null)',
          '}));'
        ].join('\\n');
      }
      function rolloutBlockers(row, state, policyRows) {
        var blockers = [];
        var annotation = row.annotation || {};
        var canary = rolloutPercent(state.canary_percent);
        var testStatus = state.test_status || 'not_started';
        var openCriticalPolicy = policyRows.filter(function(policyRow) {
          return (policyRow.severity === 'critical' || policyRow.severity === 'high') && policyRowStatus(policyRow) !== 'approved exception' && policyRowStatus(policyRow) !== 'demo accepted';
        });
        if (!row.provider) blockers.push('missing provider slot');
        if (row.provider && row.provider.material_mode === 'demo-placeholder') blockers.push('demo-only provider material');
        if (!row.policy || row.policy.complete !== true) blockers.push('caller-lock policy incomplete');
        if (annotation.review_status === 'blocked') blockers.push('API inventory row blocked');
        if (!annotation.business_owner || !annotation.technical_owner) blockers.push('API inventory owners missing');
        if (!state.application) blockers.push('application/workload name missing');
        if (!state.integration_mode) blockers.push('integration mode missing');
        if (!state.app_owner) blockers.push('app owner missing');
        if (!state.gateway_owner) blockers.push('gateway owner missing');
        if (!state.target_date) blockers.push('target date missing');
        if (!state.rollback_owner || !state.rollback_path) blockers.push('rollback owner/path missing');
        if (Number(row.traffic && row.traffic.calls || 0) === 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('dry-run or traffic evidence missing');
        if (canary > 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('canary needs test evidence');
        if (openCriticalPolicy.length) blockers.push(openCriticalPolicy.length + ' critical/high policy drift rows');
        if (state.rollout_status === 'blocked') blockers.push('rollout manually blocked');
        return blockers;
      }
      function rolloutStatus(row) {
        var blockers = row.blockers || [];
        var state = row.rollout || {};
        var canary = rolloutPercent(state.canary_percent);
        if (state.rollout_status === 'rollback') return 'rollback';
        if (blockers.length) return 'hold';
        if (state.rollout_status === 'live' || state.test_status === 'live_verified') return 'live';
        if (state.test_status === 'canary_passed' || canary > 0) return 'canary';
        if (state.test_status === 'dry_run_passed' || state.test_status === 'denial_passed') return 'ready_for_canary';
        if (state.application || state.integration_mode || state.app_owner || state.gateway_owner) return 'planned';
        return 'draft';
      }
      function rolloutTone(status) {
        if (status === 'live' || status === 'ready_for_canary') return 'good';
        if (status === 'hold' || status === 'rollback') return 'bad';
        return 'warn';
      }
      function buildRolloutRows() {
        var rolloutState = readRolloutState();
        var inventoryRows = buildInventoryRows();
        var policyRows = buildPolicyRows();
        return inventoryRows.map(function(row) {
          var state = rolloutState[row.id] && typeof rolloutState[row.id] === 'object' ? rolloutState[row.id] : {};
          var relatedPolicyRows = policyRows.filter(function(policyRow) { return policyRow.api_surface_id === row.id; });
          var blockers = rolloutBlockers(row, state, relatedPolicyRows);
          return {
            id: row.id,
            project: row.project,
            provider: row.provider,
            policy: row.policy,
            traffic: row.traffic,
            inventory_annotation: row.annotation || {},
            policy_drift: relatedPolicyRows.map(function(policyRow) {
              return { id: policyRow.id, title: policyRow.title, severity: policyRow.severity, status: policyRowStatus(policyRow) };
            }),
            rollout: state,
            blockers: blockers
          };
        });
      }
      function rolloutInput(row, field, label, placeholder) {
        var state = row.rollout || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><input data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="' + escapeHtml(field) + '" value="' + escapeHtml(state[field] || '') + '" placeholder="' + escapeHtml(placeholder || '') + '" /></div>';
      }
      function rolloutSelect(row, field, label, options) {
        var state = row.rollout || {};
        return '<div class="inventory-field"><label>' + escapeHtml(label) + '</label><select data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="' + escapeHtml(field) + '">' + options.map(function(option) {
          return '<option value="' + escapeHtml(option.value) + '"' + selectedOption(state[field], option.value) + '>' + escapeHtml(option.label) + '</option>';
        }).join('') + '</select></div>';
      }
      function renderRolloutRow(row) {
        var state = row.rollout || {};
        var provider = row.provider || {};
        var providerLabel = row.provider ? provider.slug + ' / ' + provider.provider : 'no provider slot';
        var status = rolloutStatus(row);
        var blockers = row.blockers || [];
        return '<div class="inventory-row" data-rollout-card="' + escapeHtml(row.id) + '">' +
          '<div class="inventory-head"><div><div class="row-title">' + escapeHtml(state.application || row.inventory_annotation.business_service || row.project.name) + '</div>' +
          '<div class="row-sub">' + escapeHtml(row.project.name) + ' - ' + escapeHtml(providerLabel) + ' - canary ' + rolloutPercent(state.canary_percent) + '% - last seen ' + escapeHtml(rel(row.traffic && row.traffic.last_seen_at)) + '</div>' +
          '<div><span class="tag ' + rolloutTone(status) + '">' + escapeHtml(status) + '</span><span class="tag">' + escapeHtml(state.integration_mode || 'integration mode unset') + '</span><span class="tag">' + escapeHtml(state.test_status || 'test not started') + '</span><span class="tag ' + (blockers.length ? 'bad' : 'good') + '">' + blockers.length + ' blockers</span></div></div>' +
          '<div class="row-actions"><button type="button" data-action="copy-rollout-snippet" data-rollout-row-id="' + escapeHtml(row.id) + '">copy snippet</button><a class="tag" href="/app/control">control</a><a class="tag" href="/app/policy">policy</a><a class="tag" href="/app/activity">activity</a></div></div>' +
          '<div class="inventory-fields">' +
          rolloutInput(row, 'application', 'application/workload', row.inventory_annotation.business_service || 'Customer billing API') +
          rolloutSelect(row, 'environment', 'environment', [
            { value: '', label: 'unset' },
            { value: 'demo', label: 'demo' },
            { value: 'dev', label: 'dev' },
            { value: 'staging', label: 'staging' },
            { value: 'production', label: 'production' }
          ]) +
          rolloutSelect(row, 'integration_mode', 'integration mode', [
            { value: '', label: 'unset' },
            { value: 'vaultproof_proxy', label: 'VaultProof proxy' },
            { value: 'customer_gateway', label: 'customer gateway' },
            { value: 'sdk', label: 'SDK' },
            { value: 'sidecar', label: 'sidecar' },
            { value: 'manual_test', label: 'manual test' }
          ]) +
          rolloutSelect(row, 'rollout_status', 'rollout status', [
            { value: '', label: 'draft' },
            { value: 'planned', label: 'planned' },
            { value: 'in_progress', label: 'in progress' },
            { value: 'canary', label: 'canary' },
            { value: 'live', label: 'live' },
            { value: 'blocked', label: 'blocked' },
            { value: 'rollback', label: 'rollback' }
          ]) +
          rolloutInput(row, 'app_owner', 'app owner', row.inventory_annotation.technical_owner || 'Application owner') +
          rolloutInput(row, 'gateway_owner', 'gateway owner', 'Platform owner') +
          '<div class="inventory-field"><label>target date</label><input type="date" data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="target_date" value="' + escapeHtml(state.target_date || '') + '" /></div>' +
          rolloutInput(row, 'support_window', 'support window', 'Launch week / business hours') +
          '<div class="inventory-field"><label>canary percent</label><input type="number" min="0" max="100" step="1" data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="canary_percent" value="' + escapeHtml(state.canary_percent || '') + '" placeholder="0" /></div>' +
          rolloutSelect(row, 'test_status', 'test status', [
            { value: 'not_started', label: 'not started' },
            { value: 'dry_run_passed', label: 'dry-run passed' },
            { value: 'denial_passed', label: 'denial passed' },
            { value: 'canary_passed', label: 'canary passed' },
            { value: 'live_verified', label: 'live verified' },
            { value: 'failed', label: 'failed' }
          ]) +
          rolloutInput(row, 'rollback_owner', 'rollback owner', 'Ops owner') +
          '<div class="inventory-field wide"><label>rollback path</label><textarea data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="rollback_path" placeholder="How to return traffic to the previous direct provider path or pause the workload.">' + escapeHtml(state.rollback_path || '') + '</textarea></div>' +
          '<div class="inventory-field wide"><label>blockers</label><div class="row-sub">' + escapeHtml(blockers.length ? blockers.join('; ') : 'No derived blockers. Review customer change window and support plan before live traffic.') + '</div></div>' +
          '<div class="inventory-field wide"><label>rollout note</label><textarea data-rollout-row-id="' + escapeHtml(row.id) + '" data-rollout-field="note" placeholder="Metadata-only note. Do not paste tokens, request bodies, response bodies, keys, or customer payloads.">' + escapeHtml(state.note || '') + '</textarea></div>' +
          '</div></div>';
      }
      function saveRolloutField(target, rerender) {
        var rowId = target.getAttribute('data-rollout-row-id');
        var field = target.getAttribute('data-rollout-field');
        if (!rowId || !field) return;
        var state = readRolloutState();
        var current = state[rowId] && typeof state[rowId] === 'object' ? state[rowId] : {};
        current[field] = target.value || '';
        current.updated_at = new Date().toISOString();
        state[rowId] = current;
        writeRolloutState(state);
        cachedRolloutRows = buildRolloutRows();
        if (rerender || ['rollout_status', 'test_status', 'canary_percent', 'target_date'].indexOf(field) !== -1) {
          renderRollout();
        } else {
          renderRolloutSummary();
        }
      }
      function rolloutSummary() {
        var rows = cachedRolloutRows;
        return {
          total: rows.length,
          live: rows.filter(function(row) { return rolloutStatus(row) === 'live'; }).length,
          canary: rows.filter(function(row) { return rolloutStatus(row) === 'canary'; }).length,
          ready_for_canary: rows.filter(function(row) { return rolloutStatus(row) === 'ready_for_canary'; }).length,
          hold: rows.filter(function(row) { return rolloutStatus(row) === 'hold'; }).length,
          draft: rows.filter(function(row) { return rolloutStatus(row) === 'draft'; }).length,
          blocker_count: rows.reduce(function(total, row) { return total + (row.blockers || []).length; }, 0)
        };
      }
      function rolloutEvidencePacket() {
        var summary = rolloutSummary();
        return {
          packet_type: 'vaultproof_enterprise_integration_rollout',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/rollout',
          organization_id: currentOrgId || null,
          status: summary.hold ? 'hold' : summary.live || summary.ready_for_canary || summary.canary ? 'ready' : 'draft',
          summary: summary,
          rows: cachedRolloutRows.map(function(row) {
            var state = row.rollout || {};
            return {
              id: row.id,
              status: rolloutStatus(row),
              project: row.project,
              provider: row.provider,
              traffic: row.traffic,
              blockers: row.blockers,
              policy_drift: row.policy_drift,
              rollout: {
                application: state.application || null,
                environment: state.environment || null,
                integration_mode: state.integration_mode || null,
                rollout_status: state.rollout_status || null,
                app_owner: state.app_owner || null,
                gateway_owner: state.gateway_owner || null,
                target_date: state.target_date || null,
                support_window: state.support_window || null,
                canary_percent: rolloutPercent(state.canary_percent),
                test_status: state.test_status || 'not_started',
                rollback_owner: state.rollback_owner || null,
                rollback_path: redactRolloutText(state.rollback_path),
                note: redactRolloutText(state.note),
                updated_at: state.updated_at || null
              },
              snippet_preview: row.provider ? 'Copy-safe dry-run snippet available from /app/rollout. Uses YOUR_VAULTPROOF_SESSION_JWT placeholder only.' : 'Provider slot required before snippet is available.'
            };
          }),
          workflow_links: {
            rollout_manager: '/app/rollout',
            api_inventory: '/app/inventory',
            policy_drift: '/app/policy',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            launch: '/app/launch',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function renderRolloutSummary() {
        if (PAGE_MODE !== 'rollout') return;
        var summary = rolloutSummary();
        byId('rolloutSummaryList').innerHTML = [
          '<div class="row"><div><div class="row-title">Rollout status</div><div class="row-sub">' + number(summary.total) + ' candidate workloads, ' + number(summary.ready_for_canary) + ' ready for canary, ' + number(summary.canary) + ' in canary, ' + number(summary.live) + ' live, ' + number(summary.hold) + ' on hold.</div></div><span class="tag ' + (summary.hold ? 'bad' : 'good') + '">' + (summary.hold ? 'hold' : 'ready') + '</span></div>',
          '<div class="row"><div><div class="row-title">Blockers</div><div class="row-sub">' + number(summary.blocker_count) + ' derived blockers across rollout rows. Close policy drift, owners, rollback, target date, and dry-run evidence before production traffic.</div></div><span class="tag warn">review</span></div>',
          '<div class="row"><div><div class="row-title">Secret boundary</div><div class="row-sub">Rollout records and snippets use placeholders and exclude raw provider keys, encrypted shares, bearer tokens, OAuth secrets, SAML material, request bodies, response bodies, and customer payloads.</div></div><span class="tag good">redacted</span></div>'
        ].join('');
        byId('rolloutWorkflowList').innerHTML = [
          '<div class="row"><div><div class="row-title">Choose first workload</div><div class="row-sub">Pick one API inventory row, set app/gateway owners, select the integration mode, and define the target date.</div></div><a class="tag good" href="/app/inventory">inventory</a></div>',
          '<div class="row"><div><div class="row-title">Close rollout blockers</div><div class="row-sub">Resolve policy drift, provider material, caller lock, dry-run evidence, and rollback gaps before canary.</div></div><span><a class="tag" href="/app/policy">policy</a><a class="tag" href="/app/control">control</a></span></div>',
          '<div class="row"><div><div class="row-title">Run copy-safe test</div><div class="row-sub">Use the snippet button for a dry-run request with VaultProof auth placeholders, gateway marker, and no raw provider key.</div></div><a class="tag" href="/app/keys">provider slots</a></div>',
          '<div class="row"><div><div class="row-title">Launch evidence</div><div class="row-sub">Export vaultproof_enterprise_integration_rollout into Evidence and Security Review before live traffic.</div></div><span><a class="tag" href="/app/evidence">evidence</a><a class="tag" href="/app/launch">launch</a></span></div>'
        ].join('');
      }
      function renderRollout() {
        var panel = byId('rolloutPanel');
        if (panel) panel.style.display = PAGE_MODE === 'rollout' ? 'grid' : 'none';
        if (PAGE_MODE !== 'rollout') return;
        cachedRolloutRows = buildRolloutRows();
        text('rolloutMeta', cachedRolloutRows.length + ' candidate workloads');
        byId('rolloutList').innerHTML = cachedRolloutRows.length ? cachedRolloutRows.map(renderRolloutRow).join('') : '<div class="empty">No API inventory rows are visible yet. Create one project and provider slot before building the customer rollout plan.</div>';
        renderRolloutSummary();
      }
      function copyRolloutJson() {
        cachedRolloutRows = buildRolloutRows();
        copyToClipboard(JSON.stringify(rolloutEvidencePacket(), null, 2), 'Integration rollout JSON');
      }
      function copyRolloutSnippet(target) {
        var rowId = target.getAttribute('data-rollout-row-id');
        var row = cachedRolloutRows.find(function(item) { return item.id === rowId; });
        if (!row) {
          notice('Rollout row is not visible. Refresh and try again.');
          return;
        }
        copyToClipboard(rolloutSnippet(row), 'Integration rollout dry-run snippet');
      }
      function renderProjects() {
        byId('projectsPanel').style.display = PAGE_MODE === 'projects' ? 'grid' : 'none';
        if (PAGE_MODE !== 'projects') return;
        text('projectMeta', cachedProjects.length + ' active projects');
        var projectList = byId('projectList');
        projectList.innerHTML = cachedProjects.length ? cachedProjects.map(function(project) {
          var policy = project.caller_lock_policy || {};
          var providers = (project.provider_slots || []).map(function(slot) { return slot.slug || slot.provider; });
          var liveSlots = (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'sealed-live'; }).length;
          var demoSlots = (project.provider_slots || []).filter(function(slot) { return slot.material_mode === 'demo-placeholder'; }).length;
          return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id) + '</div><div class="row-sub">' + escapeHtml(project.vp_proj_id) + ' - ' + escapeHtml(project.project_role) + ' via ' + escapeHtml(project.access_via) + ' - created ' + escapeHtml(rel(project.created_at)) + '</div><div><span class="tag ' + (project.strict_origin ? 'good' : 'warn') + '">' + (project.strict_origin ? 'strict origin' : 'origin relaxed') + '</span><span class="tag">' + providers.length + ' provider slots</span><span class="tag ' + (liveSlots ? 'good' : 'warn') + '">' + liveSlots + ' live sealed</span><span class="tag ' + (demoSlots ? 'warn' : '') + '">' + demoSlots + ' demo</span><span class="tag">' + (policy.rate_limit_per_minute ? policy.rate_limit_per_minute + '/min' : 'no project rate cap') + '</span></div></div><a class="tag" href="/app/control">control</a></div>';
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
      function renderApiProxyTestKit(rows) {
        var panel = byId('apiProxyTestPanel');
        if (panel) panel.style.display = PAGE_MODE === 'keys' ? 'block' : 'none';
        var list = byId('apiProxyTestList');
        if (!list || PAGE_MODE !== 'keys') return;
        text('apiProxyTestMeta', rows.length ? rows.length + ' slot self-tests' : 'copy-safe');
        list.innerHTML = rows.length ? rows.slice(0, 8).map(function(item) {
          var slug = item.slot.slug || item.slot.provider;
          var materialMode = item.slot.material_mode || 'missing';
          var materialClass = materialMode === 'sealed-live' ? 'good' : materialMode === 'demo-placeholder' ? 'warn' : 'bad';
          var denyButton = slotIsEmailProvider(item.slot) ? '<button type="button" data-action="copy-proxy-deny-test" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(slug) + '">copy blocked-recipient request</button>' : '';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(slug) + ' API proxy self-test</div><div class="row-sub">POST /api/v1/enterprise/projects/' + escapeHtml(item.project.id) + '/providers/' + escapeHtml(slug) + '/execute - dry-run request with VaultProof auth, gateway marker, client class, and organization header. No raw provider key is copied into the customer app.</div><div><span class="tag ' + materialClass + '">' + escapeHtml(materialMode) + '</span><span class="tag good">YOUR_VAULTPROOF_SESSION_JWT</span><span class="tag">x-vaultproof-customer-gateway</span><span class="tag">audit evidence</span></div></div><div class="row-actions"><button type="button" class="primary" data-action="copy-proxy-dry-run" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(slug) + '">copy dry-run request</button>' + denyButton + '</div></div>';
        }).join('') : '<div class="empty">No provider slots are visible yet. Add a demo provider slot before sharing the customer API proxy self-test kit.</div>';
      }
      function renderKeys() {
        byId('keysPanel').style.display = PAGE_MODE === 'keys' ? 'block' : 'none';
        if (byId('emailKeyDemoPanel')) byId('emailKeyDemoPanel').style.display = PAGE_MODE === 'keys' ? 'grid' : 'none';
        if (PAGE_MODE !== 'keys') return;
        var rows = [];
        cachedProjects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) {
            rows.push({ project: project, slot: slot });
          });
        });
        renderApiProxyTestKit(rows);
        text('keyMeta', rows.length + ' active provider slots');
        var emailRows = rows.filter(function(item) { return slotIsEmailProvider(item.slot); });
        if (byId('emailKeyDemoList')) {
          byId('emailKeyDemoList').innerHTML = emailRows.length ? emailRows.map(function(item) {
            var materialMode = item.slot.material_mode || 'missing';
            var materialClass = materialMode === 'sealed-live' ? 'good' : materialMode === 'demo-placeholder' ? 'warn' : 'bad';
            var action = '<button type="button" class="primary" data-action="email-dry-run" data-project-id="' + escapeHtml(item.project.id) + '" data-provider="' + escapeHtml(item.slot.provider) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">protected email dry-run</button><button type="button" data-action="email-deny-test" data-project-id="' + escapeHtml(item.project.id) + '" data-provider="' + escapeHtml(item.slot.provider) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">blocked recipient test</button>';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(emailProviderLabel(item.slot.provider)) + ' protected send</div><div class="row-sub">' + escapeHtml(item.project.name || item.project.vp_proj_id) + ' - path ' + escapeHtml(emailDemoPath(item.slot)) + ' - material ' + escapeHtml(materialMode) + '</div><div><span class="tag ' + materialClass + '">' + escapeHtml(materialMode) + '</span><span class="tag good">no raw key in browser</span><span class="tag">audit evidence</span><span class="tag warn">recipient allowlist</span></div></div>' + action + '</div>';
          }).join('') : '<div class="row"><div><div class="row-title">No email provider key protected yet</div><div class="row-sub">Create a Resend, SendGrid, Mailgun, Postmark, or AWS SES provider slot, then run protected email dry-run before the customer demo.</div><div><span class="tag warn">required for demo</span><span class="tag">raw keys stay out</span></div></div><button type="button" class="primary" data-action="prefill-email-slot">create resend slot</button></div>';
        }
        byId('keyList').innerHTML = rows.length ? rows.map(function(item) {
          var policy = item.project.caller_lock_policy || {};
          var override = policy.provider_overrides && policy.provider_overrides[item.slot.slug || item.slot.provider];
          var canAdmin = item.project.project_role === 'owner' || item.project.project_role === 'admin';
          var emailAction = slotIsEmailProvider(item.slot) ? '<button type="button" data-action="email-dry-run" data-project-id="' + escapeHtml(item.project.id) + '" data-provider="' + escapeHtml(item.slot.provider) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">protected email dry-run</button>' : '';
          var revokeAction = canAdmin ? '<button type="button" class="danger" data-action="revoke-slot" data-project-id="' + escapeHtml(item.project.id) + '" data-slug="' + escapeHtml(item.slot.slug || item.slot.provider) + '">emergency revoke</button>' : '<span class="tag warn">read-only</span>';
          var action = emailAction + revokeAction;
          var materialMode = item.slot.material_mode || 'missing';
          var materialClass = materialMode === 'sealed-live' ? 'good' : materialMode === 'demo-placeholder' ? 'warn' : 'bad';
          var materialLabel = materialMode === 'sealed-live' ? 'live sealed material' : materialMode === 'demo-placeholder' ? 'demo placeholder material' : materialMode === 'mixed' ? 'mixed material state' : 'material missing';
          var secretKind = slotIsEmailProvider(item.slot) ? 'email API key' : 'provider API key';
          return '<div class="row"><div><div class="row-title">' + escapeHtml(item.slot.slug || item.slot.provider) + '</div><div class="row-sub">' + escapeHtml(item.project.name || item.project.vp_proj_id) + ' - provider ' + escapeHtml(item.slot.provider) + ' - key id ' + escapeHtml(item.slot.key_id) + '</div><div><span class="tag good">active</span><span class="tag">' + escapeHtml(secretKind) + '</span><span class="tag ' + materialClass + '">' + materialLabel + '</span><span class="tag">' + (override ? 'provider override' : 'project policy') + '</span><span class="tag">rotation: manual checklist</span><span class="tag">SKR: executor-bound</span></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">' + action + '</div></div>';
        }).join('') : '<div class="empty">No active provider slots found.</div>';
      }
      function syncProviderDefaults(force) {
        var providerInput = byId('slotProvider');
        if (!providerInput) return;
        var provider = String(providerInput.value || '').trim().toLowerCase();
        var defaults = providerDefaults[provider];
        if (!defaults) return;
        var slug = byId('slotSlug');
        var upstream = byId('slotUpstream');
        var header = byId('slotHeaderName');
        var template = byId('slotHeaderTemplate');
        if (slug && (force || !slug.value || providerDefaults[slug.value])) slug.value = provider;
        if (upstream && (force || !upstream.value)) upstream.value = defaults.upstream;
        if (header && (force || !header.value)) header.value = defaults.header;
        if (template && (force || !template.value)) template.value = defaults.template;
      }
      function setProviderSlotFormVisible(visible) {
        var panel = byId('providerSlotFormPanel');
        if (!panel) return;
        panel.style.display = visible ? 'block' : 'none';
        if (visible) {
          renderProjectOptions();
          syncProviderDefaults(false);
          var provider = byId('slotProvider');
          if (provider) provider.focus();
        }
      }
      async function submitProviderSlotForm(event) {
        event.preventDefault();
        var projectId = byId('slotProject') && byId('slotProject').value;
        if (!projectId) {
          notice('Choose a project first.');
          return;
        }
        var payload = {
          provider: byId('slotProvider').value,
          slug: byId('slotSlug').value,
          upstream_base_url: byId('slotUpstream').value,
          auth_header_name: byId('slotHeaderName').value,
          auth_header_template: byId('slotHeaderTemplate').value
        };
        try {
          await fetchJson('/api/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/providers', {
            method: 'POST',
            body: JSON.stringify(payload)
          });
          setProviderSlotFormVisible(false);
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Provider slot could not be created.');
        }
      }
      function emailExecuteRequest(target, options) {
        var projectId = target.getAttribute('data-project-id');
        var slug = target.getAttribute('data-slug');
        var provider = target.getAttribute('data-provider') || slug;
        var payload = demoEmailPayload({ provider: provider, slug: slug }, options || {});
        return {
          path: '/api/v1/enterprise/projects/' + encodeURIComponent(projectId) + '/providers/' + encodeURIComponent(slug) + '/execute',
          body: {
            method: 'POST',
            upstream_path: emailDemoPath({ provider: provider, slug: slug }),
            headers: { 'content-type': 'application/json' },
            body_base64: toBase64Utf8(JSON.stringify(payload)),
            dry_run: true
          }
        };
      }
      async function runProtectedEmailDryRun(target) {
        var request = emailExecuteRequest(target);
        try {
          var result = await fetchJson(request.path, {
            method: 'POST',
            headers: {
              'x-vaultproof-customer-gateway': 'vaultproof-managed',
              'x-vaultproof-client-class': 'browser'
            },
            body: JSON.stringify(request.body)
          });
          notice('Protected email dry-run validated: ' + (result.execution && result.execution.requestId ? result.execution.requestId : 'accepted') + '. Raw email provider key was not exposed.');
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Protected email dry-run failed.');
        }
      }
      async function runProtectedEmailDenialTest(target) {
        var request = emailExecuteRequest(target, { blocked: true });
        try {
          var res = await fetch(request.path, {
            method: 'POST',
            headers: Object.assign(headers(), {
              'x-vaultproof-customer-gateway': 'vaultproof-managed',
              'x-vaultproof-client-class': 'browser'
            }),
            body: JSON.stringify(request.body)
          });
          var payload = await res.json().catch(function() { return null; });
          if (res.status === 403) {
            notice('Policy denial evidence recorded: ' + friendlyErrorMessage((payload && payload.error) || 'blocked recipient rejected') + '.');
          } else if (res.ok) {
            notice('Blocked recipient test was accepted. Add an email recipient-domain or recipient allowlist before using this as the denial demo.');
          } else {
            notice(friendlyErrorMessage((payload && payload.error) || ('Blocked recipient test failed: ' + res.status)));
          }
          await reload();
        } catch (error) {
          notice(error && error.message ? error.message : 'Blocked recipient test failed.');
        }
      }
      function prefillEmailSlot() {
        setProviderSlotFormVisible(true);
        if (byId('slotProvider')) byId('slotProvider').value = 'resend';
        syncProviderDefaults(true);
      }
      function findProviderItem(projectId, slug) {
        var found = null;
        cachedProjects.forEach(function(project) {
          if (found || project.id !== projectId) return;
          (project.provider_slots || []).forEach(function(slot) {
            var slotSlug = slot.slug || slot.provider;
            if (!found && slotSlug === slug) found = { project: project, slot: slot };
          });
        });
        return found;
      }
      function copyProxySelfTest(target, options) {
        var item = findProviderItem(target.getAttribute('data-project-id'), target.getAttribute('data-slug'));
        if (!item) {
          notice('Provider slot is not visible. Refresh the page and try again.');
          return;
        }
        copyToClipboard(proxySelfTestSnippet(item.project, item.slot, options || {}), options && options.blocked ? 'Blocked-recipient self-test request' : 'Dry-run self-test request');
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          var bootstrap = await fetchJson('/api/v1/enterprise/projects/bootstrap');
          renderOrgSelector(bootstrap);
          cachedProjects = Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
          cachedOverview = bootstrap.overview || {};
          updateKpis();
          renderProjectOptions();
          renderProjects();
          renderInventory();
          renderPolicy();
          renderRollout();
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
      if (byId('openProviderSlotForm')) {
        byId('openProviderSlotForm').addEventListener('click', function() { setProviderSlotFormVisible(true); });
      }
      if (byId('cancelProviderSlotForm')) {
        byId('cancelProviderSlotForm').addEventListener('click', function() { setProviderSlotFormVisible(false); });
      }
      if (byId('providerSlotForm')) {
        byId('providerSlotForm').addEventListener('submit', submitProviderSlotForm);
      }
      if (byId('slotProvider')) {
        byId('slotProvider').addEventListener('change', function() { syncProviderDefaults(true); });
      }
      if (byId('copyInventoryJsonBtn')) {
        byId('copyInventoryJsonBtn').addEventListener('click', copyInventoryJson);
      }
      if (byId('copyPolicyJsonBtn')) {
        byId('copyPolicyJsonBtn').addEventListener('click', copyPolicyJson);
      }
      if (byId('copyRolloutJsonBtn')) {
        byId('copyRolloutJsonBtn').addEventListener('click', copyRolloutJson);
      }
      document.addEventListener('input', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-inventory-field')) {
          saveInventoryField(target);
          return;
        }
        if (target.getAttribute('data-policy-field')) {
          savePolicyField(target, false);
          return;
        }
        if (target.getAttribute('data-rollout-field')) {
          saveRolloutField(target, false);
        }
      });
      document.addEventListener('change', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-inventory-field')) {
          saveInventoryField(target);
          return;
        }
        if (target.getAttribute('data-policy-field')) {
          savePolicyField(target, true);
          return;
        }
        if (target.getAttribute('data-rollout-field')) {
          saveRolloutField(target, true);
        }
      });
      document.addEventListener('click', async function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.getAttribute('data-action') === 'copy-rollout-snippet') {
          copyRolloutSnippet(target);
          return;
        }
        if (target.getAttribute('data-action') === 'prefill-email-slot') {
          prefillEmailSlot();
          return;
        }
        if (target.getAttribute('data-action') === 'email-dry-run') {
          await runProtectedEmailDryRun(target);
          return;
        }
        if (target.getAttribute('data-action') === 'email-deny-test') {
          await runProtectedEmailDenialTest(target);
          return;
        }
        if (target.getAttribute('data-action') === 'copy-proxy-dry-run') {
          copyProxySelfTest(target);
          return;
        }
        if (target.getAttribute('data-action') === 'copy-proxy-deny-test') {
          copyProxySelfTest(target, { blocked: true });
          return;
        }
        if (target.getAttribute('data-action') !== 'revoke-slot') return;
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

type EnterpriseSupportPageName = 'setup' | 'launch' | 'evidence' | 'demo' | 'technical-guide' | 'security-review' | 'verifier' | 'settings' | 'plans' | 'pilot' | 'pilot-success' | 'scanner' | 'support' | 'runbooks';

function renderEnterpriseSupportPage(pageName: EnterpriseSupportPageName): string {
  const supportPageCopy: Record<EnterpriseSupportPageName, { title: string; kicker: string; lead: string }> = {
    setup: {
      title: 'Enterprise setup guide',
      kicker: 'welcome to VaultProof',
      lead: 'Welcome to VaultProof Enterprise, and congratulations on starting your secure workspace. This guide is for enterprise teams with many apps, environments, owners, and provider integrations. Use it to map your environment, connect identity, choose a gateway pattern, protect provider keys, prove readiness, and operate VaultProof safely.',
    },
    launch: {
      title: 'Launch checklist',
      kicker: 'customer go-live',
      lead: 'Turn the enterprise setup plan into a working customer launch board. Track readiness, owners, policy, evidence, alerts, and rollout actions before sending real customer traffic.',
    },
    evidence: {
      title: 'Evidence packet',
      kicker: 'customer proof',
      lead: 'Assemble the proof a customer security team asks for first: runtime readiness, access review, audit exports, provider posture, policy workflow, and a downloadable JSON packet scoped to the selected organization.',
    },
    demo: {
      title: 'Demo script',
      kicker: 'customer walkthrough',
      lead: 'Run a repeatable buyer demo that shows active key protection, a safe email API key story, runtime evidence, launch blockers, pricing packaging, and the next paid-pilot step without exposing secrets.',
    },
    'technical-guide': {
      title: 'Technical guide',
      kicker: 'implementation details',
      lead: 'Deep implementation reference for identity, gateways, project modeling, caller lock, key custody, evidence, operations, rollout, and troubleshooting. Use it when technical teams need the exact wiring behind the setup guide.',
    },
    'security-review': {
      title: 'Security review packet',
      kicker: 'buyer review',
      lead: 'Give security, procurement, and technical reviewers a concise customer-safe packet: architecture summary, control coverage, evidence links, open launch items, and copyable review answers without exposing secrets.',
    },
    verifier: {
      title: 'AI Proof Verifier',
      kicker: 'verifier-first evidence',
      lead: 'Register models that run outside VaultProof, submit proof bundles from those external jobs, verify the evidence, and tie demo results to the shared enterprise runtime attestation, project policy, RBAC, and audit.',
    },
    settings: {
      title: 'Settings',
      kicker: 'tenant defaults',
      lead: 'Review tenant defaults, organization identity, SSO state, and production readiness from the enterprise control plane.',
    },
    plans: {
      title: 'Plans',
      kicker: 'enterprise packaging',
      lead: 'Track enterprise rollout packaging, GCP edge readiness, usage posture, and contract-facing guardrails.',
    },
    pilot: {
      title: 'Pilot proposal',
      kicker: 'first customer',
      lead: 'Shape the first paid pilot into a clear buyer proposal: one workload, one owner group, one provider path, price, support boundary, success metric, and go-live guardrails.',
    },
    'pilot-success': {
      title: 'Pilot success tracker',
      kicker: 'customer proof',
      lead: 'Track the pilot from kickoff to expansion decision with live readiness signals, browser-local milestone evidence, proof links, blockers, and a copyable weekly customer update.',
    },
    scanner: {
      title: 'Scanner',
      kicker: 'repository security',
      lead: 'Prepare repository scanning for enterprise use while keeping scanner actions disabled until enterprise-safe scanner APIs are available.',
    },
    support: {
      title: 'Launch support room',
      kicker: 'customer support',
      lead: 'Package the founder-led support model for a customer pilot: who owns launch-week follow-up, what evidence support can inspect, which actions require approval, and where the internal admin console begins and ends.',
    },
    runbooks: {
      title: 'Runbooks',
      kicker: 'operator commands',
      lead: 'Review production verification, evidence, deploy, secret, DNS, edge, SSH, and cleanup runbooks before making live infrastructure changes.',
    },
  };
  const pageTitle = supportPageCopy[pageName].title;
  const pageKicker = supportPageCopy[pageName].kicker;
  const pageLead = supportPageCopy[pageName].lead;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>${escapeHtml(pageTitle)} - VaultProof Enterprise</title>
  <style>
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    select, button, input, textarea { border: 1px solid var(--line); background: rgba(255,255,255,.78); color: var(--text); border-radius: 13px; padding: 11px 12px; font: inherit; }
    input::placeholder, textarea::placeholder { color: rgba(52,81,76,.48); }
    textarea { min-height: 120px; resize: vertical; line-height: 1.45; }
    option { color: #111827; }
    button { cursor: pointer; }
    button[disabled] { cursor: not-allowed; opacity: .58; }
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
    .card { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,250,244,.86)); border-radius: 24px; padding: 20px; box-shadow: 0 22px 90px rgba(48,76,71,.16); }
    .doc-guide { display: none; max-width: 940px; }
    .doc-section { border: 1px solid var(--line); background: linear-gradient(180deg, rgba(48,76,71,.12), rgba(247,250,244,.76)); border-radius: 24px; padding: 24px; margin-bottom: 18px; box-shadow: 0 22px 90px rgba(48,76,71,.12); }
    .doc-section h2 { margin: 0 0 10px; font-size: 26px; letter-spacing: -.045em; }
    .doc-section h3 { margin: 18px 0 8px; font-size: 16px; letter-spacing: -.02em; color: var(--text); }
    .doc-section p { margin: 0 0 12px; color: var(--muted); line-height: 1.68; }
    .doc-section ul, .doc-section ol { margin: 10px 0 0; padding-left: 22px; color: var(--muted); line-height: 1.68; }
    .doc-section li { margin: 7px 0; }
    .doc-section code { color: var(--gold); }
    .doc-note { border-left: 3px solid var(--gold); padding: 12px 14px; margin-top: 14px; border-radius: 0 14px 14px 0; background: rgba(213,169,20,.08); color: var(--text); }
    .doc-note strong { color: var(--gold); }
    .doc-kicker { display: block; color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .14em; font-weight: 850; margin-bottom: 8px; }
    .launch-progress { height: 11px; border-radius: 999px; background: rgba(48,76,71,.12); overflow: hidden; margin-top: 16px; }
    .launch-progress span { display: block; height: 100%; width: 0; background: linear-gradient(135deg, var(--green), var(--primary-bg)); border-radius: inherit; transition: width 180ms ease; }
    .launch-check-row { display: grid; grid-template-columns: 22px 1fr auto; gap: 12px; align-items: start; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .launch-check-row input { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--green); }
    .launch-check-title { font-weight: 780; letter-spacing: -.02em; }
    .launch-check-sub { color: var(--muted); font-size: 13px; line-height: 1.45; margin-top: 5px; }
    .launch-check-row[data-complete="true"] { border-color: rgba(62,93,87,.24); background: rgba(143,224,193,.11); }
    .go-decision { display: grid; gap: 8px; margin-bottom: 14px; }
    .go-decision-title { font-size: 24px; font-weight: 850; letter-spacing: -.045em; }
    .go-evidence-row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 12px; align-items: start; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .go-evidence-row input[type="checkbox"] { width: 18px; height: 18px; margin: 2px 0 0; accent-color: var(--green); }
    .go-evidence-row[data-complete="true"] { border-color: rgba(62,93,87,.24); background: rgba(143,224,193,.11); }
    .go-note { width: 100%; min-height: 42px; margin-top: 10px; padding: 10px 11px; border: 1px solid var(--line); border-radius: 13px; background: rgba(255,255,255,.78); color: var(--text); font: inherit; }
    .go-status { width: 100%; min-width: 118px; border: 1px solid var(--line); border-radius: 999px; background: rgba(255,255,255,.78); color: var(--text); font: inherit; font-size: 12px; padding: 8px 10px; }
    .go-action { display: block; color: var(--muted); font-size: 12px; margin-top: 7px; line-height: 1.45; }
    .go-action code { color: var(--gold); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere; word-break: break-word; }
    .evidence-callout { display: grid; gap: 10px; border: 1px solid rgba(62,93,87,.22); background: rgba(143,224,193,.10); border-radius: 18px; padding: 16px; }
    .evidence-callout strong { font-size: 18px; letter-spacing: -.03em; }
    .evidence-actions { display: flex; gap: 10px; flex-wrap: wrap; }
    .brief-box { width: 100%; min-height: 210px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; font-size: 12px; line-height: 1.55; }
    .demo-script { min-height: 330px; }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); font-size: 13px; margin-top: 6px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -.03em; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .row { display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: start; border: 1px solid rgba(48,76,71,.10); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.84); }
    .row-title { font-weight: 780; letter-spacing: -.02em; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 5px; line-height: 1.45; }
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(22,138,159,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(62,93,87,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(213,169,20,.28); }
    .tag.bad { color: var(--red); border-color: rgba(185,93,80,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(48,76,71,.22); border-radius: 18px; padding: 18px; background: rgba(247,250,244,.78); }
    .notice.error { color: var(--red); border-color: rgba(185,93,80,.3); }
    @media (max-width: 1100px) { .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .kpis, .two, .launch-check-row, .go-evidence-row, .row { grid-template-columns: 1fr; } .go-evidence-row > span:last-child { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } .go-status { width: auto; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar(pageName, pageKicker)}

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

      <section id="supportKpis" class="grid kpis">
        <div class="card"><div class="kpi-label">production</div><div class="kpi-value" id="kpiProduction">...</div><div class="kpi-sub">control plane + executor</div></div>
        <div class="card"><div class="kpi-label">projects</div><div class="kpi-value" id="kpiProjects">...</div><div class="kpi-sub">active scopes</div></div>
        <div class="card"><div class="kpi-label">members</div><div class="kpi-value" id="kpiMembers">...</div><div class="kpi-sub" id="kpiOrgRole">org role</div></div>
        <div class="card"><div class="kpi-label">calls</div><div class="kpi-value" id="kpiCalls">...</div><div class="kpi-sub">proxy traffic</div></div>
      </section>

      <section id="launchPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Launch progress</h2><span class="mini" id="launchProgressMeta">0 of 0</span></div>
          <div class="kpi-value" id="launchProgressValue">0%</div>
          <div class="launch-progress" aria-hidden="true"><span id="launchProgressBar"></span></div>
          <p class="mini" id="launchProgressCopy" style="margin-top:14px">Loading launch state...</p>
        </div>
        <div class="card">
          <div class="section-title"><h2>Launch package</h2><span class="mini">live checks</span></div>
          <div id="launchSummaryList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Go/No-Go Readiness</h2><span class="mini" id="goNoGoMeta">hold</span></div>
          <div id="goNoGoDecision" class="evidence-callout go-decision"></div>
          <div id="goNoGoList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Identity/OAuth evidence packet</h2><span class="mini" id="identityQaMeta">hold</span></div>
          <div id="identityQaList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Key rotation evidence packet</h2><span class="mini" id="keyRotationMeta">hold</span></div>
          <div id="keyRotationList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Pilot operations evidence packet</h2><span class="mini" id="pilotOpsMeta">hold</span></div>
          <div id="pilotOpsList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer tasks</h2><span class="mini">saved in this browser</span></div>
          <div id="launchChecklist" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Next actions</h2><span class="mini">customer workflow</span></div>
          <div id="launchActions" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Launch brief</h2>
            <button id="copyLaunchBriefBtn" type="button">copy brief</button>
          </div>
          <textarea id="launchBrief" class="brief-box" readonly aria-label="Launch brief"></textarea>
        </div>
      </section>

      <section id="evidencePanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Evidence readiness</h2><span class="mini" id="evidenceMeta">live packet</span></div>
          <div id="evidenceReadinessList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer exports</h2><span class="mini">review links</span></div>
          <div id="evidenceExportList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Proof inventory</h2><span class="mini">current scope</span></div>
          <div id="evidenceProofList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Review workflow</h2><span class="mini">customer handoff</span></div>
          <div id="evidenceWorkflowList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Identity/OAuth proof</h2><span class="mini" id="evidenceIdentityMeta">hold</span></div>
          <div id="evidenceIdentityList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Key rotation proof</h2><span class="mini" id="evidenceKeyRotationMeta">hold</span></div>
          <div id="evidenceKeyRotationList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Pilot operations proof</h2><span class="mini" id="evidencePilotOpsMeta">hold</span></div>
          <div id="evidencePilotOpsList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>API proxy self-test proof</h2><span class="mini" id="evidenceApiProxyMeta">hold</span></div>
          <div id="evidenceApiProxyList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>API inventory proof</h2><span class="mini" id="evidenceApiInventoryMeta">hold</span></div>
          <div id="evidenceApiInventoryList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Policy drift proof</h2><span class="mini" id="evidencePolicyDriftMeta">hold</span></div>
          <div id="evidencePolicyDriftList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Integration rollout proof</h2><span class="mini" id="evidenceRolloutMeta">hold</span></div>
          <div id="evidenceRolloutList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Launch support proof</h2><span class="mini" id="evidenceSupportMeta">hold</span></div>
          <div id="evidenceSupportList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Monitoring evidence proof</h2><span class="mini" id="evidenceMonitoringMeta">hold</span></div>
          <div id="evidenceMonitoringList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Evidence packet JSON</h2>
            <div class="evidence-actions">
              <button id="copyEvidencePacketBtn" type="button">copy JSON</button>
              <button id="downloadEvidencePacketBtn" type="button">download JSON</button>
            </div>
          </div>
          <div class="evidence-callout" style="margin-bottom:14px">
            <strong>Safe customer packet</strong>
            <span class="mini">This summary is generated in the browser from existing enterprise APIs and does not include provider keys, encrypted shares, Supabase service-role keys, origin-lock values, signing secrets, or raw executor internals.</span>
          </div>
          <textarea id="evidencePacket" class="brief-box" readonly aria-label="Evidence packet JSON"></textarea>
        </div>
      </section>

      <section id="demoPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Demo objective</h2><span class="mini" id="demoMeta">buyer flow</span></div>
          <div id="demoObjectiveList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Live proof path</h2><span class="mini">show these in order</span></div>
          <div id="demoPathList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Buyer proof points</h2><span class="mini">why it matters</span></div>
          <div id="demoProofList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Safety guardrails</h2><span class="mini">demo only</span></div>
          <div id="demoGuardrailList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Objection answers</h2><span class="mini">customer Q&A</span></div>
          <div id="demoObjectionList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Close path</h2><span class="mini">paid pilot</span></div>
          <div id="demoCloseList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable demo talk track</h2>
            <button id="copyDemoScriptBtn" type="button">copy script</button>
          </div>
          <textarea id="demoScript" class="brief-box demo-script" readonly aria-label="Demo talk track"></textarea>
        </div>
      </section>

      <section id="supportPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Support readiness</h2><span id="supportMeta" class="mini">customer pilot</span></div>
          <div id="supportReadinessList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Internal admin boundary</h2><span class="mini">employee only</span></div>
          <div id="supportBoundaryList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Launch-week workflow</h2><span class="mini">founder-led</span></div>
          <div id="supportWorkflowList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Customer handoff</h2><span class="mini">what to share</span></div>
          <div id="supportHandoffList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Support brief</h2>
            <button id="copySupportBriefBtn" type="button">copy brief</button>
          </div>
          <textarea id="supportBrief" class="brief-box" readonly aria-label="Support brief"></textarea>
        </div>
      </section>

      <section id="setupPanel" class="doc-guide" style="display:none">
        <article class="doc-section">
          <span class="doc-kicker">Read first</span>
          <h2>Start here</h2>
          <p>VaultProof setup is not just a button click. In a large enterprise, the hard part is deciding which teams, apps, provider keys, environments, gateways, and security owners should be allowed to use protected provider access.</p>
          <p>Use this page like an implementation document. Work through it from top to bottom, then return to the dashboard pages when you are ready to configure the live account.</p>
          <ol>
            <li>Confirm the workspace and readiness status.</li>
            <li>Map environments, apps, owners, providers, and sensitive flows.</li>
            <li>Connect identity and assign least-privilege access.</li>
            <li>Choose the gateway and network pattern.</li>
            <li>Create projects, provider slots, caller-lock rules, and rate limits.</li>
            <li>Validate with dry-run traffic before real provider calls.</li>
            <li>Export evidence, test alerts, and launch one workload at a time.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Live status</span>
          <h2>Current workspace status</h2>
          <p>These values come from the selected organization and the live confidential runtime. If something looks wrong, select the correct organization and refresh before changing policy.</p>
          <div id="setupStatusList" class="list"></div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Before setup</span>
          <h2>What your team should prepare</h2>
          <p>Gather this before production configuration. It saves a lot of rework later, especially when security, identity, app teams, and network teams are all involved.</p>
          <ul>
            <li>Business owner, security owner, identity owner, network owner, developer owner, and incident contact.</li>
            <li>Production, staging, development, sandbox, regional, subsidiary, and regulated environment list.</li>
            <li>Provider inventory: provider name, account, API family, current key location, owner, rotation date, and leak blast radius.</li>
            <li>Compliance needs: SOC 2 evidence, access reviews, audit exports, retention requirements, and customer-specific proof.</li>
            <li>Gateway preference: VaultProof-managed edge, customer-managed gateway, mTLS gateway, device gateway, or direct trusted edge path.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 1</span>
          <h2>Map your enterprise environment</h2>
          <p>Create VaultProof projects around real business and security boundaries. Do not put unrelated production and development apps into the same project just because they use the same provider.</p>
          <h3>For each workload, write down:</h3>
          <ul>
            <li>Environment, application name, business purpose, and owning team.</li>
            <li>Calling origin, gateway marker, CIDR, device fleet, or mTLS identity.</li>
            <li>Allowed provider, upstream host, HTTP methods, and path prefixes.</li>
            <li>Expected request volume, rate-limit needs, and incident priority.</li>
            <li>Whether the flow handles regulated, financial, customer, production automation, or other sensitive data.</li>
          </ul>
          <div class="doc-note"><strong>Rule of thumb:</strong> if two workloads need different owners, approval flows, provider keys, rate limits, or audit reviews, they should usually be separate projects.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 2</span>
          <h2>Configure identity and access</h2>
          <p>Use company identity for enterprise access. VaultProof currently supports Microsoft Entra ID through the Supabase SAML session path, while VaultProof still enforces organization membership, project permissions, caller lock, and execution policy.</p>
          <ul>
            <li>Owners approve the organization, admins, SSO rollout, and go-live timing.</li>
            <li>Admins manage projects, members, provider slots, and policy.</li>
            <li>Security reviewers inspect readiness, audit, access reviews, alerts, and evidence.</li>
            <li>Developers and operators configure project rules and troubleshoot runtime activity.</li>
            <li>Viewers can inspect posture without changing policy.</li>
          </ul>
          <p>Use access-review exports before rollout, after major org changes, and on a recurring schedule. Keep a documented break-glass admin path outside normal SSO changes.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 3</span>
          <h2>Choose the gateway and network pattern</h2>
          <p>The gateway pattern decides which system is trusted to identify callers before VaultProof signs secure execution requests.</p>
          <h3>VaultProof-managed gateway</h3>
          <p>Fastest path. Customer apps call <code>enterprise.vaultproof.dev</code>, and VaultProof manages GCP edge controls, coarse rate limits, origin lock, request-size guards, and telemetry.</p>
          <h3>Customer-managed gateway</h3>
          <p>Use this when the customer requires all SaaS or API traffic through their own API gateway. The customer gateway validates identity, device, subscription, or mTLS policy first, then forwards trusted caller-lock headers to VaultProof.</p>
          <h3>mTLS or device gateway</h3>
          <p>Use this for server, device, IoT, or fleet traffic. Caller lock can use certificate thumbprints, certificate subject fragments, device identity hashes, fleet IDs, firmware versions, CIDRs, and gateway markers.</p>
          <div class="doc-note"><strong>Later hardening:</strong> plan TLS-origin cutover, gateway cutover, private-origin migration, and rollback during a controlled change window after the basic production path is stable.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 4</span>
          <h2>Configure projects, provider slots, and policy</h2>
          <p>Projects define who can use protected provider access and under what rules. Provider slots hold the protected provider connection state. Policy decides which callers and upstream requests are allowed.</p>
          <ul>
            <li>Allow only the provider families each project needs.</li>
            <li>Bind execution to approved origins, gateways, CIDRs, devices, fleets, firmware versions, mTLS identities, methods, hosts, and paths.</li>
            <li>Set expected request volume before production so rate limits reduce blast radius from bugs, leaked client tokens, or compromised apps.</li>
            <li>Give each provider slot an owner, purpose, rotation date, and emergency revoke path.</li>
          </ul>
          <p>Provider keys should not be visible in the dashboard. Enterprise execution reconstructs provider key material only inside confidential execution memory and zeroes plaintext after use.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 5</span>
          <h2>Validate with dry-run traffic</h2>
          <p>Dry-run first. Before real provider calls, use dry-run or validate-only execution to prove auth, organization access, project policy, caller lock, request signing, executor reachability, and audit metadata.</p>
          <p>Dry-run is successful when the request is accepted by policy, audit metadata is written, the secure executor is reachable, and provider dispatch is intentionally skipped.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 6</span>
          <h2>Evidence, alerts, and compliance</h2>
          <p>Enterprise security teams need proof, not promises. Before go-live, confirm production readiness, audit CSV export, access-review CSV export, alert delivery, and attestation evidence.</p>
          <ul>
            <li>Use <code>/readiness</code> to confirm GCP edge, control plane, executor, attestation, Cloud KMS posture, replay protection, and origin lock.</li>
            <li>Use Audit for governance/runtime events and evidence-friendly CSV export.</li>
            <li>Use Members for access-review export.</li>
            <li>Configure alert destinations and send a test alert.</li>
            <li>Decide who receives key leak, emergency revoke, readiness drift, denial spike, provider error, and runtime availability notifications.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Step 7</span>
          <h2>Go live gradually</h2>
          <p>Do not move every app at once. Start with one low-risk production workload, one provider path, and a known traffic volume.</p>
          <ol>
            <li>Confirm readiness is production-ready.</li>
            <li>Confirm SSO/admin access works.</li>
            <li>Confirm provider slot and policy are locked.</li>
            <li>Send low-volume traffic.</li>
            <li>Watch Activity, Audit, Alerts, readiness, provider denials, and provider errors.</li>
            <li>Expand by project only after the first workload is stable.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Reference</span>
          <h2>Pages used during setup</h2>
          <p>Use these pages when the document tells you to configure or verify a specific area.</p>
          <div id="setupReferenceList" class="list"></div>
        </article>
      </section>

      <section id="technicalGuidePanel" class="doc-guide" style="display:none">
        <article class="doc-section">
          <span class="doc-kicker">Audience</span>
          <h2>Who should use this guide</h2>
          <p>This guide is for the people who need to connect VaultProof to a real enterprise environment: identity admins, network teams, platform engineers, app owners, security reviewers, compliance owners, and incident responders.</p>
          <p>The setup guide explains what to do in order. This technical guide explains why each part exists, what system owns it, what data crosses the boundary, and what questions technical teams usually ask before approving production traffic.</p>
          <div class="doc-note"><strong>Keep the setup page simple:</strong> use this page when someone asks for architecture, trust boundaries, identity flow, gateway behavior, key custody, attestation, audit evidence, or troubleshooting details.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Architecture</span>
          <h2>Architecture at a glance</h2>
          <p>VaultProof Enterprise separates the customer-facing control plane from the secure execution path. The control plane handles organization access, projects, policies, members, audit, alerts, and dashboards. The executor handles protected provider calls and key release inside the GCP confidential runtime.</p>
          <ol>
            <li>A user signs in to the enterprise dashboard and receives an enterprise session.</li>
            <li>The dashboard calls only <code>/api/v1/enterprise/*</code> APIs on the enterprise control plane.</li>
            <li>The control plane checks organization membership, project access, policy state, and request signing rules.</li>
            <li>Approved execution requests are sent to the secure executor over the internal enterprise path.</li>
            <li>The executor verifies the request signature, replay protection, caller-lock metadata, attestation posture, and key-release readiness.</li>
            <li>Provider key material is protected through the configured Cloud KMS path and is used inside the confidential runtime.</li>
            <li>Governance, runtime, alerts, readiness, and evidence events are recorded for review and export.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Identity</span>
          <h2>Identity and authorization model</h2>
          <p>Enterprise users should use company identity. Today the customer-facing path is Microsoft Entra ID SSO through Supabase SAML session brokering. Supabase provides the browser session and JWT validation surface; VaultProof still controls organization membership, project roles, audit events, and policy enforcement.</p>
          <h3>What Entra ID owns</h3>
          <ul>
            <li>Corporate user identity, MFA, conditional access, device posture, and identity lifecycle.</li>
            <li>Who can use the customer enterprise app, based on the customer identity team policy.</li>
            <li>SAML assertions sent into the brokered session path.</li>
          </ul>
          <h3>What VaultProof owns</h3>
          <ul>
            <li>Organization membership, project-level access, dashboard authorization, and audit records.</li>
            <li>Role model for owners, admins, security reviewers, developers/operators, and viewers.</li>
            <li>Caller-lock policy, provider-slot policy, rate limits, evidence exports, and emergency revoke actions.</li>
          </ul>
          <p>This means a user can authenticate successfully but still be blocked if they are not a member of the VaultProof organization or do not have access to the requested project.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Network</span>
          <h2>Gateway and network patterns</h2>
          <p>The gateway identifies the caller before VaultProof allows protected provider access. A customer can start with the VaultProof-managed path and later move to a customer-managed gateway, mTLS, device gateway, or private-origin pattern.</p>
          <h3>VaultProof-managed GCP edge/gateway</h3>
          <p>Good for fast pilots and standard SaaS rollout. VaultProof manages edge routing, health checks, origin lock, coarse rate limiting, request-size controls, telemetry, and rollback steps.</p>
          <h3>Customer-managed API gateway</h3>
          <p>Good when the business requires every API to pass through its own gateway. The customer gateway validates subscriptions, Entra JWTs, private network controls, mTLS, device policy, and customer rate limits before forwarding trusted caller-lock headers to VaultProof.</p>
          <h3>mTLS, device, and fleet gateways</h3>
          <p>Good for servers, devices, IoT, or internal agents. Caller lock can bind policy to certificate thumbprints, certificate subjects, device IDs, firmware versions, fleet IDs, CIDRs, and gateway markers.</p>
          <h3>Private origin path</h3>
          <p>Use this for a hardened production phase after the basic path is stable. The target state is to remove public origin exposure, keep GCP edge/gateway as the allowed ingress, and maintain a separate break-glass operations path.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Projects</span>
          <h2>Project modeling and environment boundaries</h2>
          <p>Projects should match security and ownership boundaries, not just product names. Separate projects are usually better when workloads have different owners, environments, provider accounts, compliance needs, rate limits, or incident response owners.</p>
          <ul>
            <li>Separate production, staging, development, sandbox, regulated, regional, and subsidiary workloads when they have different risk.</li>
            <li>Use one project for one clear business purpose and one owner group.</li>
            <li>Assign project members by least privilege, then use access-review exports before and after launch.</li>
            <li>Keep provider slots scoped to the exact project that needs them.</li>
          </ul>
          <p>A strong project model makes incident response easier because VaultProof can show which caller, project, provider slot, and policy allowed or blocked the traffic.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Key custody</span>
          <h2>Provider key custody and Cloud KMS</h2>
          <p>VaultProof is designed so raw provider keys do not sit in customer app code, environment variables, browser storage, logs, or ordinary dashboard views. The enterprise executor uses GCP confidential computing and Cloud KMS so protected material is only released to the expected measured runtime.</p>
          <ul>
            <li>The GCP confidential VM reports attestation evidence through GCP attestation.</li>
            <li>The key-release policy binds release to measured runtime attributes and policy hash.</li>
            <li>The executor verifies request signatures and replay protection before using protected material.</li>
            <li>Plaintext provider material is kept inside the execution process and cleared after use.</li>
            <li>Provider slots track owner, purpose, rotation state, and emergency revoke posture.</li>
          </ul>
          <div class="doc-note"><strong>Important:</strong> key release readiness is not the same as business approval. Technical readiness proves the runtime can release securely; organization policy still decides whether a project is allowed to use a provider.</div>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Policy</span>
          <h2>Caller lock and execution policy</h2>
          <p>Caller lock is the set of facts that prove the request came through the expected application, gateway, network, device, or certificate path. Execution policy is the rule set that decides what provider access is allowed after identity and caller lock pass.</p>
          <h3>Common caller-lock inputs</h3>
          <ul>
            <li>Allowed origins, gateway headers, gateway markers, CIDRs, mTLS certificate thumbprints, device IDs, fleet IDs, firmware versions, and service identities.</li>
            <li>Allowed upstream hosts, path prefixes, HTTP methods, provider families, and rate limits.</li>
            <li>Required dry-run mode during validation and launch windows.</li>
          </ul>
          <p>The goal is simple: a stolen app token or leaked browser session should not be enough to use a protected provider key from the wrong network, origin, device, gateway, or project.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Evidence</span>
          <h2>Evidence, logs, exports, and audit</h2>
          <p>Enterprise teams need evidence for security reviews, incident response, customer questionnaires, and compliance handoff. VaultProof records both governance events and runtime events so teams can answer who changed access, what policy applied, which provider slot was used, and whether the confidential runtime was production-ready.</p>
          <ul>
            <li><code>/readiness</code> proves current production posture for control plane and executor.</li>
            <li>Audit CSV exports governance/runtime events for compliance review.</li>
            <li>Access-review CSV exports members, roles, and project assignments.</li>
            <li>Activity shows runtime status codes, provider request IDs, denial reasons, latency, and attestation summaries.</li>
            <li>Runbooks capture evidence bundles and validate them before handoff.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Operations</span>
          <h2>Alerts and incident response</h2>
          <p>Alerts should go to teams that can act quickly. A useful launch setup usually includes security operations, platform operations, app owners, and an incident commander path.</p>
          <ul>
            <li>Send test alerts before go-live and after changing alert destinations.</li>
            <li>Alert on key leak reports, emergency revoke, readiness drift, denial spikes, provider errors, execution failures, and unusual traffic volume.</li>
            <li>Use emergency revoke when a provider key, project, or caller path is suspected to be unsafe.</li>
            <li>Use audit and activity together: audit explains governance changes; activity explains runtime behavior.</li>
          </ul>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Rollout</span>
          <h2>Rollout and validation flow</h2>
          <ol>
            <li>Confirm the organization, SSO path, break-glass path, and project owner.</li>
            <li>Create the project, provider slot, caller lock, allowlisted upstreams, and rate limits.</li>
            <li>Run dry-run execution until auth, policy, signing, executor reachability, and audit metadata pass.</li>
            <li>Verify production readiness, evidence export, access review export, and alert delivery.</li>
            <li>Send low-volume production traffic for one workload and one provider path.</li>
            <li>Watch Activity, Alerts, Audit, provider errors, denials, and readiness.</li>
            <li>Expand project by project after the first workload is stable.</li>
          </ol>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Troubleshooting</span>
          <h2>Troubleshooting map</h2>
          <h3>User cannot sign in</h3>
          <p>Check Entra assignment, Supabase SAML configuration, invite status, organization membership, browser session storage, and whether the user is on the expected enterprise hostname.</p>
          <h3>User can sign in but sees no data</h3>
          <p>Check organization membership, active organization selection, project assignments, role level, and API auth errors in the browser network tab.</p>
          <h3>Dry-run fails</h3>
          <p>Check bearer token, selected organization, project role, caller-lock inputs, provider allowlist, upstream method/host/path, request signature, and executor reachability.</p>
          <h3>Readiness is not production-ready</h3>
          <p>Open <code>/readiness</code>, then use Runbooks for verifier, evidence, key-release, attestation, DNS, edge, SSH, and origin-lock checks.</p>
          <h3>GCP edge returns 503 or 504</h3>
          <p>Check origin host, port, protocol, health probe path, NSG rules, UFW rules, nginx/systemd service status, and whether the origin allows GCP edge traffic.</p>
          <h3>Provider call is denied</h3>
          <p>Check caller-lock mismatch, project policy, rate limit, provider slot state, emergency revoke status, and audit/activity denial details.</p>
        </article>

        <article class="doc-section">
          <span class="doc-kicker">Checklist</span>
          <h2>Integration questions for technical review</h2>
          <ul>
            <li>Which Entra tenant, enterprise app, groups, MFA, and conditional access rules govern VaultProof users?</li>
            <li>Which apps, environments, regions, subsidiaries, and provider accounts are in scope for the first rollout?</li>
            <li>Which gateway pattern is required: VaultProof-managed, customer gateway, mTLS, device gateway, private origin, or hybrid?</li>
            <li>Which caller-lock facts can the customer reliably provide and monitor?</li>
            <li>Which provider keys move first, who owns them, and what is the emergency revoke path?</li>
            <li>Which evidence exports are required for security, audit, legal, procurement, and customer trust teams?</li>
            <li>Who receives alerts and who has authority to pause or revoke traffic?</li>
            <li>What is the rollback plan if SSO, gateway routing, DNS, or provider execution breaks?</li>
          </ul>
        </article>
      </section>

      <section id="securityReviewPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Review readiness</h2><span id="securityReviewMeta" class="mini">customer-safe</span></div>
          <div id="securityReviewStatusList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Control coverage</h2><span class="mini">what is protected</span></div>
          <div id="securityReviewControlList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Evidence map</h2><span class="mini">where to verify</span></div>
          <div id="securityReviewEvidenceList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Open review items</h2><span class="mini">before paid pilot</span></div>
          <div id="securityReviewOpenList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable security review packet</h2>
            <button id="copySecurityReviewBtn" type="button">copy packet</button>
          </div>
          <textarea id="securityReviewBrief" class="brief-box demo-script" readonly aria-label="Security review packet"></textarea>
        </div>
      </section>

      <section id="settingsPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Organization defaults</h2><span id="settingsMeta" class="mini"></span></div><div id="settingsList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Security notices</h2><span class="mini">enterprise safe</span></div><div id="securityList" class="list"></div></div>
      </section>

      <section id="plansPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Rollout package</h2><span id="planMeta" class="mini"></span></div><div id="planList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Commercial package</h2><span class="mini">paid pilot</span></div><div id="commercialList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Contract guardrails</h2><span class="mini">evidence pack</span></div><div id="guardrailList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Buyer review path</h2><span class="mini">proof workflow</span></div><div id="buyerReviewList" class="list"></div></div>
      </section>

      <section id="pilotPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Pilot scope</h2><span id="pilotMeta" class="mini">browser-local</span></div>
          <form id="pilotProposalForm" class="list">
            <input id="pilotWorkload" data-pilot-field="workload" placeholder="First workload" />
            <input id="pilotProvider" data-pilot-field="provider_path" placeholder="Provider path" />
            <input id="pilotOwner" data-pilot-field="owner_group" placeholder="Owner group" />
            <input id="pilotMonthlyCalls" data-pilot-field="monthly_calls" inputmode="numeric" placeholder="Expected monthly calls" />
            <input id="pilotPrice" data-pilot-field="monthly_price_usd" inputmode="numeric" placeholder="Monthly pilot price" />
            <select id="pilotSupportTier" data-pilot-field="support_tier" aria-label="Support tier">
              <option value="founder-led launch-week support">founder-led launch-week support</option>
              <option value="standard business-hours support">standard business-hours support</option>
              <option value="dedicated launch support">dedicated launch support</option>
            </select>
            <select id="pilotIrAddon" data-pilot-field="incident_response_add_on" aria-label="Incident response add-on">
              <option value="optional add-on">24-hour incident response optional</option>
              <option value="included for pilot">24-hour incident response included</option>
              <option value="customer-owned">customer incident-response team owns 24-hour coverage</option>
            </select>
            <input id="pilotStartWindow" data-pilot-field="start_window" placeholder="Start window" />
            <textarea id="pilotSuccessMetric" data-pilot-field="success_metric" placeholder="Success metric"></textarea>
          </form>
        </div>
        <div class="card">
          <div class="section-title"><h2>Commercial summary</h2><span class="mini">sellable package</span></div>
          <div id="pilotCommercialList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Guardrails</h2><span class="mini">before traffic</span></div>
          <div id="pilotGuardrailList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Close checklist</h2><span class="mini">next buyer step</span></div>
          <div id="pilotCloseList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable pilot proposal</h2>
            <button id="copyPilotProposalBtn" type="button">copy proposal</button>
          </div>
          <textarea id="pilotProposalBrief" class="brief-box demo-script" readonly aria-label="Pilot proposal"></textarea>
        </div>
      </section>

      <section id="pilotSuccessPanel" class="grid two" style="display:none">
        <div class="card">
          <div class="section-title"><h2>Success posture</h2><span id="pilotSuccessMeta" class="mini">customer pilot</span></div>
          <div id="pilotSuccessStatusList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Evidence path</h2><span class="mini">proof links</span></div>
          <div id="pilotSuccessEvidenceList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Success milestones</h2><span class="mini">saved in this browser</span></div>
          <div id="pilotSuccessMilestoneList" class="list"></div>
        </div>
        <div class="card" style="grid-column:1/-1">
          <div class="section-title">
            <h2>Copyable weekly update</h2>
            <button id="copyPilotSuccessBtn" type="button">copy update</button>
          </div>
          <textarea id="pilotSuccessBrief" class="brief-box demo-script" readonly aria-label="Pilot success update"></textarea>
        </div>
      </section>

      <section id="scannerPanel" class="grid two" style="display:none">
        <div class="card"><div class="section-title"><h2>Enterprise scanner status</h2><span class="mini">not enabled</span></div><div id="scannerList" class="list"></div></div>
        <div class="card"><div class="section-title"><h2>Safe launch checklist</h2><span class="mini">before wiring APIs</span></div><div id="scannerChecklist" class="list"></div></div>
      </section>

      <section id="verifierPanel" class="grid two" style="display:none">
        <div class="card" style="grid-column:1/-1">
          <div class="section-title"><h2>Shared demo attestation</h2><span class="mini">one confidential runtime proof</span></div>
          <p class="mini">Demo proof records use the shared VaultProof Enterprise confidential runtime attestation. That proves the VaultProof verifier/control path is running with the expected GCP confidential posture; it does not mean VaultProof ran the customer model.</p>
          <div id="verifierAttestationList" class="list" style="margin-top:12px"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Register external model</h2><span class="mini">VaultProof does not run it</span></div>
          <form id="verifierModelForm" class="list">
            <select id="verifierModelProjectSelect" aria-label="Verifier model project"><option value="">Loading projects...</option></select>
            <input id="verifierModelRef" placeholder="model ref, for example fraud-xgb-v1" />
            <input id="verifierModelName" placeholder="display name, for example Fraud Score XGBoost v1" />
            <select id="verifierModelFamily" aria-label="Model family">
              <option value="classification">classification</option>
              <option value="regression">regression</option>
              <option value="ranking">ranking</option>
              <option value="embedding">embedding</option>
              <option value="llm">llm</option>
              <option value="vision">vision</option>
              <option value="custom">custom</option>
            </select>
            <input id="verifierProofSystems" value="vaultproof-manifest-v1,external-verifier,tee-attestation" aria-label="Allowed proof systems" />
            <button class="primary" type="submit">save model</button>
          </form>
          <div class="section-title" style="margin-top:18px"><h2>Model registry</h2><span class="mini">allowed models</span></div>
          <div id="verifierModelList" class="list"></div>
        </div>
        <div class="card">
          <div class="section-title"><h2>Submit proof bundle</h2><span class="mini">verify evidence only</span></div>
          <form id="verifierProofForm" class="list">
            <select id="verifierProofProjectSelect" aria-label="Proof project"><option value="">Loading projects...</option></select>
            <select id="verifierProofModelSelect" aria-label="Proof model"><option value="">Register a model first</option></select>
            <select id="verifierProofSystem" aria-label="Proof system">
              <option value="vaultproof-manifest-v1">vaultproof-manifest-v1</option>
              <option value="external-verifier">external-verifier</option>
              <option value="tee-attestation">tee-attestation</option>
              <option value="world-zk-compute">world-zk-compute</option>
              <option value="ezkl">ezkl</option>
              <option value="risc0">risc0</option>
            </select>
            <input id="verifierOutputHash" placeholder="claimed output hash, optional sha256:..." />
            <textarea id="verifierProofBundle" placeholder='{"proof_system":"vaultproof-manifest-v1","model_ref":"fraud-xgb-v1","claimed_output_hash":"sha256:..."}'></textarea>
            <button class="primary" type="submit">verify proof bundle</button>
          </form>
          <div class="section-title" style="margin-top:18px"><h2>Proof verification evidence</h2><span class="mini">latest checks</span></div>
          <div id="verifierEvidenceList" class="list"></div>
        </div>
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
      var latestOrgPayload = null;
      var latestReadiness = null;
      var latestOverview = null;
      var latestBootstrap = null;
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
      function linkRow(title, sub, href, label, tone) {
        return '<div class="row"><div><div class="row-title">' + escapeHtml(title) + '</div><div class="row-sub">' + escapeHtml(sub || '') + '</div></div><a class="tag ' + (tone || '') + '" href="' + escapeHtml(href) + '">' + escapeHtml(label || 'open') + '</a></div>';
      }
      function launchStorageKey() {
        return 'vaultproof_launch_checklist:' + (currentOrgId || 'default');
      }
      function goNoGoStorageKey() {
        return 'vaultproof_go_no_go_evidence:' + (currentOrgId || 'default');
      }
      function pilotProposalStorageKey() {
        return 'vaultproof_pilot_proposal:' + (currentOrgId || 'default');
      }
      function pilotSuccessStorageKey() {
        return 'vaultproof_pilot_success:' + (currentOrgId || 'default');
      }
      var PILOT_SUCCESS_ITEMS = [
        { id: 'kickoff-completed', title: 'Pilot kickoff completed', sub: 'Business, security, identity, network, developer, support, and incident owners reviewed the first workload proposal.', action: 'Run kickoff from /app/pilot and /app/security-review.', critical: true },
        { id: 'dry-run-passed', title: 'Dry-run self-test passed', sub: 'API proxy dry-run and blocked-recipient denial evidence are captured before live customer traffic.', action: 'Use /app/keys self-test and review /app/activity.', critical: true },
        { id: 'customer-review-complete', title: 'Customer security review complete', sub: 'Security/procurement reviewers have the security packet, evidence packet, and open blockers.', action: 'Share /app/security-review and /app/evidence.', critical: true },
        { id: 'low-volume-traffic-reviewed', title: 'Low-volume traffic reviewed', sub: 'First low-volume traffic window was reviewed with latency, denials, errors, and audit evidence.', action: 'Review /app/activity, /app/audit, and /app/alerts.', critical: true },
        { id: 'success-metric-accepted', title: 'Success metric accepted', sub: 'The customer accepts the pilot success metric and expansion/no-go decision criteria.', action: 'Confirm success metric from /app/pilot.', critical: true },
        { id: 'expansion-decision-ready', title: 'Expansion decision ready', sub: 'Next project, provider path, or production volume step is agreed after the first workflow is stable.', action: 'Prepare expansion terms or hold decision.', critical: false }
      ];
      function defaultPilotProposalState() {
        return {
          workload: 'First protected email/API workflow',
          provider_path: 'Resend, SendGrid, Mailgun, Postmark, AWS SES, MiniMax, or selected provider slot',
          owner_group: 'Security owner + application owner',
          monthly_calls: '100000',
          monthly_price_usd: '5000',
          support_tier: 'founder-led launch-week support',
          incident_response_add_on: 'optional add-on',
          start_window: 'Two-week pilot window after login, key, and monitoring evidence pass',
          success_metric: 'Dry-run and low-volume production traffic pass with exported evidence, no raw key exposure, and a named rollback owner.'
        };
      }
      function getPilotProposalState() {
        try {
          var raw = localStorage.getItem(pilotProposalStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return Object.assign(defaultPilotProposalState(), parsed && typeof parsed === 'object' ? parsed : {});
        } catch (_) {
          return defaultPilotProposalState();
        }
      }
      function setPilotProposalState(field, value) {
        var state = getPilotProposalState();
        state[field] = String(value == null ? '' : value);
        state.updated_at = new Date().toISOString();
        localStorage.setItem(pilotProposalStorageKey(), JSON.stringify(state));
      }
      function getPilotSuccessState() {
        try {
          var raw = localStorage.getItem(pilotSuccessStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setPilotSuccessState(id, patch) {
        var state = getPilotSuccessState();
        var existing = state[id] && typeof state[id] === 'object' ? state[id] : {};
        state[id] = Object.assign({}, existing, patch || {}, { updated_at: new Date().toISOString() });
        localStorage.setItem(pilotSuccessStorageKey(), JSON.stringify(state));
      }
      function getLaunchManualState() {
        try {
          var raw = localStorage.getItem(launchStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setLaunchManualState(id, checked) {
        var state = getLaunchManualState();
        state[id] = Boolean(checked);
        localStorage.setItem(launchStorageKey(), JSON.stringify(state));
      }
      function getGoNoGoManualState() {
        try {
          var raw = localStorage.getItem(goNoGoStorageKey()) || '{}';
          var parsed = JSON.parse(raw);
          return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (_) {
          return {};
        }
      }
      function setGoNoGoManualState(id, patch) {
        var state = getGoNoGoManualState();
        var existing = state[id] && typeof state[id] === 'object' ? state[id] : {};
        state[id] = Object.assign({}, existing, patch || {}, { updated_at: new Date().toISOString() });
        localStorage.setItem(goNoGoStorageKey(), JSON.stringify(state));
      }
      function launchCheckRow(item, checked) {
        var complete = item.auto ? Boolean(item.complete) : Boolean(checked);
        var disabled = item.auto ? ' disabled' : '';
        return '<label class="launch-check-row" data-complete="' + (complete ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-launch-check="' + escapeHtml(item.id) + '"' + (complete ? ' checked' : '') + disabled + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span></span>' +
          '<span class="tag ' + (complete ? 'good' : item.auto ? 'warn' : '') + '">' + escapeHtml(complete ? 'done' : item.tag) + '</span>' +
        '</label>';
      }
      var GO_NO_GO_MANUAL_ITEMS = [
        { id: 'strict-login-qa', title: 'Strict login QA run', action: 'LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login', sub: 'Automated Supabase redirect, generated session, and authenticated enterprise API checks passed.', critical: true },
        { id: 'human-login-qa', title: 'Human login QA completed', action: 'Browser-test https://enterprise.vaultproof.dev/app/login with ken@vaultproof.dev', sub: 'A real browser sign-in has been clicked through on the enterprise hostname.', critical: true },
        { id: 'supabase-redirect-oauth', title: 'Supabase redirect/OAuth settings confirmed', action: 'Confirm https://enterprise.vaultproof.dev/app/login is allowed and the external OAuth callback is https://gwzkjiomemjlhtrdrlan.supabase.co/auth/v1/callback', sub: 'Supabase Auth settings match the enterprise demo hostname and external OAuth provider app.', critical: true },
        { id: 'cloud-armor-verified', title: 'Cloud Armor verification passed', action: 'npm run verify:gcp-enterprise-cloud-armor', sub: 'Scanner-path blocking, expected rules, live health, and blocked /.env probe have been verified.', critical: true },
        { id: 'key-rotation-reviewed', title: 'Key rotation status', action: 'Rotate exposed/shared pilot keys before paid onboarding, or document demo-only acceptance for this walkthrough', sub: 'Shared pilot keys, service-role keys, and origin-lock values have been reviewed for this launch decision.', critical: true },
        { id: 'rollback-owner-confirmed', title: 'Rollback owner/path confirmed', action: 'Name the owner who can pause traffic, revoke provider slots, reset the VM image, or roll back DNS/edge changes', sub: 'The rollback path is known before customer traffic starts.', critical: true },
        { id: 'budget-monitoring-reviewed', title: 'Budget/monitoring reviewed', action: 'Review budget alert, uptime expectations, denial/error monitoring, and launch-week owner coverage', sub: 'The customer pilot will not run blind on cost, availability, or provider errors.', critical: true }
      ];
      var GO_NO_GO_MANUAL_STALE_MS = 7 * 24 * 60 * 60 * 1000;
      function goNoGoManualById(goNoGo) {
        var lookup = {};
        ((goNoGo && goNoGo.manual) || []).forEach(function(item) { lookup[item.id] = item; });
        return lookup;
      }
      function manualEvidenceSummary(item) {
        return {
          status: item && item.status ? item.status : 'missing',
          updated_at: item && item.updated_at ? item.updated_at : null,
          note: item && item.note ? item.note : null,
          stale: item && item.stale === true
        };
      }
      function buildIdentityQaPacket(goNoGo) {
        var manual = goNoGoManualById(goNoGo);
        var strict = manual['strict-login-qa'];
        var human = manual['human-login-qa'];
        var redirect = manual['supabase-redirect-oauth'];
        var ready = strict && strict.passed && human && human.passed && redirect && redirect.passed;
        return {
          status: ready ? 'ready' : 'hold',
          login_url: location.origin + '/app/login',
          allowed_redirect_uri: location.origin + '/app/login',
          external_oauth_callback_uri: ${JSON.stringify(DEMO_SUPABASE_CALLBACK_URL)},
          strict_login_qa_command: 'LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login',
          oauth_redirect_qa_command: 'LOGIN_QA_OAUTH_PROVIDER=google npm run qa:enterprise-login',
          human_browser_qa_action: 'Browser-test ' + location.origin + '/app/login with ken@vaultproof.dev',
          manual_evidence: {
            strict_login_qa: manualEvidenceSummary(strict),
            human_login_qa: manualEvidenceSummary(human),
            supabase_redirect_oauth: manualEvidenceSummary(redirect)
          },
          secrets_excluded: [
            'Supabase service-role key',
            'Supabase browser session token',
            'OAuth client secret',
            'provider API keys',
            'origin-lock secret'
          ]
        };
      }
      function identityQaRows(packet) {
        var strictStatus = packet.manual_evidence.strict_login_qa.status;
        var humanStatus = packet.manual_evidence.human_login_qa.status;
        var redirectStatus = packet.manual_evidence.supabase_redirect_oauth.status;
        return [
          row('Identity proof status', packet.status === 'ready' ? 'Strict login QA, human browser QA, and Supabase redirect/OAuth settings are all recorded for this org.' : 'Keep this on HOLD until strict login QA, human login QA, and redirect/OAuth confirmation are recorded.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Enterprise login URL', packet.login_url, 'login', 'good'),
          row('Supabase redirect allowlist', packet.allowed_redirect_uri, redirectStatus, redirectStatus === 'passed' ? 'good' : 'warn'),
          row('External OAuth callback', packet.external_oauth_callback_uri, 'callback', 'good'),
          row('Strict login QA command', packet.strict_login_qa_command, strictStatus, strictStatus === 'passed' ? 'good' : 'warn'),
          row('OAuth redirect QA command', packet.oauth_redirect_qa_command, 'oauth redirect QA', 'warn'),
          row('Human browser QA action', packet.human_browser_qa_action, humanStatus, humanStatus === 'passed' ? 'good' : 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function slotMaterialCounts(bootstrap) {
        var counts = { total: 0, live_sealed: 0, demo_placeholder: 0, mixed: 0, missing: 0 };
        providerSlotsFromBootstrap(bootstrap).forEach(function(slot) {
          var mode = String(slot.material_mode || 'missing').replace(/-/g, '_');
          counts.total += 1;
          if (mode === 'sealed_live') counts.live_sealed += 1;
          else if (mode === 'demo_placeholder') counts.demo_placeholder += 1;
          else if (mode === 'mixed') counts.mixed += 1;
          else counts.missing += 1;
        });
        return counts;
      }
      function providersFromBootstrap(bootstrap) {
        var seen = {};
        return providerSlotsFromBootstrap(bootstrap).map(function(slot) {
          return String(slot.provider || slot.slug || '').trim().toLowerCase();
        }).filter(function(provider) {
          if (!provider || seen[provider]) return false;
          seen[provider] = true;
          return true;
        });
      }
      function buildKeyRotationPacket(goNoGo, bootstrap) {
        var manual = goNoGoManualById(goNoGo);
        var item = manual['key-rotation-reviewed'];
        var counts = slotMaterialCounts(bootstrap);
        var providers = providersFromBootstrap(bootstrap);
        var emailProviders = emailProvidersFromData({}, bootstrap);
        var status = item && item.passed ? 'accepted_for_demo' : 'hold';
        return {
          status: status,
          decision: status === 'accepted_for_demo' ? 'Pilot key posture is rotated or explicitly accepted for demo-only use in this browser evidence record.' : 'Hold until exposed/shared pilot keys are rotated or explicitly accepted for demo-only use.',
          manual_evidence: manualEvidenceSummary(item),
          provider_material_summary: {
            total_provider_slots: counts.total,
            live_sealed_slots: counts.live_sealed,
            demo_placeholder_slots: counts.demo_placeholder,
            mixed_slots: counts.mixed,
            missing_slots: counts.missing,
            providers: providers,
            email_providers: emailProviders
          },
          paid_onboarding_actions: [
            'Rotate the shared MiniMax pilot key before paid customer data.',
            'Use sealed local ingest for any future live provider key material.',
            'Rotate Supabase service-role credentials after setup/demo wiring stabilizes.',
            'Rotate origin-lock, executor signing, and runtime-token secrets before paid onboarding.',
            'Keep browser raw-key ingest disabled; dashboard demo slots may stay placeholder-only.'
          ],
          operator_commands: {
            sealed_provider_ingest: 'SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VAULT_UNWRAP_KEY_BASE64=... DEMO_PROVIDER_API_KEY=... npm run seal:enterprise-provider-slot',
            first_goal_gate: 'GOAL1_DEMO_ONLY=false npm run gate:gcp-first-goal',
            launch_evidence_note: 'Mark Key rotation status passed only after rotation or explicit demo-only acceptance is recorded.'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function keyRotationRows(packet) {
        var evidence = packet.manual_evidence || {};
        var summary = packet.provider_material_summary || {};
        var material = [
          (summary.live_sealed_slots || 0) + ' live sealed',
          (summary.demo_placeholder_slots || 0) + ' demo placeholder',
          (summary.mixed_slots || 0) + ' mixed',
          (summary.missing_slots || 0) + ' missing'
        ].join(', ');
        return [
          row('Rotation decision', packet.decision, packet.status, packet.status === 'accepted_for_demo' ? 'good' : 'warn'),
          row('Evidence timestamp', evidence.updated_at ? 'Last updated ' + rel(evidence.updated_at) + (evidence.stale ? '; stale after 7 days.' : '.') : 'No key-rotation evidence timestamp yet.', evidence.status || 'missing', evidence.status === 'passed' && !evidence.stale ? 'good' : 'warn'),
          row('Provider material modes', material, (summary.total_provider_slots || 0) + ' slots', summary.live_sealed_slots ? 'good' : 'warn'),
          row('Providers in scope', (summary.providers && summary.providers.length ? summary.providers.join(', ') : 'none visible') + (summary.email_providers && summary.email_providers.length ? '. Email providers: ' + summary.email_providers.join(', ') + '.' : ''), 'inventory', summary.total_provider_slots ? 'good' : 'warn'),
          row('Paid onboarding actions', packet.paid_onboarding_actions.join(' '), 'before paid', 'warn'),
          row('Sealed ingest command', packet.operator_commands.sealed_provider_ingest, 'operator only', 'good'),
          row('Strict live material gate', packet.operator_commands.first_goal_gate, 'optional', 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function buildPilotOpsPacket(goNoGo, readiness, overview) {
        var manual = goNoGoManualById(goNoGo);
        var rollback = manual['rollback-owner-confirmed'];
        var budget = manual['budget-monitoring-reviewed'];
        var ready = rollback && rollback.passed && budget && budget.passed;
        return {
          status: ready ? 'ready' : 'hold',
          decision: ready ? 'Pilot operations evidence is recorded for rollback ownership and budget/monitoring review.' : 'Hold until rollback ownership and budget/monitoring review are recorded for this organization.',
          manual_evidence: {
            rollback_owner_path: manualEvidenceSummary(rollback),
            budget_monitoring: manualEvidenceSummary(budget)
          },
          rollback_paths: [
            'Emergency revoke a provider slot from /app/keys.',
            'Pause or redirect customer traffic through the GCP edge policy.',
            'Reset the GCP runtime VM if the container runtime becomes unhealthy.',
            'Roll back DNS or edge changes through the selected DNS provider and GCP load balancer config.',
            'Export audit, access-review, readiness, and evidence packet records before and after rollback.'
          ],
          monitoring_review: {
            runtime_production_ready: readiness.production_ready === true,
            security_profile: readiness.security_profile || null,
            proxy_calls: Number(overview.totalCalls || 0),
            denied_calls: Number(overview.deniedCalls || 0),
            error_calls: Number(overview.errorCalls || 0),
            budget_alert: 'VaultProof Production Monthly USD 50 alerting budget',
            review_scope: 'budget alert, uptime expectations, denial/error monitoring, and launch-week owner coverage'
          },
          operator_commands: {
            edge_verification: 'npm run verify:gcp-enterprise-edge',
            live_launch_gate: 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch',
            live_app_qa: 'npm run qa:enterprise-live-app',
            cloud_armor_verification: 'npm run verify:gcp-enterprise-cloud-armor',
            vm_reset_rollback: 'gcloud compute instances reset vaultproof-enterprise-runtime-1 --zone=us-central1-a --project=vaultproof-prod'
          },
          customer_boundary: 'Base enterprise pilot includes launch evidence and operator runbooks. Customer incident-response teams own 24-hour escalation unless that coverage is sold as an add-on.',
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function pilotOpsRows(packet) {
        var rollback = packet.manual_evidence.rollback_owner_path || {};
        var budget = packet.manual_evidence.budget_monitoring || {};
        var monitoring = packet.monitoring_review || {};
        return [
          row('Pilot operations status', packet.decision, packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Rollback owner/path evidence timestamp', rollback.updated_at ? 'Last updated ' + rel(rollback.updated_at) + (rollback.stale ? '; stale after 7 days.' : '.') : 'No rollback owner/path evidence timestamp yet.', rollback.status || 'missing', rollback.status === 'passed' && !rollback.stale ? 'good' : 'warn'),
          row('Budget/monitoring evidence timestamp', budget.updated_at ? 'Last updated ' + rel(budget.updated_at) + (budget.stale ? '; stale after 7 days.' : '.') : 'No budget/monitoring evidence timestamp yet.', budget.status || 'missing', budget.status === 'passed' && !budget.stale ? 'good' : 'warn'),
          row('Runtime monitoring posture', (monitoring.runtime_production_ready ? 'Runtime reports production-ready. ' : 'Runtime is not production-ready. ') + 'Security profile: ' + (monitoring.security_profile || 'not reported') + '.', monitoring.runtime_production_ready ? 'ready' : 'blocked', monitoring.runtime_production_ready ? 'good' : 'bad'),
          row('Traffic/error/denial monitoring', number(monitoring.proxy_calls) + ' calls, ' + number(monitoring.error_calls) + ' errors, ' + number(monitoring.denied_calls) + ' denied.', (monitoring.error_calls || monitoring.denied_calls) ? 'watch' : 'clean', (monitoring.error_calls || monitoring.denied_calls) ? 'warn' : 'good'),
          row('Rollback paths', packet.rollback_paths.join(' '), 'operator owned', 'good'),
          row('Live launch gate command', packet.operator_commands.live_launch_gate, 'strict gate', 'good'),
          row('Customer incident-response boundary', packet.customer_boundary, 'contract', 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function apiInventoryStorageKey() {
        return 'vaultproof_api_inventory::' + (currentOrgId || 'default');
      }
      function redactApiInventoryNote(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key)/i.test(textValue)) {
          return '[redacted: note contained secret-like material]';
        }
        return textValue;
      }
      function readApiInventoryAnnotations() {
        try {
          var parsed = JSON.parse(localStorage.getItem(apiInventoryStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function apiInventoryProjectHealthMap(overview) {
        var map = {};
        (Array.isArray(overview.projectHealth) ? overview.projectHealth : []).forEach(function(item) {
          if (item && item.project_id) map[item.project_id] = item;
        });
        return map;
      }
      function apiInventoryRowId(project, slot) {
        return project.id + '::' + (slot ? (slot.key_id || slot.slug || slot.provider) : 'missing-provider');
      }
      function apiInventoryPolicyComplete(project, slot) {
        var policy = project.caller_lock_policy || {};
        var slug = slot && (slot.slug || slot.provider);
        var override = slug && policy.provider_overrides && policy.provider_overrides[slug] && typeof policy.provider_overrides[slug] === 'object'
          ? policy.provider_overrides[slug]
          : {};
        var effective = Object.assign({}, policy, override || {});
        var hasGateway = Array.isArray(effective.allowed_customer_gateways) && effective.allowed_customer_gateways.length > 0;
        var hasMethod = Array.isArray(effective.allowed_methods) && effective.allowed_methods.length > 0;
        var hasUpstream = (Array.isArray(effective.allowed_upstream_hosts) && effective.allowed_upstream_hosts.length > 0)
          || (Array.isArray(effective.allowed_upstream_path_prefixes) && effective.allowed_upstream_path_prefixes.length > 0);
        return project.strict_origin === true && hasGateway && hasMethod && hasUpstream && Boolean(slot);
      }
      function apiInventoryRowsFromData(overview, bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        var annotations = readApiInventoryAnnotations();
        var health = apiInventoryProjectHealthMap(overview || {});
        var rows = [];
        projects.forEach(function(project) {
          var slots = Array.isArray(project.provider_slots) && project.provider_slots.length ? project.provider_slots : [null];
          slots.forEach(function(slot) {
            var rowId = apiInventoryRowId(project, slot);
            var annotation = annotations[rowId] && typeof annotations[rowId] === 'object' ? annotations[rowId] : {};
            var projectHealth = health[project.id] || {};
            var calls = Number(projectHealth.calls || 0);
            var policyComplete = apiInventoryPolicyComplete(project, slot);
            var reviewStatus = annotation.review_status || 'needs_review';
            var statuses = [];
            if (slot && slot.material_ready === true && policyComplete) statuses.push('protected');
            if (!slot) statuses.push('missing provider slot');
            if (!policyComplete) statuses.push('policy incomplete');
            if (!calls) statuses.push('no recent traffic');
            if (!annotation.review_status || reviewStatus === 'needs_review') statuses.push('review due');
            if (reviewStatus === 'blocked') statuses.push('blocked');
            if (reviewStatus === 'exception') statuses.push('exception');
            return rows.push({
              id: rowId,
              project_id: project.id,
              project_name: project.name || project.vp_proj_id || 'Project',
              vp_proj_id: project.vp_proj_id || null,
              provider: slot ? {
                provider: slot.provider || null,
                slug: slot.slug || slot.provider || null,
                material_mode: slot.material_mode || 'missing',
                material_ready: slot.material_ready === true
              } : null,
              policy: {
                strict_origin: project.strict_origin === true,
                complete: policyComplete
              },
              traffic: {
                calls: calls,
                errors: Number(projectHealth.errors || 0),
                denied: Number(projectHealth.denied || 0),
                last_seen_at: projectHealth.lastActivity || null
              },
              annotation: {
                business_owner: annotation.business_owner || null,
                technical_owner: annotation.technical_owner || null,
                environment: annotation.environment || null,
                business_service: annotation.business_service || null,
                data_sensitivity: annotation.data_sensitivity || null,
                risk: annotation.risk || null,
                review_status: reviewStatus,
                next_review_date: annotation.next_review_date || null,
                updated_at: annotation.updated_at || null,
                note: redactApiInventoryNote(annotation.note)
              },
              statuses: statuses
            });
          });
        });
        return rows;
      }
      function buildApiInventoryPacket(overview, bootstrap) {
        var rows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        var summary = {
          total_api_surfaces: rows.length,
          protected: rows.filter(function(item) { return item.statuses.indexOf('protected') !== -1; }).length,
          missing_provider_slot: rows.filter(function(item) { return !item.provider; }).length,
          policy_incomplete: rows.filter(function(item) { return !item.policy.complete; }).length,
          no_recent_traffic: rows.filter(function(item) { return Number(item.traffic.calls || 0) === 0; }).length,
          review_due: rows.filter(function(item) { return item.statuses.indexOf('review due') !== -1; }).length,
          blocked: rows.filter(function(item) { return item.statuses.indexOf('blocked') !== -1; }).length
        };
        return {
          packet_type: 'vaultproof_enterprise_api_inventory',
          packet_version: 1,
          status: rows.length && summary.missing_provider_slot === 0 ? 'ready' : 'needs_review',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          inventory_page: '/app/inventory',
          summary: summary,
          rows: rows,
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function apiInventoryProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('API inventory status', packet.status === 'ready' ? 'Inventory is populated from existing enterprise projects/provider slots and ready for customer review.' : 'Inventory exists but still needs owner, provider-slot, policy, or review cleanup before pilot traffic.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Inventory surfaces', number(summary.total_api_surfaces) + ' API surfaces, ' + number(summary.protected) + ' protected, ' + number(summary.missing_provider_slot) + ' missing provider slot, ' + number(summary.policy_incomplete) + ' policy incomplete.', number(summary.total_api_surfaces), summary.protected ? 'good' : 'warn'),
          row('Review state', number(summary.review_due) + ' review due, ' + number(summary.no_recent_traffic) + ' with no recent traffic, ' + number(summary.blocked) + ' blocked.', 'review due', summary.blocked ? 'bad' : 'warn'),
          linkRow('Open API inventory', 'Review owner, environment, business service, data sensitivity, risk, review status, and notes saved in this browser.', '/app/inventory', 'inventory', 'good'),
          row('Secret boundary', 'Inventory evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function policyDriftStorageKey() {
        return 'vaultproof_policy_exceptions::' + (currentOrgId || 'default');
      }
      function readPolicyDriftExceptions() {
        try {
          var parsed = JSON.parse(localStorage.getItem(policyDriftStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function redactPolicyDriftText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key)/i.test(textValue)) {
          return '[redacted: policy exception contained secret-like material]';
        }
        return textValue;
      }
      function policyDriftExceptionActive(exception) {
        if (!exception || ['accepted_demo', 'approved'].indexOf(exception.approval_status || '') === -1) return false;
        if (!exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires >= Date.now();
      }
      function policyDriftExceptionExpired(exception) {
        if (!exception || !exception.expires_at) return false;
        var expires = new Date(exception.expires_at + 'T23:59:59Z').getTime();
        return Number.isFinite(expires) && expires < Date.now();
      }
      function policyDriftRowStatus(row) {
        var exception = row.exception || {};
        if (exception.approval_status === 'blocked') return 'blocked';
        if (policyDriftExceptionActive(exception)) return exception.approval_status === 'approved' ? 'approved exception' : 'demo accepted';
        if (policyDriftExceptionExpired(exception)) return 'expired exception';
        return 'open drift';
      }
      function addPolicyDriftRow(rows, exceptions, inventoryRow, controlId, title, detail, severity, action) {
        var id = inventoryRow.id + '::' + controlId;
        var exception = exceptions[id] && typeof exceptions[id] === 'object' ? exceptions[id] : {};
        rows.push({
          id: id,
          api_surface_id: inventoryRow.id,
          control_id: controlId,
          title: title,
          detail: detail,
          severity: severity,
          action: action,
          project: {
            id: inventoryRow.project_id,
            name: inventoryRow.project_name,
            vp_proj_id: inventoryRow.vp_proj_id
          },
          provider: inventoryRow.provider,
          traffic: inventoryRow.traffic,
          inventory_annotation: inventoryRow.annotation || {},
          exception: exception
        });
      }
      function policyDriftRowsFromData(overview, bootstrap) {
        var inventoryRows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        var exceptions = readPolicyDriftExceptions();
        var rows = [];
        inventoryRows.forEach(function(inventoryRow) {
          var annotation = inventoryRow.annotation || {};
          var traffic = inventoryRow.traffic || {};
          var statuses = Array.isArray(inventoryRow.statuses) ? inventoryRow.statuses : [];
          if (!inventoryRow.provider) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'missing-provider-slot', 'Missing provider slot', 'This API surface has no mapped provider slot, so protected execution cannot be proven.', 'critical', 'Create a provider slot and map it to project policy.');
          }
          if (inventoryRow.provider && inventoryRow.provider.material_mode === 'demo-placeholder') {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'demo-placeholder-material', 'Demo-only provider material', 'This provider slot is running demo placeholder material and needs paid-traffic acceptance or live sealed material.', 'high', 'Rotate to sealed live material before paid data, or record a demo-only accepted-risk expiry.');
          }
          if (statuses.indexOf('policy incomplete') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'policy-incomplete', 'Caller-lock policy incomplete', 'Strict origin, gateway, method, provider, host, or path-prefix controls are not complete for this API surface.', inventoryRow.policy && inventoryRow.policy.strict_origin ? 'high' : 'critical', 'Close caller-lock policy gaps in /app/control.');
          }
          if (!annotation.business_owner || !annotation.technical_owner) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'inventory-owner-missing', 'Owner metadata missing', 'Business and technical owner metadata are required before customer launch.', 'medium', 'Set owners in /app/inventory.');
          }
          if (statuses.indexOf('no recent traffic') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'traffic-evidence-missing', 'No recent traffic evidence', 'No proxy traffic is visible for this API surface yet.', 'medium', 'Run a dry-run self-test and verify /app/activity.');
          }
          if (statuses.indexOf('review due') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'inventory-review-due', 'Inventory review due', 'This API inventory row needs an approval, blocker, or accepted exception.', 'medium', 'Review status and next review date in /app/inventory.');
          }
          if (statuses.indexOf('blocked') !== -1) {
            addPolicyDriftRow(rows, exceptions, inventoryRow, 'inventory-blocked', 'Inventory row blocked', 'The API inventory record is explicitly blocked.', 'critical', 'Resolve blocker or record a customer-approved exception before launch.');
          }
        });
        return rows;
      }
      function buildPolicyDriftPacket(overview, bootstrap) {
        var rows = policyDriftRowsFromData(overview || {}, bootstrap || {});
        var blocked = rows.filter(function(item) { return policyDriftRowStatus(item) === 'blocked'; }).length;
        var openCritical = rows.filter(function(item) {
          return (item.severity === 'critical' || item.severity === 'high') && !policyDriftExceptionActive(item.exception) && policyDriftRowStatus(item) !== 'blocked';
        }).length;
        var summary = {
          total_drift_rows: rows.length,
          critical: rows.filter(function(item) { return item.severity === 'critical'; }).length,
          high: rows.filter(function(item) { return item.severity === 'high'; }).length,
          medium: rows.filter(function(item) { return item.severity === 'medium'; }).length,
          active_exceptions: rows.filter(function(item) { return policyDriftExceptionActive(item.exception); }).length,
          expired_exceptions: rows.filter(function(item) { return policyDriftExceptionExpired(item.exception); }).length,
          blocked: blocked
        };
        var status = blocked || openCritical ? 'hold' : rows.length ? 'ready_with_review' : 'clean';
        return {
          packet_type: 'vaultproof_enterprise_policy_drift',
          packet_version: 1,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          policy_page: '/app/policy',
          summary: summary,
          rows: rows.map(function(row) {
            return {
              id: row.id,
              api_surface_id: row.api_surface_id,
              control_id: row.control_id,
              title: row.title,
              severity: row.severity,
              status: policyDriftRowStatus(row),
              project: row.project,
              provider: row.provider,
              traffic: row.traffic,
              action: row.action,
              exception: {
                approval_status: row.exception.approval_status || null,
                owner: row.exception.owner || null,
                risk_level: row.exception.risk_level || null,
                expires_at: row.exception.expires_at || null,
                updated_at: row.exception.updated_at || null,
                reason: redactPolicyDriftText(row.exception.reason),
                compensating_control: redactPolicyDriftText(row.exception.compensating_control),
                next_action: redactPolicyDriftText(row.exception.next_action)
              }
            };
          }),
          workflow_links: {
            policy_drift: '/app/policy',
            api_inventory: '/app/inventory',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            launch: '/app/launch',
            evidence: '/app/evidence'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function policyDriftProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Policy drift status', packet.status === 'clean' ? 'No active drift rows are visible from project/provider/policy/traffic evidence.' : number(summary.total_drift_rows) + ' drift rows are visible. Critical/high rows must be closed or have current accepted-risk records before paid traffic.', packet.status, packet.status === 'hold' ? 'bad' : 'good'),
          row('Open severity mix', number(summary.critical) + ' critical, ' + number(summary.high) + ' high, ' + number(summary.medium) + ' medium. ' + number(summary.active_exceptions) + ' active accepted-risk records.', 'severity', summary.critical || summary.high ? 'warn' : 'good'),
          row('Exception hygiene', number(summary.expired_exceptions) + ' expired exceptions and ' + number(summary.blocked) + ' blocked rows.', summary.blocked ? 'blocked' : 'review', summary.blocked ? 'bad' : 'warn'),
          linkRow('Open policy drift', 'Review control gaps, owners, compensating controls, expiration date, and next action for each accepted-risk record.', '/app/policy', 'policy drift', 'good'),
          row('Secret boundary', 'Policy drift evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function integrationRolloutStorageKey() {
        return 'vaultproof_integration_rollouts::' + (currentOrgId || 'default');
      }
      function readIntegrationRollouts() {
        try {
          var parsed = JSON.parse(localStorage.getItem(integrationRolloutStorageKey()) || '{}');
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (_error) {
          return {};
        }
      }
      function redactIntegrationRolloutText(value) {
        var textValue = String(value || '');
        if (!textValue) return null;
        if (/(sk-[a-z0-9_-]{8,}|gocspx-|eyJ[a-zA-Z0-9_-]{10,}|-----BEGIN|Bearer\\s+|service[_ -]?role|client[_ -]?secret|api[_ -]?key|password|private[_ -]?key|authorization:|cookie:)/i.test(textValue)) {
          return '[redacted: rollout text contained secret-like material]';
        }
        return textValue;
      }
      function integrationRolloutPercent(value) {
        var parsed = Number(value || 0);
        if (!Number.isFinite(parsed)) return 0;
        return Math.max(0, Math.min(100, Math.round(parsed)));
      }
      function integrationRolloutBlockers(inventoryRow, state, policyRows) {
        var blockers = [];
        var annotation = inventoryRow.annotation || {};
        var statuses = Array.isArray(inventoryRow.statuses) ? inventoryRow.statuses : [];
        var testStatus = state.test_status || 'not_started';
        var canary = integrationRolloutPercent(state.canary_percent);
        var openPolicy = policyRows.filter(function(policyRow) {
          return (policyRow.severity === 'critical' || policyRow.severity === 'high') && !policyDriftExceptionActive(policyRow.exception) && policyDriftRowStatus(policyRow) !== 'blocked';
        });
        if (!inventoryRow.provider) blockers.push('missing provider slot');
        if (inventoryRow.provider && inventoryRow.provider.material_mode === 'demo-placeholder') blockers.push('demo-only provider material');
        if (statuses.indexOf('policy incomplete') !== -1) blockers.push('caller-lock policy incomplete');
        if (statuses.indexOf('blocked') !== -1 || annotation.review_status === 'blocked') blockers.push('API inventory row blocked');
        if (!annotation.business_owner || !annotation.technical_owner) blockers.push('API inventory owners missing');
        if (!state.application) blockers.push('application/workload name missing');
        if (!state.integration_mode) blockers.push('integration mode missing');
        if (!state.app_owner) blockers.push('app owner missing');
        if (!state.gateway_owner) blockers.push('gateway owner missing');
        if (!state.target_date) blockers.push('target date missing');
        if (!state.rollback_owner || !state.rollback_path) blockers.push('rollback owner/path missing');
        if (Number(inventoryRow.traffic && inventoryRow.traffic.calls || 0) === 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('dry-run or traffic evidence missing');
        if (canary > 0 && ['dry_run_passed', 'denial_passed', 'canary_passed', 'live_verified'].indexOf(testStatus) === -1) blockers.push('canary needs test evidence');
        if (openPolicy.length) blockers.push(openPolicy.length + ' critical/high policy drift rows');
        if (state.rollout_status === 'blocked') blockers.push('rollout manually blocked');
        return blockers;
      }
      function integrationRolloutRowStatus(row) {
        var state = row.rollout || {};
        var canary = integrationRolloutPercent(state.canary_percent);
        if (state.rollout_status === 'rollback') return 'rollback';
        if (row.blockers && row.blockers.length) return 'hold';
        if (state.rollout_status === 'live' || state.test_status === 'live_verified') return 'live';
        if (state.test_status === 'canary_passed' || canary > 0) return 'canary';
        if (state.test_status === 'dry_run_passed' || state.test_status === 'denial_passed') return 'ready_for_canary';
        if (state.application || state.integration_mode || state.app_owner || state.gateway_owner) return 'planned';
        return 'draft';
      }
      function buildIntegrationRolloutPacket(overview, bootstrap) {
        var inventoryRows = apiInventoryRowsFromData(overview || {}, bootstrap || {});
        var policyRows = policyDriftRowsFromData(overview || {}, bootstrap || {});
        var state = readIntegrationRollouts();
        var rows = inventoryRows.map(function(inventoryRow) {
          var rollout = state[inventoryRow.id] && typeof state[inventoryRow.id] === 'object' ? state[inventoryRow.id] : {};
          var relatedPolicy = policyRows.filter(function(policyRow) { return policyRow.api_surface_id === inventoryRow.id; });
          var blockers = integrationRolloutBlockers(inventoryRow, rollout, relatedPolicy);
          return {
            id: inventoryRow.id,
            project: {
              id: inventoryRow.project_id,
              name: inventoryRow.project_name,
              vp_proj_id: inventoryRow.vp_proj_id
            },
            provider: inventoryRow.provider,
            traffic: inventoryRow.traffic,
            rollout: rollout,
            blockers: blockers,
            policy_drift: relatedPolicy.map(function(policyRow) {
              return { id: policyRow.id, title: policyRow.title, severity: policyRow.severity, status: policyDriftRowStatus(policyRow) };
            })
          };
        });
        var summary = {
          total_workloads: rows.length,
          live: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'live'; }).length,
          canary: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'canary'; }).length,
          ready_for_canary: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'ready_for_canary'; }).length,
          hold: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'hold'; }).length,
          draft: rows.filter(function(item) { return integrationRolloutRowStatus(item) === 'draft'; }).length,
          blocker_count: rows.reduce(function(total, item) { return total + (item.blockers || []).length; }, 0)
        };
        var status = summary.hold ? 'hold' : summary.live || summary.canary || summary.ready_for_canary ? 'ready' : 'draft';
        return {
          packet_type: 'vaultproof_enterprise_integration_rollout',
          packet_version: 1,
          status: status,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          rollout_page: '/app/rollout',
          summary: summary,
          rows: rows.map(function(row) {
            var rollout = row.rollout || {};
            return {
              id: row.id,
              status: integrationRolloutRowStatus(row),
              project: row.project,
              provider: row.provider,
              traffic: row.traffic,
              blockers: row.blockers,
              policy_drift: row.policy_drift,
              rollout: {
                application: rollout.application || null,
                environment: rollout.environment || null,
                integration_mode: rollout.integration_mode || null,
                rollout_status: rollout.rollout_status || null,
                app_owner: rollout.app_owner || null,
                gateway_owner: rollout.gateway_owner || null,
                target_date: rollout.target_date || null,
                support_window: rollout.support_window || null,
                canary_percent: integrationRolloutPercent(rollout.canary_percent),
                test_status: rollout.test_status || 'not_started',
                rollback_owner: rollout.rollback_owner || null,
                rollback_path: redactIntegrationRolloutText(rollout.rollback_path),
                note: redactIntegrationRolloutText(rollout.note),
                updated_at: rollout.updated_at || null
              }
            };
          }),
          workflow_links: {
            rollout_manager: '/app/rollout',
            api_inventory: '/app/inventory',
            policy_drift: '/app/policy',
            control: '/app/control',
            provider_slots: '/app/keys',
            activity: '/app/activity',
            launch: '/app/launch',
            evidence: '/app/evidence'
          },
          snippets: {
            dry_run: 'Copy-safe dry-run snippets are generated in /app/rollout with YOUR_VAULTPROOF_SESSION_JWT placeholders only.'
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'bearer tokens',
            'OAuth client secrets',
            'SAML material',
            'request bodies',
            'response bodies',
            'customer payloads'
          ]
        };
      }
      function integrationRolloutProofRows(packet) {
        var summary = packet.summary || {};
        return [
          row('Integration rollout status', number(summary.total_workloads) + ' candidate workloads, ' + number(summary.ready_for_canary) + ' ready for canary, ' + number(summary.canary) + ' in canary, ' + number(summary.live) + ' live, ' + number(summary.hold) + ' on hold.', packet.status, packet.status === 'hold' ? 'bad' : 'good'),
          row('Rollout blockers', number(summary.blocker_count) + ' blockers across rollout rows. Close owners, rollback, policy, provider material, and dry-run evidence before production traffic.', summary.blocker_count ? 'review' : 'clear', summary.blocker_count ? 'warn' : 'good'),
          linkRow('Open rollout manager', 'Review application, environment, integration mode, owners, target date, canary percent, rollback path, and copy-safe dry-run snippets.', '/app/rollout', 'rollout', 'good'),
          row('Secret boundary', 'Rollout evidence excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function buildApiProxySelfTestPacket(overview, bootstrap) {
        var slots = providerSlotsFromBootstrap(bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        return {
          status: slots.length && totalCalls > 0 ? 'ready' : 'hold',
          execute_endpoint_pattern: '/api/v1/enterprise/projects/{projectId}/providers/{providerSlug}/execute',
          required_headers: [
            'Authorization: Bearer <VaultProof session or runtime token>',
            'Content-Type: application/json',
            'x-vaultproof-organization: <organization id>',
            'x-vaultproof-customer-gateway: vaultproof-managed',
            'x-vaultproof-client-class: browser'
          ],
          dry_run_contract: 'Use dry_run: true for the customer self-test. The control plane validates auth, caller lock, policy, signing, executor reachability, and audit metadata without exposing provider keys.',
          pass_criteria: [
            'Dry-run request returns accepted/validated execution evidence.',
            'Blocked-recipient email test returns 403 and creates denial evidence.',
            'Activity/Audit shows provider, status, policy, latency, request id, and protected-secret classification.',
            'Customer packet excludes raw provider keys, encrypted shares, service-role keys, and origin-lock values.'
          ],
          traffic_evidence: {
            proxy_calls: totalCalls,
            denied_calls: deniedCalls,
            error_calls: errorCalls
          },
          provider_slots: slots.map(function(slot) {
            return {
              provider: slot.provider || null,
              slug: slot.slug || slot.provider || null,
              material_mode: slot.material_mode || 'missing',
              material_ready: slot.material_ready === true,
              secret_kind: isEmailProviderName(slot.provider || slot.slug) ? 'email_api_key' : 'provider_api_key'
            };
          }),
          email_demo: {
            providers: emailProviders,
            dry_run_available: emailProviders.length > 0,
            blocked_recipient_test_available: emailProviders.length > 0
          },
          secrets_excluded: [
            'raw provider keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function apiProxySelfTestRows(packet) {
        var traffic = packet.traffic_evidence || {};
        var slots = packet.provider_slots || [];
        var email = packet.email_demo || {};
        return [
          row('API proxy self-test status', packet.status === 'ready' ? 'Provider slots and traffic evidence are visible for a customer dry-run walkthrough.' : 'Hold until a provider slot and at least one proxy test event are visible.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Execute endpoint pattern', packet.execute_endpoint_pattern, 'customer test', 'good'),
          row('Required headers', packet.required_headers.join('; '), 'caller lock', 'good'),
          row('Dry-run contract', packet.dry_run_contract, 'no upstream spend', 'good'),
          row('Provider slots in scope', slots.length ? slots.map(function(slot) { return (slot.slug || slot.provider || 'provider') + ' (' + slot.material_mode + ')'; }).join(', ') : 'No provider slots visible yet.', slots.length + ' slots', slots.length ? 'good' : 'warn'),
          row('Email denial test', email.blocked_recipient_test_available ? 'Protected email dry-run and blocked-recipient test are available for: ' + email.providers.join(', ') + '.' : 'Add an email provider slot to show the denial evidence path.', email.blocked_recipient_test_available ? 'available' : 'todo', email.blocked_recipient_test_available ? 'good' : 'warn'),
          row('Traffic evidence', number(traffic.proxy_calls) + ' calls, ' + number(traffic.error_calls) + ' errors, ' + number(traffic.denied_calls) + ' denied.', traffic.proxy_calls ? 'observed' : 'pending', traffic.error_calls || traffic.denied_calls ? 'warn' : traffic.proxy_calls ? 'good' : 'warn'),
          row('Pass criteria', packet.pass_criteria.join(' '), 'demo proof', 'good'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var manual = goNoGoManualById(goNoGo);
        var rollback = manual['rollback-owner-confirmed'];
        var budget = manual['budget-monitoring-reviewed'];
        var ready = readiness.production_ready === true && Boolean(currentOrgId) && projectCount > 0 && memberCount > 0 && providerCount > 0;
        return {
          status: ready ? 'ready' : 'hold',
          support_model: 'Founder-led launch-week support for the first paid pilot. 24-hour incident response is an optional add-on, not included in the base pilot package.',
          support_page: location.origin + '/app/support',
          internal_admin_surface: 'VaultProof staff/admin belongs to the separate VaultProof B2C/root admin system, not enterprise.vaultproof.dev.',
          internal_admin_boundary: {
            hostname: 'vaultproof.dev admin system',
            default_mode: 'read_only',
            writes: 'Support notes, invitations, business status updates, destructive action requests, executions, and rollbacks require internal admin actions to be enabled plus the approval secret header.',
            audit: 'Employee console views and approved actions are recorded in the internal admin audit stream.',
            customer_access: 'Customers do not receive access to the employee admin console; they receive evidence exports, support summaries, and approved action notes.'
          },
          coverage: {
            organization_id: currentOrgId || null,
            organization_name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCount,
            member_count: memberCount,
            provider_slots: providerCount,
            proxy_calls: Number(overview.totalCalls || 0),
            denied_calls: Number(overview.deniedCalls || 0),
            error_calls: Number(overview.errorCalls || 0),
            runtime_production_ready: readiness.production_ready === true,
            security_profile: readiness.security_profile || null
          },
          manual_evidence: {
            rollback_owner_path: manualEvidenceSummary(rollback),
            budget_monitoring: manualEvidenceSummary(budget)
          },
          launch_week_workflow: [
            'Review /readiness, /app/launch, /app/evidence, /app/activity, /app/audit, /app/keys, and /app/alerts before each customer test.',
            'Record customer-visible notes in the launch brief or evidence packet, not in chat threads.',
            'Use the separate VaultProof staff/admin system only for employee support triage and approval-gated administrative actions.',
            'Escalate real incidents to the customer incident-response team unless 24-hour response is sold as an add-on.',
            'Export audit/access-review evidence after policy, key, member, or support-action changes.'
          ],
          customer_handoff: [
            'Launch brief from /app/launch.',
            'Evidence JSON from /app/evidence.',
            'Audit CSV and access-review CSV.',
            'API proxy self-test output from /app/keys.',
            'Named rollback owner/path and budget/monitoring review status.'
          ],
          operator_commands: [
            'npm run qa:enterprise-live-app',
            'npm run verify:gcp-enterprise-edge',
            'npm run verify:gcp-enterprise-cloud-armor',
            'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch',
            'Confirm staff/admin tooling is not exposed on enterprise.vaultproof.dev'
          ],
          secrets_excluded: [
            'Supabase service-role key',
            'browser session token',
            'provider API keys',
            'encrypted provider shares',
            'origin-lock secret',
            'executor signing secret',
            'internal admin approval secret'
          ]
        };
      }
      function launchSupportReadinessRows(packet) {
        var coverage = packet.coverage || {};
        return [
          row('Launch support status', packet.status === 'ready' ? 'Support page can be used for customer pilot prep with runtime, org, member, project, and provider evidence visible.' : 'Hold until runtime, org, member, project, and provider evidence are visible.', packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Support model', packet.support_model, 'founder-led launch-week support', 'good'),
          row('Runtime support posture', (coverage.runtime_production_ready ? 'Production-ready runtime. ' : 'Runtime is not production-ready. ') + 'Security profile: ' + (coverage.security_profile || 'not reported') + '.', coverage.runtime_production_ready ? 'ready' : 'blocked', coverage.runtime_production_ready ? 'good' : 'bad'),
          row('Customer scope', number(coverage.project_count) + ' projects, ' + number(coverage.member_count) + ' members, ' + number(coverage.provider_slots) + ' provider slots.', currentOrgId ? 'scoped' : 'select org', currentOrgId ? 'good' : 'warn'),
          row('Traffic watch', number(coverage.proxy_calls) + ' calls, ' + number(coverage.error_calls) + ' errors, ' + number(coverage.denied_calls) + ' denied.', coverage.proxy_calls ? 'observed' : 'pending', coverage.error_calls || coverage.denied_calls ? 'warn' : coverage.proxy_calls ? 'good' : 'warn')
        ];
      }
      function launchSupportBoundaryRows(packet) {
        var boundary = packet.internal_admin_boundary || {};
        return [
          row('Employee admin surface', packet.internal_admin_surface || 'VaultProof employee admin stays off the customer dashboard.', boundary.hostname || 'separate host', 'good'),
          row('Internal admin default mode', 'The support console is ' + (boundary.default_mode || 'read_only') + ' by default.', boundary.default_mode || 'read_only', 'good'),
          row('Approval-gated actions', boundary.writes || 'Administrative writes require explicit approval.', 'approval secret header', 'warn'),
          row('Internal audit', boundary.audit || 'Employee support views and actions are audited.', 'audit trail', 'good'),
          row('Customer boundary', boundary.customer_access || 'Customers receive evidence exports, not employee-console access.', 'no customer admin access', 'good')
        ];
      }
      function launchSupportWorkflowRows(packet) {
        return [
          row('Launch-week workflow', packet.launch_week_workflow.join(' '), 'runbook', 'good'),
          row('Operator commands', packet.operator_commands.join(' | '), 'verification', 'good'),
          row('Rollback evidence', packet.manual_evidence.rollback_owner_path.updated_at ? 'Rollback owner/path recorded ' + rel(packet.manual_evidence.rollback_owner_path.updated_at) + '.' : 'Rollback owner/path has not been recorded in this browser evidence yet.', packet.manual_evidence.rollback_owner_path.status || 'missing', packet.manual_evidence.rollback_owner_path.status === 'passed' ? 'good' : 'warn'),
          row('Budget/monitoring evidence', packet.manual_evidence.budget_monitoring.updated_at ? 'Budget/monitoring recorded ' + rel(packet.manual_evidence.budget_monitoring.updated_at) + '.' : 'Budget/monitoring review has not been recorded in this browser evidence yet.', packet.manual_evidence.budget_monitoring.status || 'missing', packet.manual_evidence.budget_monitoring.status === 'passed' ? 'good' : 'warn')
        ];
      }
      function launchSupportHandoffRows(packet) {
        return [
          row('Customer handoff package', packet.customer_handoff.join(' '), 'shareable', 'good'),
          row('Support page', packet.support_page, 'customer-safe', 'good'),
          row('Incident response boundary', '24-hour incident response add-on is optional; base pilot uses customer incident-response team plus VaultProof launch support.', 'contract', 'warn'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function launchSupportProofRows(packet) {
        return launchSupportReadinessRows(packet)
          .concat(launchSupportBoundaryRows(packet))
          .concat(launchSupportHandoffRows(packet));
      }
      function buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var manual = goNoGoManualById(goNoGo);
        var cloudArmor = manual['cloud-armor-verified'];
        var budget = manual['budget-monitoring-reviewed'];
        var rollback = manual['rollback-owner-confirmed'];
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var runtimeReady = readiness.production_ready === true;
        var ready = runtimeReady && Boolean(currentOrgId) && projectCount > 0 && providerCount > 0 && totalCalls > 0 && cloudArmor && cloudArmor.passed && budget && budget.passed;
        return {
          status: ready ? 'ready' : 'hold',
          decision: ready ? 'Monitoring evidence is ready for launch-week customer testing.' : 'Hold until runtime readiness, traffic evidence, Cloud Armor verification, and budget/monitoring review are recorded.',
          monitoring_page: location.origin + '/app/alerts',
          readiness_source: location.origin + '/readiness',
          manual_evidence: {
            cloud_armor_verification: manualEvidenceSummary(cloudArmor),
            budget_monitoring: manualEvidenceSummary(budget),
            rollback_owner_path: manualEvidenceSummary(rollback)
          },
          telemetry: {
            runtime_production_ready: runtimeReady,
            security_profile: readiness.security_profile || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCount,
            provider_slots: providerCount,
            proxy_calls: totalCalls,
            denied_calls: deniedCalls,
            error_calls: errorCalls
          },
          signals: [
            'Runtime posture from /readiness.',
            'Traffic, denial, and error posture from enterprise overview/bootstrap data.',
            'Alert destinations, delivery logs, and test-send workflow from /app/alerts.',
            'Cloud Armor verification is operator-confirmed until policy state is exposed through a trusted backend source.',
            'Budget/monitoring review is operator-confirmed in the launch board for this demo slice.'
          ],
          operator_commands: {
            live_gate: 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch',
            cloud_armor_verification: 'npm run verify:gcp-enterprise-cloud-armor',
            live_app_qa: 'npm run qa:enterprise-live-app',
            edge_verification: 'npm run verify:gcp-enterprise-edge',
            evidence_bundle: 'npm run evidence:enterprise-production'
          },
          budget_alert: 'VaultProof Production Monthly USD 50 alerting budget. Raise or tune before a paid pilot because the fixed shared-runtime estimate is about $85-$90/month before traffic.',
          customer_handoff: [
            'Open /app/alerts to review destinations, delivery logs, dispatch runs, and test-send behavior.',
            'Open /app/activity for runtime status, latency, denial, and provider request evidence.',
            'Open /app/audit and /app/evidence for customer-safe exports.',
            'Keep launch-week owner coverage and rollback owner/path visible before pilot traffic.'
          ],
          secrets_excluded: [
            'alert webhook secrets',
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function monitoringEvidenceRows(packet) {
        var telemetry = packet.telemetry || {};
        var manual = packet.manual_evidence || {};
        var cloudArmor = manual.cloud_armor_verification || {};
        var budget = manual.budget_monitoring || {};
        return [
          row('Monitoring evidence status', packet.decision, packet.status, packet.status === 'ready' ? 'good' : 'warn'),
          row('Runtime readiness signal', (telemetry.runtime_production_ready ? 'Runtime reports production-ready. ' : 'Runtime is not production-ready. ') + 'Security profile: ' + (telemetry.security_profile || 'not reported') + '.', telemetry.runtime_production_ready ? 'ready' : 'blocked', telemetry.runtime_production_ready ? 'good' : 'bad'),
          row('Traffic, denial, and error watch', number(telemetry.proxy_calls) + ' calls, ' + number(telemetry.error_calls) + ' errors, ' + number(telemetry.denied_calls) + ' denied across ' + number(telemetry.project_count) + ' projects and ' + number(telemetry.provider_slots) + ' provider slots.', telemetry.proxy_calls ? 'observed' : 'pending', telemetry.error_calls || telemetry.denied_calls ? 'warn' : telemetry.proxy_calls ? 'good' : 'warn'),
          row('Alert operations path', 'Use ' + packet.monitoring_page + ' to review destinations, delivery logs, dispatch runs, and test-send workflow before customer traffic.', 'alerts', 'good'),
          row('Cloud Armor verification timestamp', cloudArmor.updated_at ? 'Verified ' + rel(cloudArmor.updated_at) + (cloudArmor.stale ? '; stale after 7 days.' : '.') : 'No Cloud Armor verification timestamp is saved in this browser evidence yet.', cloudArmor.status || 'missing', cloudArmor.status === 'passed' && !cloudArmor.stale ? 'good' : 'warn'),
          row('Budget/monitoring review timestamp', budget.updated_at ? 'Reviewed ' + rel(budget.updated_at) + (budget.stale ? '; stale after 7 days.' : '.') : 'No budget/monitoring review timestamp is saved in this browser evidence yet.', budget.status || 'missing', budget.status === 'passed' && !budget.stale ? 'good' : 'warn'),
          row('Budget alert', packet.budget_alert, 'cost guardrail', 'warn'),
          row('Live monitoring gate', packet.operator_commands.live_gate, 'strict gate', 'good'),
          row('Customer monitoring handoff', packet.customer_handoff.join(' '), 'shareable', 'good'),
          row('Secrets excluded', packet.secrets_excluded.join(', '), 'redacted', 'good')
        ];
      }
      function buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var apiInventory = buildApiInventoryPacket(overview, bootstrap);
        var policyDrift = buildPolicyDriftPacket(overview, bootstrap);
        var integrationRollout = buildIntegrationRolloutPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var productionReady = readiness.production_ready === true;
        var blockers = Array.isArray(goNoGo.blockers) ? goNoGo.blockers : [];
        var status = productionReady && currentOrgId ? 'ready_for_review' : 'hold';
        return {
          packet_type: 'vaultproof_enterprise_security_review_packet',
          packet_version: 1,
          status: status,
          decision: status === 'ready_for_review' ? 'Ready to share for customer security review with live evidence links and explicit launch blockers.' : 'Hold until runtime readiness and organization scope are visible.',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/security-review',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            role: org.role || null,
            project_count: projectCount,
            member_count: memberCount,
            provider_slots: providerCount,
            sso_provider_status: sso.provider_status || 'not confirmed'
          },
          architecture: [
            'Enterprise browser calls only organization-scoped /api/v1/enterprise APIs on enterprise.vaultproof.dev.',
            'The control plane validates session, organization membership, project access, caller lock, policy, and request signing metadata.',
            'Protected provider work is sent to the secure executor through the enterprise runtime path.',
            'The executor verifies request signatures, replay protection, attestation posture, and key-release readiness before using protected provider material.',
            'GCP edge, origin lock, Cloud Armor, request-size limits, and runtime readiness checks sit in front of the shared demo runtime.'
          ],
          controls: [
            { name: 'Identity and RBAC', status: identityQa.status, tone: identityQa.status === 'ready' ? 'good' : 'warn', detail: 'Supabase-brokered enterprise session plus VaultProof organization membership, roles, project assignment, and access-review exports.' },
            { name: 'Caller-lock policy', status: 'built', tone: 'good', detail: 'Control policy can bind protected calls to approved origins, gateways, CIDRs, methods, upstream hosts, path prefixes, provider families, and rate limits.' },
            { name: 'Provider key custody', status: rotation.status, tone: rotation.status === 'accepted_for_demo' ? 'good' : 'warn', detail: 'Provider slots expose posture and material mode without returning plaintext keys or encrypted shares to customer browsers.' },
            { name: 'API inventory', status: apiInventory.status, tone: apiInventory.status === 'ready' ? 'good' : 'warn', detail: 'API surfaces are derived from projects, provider slots, policy, traffic evidence, and browser-local owner/review metadata without storing secrets.' },
            { name: 'Policy drift and exceptions', status: policyDrift.status, tone: policyDrift.status === 'hold' ? 'warn' : 'good', detail: 'Policy drift rows are derived from existing project/provider/policy/traffic evidence, with browser-local accepted-risk records, owners, expiry, and compensating controls.' },
            { name: 'Integration rollout', status: integrationRollout.status, tone: integrationRollout.status === 'hold' ? 'warn' : 'good', detail: 'Rollout rows tie API inventory, policy drift, owners, canary status, rollback path, and copy-safe dry-run snippets into one customer cutover plan.' },
            { name: 'Runtime attestation', status: productionReady ? 'ready' : 'blocked', tone: productionReady ? 'good' : 'bad', detail: 'Readiness reports GCP confidential production posture, key release readiness, signature verification, replay protection, and executor reachability.' },
            { name: 'Audit and evidence', status: 'exportable', tone: 'good', detail: 'Evidence packet, audit CSV, access-review CSV, activity records, launch brief, and security review packet are customer-safe review artifacts.' },
            { name: 'Monitoring and edge protection', status: monitoring.status, tone: monitoring.status === 'ready' ? 'good' : 'warn', detail: 'Monitoring evidence links readiness, traffic/error/denial posture, alert workflow, Cloud Armor verification, live gate, and budget guardrails.' },
            { name: 'Support boundary', status: support.status, tone: support.status === 'ready' ? 'good' : 'warn', detail: 'Founder-led launch-week support is packaged with internal admin boundaries and optional 24-hour incident-response add-on language.' }
          ],
          evidence_links: [
            { title: 'Readiness', href: '/readiness', detail: 'Runtime, executor, key release, attestation, origin-lock, and production blocker summary.', tag: productionReady ? 'ready' : 'blocked', tone: productionReady ? 'good' : 'bad' },
            { title: 'Evidence packet', href: '/app/evidence', detail: 'Customer-safe JSON proof, audit/access exports, identity, rotation, operations, proxy, support, and monitoring evidence.', tag: 'packet', tone: 'good' },
            { title: 'Audit CSV', href: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'), detail: 'Governance and runtime event export for review.', tag: 'csv', tone: 'good' },
            { title: 'Access review CSV', href: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv'), detail: 'Members, roles, invitations, and project assignments.', tag: 'csv', tone: 'good' },
            { title: 'Activity', href: '/app/activity', detail: 'Runtime status codes, latency, provider request IDs, denials, and attestation hints.', tag: 'events', tone: 'good' },
            { title: 'API Inventory', href: '/app/inventory', detail: 'API catalog with owners, environment, risk, provider-slot mapping, policy posture, traffic evidence, review status, and JSON export.', tag: apiInventory.status, tone: apiInventory.status === 'ready' ? 'good' : 'warn' },
            { title: 'Policy Drift', href: '/app/policy', detail: 'Control gaps, demo-only material, owner gaps, stale traffic, accepted-risk records, expiry dates, and customer-safe JSON export.', tag: policyDrift.status, tone: policyDrift.status === 'hold' ? 'warn' : 'good' },
            { title: 'Rollout Manager', href: '/app/rollout', detail: 'Workload cutover plan with owners, integration mode, canary percentage, test status, rollback path, blockers, and evidence export.', tag: integrationRollout.status, tone: integrationRollout.status === 'hold' ? 'warn' : 'good' },
            { title: 'Alerts', href: '/app/alerts', detail: 'Destinations, delivery logs, dispatch runs, and test-send workflow.', tag: 'monitoring', tone: 'good' },
            { title: 'Provider slots', href: '/app/keys', detail: 'Provider material mode, rotation status, dry-run self-test, email demo, and emergency revoke.', tag: 'keys', tone: providerCount ? 'good' : 'warn' },
            { title: 'Launch board', href: '/app/launch', detail: 'Go/no-go decision, operator-confirmed manual evidence, stale holds, and customer tasks.', tag: goNoGo.status, tone: goNoGo.status === 'go' ? 'good' : 'warn' },
            { title: 'Pilot success', href: '/app/pilot-success', detail: 'Milestones, live checks, weekly customer update, blockers, and expansion/no-go path.', tag: 'success', tone: 'good' },
            { title: 'Technical guide', href: '/app/technical-guide', detail: 'Architecture, identity, network, key custody, caller lock, evidence, and troubleshooting answers.', tag: 'guide', tone: 'good' },
            { title: 'Runbooks', href: '/app/runbooks', detail: 'Read-only verification commands, evidence bundle, launch gate, and gated infrastructure actions.', tag: 'ops', tone: 'good' }
          ],
          open_items: blockers.length ? blockers.map(function(blocker) { return { title: blocker, detail: 'Close or explicitly accept this launch blocker before paid customer traffic.', tag: 'blocker', tone: 'warn' }; }) : [
            { title: 'No critical go/no-go blockers in this browser evidence state', detail: 'Still review customer-specific contract, traffic, retention, support, and incident-response expectations before paid rollout.', tag: 'review', tone: 'good' }
          ],
          known_limitations: [
            'Manual go/no-go evidence is browser-local for this demo slice; persistent audit-backed manual evidence can come later.',
            'Plan limits, traffic envelopes, retention terms, and support cadence remain contract-controlled until billing/limits APIs are built.',
            '24-hour incident response is optional add-on coverage unless the customer contract includes it.'
          ],
          security_answers: [
            { question: 'Will provider keys appear in the browser or evidence packet?', answer: 'No. Customer pages show provider posture and material mode only. Raw keys, encrypted shares, service-role keys, origin-lock values, signing secrets, alert webhook secrets, and unwrap roots are excluded.' },
            { question: 'How is a stolen browser session limited?', answer: 'The session still needs organization membership, project access, caller-lock policy, allowed provider/upstream policy, rate limits, request signing, executor verification, and runtime readiness before protected provider work proceeds.' },
            { question: 'What can the customer export for review?', answer: 'Readiness, evidence packet JSON, audit CSV, access-review CSV, activity records, launch brief, and this security review packet.' },
            { question: 'Who owns incident response?', answer: 'Base pilot uses the customer incident-response team plus VaultProof launch support. 24-hour incident response can be sold as an add-on.' }
          ],
          related_packets: {
            go_no_go_status: goNoGo.status,
            identity_login_qa: identityQa.status,
            key_rotation_evidence: rotation.status,
            pilot_operations_evidence: pilotOps.status,
            api_proxy_self_test: apiProxy.status,
            api_inventory: apiInventory.status,
            policy_drift_exceptions: policyDrift.status,
            integration_rollout: integrationRollout.status,
            launch_support_readiness: support.status,
            monitoring_evidence: monitoring.status
          },
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'alert webhook secrets',
            'origin-lock secret',
            'executor signing secret',
            'runtime-token secret',
            'vault unwrap root'
          ]
        };
      }
      function securityReviewStatusRows(packet) {
        var org = packet.organization || {};
        return [
          row('Security review packet status', packet.decision, packet.status, packet.status === 'ready_for_review' ? 'good' : 'warn'),
          row('Organization scope', (org.name || 'Selected workspace') + ' with ' + number(org.project_count) + ' projects, ' + number(org.member_count) + ' members, and ' + number(org.provider_slots) + ' provider slots.', org.id ? 'scoped' : 'select org', org.id ? 'good' : 'warn'),
          row('Go/no-go decision', 'Current launch board status is ' + packet.related_packets.go_no_go_status + '.', packet.related_packets.go_no_go_status, packet.related_packets.go_no_go_status === 'go' ? 'good' : 'warn'),
          row('Related proof packets', 'Identity: ' + packet.related_packets.identity_login_qa + '. Rotation: ' + packet.related_packets.key_rotation_evidence + '. Pilot ops: ' + packet.related_packets.pilot_operations_evidence + '. Proxy self-test: ' + packet.related_packets.api_proxy_self_test + '. API inventory: ' + packet.related_packets.api_inventory + '. Policy drift: ' + packet.related_packets.policy_drift_exceptions + '. Rollout: ' + packet.related_packets.integration_rollout + '. Monitoring: ' + packet.related_packets.monitoring_evidence + '.', 'summary', 'good'),
          row('Secret boundary', 'This packet excludes ' + packet.secrets_excluded.join(', ') + '.', 'redacted', 'good')
        ];
      }
      function securityReviewControlRows(packet) {
        return packet.controls.map(function(control) {
          return row(control.name, control.detail, control.status, control.tone);
        });
      }
      function securityReviewEvidenceRows(packet) {
        return packet.evidence_links.map(function(link) {
          return linkRow(link.title, link.detail, link.href, link.tag, link.tone);
        });
      }
      function securityReviewOpenRows(packet) {
        return packet.open_items.map(function(item) {
          return row(item.title, item.detail, item.tag, item.tone);
        }).concat(packet.known_limitations.map(function(item) {
          return row('Known limitation', item, 'transparent', 'warn');
        }));
      }
      function securityReviewBriefText(packet) {
        return [
          'VaultProof Enterprise security review packet',
          'Generated: ' + packet.generated_at,
          'Status: ' + packet.status,
          'Decision: ' + packet.decision,
          '',
          'Organization:',
          '- Name: ' + (packet.organization.name || 'selected workspace'),
          '- Projects: ' + number(packet.organization.project_count),
          '- Members: ' + number(packet.organization.member_count),
          '- Provider slots: ' + number(packet.organization.provider_slots),
          '- SSO/login status: ' + (packet.organization.sso_provider_status || 'not confirmed'),
          '',
          'Architecture summary:',
          '- ' + packet.architecture.join('\\n- '),
          '',
          'Control coverage:',
          '- ' + packet.controls.map(function(control) { return control.name + ': ' + control.status + ' - ' + control.detail; }).join('\\n- '),
          '',
          'Evidence links:',
          '- ' + packet.evidence_links.map(function(link) { return link.title + ': ' + location.origin + link.href; }).join('\\n- '),
          '',
          'Open review items:',
          '- ' + packet.open_items.map(function(item) { return item.title + ': ' + item.detail; }).join('\\n- '),
          '',
          'Known limitations:',
          '- ' + packet.known_limitations.join('\\n- '),
          '',
          'Common answers:',
          '- ' + packet.security_answers.map(function(item) { return item.question + ' ' + item.answer; }).join('\\n- '),
          '',
          'Secrets excluded:',
          '- ' + packet.secrets_excluded.join('\\n- ')
        ].join('\\n');
      }
      function parseMoney(value, fallback) {
        var parsed = Number(String(value || '').replace(/[^0-9.]/g, ''));
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      }
      function buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var state = getPilotProposalState();
        var monthlyPrice = parseMoney(state.monthly_price_usd, 5000);
        var monthlyCalls = parseMoney(state.monthly_calls, 100000);
        var salesCommission = Math.round(monthlyPrice * 0.2);
        var netAfterCommission = monthlyPrice - salesCommission;
        var providerCount = providerCountFromData(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var productionReady = readiness.production_ready === true;
        var proposalReady = Boolean(state.workload && state.provider_path && state.owner_group && state.success_metric);
        return {
          packet_type: 'vaultproof_enterprise_pilot_proposal',
          packet_version: 1,
          status: proposalReady && productionReady && currentOrgId ? 'ready_to_send' : 'draft',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/pilot',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCountFromData(org, overview, bootstrap),
            member_count: Number(org.member_count || 0),
            provider_slots: providerCount,
            email_providers: emailProviders
          },
          scope: {
            workload: state.workload,
            provider_path: state.provider_path,
            owner_group: state.owner_group,
            monthly_calls: monthlyCalls,
            start_window: state.start_window,
            success_metric: state.success_metric
          },
          commercial: {
            monthly_price_usd: monthlyPrice,
            sales_commission_pct: 20,
            sales_commission_usd: salesCommission,
            net_after_commission_usd: netAfterCommission,
            support_tier: state.support_tier,
            incident_response_add_on: state.incident_response_add_on,
            included: [
              'one guided customer rollout',
              'one first workload',
              'one provider path',
              'customer proof reviews',
              'production-readiness support',
              'audit/access/evidence exports'
            ]
          },
          readiness: {
            runtime_production_ready: productionReady,
            security_profile: readiness.security_profile || null,
            go_no_go_status: goNoGo.status,
            blockers: goNoGo.blockers || [],
            proxy_calls_observed: Number(overview.totalCalls || 0)
          },
          guardrails: [
            'Start with one low-risk workflow and one owner group.',
            'Use dry-run or low-volume traffic before production volume.',
            'Complete strict login QA, Cloud Armor verification, key-rotation review, rollback owner/path, and budget/monitoring review before live customer traffic.',
            'Keep 24-hour incident response optional unless the customer contract includes it.',
            'Keep traffic envelope, retention, support cadence, SSO depth, and dedicated-runtime needs in the contract until billing and limits APIs enforce them.'
          ],
          close_steps: [
            'Confirm business, security, identity, network, developer, and incident owners.',
            'Approve the first workload, provider path, expected monthly calls, and success metric.',
            'Review /app/security-review, /app/evidence, /app/launch, and /app/runbooks.',
            'Sign paid-pilot order form with support and incident-response terms.',
            'Schedule launch-week validation and rollback owner review.'
          ],
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'alert webhook secrets',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function pilotCommercialRows(packet) {
        var commercial = packet.commercial || {};
        return [
          row('Pilot proposal status', packet.status === 'ready_to_send' ? 'Proposal is ready to share after final customer review.' : 'Draft proposal; complete scope and readiness before sending.', packet.status, packet.status === 'ready_to_send' ? 'good' : 'warn'),
          row('Monthly pilot price', '$' + number(commercial.monthly_price_usd) + '/month for one first workload and one provider path.', '$' + number(commercial.monthly_price_usd), 'good'),
          row('Sales commission', '20% commission is $' + number(commercial.sales_commission_usd) + '; net after commission is $' + number(commercial.net_after_commission_usd) + ' before infrastructure and support labor.', '20%', 'warn'),
          row('Support tier', commercial.support_tier || 'founder-led launch-week support', 'support', 'good'),
          row('Incident response', commercial.incident_response_add_on || 'optional add-on', 'contract', commercial.incident_response_add_on === 'included for pilot' ? 'good' : 'warn')
        ];
      }
      function pilotGuardrailRows(packet) {
        return packet.guardrails.map(function(item) {
          return row('Pilot guardrail', item, 'required', 'warn');
        });
      }
      function pilotCloseRows(packet) {
        return packet.close_steps.map(function(item) {
          return row('Close step', item, 'next', 'good');
        });
      }
      function pilotProposalText(packet) {
        var org = packet.organization || {};
        var scope = packet.scope || {};
        var commercial = packet.commercial || {};
        return [
          'VaultProof Enterprise paid-pilot proposal',
          'Organization: ' + (org.name || 'selected workspace'),
          'Status: ' + packet.status,
          '',
          'Pilot scope:',
          '- Workload: ' + scope.workload,
          '- Provider path: ' + scope.provider_path,
          '- Owner group: ' + scope.owner_group,
          '- Expected monthly calls: ' + number(scope.monthly_calls),
          '- Start window: ' + scope.start_window,
          '- Success metric: ' + scope.success_metric,
          '',
          'Commercial package:',
          '- Price: $' + number(commercial.monthly_price_usd) + '/month',
          '- Sales commission: 20% ($' + number(commercial.sales_commission_usd) + ')',
          '- Net after commission before infrastructure/support labor: $' + number(commercial.net_after_commission_usd),
          '- Support: ' + commercial.support_tier,
          '- 24-hour incident response: ' + commercial.incident_response_add_on,
          '- Included: ' + commercial.included.join(', '),
          '',
          'Readiness:',
          '- Runtime production-ready: ' + (packet.readiness.runtime_production_ready ? 'yes' : 'no'),
          '- Security profile: ' + (packet.readiness.security_profile || 'not reported'),
          '- Go/no-go status: ' + packet.readiness.go_no_go_status,
          '- Blockers: ' + (packet.readiness.blockers.length ? packet.readiness.blockers.join('; ') : 'none'),
          '',
          'Guardrails:',
          '- ' + packet.guardrails.join('\\n- '),
          '',
          'Next steps:',
          '- ' + packet.close_steps.join('\\n- '),
          '',
          'Review links:',
          '- Security review: ' + location.origin + '/app/security-review',
          '- Evidence packet: ' + location.origin + '/app/evidence',
          '- Launch board: ' + location.origin + '/app/launch',
          '- Runbooks: ' + location.origin + '/app/runbooks',
          '',
          'Secrets excluded:',
          '- ' + packet.secrets_excluded.join('\\n- ')
        ].join('\\n');
      }
      function buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo) {
        var proposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var state = getPilotSuccessState();
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var deniedCalls = Number(overview.deniedCalls || overview.denied_calls || 0);
        var errorCalls = Number(overview.errorCalls || overview.error_calls || 0);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var auto = [
          { id: 'runtime-ready', title: 'Runtime production-ready', sub: readiness.production_ready === true ? 'Runtime reports production-ready with executor evidence visible.' : 'Runtime readiness is not green.', passed: readiness.production_ready === true, critical: true },
          { id: 'proposal-ready', title: 'Pilot proposal ready', sub: proposal.status === 'ready_to_send' ? 'First workload, provider path, price, support boundary, and success metric are scoped.' : 'Finish the pilot proposal scope before sending customer update.', passed: proposal.status === 'ready_to_send', critical: true },
          { id: 'provider-scope-visible', title: 'Provider scope visible', sub: providerCount + ' provider slots are visible for this organization.', passed: providerCount > 0, critical: true },
          { id: 'traffic-evidence-visible', title: 'Traffic evidence visible', sub: totalCalls + ' proxy calls, ' + errorCalls + ' errors, ' + deniedCalls + ' denied are visible.', passed: totalCalls > 0, critical: true }
        ];
        var manual = PILOT_SUCCESS_ITEMS.map(function(item) {
          var saved = state[item.id] && typeof state[item.id] === 'object' ? state[item.id] : {};
          return Object.assign({}, item, {
            status: saved.passed ? 'passed' : 'missing',
            passed: saved.passed === true,
            updated_at: saved.updated_at || null,
            note: String(saved.note || '')
          });
        });
        var blockers = auto.filter(function(item) { return item.critical && !item.passed; }).map(function(item) { return item.title; })
          .concat(manual.filter(function(item) { return item.critical && !item.passed; }).map(function(item) { return item.title; }));
        var manualPassed = manual.filter(function(item) { return item.passed; }).length;
        var autoPassed = auto.filter(function(item) { return item.passed; }).length;
        return {
          packet_type: 'vaultproof_enterprise_pilot_success_tracker',
          packet_version: 1,
          status: blockers.length ? 'at_risk' : 'on_track',
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/pilot-success',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            sso_provider_status: sso.provider_status || 'not confirmed',
            project_count: projectCount,
            provider_slots: providerCount
          },
          proposal: {
            status: proposal.status,
            workload: proposal.scope.workload,
            provider_path: proposal.scope.provider_path,
            owner_group: proposal.scope.owner_group,
            monthly_price_usd: proposal.commercial.monthly_price_usd,
            success_metric: proposal.scope.success_metric
          },
          telemetry: {
            runtime_production_ready: readiness.production_ready === true,
            security_profile: readiness.security_profile || null,
            proxy_calls: totalCalls,
            denied_calls: deniedCalls,
            error_calls: errorCalls,
            go_no_go_status: goNoGo.status
          },
          automated_checks: auto,
          milestones: manual,
          progress: {
            automated_passed: autoPassed,
            automated_total: auto.length,
            milestones_passed: manualPassed,
            milestones_total: manual.length
          },
          blockers: blockers,
          evidence_links: [
            { title: 'Pilot proposal', href: '/app/pilot', detail: 'Scope, price, support terms, success metric, and close steps.', tag: proposal.status, tone: proposal.status === 'ready_to_send' ? 'good' : 'warn' },
            { title: 'Security review', href: '/app/security-review', detail: 'Architecture, controls, evidence links, open items, and customer answers.', tag: 'review', tone: 'good' },
            { title: 'Evidence packet', href: '/app/evidence', detail: 'Customer-safe proof packet with readiness, launch, operations, support, and monitoring evidence.', tag: 'packet', tone: 'good' },
            { title: 'Activity', href: '/app/activity', detail: 'Runtime traffic, latency, denials, errors, provider request IDs, and attestation hints.', tag: totalCalls ? 'observed' : 'pending', tone: totalCalls ? 'good' : 'warn' },
            { title: 'Launch board', href: '/app/launch', detail: 'Go/no-go decision, manual launch evidence, stale holds, and blockers.', tag: goNoGo.status, tone: goNoGo.status === 'go' ? 'good' : 'warn' },
            { title: 'Alerts', href: '/app/alerts', detail: 'Alert destinations, delivery logs, dispatch runs, and test-send workflow.', tag: 'monitor', tone: 'good' }
          ],
          secrets_excluded: [
            'provider API keys',
            'encrypted provider shares',
            'Supabase service-role key',
            'browser session token',
            'OAuth client secret',
            'alert webhook secrets',
            'origin-lock secret',
            'executor signing secret',
            'vault unwrap root'
          ]
        };
      }
      function pilotSuccessStatusRows(packet) {
        var progress = packet.progress || {};
        var telemetry = packet.telemetry || {};
        return [
          row('Pilot success status', packet.status === 'on_track' ? 'Pilot evidence is on track for the scoped first workload.' : 'Pilot is at risk until blockers are closed: ' + packet.blockers.join('; '), packet.status, packet.status === 'on_track' ? 'good' : 'warn'),
          row('Success metric', packet.proposal.success_metric || 'No success metric set yet.', packet.proposal.status || 'draft', packet.proposal.status === 'ready_to_send' ? 'good' : 'warn'),
          row('Automated proof progress', number(progress.automated_passed) + '/' + number(progress.automated_total) + ' live checks passed.', 'live checks', progress.automated_passed === progress.automated_total ? 'good' : 'warn'),
          row('Milestone progress', number(progress.milestones_passed) + '/' + number(progress.milestones_total) + ' customer milestones complete.', 'milestones', progress.milestones_passed === progress.milestones_total ? 'good' : 'warn'),
          row('Traffic watch', number(telemetry.proxy_calls) + ' calls, ' + number(telemetry.error_calls) + ' errors, ' + number(telemetry.denied_calls) + ' denied.', telemetry.proxy_calls ? 'observed' : 'pending', telemetry.error_calls || telemetry.denied_calls ? 'warn' : telemetry.proxy_calls ? 'good' : 'warn')
        ];
      }
      function pilotSuccessMilestoneRow(item) {
        var updated = item.updated_at ? 'Last updated ' + rel(item.updated_at) + '.' : 'No milestone evidence timestamp yet.';
        return '<label class="go-evidence-row" data-complete="' + (item.passed ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-pilot-success-check="' + escapeHtml(item.id) + '"' + (item.passed ? ' checked' : '') + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span><span class="go-action">Action: <code>' + escapeHtml(item.action) + '</code></span><span class="go-action">' + escapeHtml(updated) + '</span><input class="go-note" data-pilot-success-note="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.note || '') + '" placeholder="Optional customer update note" /></span>' +
          '<span><span class="tag ' + (item.passed ? 'good' : item.critical ? 'warn' : '') + '">' + escapeHtml(item.status) + '</span></span>' +
        '</label>';
      }
      function pilotSuccessMilestoneRows(packet) {
        return packet.automated_checks.map(function(item) {
          return row(item.title, item.sub, item.passed ? 'pass' : (item.critical ? 'blocked' : 'watch'), item.passed ? 'good' : (item.critical ? 'bad' : 'warn'));
        }).concat(packet.milestones.map(pilotSuccessMilestoneRow));
      }
      function pilotSuccessEvidenceRows(packet) {
        return packet.evidence_links.map(function(link) {
          return linkRow(link.title, link.detail, link.href, link.tag, link.tone);
        });
      }
      function pilotSuccessBriefText(packet) {
        var telemetry = packet.telemetry || {};
        var progress = packet.progress || {};
        var completedMilestones = packet.milestones.filter(function(item) {
          return item.passed;
        }).map(function(item) {
          return item.title + (item.note ? ': ' + item.note : '');
        });
        return [
          'VaultProof Enterprise pilot weekly update',
          'Organization: ' + (packet.organization.name || 'selected workspace'),
          'Status: ' + packet.status,
          'Workload: ' + (packet.proposal.workload || 'not set'),
          'Provider path: ' + (packet.proposal.provider_path || 'not set'),
          'Owner group: ' + (packet.proposal.owner_group || 'not set'),
          'Success metric: ' + (packet.proposal.success_metric || 'not set'),
          '',
          'Progress:',
          '- Live checks: ' + number(progress.automated_passed) + '/' + number(progress.automated_total),
          '- Customer milestones: ' + number(progress.milestones_passed) + '/' + number(progress.milestones_total),
          '- Traffic: ' + number(telemetry.proxy_calls) + ' calls, ' + number(telemetry.error_calls) + ' errors, ' + number(telemetry.denied_calls) + ' denied',
          '- Go/no-go: ' + telemetry.go_no_go_status,
          '',
          'Completed milestones:',
          '- ' + (completedMilestones.length ? completedMilestones.join('\\n- ') : 'none yet'),
          '',
          'Open blockers:',
          '- ' + (packet.blockers.length ? packet.blockers.join('\\n- ') : 'none'),
          '',
          'Evidence links:',
          '- ' + packet.evidence_links.map(function(link) { return link.title + ': ' + location.origin + link.href; }).join('\\n- '),
          '',
          'Secrets excluded:',
          '- ' + packet.secrets_excluded.join('\\n- ')
        ].join('\\n');
      }
      function providerSlotsFromBootstrap(bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        var slots = [];
        projects.forEach(function(project) {
          (project.provider_slots || []).forEach(function(slot) { slots.push(slot); });
        });
        return slots;
      }
      function providerCountFromData(overview, bootstrap) {
        var slots = providerSlotsFromBootstrap(bootstrap);
        if (slots.length) return slots.length;
        return Number(overview.activeApps || overview.providerCount || overview.provider_count || 0);
      }
      function projectCountFromData(org, overview, bootstrap) {
        var projects = bootstrap && Array.isArray(bootstrap.projects) ? bootstrap.projects : [];
        return Number(org.project_count || overview.totalProjects || projects.length || 0);
      }
      function normalizeGoNoGoStatus(value, legacyPassed) {
        var status = String(value || '').trim().toLowerCase();
        if (['passed', 'blocked', 'missing'].indexOf(status) !== -1) return status;
        return legacyPassed === true ? 'passed' : 'missing';
      }
      function isStaleGoNoGoEvidence(updatedAt) {
        if (!updatedAt) return true;
        var age = Date.now() - new Date(updatedAt).getTime();
        return !Number.isFinite(age) || age > GO_NO_GO_MANUAL_STALE_MS;
      }
      function buildGoNoGoAutomatedChecks(org, sso, readiness, overview, bootstrap) {
        var controlPlane = readiness.control_plane || {};
        var executor = readiness.executor || {};
        var executorHealth = executor.health || {};
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        return [
          { id: 'runtime-production-ready', title: 'Runtime production readiness', sub: readiness.production_ready === true ? 'Control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; ') || 'Production readiness is not green.', passed: readiness.production_ready === true, critical: true },
          { id: 'security-profile', title: 'GCP confidential security profile', sub: readiness.security_profile || 'not reported', passed: readiness.security_profile === 'google-confidential-production', critical: true },
          { id: 'origin-lock', title: 'Origin lock enforced', sub: controlPlane.origin_lock_configured ? 'GCP edge origin-lock header is configured and required state is visible.' : 'Origin lock is not configured.', passed: controlPlane.origin_lock_configured === true && controlPlane.origin_lock_required === true, critical: true },
          { id: 'executor-private-health', title: 'Executor private health', sub: executor.reachable ? 'Executor health is reachable through the private runtime path with key release and attestation evidence status visible.' : 'Executor health is not reachable from readiness.', passed: executor.reachable === true && executorHealth.production_ready === true, critical: true },
          { id: 'organization-scope', title: 'Organization selected', sub: currentOrgId ? 'This decision is scoped to the selected organization.' : 'Select an organization before launch.', passed: Boolean(currentOrgId), critical: true },
          { id: 'project-scope', title: 'Project scope exists', sub: projectCount + ' project scopes are visible.', passed: projectCount > 0, critical: true },
          { id: 'members-visible', title: 'Members visible', sub: memberCount + ' members are visible for access review.', passed: memberCount > 0, critical: true },
          { id: 'provider-slots-visible', title: 'Provider slots visible', sub: providerCount + ' provider/app connections are visible.', passed: providerCount > 0, critical: true },
          { id: 'email-demo-ready', title: 'Email provider demo readiness', sub: emailProviders.length ? 'Email API key demo provider visible: ' + emailProviders.join(', ') + '.' : 'Add Resend, SendGrid, Mailgun, Postmark, or AWS SES before this demo path.', passed: emailProviders.length > 0, critical: true },
          { id: 'traffic-evidence', title: 'Traffic evidence observed', sub: totalCalls + ' proxy calls are visible in the overview window.', passed: totalCalls > 0, critical: true },
          { id: 'sso-status', title: 'SSO/login posture reported', sub: sso.provider_status || 'not confirmed', passed: Boolean(sso.provider_status), critical: false }
        ];
      }
      function buildGoNoGoStatus(org, sso, readiness, overview, bootstrap) {
        var manualState = getGoNoGoManualState();
        var automated = buildGoNoGoAutomatedChecks(org, sso, readiness, overview, bootstrap);
        var manual = GO_NO_GO_MANUAL_ITEMS.map(function(item) {
          var saved = manualState[item.id] && typeof manualState[item.id] === 'object' ? manualState[item.id] : {};
          var status = normalizeGoNoGoStatus(saved.status, saved.passed);
          var updatedAt = saved.updated_at || null;
          var stale = status === 'passed' && isStaleGoNoGoEvidence(updatedAt);
          return Object.assign({}, item, {
            status: stale ? 'stale' : status,
            passed: status === 'passed' && !stale,
            stale: stale,
            note: String(saved.note || ''),
            updated_at: updatedAt
          });
        });
        var blockers = automated.filter(function(item) { return item.critical && !item.passed; })
          .map(function(item) { return item.title; })
          .concat(manual.filter(function(item) { return item.critical && !item.passed; }).map(function(item) {
            return item.title + (item.status === 'blocked' ? ' (blocked)' : item.status === 'stale' ? ' (stale)' : '');
          }));
        return {
          status: blockers.length ? 'hold' : 'go',
          automated: automated,
          manual: manual,
          blockers: blockers,
          automated_passed: automated.filter(function(item) { return item.passed; }).length,
          manual_passed: manual.filter(function(item) { return item.passed; }).length
        };
      }
      function goNoGoAutomatedRow(item) {
        return row(item.title, item.sub, item.passed ? 'pass' : (item.critical ? 'blocked' : 'watch'), item.passed ? 'good' : (item.critical ? 'bad' : 'warn'));
      }
      function goNoGoManualRow(item) {
        var updated = item.updated_at ? 'Last updated ' + rel(item.updated_at) + (item.stale ? '; stale after 7 days.' : '.') : 'No operator evidence timestamp yet.';
        var tagTone = item.passed ? 'good' : item.status === 'blocked' || item.status === 'stale' ? 'bad' : 'warn';
        return '<label class="go-evidence-row" data-complete="' + (item.passed ? 'true' : 'false') + '">' +
          '<input type="checkbox" data-go-no-go-check="' + escapeHtml(item.id) + '"' + (item.passed ? ' checked' : '') + ' />' +
          '<span><span class="launch-check-title">' + escapeHtml(item.title) + '</span><span class="launch-check-sub">' + escapeHtml(item.sub) + '</span><span class="go-action">Action: <code>' + escapeHtml(item.action) + '</code></span><span class="go-action">' + escapeHtml(updated) + '</span><input class="go-note" data-go-no-go-note="' + escapeHtml(item.id) + '" value="' + escapeHtml(item.note) + '" placeholder="Optional note for the customer launch record" /></span>' +
          '<span><select class="go-status" data-go-no-go-status="' + escapeHtml(item.id) + '"><option value="missing"' + (item.status === 'missing' ? ' selected' : '') + '>missing</option><option value="passed"' + (item.status === 'passed' || item.status === 'stale' ? ' selected' : '') + '>passed</option><option value="blocked"' + (item.status === 'blocked' ? ' selected' : '') + '>blocked</option></select><span class="tag ' + tagTone + '">' + escapeHtml(item.status) + '</span></span>' +
        '</label>';
      }
      function isEmailProviderName(value) {
        return ['resend', 'sendgrid', 'mailgun', 'postmark', 'aws-ses', 'aws_ses'].indexOf(String(value || '').trim().toLowerCase()) !== -1;
      }
      function emailProvidersFromOverview(overview) {
        var providers = Array.isArray(overview.providers) ? overview.providers : [];
        return providers.map(function(provider) { return String(provider || '').trim().toLowerCase(); }).filter(isEmailProviderName);
      }
      function emailProvidersFromData(overview, bootstrap) {
        var fromSlots = providerSlotsFromBootstrap(bootstrap).map(function(slot) {
          return String(slot.provider || slot.slug || '').trim().toLowerCase();
        }).filter(isEmailProviderName);
        var seen = {};
        return fromSlots.concat(emailProvidersFromOverview(overview)).filter(function(provider) {
          if (!provider || seen[provider]) return false;
          seen[provider] = true;
          return true;
        });
      }
      function buildLaunchItems(org, sso, readiness, overview, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var memberCount = Number(org.member_count || 0);
        var providerCount = providerCountFromData(overview, bootstrap);
        var totalCalls = Number(overview.totalCalls || overview.total_calls || 0);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        return [
          { id: 'production-ready', auto: true, complete: productionReady, tag: 'blocked', title: 'Runtime readiness is green', sub: productionReady ? 'The confidential runtime reports production-ready.' : 'Open readiness and clear runtime blockers before customer traffic.' },
          { id: 'org-selected', auto: true, complete: Boolean(currentOrgId), tag: 'select org', title: 'Workspace selected', sub: currentOrgId ? 'This launch board is scoped to the selected organization.' : 'Select the customer organization before reviewing launch state.' },
          { id: 'projects-created', auto: true, complete: projectCount > 0, tag: 'todo', title: 'At least one project exists', sub: projectCount + ' project scopes are visible for this organization.' },
          { id: 'members-added', auto: true, complete: memberCount > 0, tag: 'todo', title: 'Members are visible', sub: memberCount + ' organization members are visible.' },
          { id: 'sso-confirmed', auto: true, complete: sso.provider_status === 'configured', tag: 'confirm', title: 'SSO or login path confirmed', sub: sso.provider_status === 'configured' ? 'Company sign-in is configured.' : 'Confirm SSO or the assisted login path before customer testing.' },
          { id: 'provider-posture', auto: true, complete: providerCount > 0, tag: 'todo', title: 'Provider posture visible', sub: providerCount + ' provider/app connections are visible in the overview.' },
          { id: 'email-key-protected', auto: true, complete: emailProviders.length > 0, tag: 'email key', title: 'Email provider key protected', sub: emailProviders.length ? 'Email API key demo provider visible: ' + emailProviders.join(', ') + '.' : 'Add Resend, SendGrid, Mailgun, Postmark, or AWS SES before customer demo.' },
          { id: 'traffic-observed', auto: true, complete: totalCalls > 0, tag: 'manual', title: 'Test traffic observed', sub: totalCalls + ' proxy calls are visible in the overview window.' },
          { id: 'owners-confirmed', tag: 'owner', title: 'Customer owners confirmed', sub: 'Business, security, identity, network, developer, and incident owners are named.' },
          { id: 'first-workload-picked', tag: 'scope', title: 'First workload selected', sub: 'One low-risk production workflow, one provider path, and one owner group are chosen.' },
          { id: 'policy-reviewed', tag: 'policy', title: 'Caller policy reviewed', sub: 'Origins, gateways, CIDRs, methods, hosts, path prefixes, and rate limits are approved.' },
          { id: 'evidence-exported', tag: 'evidence', title: 'Evidence exports reviewed', sub: 'Readiness, audit CSV, access-review CSV, and activity views are ready for customer review.' },
          { id: 'alerts-tested', tag: 'alerts', title: 'Alerts tested', sub: 'Alert destinations are configured and a test alert has reached the right responders.' },
          { id: 'rollback-owner', tag: 'rollback', title: 'Rollback owner assigned', sub: 'A named owner can pause traffic, revoke provider slots, or roll back the first workload.' },
        ];
      }
      function launchBriefText(org, sso, readiness, overview, percent, doneCount, totalCount, goNoGo, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap || {});
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap || {});
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap || {}, goNoGo);
        var blockers = goNoGo && goNoGo.blockers && goNoGo.blockers.length
          ? goNoGo.blockers.join('; ')
          : 'none';
        return [
          'VaultProof Enterprise launch brief',
          'Organization: ' + (org.name || 'selected workspace'),
          'Launch progress: ' + percent + '% (' + doneCount + '/' + totalCount + ' tasks)',
          'Go/no-go decision: ' + (goNoGo && goNoGo.status === 'go' ? 'GO' : 'HOLD'),
          'Go/no-go blockers: ' + blockers,
          'Identity/OAuth proof status: ' + identityQa.status,
          'Enterprise login URL: ' + identityQa.login_url,
          'Supabase redirect allowlist: ' + identityQa.allowed_redirect_uri,
          'External OAuth callback: ' + identityQa.external_oauth_callback_uri,
          'Key rotation proof status: ' + rotation.status,
          'Provider material modes: ' + rotation.provider_material_summary.live_sealed_slots + ' live sealed / ' + rotation.provider_material_summary.demo_placeholder_slots + ' demo placeholder / ' + rotation.provider_material_summary.missing_slots + ' missing',
          'Pilot operations proof status: ' + pilotOps.status,
          'Rollback owner/path: ' + pilotOps.manual_evidence.rollback_owner_path.status,
          'Budget/monitoring review: ' + pilotOps.manual_evidence.budget_monitoring.status,
          'API proxy self-test status: ' + apiProxy.status,
          'API proxy execute endpoint: ' + apiProxy.execute_endpoint_pattern,
          'Monitoring evidence status: ' + monitoring.status,
          'Monitoring live gate: ' + monitoring.operator_commands.live_gate,
          'Runtime production-ready: ' + (productionReady ? 'yes' : 'no'),
          'SSO/login status: ' + (sso.provider_status || 'not confirmed'),
          'Projects: ' + number(org.project_count || overview.totalProjects),
          'Members: ' + number(org.member_count),
          'Proxy calls observed: ' + number(overview.totalCalls),
          'Manual launch evidence passed: ' + (goNoGo ? goNoGo.manual_passed + '/' + goNoGo.manual.length : '0/0'),
          '',
          'Next customer actions:',
          '- Confirm the first workload, owner, provider path, and expected volume.',
          '- Review caller-lock policy in Control.',
          '- Review provider slot posture and emergency revoke path.',
          '- Run or copy the API proxy self-test dry-run from Provider Slots.',
          '- Review Monitoring evidence in Evidence and alert operations in Alerts.',
          '- Complete strict login QA, Cloud Armor verification, key-rotation review, rollback owner, and budget/monitoring review.',
          '- Export audit and access-review evidence.',
          '- Send one low-volume dry-run or test request before production traffic.',
        ].join('\\n');
      }
      function renderLaunchPanel(org, sso, readiness, overview, bootstrap) {
        var manualState = getLaunchManualState();
        var items = buildLaunchItems(org, sso, readiness, overview, bootstrap);
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var doneCount = items.filter(function(item) {
          return item.auto ? item.complete : manualState[item.id];
        }).length;
        var totalCount = items.length;
        var percent = totalCount ? Math.round(doneCount * 100 / totalCount) : 0;
        text('launchProgressValue', percent + '%');
        text('launchProgressMeta', doneCount + ' of ' + totalCount);
        text('launchProgressCopy', percent >= 80 ? 'This workspace is close to a customer test.' : 'Work through the remaining launch tasks before inviting customer traffic.');
        var bar = byId('launchProgressBar');
        if (bar) bar.style.width = percent + '%';
        byId('launchSummaryList').innerHTML = [
          row('Production readiness', readiness.production_ready === true ? 'Control plane and executor report production-ready.' : (readiness.production_blockers || []).join('; '), readiness.production_ready === true ? 'ready' : 'blocked', readiness.production_ready === true ? 'good' : 'bad'),
          row('Organization role', org.role || 'member', org.kind || 'workspace', org.role === 'owner' || org.role === 'admin' ? 'good' : 'warn'),
          row('SSO/login posture', sso.provider_status || 'not confirmed', sso.login_mode || 'assisted', sso.provider_status === 'configured' ? 'good' : 'warn'),
          row('Usage posture', number(overview.totalCalls) + ' calls, ' + number(overview.errorCalls) + ' errors, ' + number(overview.deniedCalls) + ' denied.', (overview.errorCalls || overview.deniedCalls) ? 'watch' : 'clean', (overview.errorCalls || overview.deniedCalls) ? 'warn' : 'good')
        ].join('');
        text('goNoGoMeta', goNoGo.status === 'go' ? 'go' : 'hold');
        byId('goNoGoDecision').innerHTML =
          '<div class="go-decision-title">' + (goNoGo.status === 'go' ? 'GO: safe to start pilot testing' : 'HOLD: finish launch evidence first') + '</div>' +
          '<span class="mini">' + (goNoGo.status === 'go' ? 'Automated readiness is green and all critical operator evidence is recorded for this organization.' : 'Remaining blockers: ' + escapeHtml(goNoGo.blockers.join('; '))) + '</span>' +
          '<div><span class="tag ' + (goNoGo.status === 'go' ? 'good' : 'bad') + '">' + (goNoGo.status === 'go' ? 'go' : 'hold') + '</span><span class="tag">go/hold decision copy</span><span class="tag">' + goNoGo.automated_passed + '/' + goNoGo.automated.length + ' automated</span><span class="tag">' + goNoGo.manual_passed + '/' + goNoGo.manual.length + ' manual</span></div>';
        byId('goNoGoList').innerHTML =
          '<div class="mini">Automated checks from readiness and workspace data</div>' +
          goNoGo.automated.map(goNoGoAutomatedRow).join('') +
          '<div class="mini" style="margin-top:8px">Operator-confirmed evidence saved in this browser</div>' +
          goNoGo.manual.map(goNoGoManualRow).join('');
        text('identityQaMeta', identityQa.status);
        byId('identityQaList').innerHTML = identityQaRows(identityQa).join('');
        text('keyRotationMeta', rotation.status);
        byId('keyRotationList').innerHTML = keyRotationRows(rotation).join('');
        text('pilotOpsMeta', pilotOps.status);
        byId('pilotOpsList').innerHTML = pilotOpsRows(pilotOps).join('');
        byId('launchChecklist').innerHTML = items.map(function(item) {
          return launchCheckRow(item, manualState[item.id]);
        }).join('');
        byId('launchActions').innerHTML = [
          linkRow('Review policy', 'Open Control to confirm origins, gateways, provider allowlists, upstream restrictions, and rate limits.', '/app/control', 'control', 'good'),
          linkRow('Check provider slots', 'Confirm material mode, owner, rotation, and emergency revoke posture before customer calls.', '/app/keys', 'slots', 'good'),
          linkRow('Export audit evidence', 'Open Audit to search events and export CSV evidence for the customer packet.', '/app/audit', 'audit', 'good'),
          linkRow('Export access review', 'Open Members to review roles and export access-review CSV.', '/app/members', 'members', 'good'),
          linkRow('Open readiness', 'Confirm the live runtime reports the current production posture.', '/readiness', 'readiness', readiness.production_ready === true ? 'good' : 'warn')
        ].join('');
        var brief = byId('launchBrief');
        if (brief) brief.value = launchBriefText(org, sso, readiness, overview, percent, doneCount, totalCount, goNoGo, bootstrap);
      }
      function evidenceExportHref(path) {
        if (!currentOrgId) return path;
        var joiner = path.indexOf('?') === -1 ? '?' : '&';
        return path + joiner + 'org=' + encodeURIComponent(currentOrgId);
      }
      function evidencePacketObject(org, sso, readiness, overview, bootstrap) {
        var controlPlane = readiness.control_plane || {};
        var executor = readiness.executor || {};
        var executorHealth = executor.health || {};
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var apiInventory = buildApiInventoryPacket(overview, bootstrap);
        var policyDrift = buildPolicyDriftPacket(overview, bootstrap);
        var integrationRollout = buildIntegrationRolloutPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var securityReview = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotProposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotSuccess = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        return {
          packet_type: 'vaultproof_enterprise_evidence_packet',
          packet_version: 1,
          generated_at: new Date().toISOString(),
          generated_from: location.origin + '/app/evidence',
          organization: {
            id: currentOrgId || null,
            name: org.name || null,
            role: org.role || null,
            kind: org.kind || null,
            project_count: projectCountFromData(org, overview, bootstrap),
            member_count: Number(org.member_count || 0),
            sso_provider_status: sso.provider_status || 'not confirmed',
            sso_login_mode: sso.login_mode || 'assisted'
          },
          runtime_readiness: {
            production_ready: readiness.production_ready === true,
            demo_ready: readiness.demo_ready === true,
            security_profile: readiness.security_profile || null,
            runtime_tier: readiness.runtime_tier || null,
            customer_dedicated_runtime: readiness.customer_dedicated_runtime === true,
            control_plane: {
              executor_configured: controlPlane.executor_configured === true,
              supabase_configured: controlPlane.supabase_configured === true,
              origin_lock_configured: controlPlane.origin_lock_configured === true,
              origin_lock_required: controlPlane.origin_lock_required === true
            },
            executor: {
              reachable: executor.reachable === true,
              status: executor.status || null,
              production_ready: executorHealth.production_ready === true,
              key_release_ready: executorHealth.key_release_ready === true,
              attestation_evidence_ready: executorHealth.attestation_evidence_ready === true,
              security_profile: executorHealth.security_profile || null
            }
          },
          usage_summary: {
            proxy_calls: Number(overview.totalCalls || 0),
            denied_calls: Number(overview.deniedCalls || 0),
            error_calls: Number(overview.errorCalls || 0),
            active_provider_slots: providerCountFromData(overview, bootstrap),
            email_provider_slots: emailProviders.length,
            email_providers: emailProviders
          },
          go_no_go: {
            status: goNoGo.status,
            blockers: goNoGo.blockers,
            automated_checks: goNoGo.automated.map(function(item) {
              return {
                id: item.id,
                title: item.title,
                status: item.passed ? 'pass' : 'block',
                critical: item.critical === true,
                detail: item.sub
              };
            }),
            manual_evidence: goNoGo.manual.map(function(item) {
              return {
                id: item.id,
                title: item.title,
                status: item.status || (item.passed ? 'passed' : 'missing'),
                critical: item.critical === true,
                stale: item.stale === true,
                updated_at: item.updated_at,
                note: item.note || null,
                action: item.action
              };
            })
          },
          identity_login_qa: identityQa,
          key_rotation_evidence: rotation,
          pilot_operations_evidence: pilotOps,
          api_proxy_self_test: apiProxy,
          api_inventory: apiInventory,
          policy_drift_exceptions: policyDrift,
          integration_rollout: integrationRollout,
          launch_support_readiness: support,
          monitoring_evidence: monitoring,
          security_review_packet: securityReview,
          pilot_proposal: pilotProposal,
          pilot_success_tracker: pilotSuccess,
          exports: {
            readiness: '/readiness',
            audit_csv_30_days: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'),
            access_review_csv: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv'),
            activity: '/app/activity',
            api_inventory: '/app/inventory',
            policy_drift: '/app/policy',
            integration_rollout: '/app/rollout',
            provider_slots: '/app/keys',
            launch_checklist: '/app/launch',
            security_review: '/app/security-review',
            pilot_proposal: '/app/pilot',
            pilot_success: '/app/pilot-success'
          },
          customer_review_notes: [
            'Verify production readiness before customer traffic.',
            'Review the go/no-go launch decision and close any hold blockers.',
            'Export audit CSV and access-review CSV for the review packet.',
            'Confirm caller-lock policy, provider slot posture, and emergency revoke owners.',
            'Rotate shared or exposed pilot keys before paid customer data, or keep a demo-only acceptance note in the launch board.',
            'Confirm rollback ownership, budget alert coverage, and launch-week monitoring ownership before live customer traffic.',
            'Run the API proxy dry-run self-test and blocked-recipient email denial test before the customer walkthrough.',
            'Review the API inventory for owners, environment, data sensitivity, risk, provider-slot mapping, policy posture, stale traffic, and review due items.',
            'Review policy drift and accepted-risk exceptions for owner, reason, compensating control, expiration date, next action, and launch hold status.',
            'Review the integration rollout plan for application owner, gateway owner, target date, canary percent, test status, rollback owner/path, blockers, and copy-safe dry-run snippet.',
            'Review launch support scope, internal admin boundary, approval gates, and customer handoff notes before pilot traffic.',
            'Review monitoring evidence, alert destination/test-send workflow, Cloud Armor verification, and budget alert posture before launch-week traffic.',
            'Share the security review packet with customer security, procurement, and technical reviewers after validating launch blockers.',
            'Use the pilot proposal builder to confirm workload, provider path, owner group, price, support boundary, and success metric before the paid-pilot close.',
            'Use the pilot success tracker for weekly customer updates, milestone proof, and expansion/no-go decisions.',
            'For the email API key demo, verify sender, recipient, template, gateway, and rate policy before live sends.',
            'Keep provider keys, encrypted shares, service-role keys, origin-lock values, and signing secrets out of customer packets.'
          ]
        };
      }
      function renderEvidencePanel(org, sso, readiness, overview, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var controlPlane = readiness.control_plane || {};
        var executor = readiness.executor || {};
        var executorHealth = executor.health || {};
        var packet = evidencePacketObject(org, sso, readiness, overview, bootstrap);
        var identityQa = packet.identity_login_qa || buildIdentityQaPacket(buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        var rotation = packet.key_rotation_evidence || buildKeyRotationPacket(buildGoNoGoStatus(org, sso, readiness, overview, bootstrap), bootstrap);
        var pilotOps = packet.pilot_operations_evidence || buildPilotOpsPacket(buildGoNoGoStatus(org, sso, readiness, overview, bootstrap), readiness, overview);
        var apiProxy = packet.api_proxy_self_test || buildApiProxySelfTestPacket(overview, bootstrap);
        var apiInventory = packet.api_inventory || buildApiInventoryPacket(overview, bootstrap);
        var policyDrift = packet.policy_drift_exceptions || buildPolicyDriftPacket(overview, bootstrap);
        var integrationRollout = packet.integration_rollout || buildIntegrationRolloutPacket(overview, bootstrap);
        var support = packet.launch_support_readiness || buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        var monitoring = packet.monitoring_evidence || buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, buildGoNoGoStatus(org, sso, readiness, overview, bootstrap));
        text('evidenceMeta', productionReady ? 'ready for review' : 'needs attention');
        byId('evidenceReadinessList').innerHTML = [
          row('Production readiness', productionReady ? 'Control plane and confidential executor report production-ready.' : (readiness.production_blockers || []).join('; '), productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
          row('Go/no-go launch decision', packet.go_no_go.status === 'go' ? 'Launch board says GO for pilot testing.' : 'Launch board says HOLD: ' + packet.go_no_go.blockers.join('; '), packet.go_no_go.status, packet.go_no_go.status === 'go' ? 'good' : 'bad'),
          row('Security profile', readiness.security_profile || 'not reported', readiness.runtime_tier || 'runtime', readiness.security_profile === 'google-confidential-production' ? 'good' : 'warn'),
          row('Origin lock', controlPlane.origin_lock_configured ? 'GCP edge origin-lock header is configured and enforced by the control plane.' : 'Origin lock still needs configuration review.', controlPlane.origin_lock_required ? 'required' : 'optional', controlPlane.origin_lock_configured ? 'good' : 'warn'),
          row('Executor evidence', executor.reachable ? 'Executor health is reachable through the private runtime path. Key release: ' + (executorHealth.key_release_ready ? 'ready' : 'attention') + '. Attestation: ' + (executorHealth.attestation_evidence_ready ? 'ready' : 'attention') + '.' : 'Executor health was not reachable from readiness.', executor.reachable ? 'reachable' : 'attention', executor.reachable ? 'good' : 'bad')
        ].join('');
        byId('evidenceExportList').innerHTML = [
          linkRow('Readiness summary', 'Customer-facing production gate for runtime, executor, key release, and Cloud KMS posture.', '/readiness', 'open', productionReady ? 'good' : 'warn'),
          linkRow('Audit CSV', 'Governance and runtime evidence for the last 30 days.', packet.exports.audit_csv_30_days, 'CSV', 'good'),
          linkRow('Access review CSV', 'Members, roles, invitations, and project assignment evidence.', packet.exports.access_review_csv, 'CSV', 'good'),
          linkRow('Activity review', 'Runtime events, status codes, latency, provider request IDs, and attestation hints.', '/app/activity', 'open', 'good'),
          linkRow('API inventory export', 'Metadata-only API inventory with owners, risk, provider mapping, policy posture, traffic evidence, and review state.', '/app/inventory', 'inventory', 'good'),
          linkRow('Policy drift export', 'Customer-safe policy drift and accepted-risk evidence with owners, expiry, compensating controls, and launch status.', '/app/policy', 'policy drift', policyDrift.status === 'hold' ? 'warn' : 'good'),
          linkRow('Integration rollout export', 'Customer-safe cutover plan with application/gateway owners, canary status, rollback path, blockers, and copy-safe snippet guidance.', '/app/rollout', 'rollout', integrationRollout.status === 'hold' ? 'warn' : 'good'),
          linkRow('Provider slot posture', 'Protected provider slots, material mode, rotation, and emergency revoke state.', '/app/keys', 'open', 'good')
        ].join('');
        byId('evidenceProofList').innerHTML = [
          row('Organization scope', org.name || 'Selected workspace', org.role || 'member', currentOrgId ? 'good' : 'warn'),
          row('Projects', number(packet.organization.project_count) + ' project scopes are visible for this organization.', number(packet.organization.project_count), packet.organization.project_count ? 'good' : 'warn'),
          row('Members', number(packet.organization.member_count) + ' members are visible for access review.', number(packet.organization.member_count), packet.organization.member_count ? 'good' : 'warn'),
          row('Provider posture', number(packet.usage_summary.active_provider_slots) + ' active provider/app connections are visible in overview.', number(packet.usage_summary.active_provider_slots), packet.usage_summary.active_provider_slots ? 'good' : 'warn'),
          row('Email API key protection', packet.usage_summary.email_provider_slots ? 'Email demo provider slots visible: ' + packet.usage_summary.email_providers.join(', ') + '. Run protected email dry-run before the customer walkthrough.' : 'No email provider key slot is visible yet. Add Resend, SendGrid, Mailgun, Postmark, or AWS SES before the demo.', packet.usage_summary.email_provider_slots ? 'ready' : 'todo', packet.usage_summary.email_provider_slots ? 'good' : 'warn'),
          row('Traffic evidence', number(packet.usage_summary.proxy_calls) + ' proxy calls, ' + number(packet.usage_summary.denied_calls) + ' denied, ' + number(packet.usage_summary.error_calls) + ' errors.', packet.usage_summary.proxy_calls ? 'observed' : 'pending', packet.usage_summary.error_calls || packet.usage_summary.denied_calls ? 'warn' : 'good')
        ].join('');
        byId('evidenceWorkflowList').innerHTML = [
          linkRow('Review launch checklist', 'Confirm owners, policy, evidence exports, alerts, rollback, and first workload scope.', '/app/launch', 'launch', 'good'),
          linkRow('Review policy control', 'Confirm origins, gateways, CIDRs, upstream hosts, path prefixes, and rate limits.', '/app/control', 'control', 'good'),
          linkRow('Review policy drift', 'Confirm every critical/high drift row is closed, blocked intentionally, or accepted with owner and expiration date.', '/app/policy', 'policy drift', policyDrift.status === 'hold' ? 'warn' : 'good'),
          linkRow('Review integration rollout', 'Confirm first workload, owners, target date, canary percentage, rollback path, and dry-run evidence before live traffic.', '/app/rollout', 'rollout', integrationRollout.status === 'hold' ? 'warn' : 'good'),
          linkRow('Review technical guide', 'Use the implementation guide for architecture, trust boundaries, key custody, and troubleshooting answers.', '/app/technical-guide', 'guide', 'good'),
          linkRow('Review security packet', 'Share the concise architecture, controls, evidence links, open items, and customer-safe answers with security reviewers.', '/app/security-review', 'security', 'good'),
          linkRow('Review runbooks', 'Operator commands for verification, evidence capture, deploys, secrets, DNS, edge, SSH, and cleanup.', '/app/runbooks', 'runbooks', 'good')
        ].join('');
        text('evidenceIdentityMeta', identityQa.status);
        byId('evidenceIdentityList').innerHTML = identityQaRows(identityQa).join('');
        text('evidenceKeyRotationMeta', rotation.status);
        byId('evidenceKeyRotationList').innerHTML = keyRotationRows(rotation).join('');
        text('evidencePilotOpsMeta', pilotOps.status);
        byId('evidencePilotOpsList').innerHTML = pilotOpsRows(pilotOps).join('');
        text('evidenceApiProxyMeta', apiProxy.status);
        byId('evidenceApiProxyList').innerHTML = apiProxySelfTestRows(apiProxy).join('');
        text('evidenceApiInventoryMeta', apiInventory.status);
        byId('evidenceApiInventoryList').innerHTML = apiInventoryProofRows(apiInventory).join('');
        text('evidencePolicyDriftMeta', policyDrift.status);
        byId('evidencePolicyDriftList').innerHTML = policyDriftProofRows(policyDrift).join('');
        text('evidenceRolloutMeta', integrationRollout.status);
        byId('evidenceRolloutList').innerHTML = integrationRolloutProofRows(integrationRollout).join('');
        text('evidenceSupportMeta', support.status);
        byId('evidenceSupportList').innerHTML = launchSupportProofRows(support).join('');
        text('evidenceMonitoringMeta', monitoring.status);
        byId('evidenceMonitoringList').innerHTML = monitoringEvidenceRows(monitoring).join('');
        var packetBox = byId('evidencePacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
      }
      function demoScriptText(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var securityReview = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotProposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotSuccess = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        var providerCount = providerCountFromData(overview, bootstrap);
        var projectCount = projectCountFromData(org, overview, bootstrap);
        var blockers = goNoGo.blockers.length ? goNoGo.blockers.join('; ') : 'none';
        return [
          'VaultProof Enterprise demo talk track',
          'Headline: Active Key Protection for every API call.',
          '',
          '1. Open with the risk',
          'Leaked API keys are not just an AI problem. Email-provider keys, model-provider keys, automation keys, and partner API keys can all become live abuse paths if they sit in app code, browser storage, logs, or ordinary dashboards.',
          '',
          '2. Show the active protection path',
          'Organization: ' + (org.name || 'selected workspace'),
          'Projects visible: ' + number(projectCount),
          'Provider slots visible: ' + number(providerCount),
          'Email provider demo slots: ' + (emailProviders.length ? emailProviders.join(', ') : 'none yet'),
          'Proxy calls observed: ' + number(overview.totalCalls),
          'Runtime production-ready: ' + (readiness.production_ready === true ? 'yes' : 'no'),
          'SSO/login status: ' + (sso.provider_status || 'not confirmed'),
          'Identity/OAuth proof status: ' + identityQa.status,
          'OAuth callback: ' + identityQa.external_oauth_callback_uri,
          'Key rotation proof status: ' + rotation.status,
          'Pilot operations proof status: ' + pilotOps.status,
          'API proxy self-test status: ' + apiProxy.status,
          'Launch support proof status: ' + support.status,
          'Monitoring evidence proof status: ' + monitoring.status,
          'Security review packet status: ' + securityReview.status,
          'Pilot proposal status: ' + pilotProposal.status,
          'Pilot success tracker status: ' + pilotSuccess.status,
          '',
          '3. Walk the buyer through the product',
          '- Dashboard: current runtime, access, project, and evidence posture.',
          '- Provider slots: protected key slots, material mode, dry-run email send, blocked-recipient denial, and emergency revoke.',
          '- Activity and Audit: runtime status, denial evidence, latency, provider request IDs, and governance exports.',
          '- Evidence packet: customer-safe JSON and CSV proof with no raw provider key material.',
          '- Identity/OAuth evidence packet: strict QA command, redirect allowlist, callback URL, and browser QA status without secrets.',
          '- Key rotation evidence packet: material-mode inventory, paid-onboarding rotation actions, sealed ingest command, and redacted secret boundary.',
          '- Pilot operations evidence packet: rollback owner/path, budget/monitoring review, live launch gate command, and incident-response boundary.',
          '- API proxy self-test kit: copy-safe dry-run request, required caller-lock headers, protected email proof, and blocked-recipient denial test.',
          '- Launch support room: support model, internal admin boundary, approval gates, and customer-safe handoff package.',
          '- Monitoring evidence kit: readiness, traffic, denial/error posture, alert workflow, Cloud Armor verification, and budget guardrails.',
          '- Security review packet: architecture summary, control coverage, evidence links, open launch items, and common customer answers.',
          '- Pilot proposal builder: first workload scope, expected volume, price, commission math, support boundary, and close steps.',
          '- Pilot success tracker: weekly customer update, milestone proof, live traffic posture, blockers, and expansion decision trail.',
          '- Launch checklist: go/no-go board, manual evidence, stale holds, and remaining blockers.',
          '',
          '4. Be crisp about boundaries',
          'VaultProof does not show raw provider keys in the browser, customer packet, logs, or ordinary dashboard views. Demo dry-runs are safe by default. Live sandbox delivery needs sealed provider material first.',
          '',
          '5. Current go/no-go',
          'Decision: ' + (goNoGo.status === 'go' ? 'GO' : 'HOLD'),
          'Blockers: ' + blockers,
          '',
          '6. Close',
          'The first paid pilot is one low-risk workload, one owner group, one provider path, exported evidence, and a rollback owner. Expansion happens project by project after the first workflow is stable.'
        ].join('\\n');
      }
      function renderDemoPanel(org, sso, readiness, overview, bootstrap) {
        var productionReady = readiness.production_ready === true;
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var identityQa = buildIdentityQaPacket(goNoGo);
        var rotation = buildKeyRotationPacket(goNoGo, bootstrap);
        var pilotOps = buildPilotOpsPacket(goNoGo, readiness, overview);
        var apiProxy = buildApiProxySelfTestPacket(overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var monitoring = buildMonitoringEvidencePacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var securityReview = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotProposal = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var pilotSuccess = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var providerCount = providerCountFromData(overview, bootstrap);
        var emailProviders = emailProvidersFromData(overview, bootstrap);
        text('demoMeta', goNoGo.status === 'go' ? 'ready to pilot' : 'hold for evidence');
        byId('demoObjectiveList').innerHTML = [
          row('Active Key Protection for every API call.', 'Start with a simple claim buyers remember: VaultProof protects sensitive provider/API calls while keeping raw keys out of app code, browser storage, logs, and customer packets.', 'headline', 'good'),
          row('Email API key story', emailProviders.length ? 'Use ' + emailProviders.join(', ') + ' as the easy-to-understand demo secret.' : 'Create or select an email provider slot before relying on the email-key story.', emailProviders.length ? 'ready' : 'todo', emailProviders.length ? 'good' : 'warn'),
          row('One paid-pilot ask', 'Close on one low-risk workflow, one owner group, one provider path, exported evidence, and rollback owner.', 'focused', 'good')
        ].join('');
        byId('demoPathList').innerHTML = [
          linkRow('Dashboard posture', 'Show runtime readiness, organization scope, project count, member count, and quick links.', '/app/dashboard', 'open', 'good'),
          linkRow('Provider slot demo', 'Show material mode, protected email dry-run, blocked recipient test, policy denial evidence, and emergency revoke.', '/app/keys', 'open', providerCount ? 'good' : 'warn'),
          linkRow('Runtime activity', 'Show status codes, denial events, latency, provider request IDs, and recent traffic.', '/app/activity', 'open', overview.totalCalls ? 'good' : 'warn'),
          linkRow('Alert operations', 'Show monitoring destinations, delivery logs, dispatch runs, and test-send workflow.', '/app/alerts', 'open', monitoring.status === 'ready' ? 'good' : 'warn'),
          linkRow('Evidence packet', 'Copy/download the customer-safe proof packet and explain what secrets are excluded.', '/app/evidence', 'packet', 'good'),
          linkRow('Security review packet', 'Show the copyable buyer packet for security, procurement, and technical review.', '/app/security-review', 'review', securityReview.status === 'ready_for_review' ? 'good' : 'warn'),
          linkRow('Pilot proposal', 'Show the first workload, price, owner group, expected traffic, support terms, and close steps.', '/app/pilot', 'proposal', pilotProposal.status === 'ready_to_send' ? 'good' : 'warn'),
          linkRow('Pilot success tracker', 'Show milestones, weekly update copy, traffic posture, blockers, and expansion decision evidence.', '/app/pilot-success', 'success', pilotSuccess.status === 'on_track' ? 'good' : 'warn'),
          linkRow('Launch support room', 'Show support model, internal admin boundary, approval gates, and customer handoff package.', '/app/support', 'support', support.status === 'ready' ? 'good' : 'warn'),
          linkRow('Go/no-go board', 'Show the current launch decision, manual evidence rows, stale holds, and blockers.', '/app/launch', 'board', goNoGo.status === 'go' ? 'good' : 'warn')
        ].join('');
        byId('demoProofList').innerHTML = [
          row('GCP confidential runtime', productionReady ? 'Readiness reports production-ready with the expected GCP confidential security profile.' : 'Readiness is not green; use this as a blocker instead of a claim.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
          row('Identity/OAuth proof kit', identityQa.status === 'ready' ? 'Login QA evidence is recorded with redirect allowlist and external OAuth callback facts.' : 'Use Launch to record strict login QA, human browser QA, and Supabase redirect/OAuth confirmation.', identityQa.status, identityQa.status === 'ready' ? 'good' : 'warn'),
          row('Key rotation proof kit', rotation.status === 'accepted_for_demo' ? 'Launch evidence records either rotation or explicit demo-only acceptance for shared pilot key posture.' : 'Use Launch to record key rotation or demo-only acceptance before a customer pilot.', rotation.status, rotation.status === 'accepted_for_demo' ? 'good' : 'warn'),
          row('Pilot operations proof kit', pilotOps.status === 'ready' ? 'Rollback ownership and budget/monitoring review evidence are recorded for this pilot.' : 'Use Launch to record rollback owner/path and budget/monitoring review before customer traffic.', pilotOps.status, pilotOps.status === 'ready' ? 'good' : 'warn'),
          row('API proxy self-test kit', apiProxy.status === 'ready' ? 'Provider slots and proxy traffic evidence are visible; use Provider Slots to copy the safe dry-run request.' : 'Use Provider Slots to run/copy a dry-run request and create proxy traffic evidence before the customer walkthrough.', apiProxy.status, apiProxy.status === 'ready' ? 'good' : 'warn'),
          row('Launch support kit', support.status === 'ready' ? 'Support model, internal admin boundary, and customer handoff package are ready for the pilot story.' : 'Use Support to review launch-week support scope and customer handoff boundaries.', support.status, support.status === 'ready' ? 'good' : 'warn'),
          row('Monitoring evidence kit', monitoring.status === 'ready' ? 'Runtime, traffic, alert workflow, Cloud Armor, and budget evidence are ready for launch-week review.' : 'Use Launch and Alerts to record Cloud Armor verification, budget/monitoring review, and alert test workflow before pilot traffic.', monitoring.status, monitoring.status === 'ready' ? 'good' : 'warn'),
          row('Security review packet', securityReview.status === 'ready_for_review' ? 'A copyable customer-safe packet is ready for security, procurement, and technical reviewers.' : 'Runtime readiness or organization scope still needs attention before sharing the review packet.', securityReview.status, securityReview.status === 'ready_for_review' ? 'good' : 'warn'),
          row('Pilot proposal builder', pilotProposal.status === 'ready_to_send' ? 'The paid-pilot proposal is scoped and ready to send after customer review.' : 'Use Pilot Proposal to confirm workload, provider path, owner group, price, support terms, and success metric.', pilotProposal.status, pilotProposal.status === 'ready_to_send' ? 'good' : 'warn'),
          row('Pilot success tracker', pilotSuccess.status === 'on_track' ? 'Pilot milestones, live checks, and weekly update proof are on track.' : 'Use Pilot Success to record kickoff, dry-run, customer review, low-volume traffic, and success metric evidence.', pilotSuccess.status, pilotSuccess.status === 'on_track' ? 'good' : 'warn'),
          row('No raw key exposure', 'Provider slots show posture and material mode without returning encrypted shares or plaintext provider material to the browser.', 'secret safe', 'good'),
          row('Policy denial evidence', 'The blocked-recipient test gives a buyer a concrete denial story: policy rejected unsafe traffic and recorded evidence.', 'auditable', 'good'),
          row('Access and audit exports', 'Members, Audit, Activity, and Evidence produce reviewable CSV/JSON artifacts for security teams.', 'exportable', 'good')
        ].join('');
        byId('demoGuardrailList').innerHTML = [
          row('Demo dry-run first', 'Use dry-run provider execution unless sealed sandbox provider material is intentionally installed for this demo.', 'safe default', 'good'),
          row('Login proof before customer testing', identityQa.status === 'ready' ? 'Identity proof is recorded for this organization.' : 'Do not invite a customer pilot user until login/OAuth proof is recorded or explicitly accepted as a demo hold.', 'identity gate', identityQa.status === 'ready' ? 'good' : 'warn'),
          row('Rotate before paid data', rotation.status === 'accepted_for_demo' ? 'Demo-only key posture is acknowledged; rotate shared material before paid customer data.' : 'Shared/exposed pilot keys still need rotation or an explicit demo-only acceptance note.', 'key gate', rotation.status === 'accepted_for_demo' ? 'good' : 'warn'),
          row('Rollback/monitoring before traffic', pilotOps.status === 'ready' ? 'Rollback and monitoring ownership is recorded for this organization.' : 'Do not start pilot traffic until rollback owner/path and budget/monitoring review are recorded.', 'ops gate', pilotOps.status === 'ready' ? 'good' : 'warn'),
          row('Self-test before live calls', apiProxy.status === 'ready' ? 'API proxy self-test evidence is visible for this organization.' : 'Use dry-run and blocked-recipient tests before enabling any live sandbox provider call.', 'proxy gate', apiProxy.status === 'ready' ? 'good' : 'warn'),
          row('Support boundary before pilot', support.status === 'ready' ? 'Support scope and internal admin boundaries are visible.' : 'Review support model and internal admin boundaries before the customer starts testing.', 'support gate', support.status === 'ready' ? 'good' : 'warn'),
          row('Monitoring before pilot', monitoring.status === 'ready' ? 'Monitoring evidence is ready for launch-week customer testing.' : 'Do not start pilot traffic until runtime, traffic, alert workflow, Cloud Armor, and budget evidence are reviewed.', 'monitoring gate', monitoring.status === 'ready' ? 'good' : 'warn'),
          row('Do not mark GO casually', goNoGo.status === 'go' ? 'The board is green for this browser/org evidence state.' : 'The board is holding on: ' + goNoGo.blockers.join('; '), goNoGo.status, goNoGo.status === 'go' ? 'good' : 'warn'),
          row('Cloud Armor evidence', 'Keep Cloud Armor as a required operator-confirmed check until the live policy exists and verify passes.', 'manual proof', 'warn'),
          row('Key rotation before paid onboarding', 'Shared or exposed pilot keys should be rotated or explicitly accepted for demo-only use before paid customer data.', 'required', 'warn')
        ].join('');
        byId('demoObjectionList').innerHTML = [
          row('Why charge for this?', 'The value is reducing key-leak blast radius, speeding security review, giving audit evidence, and avoiding incident cleanup from abused provider keys.', 'value', 'good'),
          row('Why keep Supabase for the demo?', 'Supabase keeps OAuth/session/Admin Auth working now; a fresh GCP database can be planned after the demo without delaying customer conversations.', 'practical', 'good'),
          row('Do customers need incident response included?', 'Most enterprise buyers have their own teams. Treat 24-hour response as optional add-on or higher-tier coverage, not a mandatory base feature.', 'package', 'good'),
          row('Is this only AI?', 'No. The email-key demo proves the broader category: VaultProof protects sensitive API calls, including email, model, automation, and partner providers.', 'broader', 'good')
        ].join('');
        byId('demoCloseList').innerHTML = [
          linkRow('Package and price', 'Use Plans for the paid-pilot scope, $5k/month starting package, guardrails, and expansion path.', '/app/plans', 'plans', 'good'),
          linkRow('Pilot proposal', 'Copy the first-workload proposal with price, scope, commission math, support terms, and close steps.', '/app/pilot', 'proposal', pilotProposal.status === 'ready_to_send' ? 'good' : 'warn'),
          linkRow('Pilot success', 'Send a weekly update with milestones, blockers, evidence links, and expansion/no-go path.', '/app/pilot-success', 'success', pilotSuccess.status === 'on_track' ? 'good' : 'warn'),
          linkRow('Security review packet', 'Give customer reviewers the concise controls, evidence links, open items, and common answers packet.', '/app/security-review', 'review', securityReview.status === 'ready_for_review' ? 'good' : 'warn'),
          linkRow('Launch evidence', 'Use Launch to prove remaining blockers are visible and assigned before customer traffic.', '/app/launch', 'launch', goNoGo.status === 'go' ? 'good' : 'warn'),
          linkRow('Support room', 'Use Support to explain launch-week support, evidence handoff, internal admin boundary, and approval gates.', '/app/support', 'support', support.status === 'ready' ? 'good' : 'warn'),
          linkRow('Runbooks', 'Use Runbooks for verification, deploy, evidence, secrets, DNS, edge, and cleanup commands.', '/app/runbooks', 'runbooks', 'good'),
          linkRow('Technical review', 'Use the Technical guide for architecture, identity, gateway, key custody, policy, and troubleshooting questions.', '/app/technical-guide', 'guide', 'good')
        ].join('');
        var scriptBox = byId('demoScript');
        if (scriptBox) scriptBox.value = demoScriptText(org, sso, readiness, overview, bootstrap);
      }
      function supportBriefText(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var coverage = support.coverage || {};
        return [
          'VaultProof Enterprise launch support brief',
          'Organization: ' + (coverage.organization_name || org.name || 'selected workspace'),
          'Support readiness: ' + support.status,
          'Support model: ' + support.support_model,
          'Runtime production-ready: ' + (coverage.runtime_production_ready ? 'yes' : 'no'),
          'Security profile: ' + (coverage.security_profile || 'not reported'),
          'SSO/login status: ' + (coverage.sso_provider_status || sso.provider_status || 'not confirmed'),
          'Projects: ' + number(coverage.project_count),
          'Members: ' + number(coverage.member_count),
          'Provider slots: ' + number(coverage.provider_slots),
          'Proxy calls observed: ' + number(coverage.proxy_calls),
          'Employee admin surface: ' + support.internal_admin_surface,
          'Employee admin system: ' + support.internal_admin_boundary.hostname,
          'Internal admin mode: ' + support.internal_admin_boundary.default_mode,
          'Approval gate: ' + support.internal_admin_boundary.writes,
          'Incident response boundary: base pilot uses customer IR plus VaultProof launch support; 24-hour response is an optional add-on.',
          '',
          'Customer handoff:',
          '- ' + support.customer_handoff.join('\\n- '),
          '',
          'Launch-week workflow:',
          '- ' + support.launch_week_workflow.join('\\n- '),
        ].join('\\n');
      }
      function renderSupportPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var support = buildLaunchSupportPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        text('supportMeta', support.status === 'ready' ? 'ready for pilot' : 'hold for evidence');
        byId('supportReadinessList').innerHTML = launchSupportReadinessRows(support).join('');
        byId('supportBoundaryList').innerHTML = launchSupportBoundaryRows(support).join('');
        byId('supportWorkflowList').innerHTML = launchSupportWorkflowRows(support).join('');
        byId('supportHandoffList').innerHTML = launchSupportHandoffRows(support).join('');
        var brief = byId('supportBrief');
        if (brief) brief.value = supportBriefText(org, sso, readiness, overview, bootstrap);
      }
      function renderSecurityReviewPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildSecurityReviewPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        text('securityReviewMeta', packet.status === 'ready_for_review' ? 'ready for review' : 'hold for review');
        byId('securityReviewStatusList').innerHTML = securityReviewStatusRows(packet).join('');
        byId('securityReviewControlList').innerHTML = securityReviewControlRows(packet).join('');
        byId('securityReviewEvidenceList').innerHTML = securityReviewEvidenceRows(packet).join('');
        byId('securityReviewOpenList').innerHTML = securityReviewOpenRows(packet).join('');
        var brief = byId('securityReviewBrief');
        if (brief) brief.value = securityReviewBriefText(packet);
      }
      function renderPilotProposalPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildPilotProposalPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        var state = getPilotProposalState();
        text('pilotMeta', packet.status === 'ready_to_send' ? 'ready to send' : 'draft');
        [
          ['pilotWorkload', 'workload'],
          ['pilotProvider', 'provider_path'],
          ['pilotOwner', 'owner_group'],
          ['pilotMonthlyCalls', 'monthly_calls'],
          ['pilotPrice', 'monthly_price_usd'],
          ['pilotSupportTier', 'support_tier'],
          ['pilotIrAddon', 'incident_response_add_on'],
          ['pilotStartWindow', 'start_window'],
          ['pilotSuccessMetric', 'success_metric']
        ].forEach(function(item) {
          var el = byId(item[0]);
          if (el && document.activeElement !== el) el.value = state[item[1]] || '';
        });
        byId('pilotCommercialList').innerHTML = pilotCommercialRows(packet).join('');
        byId('pilotGuardrailList').innerHTML = pilotGuardrailRows(packet).join('');
        byId('pilotCloseList').innerHTML = pilotCloseRows(packet).join('');
        var brief = byId('pilotProposalBrief');
        if (brief) brief.value = pilotProposalText(packet);
      }
      function renderPilotSuccessPanel(org, sso, readiness, overview, bootstrap) {
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
        var packet = buildPilotSuccessPacket(org, sso, readiness, overview, bootstrap, goNoGo);
        text('pilotSuccessMeta', packet.status === 'on_track' ? 'on track' : 'at risk');
        byId('pilotSuccessStatusList').innerHTML = pilotSuccessStatusRows(packet).join('');
        byId('pilotSuccessMilestoneList').innerHTML = pilotSuccessMilestoneRows(packet).join('');
        byId('pilotSuccessEvidenceList').innerHTML = pilotSuccessEvidenceRows(packet).join('');
        var brief = byId('pilotSuccessBrief');
        if (brief) brief.value = pilotSuccessBriefText(packet);
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
      function renderPanels(orgPayload, readiness, overview, bootstrap) {
        var org = orgPayload.organization || {};
        var sso = orgPayload.sso_status || {};
        var productionReady = readiness.production_ready === true;
        text('kpiProduction', productionReady ? 'yes' : 'no');
        text('kpiProjects', number(org.project_count || overview.totalProjects));
        text('kpiMembers', number(org.member_count));
        text('kpiOrgRole', org.role || 'member');
        text('kpiCalls', number(overview.totalCalls));
        byId('supportKpis').style.display = PAGE_MODE === 'setup' || PAGE_MODE === 'technical-guide' ? 'none' : 'grid';
        byId('launchPanel').style.display = PAGE_MODE === 'launch' ? 'grid' : 'none';
        byId('evidencePanel').style.display = PAGE_MODE === 'evidence' ? 'grid' : 'none';
        byId('demoPanel').style.display = PAGE_MODE === 'demo' ? 'grid' : 'none';
        byId('setupPanel').style.display = PAGE_MODE === 'setup' ? 'block' : 'none';
        byId('technicalGuidePanel').style.display = PAGE_MODE === 'technical-guide' ? 'block' : 'none';
        byId('settingsPanel').style.display = PAGE_MODE === 'settings' ? 'grid' : 'none';
        byId('plansPanel').style.display = PAGE_MODE === 'plans' ? 'grid' : 'none';
        byId('pilotPanel').style.display = PAGE_MODE === 'pilot' ? 'grid' : 'none';
        byId('pilotSuccessPanel').style.display = PAGE_MODE === 'pilot-success' ? 'grid' : 'none';
        byId('scannerPanel').style.display = PAGE_MODE === 'scanner' ? 'grid' : 'none';
        byId('supportPanel').style.display = PAGE_MODE === 'support' ? 'grid' : 'none';
        byId('securityReviewPanel').style.display = PAGE_MODE === 'security-review' ? 'grid' : 'none';
        byId('verifierPanel').style.display = PAGE_MODE === 'verifier' ? 'grid' : 'none';
        byId('runbooksPanel').style.display = PAGE_MODE === 'runbooks' ? 'grid' : 'none';
        if (PAGE_MODE === 'setup') {
          byId('setupStatusList').innerHTML = [
            row('Organization selected', currentOrgId ? 'The page is scoped to the selected organization.' : 'Select an organization before configuring projects, members, or audit exports.', currentOrgId ? 'selected' : 'select org', currentOrgId ? 'good' : 'warn'),
            row('Production readiness', productionReady ? 'The confidential runtime reports production-ready.' : 'Open readiness and clear blockers before sending real traffic.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('SSO status', sso.provider_status === 'configured' ? 'Company sign-in is configured for this organization.' : 'Company sign-in still needs setup or confirmation.', sso.provider_status || 'todo', sso.provider_status === 'configured' ? 'good' : 'warn'),
            row('Projects', number(org.project_count || overview.totalProjects) + ' project scopes are visible for this organization.', number(org.project_count || overview.totalProjects), (org.project_count || overview.totalProjects) ? 'good' : 'warn'),
            row('Members', number(org.member_count) + ' members are visible for this organization.', number(org.member_count), org.member_count ? 'good' : 'warn'),
            row('Recent traffic', number(overview.totalCalls) + ' proxy calls are visible in the current overview window.', 'activity', overview.totalCalls ? 'good' : 'warn')
          ].join('');
          byId('setupReferenceList').innerHTML = [
            linkRow('Dashboard overview', 'Check runtime readiness, organization health, projects, members, calls, and shortcuts.', '/app/dashboard', 'dashboard', 'good'),
            linkRow('Org + SSO', 'Confirm your organization details and company sign-in status.', '/app/org', 'open', 'good'),
            linkRow('Members', 'Invite teammates, assign roles, manage project access, and export access reviews.', '/app/members', 'open', 'good'),
            linkRow('Projects', 'Review project inventory, provider slots, policy status, and health.', '/app/projects', 'open', 'good'),
            linkRow('Control', 'Set caller lock, provider allowlists, upstream restrictions, rate limits, and secure execution policy.', '/app/control', 'open', 'good'),
            linkRow('Provider slots', 'Review active providers, rotation state, Cloud KMS notes, and emergency revoke.', '/app/keys', 'open', 'good'),
            linkRow('Audit', 'Search governance/runtime events and export CSV evidence.', '/app/audit', 'open', 'good'),
            linkRow('Alerts', 'Set destinations, review delivery logs, and send test alerts.', '/app/alerts', 'open', 'good'),
            linkRow('Technical guide', 'Deep implementation details for identity, gateways, key custody, caller lock, evidence, rollout, and troubleshooting.', '/app/technical-guide', 'open', 'good'),
            linkRow('Runbooks', 'Use operator commands for verification, evidence, deployment, secrets, DNS, edge, SSH, and cleanup.', '/app/runbooks', 'open', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'launch') {
          renderLaunchPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'evidence') {
          renderEvidencePanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'demo') {
          renderDemoPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'support') {
          renderSupportPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'security-review') {
          renderSecurityReviewPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'pilot') {
          renderPilotProposalPanel(org, sso, readiness, overview, bootstrap);
        }
        if (PAGE_MODE === 'pilot-success') {
          renderPilotSuccessPanel(org, sso, readiness, overview, bootstrap);
        }
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
            row('Origin lock', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'GCP edge/custom origin lock configured.' : 'Origin lock is not configured.', readiness.control_plane && readiness.control_plane.origin_lock_required ? 'required' : 'optional', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'good' : 'warn'),
            row('Dashboard session storage', 'Enterprise pages read the Supabase session from local storage and call only enterprise control-plane APIs.', 'enterprise only', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'plans') {
          text('planMeta', productionReady ? 'production package' : 'pre-production');
          byId('planList').innerHTML = [
            row('GCP confidential runtime', productionReady ? 'Secure executor is production-ready.' : 'Runtime needs blocker review.', productionReady ? 'ready' : 'blocked', productionReady ? 'good' : 'bad'),
            row('GCP edge package', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'Origin protection is configured for enterprise edge routing.' : 'Edge/origin lock still needs final packaging.', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'ready' : 'todo', readiness.control_plane && readiness.control_plane.origin_lock_configured ? 'good' : 'warn'),
            row('Usage posture', number(overview.totalCalls) + ' calls, ' + number(overview.errorCalls) + ' errors, ' + number(overview.deniedCalls) + ' denied.', (overview.errorRate || 0).toFixed ? (overview.errorRate || 0).toFixed(1) + '% error' : 'usage', (overview.errorCalls || overview.deniedCalls) ? 'warn' : 'good')
          ].join('');
          byId('commercialList').innerHTML = [
            row('Starting package', 'Enterprise paid pilot starts at $5,000/month for one guided customer rollout, one first workload, customer proof reviews, and production-readiness support.', '$5k+/mo', 'good'),
            row('Included controls', 'Company login path, organization/project roles, caller-lock policy, provider/email key slot controls, audit CSV, access-review CSV, alerts, readiness, and evidence packet.', 'included', 'good'),
            row('Capacity envelope', 'Traffic, retention, key slots, SSO depth, support cadence, and dedicated-runtime needs are set in the customer contract until billing APIs enforce them.', 'contract', 'warn'),
            row('Expansion path', 'After the first workload is stable, expand project by project with a new policy/evidence review instead of a broad all-at-once cutover.', 'phased', 'good')
          ].join('');
          byId('guardrailList').innerHTML = [
            row('SOC 2 access evidence', 'Members page exports access review evidence and audit page exports governance/runtime CSV.', 'available', 'good'),
            row('Plan limits', 'Enterprise commercial limits are not enforced by this control plane yet; keep capacity and support terms in the customer contract until billing APIs exist.', 'manual', 'warn'),
            row('Security boundaries', 'Provider keys, encrypted shares, service-role keys, origin-lock values, and signing secrets stay out of customer packets and browser responses.', 'secret safe', 'good'),
            row('Customer rollout notes', 'Use /app/readiness, /app/evidence, /app/audit, /app/members, and /app/keys as the contract-facing evidence bundle.', 'ready', 'good')
          ].join('');
          byId('buyerReviewList').innerHTML = [
            linkRow('Evidence packet', 'Copy or download the customer proof packet before security review.', '/app/evidence', 'packet', 'good'),
            linkRow('Security review packet', 'Share architecture, controls, evidence links, open items, and common answers with customer reviewers.', '/app/security-review', 'review', 'good'),
            linkRow('Pilot proposal', 'Shape the first workload, price, owner group, support tier, and close steps before sending the paid-pilot ask.', '/app/pilot', 'proposal', 'good'),
            linkRow('Pilot success tracker', 'Track weekly proof, customer milestones, blockers, and expansion/no-go decision after kickoff.', '/app/pilot-success', 'success', 'good'),
            linkRow('Launch checklist', 'Review owners, first workload, policy, alerts, evidence exports, and rollback owner.', '/app/launch', 'launch', 'good'),
            linkRow('Launch support', 'Review support model, internal admin boundary, approval gates, and customer handoff package.', '/app/support', 'support', 'good'),
            linkRow('Technical guide', 'Answer architecture, key custody, caller-lock, GCP runtime, and troubleshooting questions.', '/app/technical-guide', 'guide', 'good'),
            linkRow('Runbooks', 'Keep verification, evidence, deploy, DNS, edge, SSH, and cleanup commands visible to operators.', '/app/runbooks', 'runbooks', 'good')
          ].join('');
        }
        if (PAGE_MODE === 'scanner') {
          byId('scannerList').innerHTML = [
            row('Enterprise scanner APIs', 'No enterprise-safe scanner endpoint is enabled on this control plane yet.', 'disabled', 'warn'),
            row('Enterprise scanner isolation', 'This page waits for organization-scoped scanner endpoints before enabling browser actions.', 'isolated', 'good'),
            row('Recommended interim flow', 'Run local scanner tooling during onboarding, then attach sanitized reports to the enterprise audit package.', 'manual', 'warn')
          ].join('');
          byId('scannerChecklist').innerHTML = [
            row('Tenant scoping', 'Scanner results must be scoped to organization/project before enabling browser actions.', 'required', 'warn'),
            row('Finding redaction', 'Secrets and provider tokens must be masked before rendering or exporting.', 'required', 'warn'),
            row('Remediation workflow', 'PR creation, ignore/allowlist, and migration actions need enterprise audit events.', 'required', 'warn')
          ].join('');
        }
        if (PAGE_MODE === 'verifier') {
          loadVerifier();
        }
        if (PAGE_MODE === 'runbooks') {
          byId('runbooksSafeList').innerHTML = [
            row('Hardening status', 'npm run status:enterprise-hardening runs the safe verifier, TLS preflight, gateway plan, alternate-access prep/check, SSH plan, and old prototype inventory in one read-only pass.', 'read-only', 'good'),
            row('Production verifier', 'npm run verify:gcp-enterprise-edge checks the GCP edge, backend health, managed TLS, and live readiness.', 'read-only', 'good'),
            row('Evidence bundle', 'npm run evidence:enterprise-production captures timestamped infrastructure, app, readiness, and monitoring evidence for review.', 'read-only', 'good'),
            row('Evidence validator', 'npm run validate:enterprise-evidence validates the latest evidence bundle before customer or compliance handoff.', 'read-only', 'good'),
            row('Security review packet', 'Open /app/security-review to copy customer-safe architecture, controls, evidence links, open items, common answers, and secret exclusions before procurement review.', 'read-only', 'good'),
            row('Pilot proposal review', 'Open /app/pilot to confirm first workload scope, expected volume, monthly price, 20% sales commission, support boundary, incident-response terms, and close steps.', 'read-only', 'good'),
            row('Pilot success review', 'Open /app/pilot-success to review live checks, milestone evidence, weekly customer update copy, blockers, and expansion/no-go readiness.', 'read-only', 'good'),
            row('Monitoring evidence review', 'Review /app/evidence monitoring_evidence plus /app/alerts destinations, delivery logs, dispatch runs, and test-send workflow before pilot traffic.', 'read-only', 'good'),
            row('Pilot live launch gate', 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch runs live edge, app QA, Cloud Armor, and customer-launch evidence checks before pilot traffic.', 'read-only', 'good'),
            row('Handoff package', 'npm run package:enterprise-handoff assembles customer/compliance docs, gateway templates, latest local evidence, and a manifest without changing live infrastructure.', 'read-only', 'good'),
            row('Handoff gate', 'npm run gate:enterprise-handoff validates gateway templates, builds the package, verifies the manifest, and can optionally require live QA/evidence strictness.', 'read-only', 'good'),
            row('Finish gate', 'npm run gate:enterprise-finish runs local smoke, gateway policy smoke, handoff gate, live app QA, and hardening status into one ok/attention/blocked release view with structured blocker/warning details.', 'read-only', 'good'),
            row('Live app QA', 'npm run qa:enterprise-live-app checks enterprise app pages, internal links, auth-safe rendering, and production readiness.', 'read-only', 'good'),
            row('Strict login QA', 'LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login validates live login redirects, generates a temporary Supabase session, and checks authenticated enterprise APIs when service-role env is loaded.', 'identity', 'good'),
            row('OAuth redirect QA', 'LOGIN_QA_OAUTH_PROVIDER=google npm run qa:enterprise-login checks the public Supabase OAuth authorize redirect after the external provider app is configured.', 'identity', 'good'),
            row('Sealed provider ingest', 'npm run seal:enterprise-provider-slot is the local operator path for live provider material. Keep raw keys out of browser forms and customer packets.', 'rotation', 'good'),
            row('Strict live material gate', 'GOAL1_DEMO_ONLY=false npm run gate:gcp-first-goal requires live encrypted provider material instead of demo placeholders before paid customer data.', 'rotation', 'good'),
            row('Secret rotation preparation', 'npm run prepare:enterprise-secret-rotation plans the install order and can generate fresh executor signing material without printing secrets.', 'read-only', 'good'),
            row('Private origin preparation', 'npm run prepare:enterprise-private-origin inventories edge, gateway, VM network posture, and private-origin migration choices without changing live infrastructure.', 'read-only', 'good'),
            row('Gateway JWT validation preparation', 'npm run prepare:enterprise-apim-jwt plans Supabase or Entra JWT validation settings before enabling gateway JWT validation and can discover the Supabase issuer from the live enterprise login script.', 'read-only', 'good'),
            row('Staff/admin boundary', 'Keep VaultProof staff/admin pages in the separate root/B2C admin system and keep them off enterprise.vaultproof.dev customer routes.', 'read-only', 'good'),
            row('mTLS caller-lock preparation', 'npm run prepare:enterprise-mtls computes a client certificate thumbprint, subject fragment, gateway header contract, and caller-lock policy snippet without changing live infrastructure.', 'read-only', 'good'),
            row('gateway policy template smoke', 'npm run test:enterprise-apim-policies validates provider-secret stripping plus caller-lock header delete/override behavior across VaultProof-managed, customer-managed, device, and mTLS gateway templates before customer handoff.', 'read-only', 'good'),
            row('Origin TLS certificate plan', 'npm run prepare:enterprise-origin-cert plans VM CSR generation, signed certificate install, self-signed marker removal, and local TLS checks.', 'read-only', 'good'),
            row('Origin TLS preparation plan', 'npm run prepare:enterprise-origin-tls previews DNS, firewall, and backend steps before any HTTPS origin cutover.', 'read-only', 'good'),
            row('Origin DNS guardrail', 'Origin DNS changes must happen only through the selected DNS provider and with an explicit operator confirmation phrase.', 'read-only', 'good'),
            row('Origin TLS preflight', 'npm run verify:enterprise-origin-tls checks DNS, NSG 443, nginx, certificate SAN/trust, and local origin health before HttpsOnly cutover.', 'read-only', 'good'),
            row('Alternate access preparation', 'npm run prepare:enterprise-alternate-access plans boot diagnostics and Bastion setup with confirmation-gated live actions.', 'read-only', 'good'),
            row('Alternate access readiness', 'npm run verify:enterprise-alternate-access checks Bastion, boot diagnostics/serial-console prerequisites, Defender JIT visibility, and SSH NSG posture before public SSH closure.', 'read-only', 'good'),
            row('Execution dry run', 'npm run qa:enterprise-live-execute validates auth, policy, signing, and executor reachability without dispatching real provider work.', 'safe default', 'good')
          ].join('');
          byId('runbooksGatedList').innerHTML = [
            row('Deploy to Confidential VM', 'npm run deploy:enterprise-vm copies code, rebuilds, and restarts selected systemd services on the GCP VM.', 'operator', 'warn'),
            row('Secret verification and rotation', 'npm run verify:enterprise-secrets checks installed env posture after the prepared rotation bundle is installed; Supabase key rotation and live env installs remain operator actions.', 'operator', 'warn'),
            row('Origin DNS record', 'DNS record updates require the selected DNS provider and the required operator confirmation phrase.', 'approval', 'warn'),
            row('TLS origin cutover', 'npm run cutover:enterprise-origin-tls plans the GCP edge HTTPS origin cutover and requires strict preflight plus confirmation-gated enable/rollback.', 'blocked', 'warn'),
            row('gateway cutover', 'npm run cutover:enterprise-apim previews gateway route cutover and requires confirmation-gated enable/rollback before GCP edge changes.', 'blocked', 'warn'),
            row('SSH hardening', 'npm run harden:enterprise-ssh can plan, close, or reopen bootstrap SSH with readiness, alternate-access, and confirmation gates.', 'approval', 'warn'),
            row('GCP runtime reset rollback', 'gcloud compute instances reset vaultproof-enterprise-runtime-1 --zone=us-central1-a --project=vaultproof-prod resets the current enterprise runtime VM when the named rollback owner approves.', 'operator', 'warn'),
            row('old prototype cleanup', 'npm run cleanup:enterprise-container-apps inventories the old prototype resources and requires action-specific confirmation before ingress disable/restore/delete.', 'approval', 'warn')
          ].join('');
        }
      }
      function populateVerifierSelect(selectId, rows, current) {
        var select = byId(selectId);
        if (!select) return;
        select.innerHTML = rows.length ? rows.map(function(row) {
          return '<option value="' + escapeHtml(row.value) + '"' + (current === row.value ? ' selected' : '') + '>' + escapeHtml(row.label) + '</option>';
        }).join('') : '<option value="">No options</option>';
      }
      function renderVerifier(payload) {
        var projects = Array.isArray(payload.projects) ? payload.projects : [];
        var models = Array.isArray(payload.models) ? payload.models : [];
        var verifications = Array.isArray(payload.verifications) ? payload.verifications : [];
        var sharedAttestation = payload.shared_attestation || {};
        var projectOptions = projects.map(function(project) {
          return { value: project.id, label: (project.name || project.vp_proj_id || project.id) + ' - ' + (project.project_role || 'project') };
        });
        byId('verifierAttestationList').innerHTML = row(
          sharedAttestation.label || 'Shared enterprise runtime attestation',
          'Mode: ' + (sharedAttestation.mode || 'shared-enterprise-runtime-attestation') + '. Tier: ' + (sharedAttestation.runtime_tier || 'shared-demo') + '. Source: ' + (sharedAttestation.source || '/readiness') + '. Dynamic guest attestation is required; static attestation tokens stay disabled.',
          sharedAttestation.customer_dedicated_runtime ? 'dedicated' : 'shared',
          'good'
        );
        populateVerifierSelect('verifierModelProjectSelect', projectOptions, projectOptions[0] && projectOptions[0].value);
        populateVerifierSelect('verifierProofProjectSelect', projectOptions, projectOptions[0] && projectOptions[0].value);
        populateVerifierSelect('verifierProofModelSelect', models.map(function(model) {
          return { value: model.model_ref, label: (model.display_name || model.model_ref) + ' - ' + model.model_ref };
        }), models[0] && models[0].model_ref);
        if (!payload.schema_ready) {
          byId('verifierModelList').innerHTML = '<div class="empty">AI Proof Verifier tables are not deployed yet. Apply the verifier Supabase migration before customer use.</div>';
          byId('verifierEvidenceList').innerHTML = '<div class="empty">Proof evidence will appear after the migration is deployed and proof bundles are submitted.</div>';
          return;
        }
        byId('verifierModelList').innerHTML = models.length ? models.map(function(model) {
          var systems = Array.isArray(model.allowed_proof_systems) ? model.allowed_proof_systems.join(', ') : 'vaultproof-manifest-v1';
          return row(model.display_name || model.model_ref, 'External model only. Family: ' + (model.model_family || 'custom') + '. Proof systems: ' + systems, model.status || 'enabled', model.status === 'enabled' ? 'good' : 'warn');
        }).join('') : '<div class="empty">No models registered yet. Add the external model ID first, then submit proof bundles from jobs that ran outside VaultProof.</div>';
        byId('verifierEvidenceList').innerHTML = verifications.length ? verifications.map(function(item) {
          var tone = item.status === 'verified' ? 'good' : item.status === 'failed' ? 'bad' : 'warn';
          var detail = 'Proof system: ' + (item.proof_system || 'unknown') + '. Hash: ' + (item.proof_hash || '').slice(0, 38) + (item.failure_reason ? '. ' + item.failure_reason : '');
          return row((item.model_ref || 'model') + ' - ' + (item.status || 'recorded'), detail, item.status || 'recorded', tone);
        }).join('') : '<div class="empty">No proof bundles submitted yet. VaultProof verifies/stores evidence; it does not run the model.</div>';
      }
      async function loadVerifier() {
        try {
          renderVerifier(await fetchJson('/api/v1/enterprise/verifier'));
        } catch (error) {
          byId('verifierModelList').innerHTML = '<div class="empty">' + escapeHtml(error && error.message ? error.message : 'Verifier failed to load.') + '</div>';
          byId('verifierEvidenceList').innerHTML = '<div class="empty">Proof evidence unavailable.</div>';
        }
      }
      async function submitVerifierModel(event) {
        event.preventDefault();
        try {
          await fetchJson('/api/v1/enterprise/verifier/models', {
            method: 'POST',
            body: JSON.stringify({
              project_id: byId('verifierModelProjectSelect').value,
              model_ref: byId('verifierModelRef').value,
              display_name: byId('verifierModelName').value,
              model_family: byId('verifierModelFamily').value,
              allowed_proof_systems: byId('verifierProofSystems').value.split(',').map(function(value) { return value.trim(); }).filter(Boolean),
            })
          });
          byId('verifierModelRef').value = '';
          byId('verifierModelName').value = '';
          await loadVerifier();
        } catch (error) {
          notice(error && error.message ? error.message : 'Failed to save verifier model.');
        }
      }
      async function submitVerifierProof(event) {
        event.preventDefault();
        try {
          var bundleRaw = byId('verifierProofBundle').value.trim();
          var proofBundle = bundleRaw ? JSON.parse(bundleRaw) : undefined;
          await fetchJson('/api/v1/enterprise/verifier/proofs', {
            method: 'POST',
            body: JSON.stringify({
              project_id: byId('verifierProofProjectSelect').value,
              model_ref: byId('verifierProofModelSelect').value,
              proof_system: byId('verifierProofSystem').value,
              claimed_output_hash: byId('verifierOutputHash').value,
              proof_bundle: proofBundle,
            })
          });
          byId('verifierProofBundle').value = '';
          await loadVerifier();
        } catch (error) {
          notice(error && error.message ? error.message : 'Failed to verify proof bundle. Use valid JSON for the proof bundle.');
        }
      }
      async function reload() {
        if (!token) {
          notice('Enterprise session missing.');
          return;
        }
        notice('');
        try {
          var bootstrap = await fetchJson('/api/v1/enterprise/projects/bootstrap');
          renderOrgSelector(bootstrap);
          var results = await Promise.all([
            fetchJson('/api/v1/enterprise/orgs/current'),
            fetchJson('/readiness')
          ]);
          latestOrgPayload = results[0];
          latestReadiness = results[1];
          latestOverview = (bootstrap && bootstrap.overview) || {};
          latestBootstrap = bootstrap || {};
          renderPanels(latestOrgPayload, latestReadiness, latestOverview, latestBootstrap);
        } catch (error) {
          notice(error && error.message ? error.message : 'Enterprise admin page failed to load.');
        }
      }
      byId('refreshBtn').addEventListener('click', reload);
      var verifierModelForm = byId('verifierModelForm');
      if (verifierModelForm) verifierModelForm.addEventListener('submit', submitVerifierModel);
      var verifierProofForm = byId('verifierProofForm');
      if (verifierProofForm) verifierProofForm.addEventListener('submit', submitVerifierProof);
      var pilotProposalForm = byId('pilotProposalForm');
      if (pilotProposalForm) pilotProposalForm.addEventListener('submit', function(event) {
        event.preventDefault();
      });
      document.addEventListener('change', function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
        if (target.hasAttribute('data-go-no-go-check')) {
          setGoNoGoManualState(target.getAttribute('data-go-no-go-check') || '', { status: target.checked ? 'passed' : 'missing', passed: target.checked });
          reload();
          return;
        }
        if (target.hasAttribute('data-go-no-go-status')) {
          var status = normalizeGoNoGoStatus(target.value, false);
          setGoNoGoManualState(target.getAttribute('data-go-no-go-status') || '', { status: status, passed: status === 'passed' });
          reload();
          return;
        }
        if (target.hasAttribute('data-go-no-go-note')) {
          setGoNoGoManualState(target.getAttribute('data-go-no-go-note') || '', { note: target.value });
          reload();
          return;
        }
        if (target.hasAttribute('data-pilot-field')) {
          setPilotProposalState(target.getAttribute('data-pilot-field') || '', target.value);
          if (latestOrgPayload && latestReadiness) {
            renderPilotProposalPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-pilot-success-check')) {
          setPilotSuccessState(target.getAttribute('data-pilot-success-check') || '', { passed: target.checked === true });
          if (latestOrgPayload && latestReadiness) {
            renderPilotSuccessPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (target.hasAttribute('data-pilot-success-note')) {
          setPilotSuccessState(target.getAttribute('data-pilot-success-note') || '', { note: target.value });
          if (latestOrgPayload && latestReadiness) {
            renderPilotSuccessPanel((latestOrgPayload && latestOrgPayload.organization) || {}, (latestOrgPayload && latestOrgPayload.sso_status) || {}, latestReadiness, latestOverview || {}, latestBootstrap || {});
          }
          return;
        }
        if (!target.hasAttribute('data-launch-check')) return;
        setLaunchManualState(target.getAttribute('data-launch-check') || '', target.checked);
        reload();
      });
      var copyLaunchBriefBtn = byId('copyLaunchBriefBtn');
      if (copyLaunchBriefBtn) copyLaunchBriefBtn.addEventListener('click', async function() {
        var brief = byId('launchBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copyLaunchBriefBtn.textContent = 'copied';
          setTimeout(function() { copyLaunchBriefBtn.textContent = 'copy brief'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyEvidencePacketBtn = byId('copyEvidencePacketBtn');
      if (copyEvidencePacketBtn) copyEvidencePacketBtn.addEventListener('click', async function() {
        var packet = byId('evidencePacket');
        if (!packet) return;
        try {
          await navigator.clipboard.writeText(packet.value);
          copyEvidencePacketBtn.textContent = 'copied';
          setTimeout(function() { copyEvidencePacketBtn.textContent = 'copy JSON'; }, 1400);
        } catch (_) {
          packet.focus();
          packet.select();
        }
      });
      var copyDemoScriptBtn = byId('copyDemoScriptBtn');
      if (copyDemoScriptBtn) copyDemoScriptBtn.addEventListener('click', async function() {
        var script = byId('demoScript');
        if (!script) return;
        try {
          await navigator.clipboard.writeText(script.value);
          copyDemoScriptBtn.textContent = 'copied';
          setTimeout(function() { copyDemoScriptBtn.textContent = 'copy script'; }, 1400);
        } catch (_) {
          script.focus();
          script.select();
        }
      });
      var copySupportBriefBtn = byId('copySupportBriefBtn');
      if (copySupportBriefBtn) copySupportBriefBtn.addEventListener('click', async function() {
        var brief = byId('supportBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copySupportBriefBtn.textContent = 'copied';
          setTimeout(function() { copySupportBriefBtn.textContent = 'copy brief'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copySecurityReviewBtn = byId('copySecurityReviewBtn');
      if (copySecurityReviewBtn) copySecurityReviewBtn.addEventListener('click', async function() {
        var brief = byId('securityReviewBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copySecurityReviewBtn.textContent = 'copied';
          setTimeout(function() { copySecurityReviewBtn.textContent = 'copy packet'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyPilotProposalBtn = byId('copyPilotProposalBtn');
      if (copyPilotProposalBtn) copyPilotProposalBtn.addEventListener('click', async function() {
        var brief = byId('pilotProposalBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copyPilotProposalBtn.textContent = 'copied';
          setTimeout(function() { copyPilotProposalBtn.textContent = 'copy proposal'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var copyPilotSuccessBtn = byId('copyPilotSuccessBtn');
      if (copyPilotSuccessBtn) copyPilotSuccessBtn.addEventListener('click', async function() {
        var brief = byId('pilotSuccessBrief');
        if (!brief) return;
        try {
          await navigator.clipboard.writeText(brief.value);
          copyPilotSuccessBtn.textContent = 'copied';
          setTimeout(function() { copyPilotSuccessBtn.textContent = 'copy update'; }, 1400);
        } catch (_) {
          brief.focus();
          brief.select();
        }
      });
      var downloadEvidencePacketBtn = byId('downloadEvidencePacketBtn');
      if (downloadEvidencePacketBtn) downloadEvidencePacketBtn.addEventListener('click', function() {
        var packet = byId('evidencePacket');
        if (!packet) return;
        var blob = new Blob([packet.value], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = 'vaultproof-evidence-packet.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      });
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
  if (pageName === 'activity' || pageName === 'projects' || pageName === 'inventory' || pageName === 'policy' || pageName === 'rollout' || pageName === 'keys') {
    return injectEnterpriseAnalytics(renderEnterpriseOperationsPage(pageName), env, pageName);
  }
  if (pageName === 'setup' || pageName === 'launch' || pageName === 'evidence' || pageName === 'demo' || pageName === 'technical-guide' || pageName === 'security-review' || pageName === 'verifier' || pageName === 'settings' || pageName === 'plans' || pageName === 'pilot' || pageName === 'pilot-success' || pageName === 'scanner' || pageName === 'support' || pageName === 'runbooks') {
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
    ${ENTERPRISE_RENDERED_APP_BASE_THEME}
    .main { padding: 30px; max-width: 1380px; width: 100%; }
    .card { width: min(940px, 100%); border: 1px solid var(--line); border-radius: 24px; background: linear-gradient(180deg, rgba(255,255,255,.98), rgba(247,250,244,.86)); padding: clamp(24px, 5vw, 48px); box-shadow: 0 22px 72px rgba(48,76,71,.18); }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 10px 0 12px; font-size: clamp(40px, 7vw, 82px); letter-spacing: -.075em; line-height: .9; }
    .summary { color: var(--muted); font-size: 17px; line-height: 1.65; max-width: 760px; }
    .grid { margin-top: 28px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .feature { border: 1px solid var(--line-soft); border-radius: 18px; padding: 14px; background: rgba(247,250,244,.82); color: var(--text); }
    .actions { margin-top: 30px; display: flex; gap: 12px; flex-wrap: wrap; }
    .btn { border: 1px solid var(--line); border-radius: 15px; padding: 12px 14px; background: rgba(255,255,255,.78); }
    .btn.primary { background: linear-gradient(135deg, var(--gold), #f3df95); color: var(--ink); border: 0; font-weight: 850; }
    .note { margin-top: 20px; color: var(--muted); font-size: 13px; }
    @media (max-width: 720px) { .grid { grid-template-columns: 1fr; } }
    ${ENTERPRISE_APP_SHELL_THEME}
    ${ENTERPRISE_STATIC_APP_POLISH_THEME}
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar(pageName as EnterpriseAppNavPage, page.kicker)}
    <main class="main">
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
  </div>
</body>
</html>`, env, pageName);
}

export function renderEnterpriseControlPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(
    applyEnterpriseStaticAppTheme(readEnterpriseAppPage('control.html'), 'control', 'policy control'),
    env,
    'control',
  );
}

export function renderEnterpriseOrgPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(
    applyEnterpriseStaticAppTheme(readEnterpriseAppPage('org.html'), 'org', 'organization setup'),
    env,
    'org',
  );
}
