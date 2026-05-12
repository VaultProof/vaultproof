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

function renderEnterpriseOperationsPage(pageName: 'activity' | 'projects' | 'keys'): string {
  const pageTitle = pageName === 'activity' ? 'Activity' : pageName === 'projects' ? 'Projects' : 'Provider Slots';
  const pageKicker = pageName === 'activity' ? 'runtime feed' : pageName === 'projects' ? 'project inventory' : 'secrets posture';
  const pageLead = pageName === 'activity'
    ? 'Review secure proxy/runtime events, status codes, latency, provider request IDs, and attestation evidence hints.'
    : pageName === 'projects'
      ? 'Track enterprise projects, provider coverage, caller-lock policy, traffic health, and quick links into Control.'
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
    .tag { display: inline-block; color: var(--blue); font-size: 12px; border: 1px solid rgba(22,138,159,.24); border-radius: 999px; padding: 5px 8px; margin: 3px 4px 0 0; }
    .tag.good { color: var(--green); border-color: rgba(62,93,87,.24); }
    .tag.warn { color: var(--gold); border-color: rgba(213,169,20,.28); }
    .tag.bad { color: var(--red); border-color: rgba(185,93,80,.28); }
    .empty, .notice { color: var(--muted); border: 1px dashed rgba(48,76,71,.22); border-radius: 18px; padding: 18px; background: rgba(247,250,244,.78); }
    .notice.error { color: var(--red); border-color: rgba(185,93,80,.3); }
    @media (max-width: 1100px) { .filters, .kpis, .two { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .topbar { flex-direction: column; } .filters, .kpis, .two { grid-template-columns: 1fr; } }
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

      ${pageName === 'keys' ? `
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
      var providerDefaults = {
        openai: { upstream: 'https://api.openai.com', header: 'authorization', template: 'Bearer {key}' },
        anthropic: { upstream: 'https://api.anthropic.com', header: 'x-api-key', template: '{key}' },
        resend: { upstream: 'https://api.resend.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/emails' },
        sendgrid: { upstream: 'https://api.sendgrid.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/v3/mail/send' },
        mailgun: { upstream: 'https://api.mailgun.net', header: 'authorization', template: 'Basic {key}', emailPath: '/v3/example.com/messages' },
        postmark: { upstream: 'https://api.postmarkapp.com', header: 'x-postmark-server-token', template: '{key}', emailPath: '/email' },
        'aws-ses': { upstream: 'https://email.us-east-1.amazonaws.com', header: 'authorization', template: 'Bearer {key}', emailPath: '/' },
        stripe: { upstream: 'https://api.stripe.com', header: 'authorization', template: 'Bearer {key}' },
        twilio: { upstream: 'https://api.twilio.com', header: 'authorization', template: 'Basic {key}' },
        snowflake: { upstream: 'https://snowflakecomputing.com', header: 'authorization', template: 'Bearer {key}' }
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
      document.addEventListener('click', async function(event) {
        var target = event.target;
        if (!target || !target.getAttribute) return;
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

type EnterpriseSupportPageName = 'setup' | 'launch' | 'evidence' | 'technical-guide' | 'verifier' | 'settings' | 'plans' | 'scanner' | 'runbooks';

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
    'technical-guide': {
      title: 'Technical guide',
      kicker: 'implementation details',
      lead: 'Deep implementation reference for identity, gateways, project modeling, caller lock, key custody, evidence, operations, rollout, and troubleshooting. Use it when technical teams need the exact wiring behind the setup guide.',
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
    scanner: {
      title: 'Scanner',
      kicker: 'repository security',
      lead: 'Prepare repository scanning for enterprise use while keeping scanner actions disabled until enterprise-safe scanner APIs are available.',
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
      function launchBriefText(org, sso, readiness, overview, percent, doneCount, totalCount, goNoGo) {
        var productionReady = readiness.production_ready === true;
        var blockers = goNoGo && goNoGo.blockers && goNoGo.blockers.length
          ? goNoGo.blockers.join('; ')
          : 'none';
        return [
          'VaultProof Enterprise launch brief',
          'Organization: ' + (org.name || 'selected workspace'),
          'Launch progress: ' + percent + '% (' + doneCount + '/' + totalCount + ' tasks)',
          'Go/no-go decision: ' + (goNoGo && goNoGo.status === 'go' ? 'GO' : 'HOLD'),
          'Go/no-go blockers: ' + blockers,
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
          '- Complete strict login QA, Cloud Armor verification, key-rotation review, rollback owner, and budget/monitoring review.',
          '- Export audit and access-review evidence.',
          '- Send one low-volume dry-run or test request before production traffic.',
        ].join('\\n');
      }
      function renderLaunchPanel(org, sso, readiness, overview, bootstrap) {
        var manualState = getLaunchManualState();
        var items = buildLaunchItems(org, sso, readiness, overview, bootstrap);
        var goNoGo = buildGoNoGoStatus(org, sso, readiness, overview, bootstrap);
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
        if (brief) brief.value = launchBriefText(org, sso, readiness, overview, percent, doneCount, totalCount, goNoGo);
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
          exports: {
            readiness: '/readiness',
            audit_csv_30_days: evidenceExportHref('/api/v1/enterprise/audit?format=csv&days=30'),
            access_review_csv: evidenceExportHref('/api/v1/enterprise/members/access-review?format=csv'),
            activity: '/app/activity',
            provider_slots: '/app/keys',
            launch_checklist: '/app/launch'
          },
          customer_review_notes: [
            'Verify production readiness before customer traffic.',
            'Review the go/no-go launch decision and close any hold blockers.',
            'Export audit CSV and access-review CSV for the review packet.',
            'Confirm caller-lock policy, provider slot posture, and emergency revoke owners.',
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
          linkRow('Review technical guide', 'Use the implementation guide for architecture, trust boundaries, key custody, and troubleshooting answers.', '/app/technical-guide', 'guide', 'good'),
          linkRow('Review runbooks', 'Operator commands for verification, evidence capture, deploys, secrets, DNS, edge, SSH, and cleanup.', '/app/runbooks', 'runbooks', 'good')
        ].join('');
        var packetBox = byId('evidencePacket');
        if (packetBox) packetBox.value = JSON.stringify(packet, null, 2);
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
        byId('setupPanel').style.display = PAGE_MODE === 'setup' ? 'block' : 'none';
        byId('technicalGuidePanel').style.display = PAGE_MODE === 'technical-guide' ? 'block' : 'none';
        byId('settingsPanel').style.display = PAGE_MODE === 'settings' ? 'grid' : 'none';
        byId('plansPanel').style.display = PAGE_MODE === 'plans' ? 'grid' : 'none';
        byId('scannerPanel').style.display = PAGE_MODE === 'scanner' ? 'grid' : 'none';
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
            linkRow('Launch checklist', 'Review owners, first workload, policy, alerts, evidence exports, and rollback owner.', '/app/launch', 'launch', 'good'),
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
            row('Handoff package', 'npm run package:enterprise-handoff assembles customer/compliance docs, gateway templates, latest local evidence, and a manifest without changing live infrastructure.', 'read-only', 'good'),
            row('Handoff gate', 'npm run gate:enterprise-handoff validates gateway templates, builds the package, verifies the manifest, and can optionally require live QA/evidence strictness.', 'read-only', 'good'),
            row('Finish gate', 'npm run gate:enterprise-finish runs local smoke, gateway policy smoke, handoff gate, live app QA, and hardening status into one ok/attention/blocked release view with structured blocker/warning details.', 'read-only', 'good'),
            row('Live app QA', 'npm run qa:enterprise-live-app checks enterprise app pages, internal links, auth-safe rendering, and production readiness.', 'read-only', 'good'),
            row('Secret rotation preparation', 'npm run prepare:enterprise-secret-rotation plans the install order and can generate fresh executor signing material without printing secrets.', 'read-only', 'good'),
            row('Private origin preparation', 'npm run prepare:enterprise-private-origin inventories edge, gateway, VM network posture, and private-origin migration choices without changing live infrastructure.', 'read-only', 'good'),
            row('Gateway JWT validation preparation', 'npm run prepare:enterprise-apim-jwt plans Supabase or Entra JWT validation settings before enabling gateway JWT validation and can discover the Supabase issuer from the live enterprise login script.', 'read-only', 'good'),
            row('Internal admin preparation', 'npm run prepare:enterprise-internal-admin checks employee allowlist env, internal admin schema tables, customer-host separation, and admin-host auth behavior before exposing admin.vaultproof.dev.', 'read-only', 'good'),
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
          renderPanels(results[0], results[1], (bootstrap && bootstrap.overview) || {}, bootstrap || {});
        } catch (error) {
          notice(error && error.message ? error.message : 'Enterprise admin page failed to load.');
        }
      }
      byId('refreshBtn').addEventListener('click', reload);
      var verifierModelForm = byId('verifierModelForm');
      if (verifierModelForm) verifierModelForm.addEventListener('submit', submitVerifierModel);
      var verifierProofForm = byId('verifierProofForm');
      if (verifierProofForm) verifierProofForm.addEventListener('submit', submitVerifierProof);
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
  if (pageName === 'activity' || pageName === 'projects' || pageName === 'keys') {
    return injectEnterpriseAnalytics(renderEnterpriseOperationsPage(pageName), env, pageName);
  }
  if (pageName === 'setup' || pageName === 'launch' || pageName === 'evidence' || pageName === 'technical-guide' || pageName === 'verifier' || pageName === 'settings' || pageName === 'plans' || pageName === 'scanner' || pageName === 'runbooks') {
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
