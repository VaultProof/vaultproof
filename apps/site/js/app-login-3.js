// ── Supabase client ──
    const sbClient = window.supabase.createClient(
      'https://gwzkjiomemjlhtrdrlan.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o'
    );

    // ── Loop detection (timestamp-based) ──
    let isRedirecting = false;
    const loopKey = 'vp_login_ts';
    const now = Date.now();
    const loopHistory = JSON.parse(sessionStorage.getItem(loopKey) || '[]').filter(function(t) { return now - t < 5000; });
    if (loopHistory.length >= 3) {
      // 3+ redirects in 5 seconds = loop. Break it.
      sessionStorage.removeItem(loopKey);
      localStorage.removeItem('vaultproof_token');
      localStorage.removeItem('vaultproof_user');
      localStorage.removeItem('vp_promo');
      // Don't call signOut() — it kills the server-side session
      console.warn('Login loop detected — cleared local auth state');
    }

    function safeRedirect(url) {
      if (isRedirecting) return;
      isRedirecting = true;
      loopHistory.push(Date.now());
      sessionStorage.setItem(loopKey, JSON.stringify(loopHistory));
      window.location.replace(url);
    }

    // ── Handle email confirmation / OAuth PKCE code exchange ──
    // Note: Supabase SDK also auto-exchanges ?code= via detectSessionInUrl. If the SDK wins
    // the race, onAuthStateChange('SIGNED_IN') handles the redirect and this call returns an
    // error — we silently ignore it to avoid a false "Email confirmation failed" flash.
    const urlSearchParams = new URLSearchParams(window.location.search);
    const confirmCode = urlSearchParams.get('code');
    const callbackState = urlSearchParams.get('state');
    const isScannerGitHubCallback = urlSearchParams.get('github_callback') === '1';

    // Scanner GitHub OAuth reuses ?code= and ?state=. If that callback ever lands on the
    // login page, forward it to the scanner page instead of asking Supabase to exchange it.
    if (isScannerGitHubCallback && confirmCode && callbackState) {
      const scannerParams = new URLSearchParams({
        github_callback: '1',
        code: confirmCode,
        state: callbackState,
      });
      window.location.replace('/app/scanner?' + scannerParams.toString());
    } else if (confirmCode) {
      sbClient.auth.exchangeCodeForSession(confirmCode).then(async ({ data, error }) => {
        if (!error && data.session) {
          storeLocalSession(data.session, data.user);
          await redeemPendingPromo(data.session);
          safeRedirect('./');
        } else if (error && !isRedirecting) {
          // Delay so onAuthStateChange can redirect first if it handled the exchange
          setTimeout(function() {
            if (!isRedirecting) {
              var errEl = document.getElementById('authError');
              errEl.textContent = 'Email confirmation failed. Please try logging in with your email and password.';
              errEl.classList.remove('hidden');
            }
          }, 800);
        }
      }).catch(function() {});
    }

    // ── Check for CLI callback param ──
    const urlParams = new URLSearchParams(window.location.search);
    const forceLogout = urlParams.get('logout') === '1';
    const rawCliCallback = urlParams.get('cli_callback');
    const cliState = urlParams.get('state');

    if (forceLogout) {
      // Defensive cleanup for any persisted auth state before rendering login.
      Object.keys(localStorage).forEach(function(key) {
        if (key.startsWith('vaultproof_') || key.startsWith('sb-') || key.includes('auth-token')) {
          localStorage.removeItem(key);
        }
      });
      sessionStorage.clear();
      sbClient.auth.signOut({ scope: 'global' }).catch(function() {});
      if (!confirmCode) {
        window.history.replaceState({}, '', '/app/login');
      }
    }

    // Validate cli_callback: must be http/https on localhost/127.0.0.1 only
    let cliCallback = null;
    if (rawCliCallback) {
      try {
        const cbUrl = new URL(rawCliCallback);
        const safeProtocol = cbUrl.protocol === 'http:' || cbUrl.protocol === 'https:';
        const safeHost = cbUrl.hostname === 'localhost' || cbUrl.hostname === '127.0.0.1';
        if (safeProtocol && safeHost) {
          cliCallback = rawCliCallback;
        } else {
          console.warn('cli_callback rejected: must be http/https on localhost');
        }
      } catch {
        console.warn('cli_callback rejected: invalid URL');
      }
    }

    // ── Detect ?promo= param and store (clear stale promo if no param) ──
    const rawPromo = urlParams.get('promo');
    // Only accept alphanumeric + underscore/hyphen, max 50 chars
    const promoParam = rawPromo && /^[A-Z0-9_-]{1,50}$/i.test(rawPromo) ? rawPromo.toUpperCase() : null;
    // Pre-fill promo input if ?promo= is in URL (backwards compat)
    if (promoParam) {
      localStorage.setItem('vp_promo', promoParam);
      // Don't show promo UI during OAuth/email callback (?code= present) — avoids flash before redirect
      if (!confirmCode) {
        const input = document.getElementById('promoCodeInput');
        if (input) {
          input.value = promoParam;
          document.getElementById('promoRow').classList.remove('hidden');
          const msg = document.getElementById('promoCodeMsg');
          msg.textContent = 'Code saved \u2014 will be applied after you sign up.';
          msg.className = 'text-xs text-indigo-400 mt-1.5';
          msg.classList.remove('hidden');
        }
      }
    }

    function applyPromoCode() {
      const input = document.getElementById('promoCodeInput');
      const msg = document.getElementById('promoCodeMsg');
      const code = input.value.trim().toUpperCase();
      msg.classList.remove('hidden');
      if (!code) { msg.textContent = 'Enter a code first.'; msg.className = 'text-xs text-amber-400 mt-1.5'; return; }
      if (!/^[A-Z0-9_-]{1,50}$/.test(code)) { msg.textContent = 'Invalid code format.'; msg.className = 'text-xs text-amber-400 mt-1.5'; return; }
      // Check availability before saving
      fetch('https://staging-api.vaultproof.dev/api/v1/promo/check/' + encodeURIComponent(code))
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (!d.valid || d.spotsLeft <= 0) {
            msg.textContent = 'This promo has ended \u2014 all spots claimed.';
            msg.className = 'text-xs text-amber-400 mt-1.5';
          } else {
            localStorage.setItem('vp_promo', code);
            msg.textContent = 'Code saved \u2014 will be applied after you sign up.';
            msg.className = 'text-xs text-indigo-400 mt-1.5';
          }
        })
        .catch(function() {
          // Save anyway if network check fails; redeem will validate server-side
          localStorage.setItem('vp_promo', code);
          msg.textContent = 'Code saved \u2014 will be applied after you sign up.';
          msg.className = 'text-xs text-indigo-400 mt-1.5';
        });
    }

    // Show CLI banner if logging in from CLI
    if (cliCallback) {
      const banner = document.createElement('div');
      banner.className = 'p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-sm text-indigo-400 mb-4 text-center';
      banner.textContent = 'Signing in from VaultProof CLI \u2014 log in below to connect.';
      const target = document.getElementById('authCard');
      if (target) target.prepend(banner);
    }

    // ── Auto-redeem promo helper (3s timeout to avoid blocking login) ──
    async function redeemPendingPromo(session) {
      const pendingPromo = localStorage.getItem('vp_promo');
      if (pendingPromo && session) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(function() { controller.abort(); }, 3000);
          const res = await fetch('https://staging-api.vaultproof.dev/api/v1/promo/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + session.access_token },
            body: JSON.stringify({ code: pendingPromo }),
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (res.ok) localStorage.removeItem('vp_promo');
        } catch (e) { console.error('Promo redeem failed or timed out:', e); }
      }
    }

    function storeLocalSession(session, user) {
      if (!session) return;
      localStorage.setItem('vaultproof_token', session.access_token);
      if (session.refresh_token) {
        localStorage.setItem('vaultproof_refresh_token', session.refresh_token);
      }
      localStorage.setItem('vaultproof_user', JSON.stringify({
        id: (user && user.id) || (session.user && session.user.id) || '',
        email: (user && user.email) || (session.user && session.user.email) || ''
      }));
    }

    // ── Check if already logged in (skip if handling code exchange or loop detected) ──
    if (!forceLogout && !confirmCode && loopHistory.length < 3) {
      (async () => {
        const { data: { session } } = await sbClient.auth.getSession();
        if (session && !isRedirecting) {
          storeLocalSession(session, session.user);

          // Auto-redeem promo before redirect
          await redeemPendingPromo(session);

          // If CLI callback, redirect to CLI with token
          if (cliCallback) {
            window.location.href = `${cliCallback}?token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}&email=${encodeURIComponent(session.user.email)}&state=${encodeURIComponent(cliState || '')}`;
            return;
          }

          safeRedirect('./');
        }
      })();
    }

    // ── Listen for auth state changes (handles OAuth callback) ──
    sbClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session && !isRedirecting && !forceLogout) {
        storeLocalSession(session, session.user);

        // Auto-redeem promo before redirect
        await redeemPendingPromo(session);

        // If CLI callback, redirect to CLI with token
        if (cliCallback) {
          window.location.href = `${cliCallback}?token=${encodeURIComponent(session.access_token)}&refresh_token=${encodeURIComponent(session.refresh_token)}&email=${encodeURIComponent(session.user.email)}&state=${encodeURIComponent(cliState || '')}`;
          return;
        }

        safeRedirect('./');
      }
    });

    // ── GitHub OAuth ──
    async function loginWithGitHub() {
      // Preserve CLI callback and promo params through OAuth redirect
      const promoSuffix = localStorage.getItem('vp_promo') ? `&promo=${localStorage.getItem('vp_promo')}` : '';
      const redirectUrl = cliCallback
        ? `${window.location.origin}/app/login?cli_callback=${encodeURIComponent(cliCallback)}&state=${encodeURIComponent(cliState || '')}${promoSuffix}`
        : `${window.location.origin}/app/login${promoSuffix ? '?' + promoSuffix.slice(1) : ''}`;
      const { error } = await sbClient.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: redirectUrl }
      });
      if (error) showError(error.message);
    }

    // ── Google OAuth ──
    async function loginWithGoogle() {
      // Preserve CLI callback and promo params through OAuth redirect
      const promoSuffix = localStorage.getItem('vp_promo') ? `&promo=${localStorage.getItem('vp_promo')}` : '';
      const redirectUrl = cliCallback
        ? `${window.location.origin}/app/login?cli_callback=${encodeURIComponent(cliCallback)}&state=${encodeURIComponent(cliState || '')}${promoSuffix}`
        : `${window.location.origin}/app/login${promoSuffix ? '?' + promoSuffix.slice(1) : ''}`;
      const { error } = await sbClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl }
      });
      if (error) showError(error.message);
    }

    // ── UI helpers ──
    function showError(msg) {
      const el = document.getElementById('authError');
      el.textContent = msg;
      el.classList.remove('hidden');
    }

    function toggleEmailSection() {
      const section = document.getElementById('emailSection');
      const toggle = document.getElementById('emailToggle');
      const isHidden = section.classList.toggle('hidden');
      toggle.innerHTML = isHidden
        ? 'Or sign in with email &#9662;'
        : 'Or sign in with email &#9652;';
    }

    function showTab(tab) {
      document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
      document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
      document.getElementById('loginTab').className = tab === 'login'
        ? 'flex-1 py-2 text-sm font-medium rounded-md bg-[#6366f1] text-white transition-all duration-200 cursor-pointer'
        : 'flex-1 py-2 text-sm font-medium rounded-md text-gray-500 hover:text-gray-300 transition-all duration-200 cursor-pointer';
      document.getElementById('registerTab').className = tab === 'register'
        ? 'flex-1 py-2 text-sm font-medium rounded-md bg-[#6366f1] text-white transition-all duration-200 cursor-pointer'
        : 'flex-1 py-2 text-sm font-medium rounded-md text-gray-500 hover:text-gray-300 transition-all duration-200 cursor-pointer';
    }

    // ── Email/Password login via Supabase ──
    async function handleLogin(e) {
      e.preventDefault();
      const btn = document.getElementById('loginBtn');
      const errEl = document.getElementById('loginError');
      errEl.classList.add('hidden');
      btn.textContent = 'Signing in...';
      btn.disabled = true;

      try {
        const { data, error } = await sbClient.auth.signInWithPassword({
          email: document.getElementById('loginEmail').value,
          password: document.getElementById('loginPassword').value,
        });
        if (error) throw error;

        storeLocalSession(data.session, data.user);

        // Auto-redeem promo before redirect
        await redeemPendingPromo(data.session);

        // If CLI callback, redirect to CLI with token
        if (cliCallback) {
          window.location.href = `${cliCallback}?token=${encodeURIComponent(data.session.access_token)}&refresh_token=${encodeURIComponent(data.session.refresh_token)}&email=${encodeURIComponent(data.user.email)}`;
          return;
        }

        safeRedirect('./');
      } catch (err) {
        errEl.textContent = err.message;
        if (err.message.toLowerCase().includes('not confirmed')) {
          const br = document.createElement('br');
          const btn = document.createElement('button');
          btn.onclick = resendConfirmation;
          btn.className = 'mt-2 text-indigo-400 hover:underline text-xs';
          btn.textContent = 'Resend confirmation email';
          errEl.appendChild(br);
          errEl.appendChild(btn);
        }
        errEl.classList.remove('hidden');
      } finally {
        btn.textContent = 'Sign in';
        btn.disabled = false;
      }
    }

    async function resendConfirmation() {
      const email = document.getElementById('loginEmail').value;
      if (!email) return;
      const { error } = await sbClient.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin + '/app/login' } });
      const errEl = document.getElementById('loginError');
      if (error) {
        errEl.textContent = error.message;
      } else {
        errEl.innerHTML = 'Confirmation email resent! Check your inbox.';
        errEl.classList.remove('text-amber-400', 'bg-amber-500/10', 'border-amber-500/30');
        errEl.classList.add('text-green-400', 'bg-green-500/10', 'border-green-500/30');
      }
    }

    // ── Password Reset ──
    function showResetForm() {
      document.getElementById('loginForm').classList.add('hidden');
      document.getElementById('resetForm').classList.remove('hidden');
    }

    function hideResetForm() {
      document.getElementById('resetForm').classList.add('hidden');
      document.getElementById('loginForm').classList.remove('hidden');
    }

    async function handleReset() {
      const email = document.getElementById('resetEmail').value;
      const btn = document.getElementById('resetBtn');
      const status = document.getElementById('resetStatus');

      btn.textContent = 'Sending...';
      btn.disabled = true;

      const { error } = await sbClient.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/app/login'
      });

      status.classList.remove('hidden');
      if (error) {
        status.className = 'p-3 rounded-lg text-sm bg-amber-500/10 border border-amber-500/30 text-amber-400';
        status.textContent = error.message;
      } else {
        status.className = 'p-3 rounded-lg text-sm bg-indigo-500/10 border border-indigo-500/30 text-indigo-400';
        status.textContent = 'Reset link sent! Check your email.';
      }

      btn.textContent = 'Send reset link';
      btn.disabled = false;
    }

    // ── Email/Password register via Supabase ──
    async function handleRegister(e) {
      e.preventDefault();
      const btn = document.getElementById('regBtn');
      const errEl = document.getElementById('regError');
      errEl.classList.add('hidden');
      btn.textContent = 'Creating account...';
      btn.disabled = true;

      try {
        const { data, error } = await sbClient.auth.signUp({
          email: document.getElementById('regEmail').value,
          password: document.getElementById('regPassword').value,
          options: { emailRedirectTo: window.location.origin + '/app/login' },
        });
        if (error) throw error;

        if (data.session) {
          storeLocalSession(data.session, data.user);

          // Auto-redeem promo before redirect
          await redeemPendingPromo(data.session);

          // If CLI callback, redirect to CLI with token
          if (cliCallback) {
            window.location.href = `${cliCallback}?token=${encodeURIComponent(data.session.access_token)}&refresh_token=${encodeURIComponent(data.session.refresh_token)}&email=${encodeURIComponent(data.user.email)}`;
            return;
          }

          safeRedirect('./');
        } else {
          // Email confirmation required
          errEl.textContent = 'Check your email to confirm your account.';
          errEl.classList.remove('hidden');
          errEl.classList.remove('text-amber-400', 'bg-amber-500/10', 'border-amber-500/30');
          errEl.classList.add('text-green-400', 'bg-green-500/10', 'border-green-500/30');
        }
      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
      } finally {
        btn.textContent = 'Create account';
        btn.disabled = false;
      }
    }

    // ── DOM event bindings (CSP-safe: no inline handlers) ──
    (function bindUiEvents() {
      var promoToggleBtn = document.getElementById('promoToggleBtn');
      var promoRow = document.getElementById('promoRow');
      if (promoToggleBtn && promoRow) {
        promoToggleBtn.addEventListener('click', function () {
          promoRow.classList.toggle('hidden');
        });
      }

      var promoInput = document.getElementById('promoCodeInput');
      if (promoInput) {
        promoInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            applyPromoCode();
          }
        });
      }

      var promoApplyBtn = document.getElementById('promoApplyBtn');
      if (promoApplyBtn) promoApplyBtn.addEventListener('click', applyPromoCode);

      var githubBtn = document.getElementById('loginWithGitHubBtn');
      if (githubBtn) githubBtn.addEventListener('click', loginWithGitHub);

      var googleBtn = document.getElementById('loginWithGoogleBtn');
      if (googleBtn) googleBtn.addEventListener('click', loginWithGoogle);

      var loginTab = document.getElementById('loginTab');
      if (loginTab) loginTab.addEventListener('click', function () { showTab('login'); });

      var registerTab = document.getElementById('registerTab');
      if (registerTab) registerTab.addEventListener('click', function () { showTab('register'); });

      var loginForm = document.getElementById('loginForm');
      if (loginForm) loginForm.addEventListener('submit', handleLogin);

      var showResetBtn = document.getElementById('showResetBtn');
      if (showResetBtn) showResetBtn.addEventListener('click', showResetForm);

      var resetBtn = document.getElementById('resetBtn');
      if (resetBtn) resetBtn.addEventListener('click', handleReset);

      var backToSigninBtn = document.getElementById('backToSigninBtn');
      if (backToSigninBtn) backToSigninBtn.addEventListener('click', hideResetForm);

      var registerForm = document.getElementById('registerForm');
      if (registerForm) registerForm.addEventListener('submit', handleRegister);
    })();
