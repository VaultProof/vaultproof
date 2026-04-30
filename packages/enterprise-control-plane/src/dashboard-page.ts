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
      color-scheme: dark;
      --bg: #07110f;
      --panel: rgba(237, 229, 204, 0.08);
      --panel-strong: rgba(237, 229, 204, 0.14);
      --line: rgba(237, 229, 204, 0.16);
      --text: #f4ecd5;
      --muted: #a9b7a6;
      --gold: #d7a84b;
      --green: #6ee7b7;
      --red: #fb7185;
      --blue: #93c5fd;
      --ink: #07110f;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 15% 10%, rgba(215, 168, 75, 0.24), transparent 32rem),
        radial-gradient(circle at 85% 0%, rgba(110, 231, 183, 0.16), transparent 28rem),
        linear-gradient(135deg, #06100e 0%, #10231d 45%, #050807 100%);
    }
    a { color: inherit; text-decoration: none; }
    ${ENTERPRISE_APP_SHELL_THEME}
    .main { padding: 30px; max-width: 1320px; width: 100%; }
    .topbar {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 20px;
      margin-bottom: 26px;
    }
    .eyebrow { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: 0.16em; font-weight: 800; }
    h1 { font-size: clamp(34px, 5vw, 66px); letter-spacing: -0.07em; line-height: 0.92; margin: 8px 0 12px; max-width: 760px; }
    .lead { color: var(--muted); max-width: 760px; font-size: 16px; line-height: 1.6; }
    .toolbar { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
    select, button {
      border: 1px solid var(--line);
      background: rgba(237, 229, 204, 0.08);
      color: var(--text);
      border-radius: 13px;
      padding: 11px 12px;
      font: inherit;
    }
    option { color: #111827; }
    button { cursor: pointer; }
    .primary {
      background: linear-gradient(135deg, var(--gold), #f3df95);
      color: var(--ink);
      border: 0;
      font-weight: 800;
    }
    .grid { display: grid; gap: 16px; }
    .kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); margin-bottom: 16px; }
    .two { grid-template-columns: minmax(0, 1.15fr) minmax(340px, 0.85fr); }
    .business-strip { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 16px; }
    .card {
      border: 1px solid var(--line);
      background: linear-gradient(180deg, var(--panel-strong), rgba(237, 229, 204, 0.055));
      border-radius: 24px;
      padding: 20px;
      box-shadow: 0 22px 90px rgba(0, 0, 0, 0.2);
    }
    .kpi-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.1em; }
    .kpi-value { font-size: 34px; font-weight: 850; letter-spacing: -0.05em; margin-top: 8px; }
    .kpi-sub { color: var(--muted); margin-top: 6px; font-size: 13px; }
    .status-pill {
      display: inline-flex; align-items: center; gap: 8px;
      border-radius: 999px; padding: 7px 10px; font-size: 12px; font-weight: 800;
      background: rgba(110, 231, 183, 0.1); color: var(--green); border: 1px solid rgba(110, 231, 183, 0.24);
    }
    .status-pill.warn { background: rgba(215, 168, 75, 0.1); color: var(--gold); border-color: rgba(215, 168, 75, 0.28); }
    .status-pill.bad { background: rgba(251, 113, 133, 0.12); color: var(--red); border-color: rgba(251, 113, 133, 0.28); }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: center; margin-bottom: 14px; }
    .section-title h2 { margin: 0; font-size: 19px; letter-spacing: -0.03em; }
    .section-title p { margin: 4px 0 0; color: var(--muted); font-size: 13px; line-height: 1.45; }
    .mini { color: var(--muted); font-size: 13px; }
    .list { display: grid; gap: 10px; }
    .business-card h2, .intent-card h3, .action-card h3 { margin: 0; letter-spacing: -0.03em; }
    .business-card p, .intent-card p, .action-card p { margin: 8px 0 0; color: var(--muted); line-height: 1.5; font-size: 13px; }
    .tabbar {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 8px;
      margin-bottom: 16px;
      background: rgba(3, 8, 7, 0.28);
    }
    .tab-button {
      border-radius: 12px;
      padding: 10px 12px;
      color: #d8dfcf;
      background: transparent;
      border-color: transparent;
    }
    .tab-button.active {
      background: linear-gradient(135deg, var(--gold), #f3df95);
      color: var(--ink);
      border-color: transparent;
      font-weight: 850;
    }
    .tab-panel { display: grid; gap: 16px; }
    .tab-panel[hidden] { display: none; }
    .intent-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .intent-card, .action-card {
      border: 1px solid rgba(237, 229, 204, 0.12);
      border-radius: 20px;
      padding: 16px;
      background: rgba(3, 8, 7, 0.25);
    }
    .action-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .action-card { display: flex; flex-direction: column; gap: 10px; min-height: 176px; }
    .action-card .action { margin-top: auto; align-self: flex-start; }
    .row {
      display: grid; grid-template-columns: 1fr auto; gap: 14px; align-items: center;
      border: 1px solid rgba(237, 229, 204, 0.1);
      border-radius: 17px; padding: 13px;
      background: rgba(3, 8, 7, 0.28);
    }
    .row-title { font-weight: 750; }
    .row-sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
    .tag { color: var(--blue); font-size: 12px; border: 1px solid rgba(147, 197, 253, 0.24); border-radius: 999px; padding: 5px 8px; }
    .tag.good { color: var(--green); border-color: rgba(110, 231, 183, 0.24); }
    .tag.warn { color: var(--gold); border-color: rgba(215, 168, 75, 0.28); }
    .tag.bad { color: var(--red); border-color: rgba(251, 113, 133, 0.28); }
    .empty, .error {
      color: var(--muted);
      border: 1px dashed rgba(237, 229, 204, 0.22);
      border-radius: 18px;
      padding: 18px;
      background: rgba(3, 8, 7, 0.2);
    }
    .error { color: var(--red); border-color: rgba(251, 113, 133, 0.3); }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .action { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; color: #e8ddbf; background: rgba(237, 229, 204, 0.07); }
    .action.primary { color: var(--ink); }
    .feature-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
    .feature-card {
      display: flex; flex-direction: column; gap: 10px;
      min-height: 170px; border: 1px solid rgba(237, 229, 204, 0.12);
      border-radius: 22px; padding: 16px;
      background: linear-gradient(180deg, rgba(237, 229, 204, 0.105), rgba(3, 8, 7, 0.25));
      transition: transform 160ms ease, border-color 160ms ease, background 160ms ease;
    }
    .feature-card:hover { transform: translateY(-2px); border-color: rgba(215, 168, 75, 0.38); background: linear-gradient(180deg, rgba(215, 168, 75, 0.12), rgba(3, 8, 7, 0.26)); }
    .feature-card h3 { margin: 0; font-size: 16px; line-height: 1.15; letter-spacing: -0.03em; }
    .feature-card p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; flex: 1; }
    .feature-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .feature-tag { color: var(--green); border: 1px solid rgba(110, 231, 183, 0.22); border-radius: 999px; padding: 4px 7px; font-size: 11px; }
    .feature-tag.pending { color: var(--gold); border-color: rgba(215, 168, 75, 0.28); }
    @media (max-width: 980px) {
      .topbar { flex-direction: column; }
      .toolbar { justify-content: flex-start; }
      .kpis, .two, .feature-grid, .business-strip, .intent-grid, .action-grid { grid-template-columns: 1fr; }
    }
    @media (min-width: 981px) and (max-width: 1220px) {
      .feature-grid, .intent-grid, .action-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="shell">
    ${renderEnterpriseAppSidebar('dashboard')}

    <main class="main">
      <div class="topbar">
        <div>
          <div class="eyebrow">Customer workspace</div>
          <h1>Set up and run your business account.</h1>
          <p class="lead">Use this dashboard to finish onboarding, connect SSO, invite teammates, configure projects, review provider slots, and confirm the production runtime is ready before traffic goes live.</p>
        </div>
        <div class="toolbar">
          <select id="orgSelect" aria-label="Organization"><option>Loading org...</option></select>
          <button id="refreshBtn" type="button">refresh</button>
          <a class="action primary" href="/app/control">open control</a>
        </div>
      </div>

      <div id="authNotice" class="error" style="display:none"></div>

      <section class="grid business-strip" aria-label="Business dashboard summary">
        <div class="card business-card">
          <div class="kpi-label">Step 1</div>
          <h2>Connect the organization.</h2>
          <p>Pick the active business org, confirm owners/admins, invite teammates, and set up Entra SSO before broader rollout.</p>
        </div>
        <div class="card business-card">
          <div class="kpi-label">Step 2</div>
          <h2>Configure projects.</h2>
          <p>Add provider slots, choose allowed providers, set caller-lock rules, and confirm each project has the right owners.</p>
        </div>
        <div class="card business-card">
          <div class="kpi-label">Step 3</div>
          <h2>Go live safely.</h2>
          <p>Check readiness, export audit/access evidence, turn on alerts, and use Runbooks for final TLS, APIM, SSH, and cleanup steps.</p>
        </div>
      </section>

      <nav class="tabbar" aria-label="Enterprise dashboard tabs">
        <button class="tab-button active" type="button" data-dashboard-tab="overview">Overview</button>
        <button class="tab-button" type="button" data-dashboard-tab="security">Security</button>
        <button class="tab-button" type="button" data-dashboard-tab="access">Access</button>
        <button class="tab-button" type="button" data-dashboard-tab="operations">Operations</button>
        <button class="tab-button" type="button" data-dashboard-tab="features">Setup Map</button>
      </nav>

      <section id="tab-overview" class="tab-panel" data-tab-panel="overview">
        <section class="grid kpis" aria-label="Enterprise KPIs">
          <div class="card"><div class="kpi-label">production runtime</div><div id="kpiRuntime" class="kpi-value">...</div><div id="kpiRuntimeSub" class="kpi-sub">checking Front Door to CVM</div></div>
          <div class="card"><div class="kpi-label">projects</div><div id="kpiProjects" class="kpi-value">...</div><div id="kpiProjectsSub" class="kpi-sub">enterprise scopes</div></div>
          <div class="card"><div class="kpi-label">members</div><div id="kpiMembers" class="kpi-value">...</div><div id="kpiMembersSub" class="kpi-sub">active org access</div></div>
          <div class="card"><div class="kpi-label">30d calls</div><div id="kpiCalls" class="kpi-value">...</div><div id="kpiCallsSub" class="kpi-sub">proxy activity</div></div>
        </section>

        <section class="grid two">
          <div class="card">
            <div class="section-title">
              <div>
                <h2>Confidential runtime posture</h2>
                <p>The simple answer to: is the secure key path safe to use today?</p>
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
                <p>Current tenant, role, SSO state, and setup links.</p>
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
            <div class="feature-tags"><span class="feature-tag">business</span><span class="feature-tag">daily</span></div>
            <h3>1. Confirm the runtime is ready</h3>
            <p>Use the readiness badge before onboarding more users or sending production traffic.</p>
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
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag">ready</span></div><h3>Confidential VM</h3><p>Control plane and executor run on Azure confidential infrastructure.</p></div>
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag">ready</span></div><h3>Secure Key Release</h3><p>The executor gets unwrap material only after attestation and policy checks.</p></div>
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag">ready</span></div><h3>Replay protection</h3><p>Signed execution envelopes cannot be reused after the first valid request.</p></div>
          <div class="intent-card"><div class="feature-tags"><span class="feature-tag pending">finish line</span></div><h3>TLS and APIM cutovers</h3><p>Operator runbooks track the final origin TLS, APIM, SSH, and cleanup steps.</p></div>
        </section>

        <section class="grid two">
          <div class="card">
            <div class="section-title"><h2>Evidence links</h2><span class="mini">safe to open</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Production readiness</div><div class="row-sub">Proof that the live runtime and executor report production-ready.</div></div><a class="tag good" href="/readiness" target="_blank" rel="noopener">open</a></div>
              <div class="row"><div><div class="row-title">Audit export</div><div class="row-sub">CSV evidence for governance and runtime events.</div></div><a class="tag good" href="/api/v1/enterprise/audit?format=csv&days=30">export</a></div>
              <div class="row"><div><div class="row-title">Access review</div><div class="row-sub">CSV evidence for members, roles, and project access.</div></div><a class="tag good" href="/api/v1/enterprise/members/access-review?format=csv">export</a></div>
            </div>
          </div>
          <div class="card">
            <div class="section-title"><h2>Security controls</h2><span class="mini">where to work</span></div>
            <div class="list">
              <div class="row"><div><div class="row-title">Caller lock and provider policy</div><div class="row-sub">Limit execution by origin, gateway, device, provider, method, host, path, and rate.</div></div><a class="tag" href="/app/control">control</a></div>
              <div class="row"><div><div class="row-title">Provider slots</div><div class="row-sub">View active provider keys and emergency-revoke a slot.</div></div><a class="tag" href="/app/keys">keys</a></div>
              <div class="row"><div><div class="row-title">Operator runbooks</div><div class="row-sub">Verification, evidence, deploys, secret rotation, TLS, APIM, SSH, and cleanup.</div></div><a class="tag" href="/app/runbooks">runbooks</a></div>
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
              <div class="row"><div><div class="row-title">Plans and APIM</div><div class="row-sub">Track packaging, APIM sidecar readiness, and contract-facing guardrails.</div></div><a class="tag" href="/app/plans">open</a></div>
              <div class="row"><div><div class="row-title">Scanner</div><div class="row-sub">Future enterprise-safe security scanning entry point, kept separate from B2C.</div></div><a class="tag warn" href="/app/scanner">planned</a></div>
            </div>
          </div>
        </section>
      </section>

      <section id="tab-features" class="tab-panel" data-tab-panel="features" hidden>
        <section class="card" aria-label="Built enterprise features">
          <div class="section-title">
            <div>
              <h2>Setup and operations map</h2>
              <p>Open the pages needed to finish setup, run the account, and collect audit evidence.</p>
            </div>
            <span class="mini">business-use links</span>
          </div>
          <div class="feature-grid">
            <a class="feature-card" href="/">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">public</span></div>
              <h3>Enterprise homepage</h3>
              <p>Public page for people who have not signed in yet. Use the app pages below for setup and daily work.</p>
            </a>
            <a class="feature-card" href="/app/login">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">auth</span></div>
              <h3>Enterprise login</h3>
              <p>Enterprise-only sign-in with approved access messaging, reset flow, and SSO entry point.</p>
            </a>
            <a class="feature-card" href="/readiness" target="_blank" rel="noopener">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">proof</span></div>
              <h3>Production readiness</h3>
              <p>Shows whether Front Door, the control plane, executor, attestation, and Secure Key Release are production-ready.</p>
            </a>
            <a class="feature-card" href="/health" target="_blank" rel="noopener">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">health</span></div>
              <h3>Control-plane health</h3>
              <p>Fast health endpoint used by Front Door, monitoring, APIM checks, and operators.</p>
            </a>
            <a class="feature-card" href="/app/control">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">policy</span></div>
              <h3>Policy control</h3>
              <p>Edit project policy, provider allowlists, caller-lock rules, rate limits, and secure execution settings.</p>
            </a>
            <a class="feature-card" href="/app/projects">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">inventory</span></div>
              <h3>Project inventory</h3>
              <p>Review project health, provider slot posture, policy status, and quick paths into Control.</p>
            </a>
            <a class="feature-card" href="/app/keys">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">secrets</span></div>
              <h3>Provider slots</h3>
              <p>View active providers, emergency revoke slots, rotation checklists, and Secure Key Release notes.</p>
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
              <h3>Plans and APIM</h3>
              <p>Track enterprise rollout packaging, APIM sidecar readiness, limits, and contract guardrails.</p>
            </a>
            <a class="feature-card" href="/app/scanner">
              <div class="feature-tags"><span class="feature-tag">visible</span><span class="feature-tag pending">future API</span></div>
              <h3>Scanner entry</h3>
              <p>Enterprise-safe placeholder for repository/security scanning until scoped scanner APIs are ready.</p>
            </a>
            <a class="feature-card" href="/app/runbooks">
              <div class="feature-tags"><span class="feature-tag">live</span><span class="feature-tag">ops</span></div>
              <h3>Operator runbooks</h3>
              <p>Open verification, evidence, deploy, secret, TLS, APIM, SSH, and cleanup runbooks.</p>
            </a>
          </div>
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
        text('kpiRuntime', ready ? 'ready' : 'watch');
        text('kpiRuntimeSub', ready ? 'Azure confidential production' : 'needs review');
        var pill = byId('runtimePill');
        if (pill) {
          pill.textContent = ready ? 'production ready' : 'not production ready';
          pill.className = 'status-pill ' + (ready ? '' : 'bad');
        }
        var blockers = Array.isArray(payload && payload.production_blockers) ? payload.production_blockers : [];
        text('runtimeDetail', ready
          ? 'Front Door, control plane, executor, attestation, replay protection, and Secure Key Release all report production-ready.'
          : (blockers.length ? blockers.join(' | ') : 'Readiness is incomplete.'));
      }
      function renderOrgSelector(orgs, activeId) {
        var select = byId('orgSelect');
        if (!select) return;
        if (!orgs.length) {
          select.innerHTML = '<option value="">No enterprise org</option>';
          select.disabled = true;
          return;
        }
        select.disabled = false;
        select.innerHTML = orgs.map(function(org) {
          return '<option value="' + escapeHtml(org.id) + '">' + escapeHtml(org.name || 'Organization') + ' - ' + escapeHtml(org.role || org.kind || 'member') + '</option>';
        }).join('');
        var requested = orgs.find(function(org) { return org.id === currentOrgId; });
        var active = orgs.find(function(org) { return org.id === activeId; });
        var team = orgs.find(function(org) { return org.kind && org.kind !== 'personal'; });
        var selected = requested || active || team || orgs[0];
        currentOrgId = selected ? selected.id : '';
        if (currentOrgId) {
          localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
          select.value = currentOrgId;
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
        setNotice('');
        try {
          var readinessTask = loadPanel(sequence, 'readiness', fetchJson('/readiness'), renderReadiness, panelFailures);
          var orgsPayload = await fetchJson('/api/v1/enterprise/orgs');
          if (sequence !== loadSequence) return;
          var orgs = Array.isArray(orgsPayload.organizations) ? orgsPayload.organizations : [];
          renderOrgSelector(orgs, orgsPayload.active_organization_id || '');
          await Promise.allSettled([
            readinessTask,
            loadPanel(sequence, 'organization', fetchJson('/api/v1/enterprise/orgs/current'), renderOrganization, panelFailures),
            loadPanel(sequence, 'project stats', fetchJson('/api/v1/enterprise/projects/stats/overview'), renderOverview, panelFailures),
            loadPanel(sequence, 'members', fetchJson('/api/v1/enterprise/members'), renderMembers, panelFailures),
            loadPanel(sequence, 'audit', fetchJson('/api/v1/enterprise/audit?limit=6&days=30'), renderAudit, panelFailures)
          ]);
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
      var orgSelect = byId('orgSelect');
      if (orgSelect) orgSelect.addEventListener('change', function(event) {
        currentOrgId = event.target.value || '';
        if (currentOrgId) localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, currentOrgId);
        loadDashboard();
      });
      selectDashboardTab('overview');
      loadDashboard();
    })();
  </script>
</body>
</html>`, env, 'dashboard');
}
