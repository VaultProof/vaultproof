const DEFAULT_ENTERPRISE_URL = 'https://enterprise.vaultproof.dev';
const DEFAULT_ADMIN_URL = 'https://admin.vaultproof.dev';

const enterpriseUrl = normalizeBaseUrl(process.env.ENTERPRISE_URL || DEFAULT_ENTERPRISE_URL);
const adminUrl = normalizeBaseUrl(process.env.ADMIN_URL || DEFAULT_ADMIN_URL);
const demoEmail = process.env.ENTERPRISE_DEMO_EMAIL || process.env.DEMO_EMAIL || '';
const demoPassword = process.env.ENTERPRISE_DEMO_PASSWORD || process.env.DEMO_PASSWORD || '';
const expectedSecurityProfile = process.env.ENTERPRISE_EXPECTED_SECURITY_PROFILE || '';
const readinessRetries = Number.parseInt(process.env.READINESS_RETRIES || '3', 10);
const readinessRetryDelayMs = Number.parseInt(process.env.READINESS_RETRY_DELAY_MS || '3000', 10);

const requiredPublicPaths = [
  '/',
  '/app/login',
  '/app/enterprise-login.js',
  '/health',
  '/readiness',
];

const protectedAppPaths = [
  '/app',
  '/app/',
  '/app/dashboard',
  '/app/docs',
  '/app/evidence',
  '/app/security-review',
  '/app/control',
  '/app/members',
  '/app/audit',
  '/app/alerts',
  '/app/activity',
  '/app/projects',
  '/app/inventory',
  '/app/policy',
  '/app/rollout',
  '/app/keys',
  '/app/settings',
  '/app/plans',
  '/app/testers',
  '/app/release',
  '/app/scanner',
];

const requiredAppPaths = [
  ...requiredPublicPaths,
  ...protectedAppPaths,
];

const staffOnlyPaths = [
  '/app/launch',
  '/app/demo',
  '/app/onboarding',
  '/app/org',
  '/app/pilot',
  '/app/pilot-success',
  '/app/support',
];

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function buildUrl(path) {
  return new URL(path, `${enterpriseUrl}/`).toString();
}

function buildAdminUrl(path) {
  return new URL(path, `${adminUrl}/`).toString();
}

function unique(values) {
  return Array.from(new Set(values));
}

function isEnterpriseInternalHref(href) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) return false;
  const url = new URL(href, `${enterpriseUrl}/`);
  return url.origin === enterpriseUrl && (
    url.pathname === '/' ||
    url.pathname === '/health' ||
    url.pathname === '/readiness' ||
    url.pathname === '/app' ||
    url.pathname.startsWith('/app/') ||
    url.pathname.startsWith('/api/v1/enterprise/')
  );
}

function extractEnterpriseLinks(html) {
  const hrefs = [];
  for (const match of html.matchAll(/\s(?:href|src)=["']([^"']+)["']/gi)) {
    const href = match[1];
    if (isEnterpriseInternalHref(href)) {
      const url = new URL(href, `${enterpriseUrl}/`);
      hrefs.push(`${url.pathname}${url.search}`);
    }
  }
  return unique(hrefs);
}

async function fetchText(path, options = {}) {
  return fetchTextFromUrl(buildUrl(path), options);
}

async function fetchAdminText(path, options = {}) {
  return fetchTextFromUrl(buildAdminUrl(path), options);
}

async function fetchTextFromUrl(url, options = {}) {
  const response = await fetch(url, {
    redirect: 'manual',
    ...options,
    headers: {
      accept: 'text/html,application/json,text/plain,*/*',
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  return { response, text };
}

function assertNoBrokenEnterpriseBody(path, text) {
  if (text.includes('{"error":"Not found"') || text.includes('"error":"Not found"')) {
    throw new Error(`${path} returned or embedded a Not found API response`);
  }
  if (path !== '/app/enterprise-login.js' && (text.includes('https://init.vaultproof.dev') || text.includes('vaultproof-init-staging'))) {
    throw new Error(`${path} references the B2C init API`);
  }
  if (text.includes('https://api.vaultproof.dev/api/v1') && path !== '/app/enterprise-login.js') {
    throw new Error(`${path} references the B2C dashboard API`);
  }
}

async function assertPathOk(path) {
  const { response, text } = await fetchText(path);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${path} returned HTTP ${response.status}`);
  }
  assertNoBrokenEnterpriseBody(path, text);
  return text;
}

function isPublicEnterprisePath(path) {
  const pathname = new URL(path, `${enterpriseUrl}/`).pathname;
  return requiredPublicPaths.includes(pathname);
}

function isProtectedEnterpriseAppPath(path) {
  const pathname = new URL(path, `${enterpriseUrl}/`).pathname;
  return protectedAppPaths.includes(pathname)
    || (pathname.startsWith('/app/') && pathname !== '/app/login' && pathname !== '/app/enterprise-login.js');
}

async function assertProtectedRedirect(path) {
  const { response } = await fetchText(path);
  const location = response.headers.get('location') || '';
  if (![302, 303].includes(response.status) || !location.includes('/app/login')) {
    throw new Error(`${path} should redirect anonymous users to login, got HTTP ${response.status} location=${location}`);
  }
  return location;
}

async function assertReadiness() {
  let lastError;
  const attempts = Number.isFinite(readinessRetries) && readinessRetries > 0 ? readinessRetries : 1;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const { response, text } = await fetchText(`/readiness?qa_attempt=${attempt}&ts=${Date.now()}`, {
      headers: { accept: 'application/json' },
    });
    try {
      if (response.status !== 200) {
        throw new Error(`/readiness returned HTTP ${response.status}`);
      }
      const payload = JSON.parse(text);
      if (payload.production_ready !== true) {
        throw new Error(`/readiness production_ready is not true: ${text}`);
      }
      const allowedSecurityProfiles = [
        'azure-confidential-production',
        'google-confidential-production',
      ];
      if (expectedSecurityProfile && payload.security_profile !== expectedSecurityProfile) {
        throw new Error(`/readiness security_profile is not ${expectedSecurityProfile}: ${text}`);
      }
      if (!expectedSecurityProfile && !allowedSecurityProfiles.includes(payload.security_profile)) {
        throw new Error(`/readiness security_profile is not production-grade: ${text}`);
      }
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, readinessRetryDelayMs));
      }
    }
  }

  throw lastError;
}

async function assertPublicPagesAndLinks() {
  const discoveredLinks = [];
  for (const path of requiredPublicPaths) {
    const text = await assertPathOk(path);
    if (path === '/app/enterprise-login.js') {
      if (
        !text.includes('IS_INTERNAL_ADMIN_HOST')
        || !text.includes('/internal/admin')
        || !text.includes("IS_ENTERPRISE_HOST")
        || !text.includes("'./dashboard'")
      ) {
        throw new Error('Enterprise login script no longer routes enterprise users to /app/dashboard');
      }
      continue;
    }
    discoveredLinks.push(...extractEnterpriseLinks(text));
  }

  for (const path of protectedAppPaths) {
    await assertProtectedRedirect(path);
  }

  const pathsToCheck = unique(discoveredLinks)
    .filter((path) => !path.startsWith('/api/v1/enterprise/'))
    .sort();

  for (const path of pathsToCheck) {
    if (isPublicEnterprisePath(path)) {
      await assertPathOk(path);
    } else if (isProtectedEnterpriseAppPath(path)) {
      await assertProtectedRedirect(path);
    } else {
      await assertPathOk(path);
    }
  }

  return pathsToCheck;
}

async function assertStaffOnlyPagesMovedToAdmin() {
  for (const path of staffOnlyPaths) {
    const enterprise = await fetchText(path);
    if (enterprise.response.status !== 404) {
      throw new Error(`${path} should be removed from enterprise host and moved to admin host, got HTTP ${enterprise.response.status}: ${enterprise.text.slice(0, 200)}`);
    }

    const admin = await fetchAdminText(path);
    if (![200, 302, 303].includes(admin.response.status)) {
      throw new Error(`${path} should be reachable on admin host, got HTTP ${admin.response.status}: ${admin.text.slice(0, 200)}`);
    }
  }
}

function parseLoginScriptConfig(scriptText) {
  const supabaseUrl = scriptText.match(/const SUPABASE_URL = ["']([^"']+)["']/)?.[1] || '';
  const supabaseAnonKey = scriptText.match(/const SUPABASE_ANON_KEY = ["']([^"']+)["']/)?.[1] || '';
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Could not discover Supabase public auth config from enterprise login script');
  }
  return { supabaseUrl, supabaseAnonKey };
}

async function signInDemoUser() {
  if (!demoEmail || !demoPassword) {
    return null;
  }

  const { text: scriptText } = await fetchText('/app/enterprise-login.js');
  const { supabaseUrl, supabaseAnonKey } = parseLoginScriptConfig(scriptText);
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: supabaseAnonKey,
      authorization: `Bearer ${supabaseAnonKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      email: demoEmail,
      password: demoPassword,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.access_token) {
    throw new Error(`Demo login failed with HTTP ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload.access_token;
}

async function assertAuthenticatedEnterpriseApis(accessToken) {
  if (!accessToken) return 'skipped';

  const authHeaders = {
    authorization: `Bearer ${accessToken}`,
    accept: 'application/json',
  };
  const orgs = await fetchText('/api/v1/enterprise/orgs', { headers: authHeaders });
  if (orgs.response.status !== 200) {
    throw new Error(`/api/v1/enterprise/orgs returned HTTP ${orgs.response.status}: ${orgs.text}`);
  }
  const orgPayload = JSON.parse(orgs.text);
  const orgId = orgPayload.active_organization_id || orgPayload.organizations?.[0]?.id || '';
  if (!orgId) {
    throw new Error(`Demo login succeeded, but no enterprise org was returned: ${orgs.text}`);
  }

  const current = await fetchText('/api/v1/enterprise/orgs/current', {
    headers: {
      ...authHeaders,
      'x-vaultproof-organization': orgId,
    },
  });
  if (current.response.status !== 200) {
    throw new Error(`/api/v1/enterprise/orgs/current returned HTTP ${current.response.status}: ${current.text}`);
  }
  const currentPayload = JSON.parse(current.text);
  if (!currentPayload.organization?.id) {
    throw new Error(`Authenticated org current payload is missing organization: ${current.text}`);
  }

  return orgId;
}

const readiness = await assertReadiness();
const links = await assertPublicPagesAndLinks();
await assertStaffOnlyPagesMovedToAdmin();
const accessToken = await signInDemoUser();
const authResult = await assertAuthenticatedEnterpriseApis(accessToken);

console.log(JSON.stringify({
  status: 'ok',
  enterpriseUrl,
  adminUrl,
  production_ready: readiness.production_ready,
  security_profile: readiness.security_profile,
  checked_paths: requiredAppPaths.length,
  checked_staff_only_paths: staffOnlyPaths.length,
  checked_links: links.length,
  authenticated_demo_org: authResult,
}, null, 2));
