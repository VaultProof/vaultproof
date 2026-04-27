import { Buffer } from 'node:buffer';
import { handleEnterpriseControlPlaneRequest } from '../packages/enterprise-control-plane/dist/enterprise-control-plane/src/index.js';

const ENTERPRISE_HOSTNAME = 'enterprise.vaultproof.dev';
const AUTH_TOKEN = 'jwt_enterprise_test';
const PROJECT_ID = 'proj_123';
const PROJECT_KEY_ID = 'pk_123';

function buildRequest(pathname, init = {}) {
  return new Request(`https://${ENTERPRISE_HOSTNAME}${pathname}`, init);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

const fakeProject = {
  id: PROJECT_ID,
  organization_id: 'org_123',
  vp_proj_id: 'vp-proj-123',
  name: 'Enterprise Pilot',
  allowed_origins: null,
  strict_origin: false,
  caller_lock_policy: {},
  created_at: new Date().toISOString(),
  revoked_at: null,
  project_role: 'admin',
  access_via: 'project',
};

let activeProject = fakeProject;

function installSupabaseStub() {
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init?.method || 'GET').toUpperCase();

    if (url.includes('/auth/v1/user') && method === 'GET') {
      const authHeader = new Headers(init?.headers).get('authorization');
      if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return jsonResponse({
        id: 'user_123',
        email: 'owner@example.com',
      });
    }

    if (url.includes('/rest/v1/organization_members')) {
      return jsonResponse([{
        role: 'owner',
        created_at: new Date().toISOString(),
        organizations: {
          id: 'org_123',
          name: 'Example Org',
          kind: 'team',
          owner_user_id: 'user_123',
          created_at: new Date().toISOString(),
        },
      }]);
    }

    if (url.includes('/rest/v1/project_members')) {
      return jsonResponse([{
        role: 'admin',
        projects: activeProject,
      }]);
    }

    if (url.includes('/rest/v1/project_keys') && method === 'GET') {
      return jsonResponse([{
        id: PROJECT_KEY_ID,
        provider: 'openai',
      }]);
    }

    if (url.includes('/rest/v1/organization_audit_events') && method === 'POST') {
      return jsonResponse([]);
    }

    if (url === 'https://executor.internal/execute' && method === 'POST') {
      const envelope = JSON.parse(init?.body || '{}');
      if (!envelope?.request?.projectId || envelope.request.projectId !== PROJECT_ID) {
        throw new Error('Expected signed executor envelope with project id');
      }
      if (!envelope?.signature || !envelope?.keyId) {
        throw new Error('Expected signed executor envelope');
      }
      if (envelope.request.callerLock?.origin === 'https://app.example.com'
        && envelope.request.callerLock?.customerGateway !== 'example-apim') {
        throw new Error('Expected caller lock metadata to be signed into executor envelope');
      }
      return jsonResponse({
        requestId: envelope.request.requestId,
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
        bodyBase64: Buffer.from(JSON.stringify({ ok: true })).toString('base64'),
        providerRequestId: 'req_executor_smoke_123',
        error: null,
      });
    }

    if (url === 'https://executor.internal/health' && method === 'GET') {
      return jsonResponse({
        status: 'ok',
        service: 'vaultproof-enterprise-secure-executor',
        secure_execution_ready: true,
        signature_verification_ready: true,
        accepted_key_ids: ['enterprise-local'],
        execution_material_resolver_ready: true,
        key_release_ready: true,
        key_release_mode: 'demo-env',
        key_release_hardware_bound: false,
        attestation_evidence_ready: false,
        replay_protection_ready: true,
        production_ready: false,
        security_profile: 'demo-or-incomplete',
        production_blockers: [
          'key release is not hardware-bound',
          'key release mode is demo-env',
          'Azure attestation evidence is not ready',
        ],
      });
    }

    throw new Error(`Unexpected fetch in control-plane smoke test: ${method} ${url}`);
  };
}

async function assertExecuteRoute() {
  installSupabaseStub();
  activeProject = fakeProject;

  const response = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-organization': 'org_123',
      },
      body: JSON.stringify({
        method: 'POST',
        upstream_path: '/v1/responses',
        headers: {
          'content-type': 'application/json',
          authorization: 'should-be-dropped',
        },
        body_base64: Buffer.from(JSON.stringify({ input: 'hello' })).toString('base64'),
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );

  const payload = await response.json();
  if (response.status !== 200) {
    throw new Error(`Unexpected execute route status: ${response.status} ${JSON.stringify(payload)}`);
  }
  if (payload?.request?.project_id !== PROJECT_ID) {
    throw new Error('Expected execute route to return project context');
  }
  if (payload?.execution?.providerRequestId !== 'req_executor_smoke_123') {
    throw new Error('Expected executor response to be preserved');
  }
}

async function assertEnterpriseOriginLock() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    allowed_origins: 'https://app.example.com',
    strict_origin: true,
    caller_lock_policy: {},
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        origin: 'https://app.example.com',
        'x-vaultproof-customer-gateway': 'example-apim',
        'x-vaultproof-client-class': 'browser',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected allowed origin to execute, got ${allowedResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        origin: 'https://evil.example.com',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('Origin lock rejected')) {
    throw new Error(`Expected origin lock denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }
}

async function assertEnterpriseCallerLockPolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_customer_gateways: ['plant-apim'],
      allowed_client_classes: ['device'],
      allowed_fleet_ids: ['fleet-west'],
      allowed_firmware_versions: ['2.4.1'],
      require_device_id: true,
    },
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-customer-gateway': 'plant-apim',
        'x-vaultproof-client-class': 'device',
        'x-vaultproof-device-id': 'device-123',
        'x-vaultproof-fleet-id': 'fleet-west',
        'x-vaultproof-firmware-version': '2.4.1',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected caller lock policy to allow device request, got ${allowedResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-customer-gateway': 'plant-apim',
        'x-vaultproof-client-class': 'device',
        'x-vaultproof-fleet-id': 'fleet-west',
        'x-vaultproof-firmware-version': '2.4.1',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('device identity is required')) {
    throw new Error(`Expected caller lock device denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }
}

async function assertEnterpriseCallerLockIpPolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_ip_cidrs: ['203.0.113.0/24'],
      allowed_client_classes: ['server'],
    },
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-forwarded-for': '203.0.113.42, 10.0.0.4',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected caller lock IP policy to allow server request, got ${allowedResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-forwarded-for': '198.51.100.42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('source IP')) {
    throw new Error(`Expected caller lock IP denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }
}

async function assertEnterpriseCallerLockIpv6Policy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_ip_cidrs: ['2001:db8:abcd::/48'],
      allowed_client_classes: ['server'],
    },
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-forwarded-for': '2001:db8:abcd:0012::42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected caller lock IPv6 policy to allow server request, got ${allowedResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-forwarded-for': '2001:db8:ffff::42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('source IP')) {
    throw new Error(`Expected caller lock IPv6 denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }
}

async function assertEnterpriseCallerLockCertificatePolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_client_classes: ['gateway'],
      allowed_client_certificate_thumbprints: ['AA:BB:CC:DD'],
      allowed_client_certificate_subjects: ['cn=plant-gateway'],
    },
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'gateway',
        'x-vaultproof-client-cert-thumbprint': 'aa bb cc dd',
        'x-vaultproof-client-cert-subject': 'CN=plant-gateway,O=Example',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected caller lock certificate policy to allow gateway request, got ${allowedResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'gateway',
        'x-vaultproof-client-cert-thumbprint': 'ee ff 00 11',
        'x-vaultproof-client-cert-subject': 'CN=plant-gateway,O=Example',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('certificate thumbprint')) {
    throw new Error(`Expected caller lock certificate denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }
}

async function assertEnterpriseProviderCallerLockPolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_client_classes: ['server'],
      provider_overrides: {
        openai: {
          allowed_customer_gateways: ['openai-apim'],
          allowed_ip_cidrs: ['203.0.113.0/24'],
        },
      },
    },
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-vaultproof-customer-gateway': 'openai-apim',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected provider caller lock policy to allow OpenAI request, got ${allowedResponse.status}`);
  }

  const wrongGatewayResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-vaultproof-customer-gateway': 'generic-apim',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const wrongGatewayPayload = await wrongGatewayResponse.json();
  if (
    wrongGatewayResponse.status !== 403
    || !String(wrongGatewayPayload?.error || '').includes('Caller lock for openai rejected gateway')
  ) {
    throw new Error(`Expected provider gateway denial, got ${wrongGatewayResponse.status} ${JSON.stringify(wrongGatewayPayload)}`);
  }

  const wrongClassResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'browser',
        'x-vaultproof-customer-gateway': 'openai-apim',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const wrongClassPayload = await wrongClassResponse.json();
  if (
    wrongClassResponse.status !== 403
    || !String(wrongClassPayload?.error || '').includes('Caller lock rejected client class')
  ) {
    throw new Error(`Expected project-wide class denial, got ${wrongClassResponse.status} ${JSON.stringify(wrongClassPayload)}`);
  }
}

async function assertEnterpriseLoginRoute() {
  const rootResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  if (rootResponse.status !== 302) {
    throw new Error(`Expected enterprise root to redirect to login, got ${rootResponse.status}`);
  }
  if (rootResponse.headers.get('location') !== `https://${ENTERPRISE_HOSTNAME}/app/login`) {
    throw new Error(`Unexpected enterprise root redirect: ${rootResponse.headers.get('location')}`);
  }

  const loginResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/login'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const html = await loginResponse.text();
  if (loginResponse.status !== 200 || !html.includes('VaultProof Enterprise Login')) {
    throw new Error(`Expected enterprise login page, got ${loginResponse.status}`);
  }
  if (!html.includes('enterprise only')) {
    throw new Error('Expected enterprise-only login copy');
  }

  const controlResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/control'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const controlHtml = await controlResponse.text();
  if (controlResponse.status !== 200 || !controlHtml.includes('Control — VaultProof')) {
    throw new Error(`Expected enterprise control page, got ${controlResponse.status}`);
  }
  if (!controlHtml.includes('https://vaultproof.dev/js/app-control-1.js')) {
    throw new Error('Expected control page static scripts to load from public site origin');
  }

  const orgResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/org'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const orgHtml = await orgResponse.text();
  if (orgResponse.status !== 200 || !orgHtml.includes('Org — VaultProof')) {
    throw new Error(`Expected enterprise org page, got ${orgResponse.status}`);
  }
  if (!orgHtml.includes('https://vaultproof.dev/js/app-org-1.js')) {
    throw new Error('Expected org page static scripts to load from public site origin');
  }
}

async function assertEnterpriseReadinessRoute() {
  installSupabaseStub();

  const response = await handleEnterpriseControlPlaneRequest(
    buildRequest('/readiness'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      executorBaseUrl: 'https://executor.internal',
      executorSigningKeyId: 'enterprise-local',
      executorSigningSecret: 'local-secret',
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );

  const payload = await response.json();
  if (response.status !== 200) {
    throw new Error(`Expected readiness route to return 200, got ${response.status}`);
  }
  if (payload?.demo_ready !== true) {
    throw new Error(`Expected readiness route demo_ready=true, got ${JSON.stringify(payload)}`);
  }
  if (payload?.production_ready !== false) {
    throw new Error(`Expected readiness route production_ready=false while executor is demo mode, got ${JSON.stringify(payload)}`);
  }
  if (!payload?.production_blockers?.includes('executor: key release is not hardware-bound')) {
    throw new Error(`Expected readiness route to include executor production blockers, got ${JSON.stringify(payload)}`);
  }
}

async function assertFrontDoorOriginLock() {
  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    azureFrontDoorId: 'front-door-id',
    originLockSecret: 'origin-lock-secret',
  };

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/health'),
    env,
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('origin lock')) {
    throw new Error(`Expected Front Door origin lock denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/health', {
      headers: {
        'x-azure-fdid': 'front-door-id',
      },
    }),
    env,
  );
  if (allowedResponse.status !== 200) {
    throw new Error(`Expected Front Door ID header to allow request, got ${allowedResponse.status}`);
  }

  const customHeaderResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/health', {
      headers: {
        'x-vaultproof-origin-lock': 'origin-lock-secret',
      },
    }),
    env,
  );
  if (customHeaderResponse.status !== 200) {
    throw new Error(`Expected custom origin lock header to allow request, got ${customHeaderResponse.status}`);
  }

  const loopbackResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/health', {
      headers: {
        'x-vaultproof-local-loopback': 'true',
      },
    }),
    env,
  );
  if (loopbackResponse.status !== 200) {
    throw new Error(`Expected local loopback control-plane check to bypass origin lock, got ${loopbackResponse.status}`);
  }
}

await assertEnterpriseLoginRoute();
await assertEnterpriseReadinessRoute();
await assertFrontDoorOriginLock();
await assertExecuteRoute();
await assertEnterpriseOriginLock();
await assertEnterpriseCallerLockPolicy();
await assertEnterpriseCallerLockIpPolicy();
await assertEnterpriseCallerLockIpv6Policy();
await assertEnterpriseCallerLockCertificatePolicy();
await assertEnterpriseProviderCallerLockPolicy();
console.log('enterprise control plane smoke test passed');
