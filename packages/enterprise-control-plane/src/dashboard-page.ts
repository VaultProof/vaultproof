import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';
import { ENTERPRISE_APP_SHELL_THEME, renderEnterpriseAppSidebar } from './enterprise-app-shell.js';

const ENTERPRISE_AUTH_ERROR_MESSAGE = 'Your enterprise session expired or is missing. Sign in again to continue.';

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
      --bg: #f6f7f2;
      --panel: rgba(255, 255, 255, 0.76);
      --panel-strong: rgba(255, 255, 255, 0.96);
      --line: rgba(32, 48, 39, 0.14);
      --text: #17231d;
      --muted: #52625a;
      --soft: #7d8c84;
      --gold: #176b4b;
      --green: #176b4b;
      --red: #b95d50;
      --blue: #168a9f;
      --ink: #ffffff;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-weight: 400;
      color: var(--text);
      background: #f6f7f2;
    }
    a { color: inherit; text-decoration: none; }
    ${ENTERPRISE_APP_SHELL_THEME}
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
      background: #ffffff;
      border: 1px solid var(--line);
      border-radius: 24px;
      padding: 20px;
      box-shadow: var(--shadow);
    }
    .dashboard-head-card,
    .control-center-card {
      border: 1px solid var(--line);
      background: #fbfcf8;
      border-radius: 20px;
      padding: 20px;
    }
    .dashboard-head-card {
      margin-bottom: 16px;
    }
    .control-center-card {
      background: #ffffff;
    }
    .topbar {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
      margin-bottom: 18px;
    }
    .eyebrow {
      display: inline-flex;
      color: var(--green);
      background: rgba(23, 107, 75, 0.10);
      border: 1px solid rgba(23, 107, 75, 0.18);
      border-radius: 999px;
      padding: 6px 9px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-weight: 600;
    }
    h1 { font-size: 1.875rem; font-weight: 600; letter-spacing: 0; line-height: 2.25rem; margin: 12px 0 12px; max-width: 760px; }
    @media (min-width: 640px) {
      h1 { font-size: 2.6rem; }
    }
    .lead { color: var(--muted); max-width: 760px; font-size: 14px; line-height: 1.75; }
    @media (min-width: 640px) {
      .lead { font-size: 16px; }
    }
    .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    select, button {
      border: 1px solid var(--line);
      background: var(--control-bg);
      color: var(--text);
      border-radius: 13px;
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
    .dashboard-context-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }
    .context-card {
      display: block;
      border: 1px solid var(--line-soft);
      background: #ffffff;
      border-radius: 16px;
      padding: 14px;
      min-height: 116px;
    }
    .context-label {
      color: var(--green);
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
      color: #5f6f67;
      font-size: 13px;
      line-height: 1.5;
      margin-top: 6px;
    }
    .control-center-intro {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 18px;
      margin-bottom: 14px;
    }
    .control-title {
      font-size: 22px;
      font-weight: 600;
      letter-spacing: 0;
      margin: 0;
    }
    .control-copy {
      color: #5f6f67;
      margin: 6px 0 0;
      max-width: 700px;
      line-height: 1.5;
      font-size: 14px;
    }
    .control-links {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
      flex: 0 0 auto;
    }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr); }
    .card {
      border: 1px solid var(--line);
      background: var(--card-bg);
      border-radius: 24px;
      padding: 20px;
      box-shadow: var(--shadow);
    }
    .kpi-label { color: var(--soft); font-size: 12px; font-weight: 400; text-transform: uppercase; letter-spacing: 0; }
    .kpi-value { font-size: 34px; font-weight: 600; letter-spacing: 0; margin-top: 8px; }
    .kpi-sub { color: #5f6f67; margin-top: 6px; font-size: 13px; }
    .status-pill {
      display: inline-flex; align-items: center; gap: 8px;
      border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 600;
      background: rgba(62, 93, 87, 0.09); color: var(--green); border: 1px solid rgba(62, 93, 87, 0.22);
    }
    .status-pill.warn { background: rgba(213, 169, 20, 0.13); color: #94730a; border-color: rgba(213, 169, 20, 0.32); }
    .status-pill.bad { background: rgba(185, 93, 80, 0.12); color: var(--red); border-color: rgba(185, 93, 80, 0.28); }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: 0; }
    .section-title p { margin: 4px 0 0; color: #5f6f67; font-size: 13px; line-height: 1.45; }
    .mini { color: #5f6f67; font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .business-card h2, .intent-card h3, .action-card h3 { margin: 0; letter-spacing: 0; }
    .business-card p, .intent-card p, .action-card p { margin: 8px 0 0; color: #5f6f67; line-height: 1.5; font-size: 13px; }
    .tabbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 8px;
      margin-bottom: 18px;
      background: var(--row-bg);
    }
    .tab-button {
      border-radius: 12px;
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
      border-radius: 20px;
      padding: 16px;
      background: var(--row-bg);
    }
    .action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .action-card { display: flex; flex-direction: column; gap: 10px; min-height: 176px; }
    .action-card .action { margin-top: auto; align-self: flex-start; }
    .row {
      display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center;
      border: 1px solid var(--line-soft);
      border-radius: 17px; padding: 13px;
      background: var(--row-bg);
    }
    .row-title { font-weight: 600; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(22, 138, 159, 0.24); border-radius: 999px; padding: 5px 8px; }
    .tag.good { color: var(--green); border-color: rgba(62, 93, 87, 0.24); }
    .tag.warn { color: #94730a; border-color: rgba(213, 169, 20, 0.32); }
    .tag.bad { color: var(--red); border-color: rgba(185, 93, 80, 0.28); }
    .empty, .error {
      color: var(--muted);
      border: 1px dashed var(--line);
      border-radius: 18px;
      padding: 18px;
      background: var(--row-bg);
    }
    .error { color: var(--red); border-color: rgba(185, 93, 80, 0.3); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .action { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; color: var(--action-text); background: var(--control-bg); }
    .action.primary { color: var(--primary-text, var(--text)); }
    .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
    .feature-card {
      display: flex; flex-direction: column; gap: 10px;
      min-height: 170px; border: 1px solid var(--line-soft);
      border-radius: 22px; padding: 16px;
      background: var(--card-bg);
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .feature-card:hover { transform: translateY(-2px); border-color: rgba(23, 107, 75, 0.28); background: #f7faf4; }
    .feature-card h3 { margin: 0; font-size: 16px; line-height: 1.15; letter-spacing: 0; }
    .feature-card p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; flex: 1; }
    .feature-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .feature-tag { color: var(--green); border: 1px solid rgba(62, 93, 87, 0.22); border-radius: 999px; padding: 4px 7px; font-size: 11px; }
    .feature-tag.pending { color: #94730a; border-color: rgba(213, 169, 20, 0.32); }
    @media (max-width: 980px) {
      .topbar { flex-direction: column; }
      .toolbar { justify-content: flex-start; }
      .dashboard-context-grid, .kpis, .two, .feature-grid, .intent-grid, .action-grid { grid-template-columns: 1fr; }
      .control-center-intro { flex-direction: column; }
      .control-links { justify-content: flex-start; }
    }
    @media (min-width: 981px) and (max-width: 1220px) {
      .feature-grid, .intent-grid, .action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
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
            <div>
              <div class="eyebrow">Enterprise dashboard</div>
              <h1>Runtime, access, and evidence.</h1>
              <p class="lead">Monitor the live enterprise account and jump into the pages your team needs.</p>
            </div>
            <div class="toolbar">
              <button id="refreshBtn" type="button">refresh</button>
              <a class="action primary" href="/app/control">open control</a>
            </div>
          </div>

          <div class="dashboard-context-grid" aria-label="Control center orientation">
            <a class="context-card" href="/app/dashboard">
              <div class="context-label">You are here</div>
              <div class="context-title">Control center</div>
              <div class="context-copy">A single operational view for runtime posture, users, evidence, and launch actions.</div>
            </a>
            <a class="context-card" href="/app/org">
              <div class="context-label">Active org</div>
              <div class="context-title">Provisioned workspace</div>
              <div class="context-copy">VaultProof sets up the organization workspace; operators review status and SSO here.</div>
            </a>
            <a class="context-card" href="/readiness" target="_blank" rel="noopener">
              <div class="context-label">Next best step</div>
              <div class="context-title">Confirm readiness</div>
              <div class="context-copy">Check runtime, access, provider policy, and evidence before expanding rollout.</div>
            </a>
          </div>
        </section>

      <div id="authNotice" class="error" style="display:none"></div>

        <section class="control-center-card" aria-label="Enterprise control center">
          <div class="control-center-intro">
            <div>
              <h2 class="control-title">Control center</h2>
              <p class="control-copy">Use the tabs below for daily operator checks. The sidebar keeps every enterprise page and evidence export in reach.</p>
            </div>
            <div class="control-links" aria-label="Primary operator links">
              <a class="action" href="/app/members">members</a>
              <a class="action" href="/app/audit">audit</a>
              <a class="action" href="/app/evidence">evidence</a>
              <a class="action" href="/app/release">release</a>
              <a class="action" href="/app/testers">testers</a>
              <a class="action" href="/app/runbooks">runbooks</a>
            </div>
          </div>

          <nav class="tabbar" aria-label="Enterprise dashboard tabs">
            <button class="tab-button active" type="button" data-dashboard-tab="overview">Overview</button>
            <button class="tab-button" type="button" data-dashboard-tab="security">Security</button>
            <button class="tab-button" type="button" data-dashboard-tab="access">Access</button>
            <button class="tab-button" type="button" data-dashboard-tab="operations">Operations</button>
            <button class="tab-button" type="button" data-dashboard-tab="features">Workspace</button>
          </nav>

      <section id="tab-overview" class="tab-panel" data-tab-panel="overview">
        <section class="grid kpis" aria-label="Enterprise KPIs">
          <div class="card"><div class="kpi-label">production runtime</div><div id="kpiRuntime" class="kpi-value">...</div><div id="kpiRuntimeSub" class="kpi-sub">checking GCP runtime</div></div>
          <div class="card"><div class="kpi-label">projects</div><div id="kpiProjects" class="kpi-value">...</div><div id="kpiProjectsSub" class="kpi-sub">enterprise scopes</div></div>
          <div class="card"><div class="kpi-label">members</div><div id="kpiMembers" class="kpi-value">...</div><div id="kpiMembersSub" class="kpi-sub">active org access</div></div>
          <div class="card"><div class="kpi-label">30d calls</div><div id="kpiCalls" class="kpi-value">...</div><div id="kpiCallsSub" class="kpi-sub">proxy activity</div></div>
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
            <div class="actions">
              <a class="action" href="/readiness" target="_blank" rel="noopener">open readiness JSON</a>
              <a class="action" href="/health" target="_blank" rel="noopener">open health JSON</a>
            </div>
          </div>

          <div class="card">
            <div class="section-title">
              <div>
                <h2>Organization</h2>
                <p>VaultProof provisions the organization workspace; operators review role, SSO state, and controls here.</p>
              </div>
              <span id="orgRole" class="tag">...</span>
            </div>
            <div id="orgDetail" class="mini">Loading organization...</div>
            <div class="actions">
              <a class="action" href="/app/org">manage SSO</a>
              <a class="action" href="/app/control">policy control</a>
            </div>
          </div>
        </section>

        <section class="grid action-grid">
          <div class="action-card">
            <div class="feature-tags"><span class="feature-tag">daily check</span><span class="feature-tag">go live</span></div>
            <h3>1. Confirm the runtime is ready</h3>
            <p>Check this before inviting more users or routing production traffic.</p>
            <a class="action" href="/readiness" target="_blank" rel="noopener">check readiness</a>
          </div>
          <div class="action-card">
            <div class="feature-tags"><span class="feature-tag">access</span><span class="feature-tag">SSO</span></div>
            <h3>2. Review who can use it</h3>
            <p>Open Members for roles and access-review evidence, then Org + SSO for Entra setup.</p>
            <a class="action" href="/app/members">review access</a>
          </div>
          <div class="action-card">
            <div class="feature-tags"><span class="feature-tag">policy</span><span class="feature-tag">keys</span></div>
            <h3>3. Lock down projects</h3>
            <p>Review provider slots, caller-lock rules, allowed origins, and emergency revoke controls.</p>
            <a class="action" href="/app/control">open policy control</a>
          </div>
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
            <div class="section-title"><h2>Evidence links</h2><span class="mini">safe to open</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Production readiness</div><div class="row-sub">Proof that the live runtime and executor report production-ready.</div></div><a class="tag good" href="/readiness" target="_blank" rel="noopener">open</a></div>
              <div class="row"><div><div class="row-title">Release evidence</div><div class="row-sub">Customer-safe proof of build tag, approval, verification, rollout state, and rollback path.</div></div><a class="tag good" href="/app/release">open</a></div>
              <div class="row"><div><div class="row-title">Pilot testers</div><div class="row-sub">Browser-local roster, login readiness, scenario assignment, feedback, and blockers for paid-user sessions.</div></div><a class="tag good" href="/app/testers">open</a></div>
              <div class="row"><div><div class="row-title">Audit export</div><div class="row-sub">CSV evidence for governance and runtime events.</div></div><a class="tag good" href="/api/v1/enterprise/audit?format=csv&days=30">export</a></div>
              <div class="row"><div><div class="row-title">Access review</div><div class="row-sub">CSV evidence for members, roles, and project access.</div></div><a class="tag good" href="/api/v1/enterprise/members/access-review?format=csv">export</a></div>
            </div>
          </div>
          <div class="card">
            <div class="section-title"><h2>Security controls</h2><span class="mini">where to work</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Caller lock and provider policy</div><div class="row-sub">Limit execution by origin, gateway, device, provider, method, host, path, and rate.</div></div><a class="tag" href="/app/control">control</a></div>
              <div class="row"><div><div class="row-title">Provider slots</div><div class="row-sub">View active provider keys and emergency-revoke a slot.</div></div><a class="tag" href="/app/keys">keys</a></div>
              <div class="row"><div><div class="row-title">Operator runbooks</div><div class="row-sub">Verification, evidence, deploys, secret rotation, DNS, edge, SSH, and cleanup.</div></div><a class="tag" href="/app/runbooks">runbooks</a></div>
            </div>
          </div>
        </section>
      </section>

      <section id="tab-access" class="tab-panel" data-tab-panel="access" hidden>
        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Access and alerts</h2><span id="accessMeta" class="mini"></span></div>
            <div id="accessList" class="list"><div class="empty">Loading access...</div></div>
            <div class="actions">
              <a class="action" href="/app/members">open members</a>
              <a class="action" href="/app/alerts">open alerts</a>
              <a class="action" href="/app/org">open Org + SSO</a>
            </div>
          </div>
          <div class="card">
            <div class="section-title"><h2>Setup access checklist</h2><span class="mini">before rollout</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">SSO path</div><div class="row-sub">Use Entra ID through Supabase SAML broker/session provider for customer-facing SSO.</div></div><span class="tag">Org + SSO</span></div>
              <div class="row"><div><div class="row-title">Admin review</div><div class="row-sub">Confirm owners/admins are the right people before onboarding a business team.</div></div><span class="tag">Members</span></div>
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
            <div class="section-title"><h2>Recent audit</h2><a class="mini" href="/api/v1/enterprise/audit?format=csv&days=30">export CSV</a></div>
            <div id="auditList" class="list"><div class="empty">Loading audit...</div></div>
          </div>

          <div class="card">
            <div class="section-title"><h2>Operator shortcuts</h2><span class="mini">business-safe links</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Runbooks</div><div class="row-sub">Open the built deploy, evidence, verification, hardening, and cleanup playbooks.</div></div><a class="tag good" href="/app/runbooks">open</a></div>
              <div class="row"><div><div class="row-title">Demo script</div><div class="row-sub">Run the buyer walkthrough with proof path, guardrails, Q&A, and close steps.</div></div><a class="tag good" href="/app/demo">open</a></div>
              <div class="row"><div><div class="row-title">Evidence packet</div><div class="row-sub">Assemble runtime readiness, access review, audit, provider posture, and launch proof for customer security review.</div></div><a class="tag good" href="/app/evidence">open</a></div>
              <div class="row"><div><div class="row-title">Release evidence</div><div class="row-sub">Record build tag, approval, verification, rollout state, and rollback path after each enterprise deploy.</div></div><a class="tag good" href="/app/release">open</a></div>
              <div class="row"><div><div class="row-title">Pilot testers</div><div class="row-sub">Prepare tester roster, login status, scenarios, feedback, and blockers for paid-user review sessions.</div></div><a class="tag good" href="/app/testers">open</a></div>
              <div class="row"><div><div class="row-title">Rollout Manager</div><div class="row-sub">Plan one workload cutover with owners, canary, rollback, blockers, and evidence export.</div></div><a class="tag good" href="/app/rollout">open</a></div>
              <div class="row"><div><div class="row-title">Technical guide</div><div class="row-sub">Open the enterprise implementation reference for identity, network, key custody, attestation, and troubleshooting.</div></div><a class="tag good" href="/app/technical-guide">open</a></div>
              <div class="row"><div><div class="row-title">Launch plans</div><div class="row-sub">Track packaging, GCP edge readiness, and contract-facing guardrails.</div></div><a class="tag" href="/app/plans">open</a></div>
              <div class="row"><div><div class="row-title">AI Proof Verifier</div><div class="row-sub">Register external models and verify proof bundles without VaultProof running the model.</div></div><a class="tag warn" href="/app/verifier">beta</a></div>
              <div class="row"><div><div class="row-title">Scanner</div><div class="row-sub">Record redacted repo exposure findings, owners, rotation status, and evidence for customer review.</div></div><a class="tag good" href="/app/scanner">open</a></div>
            </div>
          </div>
        </section>
      </section>

      <section id="tab-features" class="tab-panel" data-tab-panel="features" hidden>
        <section class="card" aria-label="Enterprise workspace tools">
          <div class="section-title">
            <div>
              <h2>Workspace tools</h2>
              <p>Use these pages to configure the account, monitor usage, export evidence, and run operator checks.</p>
            </div>
            <span class="mini">operational links</span>
          </div>
          <div class="feature-grid">
            <a class="feature-card" href="/app/setup">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">start here</span></div>
              <h3>Setup guide</h3>
              <p>Enterprise implementation guide for mapping environments, connecting SSO, choosing gateways, configuring projects, protecting provider slots, and going live safely.</p>
            </a>
            <a class="feature-card" href="/app/demo">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">demo</span></div>
              <h3>Demo script</h3>
              <p>Buyer walkthrough with live workspace facts, proof path, safety guardrails, common objections, paid-pilot close steps, and a copyable talk track.</p>
            </a>
            <a class="feature-card" href="/app/evidence">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">proof</span></div>
              <h3>Evidence packet</h3>
              <p>Customer proof packet with readiness, access review, audit export links, provider posture, rollout workflow, and downloadable JSON summary.</p>
            </a>
            <a class="feature-card" href="/app/release">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">change proof</span></div>
              <h3>Release evidence</h3>
              <p>Record the active build/image tag, approval, verification result, rollout state, rollback path, and customer-safe release notes after each deploy.</p>
            </a>
            <a class="feature-card" href="/app/testers">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">paid pilot</span></div>
              <h3>Pilot testers</h3>
              <p>Prepare paid-user tester roster, login readiness, scenario assignments, customer-safe feedback, blockers, and a copyable JSON packet before guided sessions.</p>
            </a>
            <a class="feature-card" href="/app/rollout">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">cutover</span></div>
              <h3>Rollout Manager</h3>
              <p>Move one workload into VaultProof with owners, integration mode, canary percentage, rollback path, blockers, copy-safe snippets, and evidence export.</p>
            </a>
            <a class="feature-card" href="/app/technical-guide">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">technical</span></div>
              <h3>Technical guide</h3>
              <p>Detailed enterprise reference for identity, GCP/network patterns, caller lock, key custody, attestation, evidence, rollout, and troubleshooting.</p>
            </a>
            <a class="feature-card" href="/readiness" target="_blank" rel="noopener">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">proof</span></div>
              <h3>Production readiness</h3>
              <p>Current production gate for runtime, executor, attestation, and Cloud KMS posture.</p>
            </a>
            <a class="feature-card" href="/health" target="_blank" rel="noopener">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">health</span></div>
              <h3>Control-plane health</h3>
              <p>Lightweight status endpoint for GCP edge, monitoring, runtime checks, and operators.</p>
            </a>
            <a class="feature-card" href="/app/control">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">policy</span></div>
              <h3>Policy control</h3>
              <p>Edit project policy, provider allowlists, caller-lock rules, rate limits, and secure execution settings.</p>
            </a>
            <a class="feature-card" href="/app/verifier">
              <div class="feature-tags"><span class="feature-tag">visible</span><span class="feature-tag pending">verifier beta</span></div>
              <h3>AI Proof Verifier</h3>
              <p>Register models that run outside VaultProof, verify submitted proof bundles, store evidence, and bind results to project policy, audit, and runtime posture.</p>
            </a>
            <a class="feature-card" href="/app/projects">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">inventory</span></div>
              <h3>Project inventory</h3>
              <p>Review project health, provider slot posture, policy status, and quick paths into Control.</p>
            </a>
            <a class="feature-card" href="/app/keys">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">secrets</span></div>
              <h3>Provider slots</h3>
              <p>View active providers, email API key demo slots, emergency revoke controls, rotation checklists, and Cloud KMS notes.</p>
            </a>
            <a class="feature-card" href="/app/activity">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">runtime</span></div>
              <h3>Runtime activity</h3>
              <p>See proxy and executor events, status codes, latency, provider request IDs, and attestation summaries.</p>
            </a>
            <a class="feature-card" href="/app/members">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">access</span></div>
              <h3>Members and invites</h3>
              <p>Manage members, pending invites, roles, project assignments, and access-review exports.</p>
            </a>
            <a class="feature-card" href="/app/audit">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">evidence</span></div>
              <h3>Audit and exports</h3>
              <p>Search governance/runtime events, export CSV evidence, and review customer-verifiable metadata.</p>
            </a>
            <a class="feature-card" href="/app/alerts">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">monitoring</span></div>
              <h3>Alerts</h3>
              <p>Manage alert destinations, delivery logs, dispatch runs, policy state, and admin test-send workflow.</p>
            </a>
            <a class="feature-card" href="/app/org">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">SSO</span></div>
              <h3>Org and Entra SSO</h3>
              <p>Configure organization settings and the Microsoft Entra ID SSO path through Supabase SAML.</p>
            </a>
            <a class="feature-card" href="/app/settings">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">tenant</span></div>
              <h3>Tenant settings</h3>
              <p>Review tenant defaults, organization identity, SSO state, and session/security notices.</p>
            </a>
            <a class="feature-card" href="/app/plans">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag pending">cutover pending</span></div>
              <h3>Launch plans</h3>
              <p>Track GCP edge status, launch readiness, limits, and handoff notes.</p>
            </a>
            <a class="feature-card" href="/app/scanner">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">exposure</span></div>
              <h3>Scanner exposure intake</h3>
              <p>Record metadata-only repository exposure findings, redacted evidence references, owners, rotation state, and remediation status without uploading secrets.</p>
            </a>
            <a class="feature-card" href="/app/runbooks">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">ops</span></div>
              <h3>Operator runbooks</h3>
              <p>Verification, evidence, deploy, secret rotation, DNS, edge, SSH, and cleanup commands.</p>
            </a>
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
        text('kpiRuntimeSub', ready ? (sharedDemo ? 'shared demo runtime' : 'GCP confidential production') : 'needs review');
        var pill = byId('runtimePill');
        if (pill) {
          pill.textContent = ready ? (sharedDemo ? 'shared demo ready' : 'production ready') : 'not production ready';
          pill.className = 'status-pill ' + (ready ? '' : 'bad');
        }
        var blockers = Array.isArray(payload && payload.production_blockers) ? payload.production_blockers : [];
        text('runtimeDetail', ready
          ? (sharedDemo
            ? 'Shared enterprise demo runtime is confidential-ready. It is safe for demos, but it is not a dedicated customer production runtime.'
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
        overview = overview || {};
        text('kpiProjects', number(overview.totalProjects));
        text('kpiProjectsSub', number(overview.totalKeys) + ' active key slots');
        text('kpiCalls', number(overview.totalCalls));
        text('kpiCallsSub', number(overview.deniedCalls) + ' denied / ' + number(overview.errorCalls) + ' errors');
        var review = overview.pilotReview || {};
        text('projectHealthMeta', review.headline || '');
        text('activityMeta', number((overview.recentActivity || []).length) + ' recent events');
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
      selectDashboardTab('overview');
      loadDashboard();
    })();
  </script>
</body>
</html>`, env, 'dashboard');
}
