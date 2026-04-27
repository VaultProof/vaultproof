import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';

export function renderEnterpriseLoginPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VaultProof Enterprise Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.101.1" integrity="sha384-0VpB0wAYDdhWCEv3+IjT0Z9Kgpvszkf70RFX3ro7l4QR5nywxsMaOpmvZKsfRF8I" crossorigin="anonymous"></script>
  <style>
    :root {
      --bg: #10130f;
      --panel: #f3efe3;
      --ink: #171914;
      --muted: #65695d;
      --line: rgba(23, 25, 20, 0.16);
      --accent: #b45309;
      --dark-card: rgba(255, 255, 255, 0.08);
      --dark-line: rgba(255, 255, 255, 0.16);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, system-ui, sans-serif;
      background:
        radial-gradient(circle at 12% 12%, rgba(217, 119, 6, 0.24), transparent 34%),
        radial-gradient(circle at 88% 18%, rgba(132, 204, 22, 0.12), transparent 30%),
        linear-gradient(135deg, #10130f 0%, #1f221b 48%, #090b08 100%);
      color: #fff;
    }
    a { color: inherit; }
    .hidden { display: none !important; }
    .shell {
      width: min(1180px, calc(100% - 32px));
      min-height: 100vh;
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 430px;
      gap: 28px;
      align-items: center;
      padding: 32px 0;
    }
    .hero {
      min-height: 620px;
      border: 1px solid var(--dark-line);
      border-radius: 34px;
      padding: 34px;
      background: linear-gradient(145deg, rgba(255,255,255,0.10), rgba(255,255,255,0.03));
      box-shadow: 0 30px 90px rgba(0,0,0,0.34);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      position: relative;
    }
    .hero:after {
      content: "";
      position: absolute;
      inset: auto -80px -120px auto;
      width: 360px;
      height: 360px;
      border-radius: 999px;
      background: rgba(180, 83, 9, 0.32);
      filter: blur(24px);
    }
    .brand {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: "JetBrains Mono", monospace;
      font-size: 13px;
      letter-spacing: -0.02em;
      color: rgba(255,255,255,0.72);
    }
    .pill {
      border: 1px solid var(--dark-line);
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(0,0,0,0.2);
    }
    h1 {
      max-width: 760px;
      margin: 0;
      font-family: "Inter Tight", Inter, sans-serif;
      font-size: clamp(44px, 7vw, 88px);
      line-height: 0.88;
      letter-spacing: -0.08em;
    }
    .hero-copy {
      max-width: 610px;
      color: rgba(255,255,255,0.68);
      font-size: 18px;
      line-height: 1.7;
      margin-top: 24px;
    }
    .proof-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-top: 44px;
      position: relative;
      z-index: 1;
    }
    .proof {
      border: 1px solid var(--dark-line);
      background: rgba(0,0,0,0.22);
      border-radius: 20px;
      padding: 16px;
    }
    .proof strong {
      display: block;
      font-family: "JetBrains Mono", monospace;
      font-size: 12px;
      color: #fbbf24;
      margin-bottom: 8px;
      text-transform: uppercase;
    }
    .proof span {
      color: rgba(255,255,255,0.66);
      font-size: 13px;
      line-height: 1.5;
    }
    .login-card {
      background: var(--panel);
      color: var(--ink);
      border-radius: 30px;
      padding: 26px;
      box-shadow: 0 30px 90px rgba(0,0,0,0.42);
    }
    .auth-kicker, .sso-kicker {
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 700;
    }
    .auth-title {
      margin: 10px 0 8px;
      font-family: "Inter Tight", Inter, sans-serif;
      font-size: 34px;
      letter-spacing: -0.05em;
      line-height: 1;
    }
    .auth-subtitle, .entry-copy, .sso-copy, .sso-hint, .legal, .back-link, .auth-footnote {
      color: var(--muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .entry-split {
      display: grid;
      grid-template-columns: 1fr;
      gap: 10px;
      margin: 18px 0;
    }
    .entry-card, .sso-block, .promo-block {
      border: 1px solid var(--line);
      border-radius: 18px;
      padding: 14px;
      background: rgba(255,255,255,0.42);
    }
    .entry-label {
      font-family: "JetBrains Mono", monospace;
      color: var(--accent);
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 700;
    }
    .entry-title, .sso-title {
      font-weight: 800;
      margin-top: 4px;
    }
    .auth-card { display: grid; gap: 14px; }
    .form-input {
      width: 100%;
      border: 1px solid var(--line);
      background: #fffaf0;
      border-radius: 14px;
      padding: 12px 13px;
      color: var(--ink);
      outline: none;
    }
    .form-input:focus { border-color: rgba(180, 83, 9, 0.65); }
    .btn {
      width: 100%;
      border: 0;
      border-radius: 14px;
      padding: 12px 14px;
      font-weight: 800;
      cursor: pointer;
    }
    .btn-primary { background: #171914; color: #fff; }
    .btn-secondary { background: #fffaf0; color: var(--ink); border: 1px solid var(--line); }
    .btn-small { width: auto; padding: 10px 12px; }
    .oauth-stack, .form-stack { display: grid; gap: 10px; }
    .sso-row, .promo-row { display: grid; grid-template-columns: 1fr auto; gap: 8px; margin-top: 10px; }
    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
      text-transform: uppercase;
      font-family: "JetBrains Mono", monospace;
    }
    .divider:before, .divider:after { content: ""; height: 1px; background: var(--line); flex: 1; }
    .auth-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .auth-tabs button, .text-button, .promo-toggle {
      border: 0;
      background: transparent;
      color: var(--accent);
      cursor: pointer;
      font-weight: 700;
    }
    .input-icon svg, .oauth-stack svg { display: none; }
    #authError, #loginError, #regError, #resetStatus, #ssoStatus, #promoCodeMsg {
      border-radius: 12px;
      padding: 10px;
      font-size: 13px;
      border: 1px solid rgba(180, 83, 9, 0.24);
      background: rgba(180, 83, 9, 0.08);
    }
    .legal { margin-top: 6px; }
    .back-link { text-align: center; margin-top: 16px; }
    .auth-footnote {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 10px;
      font-family: "JetBrains Mono", monospace;
      font-size: 11px;
    }
    @media (max-width: 900px) {
      .shell { grid-template-columns: 1fr; }
      .hero { min-height: auto; }
      .proof-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="brand">
        <span>VaultProof Enterprise</span>
        <span class="pill">Azure confidential path</span>
      </div>
      <div>
        <h1>Enterprise login for keys we should never see.</h1>
        <p class="hero-copy">This portal is separate from the B2C Cloudflare stack. Enterprise traffic routes through Azure, with signed handoff to the secure executor and a path toward Confidential VM plus Secure Key Release.</p>
        <div class="proof-grid">
          <div class="proof"><strong>01 / Separate</strong><span>B2C stays on Cloudflare. Enterprise runs on Azure.</span></div>
          <div class="proof"><strong>02 / Encrypted</strong><span>Both Shamir shares are encrypted at rest for enterprise rows.</span></div>
          <div class="proof"><strong>03 / Attested</strong><span>Production executor target is Azure Confidential VM gated by key release.</span></div>
        </div>
      </div>
    </section>

    <section class="login-card" aria-label="Enterprise login">
      <div class="auth-heading">
        <div class="auth-kicker">enterprise only</div>
        <h2 class="auth-title">Sign in to VaultProof Enterprise</h2>
        <p class="auth-subtitle">Use company SSO, Google, GitHub, or email. After sign-in, enterprise users route to the separate Enterprise dashboard.</p>
        <div class="entry-split" aria-label="Access path">
          <div class="entry-card">
            <div class="entry-label">enterprise workspace</div>
            <div class="entry-title">Enterprise dashboard</div>
            <p class="entry-copy">Access governance, project policy, audit review, secure execution posture, and enterprise provider routing.</p>
          </div>
        </div>
      </div>

      <div id="authCard" class="auth-card">
        <div id="authError" class="hidden"></div>

        <div class="promo-block hidden">
          <button type="button" id="promoToggleBtn" class="promo-toggle">+ have a promo code?</button>
          <div id="promoRow" class="promo-row hidden">
            <input id="promoCodeInput" type="text" placeholder="ENTER CODE" maxlength="50" class="form-input" />
            <button type="button" id="promoApplyBtn" class="btn btn-small">apply</button>
          </div>
          <p id="promoCodeMsg" class="hidden"></p>
        </div>

        <div class="sso-block">
          <div class="sso-kicker">company sso</div>
          <div class="sso-title">Continue with Microsoft Entra / SSO</div>
          <p class="sso-copy">Enter your company domain or work email to start enterprise SSO.</p>
          <div class="sso-row">
            <input id="ssoDomainInput" type="text" class="form-input" placeholder="company.com or you@company.com" />
            <button id="ssoContinueBtn" type="button" class="btn btn-secondary">continue</button>
          </div>
          <div class="sso-hint">If SSO is not configured yet, use Google, GitHub, or email for the demo workspace.</div>
          <div id="ssoStatus" class="hidden"></div>
        </div>

        <div class="oauth-stack">
          <button id="loginWithGitHubBtn" type="button" class="btn btn-primary">continue with github</button>
          <button id="loginWithGoogleBtn" type="button" class="btn btn-secondary">continue with google</button>
        </div>

        <div class="divider">or email</div>

        <div id="emailSection">
          <div class="auth-tabs">
            <button type="button" id="loginTab" class="btn btn-primary">sign in</button>
            <button type="button" id="registerTab" class="btn btn-secondary">create account</button>
          </div>

          <form id="loginForm" class="form-stack">
            <div class="input-icon"><input type="email" id="loginEmail" required class="form-input" placeholder="you@example.com" /></div>
            <div class="input-icon"><input type="password" id="loginPassword" required class="form-input" placeholder="password" /></div>
            <div class="form-row"><button type="button" id="showResetBtn" class="text-button">forgot password?</button></div>
            <div id="loginError" class="hidden"></div>
            <button type="submit" id="loginBtn" class="btn btn-primary">sign in</button>
          </form>

          <div id="resetForm" class="form-stack hidden">
            <p class="reset-copy">Enter your email and we'll send a reset link.</p>
            <div class="input-icon"><input type="email" id="resetEmail" required class="form-input" placeholder="you@example.com" /></div>
            <div id="resetStatus" class="hidden"></div>
            <button type="button" id="resetBtn" class="btn btn-primary">send reset link</button>
            <button type="button" id="backToSigninBtn" class="text-button">back to sign in</button>
          </div>

          <form id="registerForm" class="form-stack hidden">
            <div class="input-icon"><input type="email" id="regEmail" required class="form-input" placeholder="you@example.com" /></div>
            <div class="input-icon"><input type="password" id="regPassword" required minlength="8" class="form-input" placeholder="min 8 characters" /></div>
            <div id="regError" class="hidden"></div>
            <button type="submit" id="regBtn" class="btn btn-primary">create account</button>
          </form>
        </div>

        <p class="legal">Enterprise access is governed by your organization policy. B2C users should use <a href="https://vaultproof.dev/app/login">vaultproof.dev/app/login</a>.</p>
      </div>

      <p class="back-link"><a href="https://vaultproof.dev">public VaultProof site</a></p>
      <div class="auth-footnote"><span>enterprise.vaultproof.dev</span><span>secure path</span></div>
    </section>
  </main>

  <script src="/app/enterprise-login.js" defer></script>
</body>
</html>`, env, 'login');
}

export function renderEnterpriseLoginScript(): string {
  return readFileSync(join(process.cwd(), 'apps/site/js/app-login-3.js'), 'utf8');
}
