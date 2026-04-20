// ── Supabase client ──
    const _sb = window.supabase.createClient(
      'https://gwzkjiomemjlhtrdrlan.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd3emtqaW9tZW1qbGh0cmRybGFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzNDM3ODIsImV4cCI6MjA4OTkxOTc4Mn0.tgHUvpBvFiojetuqIP0sKb0iBNbKDJHdeo9n3Tofa3o'
    );

    const INIT_API = window.location.hostname.includes('dev.vaultproof')
      ? 'https://vaultproof-init-staging.vaultproof.workers.dev/api/v1/init/projects'
      : 'https://init.vaultproof.dev/api/v1/init/projects';
    const MCP_CALLBACK = 'https://mcp.vaultproof.dev/oauth/callback';

    // ── Client ID → display name mapping ──
    const CLIENT_NAMES = {
      'claude-desktop': 'Claude Desktop',
      'cursor': 'Cursor',
      'vaultproof-cli': 'VaultProof CLI'
    };

    // ── Scope descriptions ──
    const SCOPE_INFO = {
      'keys:read': {
        label: 'View your stored API keys',
        desc: 'Provider and label only, not the actual keys',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M1 12S5 4 12 4C19 4 23 12 23 12S19 20 12 20C5 20 1 12 1 12Z" stroke="#818cf8" stroke-width="1.5" stroke-linecap="round"/><circle cx="12" cy="12" r="3" stroke="#818cf8" stroke-width="1.5"/></svg>'
      },
      'keys:write': {
        label: 'Store new API keys',
        desc: 'Save new keys to your vault',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5V19M5 12H19" stroke="#818cf8" stroke-width="1.5" stroke-linecap="round"/></svg>'
      },
      'usage:read': {
        label: 'View usage statistics',
        desc: 'Your usage stats and rate limits',
        icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M3 3V21H21" stroke="#818cf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 16L12 11L15 14L21 8" stroke="#818cf8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      }
    };

    // ── Parse URL parameters ──
    const params = new URLSearchParams(window.location.search);
    const oauthParams = {
      client_id: params.get('client_id'),
      redirect_uri: params.get('redirect_uri'),
      code_challenge: params.get('code_challenge'),
      code_challenge_method: params.get('code_challenge_method'),
      scope: params.get('scope'),
      state: params.get('state'),
      state_sig: params.get('state_sig'),
      resource: params.get('resource')
    };

    // ── Validate required params ──
    const REQUIRED = ['client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'state_sig'];
    const missing = REQUIRED.filter(function(k) { return !oauthParams[k]; });

    if (missing.length > 0) {
      document.getElementById('errorMsg').textContent = 'Missing required parameters: ' + missing.join(', ');
      document.getElementById('errorView').classList.remove('hidden');
    } else {
      init();
    }

    // ── Resolve client display name ──
    function getClientName(clientId) {
      if (CLIENT_NAMES[clientId]) return CLIENT_NAMES[clientId];
      // Dynamic clients (dyn_...) — show generic name rather than raw ID
      if (clientId && clientId.startsWith('dyn_')) return 'MCP Client';
      return clientId;
    }

    // ── Render scope list ──
    function renderScopes(scopeStr) {
      var container = document.getElementById('scopeList');
      var scopes = scopeStr.split(' ').filter(Boolean);
      scopes.forEach(function(s) {
        var info = SCOPE_INFO[s] || { label: s, desc: '', icon: '' };
        var row = document.createElement('div');
        row.className = 'flex items-start gap-3 bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-3.5 py-3';
        row.innerHTML =
          '<div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2)">' +
            info.icon +
          '</div>' +
          '<div>' +
            '<p class="text-sm font-medium text-white">' + info.label + '</p>' +
            '<p class="text-xs text-gray-500 mt-0.5">' + info.desc + '</p>' +
          '</div>';
        container.appendChild(row);
      });
    }

    // ── Initialize ──
    async function init() {
      var clientName = getClientName(oauthParams.client_id);

      // Set client name in login view
      var loginClientEl = document.getElementById('loginClientName');
      if (loginClientEl) loginClientEl.textContent = clientName;

      // Check existing session
      var { data } = await _sb.auth.getSession();
      if (data.session) {
        showConsent(data.session);
      } else {
        document.getElementById('loginView').classList.remove('hidden');
      }

      // Listen for auth state changes (OAuth callback)
      _sb.auth.onAuthStateChange(async function(event, session) {
        if (event === 'SIGNED_IN' && session) {
          document.getElementById('loginView').classList.add('hidden');
          showConsent(session);
        }
      });
    }

    // ── Show consent screen ──
    function showConsent(session) {
      var clientName = getClientName(oauthParams.client_id);
      document.getElementById('clientName').textContent = clientName;
      document.getElementById('userEmail').textContent = session.user.email;
      renderScopes(oauthParams.scope);
      document.getElementById('consentView').classList.remove('hidden');
    }

    // ── Login handlers ──
    async function handleLogin(e) {
      e.preventDefault();
      var btn = document.getElementById('loginBtn');
      var errEl = document.getElementById('loginError');
      errEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Signing in...';

      var email = document.getElementById('emailInput').value.trim();
      var password = document.getElementById('passwordInput').value;

      var { data, error } = await _sb.auth.signInWithPassword({ email: email, password: password });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Sign in';
        return;
      }

      document.getElementById('loginView').classList.add('hidden');
      showConsent(data.session);
    }

    async function loginWithGitHub() {
      await _sb.auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.href }
      });
    }

    async function loginWithGoogle() {
      await _sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
      });
    }

    // ── Ensure MCP project token ──
    async function getOrCreateMcpProjectToken(session, clientName) {
      var label = 'MCP: ' + clientName;

      // 1) Reuse existing MCP-specific project if present
      var listRes = await fetch(INIT_API, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + session.access_token,
          'Content-Type': 'application/json'
        }
      });
      if (!listRes.ok) {
        var listErr = await listRes.json().catch(function() { return {}; });
        throw new Error(listErr.error || 'Failed to list projects');
      }

      var listData = await listRes.json().catch(function() { return {}; });
      var projects = Array.isArray(listData.projects) ? listData.projects : [];
      var existing = projects.find(function(p) { return p && p.name === label; });
      if (existing && (existing.vp_proj_id || existing.vpProjId)) {
        return existing.vp_proj_id || existing.vpProjId;
      }

      // 2) Create one if missing
      var createRes = await fetch(INIT_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + session.access_token
        },
        body: JSON.stringify({ name: label })
      });
      if (!createRes.ok) {
        var createErr = await createRes.json().catch(function() { return {}; });
        throw new Error(createErr.error || 'Failed to create project token');
      }

      var createData = await createRes.json().catch(function() { return {}; });
      return createData.vp_proj_id || createData.vpProjId || createData.project_id || null;
    }

    // ── Authorize ──
    async function handleAuthorize() {
      var btn = document.getElementById('authorizeBtn');
      var errEl = document.getElementById('consentError');
      errEl.classList.add('hidden');
      btn.disabled = true;
      btn.textContent = 'Authorizing...';

      try {
        var { data: sessionData } = await _sb.auth.getSession();
        if (!sessionData.session) throw new Error('Session expired. Please sign in again.');

        var session = sessionData.session;
        var clientName = getClientName(oauthParams.client_id);

        // Reuse or create a project token dedicated to this MCP client
        var projectToken = await getOrCreateMcpProjectToken(session, clientName);
        if (!projectToken) throw new Error('Could not create a project token. Please try again.');

        // POST to MCP callback
        var body = {
          user_id: session.user.id,
          project_id: projectToken,
          // Backward-compatible field name expected by older callback handlers
          dev_key: projectToken,
          client_id: oauthParams.client_id,
          redirect_uri: oauthParams.redirect_uri,
          code_challenge: oauthParams.code_challenge,
          scope: oauthParams.scope,
          state: oauthParams.state,
          state_sig: oauthParams.state_sig
        };
        if (oauthParams.resource) {
          body.resource = oauthParams.resource;
        }

        var res = await fetch(MCP_CALLBACK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });

        if (!res.ok) {
          var errBody = await res.json().catch(function() { return {}; });
          throw new Error(errBody.error || 'Authorization failed (' + res.status + ')');
        }

        var result = await res.json();

        // Show success, redirect to client, then try to close tab
        btn.textContent = 'Authorized! Redirecting...';
        btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        btn.classList.add('bg-gray-700');

        var redirectUrl = new URL(result.redirect_uri || oauthParams.redirect_uri);
        redirectUrl.searchParams.set('code', result.code);
        redirectUrl.searchParams.set('state', result.state || oauthParams.state);

        // Brief delay so user sees success, then redirect
        await new Promise(function(r) { setTimeout(r, 500); });
        window.location.replace(redirectUrl.toString());

        // Try to close the tab after redirect (works if opened by script)
        setTimeout(function() { window.close(); }, 2000);

      } catch (err) {
        errEl.textContent = err.message;
        errEl.classList.remove('hidden');
        btn.disabled = false;
        btn.textContent = 'Authorize';
      }
    }

    // ── Deny ──
    function handleDeny() {
      var redirectUrl = new URL(oauthParams.redirect_uri);
      redirectUrl.searchParams.set('error', 'access_denied');
      redirectUrl.searchParams.set('state', oauthParams.state);
      window.location.replace(redirectUrl.toString());
    }

    // ── DOM bindings ──
    (function bindUiEvents() {
      var githubBtn = document.getElementById('loginWithGitHubBtn');
      if (githubBtn) githubBtn.addEventListener('click', loginWithGitHub);

      var googleBtn = document.getElementById('loginWithGoogleBtn');
      if (googleBtn) googleBtn.addEventListener('click', loginWithGoogle);

      var loginForm = document.getElementById('loginForm');
      if (loginForm) loginForm.addEventListener('submit', handleLogin);

      var denyBtn = document.getElementById('denyBtn');
      if (denyBtn) denyBtn.addEventListener('click', handleDeny);

      var authorizeBtn = document.getElementById('authorizeBtn');
      if (authorizeBtn) authorizeBtn.addEventListener('click', handleAuthorize);
    })();
