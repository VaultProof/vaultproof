#!/usr/bin/env node

const DEFAULT_ENTERPRISE_URL = 'https://enterprise.vaultproof.dev';

const enterpriseUrl = normalizeBaseUrl(process.env.ENTERPRISE_URL || DEFAULT_ENTERPRISE_URL);
const pilotEmail = (process.env.ENTERPRISE_PILOT_EMAIL || process.env.DEMO_EMAIL || 'ken@vaultproof.dev').trim().toLowerCase();
const providedAccessToken = (process.env.ENTERPRISE_TEST_ACCESS_TOKEN || process.env.ACCESS_TOKEN || '').trim();
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
const requireSession = process.env.LOGIN_QA_REQUIRE_SESSION === 'true';
const oauthProvider = (process.env.LOGIN_QA_OAUTH_PROVIDER || '').trim().toLowerCase();
const loginRedirect = `${enterpriseUrl}/app/login`;

const steps = [];
const warnings = [];
const blockers = [];

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function pushStep(step) {
  steps.push({
    ...step,
    durationMs: step.durationMs || 0,
  });
}

function tail(value, max = 2000) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  return `...${text.slice(text.length - max)}`;
}

function buildEnterpriseUrl(path) {
  return new URL(path, `${enterpriseUrl}/`).toString();
}

function parseJwtPayload(token) {
  try {
    const payloadPart = String(token || '').split('.')[1] || '';
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function supabaseProjectRef(supabaseUrl) {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0] || '';
  } catch {
    return '';
  }
}

async function fetchText(url, options = {}) {
  const startedAt = Date.now();
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      accept: 'text/html,application/json,text/plain,*/*',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return {
    response,
    text,
    durationMs: Date.now() - startedAt,
  };
}

async function checkLoginPage() {
  const startedAt = Date.now();
  const step = {
    name: 'Enterprise login page',
    command: `GET ${loginRedirect}`,
    status: 'fail',
    durationMs: 0,
  };

  try {
    const { response, text, durationMs } = await fetchText(loginRedirect);
    step.durationMs = durationMs;
    step.statusCode = response.status;
    if (!response.ok) {
      throw new Error(`login page returned HTTP ${response.status}`);
    }
    const requiredSnippets = [
      '/app/enterprise-login.js',
      'id="loginWithGoogleBtn"',
      'id="magicLinkBtn"',
      'id="ssoContinueBtn"',
    ];
    const missing = requiredSnippets.filter((snippet) => !text.includes(snippet));
    if (missing.length) {
      throw new Error(`login page is missing expected login controls: ${missing.join(', ')}`);
    }
    step.status = 'pass';
    pushStep(step);
  } catch (error) {
    step.durationMs = Date.now() - startedAt;
    step.outputTail = error instanceof Error ? error.message : 'login page check failed';
    blockers.push({ name: 'enterprise login page', detail: step.outputTail });
    pushStep(step);
  }
}

async function discoverPublicSupabaseConfig() {
  const startedAt = Date.now();
  const step = {
    name: 'Public Supabase login config',
    command: `GET ${enterpriseUrl}/app/enterprise-login.js`,
    status: 'fail',
    durationMs: 0,
  };

  try {
    const { response, text, durationMs } = await fetchText(buildEnterpriseUrl('/app/enterprise-login.js'), {
      headers: { accept: 'application/javascript,text/plain,*/*' },
    });
    step.durationMs = durationMs;
    step.statusCode = response.status;
    if (!response.ok) {
      throw new Error(`enterprise login script returned HTTP ${response.status}`);
    }

    const supabaseUrl = text.match(/const SUPABASE_URL = ["']([^"']+)["']/)?.[1] || '';
    const supabaseAnonKey = text.match(/const SUPABASE_ANON_KEY = ["']([^"']+)["']/)?.[1] || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('could not discover Supabase URL and anon key from enterprise login script');
    }

    const payload = parseJwtPayload(supabaseAnonKey);
    const projectRef = supabaseProjectRef(supabaseUrl);
    if (!payload || payload.role !== 'anon') {
      throw new Error('Supabase public key is not an anon JWT');
    }
    if (payload.ref && projectRef && payload.ref !== projectRef) {
      throw new Error(`Supabase anon key ref ${payload.ref} does not match URL ref ${projectRef}`);
    }

    const requiredSnippets = [
      'redirectTo: buildLoginRedirectUrl(cliContext)',
      "emailRedirectTo: window.location.origin + '/app/login'",
      'auth: \'magic\'',
      'auth: \'recovery\'',
      'provider === \'azure\'',
    ];
    const missing = requiredSnippets.filter((snippet) => !text.includes(snippet));
    if (missing.length) {
      throw new Error(`login script is missing expected redirect/session logic: ${missing.join(', ')}`);
    }

    step.status = 'pass';
    step.supabaseRef = projectRef || payload.ref || 'unknown';
    step.jwtRole = payload.role;
    step.jwtIssuer = payload.iss || 'unknown';
    pushStep(step);
    return { supabaseUrl, supabaseAnonKey, scriptText: text };
  } catch (error) {
    step.durationMs = Date.now() - startedAt;
    step.outputTail = error instanceof Error ? error.message : 'public Supabase config check failed';
    blockers.push({ name: 'public Supabase login config', detail: step.outputTail });
    pushStep(step);
    return null;
  }
}

async function checkOAuthAuthorize(publicConfig) {
  if (!oauthProvider || !publicConfig) {
    if (!oauthProvider) {
      warnings.push({
        name: 'OAuth provider redirect check skipped',
        detail: 'Set LOGIN_QA_OAUTH_PROVIDER=google, github, or azure to verify the provider authorize redirect.',
      });
    }
    return;
  }

  const startedAt = Date.now();
  const step = {
    name: 'OAuth authorize redirect',
    command: `GET ${publicConfig.supabaseUrl}/auth/v1/authorize?provider=${oauthProvider}`,
    status: 'fail',
    durationMs: 0,
  };

  try {
    const authorizeUrl = new URL('/auth/v1/authorize', publicConfig.supabaseUrl);
    authorizeUrl.searchParams.set('provider', oauthProvider);
    authorizeUrl.searchParams.set('redirect_to', loginRedirect);
    const { response, text, durationMs } = await fetchText(authorizeUrl.toString(), {
      headers: {
        apikey: publicConfig.supabaseAnonKey,
        authorization: `Bearer ${publicConfig.supabaseAnonKey}`,
      },
    });
    step.durationMs = durationMs;
    step.statusCode = response.status;
    const location = response.headers.get('location') || '';
    step.redirectHost = location ? new URL(location, publicConfig.supabaseUrl).hostname : '';

    if (![302, 303].includes(response.status) || !location) {
      throw new Error(`Supabase did not return an OAuth redirect for ${oauthProvider}: HTTP ${response.status} ${tail(text, 300)}`);
    }
    if (/error=|error_description=/i.test(location)) {
      throw new Error(`Supabase OAuth redirect contains an error for ${oauthProvider}`);
    }

    step.status = 'pass';
    pushStep(step);
  } catch (error) {
    step.durationMs = Date.now() - startedAt;
    step.outputTail = error instanceof Error ? error.message : 'OAuth authorize redirect check failed';
    blockers.push({ name: 'OAuth authorize redirect', detail: step.outputTail });
    pushStep(step);
  }
}

async function getTestAccessToken(publicConfig) {
  if (!publicConfig) return '';

  const startedAt = Date.now();
  const step = {
    name: 'Supabase login redirect/session',
    command: providedAccessToken
      ? 'Use provided ENTERPRISE_TEST_ACCESS_TOKEN'
      : `Supabase magic-link session for ${pilotEmail}`,
    status: 'skipped',
    durationMs: 0,
  };

  if (providedAccessToken) {
    step.status = 'pass';
    step.reason = 'provided access token';
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
    return providedAccessToken;
  }

  if (!serviceRoleKey) {
    const detail = 'Set SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SERVICE_KEY to verify allowed redirect URLs and generate a temporary login session.';
    step.reason = detail;
    step.durationMs = Date.now() - startedAt;
    if (requireSession) {
      step.status = 'fail';
      step.outputTail = detail;
      blockers.push({ name: 'Supabase login redirect/session', detail });
    } else {
      warnings.push({ name: 'Supabase login redirect/session skipped', detail });
    }
    pushStep(step);
    return '';
  }

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(publicConfig.supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const anon = createClient(publicConfig.supabaseUrl, publicConfig.supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: pilotEmail,
      options: {
        redirectTo: loginRedirect,
      },
    });
    if (linkError) throw linkError;

    const emailOtp = linkData?.properties?.email_otp || '';
    const tokenHash = linkData?.properties?.hashed_token || '';
    if (!emailOtp && !tokenHash) {
      throw new Error('Supabase did not return an email OTP or hashed token for the generated magic link.');
    }

    const verifyArgs = emailOtp
      ? { email: pilotEmail, token: emailOtp, type: 'magiclink' }
      : { token_hash: tokenHash, type: 'magiclink' };
    const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp(verifyArgs);
    if (verifyError) throw verifyError;

    const accessToken = verifyData?.session?.access_token || '';
    if (!accessToken) {
      throw new Error('Supabase OTP verification did not return an access token.');
    }

    step.status = 'pass';
    step.userEmail = verifyData?.user?.email || pilotEmail;
    step.redirectVerified = true;
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
    return accessToken;
  } catch (error) {
    step.status = 'fail';
    step.outputTail = error instanceof Error ? error.message : 'failed to generate Supabase login session';
    step.durationMs = Date.now() - startedAt;
    blockers.push({ name: 'Supabase login redirect/session', detail: step.outputTail });
    pushStep(step);
    return '';
  }
}

async function fetchEnterpriseJson(path, accessToken, extraHeaders = {}) {
  const { response, text, durationMs } = await fetchText(buildEnterpriseUrl(path), {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      ...extraHeaders,
    },
  });
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { response, body, text, durationMs };
}

async function checkAuthenticatedEnterpriseApis(accessToken) {
  if (!accessToken) return;

  const startedAt = Date.now();
  const step = {
    name: 'Authenticated enterprise APIs',
    command: 'GET /api/v1/enterprise/orgs, /orgs/current, /projects/bootstrap',
    status: 'fail',
    durationMs: 0,
  };

  try {
    const orgs = await fetchEnterpriseJson('/api/v1/enterprise/orgs', accessToken);
    if (orgs.response.status !== 200) {
      throw new Error(`/api/v1/enterprise/orgs returned HTTP ${orgs.response.status}: ${tail(orgs.text, 600)}`);
    }
    const orgPayload = orgs.body?.data || orgs.body || {};
    const orgId = orgPayload.active_organization_id || orgPayload.organizations?.[0]?.id || '';
    if (!orgId) {
      throw new Error(`authenticated session returned no enterprise organizations: ${tail(orgs.text, 600)}`);
    }

    const orgHeader = { 'x-vaultproof-organization': orgId };
    const current = await fetchEnterpriseJson('/api/v1/enterprise/orgs/current', accessToken, orgHeader);
    if (current.response.status !== 200) {
      throw new Error(`/api/v1/enterprise/orgs/current returned HTTP ${current.response.status}: ${tail(current.text, 600)}`);
    }

    const bootstrap = await fetchEnterpriseJson('/api/v1/enterprise/projects/bootstrap', accessToken, orgHeader);
    if (bootstrap.response.status !== 200) {
      throw new Error(`/api/v1/enterprise/projects/bootstrap returned HTTP ${bootstrap.response.status}: ${tail(bootstrap.text, 600)}`);
    }

    step.status = 'pass';
    step.organization = orgId;
    step.orgsMs = orgs.durationMs;
    step.currentOrgMs = current.durationMs;
    step.bootstrapMs = bootstrap.durationMs;
    step.durationMs = Date.now() - startedAt;
    pushStep(step);
  } catch (error) {
    step.durationMs = Date.now() - startedAt;
    step.outputTail = error instanceof Error ? error.message : 'authenticated enterprise API check failed';
    blockers.push({ name: 'authenticated enterprise APIs', detail: step.outputTail });
    pushStep(step);
  }
}

await checkLoginPage();
const publicConfig = await discoverPublicSupabaseConfig();
await checkOAuthAuthorize(publicConfig);
const accessToken = await getTestAccessToken(publicConfig);
await checkAuthenticatedEnterpriseApis(accessToken);

const result = {
  status: blockers.length ? 'blocked' : 'ok',
  enterpriseUrl,
  loginRedirect,
  pilotEmail,
  options: {
    requireSession,
    oauthProvider: oauthProvider || 'not requested',
    providedAccessToken: providedAccessToken ? 'yes' : 'no',
    serviceRoleKey: serviceRoleKey ? 'available' : 'not provided',
  },
  steps,
  warnings,
  blockers,
};

console.log(JSON.stringify(result, null, 2));

if (blockers.length) {
  process.exit(1);
}
