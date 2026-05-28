import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';
import { ENTERPRISE_APP_SHELL_THEME, renderEnterpriseAppSidebar } from './enterprise-app-shell.js';

const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing. Sign in again to continue.';
const ENABLE_ENTERPRISE_DASHBOARD_SAMPLE_DATA = true; // Set to false to remove the empty-dashboard sample dataset.

export function renderEnterpriseDashboardPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Enterprise Dashboard - VaultProof</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f6f8fb;
      --panel: rgba(255, 255, 255, 0.9);
      --panel-strong: #ffffff;
      --card-bg: #ffffff;
      --row-bg: #f8fafc;
      --line: #d9e1ea;
      --line-soft: #e7edf3;
      --text: #18212b;
      --muted: #5e6b78;
      --soft: #718090;
      --gold: #315f95;
      --green: #15803d;
      --red: #dc2626;
      --blue: #2563eb;
      --warn: #d97706;
      --ink: #ffffff;
      --control-bg: #ffffff;
      --primary-bg: #315f95;
      --primary-text: #ffffff;
      --primary-border: #315f95;
      --shadow: 0 18px 54px rgba(24, 33, 43, 0.09);
      --dashboard-ink: #18212b;
      --dashboard-cloud: #d9e1ea;
      --dashboard-rose: #315f95;
      --dashboard-panel: #f6f8fb;
      --dashboard-track: #e7edf3;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 400;
      color: var(--text);
      background: #f6f8fb;
    }
    a { color: inherit; text-decoration: none; }
    ${ENTERPRISE_APP_SHELL_THEME}
    :root {
      --gold: #315f95;
      --accent: #315f95;
      --accent-soft: rgba(49, 95, 149, 0.12);
      --primary-bg: #315f95;
      --primary-text: #ffffff;
      --primary-border: #315f95;
      --dashboard-rose: #315f95;
      --sidebar-link-active-bg: rgba(49, 95, 149, 0.20);
      --sidebar-link-active-border: rgba(111, 158, 213, 0.44);
    }
    .enterprise-dashboard-main,
    .enterprise-dashboard-main * {
      letter-spacing: 0 !important;
    }
    .main.enterprise-dashboard-main {
      padding: 0;
      max-width: none;
      width: 100%;
    }
    .enterprise-page-shell {
      background: transparent;
      border: 0;
      border-radius: 0;
      padding: 0;
      box-shadow: none;
      display: grid;
      gap: 16px;
    }
    .dashboard-head-card,
    .control-center-card {
      border: 1px solid var(--line);
      background: var(--dashboard-panel);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 20px 60px rgba(44, 48, 55, 0.08);
    }
    .dashboard-head-card {
      margin-bottom: 0;
      display: grid;
      gap: 16px;
    }
    .control-center-card {
      background: #ffffff;
      padding: 18px;
    }
    .topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: stretch;
      gap: 16px;
      margin-bottom: 0;
    }
    .hero-copy {
      display: grid;
      align-content: center;
      min-height: 196px;
      border: 1px solid rgba(44, 48, 55, 0.08);
      border-radius: 8px;
      padding: clamp(22px, 4vw, 34px);
      background: #ffffff;
    }
    .dashboard-refresh-control { margin-top: 18px; }
    .eyebrow {
      display: inline-flex;
      color: var(--dashboard-rose);
      background: rgba(126, 80, 93, 0.08);
      border: 1px solid rgba(126, 80, 93, 0.16);
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-weight: 600;
    }
    h1 { color: var(--dashboard-ink); font-size: 1.875rem; font-weight: 650; letter-spacing: 0; line-height: 2.25rem; margin: 12px 0 12px; max-width: 760px; }
    @media (min-width: 640px) {
      h1 { font-size: 2.6rem; }
    }
    .lead { color: var(--muted); max-width: 760px; font-size: 14px; line-height: 1.75; }
    @media (min-width: 640px) {
      .lead { font-size: 16px; }
    }
    .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .hero-toolbar { margin-top: 18px; }
    select, button {
      border: 1px solid var(--line);
      background: var(--control-bg);
      color: var(--text);
      border-radius: 8px;
      padding: 11px 12px;
      font: inherit;
    }
    option { background: var(--option-bg); color: var(--option-text); }
    button { cursor: pointer; }
    .primary {
      background: var(--primary-bg, var(--gold));
      color: var(--primary-text, var(--text));
      border-color: var(--primary-border, var(--gold));
      font-weight: 600;
    }
    .chart-context-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .context-card {
      display: block;
      border: 1px solid var(--line-soft);
      background: #f8fafc;
      border-radius: 8px;
      padding: 13px;
      min-height: 96px;
    }
    .context-card.critical {
      border-color: rgba(217, 119, 6, 0.28);
      background: #fffaf3;
    }
    .context-label {
      color: var(--dashboard-rose);
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
    }
    .context-title {
      font-size: 17px;
      font-weight: 600;
      margin-top: 8px;
    }
    .context-copy {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.5;
      margin-top: 6px;
    }
    .control-center-intro {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 16px;
    }
    .control-title {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0;
      margin: 0;
    }
    .control-copy {
      color: var(--muted);
      margin: 6px 0 0;
      max-width: 700px;
      line-height: 1.5;
      font-size: 14px;
    }
    .grid { display: grid; gap: 14px; }
    .two { grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr); }
    .dashboard-overview-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      align-items: start;
    }
    .overview-primary,
    .overview-rail {
      display: grid;
      gap: 14px;
      min-width: 0;
    }
    .card {
      border: 1px solid var(--line);
      background: var(--card-bg);
      border-radius: 8px;
      padding: 18px;
      box-shadow: 0 16px 42px rgba(44, 48, 55, 0.07);
    }
    .status-pill {
      display: inline-flex; align-items: center; gap: 8px;
      border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 600;
      background: rgba(21, 128, 61, 0.10); color: var(--green); border: 1px solid rgba(21, 128, 61, 0.22);
    }
    .status-pill.warn { background: rgba(180, 83, 9, 0.10); color: var(--warn); border-color: rgba(180, 83, 9, 0.28); }
    .status-pill.bad { background: rgba(220, 38, 38, 0.12); color: var(--red); border-color: rgba(220, 38, 38, 0.28); }
    .attention-card {
      border-color: rgba(49, 95, 149, 0.18);
      background: linear-gradient(180deg, #ffffff, #f8fafc);
    }
    .attention-list {
      display: grid;
      gap: 10px;
    }
    .attention-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 13px;
      background: #ffffff;
    }
    .attention-row.warn { border-color: rgba(217, 119, 6, 0.28); background: #fffaf3; }
    .attention-row.bad { border-color: rgba(220, 38, 38, 0.24); background: #fff7f7; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: 0; }
    .section-title p { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .business-card h2, .intent-card h3, .action-card h3 { margin: 0; letter-spacing: 0; }
    .business-card p, .intent-card p, .action-card p { margin: 8px 0 0; color: var(--muted); line-height: 1.5; font-size: 13px; }
    .tabbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 7px;
      margin-bottom: 16px;
      background: #f8fafc;
    }
    .tab-button {
      border-radius: 7px;
      padding: 10px 12px;
      color: var(--nav-text);
      background: transparent;
      border-color: transparent;
    }
    .tab-button.active {
      background: var(--primary-bg, var(--gold));
      color: var(--primary-text, var(--text));
      border-color: var(--primary-border, var(--gold));
      font-weight: 600;
    }
    .tab-panel { display: grid; gap: 16px; }
    .tab-panel[hidden] { display: none; }
    .intent-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .intent-card, .action-card {
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 16px;
      background: var(--row-bg);
    }
    .rail-card {
      display: grid;
      gap: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      background: #ffffff;
      box-shadow: 0 16px 42px rgba(44, 48, 55, 0.07);
    }
    .overview-rail {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .rail-card.accent {
      background: #2c3037;
      border-color: #2c3037;
      color: #ffffff;
    }
    .rail-card.accent .rail-title,
    .rail-card.accent .rail-value {
      color: #ffffff;
    }
    .rail-card.accent .rail-copy,
    .rail-card.accent .rail-meta {
      color: rgba(255, 255, 255, 0.72);
    }
    .rail-title {
      color: var(--dashboard-ink);
      font-size: 14px;
      font-weight: 700;
    }
    .rail-value {
      color: var(--dashboard-ink);
      font-size: 28px;
      font-weight: 700;
      line-height: 1;
    }
    .rail-copy,
    .rail-meta {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.45;
      margin: 0;
    }
    .rail-actions {
      display: grid;
      gap: 8px;
    }
    .action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .action-card { display: flex; flex-direction: column; gap: 10px; min-height: 176px; }
    .action-card .action { margin-top: auto; align-self: flex-start; }
    .call-overview-card {
      border-color: rgba(49, 95, 149, 0.20);
      background: linear-gradient(180deg, #ffffff, #f8fbfc);
    }
    .call-overview-head {
      align-items: flex-start;
    }
    .timeframe-toggle {
      display: inline-flex;
      gap: 4px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 4px;
      background: #f8fafc;
      flex: 0 0 auto;
    }
    .timeframe-button {
      border: 0;
      border-radius: 6px;
      background: transparent;
      color: var(--muted);
      padding: 8px 10px;
      min-width: 52px;
      font-size: 13px;
    }
    .timeframe-button.active {
      background: var(--primary-bg);
      color: var(--primary-text);
      font-weight: 650;
    }
    .call-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .call-summary-item {
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 12px;
      background: #ffffff;
    }
    .call-summary-label {
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 650;
    }
    .call-summary-value {
      color: var(--dashboard-ink);
      display: block;
      font-size: 24px;
      font-weight: 720;
      margin-top: 6px;
    }
    .call-chart-meta {
      margin-bottom: 10px;
    }
    .top-insight-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
    }
    .visual-card {
      display: grid;
      gap: 14px;
      min-width: 0;
    }
    .visual-body {
      display: grid;
      gap: 12px;
      align-items: center;
    }
    .donut-wrap {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      justify-items: center;
    }
    .donut {
      width: 148px;
      aspect-ratio: 1;
      border-radius: 50%;
      display: grid;
      place-items: center;
      background: conic-gradient(#e7edf3 0deg 360deg);
      box-shadow: inset 0 0 0 1px rgba(44, 48, 55, 0.08);
      position: relative;
    }
    .donut::after {
      content: "";
      position: absolute;
      inset: 26px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 0 0 1px rgba(44, 48, 55, 0.08);
    }
    .donut-center {
      position: relative;
      z-index: 1;
      display: grid;
      gap: 3px;
      text-align: center;
    }
    .donut-center strong { color: var(--dashboard-ink); font-size: 26px; line-height: 1; }
    .donut-center span { color: var(--muted); font-size: 12px; }
    .legend {
      display: grid;
      gap: 8px;
      width: 100%;
    }
    .legend-row {
      display: grid;
      grid-template-columns: 10px minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      color: var(--muted);
      font-size: 13px;
    }
    .legend-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--dot, var(--primary-bg));
    }
    .bar-stack {
      display: flex;
      width: 100%;
      min-height: 22px;
      border-radius: 999px;
      overflow: hidden;
      background: #e7edf3;
      border: 1px solid rgba(44, 48, 55, 0.08);
    }
    .bar-segment {
      min-width: 0;
      width: var(--width, 0%);
      background: var(--fill, var(--primary-bg));
    }
    .provider-bars {
      display: grid;
      gap: 10px;
    }
    .provider-row {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 12px;
      background: var(--row-bg);
    }
    .provider-row-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
      align-items: start;
    }
    .provider-name {
      color: var(--dashboard-ink);
      font-size: 15px;
      font-weight: 650;
    }
    .provider-meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 3px;
    }
    .meter {
      height: 8px;
      border-radius: 999px;
      background: #e7edf3;
      overflow: hidden;
    }
    .meter > span {
      display: block;
      height: 100%;
      width: var(--width, 0%);
      border-radius: inherit;
      background: var(--fill, var(--primary-bg));
    }
    .coverage-grid {
      display: grid;
      gap: 10px;
    }
    .coverage-item {
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 12px;
      background: var(--row-bg);
    }
    .coverage-top {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 10px;
    }
    .coverage-label { color: var(--muted); font-size: 13px; }
    .coverage-value { color: var(--dashboard-ink); font-size: 20px; font-weight: 680; }
    .coverage-item .meter { margin-top: 8px; }
    .trend-chart {
      display: grid;
      gap: 10px;
    }
    .trend-bars {
      display: grid;
      grid-template-columns: repeat(var(--trend-days, 7), minmax(12px, 1fr));
      gap: 8px;
      align-items: end;
      min-height: 138px;
      border: 1px solid var(--line-soft);
      border-radius: 8px;
      padding: 12px 10px 10px;
      background: var(--row-bg);
    }
    .trend-column {
      display: grid;
      grid-template-rows: 1fr auto auto;
      gap: 5px;
      align-items: end;
      min-width: 0;
      height: 112px;
    }
    .trend-bar {
      width: 100%;
      min-height: 3px;
      height: var(--height, 3px);
      border-radius: 999px 999px 3px 3px;
      background: var(--primary-bg);
    }
    .trend-column.has-errors .trend-bar { background: var(--warn); }
    .trend-column.has-denied .trend-bar { background: var(--red); }
    .trend-value {
      color: var(--dashboard-ink);
      font-size: 11px;
      font-weight: 650;
      text-align: center;
    }
    .trend-label {
      color: var(--muted);
      font-size: 10px;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .trend-column.compact .trend-value {
      display: none;
    }
    .row {
      display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center;
      border: 1px solid var(--line-soft);
      border-radius: 8px; padding: 13px;
      background: var(--row-bg);
    }
    .row-title { font-weight: 600; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(37, 99, 235, 0.24); border-radius: 999px; padding: 5px 8px; }
    .tag.good { color: var(--green); border-color: rgba(21, 128, 61, 0.24); }
    .tag.warn { color: var(--warn); border-color: rgba(180, 83, 9, 0.30); }
    .tag.bad { color: var(--red); border-color: rgba(220, 38, 38, 0.28); }
    .empty, .error {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 18px;
      background: var(--row-bg);
    }
    .error { color: var(--red); border-color: rgba(220, 38, 38, 0.3); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .action { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; color: var(--action-text); background: var(--control-bg); }
    .action.primary { color: var(--primary-text, var(--text)); }
    .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
    .feature-card {
      display: flex; flex-direction: column; gap: 10px;
      min-height: 170px; border: 1px solid var(--line-soft);
      border-radius: 8px; padding: 16px;
      background: var(--card-bg);
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .feature-card:hover { transform: translateY(-2px); border-color: rgba(49, 95, 149, 0.32); background: var(--row-bg); }
    .feature-card h3 { margin: 0; font-size: 16px; line-height: 1.15; letter-spacing: 0; }
    .feature-card p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; flex: 1; }
    .feature-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .feature-tag { color: var(--green); border: 1px solid rgba(21, 128, 61, 0.22); border-radius: 999px; padding: 4px 7px; font-size: 11px; }
    .feature-tag.pending { color: var(--warn); border-color: rgba(180, 83, 9, 0.30); }
    @media (max-width: 980px) {
      .topbar { grid-template-columns: 1fr; }
      .toolbar { justify-content: flex-start; }
      .chart-context-grid, .two, .dashboard-overview-grid, .feature-grid, .intent-grid, .action-grid, .top-insight-grid, .call-summary-grid { grid-template-columns: 1fr; }
      .call-overview-head { align-items: stretch; }
      .timeframe-toggle { width: 100%; }
      .timeframe-button { flex: 1; }
      .control-center-intro { flex-direction: column; }
      .overview-rail { grid-template-columns: 1fr; }
    }
    @media (min-width: 981px) and (max-width: 1220px) {
      .feature-grid, .intent-grid, .action-grid, .top-insight-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .overview-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('dashboard')}

    <main class="main enterprise-dashboard-main">
      <section class="enterprise-page-shell">
        <section class="dashboard-head-card" aria-label="Enterprise control center overview">
          <div class="topbar">
            <div class="hero-copy">
              <div class="eyebrow">Enterprise dashboard</div>
              <h1>API Key Security Overview</h1>
              <div class="dashboard-refresh-control" aria-label="Dashboard data controls">
                <button id="refreshBtn" type="button">Refresh data</button>
              </div>
            </div>
          </div>

        </section>

      <div id="authNotice" class="error" style="display:none"></div>

        <section class="control-center-card" aria-label="Enterprise control center">
          <div class="control-center-intro">
            <div>
              <h2 class="control-title">Control center</h2>
              <p class="control-copy">Daily workspace view for API traffic, protected-key readiness, project coverage, runtime health, and customer-safe evidence signals.</p>
            </div>
          </div>

          <nav class="tabbar" aria-label="Enterprise dashboard tabs">
            <button class="tab-button active" type="button" data-dashboard-tab="overview">Overview</button>
            <button class="tab-button" type="button" data-dashboard-tab="keymap">Key Map</button>
            <button class="tab-button" type="button" data-dashboard-tab="security">Security</button>
            <button class="tab-button" type="button" data-dashboard-tab="access">Access</button>
            <button class="tab-button" type="button" data-dashboard-tab="operations">Operations</button>
          </nav>

      <section id="tab-overview" class="tab-panel" data-tab-panel="overview">
        <section class="dashboard-overview-grid" aria-label="Dashboard overview workspace">
          <div class="overview-primary">
            <section class="card call-overview-card" aria-label="API calls overview">
              <div class="section-title call-overview-head">
                <div>
                  <h2>API Calls</h2>
                  <p>How many requests are running through VaultProof, with blocked and error days highlighted.</p>
                </div>
                <div class="timeframe-toggle" role="group" aria-label="API call time range">
                  <button class="timeframe-button active" type="button" data-call-range="7">7d</button>
                  <button class="timeframe-button" type="button" data-call-range="14">14d</button>
                  <button class="timeframe-button" type="button" data-call-range="30">30d</button>
                </div>
              </div>
              <div class="call-summary-grid" aria-label="Selected API call window">
                <div class="call-summary-item"><span class="call-summary-label">Total calls</span><strong id="callWindowTotal" class="call-summary-value">...</strong></div>
                <div class="call-summary-item"><span class="call-summary-label">Allowed</span><strong id="callWindowAllowed" class="call-summary-value">...</strong></div>
                <div class="call-summary-item"><span class="call-summary-label">Blocked</span><strong id="callWindowBlocked" class="call-summary-value">...</strong></div>
                <div class="call-summary-item"><span class="call-summary-label">Errors</span><strong id="callWindowErrors" class="call-summary-value">...</strong></div>
              </div>
              <div class="chart-context-grid" aria-label="API key and project summary">
                <div class="context-card">
                  <div class="context-label">Protected API keys</div>
                  <div id="contextKeySlots" class="context-title">...</div>
                  <div class="context-copy">Active provider slots protected by VaultProof.</div>
                </div>
                <div class="context-card">
                  <div class="context-label">Keys ready</div>
                  <div id="contextLiveSealed" class="context-title">...</div>
                  <div class="context-copy">Protected keys ready to send traffic.</div>
                </div>
                <div class="context-card">
                  <div class="context-label">Projects covered</div>
                  <div id="contextProjectsWithSlots" class="context-title">...</div>
                  <div class="context-copy">Projects mapped to protected provider credentials.</div>
                </div>
                <div class="context-card critical">
                  <div class="context-label">Blocked / error calls</div>
                  <div id="contextDeniedErrors" class="context-title">...</div>
                  <div class="context-copy">Requests that need review before scaling.</div>
                </div>
              </div>
              <div id="trendMeta" class="mini call-chart-meta">7 days</div>
              <div id="callTrendChart" class="trend-chart"><div class="empty">Loading API calls...</div></div>
            </section>

            <section class="top-insight-grid" aria-label="API key organization picture">
              <div class="card visual-card">
                <div class="section-title">
                  <div>
                    <h2>Key readiness</h2>
                    <p>Which protected API keys are ready for real traffic, still demo-only, or missing setup.</p>
                  </div>
                </div>
                <div class="donut-wrap">
                  <div id="materialDonut" class="donut"><div class="donut-center"><strong>0%</strong><span>ready</span></div></div>
                  <div id="materialLegend" class="legend"></div>
                </div>
              </div>

              <div class="card visual-card">
                <div class="section-title">
                  <div>
                    <h2>API call results</h2>
                    <p>Allowed requests compared with blocked requests and upstream errors.</p>
                  </div>
                  <span id="trafficMeta" class="mini">0 calls</span>
                </div>
                <div class="visual-body">
                  <div id="trafficOutcomeBar" class="bar-stack" aria-label="API call results chart"></div>
                  <div id="trafficLegend" class="legend"></div>
                </div>
              </div>

              <div class="card visual-card">
                <div class="section-title">
                  <div>
                    <h2>Project coverage</h2>
                    <p>How much of the organization has key slots and observed runtime activity.</p>
                  </div>
                </div>
                <div id="projectCoverageList" class="coverage-grid"><div class="empty">Loading coverage...</div></div>
              </div>
            </section>

            <section class="card">
              <div class="section-title">
                <div>
                  <h2>Provider usage</h2>
                  <p>Provider groups ranked by recent API calls, blocked requests, and key readiness.</p>
                </div>
                <span id="providerUsageMeta" class="mini">loading</span>
              </div>
              <div id="providerUsageList" class="provider-bars"><div class="empty">Loading provider usage...</div></div>
            </section>

            <section class="card attention-card" aria-label="Dashboard attention items">
              <div class="section-title">
                <div>
                  <h2>Needs attention</h2>
                  <p>Highest-priority key, traffic, coverage, and policy work for this organization.</p>
                </div>
                <span id="attentionMeta" class="mini">loading</span>
              </div>
              <div id="attentionList" class="attention-list"><div class="empty">Loading attention items...</div></div>
            </section>

            <section class="grid two">
              <div class="card">
                <div class="section-title">
                  <div>
                    <h2>Confidential runtime posture</h2>
                    <p>Current status for the production key path.</p>
                  </div>
                  <span id="runtimePill" class="status-pill warn">checking</span>
                </div>
                <div id="runtimeDetail" class="mini">Waiting for readiness...</div>
              </div>

              <div class="card">
                <div class="section-title">
                  <div>
                    <h2>Organization</h2>
                    <p>VaultProof provisions the organization workspace; enterprise admins review role, SSO state, and controls here.</p>
                  </div>
                  <span id="orgRole" class="tag">...</span>
                </div>
                <div id="orgDetail" class="mini">Loading organization...</div>
              </div>
            </section>
          </div>

          <aside class="overview-rail" aria-label="Workspace readiness summary">
            <div class="rail-card accent">
              <div class="rail-title">Evidence readiness</div>
              <div class="rail-value">Proof</div>
              <p class="rail-copy">Security review can use runtime, access, audit, policy, release, tester, and exposure evidence.</p>
              <span class="tag good">customer safe</span>
            </div>
            <div class="rail-card">
              <div class="rail-title">Key exposure response</div>
              <p class="rail-copy">Provider Slots ties scanner findings, slot containment, emergency revoke, rotation review, and customer-safe incident JSON together.</p>
              <span class="tag good">contained in slots</span>
            </div>
            <div class="rail-card">
              <div class="rail-title">Access and SSO</div>
              <p class="rail-copy">Review owners, admins, pending invites, SSO state, and access-review CSV before adding more teams.</p>
              <span class="tag good">reviewable</span>
            </div>
            <div class="rail-card">
              <div class="rail-title">Runtime operations</div>
              <p class="rail-copy">Use activity, alerts, audit, and runbooks to investigate blocked calls or key setup drift.</p>
              <span class="tag">operational</span>
            </div>
          </aside>
        </section>
      </section>

      <section id="tab-keymap" class="tab-panel" data-tab-panel="keymap" hidden>
        <section class="grid two">
          <div class="card">
            <div class="section-title">
              <div>
                <h2>Key map by provider</h2>
                <p>Provider families, active slots, recent calls, blocked requests, and key readiness.</p>
              </div>
              <span id="keyMapMeta" class="mini">loading</span>
            </div>
            <div id="keyMapProviderList" class="provider-bars"><div class="empty">Loading key map...</div></div>
          </div>

          <div class="card">
            <div class="section-title">
              <div>
                <h2>Key setup readiness</h2>
                <p>Ready keys can handle real traffic; demo-only and incomplete keys need setup before production use.</p>
              </div>
            </div>
            <div id="keyMaterialRows" class="coverage-grid"><div class="empty">Loading key setup summary...</div></div>
          </div>
        </section>

        <section class="card">
          <div class="section-title">
            <div>
              <h2>Organization coverage</h2>
              <p>Project-level coverage for provider slots, observed runtime traffic, and attention signals.</p>
            </div>
          </div>
          <div id="keyCoverageRows" class="coverage-grid"><div class="empty">Loading organization coverage...</div></div>
        </section>
      </section>

      <section id="tab-security" class="tab-panel" data-tab-panel="security" hidden>
        <section class="grid intent-grid">
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag">ready</span></div><h3>Confidential VM</h3><p>GCP runtime host for the control plane and executor.</p></div>
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag">ready</span></div><h3>Cloud KMS key path</h3><p>Controlled unwrap path for provider key material.</p></div>
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag">ready</span></div><h3>Replay protection</h3><p>Blocks reused signed execution envelopes.</p></div>
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag pending">finish line</span></div><h3>Launch hardening</h3><p>Track remaining DNS, edge, monitoring, SSH, and cleanup actions.</p></div>
        </section>

        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Evidence posture</h2><span class="mini">customer safe</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Production readiness</div><div class="row-sub">Proof that the live runtime and executor report production-ready.</div></div><span class="tag good">ready</span></div>
              <div class="row"><div><div class="row-title">Release evidence</div><div class="row-sub">Customer-safe proof of build tag, approval, verification, rollout state, and rollback path.</div></div><span class="tag good">recorded</span></div>
              <div class="row"><div><div class="row-title">Tester readiness</div><div class="row-sub">Browser-local roster, login readiness, scenario assignment, feedback, and blockers for customer sessions.</div></div><span class="tag good">tracked</span></div>
              <div class="row"><div><div class="row-title">Audit export</div><div class="row-sub">CSV evidence for governance and runtime events.</div></div><span class="tag good">available</span></div>
              <div class="row"><div><div class="row-title">Access review</div><div class="row-sub">CSV evidence for members, roles, and project access.</div></div><span class="tag good">available</span></div>
            </div>
          </div>
          <div class="card">
            <div class="section-title"><h2>Security controls</h2><span class="mini">coverage</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Caller lock and provider policy</div><div class="row-sub">Limit execution by origin, gateway, device, provider, method, host, path, and rate.</div></div><span class="tag">policy</span></div>
              <div class="row"><div><div class="row-title">Provider slots</div><div class="row-sub">Active provider keys stay protected behind key setup mode and emergency revoke controls.</div></div><span class="tag">keys</span></div>
              <div class="row"><div><div class="row-title">Operational runbooks</div><div class="row-sub">Verification, evidence, deploys, secret rotation, DNS, edge, SSH, and cleanup.</div></div><span class="tag">ops</span></div>
            </div>
          </div>
        </section>
      </section>

      <section id="tab-access" class="tab-panel" data-tab-panel="access" hidden>
        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Access and alerts</h2><span id="accessMeta" class="mini"></span></div>
            <div id="accessList" class="list"><div class="empty">Loading access...</div></div>
          </div>
          <div class="card">
            <div class="section-title"><h2>Setup access checklist</h2><span class="mini">before rollout</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">SSO path</div><div class="row-sub">Use Entra ID through Supabase SAML broker/session provider for customer-facing SSO.</div></div><span class="tag">Org + SSO</span></div>
              <div class="row"><div><div class="row-title">Access review</div><div class="row-sub">Confirm owners and admins are the right people before expanding team access.</div></div><span class="tag">Members</span></div>
              <div class="row"><div><div class="row-title">Alert delivery</div><div class="row-sub">Set destinations and test delivery before relying on incident notifications.</div></div><span class="tag">Alerts</span></div>
            </div>
          </div>
        </section>
      </section>

      <section id="tab-operations" class="tab-panel" data-tab-panel="operations" hidden>
        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Project health</h2><span id="projectHealthMeta" class="mini"></span></div>
            <div id="projectHealthList" class="list"><div class="empty">Loading projects...</div></div>
          </div>

          <div class="card">
            <div class="section-title"><h2>Recent runtime activity</h2><span id="activityMeta" class="mini"></span></div>
            <div id="activityList" class="list"><div class="empty">Loading activity...</div></div>
          </div>
        </section>

        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Recent audit</h2><span class="mini">latest events</span></div>
            <div id="auditList" class="list"><div class="empty">Loading audit...</div></div>
          </div>

          <div class="card">
            <div class="section-title"><h2>Attention signals</h2><span class="mini">from overview</span></div>
            <div id="operationSummaryList" class="list"><div class="empty">Loading attention signals...</div></div>
          </div>
        </section>
      </section>

        </section>
      </section>
    </main>
  </div>

  <script>
    (function() {
      var ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
      var token = localStorage.getItem('vaultproof_token') || '';
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var loadSequence = 0;
      var latestCallTrend = [];
      var callTrendRangeDays = 7;
      var DASHBOARD_SAMPLE_DATA_ENABLED = ${ENABLE_ENTERPRISE_DASHBOARD_SAMPLE_DATA ? 'true' : 'false'};
      var dashboardSampleDataActive = false;
      function byId(id) { return document.getElementById(id); }
      function text(id, value) { var el = byId(id); if (el) el.textContent = value == null ? '' : String(value); }
      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      }
      function friendlyErrorMessage(message) {
        var value = String(message || '');
        return /not authenticated/i.test(value) ? ${JSON.stringify(ENTERPRISE_AUTH_ERROR_MESSAGE)} : value;
      }
      function number(value) {
        var n = Number(value || 0);
        return Number.isFinite(n) ? n.toLocaleString() : '0';
      }
      function rawNumber(value) {
        var n = Number(value || 0);
        return Number.isFinite(n) && n > 0 ? n : 0;
      }
      function percent(part, total) {
        total = rawNumber(total);
        return total > 0 ? Math.round((rawNumber(part) / total) * 100) : 0;
      }
      function plural(value, singular, pluralLabel) {
        return rawNumber(value) === 1 ? singular : (pluralLabel || singular + 's');
      }
      function daysAgoIso(days) {
        var date = new Date();
        date.setUTCDate(date.getUTCDate() - rawNumber(days));
        return date.toISOString();
      }
      function dayKey(daysAgo) {
        var date = new Date();
        date.setUTCHours(0, 0, 0, 0);
        date.setUTCDate(date.getUTCDate() - rawNumber(daysAgo));
        return date.toISOString().slice(0, 10);
      }
      function buildDashboardSampleOverview() {
        var dayValues = [82, 96, 74, 118, 131, 145, 109, 156, 168, 141, 174, 188, 160, 192, 205, 214, 176, 221, 238, 210, 247, 265, 230, 276, 294, 249, 318, 337, 302, 356];
        var callTrend = dayValues.map(function(calls, index) {
          var denied = index % 9 === 0 ? 3 : index % 5 === 0 ? 1 : 0;
          var otherErrors = index % 7 === 0 ? 2 : index % 11 === 0 ? 1 : 0;
          return {
            day: dayKey(dayValues.length - index - 1),
            calls: calls,
            denied: denied,
            errors: denied + otherErrors,
          };
        });
        var totalCalls = callTrend.reduce(function(sum, item) { return sum + rawNumber(item.calls); }, 0);
        var deniedCalls = callTrend.reduce(function(sum, item) { return sum + rawNumber(item.denied); }, 0);
        var errorCalls = callTrend.reduce(function(sum, item) { return sum + rawNumber(item.errors); }, 0);
        var otherErrorCalls = Math.max(errorCalls - deniedCalls, 0);
        return {
          totalProjects: 5,
          totalKeys: 12,
          providers: ['openai', 'anthropic', 'stripe', 'sendgrid', 'google'],
          providerCount: 5,
          activeApps: 5,
          totalCalls: totalCalls,
          errorCalls: errorCalls,
          deniedCalls: deniedCalls,
          errorRate: totalCalls ? Math.round((errorCalls / totalCalls) * 1000) / 10 : 0,
          healthWindowDays: 30,
          statsSource: 'sample_dashboard',
          accessLogStatsSource: 'sample_dashboard',
          providerSlotSummary: {
            totalSlots: 12,
            liveSealedSlots: 9,
            placeholderSlots: 2,
            mixedSlots: 1,
            missingSlots: 0,
          },
          providerUsage: [
            { provider: 'openai', labels: ['Customer API', 'AI agent runtime'], slots: 4, liveSealedSlots: 3, placeholderSlots: 1, mixedSlots: 0, missingSlots: 0, recentCalls: 2240, denied: 5, errors: 8, lastActivity: daysAgoIso(0) },
            { provider: 'anthropic', labels: ['AI agent runtime'], slots: 2, liveSealedSlots: 1, placeholderSlots: 1, mixedSlots: 0, missingSlots: 0, recentCalls: 1465, denied: 4, errors: 6, lastActivity: daysAgoIso(0) },
            { provider: 'stripe', labels: ['Billing'], slots: 2, liveSealedSlots: 2, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 812, denied: 1, errors: 2, lastActivity: daysAgoIso(1) },
            { provider: 'sendgrid', labels: ['Notifications'], slots: 2, liveSealedSlots: 2, placeholderSlots: 0, mixedSlots: 0, missingSlots: 0, recentCalls: 694, denied: 0, errors: 1, lastActivity: daysAgoIso(1) },
            { provider: 'google', labels: ['Analytics'], slots: 2, liveSealedSlots: 1, placeholderSlots: 0, mixedSlots: 1, missingSlots: 0, recentCalls: 433, denied: 2, errors: 3, lastActivity: daysAgoIso(2) },
          ],
          trafficBreakdown: {
            totalCalls: totalCalls,
            okCalls: Math.max(totalCalls - errorCalls, 0),
            deniedCalls: deniedCalls,
            errorCalls: errorCalls,
            otherErrorCalls: otherErrorCalls,
          },
          projectCoverage: {
            totalProjects: 5,
            withProviderSlots: 5,
            withoutProviderSlots: 0,
            withTraffic: 4,
            needingAttention: 2,
          },
          callTrend: callTrend,
          projectHealth: [
            { name: 'Customer API', calls: 1920, denied: 3, errors: 4, lastActivity: daysAgoIso(0) },
            { name: 'AI agent runtime', calls: 1710, denied: 6, errors: 9, lastActivity: daysAgoIso(0) },
            { name: 'Billing', calls: 812, denied: 1, errors: 2, lastActivity: daysAgoIso(1) },
            { name: 'Notifications', calls: 694, denied: 0, errors: 1, lastActivity: daysAgoIso(1) },
            { name: 'Analytics', calls: 433, denied: 2, errors: 3, lastActivity: daysAgoIso(2) },
          ],
          alerts: [
            { severity: 'warning', title: 'Anthropic slot is still demo-only', detail: 'Replace the placeholder key before routing production agent traffic.' },
            { severity: 'warning', title: 'Google analytics slot has partial setup', detail: 'One project has provider mapping but still needs a sealed production key.' },
            { severity: 'info', title: 'OpenAI traffic is active', detail: 'Customer API and agent runtime requests are moving through the protected proxy.' },
          ],
          pilotReview: {
            headline: 'Sample enterprise workspace',
          },
          recentActivity: [
            { description: 'OpenAI proxy call allowed', action: 'proxy.allowed', timestamp: daysAgoIso(0), metadata: { status_code: 200 }, keySlot: { provider: 'openai' } },
            { description: 'Anthropic request blocked by policy', action: 'proxy.denied', timestamp: daysAgoIso(0), metadata: { status_code: 403 }, keySlot: { provider: 'anthropic' } },
            { description: 'Stripe billing key used', action: 'proxy.allowed', timestamp: daysAgoIso(1), metadata: { status_code: 200 }, keySlot: { provider: 'stripe' } },
            { description: 'SendGrid message sent', action: 'proxy.allowed', timestamp: daysAgoIso(1), metadata: { status_code: 200 }, keySlot: { provider: 'sendgrid' } },
            { description: 'Google analytics key needs review', action: 'proxy.error', timestamp: daysAgoIso(2), metadata: { status_code: 502 }, keySlot: { provider: 'google' } },
          ],
        };
      }
      function overviewCallTrendTotal(overview) {
        var trend = Array.isArray(overview && overview.callTrend) ? overview.callTrend : [];
        return trend.reduce(function(sum, item) {
          return sum + rawNumber(item.calls) + rawNumber(item.denied) + rawNumber(item.errors);
        }, 0);
      }
      function overviewHasRealDashboardData(overview) {
        if (!overview) return false;
        var slotSummary = overview.providerSlotSummary || {};
        var traffic = overview.trafficBreakdown || {};
        var providerUsage = Array.isArray(overview.providerUsage) ? overview.providerUsage : [];
        return rawNumber(traffic.totalCalls || overview.totalCalls) > 0
          || rawNumber(slotSummary.totalSlots || overview.totalKeys) > 0
          || rawNumber(overview.providerCount) > 0
          || providerUsage.length > 0
          || overviewCallTrendTotal(overview) > 0;
      }
      function resolveDashboardOverview(overview) {
        dashboardSampleDataActive = false;
        if (DASHBOARD_SAMPLE_DATA_ENABLED && !overviewHasRealDashboardData(overview)) {
          dashboardSampleDataActive = true;
          return buildDashboardSampleOverview();
        }
        return overview || {};
      }
      function setDonut(summary) {
        summary = summary || {};
        var total = rawNumber(summary.totalSlots);
        var live = rawNumber(summary.liveSealedSlots);
        var placeholder = rawNumber(summary.placeholderSlots);
        var mixed = rawNumber(summary.mixedSlots);
        var missing = rawNumber(summary.missingSlots);
        var values = [
          { label: 'Ready for traffic', value: live, color: '#15803d' },
          { label: 'Demo only', value: placeholder, color: '#d97706' },
          { label: 'Partial setup', value: mixed, color: '#2563eb' },
          { label: 'Missing', value: missing, color: '#dc2626' },
        ];
        var cursor = 0;
        var stops = values.map(function(item) {
          var size = total > 0 ? (item.value / total) * 360 : 0;
          var stop = item.color + ' ' + cursor.toFixed(2) + 'deg ' + (cursor + size).toFixed(2) + 'deg';
          cursor += size;
          return stop;
        });
        var donut = byId('materialDonut');
        if (donut) {
          donut.style.background = total > 0 ? 'conic-gradient(' + stops.join(', ') + ')' : 'conic-gradient(#e7edf3 0deg 360deg)';
          donut.innerHTML = '<div class="donut-center"><strong>' + percent(live, total) + '%</strong><span>ready</span></div>';
        }
        var legend = byId('materialLegend');
        if (legend) {
          legend.innerHTML = values.map(function(item) {
            return '<div class="legend-row"><span class="legend-dot" style="--dot:' + item.color + '"></span><span>' + item.label + '</span><strong>' + number(item.value) + '</strong></div>';
          }).join('');
        }
      }
      function renderTrafficBreakdown(traffic) {
        traffic = traffic || {};
        var total = rawNumber(traffic.totalCalls);
        var ok = rawNumber(traffic.okCalls);
        var denied = rawNumber(traffic.deniedCalls);
        var otherErrors = rawNumber(traffic.otherErrorCalls);
        var segments = [
          { label: 'Allowed', value: ok, color: '#15803d' },
          { label: 'Blocked', value: denied, color: '#d97706' },
          { label: 'Errors', value: otherErrors, color: '#dc2626' },
        ];
        var bar = byId('trafficOutcomeBar');
        if (bar) {
          bar.innerHTML = total > 0
            ? segments.map(function(item) {
                return '<span class="bar-segment" style="--width:' + percent(item.value, total) + '%;--fill:' + item.color + '"></span>';
              }).join('')
            : '<span class="bar-segment" style="--width:100%;--fill:#e7edf3"></span>';
        }
        text('trafficMeta', number(total) + ' ' + plural(total, 'call'));
        var legend = byId('trafficLegend');
        if (legend) {
          legend.innerHTML = segments.map(function(item) {
            return '<div class="legend-row"><span class="legend-dot" style="--dot:' + item.color + '"></span><span>' + item.label + '</span><strong>' + number(item.value) + '</strong></div>';
          }).join('');
        }
      }
      function coverageItem(label, value, detail, width, tone) {
        var color = tone === 'bad' ? '#dc2626' : tone === 'warn' ? '#d97706' : tone === 'blue' ? '#315f95' : '#15803d';
        return '<div class="coverage-item"><div class="coverage-top"><span class="coverage-label">' + escapeHtml(label) + '</span><strong class="coverage-value">' + escapeHtml(value) + '</strong></div><div class="provider-meta">' + escapeHtml(detail) + '</div><div class="meter"><span style="--width:' + Math.max(0, Math.min(100, width)) + '%;--fill:' + color + '"></span></div></div>';
      }
      function renderCoverageRows(id, coverage, summary) {
        coverage = coverage || {};
        summary = summary || {};
        var totalProjects = rawNumber(coverage.totalProjects);
        var withSlots = rawNumber(coverage.withProviderSlots);
        var withTraffic = rawNumber(coverage.withTraffic);
        var needingAttention = rawNumber(coverage.needingAttention);
        var totalSlots = rawNumber(summary.totalSlots);
        var live = rawNumber(summary.liveSealedSlots);
        var rows = [
          coverageItem('Projects with key slots', number(withSlots) + '/' + number(totalProjects), number(rawNumber(coverage.withoutProviderSlots)) + ' projects without active slots', percent(withSlots, totalProjects), withSlots === totalProjects && totalProjects ? 'good' : 'warn'),
          coverageItem('Projects with traffic', number(withTraffic) + '/' + number(totalProjects), 'Proxy activity observed in the health window', percent(withTraffic, totalProjects), withTraffic ? 'blue' : 'warn'),
          coverageItem('Keys ready', number(live) + '/' + number(totalSlots), 'Protected keys ready for upstream dispatch', percent(live, totalSlots), live === totalSlots && totalSlots ? 'good' : 'warn'),
          coverageItem('Needs attention', number(needingAttention), 'Projects with denied or error traffic', totalProjects ? percent(needingAttention, totalProjects) : 0, needingAttention ? 'bad' : 'good'),
        ];
        var list = byId(id);
        if (list) list.innerHTML = rows.join('');
      }
      function renderMaterialRows(summary) {
        summary = summary || {};
        var total = rawNumber(summary.totalSlots);
        var rows = [
          coverageItem('Ready for traffic', number(summary.liveSealedSlots), 'Real provider keys are sealed and usable', percent(summary.liveSealedSlots, total), 'good'),
          coverageItem('Demo only', number(summary.placeholderSlots), 'Placeholder keys need real sealed setup', percent(summary.placeholderSlots, total), rawNumber(summary.placeholderSlots) ? 'warn' : 'good'),
          coverageItem('Incomplete', number(rawNumber(summary.mixedSlots) + rawNumber(summary.missingSlots)), 'Setup is partial or missing', percent(rawNumber(summary.mixedSlots) + rawNumber(summary.missingSlots), total), rawNumber(summary.mixedSlots) + rawNumber(summary.missingSlots) ? 'bad' : 'good'),
        ];
        var list = byId('keyMaterialRows');
        if (list) list.innerHTML = rows.join('');
      }
      function renderProviderUsageList(id, usage, totalSlots) {
        var list = byId(id);
        if (!list) return;
        usage = Array.isArray(usage) ? usage : [];
        var maxValue = usage.reduce(function(max, item) {
          return Math.max(max, rawNumber(item.recentCalls), rawNumber(item.slots));
        }, 1);
        list.innerHTML = usage.length ? usage.map(function(item) {
          var slots = rawNumber(item.slots);
          var live = rawNumber(item.liveSealedSlots);
          var review = rawNumber(item.placeholderSlots) + rawNumber(item.mixedSlots) + rawNumber(item.missingSlots);
          var calls = rawNumber(item.recentCalls);
          var denied = rawNumber(item.denied);
          var errors = rawNumber(item.errors);
          var tone = denied || errors ? 'warn' : live && !review ? 'good' : 'warn';
          var labelText = Array.isArray(item.labels) && item.labels.length ? item.labels.join(', ') : item.provider;
          var width = Math.max(percent(calls || slots, maxValue), slots ? 8 : 3);
          return '<div class="provider-row"><div class="provider-row-head"><div><div class="provider-name">' + escapeHtml(item.provider || 'unknown') + '</div><div class="provider-meta">' + escapeHtml(labelText) + ' - ' + number(slots) + ' ' + plural(slots, 'slot') + ' - ' + number(calls) + ' recent ' + plural(calls, 'call') + '</div></div><span class="tag ' + tone + '">' + (denied || errors ? 'watch' : live ? 'ready' : 'setup') + '</span></div><div class="meter"><span style="--width:' + width + '%;--fill:' + (tone === 'good' ? '#15803d' : '#d97706') + '"></span></div><div class="provider-meta">' + number(live) + ' ready - ' + number(review) + ' needs review - last ' + escapeHtml(relativeTime(item.lastActivity)) + '</div></div>';
        }).join('') : '<div class="empty">No provider slots or runtime activity are visible yet.</div>';
        if (id === 'providerUsageList') text('providerUsageMeta', number(usage.length) + ' provider ' + plural(usage.length, 'group'));
        if (id === 'keyMapProviderList') text('keyMapMeta', number(totalSlots) + ' active ' + plural(totalSlots, 'slot'));
      }
      function attentionRow(item) {
        var tone = item.tone || '';
        return '<div class="attention-row ' + tone + '"><div><div class="row-title">' + escapeHtml(item.title) + '</div><div class="row-sub">' + escapeHtml(item.detail || '') + '</div></div><span class="tag ' + tone + '">' + escapeHtml(item.area || 'Review') + '</span></div>';
      }
      function renderAttentionItems(overview, totalSlots, liveSealed, coverage, traffic) {
        var items = [];
        var denied = rawNumber(traffic.deniedCalls || overview.deniedCalls);
        var otherErrors = rawNumber(traffic.otherErrorCalls);
        var totalErrors = rawNumber(traffic.errorCalls || overview.errorCalls);
        var reviewCount = Math.max(totalSlots - liveSealed, 0);
        var withoutSlots = rawNumber(coverage.withoutProviderSlots);
        if (totalSlots === 0) {
          items.push({ title: 'Connect the first protected provider key', detail: 'This workspace has no provider slots in scope yet.', area: 'Provider slots', tone: 'warn' });
        }
        if (reviewCount > 0) {
          items.push({ title: 'Review key setup before production use', detail: number(reviewCount) + ' provider ' + plural(reviewCount, 'slot') + ' need real sealed keys or setup review.', area: 'Provider slots', tone: 'warn' });
        }
        if (denied > 0 || otherErrors > 0 || totalErrors > denied) {
          items.push({ title: 'Review denied or error traffic', detail: number(denied) + ' denied and ' + number(Math.max(totalErrors - denied, otherErrors)) + ' other error calls are in the current window.', area: 'Activity', tone: denied ? 'bad' : 'warn' });
        }
        if (withoutSlots > 0) {
          items.push({ title: 'Projects missing key coverage', detail: number(withoutSlots) + ' ' + plural(withoutSlots, 'project') + (withoutSlots === 1 ? ' is' : ' are') + ' not mapped to an active provider slot.', area: 'API Inventory', tone: 'warn' });
        }
        if (totalSlots > 0 && rawNumber(traffic.totalCalls || overview.totalCalls) === 0) {
          items.push({ title: 'No protected runtime traffic yet', detail: 'Provider slots exist, but no workflow has sent traffic through VaultProof in this window.', area: 'Rollout', tone: 'warn' });
        }
        var list = byId('attentionList');
        if (list) {
          list.innerHTML = items.length
            ? items.slice(0, 5).map(attentionRow).join('')
            : '<div class="attention-row"><div><div class="row-title">No active attention items</div><div class="row-sub">Key readiness, project coverage, and API call results do not show dashboard-level blockers.</div></div><span class="tag good">Clear</span></div>';
        }
        text('attentionMeta', items.length ? number(items.length) + ' open' : 'clear');
      }
      function updateCallRangeButtons(days) {
        document.querySelectorAll('[data-call-range]').forEach(function(button) {
          var active = Number(button.getAttribute('data-call-range') || 7) === days;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
      function renderCallTrend(trend, days) {
        days = rawNumber(days) || 7;
        var list = Array.isArray(trend) ? trend.slice(-days) : [];
        var chart = byId('callTrendChart');
        updateCallRangeButtons(days);
        if (!chart) return;
        if (!list.length) {
          chart.innerHTML = '<div class="empty">No trend data yet.</div>';
          text('trendMeta', 'no data');
          text('callWindowTotal', '0');
          text('callWindowAllowed', '0');
          text('callWindowBlocked', '0');
          text('callWindowErrors', '0');
          return;
        }
        var maxCalls = list.reduce(function(max, item) {
          return Math.max(max, rawNumber(item.calls));
        }, 1);
        var total = list.reduce(function(sum, item) {
          return sum + rawNumber(item.calls);
        }, 0);
        var deniedTotal = list.reduce(function(sum, item) {
          return sum + rawNumber(item.denied);
        }, 0);
        var errorTotal = list.reduce(function(sum, item) {
          return sum + rawNumber(item.errors);
        }, 0);
        var otherErrorTotal = Math.max(errorTotal - deniedTotal, 0);
        var allowedTotal = Math.max(total - errorTotal, 0);
        var compact = list.length > 14;
        chart.innerHTML = '<div class="trend-bars" style="--trend-days:' + Math.max(list.length, 1) + '">' + list.map(function(item) {
          var calls = rawNumber(item.calls);
          var denied = rawNumber(item.denied);
          var errors = rawNumber(item.errors);
          var height = Math.max(3, Math.round((calls / maxCalls) * 86));
          var label = compact ? String(item.day || '').slice(8) : String(item.day || '').slice(5);
          var className = denied ? 'trend-column has-denied' : errors ? 'trend-column has-errors' : 'trend-column';
          if (compact) className += ' compact';
          return '<div class="' + className + '"><div class="trend-bar" title="' + number(calls) + ' calls" style="--height:' + height + 'px"></div><div class="trend-value">' + number(calls) + '</div><div class="trend-label">' + escapeHtml(label) + '</div></div>';
        }).join('') + '</div>';
        text('trendMeta', number(total) + ' calls / ' + days + 'd' + (dashboardSampleDataActive ? ' - sample data' : ''));
        text('callWindowTotal', number(total));
        text('callWindowAllowed', number(allowedTotal));
        text('callWindowBlocked', number(deniedTotal));
        text('callWindowErrors', number(otherErrorTotal));
      }
      function relativeTime(value) {
        if (!value) return 'never';
        var ts = new Date(value).getTime();
        if (!Number.isFinite(ts)) return String(value);
        var diff = Date.now() - ts;
        var minutes = Math.round(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return minutes + 'm ago';
        var hours = Math.round(minutes / 60);
        if (hours < 48) return hours + 'h ago';
        return Math.round(hours / 24) + 'd ago';
      }
      function authHeaders() {
        var headers = { 'Content-Type': 'application/json' };
        if (token) headers.Authorization = 'Bearer ' + token;
        if (currentOrgId) headers['x-vaultproof-organization'] = currentOrgId;
        return headers;
      }
      async function fetchJson(path, options) {
        var res = await fetch(path, Object.assign({}, options || {}, { headers: Object.assign(authHeaders(), (options && options.headers) || {}) }));
        var payload = await res.json().catch(function() { return null; });
        if (!res.ok) throw new Error(friendlyErrorMessage((payload && payload.error) || ('Request failed: ' + res.status)));
        return payload && payload.data ? payload.data : payload;
      }
      function setNotice(message) {
        var el = byId('authNotice');
        if (!el) return;
        if (!message) {
          el.style.display = 'none';
          el.textContent = '';
          return;
        }
        message = friendlyErrorMessage(message);
        el.style.display = 'block';
        el.innerHTML = escapeHtml(message) + ' <a href="/app/login">Sign in</a>';
      }
      function recordPanelFailure(failures, label, error) {
        var message = label + ': ' + friendlyErrorMessage(error && error.message ? error.message : 'failed to load');
        failures.push(message);
        setNotice('Some dashboard panels could not load: ' + failures.join(' | '));
      }
      function loadPanel(sequence, label, promise, render, failures) {
        return promise.then(function(payload) {
          if (sequence !== loadSequence) return null;
          render(payload);
          return payload;
        }).catch(function(error) {
          if (sequence !== loadSequence) return null;
          recordPanelFailure(failures, label, error);
          return null;
        });
      }
      function selectDashboardTab(tabName) {
        var target = tabName || 'overview';
        document.querySelectorAll('[data-dashboard-tab]').forEach(function(button) {
          var active = button.getAttribute('data-dashboard-tab') === target;
          button.classList.toggle('active', active);
          button.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        document.querySelectorAll('[data-tab-panel]').forEach(function(panel) {
          panel.hidden = panel.getAttribute('data-tab-panel') !== target;
        });
      }
      function renderReadiness(payload) {
        var ready = payload && payload.production_ready === true;
        var runtimeTier = payload && payload.runtime_tier === 'shared-demo' ? 'shared-demo' : 'dedicated-production';
        var sharedDemo = runtimeTier === 'shared-demo';
        text('kpiRuntime', ready ? 'ready' : 'watch');
        text('kpiRuntimeSub', ready ? (sharedDemo ? 'shared enterprise runtime' : 'GCP confidential production') : 'needs review');
        var pill = byId('runtimePill');
        if (pill) {
          pill.textContent = ready ? (sharedDemo ? 'shared runtime ready' : 'production ready') : 'not production ready';
          pill.className = 'status-pill ' + (ready ? '' : 'bad');
        }
        var blockers = Array.isArray(payload && payload.production_blockers) ? payload.production_blockers : [];
        text('runtimeDetail', ready
          ? (sharedDemo
            ? 'Shared enterprise runtime is confidential-ready. It is suitable for scoped customer evaluation, but it is not a dedicated customer production runtime.'
            : 'GCP edge, control plane, executor, attestation, replay protection, and Cloud KMS all report production-ready.')
          : (blockers.length ? blockers.join(' | ') : 'Readiness is incomplete.'));
      }
      function resolveProvisionedOrg(orgs, activeId) {
        if (!orgs.length) {
          currentOrgId = '';
          return;
        }
        var requested = orgs.find(function(org) { return org.id === currentOrgId; });
        var active = orgs.find(function(org) { return org.id === activeId; });
        var team = orgs.find(function(org) { return org.kind && org.kind !== 'personal'; });
        var selected = requested || active || team || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        }
      }
      function renderOrganization(payload) {
        var org = payload && payload.organization ? payload.organization : null;
        if (!org) {
          text('orgRole', 'none');
          text('orgDetail', 'No active enterprise organization found.');
          return;
        }
        text('orgRole', org.role || 'member');
        text('orgDetail', (org.name || 'Organization') + ' - ' + number(org.member_count) + ' members - ' + number(org.project_count) + ' projects');
        text('kpiMembersSub', (payload.sso_status && payload.sso_status.provider_status === 'configured') ? 'SSO configured' : 'SSO not fully configured');
      }
      function renderOverview(overview) {
        overview = resolveDashboardOverview(overview);
        var slotSummary = overview.providerSlotSummary || {};
        var coverage = overview.projectCoverage || {};
        var traffic = overview.trafficBreakdown || {};
        var providerUsage = Array.isArray(overview.providerUsage) ? overview.providerUsage : [];
        var totalSlots = rawNumber(slotSummary.totalSlots || overview.totalKeys);
        var liveSealed = rawNumber(slotSummary.liveSealedSlots);
        var trafficTotal = rawNumber(traffic.totalCalls || overview.totalCalls);
        var trafficErrors = rawNumber(traffic.errorCalls || overview.errorCalls);
        var trafficDenied = rawNumber(traffic.deniedCalls || overview.deniedCalls);
        var trafficOtherErrors = traffic.otherErrorCalls === undefined ? Math.max(trafficErrors - trafficDenied, 0) : rawNumber(traffic.otherErrorCalls);
        var trafficOk = traffic.okCalls === undefined ? Math.max(trafficTotal - trafficErrors, 0) : rawNumber(traffic.okCalls);
        text('contextKeySlots', number(totalSlots));
        text('contextLiveSealed', number(liveSealed) + ' / ' + number(totalSlots));
        text('contextProjectsWithSlots', number(rawNumber(coverage.withProviderSlots)) + '/' + number(rawNumber(coverage.totalProjects || overview.totalProjects)));
        text('contextDeniedErrors', number(trafficDenied) + ' / ' + number(trafficErrors));
        setDonut(slotSummary);
        renderTrafficBreakdown({
          totalCalls: trafficTotal,
          okCalls: trafficOk,
          deniedCalls: trafficDenied,
          otherErrorCalls: trafficOtherErrors,
        });
        renderCoverageRows('projectCoverageList', coverage, slotSummary);
        renderCoverageRows('keyCoverageRows', coverage, slotSummary);
        renderMaterialRows(slotSummary);
        renderProviderUsageList('providerUsageList', providerUsage, totalSlots);
        renderProviderUsageList('keyMapProviderList', providerUsage, totalSlots);
        renderAttentionItems(overview, totalSlots, liveSealed, coverage, traffic);
        latestCallTrend = Array.isArray(overview.callTrend) ? overview.callTrend : [];
        renderCallTrend(latestCallTrend, callTrendRangeDays);
        var review = overview.pilotReview || {};
        text('projectHealthMeta', review.headline || '');
        text('activityMeta', number((overview.recentActivity || []).length) + ' recent events');
        var alerts = Array.isArray(overview.alerts) ? overview.alerts : [];
        var operationList = byId('operationSummaryList');
        if (operationList) {
          operationList.innerHTML = alerts.length ? alerts.slice(0, 5).map(function(alert) {
            var tone = alert.severity === 'critical' ? 'bad' : alert.severity === 'warning' ? 'warn' : 'good';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(alert.title || 'Attention signal') + '</div><div class="row-sub">' + escapeHtml(alert.detail || '') + '</div></div><span class="tag ' + tone + '">' + escapeHtml(alert.severity || 'info') + '</span></div>';
          }).join('') : '<div class="row"><div><div class="row-title">No active attention signals</div><div class="row-sub">Provider slots, traffic, and project health do not show dashboard-level blockers.</div></div><span class="tag good">clear</span></div>';
        }
        var projects = Array.isArray(overview.projectHealth) ? overview.projectHealth : [];
        var projectList = byId('projectHealthList');
        if (projectList) {
          projectList.innerHTML = projects.length ? projects.slice(0, 6).map(function(project) {
            var status = project.denied || project.errors ? 'watch' : project.calls ? 'healthy' : 'setup';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id || project.project_id) + '</div><div class="row-sub">' + number(project.calls) + ' calls - ' + number(project.errors) + ' errors - last ' + escapeHtml(relativeTime(project.lastActivity)) + '</div></div><span class="tag">' + status + '</span></div>';
          }).join('') : '<div class="empty">No project health data yet.</div>';
        }
        var activityList = byId('activityList');
        var activity = Array.isArray(overview.recentActivity) ? overview.recentActivity : [];
        if (activityList) {
          activityList.innerHTML = activity.length ? activity.slice(0, 6).map(function(item) {
            var meta = item.metadata || {};
            var slot = item.keySlot || {};
            return '<div class="row"><div><div class="row-title">' + escapeHtml(item.description || item.action || 'runtime event') + '</div><div class="row-sub">' + escapeHtml(slot.provider || 'provider') + ' - ' + escapeHtml(relativeTime(item.timestamp)) + '</div></div><span class="tag">' + escapeHtml(meta.status_code || 'ok') + '</span></div>';
          }).join('') : '<div class="empty">No runtime traffic yet.</div>';
        }
      }
      function renderMembers(payload) {
        var members = Array.isArray(payload && payload.members) ? payload.members : [];
        var invites = Array.isArray(payload && payload.invitations) ? payload.invitations.filter(function(invite) { return invite.status === 'pending'; }) : [];
        text('kpiMembers', number(members.length));
        text('accessMeta', number(invites.length) + ' pending invites');
        var accessList = byId('accessList');
        if (!accessList) return;
        var admins = members.filter(function(member) { return member.role === 'owner' || member.role === 'admin'; }).length;
        accessList.innerHTML =
          '<div class="row"><div><div class="row-title">Admins and owners</div><div class="row-sub">People who can manage access and policy.</div></div><span class="tag">' + number(admins) + '</span></div>' +
          '<div class="row"><div><div class="row-title">Pending invites</div><div class="row-sub">Invitations still waiting for acceptance.</div></div><span class="tag">' + number(invites.length) + '</span></div>';
      }
      function renderAudit(payload) {
        var events = Array.isArray(payload && payload.events) ? payload.events : [];
        var list = byId('auditList');
        if (!list) return;
        list.innerHTML = events.length ? events.slice(0, 6).map(function(event) {
          return '<div class="row"><div><div class="row-title">' + escapeHtml(event.event_type || event.source || 'audit event') + '</div><div class="row-sub">' + escapeHtml(event.actor_email || 'system') + ' - ' + escapeHtml(relativeTime(event.created_at || event.timestamp)) + '</div></div><span class="tag">' + escapeHtml(event.source || 'audit') + '</span></div>';
        }).join('') : '<div class="empty">No audit events in this window.</div>';
      }
      async function loadDashboard() {
        if (!token) {
          setNotice('Enterprise session missing.');
          return;
        }
        var sequence = ++loadSequence;
        var panelFailures = [];
        var initialOrgId = currentOrgId;
        var dataPanelTasks = [];
        var dataPanelsStarted = false;
        setNotice('');
        function startDataPanels() {
          dataPanelsStarted = true;
          return [
            loadPanel(sequence, 'organization', fetchJson('/api/v1/enterprise/orgs/current'), renderOrganization, panelFailures),
            loadPanel(sequence, 'project stats', fetchJson('/api/v1/enterprise/projects/stats/overview'), renderOverview, panelFailures),
            loadPanel(sequence, 'members', fetchJson('/api/v1/enterprise/members'), renderMembers, panelFailures),
            loadPanel(sequence, 'audit', fetchJson('/api/v1/enterprise/audit?limit=6&days=30'), renderAudit, panelFailures)
          ];
        }
        try {
          var readinessTask = loadPanel(sequence, 'readiness', fetchJson('/readiness'), renderReadiness, panelFailures);
          if (currentOrgId) dataPanelTasks = startDataPanels();
          var orgsPayload = await fetchJson('/api/v1/enterprise/orgs');
          if (sequence !== loadSequence) return;
          var orgs = Array.isArray(orgsPayload.organizations) ? orgsPayload.organizations : [];
          resolveProvisionedOrg(orgs, orgsPayload.active_organization_id || '');
          if (!dataPanelsStarted || currentOrgId !== initialOrgId) dataPanelTasks = startDataPanels();
          await Promise.allSettled([readinessTask].concat(dataPanelTasks));
        } catch (error) {
          if (sequence !== loadSequence) return;
          setNotice(error && error.message ? error.message : 'Dashboard failed to load.');
        }
      }
      var refreshBtn = byId('refreshBtn');
      if (refreshBtn) refreshBtn.addEventListener('click', loadDashboard);
      document.querySelectorAll('[data-dashboard-tab]').forEach(function(button) {
        button.addEventListener('click', function() {
          selectDashboardTab(button.getAttribute('data-dashboard-tab') || 'overview');
        });
      });
      document.querySelectorAll('[data-call-range]').forEach(function(button) {
        button.addEventListener('click', function() {
          callTrendRangeDays = rawNumber(button.getAttribute('data-call-range')) || 7;
          renderCallTrend(latestCallTrend, callTrendRangeDays);
        });
      });
      selectDashboardTab('overview');
      loadDashboard();
    })();
  </script>
</body>
</html>`, env, 'dashboard');
}
