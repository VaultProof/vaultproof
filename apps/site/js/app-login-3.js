(function() {
  const SUPABASE_URL = 'https://gwzkjiomemjlhtrdrlan.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o';
  const API = window.location.hostname.includes('dev.vaultproof')
    ? 'https://staging-api.vaultproof.dev/api/v1'
    : 'https://api.vaultproof.dev/api/v1';
  const IS_ENTERPRISE_HOST = window.location.hostname === 'enterprise.vaultproof.dev'
    || window.location.hostname.startsWith('enterprise.');
  const IS_INTERNAL_ADMIN_HOST = window.location.hostname === 'admin.vaultproof.dev'
    || window.location.hostname.startsWith('admin.');
  const IS_AZURE_CONTROL_PLANE_HOST = IS_ENTERPRISE_HOST || IS_INTERNAL_ADMIN_HOST;
  const INIT_API = IS_AZURE_CONTROL_PLANE_HOST
    ? `${window.location.origin}/api/v1/enterprise`
    : window.location.hostname.includes('dev.vaultproof')
      ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init'
      : 'https://init.vaultproof.dev/api/v1/init';
  const ACTIVE_ORG_STORAGE_KEY = 'vaultproof_active_org';
  const LOOP_KEY = 'vp_login_ts';
  const PROMO_KEY = 'vp_promo';
  const SSO_DOMAIN_KEY = 'vp_sso_domain';
  const LOCAL_AUTH_PREFIXES = ['vaultproof_', 'sb-'];

  const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const urlParams = new URLSearchParams(window.location.search);

  let isRedirecting = false;

  function $(id) {
    return document.getElementById(id);
  }

  function clearStoredAuth() {
    Object.keys(localStorage).forEach(function(key) {
      if (key.includes('auth-token') || LOCAL_AUTH_PREFIXES.some(function(prefix) { return key.startsWith(prefix); })) {
        localStorage.removeItem(key);
      }
    });
    sessionStorage.clear();
  }

  function getLoopHistory() {
    const now = Date.now();
    return JSON.parse(sessionStorage.getItem(LOOP_KEY) || '[]').filter(function(ts) {
      return now - ts < 5000;
    });
  }

  function safeRedirect(url) {
    if (isRedirecting) return;
    isRedirecting = true;
    const history = getLoopHistory();
    history.push(Date.now());
    sessionStorage.setItem(LOOP_KEY, JSON.stringify(history));
    window.location.replace(url);
  }

  function validatePromoCode(rawPromo) {
    return rawPromo && /^[A-Z0-9_-]{1,50}$/i.test(rawPromo) ? rawPromo.toUpperCase() : null;
  }

  function getSavedPromoCode() {
    return localStorage.getItem(PROMO_KEY);
  }

  function normalizeSsoDomain(value) {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed) return '';
    const normalized = trimmed.includes('@') ? trimmed.split('@').pop() : trimmed;
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized || '') ? normalized : '';
  }

  function setPromoMessage(text, tone) {
    const msg = $('promoCodeMsg');
    if (!msg) return;
    msg.textContent = text;
    msg.className = tone === 'error'
      ? 'text-xs text-amber-400 mt-1.5'
      : 'text-xs text-indigo-400 mt-1.5';
    msg.classList.remove('hidden');
  }

  function savePromoCode(code) {
    localStorage.setItem(PROMO_KEY, code);
    setPromoMessage(
      IS_AZURE_CONTROL_PLANE_HOST
        ? 'Code saved — your admin can apply it after enterprise access is approved.'
        : 'Code saved — will be applied after you sign up.',
      'info',
    );
  }

  function getCliContext() {
    const rawCliCallback = urlParams.get('cli_callback');
    const cliState = urlParams.get('state');
    if (!rawCliCallback) {
      return { cliCallback: null, cliState: cliState || '' };
    }
    try {
      const cbUrl = new URL(rawCliCallback);
      const safeProtocol = cbUrl.protocol === 'http:' || cbUrl.protocol === 'https:';
      const safeHost = cbUrl.hostname === 'localhost' || cbUrl.hostname === '127.0.0.1';
      if (safeProtocol && safeHost) {
        return { cliCallback: rawCliCallback, cliState: cliState || '' };
      }
      console.warn('cli_callback rejected: must be http/https on localhost');
    } catch {
      console.warn('cli_callback rejected: invalid URL');
    }
    return { cliCallback: null, cliState: cliState || '' };
  }

  function buildLoginRedirectUrl(cliContext, extraParams) {
    const promo = getSavedPromoCode();
    const params = new URLSearchParams();
    if (cliContext.cliCallback) {
      params.set('cli_callback', cliContext.cliCallback);
      if (cliContext.cliState) params.set('state', cliContext.cliState);
    }
    if (promo) params.set('promo', promo);
    if (extraParams && typeof extraParams === 'object') {
      Object.keys(extraParams).forEach(function(key) {
        const value = extraParams[key];
        if (value == null || value === '') return;
        params.set(key, String(value));
      });
    }
    const query = params.toString();
    return `${window.location.origin}/app/login${query ? '?' + query : ''}`;
  }

  function redirectToCli(cliContext, session, user) {
    if (!cliContext.cliCallback || !session) return false;
    const params = new URLSearchParams({
      token: session.access_token || '',
      refresh_token: session.refresh_token || '',
      email: (user && user.email) || (session.user && session.user.email) || '',
    });
    if (cliContext.cliState) params.set('state', cliContext.cliState);
    window.location.href = `${cliContext.cliCallback}?${params.toString()}`;
    return true;
  }

  function storeLocalSession(session, user) {
    if (!session) return;
    localStorage.setItem('vaultproof_token', session.access_token);
    if (session.refresh_token) {
      localStorage.setItem('vaultproof_refresh_token', session.refresh_token);
    }
    localStorage.setItem('vaultproof_user', JSON.stringify({
      id: (user && user.id) || (session.user && session.user.id) || '',
      email: (user && user.email) || (session.user && session.user.email) || '',
    }));
  }

  async function recordSsoStart(domain) {
    const emailHint = String($('loginEmail')?.value || $('regEmail')?.value || '').trim().toLowerCase();
    try {
      await fetch(`${INIT_API}/orgs/sso-started`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_domain: domain,
          email: emailHint || null,
        }),
      });
    } catch {
      // Best-effort only. Do not block SSO if audit preflight fails.
    }
  }

  async function redeemPendingPromo(session) {
    const pendingPromo = getSavedPromoCode();
    if (!pendingPromo || !session) return;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(function() { controller.abort(); }, 3000);
      const res = await fetch(`${API}/promo/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + session.access_token,
        },
        body: JSON.stringify({ code: pendingPromo }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.ok) localStorage.removeItem(PROMO_KEY);
    } catch (error) {
      console.error('Promo redeem failed or timed out:', error);
    }
  }

  async function resolveSsoMembership(session) {
    if (!session || !session.access_token || urlParams.get('auth') !== 'sso') return null;
    const domain = normalizeSsoDomain(urlParams.get('sso_domain') || localStorage.getItem(SSO_DOMAIN_KEY) || '');

    try {
      const res = await fetch(`${INIT_API}/orgs/resolve-sso`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          company_domain: domain || null,
        }),
      });
      const payload = await res.json().catch(function() { return null; });
      const data = payload && typeof payload === 'object' && payload.data ? payload.data : payload;
      if (!res.ok) {
        return {
          error: (data && data.error) || 'Could not resolve shared-workspace access after SSO login.',
        };
      }
      return data;
    } catch (error) {
      return {
        error: error && error.message ? error.message : 'Could not resolve shared-workspace access after SSO login.',
      };
    }
  }

  async function resolveDashboardRoute(session, ssoResolution) {
    if (!session || !session.access_token) return './';
    const enterpriseDashboardPath = IS_INTERNAL_ADMIN_HOST || urlParams.get('internal_admin') === 'true'
      ? '/internal/admin'
      : IS_ENTERPRISE_HOST
        ? './dashboard'
        : './control';
    if (IS_INTERNAL_ADMIN_HOST || urlParams.get('internal_admin') === 'true') return enterpriseDashboardPath;

    if (ssoResolution && ssoResolution.organization && ssoResolution.organization.id) {
      localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, ssoResolution.organization.id);
      return `${enterpriseDashboardPath}?org=${encodeURIComponent(ssoResolution.organization.id)}`;
    }

    if (ssoResolution && ssoResolution.resolution === 'pending_access') {
      const params = new URLSearchParams({ sso_access: 'pending' });
      if (ssoResolution.company_domain) params.set('sso_domain', ssoResolution.company_domain);
      if (ssoResolution.organization && ssoResolution.organization.name) {
        params.set('workspace', ssoResolution.organization.name);
      }
      return `${enterpriseDashboardPath}?${params.toString()}`;
    }

    try {
      const res = await fetch(`${INIT_API}/orgs`, {
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok) return './';

      const payload = await res.json().catch(function() { return null; });
      const data = payload && typeof payload === 'object' && payload.data ? payload.data : payload;
      const organizations = Array.isArray(data && data.organizations) ? data.organizations : [];
      const activeOrganizationId = data && data.active_organization_id ? data.active_organization_id : null;
      const activeOrganization = organizations.find(function(org) { return org.id === activeOrganizationId; }) || null;
      const sharedOrganization = organizations.find(function(org) { return org.kind && org.kind !== 'personal'; }) || null;

      if (activeOrganization && activeOrganization.kind && activeOrganization.kind !== 'personal') {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, activeOrganization.id);
        return `${enterpriseDashboardPath}?org=${encodeURIComponent(activeOrganization.id)}`;
      }
      if (sharedOrganization) {
        localStorage.setItem(ACTIVE_ORG_STORAGE_KEY, sharedOrganization.id);
        return `${enterpriseDashboardPath}?org=${encodeURIComponent(sharedOrganization.id)}`;
      }
      localStorage.removeItem(ACTIVE_ORG_STORAGE_KEY);

      const inviteRes = await fetch(`${INIT_API}/members`, {
        headers: {
          Authorization: 'Bearer ' + session.access_token,
          'Content-Type': 'application/json',
        },
      });
      if (inviteRes.ok) {
        const invitePayload = await inviteRes.json().catch(function() { return null; });
        const inviteData = invitePayload && typeof invitePayload === 'object' && invitePayload.data ? invitePayload.data : invitePayload;
        const pendingInvites = Array.isArray(inviteData && inviteData.pending_invitations_for_me)
          ? inviteData.pending_invitations_for_me
          : [];
        if (pendingInvites.length) {
          return enterpriseDashboardPath;
        }
      }

      return './';
    } catch (error) {
      console.warn('Dashboard route resolution failed:', error);
      return './';
    }
  }

  async function establishInternalAdminSession(session) {
    if (!IS_INTERNAL_ADMIN_HOST || !session || !session.access_token) return;
    const res = await fetch('/api/v1/internal-admin/session', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + session.access_token,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const payload = await res.json().catch(function() { return null; });
      throw new Error((payload && payload.error) || 'This account is not allowed to use the internal admin console.');
    }
  }

  async function finalizeAuthenticatedSession(session, user, cliContext) {
    if (!session) return;
    storeLocalSession(session, user);
    await establishInternalAdminSession(session);
    await redeemPendingPromo(session);
    if (redirectToCli(cliContext, session, user)) return;
    const ssoResolution = await resolveSsoMembership(session);
    if (ssoResolution?.error && urlParams.get('auth') === 'sso') {
      setSsoStatus(ssoResolution.error, 'error');
    }
    const dashboardRoute = await resolveDashboardRoute(session, ssoResolution);
    safeRedirect(dashboardRoute);
  }

  function showError(message) {
    const el = $('authError');
    if (!el) return;
    el.textContent = message;
    el.classList.remove('hidden');
  }

  function setSsoStatus(text, type) {
    const el = $('ssoStatus');
    if (!el) return;
    if (!text) {
      el.textContent = '';
      el.className = 'hidden';
      return;
    }
    el.textContent = text;
    el.className = '';
    setInlineStatus(el, text, type || 'info');
  }

  function setInlineStatus(el, text, type) {
    if (!el) return;
    el.textContent = text;
    el.classList.remove('hidden');
    if (type === 'success') {
      el.classList.remove('text-amber-400', 'bg-amber-500/10', 'border-amber-500/30');
      el.classList.add('text-green-400', 'bg-green-500/10', 'border-green-500/30');
    } else if (type === 'info') {
      el.className = 'p-3 rounded-lg text-sm bg-indigo-500/10 border border-indigo-500/30 text-indigo-400';
    } else {
      el.classList.remove('text-green-400', 'bg-green-500/10', 'border-green-500/30');
      el.classList.add('text-amber-400', 'bg-amber-500/10', 'border-amber-500/30');
    }
  }

  function showTab(tab) {
    const loginForm = $('loginForm');
    const registerForm = $('registerForm');
    const loginTab = $('loginTab');
    const registerTab = $('registerTab');
    if (loginForm) loginForm.classList.toggle('hidden', tab !== 'login');
    if (registerForm) registerForm.classList.toggle('hidden', tab !== 'register');
    if (loginTab) loginTab.className = tab === 'login'
      ? 'flex-1 py-2 text-sm font-medium rounded-md bg-[#6366f1] text-white transition-all duration-200 cursor-pointer'
      : 'flex-1 py-2 text-sm font-medium rounded-md text-gray-500 hover:text-gray-300 transition-all duration-200 cursor-pointer';
    if (registerTab) registerTab.className = tab === 'register'
        ? 'flex-1 py-2 text-sm font-medium rounded-md bg-[#6366f1] text-white transition-all duration-200 cursor-pointer'
        : 'flex-1 py-2 text-sm font-medium rounded-md text-gray-500 hover:text-gray-300 transition-all duration-200 cursor-pointer';
  }

  function showResetForm() {
    $('loginForm').classList.add('hidden');
    $('resetForm').classList.remove('hidden');
  }

  function hideResetForm() {
    $('resetForm').classList.add('hidden');
    $('loginForm').classList.remove('hidden');
  }

  async function loginWithProvider(provider, cliContext) {
    const { error } = await sbClient.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: buildLoginRedirectUrl(cliContext),
        scopes: provider === 'azure' ? 'email' : undefined,
      },
    });
    if (error) showError(error.message);
  }

  async function loginWithSso(cliContext) {
    const button = $('ssoContinueBtn');
    const rawDomain = $('ssoDomainInput')?.value || '';
    const domain = normalizeSsoDomain(rawDomain);
    if (!domain) {
      setSsoStatus('Enter a valid company domain or work email to continue with SSO.', 'error');
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = 'starting sso...';
    }
    setSsoStatus(`Starting SSO for ${domain}...`, 'info');

    try {
      localStorage.setItem(SSO_DOMAIN_KEY, domain);
      await recordSsoStart(domain);
      const { data, error } = await sbClient.auth.signInWithSSO({
        domain,
        options: {
          redirectTo: buildLoginRedirectUrl(cliContext, { auth: 'sso', sso_domain: domain }),
        },
      });
      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      setSsoStatus('Supabase did not return an SSO redirect URL for that domain.', 'error');
    } catch (error) {
      const message = error && error.message
        ? error.message
        : 'Could not start SSO for that domain.';
      setSsoStatus(message, 'error');
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = 'continue with sso';
      }
    }
  }

  async function resendConfirmation() {
    const email = $('loginEmail').value;
    if (!email) return;
    const { error } = await sbClient.auth.resend({
      type: 'signup',
      email,
      options: { emailRedirectTo: window.location.origin + '/app/login' },
    });
    const errEl = $('loginError');
    if (error) {
      errEl.textContent = error.message;
    } else {
      errEl.innerHTML = 'Confirmation email resent! Check your inbox.';
      setInlineStatus(errEl, errEl.textContent, 'success');
    }
  }

  function attachConfirmationHelp(errEl, message) {
    errEl.textContent = message;
    if (message.toLowerCase().includes('not confirmed')) {
      errEl.appendChild(document.createElement('br'));
      const button = document.createElement('button');
      button.type = 'button';
      button.onclick = resendConfirmation;
      button.className = 'mt-2 text-indigo-400 hover:underline text-xs';
      button.textContent = 'Resend confirmation email';
      errEl.appendChild(button);
    }
    errEl.classList.remove('hidden');
  }

  async function handleLogin(event, cliContext) {
    event.preventDefault();
    const btn = $('loginBtn');
    const errEl = $('loginError');
    errEl.classList.add('hidden');
    btn.textContent = 'Signing in...';
    btn.disabled = true;

    try {
      const { data, error } = await sbClient.auth.signInWithPassword({
        email: $('loginEmail').value,
        password: $('loginPassword').value,
      });
      if (error) throw error;
      await finalizeAuthenticatedSession(data.session, data.user, cliContext);
    } catch (error) {
      attachConfirmationHelp(errEl, error.message);
    } finally {
      btn.textContent = 'Sign in';
      btn.disabled = false;
    }
  }

  async function handleRegister(event, cliContext) {
    event.preventDefault();
    const btn = $('regBtn');
    const errEl = $('regError');
    errEl.classList.add('hidden');
    btn.textContent = 'Creating account...';
    btn.disabled = true;

    try {
      const { data, error } = await sbClient.auth.signUp({
        email: $('regEmail').value,
        password: $('regPassword').value,
        options: { emailRedirectTo: window.location.origin + '/app/login' },
      });
      if (error) throw error;

      if (data.session) {
        await finalizeAuthenticatedSession(data.session, data.user, cliContext);
      } else {
        setInlineStatus(errEl, 'Check your email to confirm your account.', 'success');
      }
    } catch (error) {
      errEl.textContent = error.message;
      errEl.classList.remove('hidden');
    } finally {
      btn.textContent = 'Create account';
      btn.disabled = false;
    }
  }

  async function handleReset() {
    const email = $('resetEmail').value;
    const btn = $('resetBtn');
    const status = $('resetStatus');

    btn.textContent = 'Sending...';
    btn.disabled = true;

    const { error } = await sbClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/app/login',
    });

    if (error) {
      setInlineStatus(status, error.message, 'error');
    } else {
      setInlineStatus(status, 'Reset link sent! Check your email.', 'info');
    }

    btn.textContent = 'Send reset link';
    btn.disabled = false;
  }

  function prefillPromoFromUrl() {
    const promoParam = validatePromoCode(urlParams.get('promo'));
    if (!promoParam) return;
    localStorage.setItem(PROMO_KEY, promoParam);
    if (urlParams.get('code')) return;
    const input = $('promoCodeInput');
    const row = $('promoRow');
    if (input && row) {
      input.value = promoParam;
      row.classList.remove('hidden');
      setPromoMessage(
        IS_AZURE_CONTROL_PLANE_HOST
          ? 'Code saved — your admin can apply it after enterprise access is approved.'
          : 'Code saved — will be applied after you sign up.',
        'info',
      );
    }
  }

  function prefillSsoDomainFromState() {
    const fromUrl = normalizeSsoDomain(urlParams.get('sso_domain') || '');
    const fromStorage = normalizeSsoDomain(localStorage.getItem(SSO_DOMAIN_KEY) || '');
    const input = $('ssoDomainInput');
    if (!input) return;
    input.value = fromUrl || fromStorage || '';
  }

  function showCliBanner(cliContext) {
    if (!cliContext.cliCallback) return;
    const banner = document.createElement('div');
    banner.className = 'p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-sm text-indigo-400 mb-4 text-center';
    banner.textContent = 'Signing in from VaultProof CLI — log in below to connect.';
    const target = $('authCard');
    if (target) target.prepend(banner);
  }

  async function applyPromoCode() {
    const input = $('promoCodeInput');
    const code = validatePromoCode(input.value.trim());
    if (!code) {
      setPromoMessage(input.value.trim() ? 'Invalid code format.' : 'Enter a code first.', 'error');
      return;
    }

    try {
      const res = await fetch(`${API}/promo/check/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!data.valid || data.spotsLeft <= 0) {
        setPromoMessage('This promo has ended — all spots claimed.', 'error');
        return;
      }
      savePromoCode(code);
    } catch {
      savePromoCode(code);
    }
  }

  function handleScannerCallbackHijack() {
    const confirmCode = urlParams.get('code');
    const callbackState = urlParams.get('state');
    const isScannerGitHubCallback = urlParams.get('github_callback') === '1';
    if (isScannerGitHubCallback && confirmCode && callbackState) {
      const scannerParams = new URLSearchParams({
        github_callback: '1',
        code: confirmCode,
        state: callbackState,
      });
      window.location.replace('/app/scanner?' + scannerParams.toString());
      return true;
    }
    return false;
  }

  function handleLogoutFlow() {
    const forceLogout = urlParams.get('logout') === '1';
    if (!forceLogout) return false;
    clearStoredAuth();
    sbClient.auth.signOut({ scope: 'global' }).catch(function() {});
    if (!urlParams.get('code')) {
      window.history.replaceState({}, '', '/app/login');
    }
    return true;
  }

  function detectAndBreakLoops() {
    const loopHistory = getLoopHistory();
    if (loopHistory.length >= 3) {
      sessionStorage.removeItem(LOOP_KEY);
      localStorage.removeItem('vaultproof_token');
      localStorage.removeItem('vaultproof_user');
      localStorage.removeItem(PROMO_KEY);
      console.warn('Login loop detected — cleared local auth state');
    }
    return loopHistory.length;
  }

  async function handleCodeExchange(cliContext) {
    const confirmCode = urlParams.get('code');
    if (!confirmCode) return;
    try {
      const { data, error } = await sbClient.auth.exchangeCodeForSession(confirmCode);
      if (!error && data.session) {
        if (urlParams.get('auth') === 'sso') {
          setSsoStatus(`SSO login completed for ${normalizeSsoDomain(urlParams.get('sso_domain') || localStorage.getItem(SSO_DOMAIN_KEY) || '') || 'your workspace'}. Routing now...`, 'success');
        }
        await finalizeAuthenticatedSession(data.session, data.user, cliContext);
      } else if (error && !isRedirecting) {
        setTimeout(function() {
          if (!isRedirecting) {
            if (urlParams.get('auth') === 'sso') {
              setSsoStatus(error.message || 'SSO sign-in failed. Try another sign-in method or confirm the company domain is configured.', 'error');
            } else {
              showError('Email confirmation failed. Please try logging in with your email and password.');
            }
          }
        }, 800);
      }
    } catch {}
  }

  async function handleExistingSession(cliContext, forceLogout, loopCount) {
    if (forceLogout || urlParams.get('code') || loopCount >= 3) return;
    const result = await sbClient.auth.getSession();
    const session = result.data && result.data.session;
    if (session && !isRedirecting) {
      await finalizeAuthenticatedSession(session, session.user, cliContext);
    }
  }

  function bindAuthState(cliContext, forceLogout) {
    sbClient.auth.onAuthStateChange(async function(event, session) {
      if (event === 'SIGNED_IN' && session && !isRedirecting && !forceLogout) {
        await finalizeAuthenticatedSession(session, session.user, cliContext);
      }
    });
  }

  function bindUiEvents(cliContext) {
    const promoToggleBtn = $('promoToggleBtn');
    const promoRow = $('promoRow');
    if (promoToggleBtn && promoRow) {
      promoToggleBtn.addEventListener('click', function() {
        promoRow.classList.toggle('hidden');
      });
    }

    const promoInput = $('promoCodeInput');
    if (promoInput) {
      promoInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          applyPromoCode();
        }
      });
    }

    const promoApplyBtn = $('promoApplyBtn');
    if (promoApplyBtn) promoApplyBtn.addEventListener('click', applyPromoCode);

    const githubBtn = $('loginWithGitHubBtn');
    if (githubBtn) githubBtn.addEventListener('click', function() { loginWithProvider('github', cliContext); });

    const googleBtn = $('loginWithGoogleBtn');
    if (googleBtn) googleBtn.addEventListener('click', function() { loginWithProvider('google', cliContext); });

    const microsoftBtn = $('loginWithMicrosoftBtn');
    if (microsoftBtn) microsoftBtn.addEventListener('click', function() { loginWithProvider('azure', cliContext); });

    const ssoContinueBtn = $('ssoContinueBtn');
    if (ssoContinueBtn) ssoContinueBtn.addEventListener('click', function() { loginWithSso(cliContext); });

    const ssoDomainInput = $('ssoDomainInput');
    if (ssoDomainInput) {
      ssoDomainInput.addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
          event.preventDefault();
          loginWithSso(cliContext);
        }
      });
    }

    const loginTab = $('loginTab');
    if (loginTab) loginTab.addEventListener('click', function() { showTab('login'); });

    const registerTab = $('registerTab');
    if (registerTab) registerTab.addEventListener('click', function() { showTab('register'); });

    const loginForm = $('loginForm');
    if (loginForm) loginForm.addEventListener('submit', function(event) { handleLogin(event, cliContext); });

    const showResetBtn = $('showResetBtn');
    if (showResetBtn) showResetBtn.addEventListener('click', showResetForm);

    const resetBtn = $('resetBtn');
    if (resetBtn) resetBtn.addEventListener('click', handleReset);

    const backToSigninBtn = $('backToSigninBtn');
    if (backToSigninBtn) backToSigninBtn.addEventListener('click', hideResetForm);

    const registerForm = $('registerForm');
    if (registerForm) registerForm.addEventListener('submit', function(event) { handleRegister(event, cliContext); });
  }

  async function init() {
    if (handleScannerCallbackHijack()) return;

    const forceLogout = handleLogoutFlow();
    const loopCount = detectAndBreakLoops();
    const cliContext = getCliContext();

    prefillPromoFromUrl();
    prefillSsoDomainFromState();
    showCliBanner(cliContext);
    bindUiEvents(cliContext);
    bindAuthState(cliContext, forceLogout);

    await handleCodeExchange(cliContext);
    await handleExistingSession(cliContext, forceLogout, loopCount);
  }

  init();
})();
