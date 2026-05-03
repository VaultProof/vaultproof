import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { injectEnterpriseAnalytics } from './analytics.js';
import type { EnterpriseControlPlaneEnv } from './config.js';

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

export function renderEnterpriseLoginPage(env: EnterpriseControlPlaneEnv = {}): string {
  return injectEnterpriseAnalytics(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>VaultProof Enterprise Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@300;400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.101.1" integrity="sha384-0VpB0wAYDdhWCEv3+IjT0Z9Kgpvszkf70RFX3ro7l4QR5nywxsMaOpmvZKsfRF8I" crossorigin="anonymous"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f2eee5;
      --paper: #fbf9f4;
      --surface: #e8e2d4;
      --ink: #14120e;
      --ink-soft: #3d3a33;
      --muted: #867f6f;
      --line: rgba(20, 18, 14, 0.12);
      --line-strong: rgba(20, 18, 14, 0.25);
      --line-soft: rgba(20, 18, 14, 0.06);
      --accent: #8b5a3c;
      --accent-soft: rgba(139, 90, 60, 0.12);
      --success: #3f6b47;
      --display: "Newsreader", "Times New Roman", Georgia, serif;
      --body: "Inter Tight", -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
      --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, monospace;
    }
    * { box-sizing: border-box; }
    html { min-height: 100%; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--body);
      background:
        radial-gradient(circle at 14% 12%, rgba(139, 90, 60, 0.14), transparent 34%),
        radial-gradient(circle at 88% 18%, rgba(63, 107, 71, 0.10), transparent 32%),
        linear-gradient(135deg, var(--bg) 0%, #f8f4eb 48%, #e9e1d2 100%);
      color: var(--ink);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    body:before {
      content: "";
      position: fixed;
      inset: -10%;
      pointer-events: none;
      background-image: radial-gradient(rgba(20, 18, 14, 0.11) 1px, transparent 1px);
      background-size: 28px 28px;
      mask-image: radial-gradient(ellipse at center, black 28%, transparent 72%);
      -webkit-mask-image: radial-gradient(ellipse at center, black 28%, transparent 72%);
    }
    a { color: inherit; text-decoration: none; }
    .hidden { display: none !important; }
    .shell {
      position: relative;
      z-index: 1;
      width: min(1220px, calc(100% - 48px));
      min-height: 100vh;
      margin: 0 auto;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 450px;
      gap: 36px;
      align-items: center;
      padding: 42px 0;
    }
    .hero {
      min-height: 660px;
      border: 0.5px solid var(--line);
      border-radius: 18px;
      padding: 34px;
      background: rgba(251, 249, 244, 0.72);
      box-shadow: 0 1px 0 rgba(255,255,255,.5) inset, 0 28px 80px -30px rgba(20,18,14,.22);
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      position: relative;
    }
    .hero:before {
      content: "";
      position: absolute;
      inset: 80px 34px auto auto;
      width: 220px;
      height: 220px;
      border: 0.5px solid var(--line);
      border-radius: 999px;
      background: radial-gradient(circle, var(--accent-soft), transparent 68%);
    }
    .hero:after {
      content: "";
      position: absolute;
      inset: auto -90px -110px auto;
      width: 340px;
      height: 340px;
      border-radius: 999px;
      background: rgba(139, 90, 60, 0.15);
      filter: blur(28px);
    }
    .brand {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 18px;
      font: 500 11px/1 var(--mono);
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      position: relative;
      z-index: 1;
    }
    .pill {
      border: 0.5px solid var(--line);
      border-radius: 999px;
      padding: 9px 12px;
      background: var(--paper);
      color: var(--accent);
    }
    h1 {
      max-width: 760px;
      margin: 0;
      font: 400 clamp(54px, 7.4vw, 112px)/0.92 var(--display);
      letter-spacing: -0.045em;
      text-wrap: balance;
      position: relative;
      z-index: 1;
    }
    h1 em {
      color: var(--accent);
      font-style: italic;
    }
    .hero-copy {
      max-width: 610px;
      color: var(--ink-soft);
      font-size: 19px;
      line-height: 1.55;
      margin-top: 24px;
      text-wrap: pretty;
      position: relative;
      z-index: 1;
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
      border: 0.5px solid var(--line);
      background: rgba(242, 238, 229, 0.7);
      border-radius: 12px;
      padding: 18px;
    }
    .proof strong {
      display: block;
      font: 500 11px/1 var(--mono);
      color: var(--accent);
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }
    .proof span {
      color: var(--ink-soft);
      font-size: 13px;
      line-height: 1.5;
    }
    .login-card {
      background: var(--paper);
      color: var(--ink);
      border: 0.5px solid var(--line);
      border-radius: 18px;
      padding: 28px;
      box-shadow: 0 1px 0 rgba(255,255,255,.6) inset, 0 28px 80px -30px rgba(20,18,14,.28);
    }
    .auth-kicker, .sso-kicker {
      font-family: var(--mono);
      font-size: 10.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--accent);
      font-weight: 500;
    }
    .auth-title {
      margin: 10px 0 8px;
      font: 400 42px/0.98 var(--display);
      letter-spacing: -0.025em;
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
      border: 0.5px solid var(--line);
      border-radius: 12px;
      padding: 15px;
      background: rgba(242, 238, 229, 0.58);
    }
    .entry-label {
      font-family: var(--mono);
      color: var(--accent);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-weight: 500;
    }
    .entry-title, .sso-title {
      font-weight: 600;
      margin-top: 4px;
    }
    .auth-card { display: grid; gap: 14px; }
    .form-input {
      width: 100%;
      border: 0.5px solid var(--line);
      background: #fffdf8;
      border-radius: 9px;
      padding: 12px 13px;
      color: var(--ink);
      outline: none;
      font: 400 14px/1.2 var(--body);
    }
    .form-input:focus { border-color: rgba(139, 90, 60, 0.65); box-shadow: 0 0 0 3px var(--accent-soft); }
    .btn {
      width: 100%;
      border: 0.5px solid var(--line);
      border-radius: 9px;
      padding: 12px 14px;
      font: 600 13px/1 var(--body);
      cursor: pointer;
      min-height: 42px;
      transition: transform 180ms ease, background 180ms ease, color 180ms ease, border-color 180ms ease;
    }
    .btn:hover { transform: translateY(-1px); }
    .btn-primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
    .btn-secondary { background: #fffdf8; color: var(--ink); }
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
      font-family: var(--mono);
    }
    .divider:before, .divider:after { content: ""; height: 1px; background: var(--line); flex: 1; }
    .auth-tabs { display: grid; grid-template-columns: 1fr; gap: 8px; margin-bottom: 10px; }
    .auth-tabs button, .text-button, .promo-toggle {
      border: 0;
      background: transparent;
      color: var(--accent);
      cursor: pointer;
      font-weight: 600;
    }
    .input-icon svg, .oauth-stack svg { display: none; }
    #authError, #loginError, #regError, #resetStatus, #ssoStatus, #promoCodeMsg {
      border-radius: 9px;
      padding: 10px;
      font-size: 13px;
      border: 0.5px solid rgba(139, 90, 60, 0.24);
      background: var(--accent-soft);
    }
    .legal { margin-top: 6px; }
    .back-link { text-align: center; margin-top: 16px; }
    .auth-footnote {
      display: flex;
      justify-content: center;
      gap: 10px;
      margin-top: 10px;
      font-family: var(--mono);
      font-size: 11px;
    }
    @media (max-width: 900px) {
      .shell { width: min(100% - 32px, 760px); grid-template-columns: 1fr; }
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
        <span class="pill">Enterprise access</span>
      </div>
      <div>
        <h1>Sign in to the place where your <em>API keys stay safe.</em></h1>
        <p class="hero-copy">This is the enterprise control room for VaultProof. Your team can see which keys are protected, who can use them, and every safe API call made through the system.</p>
        <div class="proof-grid">
          <div class="proof"><strong>01 / Keys</strong><span>Move real API keys out of apps, env vars, and logs.</span></div>
          <div class="proof"><strong>02 / Rules</strong><span>Choose which apps, providers, and people can use each key.</span></div>
          <div class="proof"><strong>03 / Receipts</strong><span>See a clear record every time a protected key is used.</span></div>
        </div>
      </div>
    </section>

    <section class="login-card" aria-label="Enterprise login">
      <div class="auth-heading">
        <div class="auth-kicker">enterprise only</div>
        <h2 class="auth-title">Sign in to VaultProof Enterprise</h2>
        <p class="auth-subtitle">Use the login method your company already approved. New enterprise workspaces are created by invite or by your VaultProof admin.</p>
        <div class="entry-split" aria-label="Access path">
          <div class="entry-card">
            <div class="entry-label">enterprise workspace</div>
            <div class="entry-title">Enterprise dashboard</div>
            <p class="entry-copy">Manage protected keys, access rules, team members, audit records, and provider settings.</p>
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
          <div class="sso-title">Continue with company SAML SSO</div>
          <p class="sso-copy">Enter your company domain or work email to start your approved company login.</p>
          <div class="sso-row">
            <input id="ssoDomainInput" type="text" class="form-input" placeholder="company.com or you@company.com" />
            <button id="ssoContinueBtn" type="button" class="btn btn-secondary">continue</button>
          </div>
          <div class="sso-hint">If SSO is not set up yet, use the Google, GitHub, or email account your admin invited.</div>
          <div id="ssoStatus" class="hidden"></div>
        </div>

        <div class="oauth-stack">
          <button id="loginWithMicrosoftBtn" type="button" class="btn btn-secondary">continue with microsoft</button>
          <button id="loginWithGitHubBtn" type="button" class="btn btn-primary">continue with github</button>
          <button id="loginWithGoogleBtn" type="button" class="btn btn-secondary">continue with google</button>
        </div>

        <div class="divider">or email</div>

        <div id="emailSection">
          <div class="auth-tabs">
            <button type="button" id="loginTab" class="btn btn-primary">sign in</button>
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
        </div>

        <p class="legal">Enterprise access is invite-only. If your credentials do not work, ask your VaultProof admin to invite you or enable SSO for your company domain.</p>
      </div>

      <p class="back-link"><a href="/">back to enterprise homepage</a></p>
      <div class="auth-footnote"><span>enterprise.vaultproof.dev</span><span>protected key access</span></div>
    </section>
  </main>

  <script src="/app/enterprise-login.js" defer></script>
</body>
</html>`, env, 'login');
}

export function renderEnterpriseLoginScript(): string {
  return readWorkspaceFile('apps/site/js/app-login-3.js');
}

export function renderEnterpriseLogoutPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex" />
  <title>Signing out - VaultProof Enterprise</title>
  <style>
    :root { color-scheme: dark; --bg: #07110f; --panel: rgba(237,229,204,.1); --line: rgba(237,229,204,.16); --text: #f4ecd5; --muted: #a9b7a6; --gold: #d7a84b; --ink: #07110f; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: var(--text); background: radial-gradient(circle at 20% 10%, rgba(215,168,75,.24), transparent 30rem), linear-gradient(135deg, #06100e, #10231d 50%, #050807); }
    main { width: min(100% - 32px, 560px); border: 1px solid var(--line); background: linear-gradient(180deg, rgba(237,229,204,.13), rgba(237,229,204,.055)); border-radius: 28px; padding: 34px; box-shadow: 0 24px 90px rgba(0,0,0,.24); }
    .kicker { color: var(--gold); font-size: 12px; text-transform: uppercase; letter-spacing: .16em; font-weight: 850; }
    h1 { margin: 10px 0; font-size: clamp(34px, 8vw, 58px); line-height: .92; letter-spacing: -.065em; }
    p { color: var(--muted); line-height: 1.6; margin: 0 0 18px; }
    a { display: inline-flex; border-radius: 14px; padding: 11px 13px; color: var(--ink); background: linear-gradient(135deg, var(--gold), #f3df95); text-decoration: none; font-weight: 850; }
  </style>
</head>
<body>
  <main>
    <div class="kicker">enterprise session</div>
    <h1>Signing out.</h1>
    <p id="logoutStatus">Clearing the local VaultProof Enterprise session and sending you back to sign in.</p>
    <a href="/app/login?logout=1">go to login</a>
  </main>
  <script>
    (function() {
      function clearStorage(storage) {
        if (!storage) return;
        var keys = [];
        for (var i = 0; i < storage.length; i += 1) {
          keys.push(storage.key(i));
        }
        keys.forEach(function(key) {
          if (!key) return;
          if (key.indexOf('auth-token') !== -1 || key.indexOf('vaultproof_') === 0 || key.indexOf('sb-') === 0) {
            storage.removeItem(key);
          }
        });
      }
      try { clearStorage(window.localStorage); } catch (error) {}
      try { window.sessionStorage.clear(); } catch (error) {}
      var status = document.getElementById('logoutStatus');
      if (status) status.textContent = 'Signed out. Redirecting to login...';
      window.setTimeout(function() {
        window.location.replace('/app/login?logout=1');
      }, 250);
    })();
  </script>
</body>
</html>`;
}
