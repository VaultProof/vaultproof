import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';
import { ENTERPRISE_APP_SHELL_THEME, renderEnterpriseAppSidebar } from './enterprise-app-shell.js';

const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing.';

export function renderEnterpriseDashboardPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Enterprise Dashboard - VaultProof</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 400;
      color: #f8fafc;
      background: #050607;
    }
    a { color: inherit; text-decoration: none; }
    ${ENTERPRISE_APP_SHELL_THEME}
    /* dashboard-refresh */
    :root {
      --background: #050607;
      --foreground: #f8fafc;
      --card: #11161c;
      --card-foreground: #f8fafc;
      --popover: #11161c;
      --popover-foreground: #f8fafc;
      --primary: #8ab4f8;
      --primary-foreground: #08111f;
      --secondary: #181b21;
      --secondary-foreground: #e8eef7;
      --muted-bg: #171b22;
      --muted-foreground: #8b8d93;
      --accent-bg: #1c222b;
      --accent-foreground: #d7e7ff;
      --border: #2d3138;
      --input: #343941;
      --ring: #8ab4f8;
      --radius: 8px;
      --line: var(--border);
      --line-soft: #242830;
      --row-bg: var(--muted-bg);
      --control-bg: #1c2027;
      --dashboard-ink: #f8fafc;
      --dashboard-cloud: #2d3138;
      --dashboard-rose: #f87171;
      --dashboard-panel: #0a0d13;
      --dashboard-track: #11161c;
      --green: #4ade80;
      --red: #f87171;
      --blue: #8ab4f8;
      --warn: #fbbf24;
    }
    body { background: #050607 !important; }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .enterprise-dashboard-main,
    .enterprise-dashboard-main * {
      letter-spacing: 0 !important;
    }
    select,
    button {
      border: 1px solid var(--input);
      background: var(--control-bg);
      color: var(--foreground);
      border-radius: var(--radius);
      padding: 11px 12px;
      font: inherit;
    }
    option {
      background: var(--card);
      color: var(--foreground);
    }
    button {
      cursor: pointer;
    }
    .primary {
      background: var(--primary);
      border-color: var(--primary);
      color: var(--primary-foreground);
      font-weight: 650;
    }
    .grid,
    .overview-primary,
    .overview-rail,
    .coverage-grid,
    .provider-bars,
    .attention-list,
    .list {
      display: grid;
      gap: 14px;
      min-width: 0;
    }
    .two {
      grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr);
    }
    .card,
    .rail-card,
    .intent-card,
    .action-card {
      border: 1px solid #242830;
      border-radius: var(--radius);
      background: var(--card);
      color: var(--foreground);
      box-shadow: none;
    }
    .card,
    .rail-card {
      padding: 18px;
    }
    .intent-card,
    .action-card {
      padding: 16px;
    }
    .intent-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }
    .action-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .action-card {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-height: 176px;
    }
    .action-card h3,
    .intent-card h3 {
      margin: 0;
      color: var(--foreground);
      font-size: 16px;
      line-height: 1.2;
    }
    .action-card p,
    .intent-card p {
      margin: 8px 0 0;
      color: var(--muted-foreground);
      font-size: 13px;
      line-height: 1.45;
    }
    .action-card .action {
      margin-top: auto;
      align-self: flex-start;
    }
    .feature-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }
    .feature-tag {
      color: var(--green);
      border: 1px solid rgba(74, 222, 128, 0.30);
      border-radius: 999px;
      padding: 4px 7px;
      font-size: 11px;
    }
    .feature-tag.pending {
      color: var(--warn);
      border-color: rgba(251, 191, 36, 0.32);
    }
    .section-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 14px;
    }
    .section-title h2 {
      margin: 0;
      color: var(--foreground);
      font-size: 16px;
      font-weight: 700;
    }
    .section-title p {
      margin: 4px 0 0;
      color: var(--muted-foreground);
      font-size: 13px;
      line-height: 1.45;
    }
    .mini {
      color: var(--muted-foreground);
      font-size: 13px;
    }
    .row,
    .attention-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 14px;
      align-items: center;
      border: 1px solid #242830;
      border-radius: var(--radius);
      padding: 13px;
      background: var(--muted-bg);
    }
    .attention-row.warn {
      border-color: rgba(251, 191, 36, 0.30);
      background: rgba(251, 191, 36, 0.10);
    }
    .attention-row.bad {
      border-color: rgba(248, 113, 113, 0.30);
      background: rgba(248, 113, 113, 0.10);
    }
    .row-title {
      color: var(--foreground);
      font-weight: 650;
    }
    .row-sub {
      color: var(--muted-foreground);
      font-size: 13px;
      margin-top: 4px;
    }
    .tag,
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      width: fit-content;
      border-radius: 999px;
      white-space: nowrap;
    }
    .tag {
      color: var(--accent-foreground);
      font-size: 12px;
      border: 1px solid rgba(138, 180, 248, 0.26);
      padding: 5px 8px;
      background: var(--accent-bg);
    }
    .tag.good {
      color: var(--green);
      border-color: rgba(74, 222, 128, 0.30);
      background: rgba(74, 222, 128, 0.10);
    }
    .tag.warn {
      color: var(--warn);
      border-color: rgba(251, 191, 36, 0.32);
      background: rgba(251, 191, 36, 0.10);
    }
    .tag.bad {
      color: var(--red);
      border-color: rgba(248, 113, 113, 0.32);
      background: rgba(248, 113, 113, 0.10);
    }
    .status-pill {
      padding: 7px 10px;
      color: var(--green);
      border: 1px solid rgba(74, 222, 128, 0.26);
      background: rgba(74, 222, 128, 0.10);
      font-size: 12px;
      font-weight: 650;
    }
    .status-pill.warn {
      color: var(--warn);
      border-color: rgba(251, 191, 36, 0.30);
      background: rgba(251, 191, 36, 0.10);
    }
    .status-pill.bad {
      color: var(--red);
      border-color: rgba(248, 113, 113, 0.30);
      background: rgba(248, 113, 113, 0.12);
    }
    .empty,
    .error {
      color: var(--muted-foreground);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
      padding: 18px;
      background: var(--muted-bg);
    }
    .error {
      color: var(--red);
      border-color: rgba(248, 113, 113, 0.34);
    }
    .action {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 10px 12px;
      color: var(--foreground);
      background: var(--card);
    }
    .action.primary {
      color: var(--primary-foreground);
      background: var(--primary);
      border-color: var(--primary);
      font-weight: 650;
    }
    .tab-panel {
      display: grid;
      gap: 20px;
    }
    .tab-panel[hidden] {
      display: none;
    }
    .dashboard-hero,
    .hero-row,
    .toolbar,
    .timeframe-toggle,
    .analytics-head,
    .analytics-metric-top,
    .analytics-panel-head,
    .analytics-table-row,
    .coverage-top {
      display: flex;
      align-items: center;
    }
    .dashboard-hero {
      justify-content: space-between;
    }
    .hero-copy {
      display: grid;
      align-content: center;
      min-width: 0;
    }
    .hero-row,
    .toolbar {
      flex-wrap: wrap;
    }
    .hero-status,
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }
    .hero-status-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--green);
    }
    h1 {
      margin: 0;
      letter-spacing: 0;
    }
    .lead {
      margin: 0;
    }
    .dashboard-overview-grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      align-items: start;
    }
    .overview-rail {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .rail-card {
      display: grid;
      gap: 12px;
    }
    .rail-title {
      color: var(--foreground);
      font-size: 14px;
      font-weight: 700;
    }
    .rail-value {
      color: var(--foreground);
      font-size: 28px;
      font-weight: 750;
      line-height: 1;
    }
    .rail-copy,
    .rail-meta {
      color: var(--muted-foreground);
      font-size: 13px;
      line-height: 1.45;
      margin: 0;
    }
    .analytics-metric-grid,
    .analytics-board {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .analytics-metric-grid {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .analytics-board {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .analytics-panel,
    .analytics-row,
    .analytics-table {
      display: grid;
      min-width: 0;
    }
    .analytics-list {
      display: grid;
      gap: 10px;
    }
    .analytics-panel-head,
    .analytics-table-row {
      justify-content: space-between;
      gap: 12px;
    }
    .analytics-panel-head h3 {
      margin: 0;
      color: var(--foreground);
      font-size: 15px;
      font-weight: 720;
      line-height: 1.2;
    }
    .analytics-row {
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 12px;
      align-items: center;
    }
    .analytics-row-main {
      min-width: 0;
    }
    .analytics-row-label,
    .analytics-table-label {
      color: var(--foreground);
      font-size: 13px;
      font-weight: 680;
    }
    .analytics-row-detail,
    .analytics-table-detail {
      color: var(--muted-foreground);
      font-size: 12px;
      line-height: 1.35;
      margin-top: 3px;
    }
    .analytics-row-value,
    .analytics-table-value {
      color: var(--foreground);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 15px;
      font-weight: 760;
      white-space: nowrap;
    }
    .analytics-table {
      gap: 0;
      overflow: hidden;
    }
    .analytics-table-row {
      min-height: 58px;
      padding: 12px 14px;
    }
    .analytics-table-row:not(:last-child) {
      border-bottom: 1px solid var(--border);
    }
    .analytics-share {
      min-width: 52px;
      text-align: right;
    }
    .provider-row,
    .coverage-item {
      display: grid;
      gap: 8px;
      border: 1px solid #242830;
      border-radius: var(--radius);
      padding: 12px;
      background: var(--muted-bg);
    }
    .provider-row-head {
      display: grid;
      grid-template-columns: minmax(0, 1fr);
      gap: 10px;
      align-items: start;
    }
    .provider-name {
      color: var(--foreground);
      font-size: 15px;
      font-weight: 650;
    }
    .provider-meta {
      color: var(--muted-foreground);
      font-size: 12px;
      margin-top: 3px;
    }
    .coverage-top {
      justify-content: space-between;
      gap: 10px;
    }
    .coverage-label {
      color: var(--muted-foreground);
      font-size: 13px;
    }
    .coverage-value {
      color: var(--foreground);
      font-size: 20px;
      font-weight: 680;
    }
    .meter {
      height: 8px;
      border-radius: 999px;
      background: #0d1117;
      overflow: hidden;
    }
    .meter > span {
      display: block;
      height: 100%;
      width: var(--width, 0%);
      border-radius: inherit;
      background: var(--fill, var(--primary));
    }
    .coverage-item .meter {
      margin-top: 8px;
    }
    .main.enterprise-dashboard-main {
      justify-self: start;
      margin: 0;
      padding: 0 !important;
      max-width: none !important;
      width: 100% !important;
      background: #0a0d13 !important;
      border-color: #242830 !important;
      border-radius: 18px !important;
      overflow: hidden;
    }
    .dashboard-topbar {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(260px, 380px) auto auto;
      align-items: center;
      gap: 14px;
      min-height: 58px;
      padding: 0 28px;
      border-bottom: 1px solid #242830;
      background: #0a0d13;
    }
    .dashboard-breadcrumb {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 9px;
      color: #7d828c;
      font-size: 13px;
    }
    .dashboard-breadcrumb strong {
      color: #d9dee7;
      font-weight: 600;
    }
    .dashboard-breadcrumb span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dashboard-search {
      display: grid;
      grid-template-columns: 18px minmax(0, 1fr) auto;
      align-items: center;
      gap: 9px;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid #242830;
      border-radius: 8px;
      background: #11161c;
      color: #7d828c;
      font-size: 12px;
    }
    .dashboard-search input {
      width: 100%;
      min-width: 0;
      padding: 0 !important;
      border: 0 !important;
      background: transparent !important;
      color: #d9dee7 !important;
      font: inherit;
      outline: none;
    }
    .dashboard-search kbd {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 28px;
      height: 18px;
      border: 1px solid #303640;
      border-radius: 5px;
      color: #8b8d93;
      background: #171b22;
      font-size: 10px;
      font-family: inherit;
    }
    .dashboard-icon-button {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      padding: 0 !important;
      border-radius: 8px;
      border: 1px solid #242830 !important;
      background: #11161c !important;
      color: #9ca3af !important;
    }
    .dashboard-user {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr);
      align-items: center;
      gap: 10px;
      min-width: 154px;
    }
    .dashboard-avatar {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      border-radius: 999px;
      color: #08111f;
      background: linear-gradient(135deg, #8ab4f8, #4ade80);
      font-size: 12px;
      font-weight: 800;
    }
    .dashboard-user strong {
      display: block;
      color: #f8fafc;
      font-size: 13px;
      line-height: 1.1;
    }
    .dashboard-user span {
      display: block;
      color: #8b8d93;
      font-size: 11px;
      line-height: 1.2;
    }
    .enterprise-page-shell {
      padding: 0 28px 34px;
      gap: 0;
      background: #0a0d13;
    }
    .control-center-card {
      border: 0 !important;
      border-radius: 0;
      padding: 0;
      background: transparent !important;
      box-shadow: none !important;
    }
    .enterprise-dashboard-main .tabbar {
      display: flex;
      gap: 24px;
      align-items: stretch;
      flex-wrap: nowrap;
      min-height: 64px;
      margin: 0 -28px 26px;
      padding: 0 40px;
      border: 0 !important;
      border-bottom: 1px solid #242830 !important;
      border-radius: 0 !important;
      background: #0a0d13 !important;
      overflow-x: auto;
    }
    .enterprise-dashboard-main .tab-button {
      position: relative;
      display: inline-flex;
      align-items: center;
      min-height: 64px;
      padding: 0 0 !important;
      border: 0 !important;
      border-radius: 0 !important;
      background: transparent !important;
      color: #8b8d93 !important;
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: none !important;
    }
    .enterprise-dashboard-main .tab-button.active {
      color: #f8fafc !important;
      background: transparent !important;
      border: 0 !important;
      box-shadow: none !important;
    }
    .enterprise-dashboard-main .tab-button.active::after {
      content: "";
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: 2px;
      border-radius: 999px 999px 0 0;
      background: linear-gradient(90deg, #8ab4f8, #4ade80);
      box-shadow: 0 0 18px rgba(138, 180, 248, 0.42);
    }
    .tab-panel {
      gap: 20px;
    }
    .dashboard-hero {
      align-items: flex-end;
      gap: 24px;
      padding: 0 0 22px;
    }
    .hero-copy {
      gap: 9px;
      max-width: 820px;
    }
    .hero-row {
      gap: 9px;
    }
    .eyebrow,
    .hero-status {
      min-height: 24px;
      border-radius: 7px;
      padding: 4px 9px;
      background: #11161c;
      border-color: #303640;
      color: #aeb5c2;
      text-transform: none;
      font-size: 12px;
      font-weight: 650;
    }
    .eyebrow {
      color: #d7e7ff;
      border-color: rgba(138, 180, 248, 0.30);
      background: rgba(138, 180, 248, 0.10);
    }
    .hero-status.live {
      color: #86efac;
      border-color: rgba(74, 222, 128, 0.28);
      background: rgba(74, 222, 128, 0.08);
    }
    .hero-status.sync {
      border-color: transparent;
      background: transparent;
      color: #7d828c;
      padding-left: 0;
    }
    .hero-status-dot {
      width: 6px;
      height: 6px;
      box-shadow: 0 0 0 3px rgba(74, 222, 128, 0.12);
    }
    h1 {
      max-width: none;
      color: #f8fafc;
      font-size: clamp(30px, 3vw, 42px);
      line-height: 1.02;
      font-weight: 800;
    }
    .lead {
      max-width: 900px;
      margin: 0;
      color: #8b8d93;
      font-size: 15px;
      line-height: 1.6;
    }
    .hero-toolbar {
      margin-top: 0;
      justify-content: flex-end;
      flex-wrap: nowrap;
    }
    .hero-toolbar .action,
    .hero-toolbar button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 34px;
      padding: 8px 12px;
      border: 1px solid #303640 !important;
      border-radius: 8px;
      background: #11161c !important;
      color: #d9dee7 !important;
      font-size: 13px;
      line-height: 1;
      white-space: nowrap;
    }
    .hero-toolbar .primary {
      background: #8ab4f8 !important;
      border-color: #8ab4f8 !important;
      color: #08111f !important;
      box-shadow: 0 12px 30px rgba(138, 180, 248, 0.24);
    }
    .posture-grid {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }
    .posture-card {
      display: grid;
      grid-template-columns: 34px minmax(0, 1fr);
      gap: 12px;
      align-items: center;
      min-height: 75px;
      padding: 14px 16px;
      border: 1px solid #242830;
      border-radius: 8px;
      background: #11161c;
    }
    .posture-icon {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 8px;
      color: #8ab4f8;
      background: rgba(138, 180, 248, 0.10);
      font-weight: 800;
    }
    .posture-card.good .posture-icon {
      color: #4ade80;
      background: rgba(74, 222, 128, 0.10);
    }
    .posture-card.warn .posture-icon {
      color: #fbbf24;
      background: rgba(251, 191, 36, 0.10);
    }
    .posture-label {
      display: block;
      color: #747b86;
      font-size: 11px;
      font-weight: 750;
      line-height: 1.1;
      text-transform: uppercase;
    }
    .posture-card strong {
      display: block;
      margin-top: 4px;
      color: #f8fafc;
      font-size: 20px;
      line-height: 1;
      font-weight: 780;
    }
    .posture-card small {
      display: block;
      margin-top: 4px;
      color: #8b8d93;
      font-size: 12px;
      line-height: 1.2;
    }
    .dashboard-overview-grid {
      gap: 20px;
    }
    .overview-primary {
      gap: 20px;
    }
    .enterprise-dashboard-main .card,
    .enterprise-dashboard-main .rail-card {
      background: #11161c !important;
      border-color: #242830 !important;
      border-radius: 8px !important;
      box-shadow: none !important;
    }
    .call-summary-grid {
      gap: 12px;
      margin-bottom: 0;
    }
    .enterprise-dashboard-main .call-summary-item {
      position: relative;
      display: grid;
      gap: 7px;
      min-height: 132px;
      overflow: hidden;
      padding: 20px 20px 17px;
      border: 1px solid #242830 !important;
      border-radius: 8px;
      background: #11161c !important;
      color: #f8fafc !important;
    }
    .call-summary-item::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--metric-color, #8ab4f8);
      opacity: 0.86;
    }
    .call-summary-label {
      color: #747b86;
      font-size: 11px;
      letter-spacing: 0 !important;
      text-transform: uppercase;
    }
    .call-summary-value {
      margin: 0;
      color: #f8fafc;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 34px;
      line-height: 1;
      font-weight: 750;
    }
    .metric-value-row {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    .metric-delta {
      color: #4ade80;
      font-size: 12px;
      font-weight: 650;
      white-space: nowrap;
    }
    .metric-delta.bad { color: #f87171; }
    .metric-delta.warn { color: #fbbf24; }
    .call-summary-sub {
      color: #8b8d93;
      font-size: 12px;
      line-height: 1.25;
    }
    .metric-total { --metric-color: #8ab4f8; }
    .metric-allowed { --metric-color: #4ade80; }
    .metric-blocked { --metric-color: #f87171; }
    .metric-errors { --metric-color: #fbbf24; }
    .section-kicker,
    .card-kicker {
      display: block;
      margin-bottom: 8px;
      color: #747b86;
      font-size: 11px;
      font-weight: 750;
      line-height: 1.1;
      text-transform: uppercase;
    }
    .section-title h2 {
      color: #f8fafc;
      font-size: 18px;
      font-weight: 760;
    }
    .section-title p {
      color: #8b8d93;
      font-size: 13px;
    }
    .timeframe-toggle {
      border-color: #242830;
      background: #0d1117;
      border-radius: 8px;
    }
    .timeframe-button {
      min-width: 48px;
      padding: 7px 10px !important;
      color: #8b8d93 !important;
      background: transparent !important;
    }
    .timeframe-button.active {
      background: #171b22 !important;
      color: #f8fafc !important;
      border-color: #303640 !important;
      box-shadow: none !important;
    }
    .shadcn-analytics-card {
      padding: 22px !important;
    }
    .analytics-head {
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 18px;
    }
    .analytics-metric-grid {
      margin-bottom: 12px;
    }
    .analytics-metric {
      position: relative;
      display: grid;
      gap: 8px;
      min-height: 126px;
      overflow: hidden;
      padding: 18px;
      border: 1px solid #242830;
      border-radius: 8px;
      background: #171b22;
      color: #f8fafc;
    }
    .analytics-metric::before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 3px;
      background: var(--metric-color, #8ab4f8);
      opacity: 0.86;
    }
    .analytics-metric-top {
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
    }
    .analytics-board {
      margin-top: 12px;
    }
    .analytics-panel,
    .analytics-table {
      border: 1px solid #242830;
      border-radius: 8px;
      background: #0d1117;
    }
    .analytics-panel {
      gap: 14px;
      padding: 14px;
    }
    .analytics-row {
      min-height: 70px;
      padding: 12px;
      border: 1px solid #242830;
      border-radius: 8px;
      background: #171b22;
    }
    .analytics-row .tag {
      justify-self: end;
    }
    .analytics-table {
      margin-top: 12px;
    }
    .analytics-table-value {
      justify-self: end;
    }
    .analytics-share {
      color: #8b8d93;
      font-size: 12px;
      white-space: nowrap;
    }
    .coverage-label,
    .provider-meta,
    .mini,
    .row-sub {
      color: #8b8d93 !important;
    }
    .coverage-item,
    .provider-row,
    .attention-row,
    .enterprise-dashboard-main .row,
    .enterprise-dashboard-main .intent-card,
    .enterprise-dashboard-main .action-card {
      background: #171b22 !important;
      border-color: #242830 !important;
    }
    .overview-rail {
      gap: 12px;
    }
    .enterprise-dashboard-main .rail-card.accent {
      background: linear-gradient(135deg, #8ab4f8, #4ade80) !important;
      border-color: rgba(138, 180, 248, 0.48) !important;
    }
    @media (max-width: 980px) {
      .dashboard-topbar { grid-template-columns: minmax(0, 1fr); align-items: stretch; padding: 14px 16px; }
      .dashboard-user { display: none; }
      .enterprise-page-shell { padding: 0 16px 26px; }
      .enterprise-dashboard-main .tabbar { margin: 0 -16px 22px; padding: 0 24px; }
      .dashboard-hero { align-items: flex-start; flex-direction: column; }
      .toolbar { justify-content: flex-start; }
      .two, .dashboard-overview-grid, .intent-grid, .action-grid, .analytics-board, .analytics-metric-grid, .posture-grid { grid-template-columns: 1fr; }
      .analytics-head { align-items: stretch; flex-direction: column; }
      .timeframe-toggle { width: 100%; }
      .timeframe-button { flex: 1; }
      .overview-rail { grid-template-columns: 1fr; }
    }
    @media (max-width: 640px) {
      .shell,
      .layout {
        grid-template-columns: minmax(0, 1fr) !important;
        width: 100% !important;
        min-width: 0 !important;
        padding: 8px !important;
      }
      .sidebar.enterprise-app-sidebar.enterprise-dual-sidebar {
        display: none !important;
      }
      .main.enterprise-dashboard-main { width: 100% !important; }
      .dashboard-search { grid-template-columns: 18px minmax(0, 1fr); }
      .dashboard-search kbd { display: none; }
      .hero-toolbar { width: 100%; justify-content: stretch; }
      .hero-toolbar .action,
      .hero-toolbar button { flex: 1; justify-content: center; text-align: center; }
      .shadcn-analytics-card { padding: 16px !important; }
      .analytics-table-row,
      .analytics-row { grid-template-columns: 1fr; align-items: start; }
      .analytics-row .tag,
      .analytics-table-value { justify-self: start; }
    }
    @media (min-width: 981px) and (max-width: 1220px) {
      .intent-grid, .action-grid, .analytics-board { grid-template-columns: repeat(3, minmax(0, 1fr)); }
      .posture-grid, .analytics-metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .overview-rail { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('dashboard')}

    <main class="main enterprise-dashboard-main">
      <header class="dashboard-topbar" aria-label="Enterprise dashboard header">
        <div class="dashboard-breadcrumb" aria-label="Workspace breadcrumb">
          <span>Workspace</span><span aria-hidden="true">/</span><strong id="topOrgName">acme-prod</strong><span aria-hidden="true">/</span><span>Dashboard</span>
        </div>
        <label class="dashboard-search">
          <span aria-hidden="true">⌕</span>
          <span class="sr-only">Search keys, workloads, incidents</span>
          <input type="search" readonly placeholder="Search keys, workloads, incidents..." />
          <kbd>⌘K</kbd>
        </label>
        <button class="dashboard-icon-button" type="button" aria-label="Notifications">•</button>
        <div class="dashboard-user" aria-label="Customer business workspace">
          <span id="topBusinessAvatar" class="dashboard-avatar" aria-hidden="true">NV</span>
          <div>
            <strong id="topBusinessName">NVIDIA</strong>
            <span>Customer business</span>
          </div>
        </div>
      </header>
      <section class="enterprise-page-shell">
        <div id="authNotice" class="error" style="display:none"></div>

        <section class="control-center-card" aria-label="Enterprise control center" data-ui-kit="shadcn-studio">
          <span class="sr-only">Control center</span>

          <nav class="tabbar" aria-label="Enterprise dashboard tabs">
            <button class="tab-button active" type="button" data-dashboard-tab="overview">Overview</button>
            <button class="tab-button" type="button" data-dashboard-tab="keymap">Key Map</button>
            <button class="tab-button" type="button" data-dashboard-tab="security">Security</button>
            <button class="tab-button" type="button" data-dashboard-tab="access">Access</button>
            <button class="tab-button" type="button" data-dashboard-tab="operations">Operations</button>
          </nav>

      <section id="tab-overview" class="tab-panel" data-tab-panel="overview">
        <section class="dashboard-hero" aria-label="Enterprise control center overview">
          <div class="hero-copy">
            <div class="hero-row">
              <div class="eyebrow">Enterprise dashboard</div>
              <div class="hero-status live"><span class="hero-status-dot"></span><span>Live workspace</span></div>
              <div class="hero-status sync"><span id="lastSyncLabel">last sync · 12s</span></div>
            </div>
            <h1 aria-label="API Key Security Overview">API key security overview</h1>
            <p class="lead">Real-time posture across protected tokens, runtime traffic and key rotations. Filtered for production workloads.</p>
          </div>
          <div class="toolbar hero-toolbar" aria-label="Dashboard actions">
            <button type="button">prod · all regions</button>
            <a class="action" href="/api/v1/enterprise/audit?format=csv&days=30">Export</a>
            <a class="action primary" href="/app/settings">Configure</a>
          </div>
        </section>

        <section class="posture-grid" aria-label="Enterprise posture snapshot">
          <div class="posture-card good">
            <span id="postureStateIcon" class="posture-icon" aria-hidden="true">✓</span>
            <div>
              <span class="posture-label">Posture</span>
              <strong id="postureState">Healthy</strong>
              <small id="postureSub">92% controls passing</small>
            </div>
          </div>
          <div class="posture-card">
            <span class="posture-icon" aria-hidden="true">↯</span>
            <div>
              <span class="posture-label">Active scans</span>
              <strong id="postureScans">14</strong>
              <small id="postureScansSub">avg 4.2s / scan</small>
            </div>
          </div>
          <div class="posture-card warn">
            <span class="posture-icon" aria-hidden="true">!</span>
            <div>
              <span class="posture-label">Open incidents</span>
              <strong id="postureIncidents">5</strong>
              <small id="postureIncidentsSub">2 critical · 2 warn</small>
            </div>
          </div>
          <div class="posture-card">
            <span class="posture-icon" aria-hidden="true">↻</span>
            <div>
              <span class="posture-label">Pending rotations</span>
              <strong id="postureRotations">3</strong>
              <small id="postureRotationsSub">next: 04:00 UTC</small>
            </div>
          </div>
        </section>

        <section class="dashboard-overview-grid" aria-label="Dashboard overview workspace">
          <div class="overview-primary">
            <section class="card shadcn-analytics-card" aria-label="Traffic and key readiness" data-ui-kit="shadcn-analytics">
              <div class="section-title analytics-head">
                <div>
                  <span class="section-kicker">Traffic and readiness</span>
                  <h2>Protected API operations</h2>
                  <p><span id="trendMeta" class="traffic-window-meta">Selected window: 6mo</span> · <span id="trendWindowHint">Daily protected API traffic</span></p>
                </div>
                <div class="timeframe-toggle" role="group" aria-label="API call time range">
                  <button class="timeframe-button" type="button" data-call-range="30">30d</button>
                  <button class="timeframe-button" type="button" data-call-range="90">90d</button>
                  <button class="timeframe-button active" type="button" data-call-range="180">6mo</button>
                </div>
              </div>
              <div class="analytics-metric-grid" aria-label="Selected API call window">
                <div class="analytics-metric metric-total">
                  <div class="analytics-metric-top"><span class="call-summary-label">Total calls</span><span id="callWindowTotalDelta" class="metric-delta">+12.4%</span></div>
                  <strong id="callWindowTotal" class="call-summary-value">...</strong>
                  <span id="callWindowTotalSub" class="call-summary-sub">180d window</span>
                </div>
                <div class="analytics-metric metric-allowed">
                  <div class="analytics-metric-top"><span class="call-summary-label">Allowed</span><span id="callWindowAllowedDelta" class="metric-delta">+11.8%</span></div>
                  <strong id="callWindowAllowed" class="call-summary-value">...</strong>
                  <span id="callWindowAllowedSub" class="call-summary-sub">92.1% pass rate</span>
                </div>
                <div class="analytics-metric metric-blocked">
                  <div class="analytics-metric-top"><span class="call-summary-label">Blocked</span><span id="callWindowBlockedDelta" class="metric-delta bad">-3.2%</span></div>
                  <strong id="callWindowBlocked" class="call-summary-value">...</strong>
                  <span id="callWindowBlockedSub" class="call-summary-sub">5.7% of traffic</span>
                </div>
                <div class="analytics-metric metric-errors">
                  <div class="analytics-metric-top"><span class="call-summary-label">Errors</span><span id="callWindowErrorsDelta" class="metric-delta warn">+1.1%</span></div>
                  <strong id="callWindowErrors" class="call-summary-value">...</strong>
                  <span id="callWindowErrorsSub" class="call-summary-sub">2.3% upstream</span>
                </div>
              </div>

              <div class="analytics-board" aria-label="Enterprise operations summary">
                <div class="analytics-panel">
                  <div class="analytics-panel-head">
                    <div><span class="card-kicker">Outcome mix</span><h3>Allowed, blocked, errors</h3></div>
                    <span id="trafficMeta" class="mini">0 calls</span>
                  </div>
                  <div id="trafficOutcomeList" class="analytics-list"><div class="empty">Loading traffic outcomes...</div></div>
                </div>
                <div class="analytics-panel">
                  <div class="analytics-panel-head">
                    <div><span class="card-kicker">Key readiness</span><h3>Protected API keys</h3></div>
                    <span id="keyReadinessMeta" class="mini">loading</span>
                  </div>
                  <div id="keyReadinessList" class="analytics-list"><div class="empty">Loading key readiness...</div></div>
                </div>
                <div class="analytics-panel">
                  <div class="analytics-panel-head">
                    <div><span class="card-kicker">Rollout</span><h3>Organization coverage</h3></div>
                    <span id="coverageMeta" class="mini">loading</span>
                  </div>
                  <div id="projectCoverageList" class="analytics-list"><div class="empty">Loading coverage...</div></div>
                </div>
              </div>

              <div id="trendSummaryTable" class="analytics-table" aria-label="Protected traffic summary"><div class="empty">Loading protected traffic summary...</div></div>
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
              <p>Token-level coverage for provider slots, observed runtime traffic, and attention signals.</p>
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
              <div class="row"><div><div class="row-title">Access review</div><div class="row-sub">CSV evidence for members, roles, and token access.</div></div><span class="tag good">available</span></div>
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
              <div class="row"><div><div class="row-title">SSO path</div><div class="row-sub">Use Entra ID through Supabase SAML broker/session provider for customer-facing SSO.</div></div><span class="tag">SSO posture</span></div>
              <div class="row"><div><div class="row-title">Access review</div><div class="row-sub">Confirm owners and admins are the right people before expanding team access.</div></div><span class="tag">Members</span></div>
              <div class="row"><div><div class="row-title">Alert delivery</div><div class="row-sub">Set destinations and test delivery before relying on incident notifications.</div></div><span class="tag">Alerts</span></div>
            </div>
          </div>
        </section>
      </section>

      <section id="tab-operations" class="tab-panel" data-tab-panel="operations" hidden>
        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Token health</h2><span id="projectHealthMeta" class="mini"></span></div>
            <div id="projectHealthList" class="list"><div class="empty">Loading tokens...</div></div>
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
      var currentOrgId = localStorage.getItem(ACTIVE_ORG_STORAGE_KEY) || '';
      var loadSequence = 0;
      var latestDashboardOverview = {};
      var callTrendRangeDays = 180;
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
      function businessInitials(value) {
        var words = String(value || '')
          .trim()
          .split(/\\s+/)
          .filter(Boolean);
        if (!words.length) return 'NV';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
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
      function setMetricDelta(id, value, invert) {
        var el = byId(id);
        if (!el) return;
        var n = Number(value || 0);
        if (!Number.isFinite(n)) n = 0;
        var rounded = Math.round(n * 10) / 10;
        el.textContent = (rounded >= 0 ? '+' : '') + rounded + '%';
        var isGood = invert ? rounded <= 0 : rounded >= 0;
        el.className = 'metric-delta ' + (isGood ? '' : 'bad');
      }
      function setPostureTone(tone, icon) {
        var state = byId('postureState');
        var card = state && state.closest ? state.closest('.posture-card') : null;
        if (card) card.className = 'posture-card ' + (tone || '');
        text('postureStateIcon', icon || '✓');
      }
      function percentChange(previous, current) {
        previous = rawNumber(previous);
        current = rawNumber(current);
        if (previous <= 0) return current > 0 ? 100 : 0;
        return ((current - previous) / previous) * 100;
      }
      function sumTrend(items, resolver) {
        return (Array.isArray(items) ? items : []).reduce(function(sum, item) {
          return sum + rawNumber(resolver(item));
        }, 0);
      }
      function resolveDashboardOverview(overview) {
        return overview || {};
      }
      function analyticsToneClass(tone) {
        return tone === 'bad' ? 'bad' : tone === 'warn' ? 'warn' : tone === 'good' ? 'good' : '';
      }
      function analyticsRow(label, value, detail, tone, shareLabel) {
        var tagClass = analyticsToneClass(tone);
        return '<div class="analytics-row">' +
          '<div class="analytics-row-main"><div class="analytics-row-label">' + escapeHtml(label) + '</div><div class="analytics-row-detail">' + escapeHtml(detail || '') + '</div></div>' +
          '<div><div class="analytics-row-value">' + escapeHtml(value) + '</div>' + (shareLabel ? '<div class="analytics-share">' + escapeHtml(shareLabel) + '</div>' : '') + '</div>' +
          (tagClass ? '<span class="tag ' + tagClass + '">' + escapeHtml(tagClass) + '</span>' : '') +
        '</div>';
      }
      function analyticsTableRow(label, value, detail) {
        return '<div class="analytics-table-row"><div><div class="analytics-table-label">' + escapeHtml(label) + '</div><div class="analytics-table-detail">' + escapeHtml(detail || '') + '</div></div><div class="analytics-table-value">' + escapeHtml(value) + '</div></div>';
      }
      function shortDateLabel(value) {
        var date = new Date(String(value || '') + 'T00:00:00.000Z');
        if (!Number.isFinite(date.getTime())) return String(value || '').slice(5) || 'n/a';
        var monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[date.getUTCMonth()] + ' ' + date.getUTCDate() + ', ' + date.getUTCFullYear();
      }
      function selectedTrafficStats(trend, days, fallbackTraffic) {
        days = rawNumber(days) || 180;
        var list = Array.isArray(trend) ? trend.slice(-days) : [];
        var hasTrend = list.length > 0;
        var total = hasTrend ? sumTrend(list, function(item) { return item.calls; }) : rawNumber(fallbackTraffic.totalCalls);
        var deniedTotal = hasTrend ? sumTrend(list, function(item) { return item.denied; }) : rawNumber(fallbackTraffic.deniedCalls);
        var errorTotal = hasTrend ? sumTrend(list, function(item) { return item.errors; }) : rawNumber(fallbackTraffic.errorCalls);
        var otherErrorTotal = hasTrend ? Math.max(errorTotal - deniedTotal, 0) : rawNumber(fallbackTraffic.otherErrorCalls);
        var allowedTotal = hasTrend ? Math.max(total - errorTotal, 0) : rawNumber(fallbackTraffic.okCalls);
        if (!hasTrend && !allowedTotal && total) allowedTotal = Math.max(total - deniedTotal - otherErrorTotal, 0);
        var splitIndex = Math.max(1, Math.floor(list.length / 2));
        var previousWindow = list.slice(0, splitIndex);
        var currentWindow = list.slice(splitIndex);
        if (!currentWindow.length) currentWindow = previousWindow;
        var previousTotal = sumTrend(previousWindow, function(item) { return item.calls; });
        var currentTotal = sumTrend(currentWindow, function(item) { return item.calls; });
        var previousAllowed = sumTrend(previousWindow, function(item) { return Math.max(rawNumber(item.calls) - rawNumber(item.errors), 0); });
        var currentAllowed = sumTrend(currentWindow, function(item) { return Math.max(rawNumber(item.calls) - rawNumber(item.errors), 0); });
        var previousBlocked = sumTrend(previousWindow, function(item) { return item.denied; });
        var currentBlocked = sumTrend(currentWindow, function(item) { return item.denied; });
        var previousOtherErrors = sumTrend(previousWindow, function(item) { return Math.max(rawNumber(item.errors) - rawNumber(item.denied), 0); });
        var currentOtherErrors = sumTrend(currentWindow, function(item) { return Math.max(rawNumber(item.errors) - rawNumber(item.denied), 0); });
        var averageCalls = Math.round(total / Math.max(list.length || days, 1));
        var peakPoint = list.reduce(function(peak, item) {
          return rawNumber(item.calls) > rawNumber(peak && peak.calls) ? item : peak;
        }, list[0] || null);
        return {
          days: days,
          listLength: list.length,
          total: total,
          allowed: allowedTotal,
          denied: deniedTotal,
          otherErrors: otherErrorTotal,
          averageCalls: averageCalls,
          peakPoint: peakPoint,
          previousTotal: previousTotal,
          currentTotal: currentTotal,
          previousAllowed: previousAllowed,
          currentAllowed: currentAllowed,
          previousBlocked: previousBlocked,
          currentBlocked: currentBlocked,
          previousOtherErrors: previousOtherErrors,
          currentOtherErrors: currentOtherErrors,
        };
      }
      function renderTrafficOutcomeRows(stats) {
        var total = rawNumber(stats.total);
        var rows = [
          analyticsRow('Allowed', number(stats.allowed), 'Requests approved by policy and routed through VaultProof.', 'good', percent(stats.allowed, total) + '% of traffic'),
          analyticsRow('Blocked', number(stats.denied), 'Requests denied by caller-lock, provider scope, path, or rate policy.', stats.denied ? 'bad' : 'good', percent(stats.denied, total) + '% of traffic'),
          analyticsRow('Errors', number(stats.otherErrors), 'Upstream or system errors after denied traffic is excluded.', stats.otherErrors ? 'warn' : 'good', percent(stats.otherErrors, total) + '% of traffic'),
        ];
        var list = byId('trafficOutcomeList');
        if (list) list.innerHTML = rows.join('');
        text('trafficMeta', number(total) + ' ' + plural(total, 'call'));
      }
      function renderKeyReadinessRows(summary) {
        summary = summary || {};
        var total = rawNumber(summary.totalSlots);
        var live = rawNumber(summary.liveSealedSlots);
        var placeholder = rawNumber(summary.placeholderSlots);
        var incomplete = rawNumber(summary.mixedSlots) + rawNumber(summary.missingSlots);
        var rows = [
          analyticsRow('Ready for traffic', number(live), 'Real provider keys are sealed and usable for upstream dispatch.', 'good', percent(live, total) + '% ready'),
          analyticsRow('Demo only', number(placeholder), 'Placeholder keys need real sealed setup before production use.', placeholder ? 'warn' : 'good', percent(placeholder, total) + '% demo'),
          analyticsRow('Incomplete', number(incomplete), 'Setup is partial or missing for these provider slots.', incomplete ? 'bad' : 'good', percent(incomplete, total) + '% incomplete'),
        ];
        var list = byId('keyReadinessList');
        if (list) list.innerHTML = rows.join('');
        text('keyReadinessMeta', number(total) + ' ' + plural(total, 'slot'));
      }
      function renderDashboardCoverageRows(coverage, summary) {
        coverage = coverage || {};
        summary = summary || {};
        var totalProjects = rawNumber(coverage.totalProjects);
        var withSlots = rawNumber(coverage.withProviderSlots);
        var withTraffic = rawNumber(coverage.withTraffic);
        var withoutSlots = rawNumber(coverage.withoutProviderSlots);
        var needingAttention = rawNumber(coverage.needingAttention);
        var totalSlots = rawNumber(summary.totalSlots);
        var live = rawNumber(summary.liveSealedSlots);
        var rows = [
          analyticsRow('Tokens with key slots', number(withSlots) + '/' + number(totalProjects), number(withoutSlots) + ' tokens without active slots.', withSlots === totalProjects && totalProjects ? 'good' : 'warn', percent(withSlots, totalProjects) + '% covered'),
          analyticsRow('Tokens with traffic', number(withTraffic) + '/' + number(totalProjects), 'Proxy activity observed in the selected health window.', withTraffic ? 'good' : 'warn', percent(withTraffic, totalProjects) + '% active'),
          analyticsRow('Keys ready', number(live) + '/' + number(totalSlots), 'Protected keys ready for upstream dispatch.', live === totalSlots && totalSlots ? 'good' : 'warn', percent(live, totalSlots) + '% ready'),
          analyticsRow('Needs attention', number(needingAttention), 'Tokens with denied or error traffic.', needingAttention ? 'bad' : 'good', totalProjects ? percent(needingAttention, totalProjects) + '% review' : '0% review'),
        ];
        var list = byId('projectCoverageList');
        if (list) list.innerHTML = rows.join('');
        text('coverageMeta', number(totalProjects) + ' ' + plural(totalProjects, 'token'));
      }
      function coverageItem(label, value, detail, width, tone) {
        var color = tone === 'bad' ? '#f87171' : tone === 'warn' ? '#fbbf24' : tone === 'blue' ? '#8ab4f8' : '#4ade80';
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
          coverageItem('Tokens with key slots', number(withSlots) + '/' + number(totalProjects), number(rawNumber(coverage.withoutProviderSlots)) + ' tokens without active slots', percent(withSlots, totalProjects), withSlots === totalProjects && totalProjects ? 'good' : 'warn'),
          coverageItem('Tokens with traffic', number(withTraffic) + '/' + number(totalProjects), 'Proxy activity observed in the health window', percent(withTraffic, totalProjects), withTraffic ? 'blue' : 'warn'),
          coverageItem('Keys ready', number(live) + '/' + number(totalSlots), 'Protected keys ready for upstream dispatch', percent(live, totalSlots), live === totalSlots && totalSlots ? 'good' : 'warn'),
          coverageItem('Needs attention', number(needingAttention), 'Tokens with denied or error traffic', totalProjects ? percent(needingAttention, totalProjects) : 0, needingAttention ? 'bad' : 'good'),
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
        list.innerHTML = usage.length ? usage.map(function(item) {
          var slots = rawNumber(item.slots);
          var calls = rawNumber(item.recentCalls);
          var labelText = Array.isArray(item.labels) && item.labels.length ? item.labels.join(', ') : item.provider;
          return '<div class="provider-row"><div class="provider-row-head"><div><div class="provider-name">' + escapeHtml(item.provider || 'unknown') + '</div><div class="provider-meta">' + escapeHtml(labelText) + ' - ' + number(slots) + ' ' + plural(slots, 'slot') + ' - ' + number(calls) + ' recent ' + plural(calls, 'call') + '</div></div></div><div class="provider-meta">' + number(slots) + ' ready - 0 needs review - last ' + escapeHtml(relativeTime(item.lastActivity)) + '</div></div>';
        }).join('') : '<div class="empty">No provider slots or runtime activity are visible yet.</div>';
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
          items.push({ title: 'Tokens missing key coverage', detail: number(withoutSlots) + ' ' + plural(withoutSlots, 'token') + (withoutSlots === 1 ? ' is' : ' are') + ' not mapped to an active provider slot.', area: 'API Inventory', tone: 'warn' });
        }
        if (totalSlots > 0 && rawNumber(traffic.totalCalls || overview.totalCalls) === 0) {
          items.push({ title: 'No protected runtime traffic yet', detail: 'Provider slots exist, but no workflow has sent traffic through VaultProof in this window.', area: 'Rollout', tone: 'warn' });
        }
        var list = byId('attentionList');
        if (list) {
          list.innerHTML = items.length
            ? items.slice(0, 5).map(attentionRow).join('')
            : '<div class="attention-row"><div><div class="row-title">No active attention items</div><div class="row-sub">Key readiness, token coverage, and API call results do not show dashboard-level blockers.</div></div><span class="tag good">Clear</span></div>';
        }
        text('attentionMeta', items.length ? number(items.length) + ' open' : 'clear');
      }
      function updateCallRangeButtons(days) {
        document.querySelectorAll('[data-call-range]').forEach(function(button) {
          var active = Number(button.getAttribute('data-call-range') || 180) === days;
          button.classList.toggle('active', active);
          button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
      }
      function renderDashboardAnalytics(overview, days) {
        overview = resolveDashboardOverview(overview);
        days = rawNumber(days) || 180;
        updateCallRangeButtons(days);
        var selectedWindowLabel = days >= 180 ? '6mo' : days + 'd';
        var slotSummary = overview.providerSlotSummary || {};
        var coverage = overview.projectCoverage || {};
        var traffic = overview.trafficBreakdown || {};
        var trafficTotal = rawNumber(traffic.totalCalls || overview.totalCalls);
        var trafficErrors = rawNumber(traffic.errorCalls || overview.errorCalls);
        var trafficDenied = rawNumber(traffic.deniedCalls || overview.deniedCalls);
        var trafficOtherErrors = traffic.otherErrorCalls === undefined ? Math.max(trafficErrors - trafficDenied, 0) : rawNumber(traffic.otherErrorCalls);
        var trafficOk = traffic.okCalls === undefined ? Math.max(trafficTotal - trafficErrors, 0) : rawNumber(traffic.okCalls);
        var stats = selectedTrafficStats(Array.isArray(overview.callTrend) ? overview.callTrend : [], days, {
          totalCalls: trafficTotal,
          okCalls: trafficOk,
          deniedCalls: trafficDenied,
          errorCalls: trafficErrors,
          otherErrorCalls: trafficOtherErrors,
        });
        var allowedRate = stats.total ? Math.round((stats.allowed / stats.total) * 1000) / 10 : 0;
        var blockedRate = stats.total ? Math.round((stats.denied / stats.total) * 1000) / 10 : 0;
        var errorRate = stats.total ? Math.round((stats.otherErrors / stats.total) * 1000) / 10 : 0;
        text('trendMeta', 'Selected window: ' + selectedWindowLabel);
        text('trendWindowHint', number(stats.total) + ' calls - ' + allowedRate + '% allowed - ' + number(stats.listLength) + ' daily points');
        text('callWindowTotal', number(stats.total));
        text('callWindowAllowed', number(stats.allowed));
        text('callWindowBlocked', number(stats.denied));
        text('callWindowErrors', number(stats.otherErrors));
        text('callWindowTotalSub', selectedWindowLabel + ' window');
        text('callWindowAllowedSub', allowedRate + '% pass rate');
        text('callWindowBlockedSub', blockedRate + '% of traffic');
        text('callWindowErrorsSub', errorRate + '% upstream');
        setMetricDelta('callWindowTotalDelta', percentChange(stats.previousTotal, stats.currentTotal));
        setMetricDelta('callWindowAllowedDelta', percentChange(stats.previousAllowed, stats.currentAllowed));
        setMetricDelta('callWindowBlockedDelta', percentChange(stats.previousBlocked, stats.currentBlocked), true);
        setMetricDelta('callWindowErrorsDelta', percentChange(stats.previousOtherErrors, stats.currentOtherErrors), true);
        renderTrafficOutcomeRows(stats);
        renderKeyReadinessRows(slotSummary);
        renderDashboardCoverageRows(coverage, slotSummary);
        var table = byId('trendSummaryTable');
        if (table) {
          var peak = stats.peakPoint;
          table.innerHTML =
            analyticsTableRow('Average per day', number(stats.averageCalls), 'Across the selected ' + days + 'd window') +
            analyticsTableRow('Peak day', number(peak ? peak.calls : 0), peak ? shortDateLabel(peak.day) : 'No daily trend points yet') +
            analyticsTableRow('Blocked rate', blockedRate + '%', number(stats.denied) + ' blocked requests') +
            analyticsTableRow('Error rate', errorRate + '%', number(stats.otherErrors) + ' upstream or system errors');
        }
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
        if (currentOrgId) headers['x-vaultproof-organization'] = currentOrgId;
        return headers;
      }
      async function fetchJson(path, options) {
        var res = await fetch(path, Object.assign({ credentials: 'same-origin' }, options || {}, { headers: Object.assign(authHeaders(), (options && options.headers) || {}) }));
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
        text('postureState', ready ? 'Healthy' : 'Watch');
        text('postureSub', ready ? 'runtime controls passing' : 'runtime needs review');
        setPostureTone(ready ? 'good' : 'warn', ready ? '✓' : '!');
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
          text('topOrgName', 'workspace');
          text('topBusinessName', 'NVIDIA');
          text('topBusinessAvatar', 'NV');
          return;
        }
        var businessName = org.name || 'NVIDIA';
        text('topOrgName', org.name || 'workspace');
        text('topBusinessName', businessName);
        text('topBusinessAvatar', businessInitials(businessName));
        text('orgRole', org.role || 'member');
        text('orgDetail', (org.name || 'Organization') + ' - ' + number(org.member_count) + ' members - ' + number(org.project_count) + ' tokens');
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
        var totalProjects = rawNumber(coverage.totalProjects);
        var needingAttention = rawNumber(coverage.needingAttention);
        var reviewCount = Math.max(totalSlots - liveSealed, 0);
        var alerts = Array.isArray(overview.alerts) ? overview.alerts : [];
        var criticalAlerts = alerts.filter(function(alert) { return alert.severity === 'critical'; }).length;
        var warningAlerts = alerts.filter(function(alert) { return alert.severity === 'warning' || alert.severity === 'warn'; }).length;
        var incidentCount = alerts.length || needingAttention || (trafficDenied || trafficOtherErrors ? 1 : 0);
        var postureGood = incidentCount === 0 && reviewCount === 0;
        text('postureState', postureGood ? 'Healthy' : 'Watch');
        text('postureSub', totalSlots ? percent(liveSealed, totalSlots) + '% keys ready' : 'waiting for protected keys');
        setPostureTone(postureGood ? 'good' : 'warn', postureGood ? '✓' : '!');
        text('postureScans', number(Math.max(totalProjects, totalSlots, providerUsage.length)));
        text('postureScansSub', providerUsage.length ? number(providerUsage.length) + ' provider groups mapped' : 'no provider groups yet');
        text('postureIncidents', number(incidentCount));
        text('postureIncidentsSub', criticalAlerts || warningAlerts
          ? number(criticalAlerts) + ' critical - ' + number(warningAlerts) + ' warn'
          : (incidentCount ? 'review traffic and setup' : 'no active incidents'));
        text('postureRotations', number(reviewCount));
        text('postureRotationsSub', reviewCount ? 'setup review due' : 'no pending rotations');
        renderCoverageRows('keyCoverageRows', coverage, slotSummary);
        renderMaterialRows(slotSummary);
        renderProviderUsageList('keyMapProviderList', providerUsage, totalSlots);
        renderAttentionItems(overview, totalSlots, liveSealed, coverage, traffic);
        latestDashboardOverview = overview;
        renderDashboardAnalytics(latestDashboardOverview, callTrendRangeDays);
        var review = overview.pilotReview || {};
        text('projectHealthMeta', review.headline || '');
        text('activityMeta', number((overview.recentActivity || []).length) + ' recent events');
        var operationList = byId('operationSummaryList');
        if (operationList) {
          operationList.innerHTML = alerts.length ? alerts.slice(0, 5).map(function(alert) {
            var tone = alert.severity === 'critical' ? 'bad' : alert.severity === 'warning' ? 'warn' : 'good';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(alert.title || 'Attention signal') + '</div><div class="row-sub">' + escapeHtml(alert.detail || '') + '</div></div><span class="tag ' + tone + '">' + escapeHtml(alert.severity || 'info') + '</span></div>';
          }).join('') : '<div class="row"><div><div class="row-title">No active attention signals</div><div class="row-sub">Provider slots, traffic, and token health do not show dashboard-level blockers.</div></div><span class="tag good">clear</span></div>';
        }
        var projects = Array.isArray(overview.projectHealth) ? overview.projectHealth : [];
        var projectList = byId('projectHealthList');
        if (projectList) {
          projectList.innerHTML = projects.length ? projects.slice(0, 6).map(function(project) {
            var status = project.denied || project.errors ? 'watch' : project.calls ? 'healthy' : 'setup';
            return '<div class="row"><div><div class="row-title">' + escapeHtml(project.name || project.vp_proj_id || project.project_id) + '</div><div class="row-sub">' + number(project.calls) + ' calls - ' + number(project.errors) + ' errors - last ' + escapeHtml(relativeTime(project.lastActivity)) + '</div></div><span class="tag">' + status + '</span></div>';
          }).join('') : '<div class="empty">No token health data yet.</div>';
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
            loadPanel(sequence, 'token stats', fetchJson('/api/v1/enterprise/projects/stats/overview'), renderOverview, panelFailures),
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
          setNotice(error && error.message ? friendlyErrorMessage(error.message) : 'Dashboard failed to load.');
        }
      }
      document.querySelectorAll('[data-dashboard-tab]').forEach(function(button) {
        button.addEventListener('click', function() {
          selectDashboardTab(button.getAttribute('data-dashboard-tab') || 'overview');
        });
      });
      document.querySelectorAll('[data-call-range]').forEach(function(button) {
        button.addEventListener('click', function() {
          callTrendRangeDays = rawNumber(button.getAttribute('data-call-range')) || 180;
          renderDashboardAnalytics(latestDashboardOverview, callTrendRangeDays);
        });
      });
      selectDashboardTab('overview');
      loadDashboard();
    })();
  </script>
</body>
</html>`, env, 'dashboard');
}
