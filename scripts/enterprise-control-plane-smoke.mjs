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

const fakeOrganization = {
  id: 'org_123',
  name: 'Example Org',
  kind: 'team',
  owner_user_id: 'user_123',
  created_at: new Date().toISOString(),
};

let activeProject = fakeProject;
let auditEvents = [];
let projectKeyRevoked = false;
let ssoSettings = null;
let ssoResolveMode = 'existing_membership';
let ssoMembershipUpserted = false;
let ssoInvitationAccepted = false;
let createdMemberInvitation = null;
let revokedMemberInvitation = null;
let updatedMemberRole = null;
let updatedProjectAccess = null;
let removedProjectAccess = null;

function installSupabaseStub() {
  auditEvents = [];
  projectKeyRevoked = false;
  ssoSettings = {
    organization_id: 'org_123',
    company_domain: 'example.com',
    sso_provider: 'microsoft-entra',
    login_mode: 'sso-first',
    status: 'configured',
    created_at: '2026-04-04T12:00:00.000Z',
    updated_at: '2026-04-04T12:00:00.000Z',
  };
  ssoResolveMode = 'existing_membership';
  ssoMembershipUpserted = false;
  ssoInvitationAccepted = false;
  createdMemberInvitation = null;
  revokedMemberInvitation = null;
  updatedMemberRole = null;
  updatedProjectAccess = null;
  removedProjectAccess = null;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const decodedUrl = decodeURIComponent(url);
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

    if (url.includes('/auth/v1/admin/users/user_123') && method === 'GET') {
      return jsonResponse({
        user: {
          id: 'user_123',
          email: 'owner@example.com',
        },
      });
    }

    if (url.includes('/rest/v1/organization_sso_settings')) {
      if (method === 'GET') {
        if (!ssoSettings) return jsonResponse(null);
        return jsonResponse(ssoSettings);
      }
      if (method === 'POST' || method === 'PATCH') {
        const body = JSON.parse(init?.body || '{}');
        ssoSettings = {
          organization_id: body.organization_id || 'org_123',
          company_domain: body.company_domain,
          sso_provider: body.sso_provider || null,
          login_mode: body.login_mode || 'sso-first',
          status: body.status || 'requested',
          created_at: ssoSettings?.created_at || '2026-04-04T12:00:00.000Z',
          updated_at: body.updated_at || '2026-04-05T12:00:00.000Z',
        };
        return jsonResponse(ssoSettings);
      }
      if (method === 'DELETE') {
        ssoSettings = null;
        return jsonResponse([]);
      }
    }

    if (url.includes('/rest/v1/organization_members')) {
      if (decodedUrl.includes('organizations')) {
        return jsonResponse([{
          role: 'owner',
          created_at: new Date().toISOString(),
          organizations: fakeOrganization,
        }]);
      }

      if (method === 'POST') {
        ssoMembershipUpserted = true;
        return jsonResponse([]);
      }

      if (method === 'PATCH') {
        const body = JSON.parse(init?.body || '{}');
        updatedMemberRole = body.role;
        return jsonResponse({
          id: 'org_member_456',
          user_id: 'user_456',
          role: body.role,
          created_at: '2026-04-04T12:00:00.000Z',
        });
      }

      if (decodedUrl.includes('select=role')) {
        if (ssoResolveMode === 'pending_invitation') return jsonResponse(null);
        return jsonResponse({ role: 'admin' });
      }

      return jsonResponse([{
        id: 'org_member_123',
        user_id: 'user_123',
        role: 'owner',
        created_at: '2026-04-01T12:00:00.000Z',
      }]);
    }

    if (url.includes('/rest/v1/project_members')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        updatedProjectAccess = body;
        return jsonResponse({
          project_id: body.project_id || PROJECT_ID,
          user_id: body.user_id || 'user_456',
          role: body.role || 'viewer',
          created_at: '2026-04-04T12:00:00.000Z',
        });
      }

      if (method === 'DELETE') {
        removedProjectAccess = true;
        return jsonResponse({
          project_id: PROJECT_ID,
          user_id: 'user_456',
          role: 'viewer',
        });
      }

      if (decodedUrl.includes('project_id')) {
        return jsonResponse([{
          project_id: PROJECT_ID,
          user_id: 'user_123',
          role: 'admin',
          created_at: '2026-04-02T12:00:00.000Z',
        }]);
      }

      return jsonResponse([{
        role: 'admin',
        projects: activeProject,
      }]);
    }

    if (url.includes('/rest/v1/organization_invitations') && method === 'GET') {
      if (decodedUrl.includes('organizations')) {
        return jsonResponse([]);
      }
      if (decodedUrl.includes('email=eq.owner%40example.com') || decodedUrl.includes('email=eq.owner@example.com')) {
        return ssoResolveMode === 'pending_invitation'
          ? jsonResponse({
              id: 'invite_owner_123',
              email: 'owner@example.com',
              role: 'member',
              status: 'pending',
              invited_by: 'user_456',
            })
          : jsonResponse(null);
      }

      return jsonResponse([{
        id: 'invite_123',
        email: 'reviewer@example.com',
        role: 'viewer',
        status: 'pending',
        created_at: '2026-04-03T12:00:00.000Z',
        invited_by: 'user_123',
      }]);
    }

    if (url.includes('/rest/v1/organization_invitations') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      createdMemberInvitation = body;
      return jsonResponse({
        id: 'invite_created_123',
        email: body.email,
        role: body.role,
        status: body.status || 'pending',
        created_at: body.created_at || '2026-04-04T12:00:00.000Z',
        invited_by: body.invited_by || 'user_123',
      });
    }

    if (url.includes('/rest/v1/organization_invitations') && method === 'PATCH') {
      const body = JSON.parse(init?.body || '{}');
      if (body.status === 'revoked') {
        revokedMemberInvitation = body;
        return jsonResponse({
          id: 'invite_123',
          email: 'reviewer@example.com',
          role: 'viewer',
          status: 'revoked',
          revoked_at: body.revoked_at || '2026-04-04T12:00:00.000Z',
        });
      }
      ssoInvitationAccepted = true;
      return jsonResponse([]);
    }

    if (url.includes('/rest/v1/organizations') && method === 'GET') {
      if (decodedUrl.includes('select=id%2C+kind') || decodedUrl.includes('select=id, kind')) {
        return jsonResponse({ id: 'org_123', kind: 'team' });
      }
      if (decodedUrl.includes('select=id%2C+name%2C+kind') || decodedUrl.includes('select=id, name, kind')) {
        return jsonResponse({
          id: 'org_123',
          name: 'Example Org',
          kind: 'team',
        });
      }
      return jsonResponse(fakeOrganization);
    }

    if (url.includes('/rest/v1/projects') && method === 'GET') {
      if (decodedUrl.includes('id=eq.proj_123')) {
        return jsonResponse({
          id: PROJECT_ID,
          name: 'Enterprise Pilot',
          vp_proj_id: 'vp-proj-123',
        });
      }
      return jsonResponse([{
        id: PROJECT_ID,
        name: 'Enterprise Pilot',
        vp_proj_id: 'vp-proj-123',
      }]);
    }

    if (url.includes('/rest/v1/project_keys') && method === 'GET') {
      if (projectKeyRevoked) return jsonResponse([]);
      return jsonResponse([{
        id: PROJECT_KEY_ID,
        project_id: PROJECT_ID,
        provider: 'openai',
        slug: 'openai',
        upstream_base_url: 'https://api.openai.com',
      }]);
    }

    if (url.includes('/rest/v1/project_keys') && method === 'PATCH') {
      projectKeyRevoked = true;
      const body = JSON.parse(init?.body || '{}');
      return jsonResponse([{
        id: PROJECT_KEY_ID,
        project_id: PROJECT_ID,
        provider: 'openai',
        slug: 'openai',
        revoked_at: body.revoked_at || new Date().toISOString(),
      }]);
    }

    if (url.includes('/rest/v1/organization_audit_events') && method === 'GET') {
      return jsonResponse([{
        id: 'audit_123',
        organization_id: 'org_123',
        project_id: PROJECT_ID,
        actor_user_id: 'user_123',
        actor_email: 'owner@example.com',
        event_type: 'enterprise_provider_key_revoked',
        target_type: 'project_key',
        target_id: PROJECT_KEY_ID,
        description: 'Revoked provider slot openai for Enterprise Pilot',
        metadata: {
          reason: 'customer, requested export',
        },
        created_at: '2026-04-26T12:00:00.000Z',
      }]);
    }

    if (url.includes('/rest/v1/project_access_logs') && method === 'GET') {
      return jsonResponse([{
        id: 'proxy_123',
        project_id: PROJECT_ID,
        project_key_id: PROJECT_KEY_ID,
        provider: 'openai',
        slug: 'openai',
        method: 'POST',
        upstream_path: '/v1/responses',
        status_code: 200,
        latency_ms: 42,
        error: null,
        metadata: {
          provider_request_id: 'req_provider_123',
        },
        timestamp: '2026-04-26T12:01:00.000Z',
      }]);
    }

    if (url.includes('/rest/v1/organization_audit_events') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      if (Array.isArray(body)) {
        auditEvents.push(...body);
      } else {
        auditEvents.push(body);
      }
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
        attestation: {
          provider: 'azure-confidential-vm',
          attestationProviderUri: 'https://vaultproof-attest.attest.azure.net',
          attestationTokenHash: 'attestation-token-sha256',
          keyReleasePolicyHash: 'sha256:release-policy',
          keyId: 'https://vaultproof-hsm.managedhsm.azure.net/keys/vaultproof-enterprise-unwrap/1234',
          keyVersion: '1234',
          executorBuildDigest: 'sha256:executor-build',
          confidentialVmResourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm',
          claims: {
            attestationType: 'azure-maa',
            secureBoot: true,
            vmIsolation: 'azure-confidential-vm',
            measurementSummary: 'sevsnpvm;launch:abc;secureboot:true;tpm:true',
          },
        },
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
  const dispatchAudit = auditEvents.find((event) => event.event_type === 'enterprise_secure_execution_dispatched');
  if (!dispatchAudit) {
    throw new Error('Expected secure execution dispatch audit event');
  }
  if (dispatchAudit.metadata?.secure_execution?.provider_request_id !== 'req_executor_smoke_123') {
    throw new Error('Expected provider request id in execution audit metadata');
  }
  if (dispatchAudit.metadata?.attestation?.provider !== 'azure-confidential-vm') {
    throw new Error('Expected Azure attestation evidence in execution audit metadata');
  }
  if (dispatchAudit.metadata?.attestation?.claims?.attestation_type !== 'azure-maa') {
    throw new Error('Expected Azure MAA claim summary in execution audit metadata');
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

async function assertEnterpriseExecutionPolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_providers: ['openai'],
      allowed_methods: ['GET'],
      allowed_upstream_hosts: ['api.openai.com'],
      allowed_upstream_path_prefixes: ['/v1/models'],
    },
  };

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
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
    throw new Error(`Expected execution policy to allow OpenAI models request, got ${allowedResponse.status}`);
  }

  const deniedMethodResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        method: 'POST',
        upstream_path: '/v1/responses',
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
  const deniedMethodPayload = await deniedMethodResponse.json();
  if (deniedMethodResponse.status !== 403 || !String(deniedMethodPayload?.error || '').includes('rejected method')) {
    throw new Error(`Expected execution method denial, got ${deniedMethodResponse.status} ${JSON.stringify(deniedMethodPayload)}`);
  }

  const deniedPathResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/files',
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
  const deniedPathPayload = await deniedPathResponse.json();
  if (deniedPathResponse.status !== 403 || !String(deniedPathPayload?.error || '').includes('rejected upstream path')) {
    throw new Error(`Expected execution path denial, got ${deniedPathResponse.status} ${JSON.stringify(deniedPathPayload)}`);
  }
}

async function assertEnterpriseProviderExecutionPolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_methods: ['GET', 'POST'],
      provider_overrides: {
        openai: {
          allowed_methods: ['POST'],
          allowed_upstream_path_prefixes: ['/v1/responses'],
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
      },
      body: JSON.stringify({
        method: 'POST',
        upstream_path: '/v1/responses',
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
    throw new Error(`Expected provider execution policy to allow OpenAI responses request, got ${allowedResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
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
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('Execution policy for openai rejected method')) {
    throw new Error(`Expected provider execution policy denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }
}

async function assertEnterpriseRateLimitPolicy() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      rate_limit_per_minute: 1,
    },
  };

  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    executorSigningKeyId: 'enterprise-local',
    executorSigningSecret: 'local-secret',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };

  const buildExecuteRequest = () => buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${AUTH_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      method: 'GET',
      upstream_path: '/v1/models',
    }),
  });

  const firstResponse = await handleEnterpriseControlPlaneRequest(buildExecuteRequest(), env);
  if (firstResponse.status !== 200) {
    throw new Error(`Expected first request under rate limit to pass, got ${firstResponse.status}`);
  }

  const secondResponse = await handleEnterpriseControlPlaneRequest(buildExecuteRequest(), env);
  const secondPayload = await secondResponse.json();
  if (secondResponse.status !== 429 || !String(secondPayload?.error || '').includes('Rate limit exceeded')) {
    throw new Error(`Expected rate limit denial, got ${secondResponse.status} ${JSON.stringify(secondPayload)}`);
  }

  const rateLimitAudit = auditEvents.find((event) => event.event_type === 'enterprise_execution_rate_limited');
  if (!rateLimitAudit) {
    throw new Error('Expected execution rate limit governance audit event');
  }
  if (rateLimitAudit.metadata?.rate_limit_per_minute !== 1) {
    throw new Error('Expected rate limit value in governance audit metadata');
  }
}

async function assertEnterpriseEmergencyRevoke() {
  installSupabaseStub();
  activeProject = fakeProject;

  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    executorSigningKeyId: 'enterprise-local',
    executorSigningSecret: 'local-secret',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };

  const revokeResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/revoke`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        reason: 'smoke test emergency revoke',
      }),
    }),
    env,
  );
  const revokePayload = await revokeResponse.json();
  if (revokeResponse.status !== 200 || revokePayload?.revoked?.key_id !== PROJECT_KEY_ID) {
    throw new Error(`Expected provider revoke to succeed, got ${revokeResponse.status} ${JSON.stringify(revokePayload)}`);
  }

  const revokeAudit = auditEvents.find((event) => event.event_type === 'enterprise_provider_key_revoked');
  if (!revokeAudit) {
    throw new Error('Expected provider revoke governance audit event');
  }
  if (revokeAudit.metadata?.reason !== 'smoke test emergency revoke') {
    throw new Error('Expected revoke reason in governance audit metadata');
  }

  const executeResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    env,
  );
  const executePayload = await executeResponse.json();
  if (executeResponse.status !== 404 || executePayload?.error !== 'Project provider slot not found') {
    throw new Error(`Expected revoked provider slot to block execution, got ${executeResponse.status} ${JSON.stringify(executePayload)}`);
  }
}

async function assertEnterpriseAuditCsvExport() {
  installSupabaseStub();
  activeProject = fakeProject;

  const response = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/audit?format=csv&limit=10', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-vaultproof-organization': 'org_123',
      },
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const csv = await response.text();
  if (response.status !== 200) {
    throw new Error(`Expected audit CSV export to succeed, got ${response.status} ${csv}`);
  }
  if (!response.headers.get('content-type')?.includes('text/csv')) {
    throw new Error('Expected audit CSV export content type');
  }
  if (!csv.includes('"timestamp","source","event_type"')) {
    throw new Error(`Expected CSV header in audit export, got ${csv}`);
  }
  if (!csv.includes('"proxy","proxy_request"')) {
    throw new Error(`Expected proxy event in audit CSV export, got ${csv}`);
  }
  if (!csv.includes('"governance","enterprise_provider_key_revoked"')) {
    throw new Error(`Expected governance event in audit CSV export, got ${csv}`);
  }
  if (!csv.includes('customer, requested export')) {
    throw new Error('Expected metadata in audit CSV export');
  }
}

async function assertEnterpriseAccessReviewEvidenceExport() {
  installSupabaseStub();
  activeProject = fakeProject;

  const jsonResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/members/access-review', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-vaultproof-organization': 'org_123',
      },
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const jsonPayload = await jsonResponse.json();
  if (jsonResponse.status !== 200) {
    throw new Error(`Expected access review evidence JSON export to succeed, got ${jsonResponse.status} ${JSON.stringify(jsonPayload)}`);
  }
  if (!jsonPayload?.controls?.includes('SOC2 CC6.2')) {
    throw new Error(`Expected SOC 2 control tags in access review evidence, got ${JSON.stringify(jsonPayload)}`);
  }
  if (jsonPayload?.summary?.evidence_record_count !== 3) {
    throw new Error(`Expected member, project, and invitation evidence records, got ${JSON.stringify(jsonPayload?.summary)}`);
  }

  const csvResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/members/access-review?format=csv', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'x-vaultproof-organization': 'org_123',
      },
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const csv = await csvResponse.text();
  if (csvResponse.status !== 200) {
    throw new Error(`Expected access review evidence CSV export to succeed, got ${csvResponse.status} ${csv}`);
  }
  if (!csvResponse.headers.get('content-type')?.includes('text/csv')) {
    throw new Error('Expected access review evidence CSV content type');
  }
  if (!csv.includes('"subject_type","scope","email"')) {
    throw new Error(`Expected CSV header in access review evidence, got ${csv}`);
  }
  if (!csv.includes('"member","project","owner@example.com"')) {
    throw new Error(`Expected project member evidence in CSV, got ${csv}`);
  }
  if (!csv.includes('"invitation","invitation","reviewer@example.com"')) {
    throw new Error(`Expected pending invitation evidence in CSV, got ${csv}`);
  }
}

async function assertEnterpriseMembersAdminActions() {
  installSupabaseStub();

  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
  const authHeaders = {
    authorization: `Bearer ${AUTH_TOKEN}`,
    'content-type': 'application/json',
    'x-vaultproof-organization': 'org_123',
  };

  const inviteResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/members/invitations', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        email: 'Reviewer@Example.com',
        role: 'viewer',
      }),
    }),
    env,
  );
  const invitePayload = await inviteResponse.json();
  if (inviteResponse.status !== 200 || invitePayload?.invitation?.email !== 'reviewer@example.com') {
    throw new Error(`Expected invitation creation to normalize email, got ${inviteResponse.status} ${JSON.stringify(invitePayload)}`);
  }
  if (createdMemberInvitation?.role !== 'viewer') {
    throw new Error(`Expected invitation insert to use requested role, got ${JSON.stringify(createdMemberInvitation)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_invitation_created')) {
    throw new Error('Expected invitation creation audit event');
  }

  const revokeResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/members/invitations/invite_123/revoke', {
      method: 'POST',
      headers: authHeaders,
    }),
    env,
  );
  const revokePayload = await revokeResponse.json();
  if (revokeResponse.status !== 200 || revokePayload?.invitation?.status !== 'revoked' || !revokedMemberInvitation) {
    throw new Error(`Expected invitation revocation to succeed, got ${revokeResponse.status} ${JSON.stringify(revokePayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_invitation_revoked')) {
    throw new Error('Expected invitation revocation audit event');
  }

  const roleResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/members/user_456/role', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ role: 'admin' }),
    }),
    env,
  );
  const rolePayload = await roleResponse.json();
  if (roleResponse.status !== 200 || rolePayload?.member?.role !== 'admin' || updatedMemberRole !== 'admin') {
    throw new Error(`Expected role update to succeed, got ${roleResponse.status} ${JSON.stringify(rolePayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_member_role_updated')) {
    throw new Error('Expected member role update audit event');
  }

  const assignResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/members/user_456/projects/${PROJECT_ID}/access`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ role: 'viewer' }),
    }),
    env,
  );
  const assignPayload = await assignResponse.json();
  if (assignResponse.status !== 200 || assignPayload?.project_access?.role !== 'viewer' || updatedProjectAccess?.project_id !== PROJECT_ID) {
    throw new Error(`Expected project assignment to succeed, got ${assignResponse.status} ${JSON.stringify(assignPayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'project_member_access_updated')) {
    throw new Error('Expected project assignment audit event');
  }

  const removeResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/members/user_456/projects/${PROJECT_ID}/access`, {
      method: 'DELETE',
      headers: authHeaders,
    }),
    env,
  );
  const removePayload = await removeResponse.json();
  if (removeResponse.status !== 200 || removePayload?.removed?.role !== 'viewer' || !removedProjectAccess) {
    throw new Error(`Expected project assignment removal to succeed, got ${removeResponse.status} ${JSON.stringify(removePayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'project_member_access_removed')) {
    throw new Error('Expected project assignment removal audit event');
  }
}

async function assertEnterpriseSsoLifecycle() {
  installSupabaseStub();

  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };

  const settingsResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/orgs/current/sso-settings', {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-organization': 'org_123',
      },
      body: JSON.stringify({
        company_domain: 'example.com',
        sso_provider: 'microsoft-entra',
        status: 'configured',
        login_mode: 'sso-first',
      }),
    }),
    env,
  );
  const settingsPayload = await settingsResponse.json();
  if (settingsResponse.status !== 200 || settingsPayload?.sso_settings?.sso_provider !== 'microsoft-entra') {
    throw new Error(`Expected Microsoft Entra SSO settings save to succeed, got ${settingsResponse.status} ${JSON.stringify(settingsPayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_sso_settings_updated')) {
    throw new Error('Expected SSO settings update audit event');
  }

  const startedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/orgs/sso-started', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company_domain: 'example.com',
        email: 'owner@example.com',
      }),
    }),
    env,
  );
  const startedPayload = await startedResponse.json();
  if (startedResponse.status !== 200 || startedPayload?.matched !== true) {
    throw new Error(`Expected SSO start to match configured Entra domain, got ${startedResponse.status} ${JSON.stringify(startedPayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_sso_login_started')) {
    throw new Error('Expected SSO started audit event');
  }

  const existingMembershipResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/orgs/resolve-sso', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company_domain: 'example.com',
      }),
    }),
    env,
  );
  const existingMembershipPayload = await existingMembershipResponse.json();
  if (existingMembershipResponse.status !== 200 || existingMembershipPayload?.resolution !== 'existing_membership') {
    throw new Error(`Expected SSO resolution into existing membership, got ${existingMembershipResponse.status} ${JSON.stringify(existingMembershipPayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_sso_membership_resolved' && event.metadata?.resolution === 'existing_membership')) {
    throw new Error('Expected existing membership SSO resolution audit event');
  }

  installSupabaseStub();
  ssoResolveMode = 'pending_invitation';
  const invitationResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/orgs/resolve-sso', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company_domain: 'example.com',
      }),
    }),
    env,
  );
  const invitationPayload = await invitationResponse.json();
  if (invitationResponse.status !== 200 || invitationPayload?.resolution !== 'accepted_invitation') {
    throw new Error(`Expected SSO resolution to accept matching invitation, got ${invitationResponse.status} ${JSON.stringify(invitationPayload)}`);
  }
  if (!ssoMembershipUpserted || !ssoInvitationAccepted) {
    throw new Error('Expected matching SSO invitation to create membership and mark invitation accepted');
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_invitation_accepted' && event.metadata?.accepted_via === 'sso')) {
    throw new Error('Expected SSO invitation acceptance audit event');
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
  if (!html.includes('/app/enterprise-login.js')) {
    throw new Error('Expected enterprise login page to load control-plane-owned login script');
  }

  const loginScriptResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/enterprise-login.js'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const loginScript = await loginScriptResponse.text();
  if (loginScriptResponse.status !== 200 || !loginScript.includes("const enterpriseDashboardPath = IS_ENTERPRISE_HOST ? './dashboard' : './control';")) {
    throw new Error(`Expected enterprise login script to route enterprise users to dashboard, got ${loginScriptResponse.status}`);
  }

  for (const dashboardPath of ['/app', '/app/', '/app/dashboard']) {
    const dashboardResponse = await handleEnterpriseControlPlaneRequest(
      buildRequest(dashboardPath),
      {
        enterpriseHostname: ENTERPRISE_HOSTNAME,
      },
    );
    const dashboardHtml = await dashboardResponse.text();
    if (dashboardResponse.status !== 200 || !dashboardHtml.includes('Enterprise Dashboard - VaultProof')) {
      throw new Error(`Expected enterprise dashboard page for ${dashboardPath}, got ${dashboardResponse.status}`);
    }
    if (dashboardHtml.includes('https://vaultproof.dev/js/app-dashboard')) {
      throw new Error('Enterprise dashboard must not load the B2C dashboard shell script');
    }
    if (!dashboardHtml.includes('/api/v1/enterprise/projects/stats/overview')) {
      throw new Error('Expected enterprise dashboard to call enterprise control-plane APIs');
    }
  }

  const membersResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/members'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const membersHtml = await membersResponse.text();
  if (membersResponse.status !== 200 || !membersHtml.includes('Members - VaultProof Enterprise')) {
    throw new Error(`Expected enterprise members page, got ${membersResponse.status}`);
  }
  if (!membersHtml.includes('/api/v1/enterprise/members') || membersHtml.includes('https://init.vaultproof.dev')) {
    throw new Error('Expected enterprise members page to use enterprise member APIs only');
  }

  const auditResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/audit'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const auditHtml = await auditResponse.text();
  if (auditResponse.status !== 200 || !auditHtml.includes('Audit - VaultProof Enterprise')) {
    throw new Error(`Expected enterprise audit page, got ${auditResponse.status}`);
  }
  if (!auditHtml.includes('/api/v1/enterprise/audit') || !auditHtml.includes('/api/v1/enterprise/projects')) {
    throw new Error('Expected enterprise audit page to use enterprise audit and project APIs');
  }
  if (!auditHtml.includes('sourceFilter') || !auditHtml.includes('eventTypeFilter') || auditHtml.includes('https://init.vaultproof.dev')) {
    throw new Error('Expected enterprise audit page to include filters and avoid B2C APIs');
  }

  for (const plannedPath of ['/app/alerts', '/app/activity', '/app/projects', '/app/keys', '/app/settings', '/app/plans', '/app/scanner']) {
    const plannedResponse = await handleEnterpriseControlPlaneRequest(
      buildRequest(plannedPath),
      {
        enterpriseHostname: ENTERPRISE_HOSTNAME,
      },
    );
    const plannedHtml = await plannedResponse.text();
    if (plannedResponse.status !== 200 || !plannedHtml.includes('Phase 6 of the build plan')) {
      throw new Error(`Expected enterprise planned page for ${plannedPath}, got ${plannedResponse.status}`);
    }
    if (plannedHtml.includes('https://init.vaultproof.dev') || plannedHtml.includes('https://api.vaultproof.dev')) {
      throw new Error(`Enterprise planned page ${plannedPath} must not load B2C APIs`);
    }
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
await assertEnterpriseExecutionPolicy();
await assertEnterpriseProviderExecutionPolicy();
await assertEnterpriseRateLimitPolicy();
await assertEnterpriseEmergencyRevoke();
await assertEnterpriseAuditCsvExport();
await assertEnterpriseAccessReviewEvidenceExport();
await assertEnterpriseMembersAdminActions();
await assertEnterpriseSsoLifecycle();
console.log('enterprise control plane smoke test passed');
