import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';
import { handleEnterpriseControlPlaneRequest } from '../packages/enterprise-control-plane/dist/enterprise-control-plane/src/index.js';

const ENTERPRISE_HOSTNAME = 'enterprise.vaultproof.dev';
const INTERNAL_ADMIN_HOSTNAME = 'internal-admin.vaultproof.test';
const AUTH_TOKEN = 'jwt_enterprise_test';
const PROJECT_ID = 'proj_123';
const PROJECT_KEY_ID = 'pk_123';
const RUNTIME_TOKEN_SECRET = 'enterprise-runtime-token-secret-32-bytes-minimum';
const RUNTIME_TOKEN_PREFIX = 'vp_exec_v1.';

function mintRuntimeToken(overrides = {}) {
  const payload = {
    v: 1,
    aud: 'vaultproof-enterprise-execute',
    scope: 'project:execute',
    project_id: PROJECT_ID,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    jti: 'runtime-smoke-token',
    ...overrides,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', RUNTIME_TOKEN_SECRET)
    .update(`${RUNTIME_TOKEN_PREFIX}${encodedPayload}`)
    .digest('base64url');
  return `${RUNTIME_TOKEN_PREFIX}${encodedPayload}.${signature}`;
}

function buildRequest(pathname, init = {}) {
  return new Request(`https://${ENTERPRISE_HOSTNAME}${pathname}`, init);
}

function buildHostRequest(hostname, pathname, init = {}) {
  return new Request(`https://${hostname}${pathname}`, init);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

function materialModeForProviderSlot(slot) {
  const share1 = String(slot?.share1_encrypted || '');
  const share2 = String(slot?.share2_encrypted || '');
  if (!share1 || !share2) return 'missing';
  const share1Placeholder = share1.startsWith('demo-dashboard-placeholder');
  const share2Placeholder = share2.startsWith('demo-dashboard-placeholder');
  if (share1Placeholder && share2Placeholder) return 'demo-placeholder';
  if (!share1Placeholder && !share2Placeholder) return 'sealed-live';
  return 'mixed';
}

function assertLaunchGoNoGoLocalStorage(pageHtml) {
  for (const required of [
    "return 'vaultproof_go_no_go_evidence:' + (currentOrgId || 'default');",
    'Object.assign({}, existing, patch || {}, { updated_at: new Date().toISOString() })',
    'localStorage.setItem(goNoGoStorageKey(), JSON.stringify(state));',
    'GO_NO_GO_MANUAL_STALE_MS',
    'isStaleGoNoGoEvidence',
    "status: target.checked ? 'passed' : 'missing'",
    "target.hasAttribute('data-go-no-go-status')",
    "target.hasAttribute('data-go-no-go-note')",
  ]) {
    if (!pageHtml.includes(required)) {
      throw new Error(`Expected launch go/no-go local-storage behavior to include ${required}`);
    }
  }
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
let providerSlotRows = [];
let ssoSettings = null;
let ssoResolveMode = 'existing_membership';
let ssoMembershipUpserted = false;
let ssoInvitationAccepted = false;
let createdMemberInvitation = null;
let revokedMemberInvitation = null;
let updatedMemberRole = null;
let updatedProjectAccess = null;
let removedProjectAccess = null;
let alertTestDelivery = null;
let alertTestDispatchRun = null;
let alertWebhookTestPayload = null;
let stubAuthUserId = 'user_123';
let stubAuthUserEmail = 'owner@example.com';
let verifierModels = [];
let verifierProofs = [];
let internalAdminAuditEvents = [];
let internalAdminSupportNotes = [];
let internalAdminBusinessStatusUpdates = [];
let internalAdminActionRequests = [];
let internalAdminActionExecutionRecords = [];
let internalAdminCreatedBusiness = null;
let internalAdminOwnerInvite = null;
let organizationSsoSettingsSchemaReady = true;
let bootstrapRpcCalls = 0;
let authUserLookupCalls = 0;
let projectKeyGetCalls = 0;

function installSupabaseStub() {
  auditEvents = [];
  projectKeyRevoked = false;
  providerSlotRows = [{
    id: PROJECT_KEY_ID,
    project_id: PROJECT_ID,
    provider: 'openai',
    slug: 'openai',
    upstream_base_url: 'https://api.openai.com',
    share1_encrypted: 'demo-dashboard-placeholder-share-1:proj_123:openai',
    share2_encrypted: 'demo-dashboard-placeholder-share-2:proj_123:openai',
  }];
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
  alertTestDelivery = null;
  alertTestDispatchRun = null;
  alertWebhookTestPayload = null;
  stubAuthUserId = 'user_123';
  stubAuthUserEmail = 'owner@example.com';
  verifierModels = [{
    id: 'verifier_model_123',
    organization_id: 'org_123',
    project_id: PROJECT_ID,
    model_ref: 'fraud-xgb-v1',
    display_name: 'Fraud XGBoost v1',
    model_family: 'classification',
    allowed_proof_systems: ['vaultproof-manifest-v1', 'external-verifier', 'tee-attestation'],
    status: 'enabled',
    metadata: {},
    created_by: 'user_123',
    created_at: '2026-04-26T12:00:00.000Z',
    updated_at: '2026-04-26T12:00:00.000Z',
  }];
  verifierProofs = [];
  internalAdminAuditEvents = [];
  internalAdminSupportNotes = [{
    id: 'support_note_123',
    organization_id: 'org_123',
    note_type: 'onboarding',
    body: 'Customer asked for Entra SSO rollout help.',
    created_by_user_id: 'user_123',
    created_by_email: 'owner@example.com',
    created_at: '2026-04-26T12:10:00.000Z',
  }];
  internalAdminBusinessStatusUpdates = [{
    id: 'business_status_123',
    organization_id: 'org_123',
    status: 'onboarding',
    plan_label: 'Enterprise Pilot',
    summary: 'Customer is preparing SSO and gateway rollout.',
    next_step: 'Confirm Entra metadata exchange.',
    created_by_user_id: 'user_123',
    created_by_email: 'owner@example.com',
    created_at: '2026-04-26T12:12:00.000Z',
  }];
  internalAdminActionRequests = [{
    id: 'action_request_123',
    organization_id: 'org_123',
    action_type: 'disable_org_access',
    risk_level: 'critical',
    status: 'pending',
    reason: 'Customer requested temporary access pause during incident response.',
    requested_payload: {
      requested_duration: '24h',
      customer_authorization_ref: 'ticket-CUST-123',
      rollback_owner_email: 'ops@vaultproof.dev',
      rollback_plan_summary: 'Restore the previous organization archive fields from the captured rollback payload.',
      break_glass_reason: 'Customer confirmed emergency access pause during incident response.',
    },
    requested_by_user_id: 'user_456',
    requested_by_email: 'security@vaultproof.dev',
    approved_by_user_id: null,
    approved_by_email: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_by_email: null,
    rejected_at: null,
    executed_by_user_id: null,
    executed_by_email: null,
    executed_at: null,
    decision_note: null,
    created_at: '2026-04-26T12:15:00.000Z',
    updated_at: '2026-04-26T12:15:00.000Z',
  }];
  internalAdminActionExecutionRecords = [];
  internalAdminCreatedBusiness = null;
  internalAdminOwnerInvite = null;
  organizationSsoSettingsSchemaReady = true;
  bootstrapRpcCalls = 0;
  authUserLookupCalls = 0;
  projectKeyGetCalls = 0;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const decodedUrl = decodeURIComponent(url);
    const method = (init?.method || 'GET').toUpperCase();

    if (url.includes('/auth/v1/sso') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      if (!body.domain || !body.redirect_to || body.skip_http_redirect !== true) {
        throw new Error(`Expected SSO start check body, got ${JSON.stringify(body)}`);
      }
      return jsonResponse({
        url: `https://idp.example.com/sso?domain=${encodeURIComponent(body.domain)}`,
      });
    }

    if (url.includes('/auth/v1/user') && method === 'GET') {
      authUserLookupCalls += 1;
      const authHeader = new Headers(init?.headers).get('authorization');
      if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
      }
      return jsonResponse({
        id: stubAuthUserId,
        email: stubAuthUserEmail,
      });
    }

    if (url.includes('/auth/v1/admin/users/user_123') && method === 'GET') {
      return jsonResponse({
        user: {
          id: 'user_123',
          email: stubAuthUserEmail,
        },
      });
    }

    if (url.includes('/auth/v1/admin/users') && method === 'GET') {
      return jsonResponse({
        users: [{
          id: 'user_123',
          email: stubAuthUserEmail,
        }],
      });
    }

    if (url.includes('/auth/v1/invite') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      internalAdminOwnerInvite = body;
      return jsonResponse({
        user: {
          id: 'user_new_owner',
          email: body.email,
          user_metadata: body.data || {},
        },
      });
    }

    if (url.includes('/rest/v1/organization_sso_settings')) {
      if (!organizationSsoSettingsSchemaReady) {
        return jsonResponse({
          code: 'PGRST205',
          message: "Could not find the table 'public.organization_sso_settings' in the schema cache",
        }, 404);
      }
      if (method === 'GET') {
        if (decodedUrl.includes('select=organization_id')) {
          return jsonResponse(ssoSettings ? [ssoSettings] : []);
        }
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

    if (url.includes('/rest/v1/rpc/enterprise_projects_bootstrap') && method === 'POST') {
      bootstrapRpcCalls += 1;
      const slots = projectKeyRevoked
        ? []
        : providerSlotRows.map((slot) => {
            const materialMode = materialModeForProviderSlot(slot);
            return {
              key_id: slot.id,
              provider: slot.provider,
              slug: slot.slug || slot.provider,
              material_mode: materialMode,
              material_ready: materialMode === 'sealed-live',
            };
          });
      return jsonResponse({
        organizations: [{
          id: 'org_123',
          name: fakeOrganization.name,
          kind: fakeOrganization.kind,
          role: 'owner',
          is_active: true,
        }],
        active_organization_id: 'org_123',
        projects: [{
          id: activeProject.id,
          organization_id: activeProject.organization_id,
          vp_proj_id: activeProject.vp_proj_id,
          name: activeProject.name,
          allowed_origins: activeProject.allowed_origins,
          strict_origin: activeProject.strict_origin,
          caller_lock_policy: activeProject.caller_lock_policy || {},
          created_at: activeProject.created_at,
          revoked_at: activeProject.revoked_at,
          project_role: activeProject.project_role || 'admin',
          access_via: activeProject.access_via || 'project',
          provider_slots: slots,
        }],
        access_overview: {
          total_calls: 1,
          error_calls: 0,
          denied_calls: 0,
          project_health: [{
            project_id: PROJECT_ID,
            calls: 1,
            errors: 0,
            denied: 0,
            last_activity: '2026-04-26T12:01:00.000Z',
          }],
          recent_activity: [{
            id: 'proxy_123',
            project_id: PROJECT_ID,
            project_key_id: PROJECT_KEY_ID,
            provider: 'openai',
            slug: 'openai',
            method: 'POST',
            upstream_path: '/v1/responses',
            status_code: 200,
            latency_ms: 42,
            metadata: {
              provider_request_id: 'req_provider_123',
            },
            timestamp: '2026-04-26T12:01:00.000Z',
          }],
        },
      });
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
        organization_id: 'org_123',
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
        organization_id: 'org_123',
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

    if (url.includes('/rest/v1/organization_alert_policies') && method === 'GET') {
      return jsonResponse({
        dispatch_enabled: true,
        minimum_severity: 'warning',
        min_interval_minutes: 60,
      });
    }

    if (url.includes('/rest/v1/organization_alert_destinations') && method === 'GET') {
      return jsonResponse([{
        id: 'alert_dest_email_123',
        channel_type: 'email',
        label: 'Security inbox',
        target: 'security@example.com',
        enabled: true,
        created_at: '2026-04-20T12:00:00.000Z',
        updated_at: '2026-04-21T12:00:00.000Z',
      }, {
        id: 'alert_dest_webhook_123',
        channel_type: 'webhook',
        label: 'SOC webhook',
        target: 'https://hooks.example.com/vaultproof-alerts?secret=redacted',
        enabled: true,
        created_at: '2026-04-20T13:00:00.000Z',
        updated_at: '2026-04-21T13:00:00.000Z',
      }]);
    }

    if (url.includes('/rest/v1/organization_alert_deliveries') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      alertTestDelivery = {
        id: 'alert_delivery_test_123',
        ...body,
      };
      return jsonResponse(alertTestDelivery);
    }

    if (url.includes('/rest/v1/organization_alert_deliveries') && method === 'GET') {
      if (decodedUrl.includes('select=id&') || decodedUrl.includes('select=id HTTP')) return jsonResponse([]);
      return jsonResponse([alertTestDelivery, {
        id: 'alert_delivery_123',
        destination_id: 'alert_dest_email_123',
        channel_type: 'email',
        delivery_kind: 'policy_dispatch',
        status: 'delivered',
        detail: 'Production readiness drift resolved',
        response_status: 202,
        delivered_at: '2026-04-26T12:05:00.000Z',
      }, {
        id: 'alert_delivery_124',
        destination_id: 'alert_dest_webhook_123',
        channel_type: 'webhook',
        delivery_kind: 'test_send',
        status: 'failed',
        detail: 'Webhook returned 500',
        response_status: 500,
        delivered_at: '2026-04-26T12:04:00.000Z',
      }].filter(Boolean));
    }

    if (url.includes('/rest/v1/organization_alert_dispatch_runs') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      alertTestDispatchRun = {
        id: 'alert_run_test_123',
        ...body,
      };
      return jsonResponse(alertTestDispatchRun);
    }

    if (url.includes('/rest/v1/organization_alert_dispatch_runs') && method === 'GET') {
      if (decodedUrl.includes('select=id&') || decodedUrl.includes('select=id HTTP')) return jsonResponse([]);
      return jsonResponse([alertTestDispatchRun, {
        id: 'alert_run_123',
        trigger_source: 'scheduled',
        status: 'dispatched',
        reason: 'production readiness drift',
        dispatched_alert_count: 1,
        destination_count: 2,
        delivered_count: 1,
        failed_count: 1,
        skipped_count: 0,
        next_eligible_at: '2026-04-26T13:05:00.000Z',
        checked_at: '2026-04-26T12:05:00.000Z',
      }].filter(Boolean));
    }

    if (url.includes('/rest/v1/organization_verifier_models')) {
      if (method === 'GET') {
        if (decodedUrl.includes('model_ref=eq.')) {
          const modelRef = decodedUrl.match(/model_ref=eq\.([^&]+)/)?.[1];
          return jsonResponse(verifierModels.filter((model) => !modelRef || model.model_ref === modelRef));
        }
        if (decodedUrl.includes('id=eq.')) {
          const modelId = decodedUrl.match(/id=eq\.([^&]+)/)?.[1];
          return jsonResponse(verifierModels.filter((model) => !modelId || model.id === modelId));
        }
        return jsonResponse(verifierModels);
      }
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const row = {
          id: body.id || 'verifier_model_created_123',
          organization_id: body.organization_id || 'org_123',
          project_id: body.project_id || PROJECT_ID,
          model_ref: body.model_ref || 'fraud-xgb-v1',
          display_name: body.display_name || body.model_ref || 'Verifier model',
          model_family: body.model_family || 'custom',
          allowed_proof_systems: body.allowed_proof_systems || ['vaultproof-manifest-v1'],
          status: body.status || 'enabled',
          metadata: body.metadata || {},
          created_by: body.created_by || 'user_123',
          created_at: body.created_at || '2026-04-26T12:00:00.000Z',
          updated_at: body.updated_at || '2026-04-26T12:00:00.000Z',
        };
        verifierModels = verifierModels.filter((model) => !(model.project_id === row.project_id && model.model_ref === row.model_ref));
        verifierModels.unshift(row);
        return jsonResponse(row);
      }
    }

    if (url.includes('/rest/v1/organization_proof_verifications')) {
      if (method === 'GET') return jsonResponse(verifierProofs);
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const row = {
          id: 'proof_verification_123',
          created_at: '2026-04-26T12:01:00.000Z',
          ...body,
        };
        verifierProofs.unshift(row);
        return jsonResponse(row);
      }
    }

    if (url.includes('/rest/v1/organizations') && method === 'GET') {
      if (decodedUrl.includes('select=id') && decodedUrl.includes('slug=eq.')) {
        return jsonResponse(decodedUrl.includes('slug=eq.example-org') ? [{ id: 'org_123' }] : []);
      }
      if (decodedUrl.includes('archived_by_user_id')) {
        return jsonResponse([{
          id: 'org_123',
          name: 'Example Org',
          slug: 'example-org',
          kind: 'team',
          owner_user_id: 'user_123',
          archived_at: null,
          archived_by_user_id: null,
          updated_at: '2026-04-02T12:00:00.000Z',
        }]);
      }
      if (decodedUrl.includes('select=id, name, slug, kind, owner_user_id, created_at, updated_at, archived_at')) {
        return jsonResponse([{
          id: 'org_123',
          name: 'Example Org',
          slug: 'example-org',
          kind: 'team',
          owner_user_id: 'user_123',
          created_at: '2026-04-01T12:00:00.000Z',
          updated_at: '2026-04-02T12:00:00.000Z',
          archived_at: null,
        }]);
      }
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

    if (url.includes('/rest/v1/organizations') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      internalAdminCreatedBusiness = {
        id: 'org_created_123',
        name: body.name,
        slug: body.slug,
        kind: body.kind || 'team',
        owner_user_id: body.owner_user_id || 'user_new_owner',
        created_at: body.created_at || '2026-04-27T12:00:00.000Z',
        updated_at: body.updated_at || '2026-04-27T12:00:00.000Z',
        archived_at: null,
      };
      return jsonResponse(internalAdminCreatedBusiness);
    }

    if (url.includes('/rest/v1/projects') && method === 'GET') {
      if (decodedUrl.includes('id=eq.proj_123')) {
        return jsonResponse(activeProject);
      }
      return jsonResponse([{
        id: PROJECT_ID,
        organization_id: 'org_123',
        name: 'Enterprise Pilot',
        vp_proj_id: 'vp-proj-123',
        revoked_at: null,
        created_at: '2026-04-02T12:00:00.000Z',
      }]);
    }

    if (url.includes('/rest/v1/project_keys') && method === 'GET') {
      projectKeyGetCalls += 1;
      if (projectKeyRevoked) return jsonResponse([]);
      const includeProject = decodedUrl.includes('projects!inner');
      const slugMatch = decodedUrl.match(/slug=eq\.([^&]+)/);
      const providerMatch = decodedUrl.match(/provider=eq\.([^&]+)/);
      const filteredRows = providerSlotRows.filter((row) => {
        if (slugMatch && (row.slug || row.provider) !== slugMatch[1]) return false;
        if (providerMatch && row.provider !== providerMatch[1]) return false;
        return true;
      });
      const rows = filteredRows.map((row) => includeProject
        ? { ...row, projects: activeProject }
        : row);
      return jsonResponse(rows);
    }

    if (url.includes('/rest/v1/project_keys') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}');
      const row = {
        id: body.id || 'pk_created',
        project_id: body.project_id || PROJECT_ID,
        provider: body.provider || 'openai',
        slug: body.slug || body.provider || 'openai',
        upstream_base_url: body.upstream_base_url || 'https://api.openai.com',
        auth_header_name: body.auth_header_name || 'authorization',
        auth_header_template: body.auth_header_template || 'Bearer {key}',
        extra_headers: body.extra_headers || {},
        share1_encrypted: body.share1_encrypted,
        share2_encrypted: body.share2_encrypted,
        revoked_at: body.revoked_at || null,
      };
      providerSlotRows = providerSlotRows.filter((slot) => slot.provider !== row.provider);
      providerSlotRows.push(row);
      projectKeyRevoked = false;
      return jsonResponse(row, 201);
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

    if (url.includes('/rest/v1/rpc/enterprise_project_access_overview') && method === 'POST') {
      return jsonResponse({
        total_calls: 1,
        error_calls: 0,
        denied_calls: 0,
        project_health: [{
          project_id: PROJECT_ID,
          calls: 1,
          errors: 0,
          denied: 0,
          last_activity: '2026-04-26T12:01:00.000Z',
        }],
        recent_activity: [{
          id: 'proxy_123',
          project_id: PROJECT_ID,
          project_key_id: PROJECT_KEY_ID,
          provider: 'openai',
          slug: 'openai',
          method: 'POST',
          upstream_path: '/v1/responses',
          status_code: 200,
          latency_ms: 42,
          metadata: {
            provider_request_id: 'req_provider_123',
          },
          timestamp: '2026-04-26T12:01:00.000Z',
        }],
      });
    }

    if (url.includes('/rest/v1/project_access_log_daily_rollups') && method === 'GET') {
      return jsonResponse([{
        id: 'rollup_123',
        project_id: PROJECT_ID,
        day: '2026-04-26',
        provider: 'openai',
        slug: 'openai',
        status_bucket: 'success',
        call_count: 1,
        total_latency_ms: 42,
        max_latency_ms: 42,
        last_timestamp: '2026-04-26T12:01:00.000Z',
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

    if (url.includes('/rest/v1/internal_admin_audit_events')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const rows = (Array.isArray(body) ? body : [body]).map((event, index) => ({
          id: event.id || `internal_admin_audit_${internalAdminAuditEvents.length + index + 1}`,
          actor_user_id: event.actor_user_id || 'user_123',
          actor_email: event.actor_email || stubAuthUserEmail,
          event_type: event.event_type || 'internal_admin_event',
          target_type: event.target_type || 'internal_admin',
          target_id: event.target_id || '/api/v1/internal-admin/overview',
          request_method: event.request_method || 'GET',
          request_path: event.request_path || '/api/v1/internal-admin/overview',
          request_host: event.request_host || INTERNAL_ADMIN_HOSTNAME,
          metadata: event.metadata || {},
          created_at: event.created_at || new Date().toISOString(),
        }));
        internalAdminAuditEvents.unshift(...rows);
        return jsonResponse([]);
      }

      if (method === 'GET') {
        return jsonResponse(internalAdminAuditEvents);
      }
    }

    if (url.includes('/rest/v1/internal_admin_support_notes')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const row = {
          id: body.id || `support_note_${internalAdminSupportNotes.length + 1}`,
          organization_id: body.organization_id || 'org_123',
          note_type: body.note_type || 'support_note',
          body: body.body || 'Support note',
          created_by_user_id: body.created_by_user_id || 'user_123',
          created_by_email: body.created_by_email || stubAuthUserEmail,
          created_at: body.created_at || new Date().toISOString(),
        };
        internalAdminSupportNotes.unshift(row);
        return jsonResponse([row]);
      }
      if (method === 'GET') {
        return jsonResponse(internalAdminSupportNotes);
      }
    }

    if (url.includes('/rest/v1/internal_admin_business_status_updates')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const row = {
          id: body.id || `business_status_${internalAdminBusinessStatusUpdates.length + 1}`,
          organization_id: body.organization_id || 'org_123',
          status: body.status || 'onboarding',
          plan_label: body.plan_label || null,
          summary: body.summary || 'Status updated.',
          next_step: body.next_step || null,
          created_by_user_id: body.created_by_user_id || 'user_123',
          created_by_email: body.created_by_email || stubAuthUserEmail,
          created_at: body.created_at || new Date().toISOString(),
        };
        internalAdminBusinessStatusUpdates.unshift(row);
        return jsonResponse([row]);
      }
      if (method === 'GET') {
        return jsonResponse(internalAdminBusinessStatusUpdates);
      }
    }

    if (url.includes('/rest/v1/internal_admin_action_requests')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const row = {
          id: body.id || `action_request_${internalAdminActionRequests.length + 1}`,
          organization_id: body.organization_id || 'org_123',
          action_type: body.action_type || 'disable_org_access',
          risk_level: body.risk_level || 'critical',
          status: body.status || 'pending',
          reason: body.reason || 'Action requested.',
          requested_payload: body.requested_payload || {},
          requested_by_user_id: body.requested_by_user_id || stubAuthUserId,
          requested_by_email: body.requested_by_email || stubAuthUserEmail,
          approved_by_user_id: body.approved_by_user_id || null,
          approved_by_email: body.approved_by_email || null,
          approved_at: body.approved_at || null,
          rejected_by_user_id: body.rejected_by_user_id || null,
          rejected_by_email: body.rejected_by_email || null,
          rejected_at: body.rejected_at || null,
          executed_by_user_id: body.executed_by_user_id || null,
          executed_by_email: body.executed_by_email || null,
          executed_at: body.executed_at || null,
          decision_note: body.decision_note || null,
          created_at: body.created_at || new Date().toISOString(),
          updated_at: body.updated_at || new Date().toISOString(),
        };
        internalAdminActionRequests.unshift(row);
        return jsonResponse([row]);
      }
      if (method === 'PATCH') {
        const body = JSON.parse(init?.body || '{}');
        const requestId = decodedUrl.match(/[?&]id=eq\.([^&]+)/)?.[1];
        const index = internalAdminActionRequests.findIndex((row) => !requestId || row.id === requestId);
        if (index < 0 || internalAdminActionRequests[index].status !== 'pending') return jsonResponse([]);
        internalAdminActionRequests[index] = {
          ...internalAdminActionRequests[index],
          ...body,
          updated_at: body.updated_at || new Date().toISOString(),
        };
        return jsonResponse([internalAdminActionRequests[index]]);
      }
      if (method === 'GET') {
        const requestId = decodedUrl.match(/[?&]id=eq\.([^&]+)/)?.[1];
        const status = decodedUrl.match(/[?&]status=eq\.([^&]+)/)?.[1];
        return jsonResponse(internalAdminActionRequests.filter((row) => {
          return (!requestId || row.id === requestId) && (!status || row.status === status);
        }));
      }
    }

    if (url.includes('/rest/v1/internal_admin_action_execution_records')) {
      if (method === 'POST') {
        const body = JSON.parse(init?.body || '{}');
        const row = {
          id: body.id || `execution_record_${internalAdminActionExecutionRecords.length + 1}`,
          action_request_id: body.action_request_id || 'action_request_123',
          organization_id: body.organization_id || 'org_123',
          action_type: body.action_type || 'disable_org_access',
          execution_mode: body.execution_mode || 'dry_run',
          status: body.status || 'planned',
          execution_enabled: body.execution_enabled === true,
          preflight_result: body.preflight_result || {},
          rollback_payload: body.rollback_payload || {},
          executed_by_user_id: body.executed_by_user_id || stubAuthUserId,
          executed_by_email: body.executed_by_email || stubAuthUserEmail,
          executed_at: body.executed_at || new Date().toISOString(),
          created_at: body.created_at || new Date().toISOString(),
        };
        internalAdminActionExecutionRecords.unshift(row);
        return jsonResponse([row]);
      }
      if (method === 'GET') {
        const recordId = decodedUrl.match(/[?&]id=eq\.([^&]+)/)?.[1];
        const actionRequestId = decodedUrl.match(/[?&]action_request_id=eq\.([^&]+)/)?.[1];
        const organizationId = decodedUrl.match(/[?&]organization_id=eq\.([^&]+)/)?.[1];
        return jsonResponse(internalAdminActionExecutionRecords.filter((row) => {
          return (!recordId || row.id === recordId)
            && (!actionRequestId || row.action_request_id === actionRequestId)
            && (!organizationId || row.organization_id === organizationId);
        }));
      }
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

    if (url.startsWith('https://hooks.example.com/vaultproof-alerts') && method === 'POST') {
      alertWebhookTestPayload = JSON.parse(init?.body || '{}');
      return jsonResponse({ accepted: true }, 202);
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

async function assertEnterpriseExecuteDryRun() {
  installSupabaseStub();
  activeProject = fakeProject;

  const response = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-organization': 'org_123',
        origin: 'https://app.example.com',
      },
      body: JSON.stringify({
        dry_run: true,
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
  if (response.status !== 202) {
    throw new Error(`Expected dry-run execute route status 202, got ${response.status} ${JSON.stringify(payload)}`);
  }
  if (payload?.execution?.dryRun !== true || payload?.request?.dry_run !== true) {
    throw new Error(`Expected dry-run execution payload, got ${JSON.stringify(payload)}`);
  }
  if (payload?.execution?.signedEnvelope?.keyId !== 'enterprise-local' || !payload?.execution?.signedEnvelope?.signatureHash) {
    throw new Error(`Expected signed envelope metadata in dry-run payload, got ${JSON.stringify(payload?.execution)}`);
  }
  const dryRunAudit = auditEvents.find((event) => event.event_type === 'enterprise_secure_execution_validated');
  if (!dryRunAudit) {
    throw new Error('Expected dry-run execution validation audit event');
  }
  if (dryRunAudit.metadata?.dry_run !== true || !dryRunAudit.metadata?.signed_envelope?.signatureHash) {
    throw new Error(`Expected dry-run signed envelope evidence in audit metadata, got ${JSON.stringify(dryRunAudit.metadata)}`);
  }
}

async function assertEnterpriseRuntimeExecuteToken() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    allowed_origins: 'https://app.example.com',
    strict_origin: true,
    caller_lock_policy: {
      allowed_providers: ['openai'],
      allowed_methods: ['POST'],
      allowed_upstream_hosts: ['api.openai.com'],
      allowed_upstream_path_prefixes: ['/v1/responses'],
    },
  };
  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    enterpriseProxyTokenSecret: RUNTIME_TOKEN_SECRET,
    enterpriseExecuteContextCacheTtlMs: 5000,
    executorBaseUrl: 'https://executor.internal',
    executorSigningKeyId: 'enterprise-local',
    executorSigningSecret: 'local-secret',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
  const token = mintRuntimeToken({
    providers: ['openai'],
    slugs: ['openai'],
    methods: ['POST'],
    upstream_path_prefixes: ['/v1/responses'],
    customer_gateways: ['runtime-gateway'],
  });
  const buildRuntimeRequest = (gateway = 'runtime-gateway') => buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      origin: 'https://app.example.com',
      'x-vaultproof-customer-gateway': gateway,
    },
    body: JSON.stringify({
      dry_run: true,
      method: 'POST',
      upstream_path: '/v1/responses',
      headers: {
        'content-type': 'application/json',
      },
      body_base64: Buffer.from(JSON.stringify({ input: 'runtime hello' })).toString('base64'),
    }),
  });

  const firstResponse = await handleEnterpriseControlPlaneRequest(buildRuntimeRequest(), env);
  const firstPayload = await firstResponse.json();
  if (firstResponse.status !== 202 || firstPayload?.request?.auth_mode !== 'runtime_token') {
    throw new Error(`Expected runtime token dry-run execution, got ${firstResponse.status} ${JSON.stringify(firstPayload)}`);
  }
  if (authUserLookupCalls !== 0) {
    throw new Error('Expected runtime token execution to bypass Supabase user auth lookup');
  }
  if (firstPayload?.request?.execute_context_source !== 'supabase') {
    throw new Error(`Expected first runtime execution to load context from Supabase, got ${firstPayload?.request?.execute_context_source}`);
  }

  const secondResponse = await handleEnterpriseControlPlaneRequest(buildRuntimeRequest(), env);
  const secondPayload = await secondResponse.json();
  if (secondResponse.status !== 202 || secondPayload?.request?.execute_context_source !== 'cache') {
    throw new Error(`Expected second runtime execution to use cached context, got ${secondResponse.status} ${JSON.stringify(secondPayload)}`);
  }
  if (projectKeyGetCalls !== 1) {
    throw new Error(`Expected runtime context cache to avoid repeated provider slot lookups, got ${projectKeyGetCalls}`);
  }

  const gatewayDeniedResponse = await handleEnterpriseControlPlaneRequest(buildRuntimeRequest('wrong-gateway'), env);
  const gatewayDeniedPayload = await gatewayDeniedResponse.json();
  if (
    gatewayDeniedResponse.status !== 403
    || !String(gatewayDeniedPayload?.error || '').includes('Runtime token scope rejected gateway')
  ) {
    throw new Error(`Expected runtime token gateway denial, got ${gatewayDeniedResponse.status} ${JSON.stringify(gatewayDeniedPayload)}`);
  }

  const expiredToken = mintRuntimeToken({
    exp: Math.floor(Date.now() / 1000) - 120,
  });
  const expiredResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${expiredToken}`,
        'content-type': 'application/json',
        origin: 'https://app.example.com',
        'x-vaultproof-customer-gateway': 'runtime-gateway',
      },
      body: JSON.stringify({
        dry_run: true,
        method: 'POST',
        upstream_path: '/v1/responses',
      }),
    }),
    env,
  );
  const expiredPayload = await expiredResponse.json();
  if (expiredResponse.status !== 401 || !String(expiredPayload?.error || '').includes('runtime token')) {
    throw new Error(`Expected expired runtime token denial, got ${expiredResponse.status} ${JSON.stringify(expiredPayload)}`);
  }

  const runtimeAudit = auditEvents.find((event) => event.event_type === 'enterprise_secure_execution_validated');
  if (runtimeAudit?.actor_email !== 'runtime:runtime-smoke-token' || runtimeAudit?.metadata?.auth_mode !== 'runtime_token') {
    throw new Error(`Expected runtime actor metadata in audit event, got ${JSON.stringify(runtimeAudit)}`);
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
  const sourceIpEnv = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    executorSigningKeyId: 'enterprise-local',
    executorSigningSecret: 'local-secret',
    trustedSourceIpHeaderSecret: 'source-ip-secret',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
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
        'x-vaultproof-source-ip': '203.0.113.42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
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
        'x-vaultproof-source-ip': '198.51.100.42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('source IP')) {
    throw new Error(`Expected caller lock IP denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }

  const spoofedForwardedForResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/openai/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-client-class': 'server',
        'x-forwarded-for': '203.0.113.42',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
  );
  const spoofedForwardedForPayload = await spoofedForwardedForResponse.json();
  if (
    spoofedForwardedForResponse.status !== 403
    || !String(spoofedForwardedForPayload?.error || '').includes('source IP missing')
  ) {
    throw new Error(`Expected spoofed x-forwarded-for to fail closed, got ${spoofedForwardedForResponse.status} ${JSON.stringify(spoofedForwardedForPayload)}`);
  }
}

async function assertEnterpriseCallerLockIpv6Policy() {
  installSupabaseStub();
  const sourceIpEnv = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    executorSigningKeyId: 'enterprise-local',
    executorSigningSecret: 'local-secret',
    trustedSourceIpHeaderSecret: 'source-ip-secret',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
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
        'x-vaultproof-source-ip': '2001:db8:abcd:0012::42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
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
        'x-vaultproof-source-ip': '2001:db8:ffff::42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
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
  const sourceIpEnv = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    executorSigningKeyId: 'enterprise-local',
    executorSigningSecret: 'local-secret',
    trustedSourceIpHeaderSecret: 'source-ip-secret',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
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
        'x-vaultproof-source-ip': '203.0.113.42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
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
        'x-vaultproof-source-ip': '203.0.113.42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
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
        'x-vaultproof-source-ip': '203.0.113.42',
        'x-vaultproof-source-ip-secret': 'source-ip-secret',
      },
      body: JSON.stringify({
        method: 'GET',
        upstream_path: '/v1/models',
      }),
    }),
    sourceIpEnv,
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

async function assertEnterpriseCreateProviderSlot() {
  installSupabaseStub();
  activeProject = {
    ...fakeProject,
    caller_lock_policy: {
      allowed_customer_gateways: ['vaultproof-managed'],
      allowed_client_classes: ['browser'],
      provider_overrides: {
        resend: {
          allowed_methods: ['POST'],
          allowed_upstream_hosts: ['api.resend.com'],
          allowed_upstream_path_prefixes: ['/emails'],
          allowed_email_sender_domains: ['vaultproof.dev'],
          allowed_email_recipient_domains: ['example.com'],
          allowed_email_recipients: ['security-review@example.com'],
        },
      },
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

  const createResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'anthropic',
        slug: 'anthropic',
        upstream_base_url: 'https://api.anthropic.com',
        auth_header_name: 'x-api-key',
        auth_header_template: '{key}',
        extra_headers: { 'anthropic-version': '2023-06-01' },
      }),
    }),
    env,
  );
  const createPayload = await createResponse.json();
  if (createResponse.status !== 201 || createPayload?.provider_slot?.slug !== 'anthropic') {
    throw new Error(`Expected provider slot creation to succeed, got ${createResponse.status} ${JSON.stringify(createPayload)}`);
  }
  const createdSlot = providerSlotRows.find((slot) => slot.provider === 'anthropic');
  if (!createdSlot || !String(createdSlot.share1_encrypted || '').startsWith('demo-dashboard-placeholder-share-1:')) {
    throw new Error('Expected created provider slot to use demo placeholder material');
  }
  if (createdSlot.extra_headers?.['anthropic-version'] !== '2023-06-01') {
    throw new Error(`Expected created provider slot to persist non-secret extra headers, got ${JSON.stringify(createdSlot.extra_headers)}`);
  }
  const createAudit = auditEvents.find((event) => event.event_type === 'enterprise_provider_slot_created');
  if (!createAudit || createAudit.metadata?.material_mode !== 'demo-placeholder') {
    throw new Error('Expected provider slot creation governance audit event');
  }

  const liveMaterialResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'openai',
        upstream_base_url: 'https://api.openai.com',
        auth_header_name: 'authorization',
        auth_header_template: 'Bearer {key}',
        api_key: 'sk-live-material-must-not-enter-dashboard',
      }),
    }),
    env,
  );
  const liveMaterialPayload = await liveMaterialResponse.json();
  if (liveMaterialResponse.status !== 501 || !String(liveMaterialPayload?.error || '').includes('Live provider key ingest is not enabled')) {
    throw new Error(`Expected live key material to be rejected, got ${liveMaterialResponse.status} ${JSON.stringify(liveMaterialPayload)}`);
  }

  const rawExtraHeaderResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'github',
        upstream_base_url: 'https://api.github.com',
        auth_header_name: 'authorization',
        auth_header_template: 'Bearer {key}',
        extra_headers: { 'x-backup-key': 'sk-raw-secret-must-not-be-stored-in-extra-headers' },
      }),
    }),
    env,
  );
  const rawExtraHeaderPayload = await rawExtraHeaderResponse.json();
  if (rawExtraHeaderResponse.status !== 400 || !String(rawExtraHeaderPayload?.error || '').includes('must not contain raw secrets')) {
    throw new Error(`Expected raw extra header secrets to be rejected, got ${rawExtraHeaderResponse.status} ${JSON.stringify(rawExtraHeaderPayload)}`);
  }

  const emailSlotResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        provider: 'resend',
        slug: 'resend',
        upstream_base_url: 'https://api.resend.com',
        auth_header_name: 'authorization',
        auth_header_template: 'Bearer {key}',
      }),
    }),
    env,
  );
  const emailSlotPayload = await emailSlotResponse.json();
  if (emailSlotResponse.status !== 201 || emailSlotPayload?.provider_slot?.slug !== 'resend') {
    throw new Error(`Expected email provider slot creation to succeed, got ${emailSlotResponse.status} ${JSON.stringify(emailSlotPayload)}`);
  }

  const emailDryRunResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/resend/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        origin: 'https://enterprise.vaultproof.dev',
        'x-vaultproof-customer-gateway': 'vaultproof-managed',
        'x-vaultproof-client-class': 'browser',
      },
      body: JSON.stringify({
        method: 'POST',
        upstream_path: '/emails',
        headers: { 'content-type': 'application/json' },
        body_base64: Buffer.from(JSON.stringify({
          from: 'VaultProof Demo <demo@vaultproof.dev>',
          to: ['security-review@example.com'],
          subject: 'VaultProof protected email dry-run',
          text: 'VaultProof policy validated this email-provider call without exposing the raw key.',
        })).toString('base64'),
        dry_run: true,
      }),
    }),
    env,
  );
  const emailDryRunPayload = await emailDryRunResponse.json();
  if (emailDryRunResponse.status !== 202 || emailDryRunPayload?.request?.provider !== 'resend') {
    throw new Error(`Expected protected email dry-run to validate, got ${emailDryRunResponse.status} ${JSON.stringify(emailDryRunPayload)}`);
  }
  const emailDryRunAudit = auditEvents.find((event) => (
    event.event_type === 'enterprise_secure_execution_validated'
    && event.metadata?.provider === 'resend'
    && event.metadata?.protected_secret_kind === 'email_api_key'
  ));
  if (!emailDryRunAudit || emailDryRunAudit.metadata?.protected_workflow !== 'email_provider_send') {
    throw new Error(`Expected protected email dry-run audit metadata, got ${JSON.stringify(auditEvents)}`);
  }
  if (
    emailDryRunAudit.metadata?.email_policy?.sender_domain !== 'vaultproof.dev'
    || !emailDryRunAudit.metadata?.email_policy?.recipient_domains?.includes('example.com')
    || emailDryRunAudit.metadata?.email_policy?.recipient_count !== 1
  ) {
    throw new Error(`Expected protected email dry-run email policy metadata, got ${JSON.stringify(emailDryRunAudit.metadata)}`);
  }

  const deniedEmailResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/projects/${PROJECT_ID}/providers/resend/execute`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        origin: 'https://enterprise.vaultproof.dev',
        'x-vaultproof-customer-gateway': 'vaultproof-managed',
        'x-vaultproof-client-class': 'browser',
      },
      body: JSON.stringify({
        method: 'POST',
        upstream_path: '/emails',
        headers: { 'content-type': 'application/json' },
        body_base64: Buffer.from(JSON.stringify({
          from: 'VaultProof Demo <demo@vaultproof.dev>',
          to: ['blocked@untrusted.example'],
          subject: 'VaultProof protected email deny test',
          text: 'VaultProof should block this recipient domain.',
        })).toString('base64'),
        dry_run: true,
      }),
    }),
    env,
  );
  const deniedEmailPayload = await deniedEmailResponse.json();
  if (
    deniedEmailResponse.status !== 403
    || !String(deniedEmailPayload?.error || '').includes('Email policy for resend rejected recipient domain untrusted.example')
  ) {
    throw new Error(`Expected protected email policy denial, got ${deniedEmailResponse.status} ${JSON.stringify(deniedEmailPayload)}`);
  }
  const deniedEmailAudit = auditEvents.find((event) => (
    event.event_type === 'enterprise_caller_lock_denied'
    && event.metadata?.policy_scope === 'provider_email_policy'
    && event.metadata?.provider === 'resend'
  ));
  if (
    !deniedEmailAudit
    || deniedEmailAudit.metadata?.protected_secret_kind !== 'email_api_key'
    || !deniedEmailAudit.metadata?.email_policy?.recipient_domains?.includes('untrusted.example')
  ) {
    throw new Error(`Expected protected email denial audit metadata, got ${JSON.stringify(auditEvents)}`);
  }
}

async function assertEnterpriseProjectOverviewRollup() {
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

  const bootstrapResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/projects/bootstrap', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const bootstrapPayload = await bootstrapResponse.json();
  if (bootstrapResponse.status !== 200 || bootstrapPayload?.overview?.statsSource !== 'bootstrap_rpc') {
    throw new Error(`Expected projects bootstrap to use consolidated bootstrap RPC, got ${bootstrapResponse.status} ${JSON.stringify(bootstrapPayload?.overview)}`);
  }
  if (bootstrapPayload?.overview?.accessLogStatsSource !== 'rollup_rpc' || bootstrapRpcCalls !== 1) {
    throw new Error(`Expected bootstrap RPC to wrap rollup stats once, got calls=${bootstrapRpcCalls} overview=${JSON.stringify(bootstrapPayload?.overview)}`);
  }
  if (bootstrapPayload.overview.totalCalls !== 1 || bootstrapPayload.overview.recentActivity?.[0]?.metadata?.status_code !== 200) {
    throw new Error(`Expected rollup overview traffic summary, got ${JSON.stringify(bootstrapPayload.overview)}`);
  }
  if (
    bootstrapPayload.overview.providerSlotSummary?.placeholderSlots !== 1
    || bootstrapPayload.overview.providerUsage?.[0]?.provider !== 'openai'
    || bootstrapPayload.overview.providerUsage?.[0]?.recentCalls !== 1
    || bootstrapPayload.overview.trafficBreakdown?.okCalls !== 1
    || bootstrapPayload.overview.projectCoverage?.withProviderSlots !== 1
    || !Array.isArray(bootstrapPayload.overview.callTrend)
  ) {
    throw new Error(`Expected bootstrap overview to include provider key visual summaries, got ${JSON.stringify(bootstrapPayload.overview)}`);
  }
  const slot = bootstrapPayload.projects?.[0]?.provider_slots?.[0];
  if (slot?.material_mode !== 'demo-placeholder' || slot?.material_ready !== false) {
    throw new Error(`Expected provider slot material status without exposing shares, got ${JSON.stringify(slot)}`);
  }
  if ('share1_encrypted' in slot || 'share2_encrypted' in slot) {
    throw new Error(`Provider slot API must not expose encrypted share payloads: ${JSON.stringify(slot)}`);
  }

  const overviewResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/projects/stats/overview', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const overviewPayload = await overviewResponse.json();
  if (overviewResponse.status !== 200 || overviewPayload?.statsSource !== 'rollup_rpc') {
    throw new Error(`Expected projects stats overview to use rollup stats, got ${overviewResponse.status} ${JSON.stringify(overviewPayload)}`);
  }
  if (
    overviewPayload.providerSlotSummary?.placeholderSlots !== 1
    || overviewPayload.providerUsage?.[0]?.provider !== 'openai'
    || overviewPayload.trafficBreakdown?.okCalls !== 1
    || overviewPayload.projectCoverage?.withProviderSlots !== 1
    || !Array.isArray(overviewPayload.callTrend)
  ) {
    throw new Error(`Expected projects stats overview to include dashboard visual summaries, got ${JSON.stringify(overviewPayload)}`);
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

async function assertEnterpriseAlertsApi() {
  installSupabaseStub();

  const response = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/alerts?activity_window=7d&delivery_status=delivered&delivery_channel=email&delivery_kind=policy_dispatch&delivery_q=readiness', {
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
  const payload = await response.json();
  if (response.status !== 200) {
    throw new Error(`Expected alerts API to succeed, got ${response.status} ${JSON.stringify(payload)}`);
  }
  if (payload?.policy?.dispatch_enabled !== true || payload?.policy?.minimum_severity !== 'warning') {
    throw new Error(`Expected alert policy in alerts API payload, got ${JSON.stringify(payload?.policy)}`);
  }
  if (!Array.isArray(payload?.destinations) || payload.destinations.length !== 2) {
    throw new Error(`Expected alert destinations in alerts API payload, got ${JSON.stringify(payload?.destinations)}`);
  }
  if (!String(payload.destinations[0].target_masked || '').includes('se***@example.com')) {
    throw new Error(`Expected alert destination target to be masked, got ${JSON.stringify(payload.destinations[0])}`);
  }
  if (!Array.isArray(payload?.delivery_logs) || !payload.delivery_logs.find((item) => item.status === 'delivered')) {
    throw new Error(`Expected delivered alert log in alerts API payload, got ${JSON.stringify(payload?.delivery_logs)}`);
  }
  if (!Array.isArray(payload?.dispatch_runs) || payload.dispatch_runs[0]?.status !== 'dispatched') {
    throw new Error(`Expected dispatch run in alerts API payload, got ${JSON.stringify(payload?.dispatch_runs)}`);
  }

  const testSendResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/alerts/test-send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-organization': 'org_123',
      },
      body: JSON.stringify({
        destination_id: 'alert_dest_webhook_123',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const testSendPayload = await testSendResponse.json();
  if (testSendResponse.status !== 200 || testSendPayload?.status !== 'delivered') {
    throw new Error(`Expected alert test-send to deliver, got ${testSendResponse.status} ${JSON.stringify(testSendPayload)}`);
  }
  if (alertWebhookTestPayload?.event !== 'vaultproof.enterprise.alert.test') {
    throw new Error(`Expected webhook test payload, got ${JSON.stringify(alertWebhookTestPayload)}`);
  }
  if (alertTestDelivery?.delivery_kind !== 'test_send' || alertTestDelivery?.status !== 'delivered') {
    throw new Error(`Expected alert test delivery log insert, got ${JSON.stringify(alertTestDelivery)}`);
  }
  if (alertTestDispatchRun?.trigger_source !== 'manual' || alertTestDispatchRun?.status !== 'dispatched') {
    throw new Error(`Expected alert test dispatch run insert, got ${JSON.stringify(alertTestDispatchRun)}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/alerts/test-send', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-organization': 'org_123',
      },
      body: JSON.stringify({
        destination_id: 'missing-destination',
      }),
    }),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      supabaseUrl: 'https://supabase.example.co',
      supabaseServiceRoleKey: 'service-role-key',
    },
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 400 || !String(deniedPayload?.error || '').includes('not enabled')) {
    throw new Error(`Expected missing alert destination denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
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
        role: 'auditor',
      }),
    }),
    env,
  );
  const invitePayload = await inviteResponse.json();
  if (inviteResponse.status !== 200 || invitePayload?.invitation?.email !== 'reviewer@example.com') {
    throw new Error(`Expected invitation creation to normalize email, got ${inviteResponse.status} ${JSON.stringify(invitePayload)}`);
  }
  if (createdMemberInvitation?.role !== 'auditor') {
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
      body: JSON.stringify({ role: 'iam_admin' }),
    }),
    env,
  );
  const rolePayload = await roleResponse.json();
  if (roleResponse.status !== 200 || rolePayload?.member?.role !== 'iam_admin' || updatedMemberRole !== 'iam_admin') {
    throw new Error(`Expected role update to succeed, got ${roleResponse.status} ${JSON.stringify(rolePayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'organization_member_role_updated')) {
    throw new Error('Expected member role update audit event');
  }

  const assignResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest(`/api/v1/enterprise/members/user_456/projects/${PROJECT_ID}/access`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ role: 'operator' }),
    }),
    env,
  );
  const assignPayload = await assignResponse.json();
  if (assignResponse.status !== 200 || assignPayload?.project_access?.role !== 'operator' || updatedProjectAccess?.project_id !== PROJECT_ID) {
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

async function assertEnterpriseVerifierApi() {
  installSupabaseStub();
  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    enterpriseRuntimeTier: 'shared-demo',
    executorBaseUrl: 'https://executor.internal',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
  const headers = {
    authorization: `Bearer ${AUTH_TOKEN}`,
    'content-type': 'application/json',
    'x-vaultproof-organization': 'org_123',
  };

  const listResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/verifier', { headers }),
    env,
  );
  const listPayload = await listResponse.json();
  if (listResponse.status !== 200 || listPayload?.schema_ready !== true || !Array.isArray(listPayload.models)) {
    throw new Error(`Expected AI Proof Verifier list to load, got ${listResponse.status} ${JSON.stringify(listPayload)}`);
  }
  if (!listPayload.proof_systems?.includes('vaultproof-manifest-v1') || !listPayload.proof_systems?.includes('external-verifier')) {
    throw new Error('Expected verifier capabilities to list supported proof systems');
  }
  if (listPayload.shared_attestation?.mode !== 'shared-enterprise-runtime-attestation') {
    throw new Error('Expected verifier API to expose shared demo attestation mode');
  }
  if (listPayload.shared_attestation?.runtime_tier !== 'shared-demo' || listPayload.shared_attestation?.customer_dedicated_runtime !== false) {
    throw new Error('Expected verifier API to expose non-dedicated shared demo runtime tier');
  }

  const modelResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/verifier/models', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: PROJECT_ID,
        model_ref: 'credit-risk-xgb-v1',
        display_name: 'Credit Risk XGBoost v1',
        model_family: 'classification',
        allowed_proof_systems: ['vaultproof-manifest-v1', 'external-verifier'],
      }),
    }),
    env,
  );
  const modelPayload = await modelResponse.json();
  if (modelResponse.status !== 200 || modelPayload?.model?.model_ref !== 'credit-risk-xgb-v1') {
    throw new Error(`Expected verifier model registration to succeed, got ${modelResponse.status} ${JSON.stringify(modelPayload)}`);
  }
  if (!auditEvents.find((event) => event.event_type === 'enterprise_ai_verifier_model_registered')) {
    throw new Error('Expected verifier model registration audit event');
  }

  const proofResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/enterprise/verifier/proofs', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        project_id: PROJECT_ID,
        model_ref: 'credit-risk-xgb-v1',
        proof_system: 'vaultproof-manifest-v1',
        claimed_output_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        proof_bundle: {
          proof_system: 'vaultproof-manifest-v1',
          project_id: PROJECT_ID,
          model_ref: 'credit-risk-xgb-v1',
          claimed_output_hash: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          proof: 'external-model-ran-outside-vaultproof',
        },
      }),
    }),
    env,
  );
  const proofPayload = await proofResponse.json();
  if (proofResponse.status !== 200 || proofPayload?.verification?.status !== 'verified') {
    throw new Error(`Expected manifest proof bundle to verify, got ${proofResponse.status} ${JSON.stringify(proofPayload)}`);
  }
  if (proofPayload.verification.evidence?.model_execution_hosted_by_vaultproof !== false) {
    throw new Error('Expected verifier evidence to state VaultProof did not run the model');
  }
  if (proofPayload.verification.evidence?.runtime_binding?.shared_attestation_mode !== 'shared-enterprise-runtime-attestation') {
    throw new Error('Expected verifier evidence to bind demo proof to shared runtime attestation');
  }
  if (!auditEvents.find((event) => event.event_type === 'enterprise_ai_proof_verified')) {
    throw new Error('Expected proof verification audit event');
  }
}

async function assertEnterpriseLoginRoute() {
  const rootResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const rootHtml = await rootResponse.text();
  if (rootResponse.status !== 200 || !rootHtml.includes('VaultProof - API keys that are harder to steal')) {
    throw new Error(`Expected enterprise root homepage, got ${rootResponse.status}`);
  }
  for (const required of [
    'Active Key Protection<br><em>for every API call.</em>',
    'VaultProof is a safe middle layer for important API keys',
    'Illustrative · safe API calls',
    'Your app talks to <em>VaultProof</em> instead of holding keys.',
    'Keep your code. <em>Stop storing the key.</em>',
    'enterprise-homepage-dashboard-match',
    '--primary-bg: #315f95',
    '--body: ui-sans-serif',
    'letter-spacing: 0 !important',
    '/app/login',
    '/app/dashboard',
    '/readiness',
  ]) {
    if (!rootHtml.includes(required)) {
      throw new Error(`Expected enterprise homepage to include ${required}`);
    }
  }
  if (rootHtml.includes('https://init.vaultproof.dev') || rootHtml.includes('https://api.vaultproof.dev')) {
    throw new Error('Enterprise homepage must not reference B2C API origins');
  }
  if (rootHtml.includes('fonts.googleapis.com') || rootHtml.includes('Newsreader') || rootHtml.includes('Inter Tight')) {
    throw new Error('Enterprise homepage must use the dashboard system-font theme, not the old editorial font theme');
  }
  if (rootHtml.includes('cdn.mxpnl.com') || rootHtml.includes('Enterprise Page Viewed')) {
    throw new Error('Enterprise homepage Mixpanel analytics must be disabled unless ENTERPRISE_MIXPANEL_TOKEN is configured');
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
  if (html.includes('cdn.mxpnl.com') || html.includes('Enterprise Page Viewed')) {
    throw new Error('Enterprise Mixpanel analytics must be disabled unless ENTERPRISE_MIXPANEL_TOKEN is configured');
  }
  if (html.includes('fonts.googleapis.com') || html.includes('Newsreader') || html.includes('Inter Tight')) {
    throw new Error('Enterprise login page must use the dashboard system-font theme, not the old editorial font theme');
  }
  if (!html.includes('enterprise only')) {
    throw new Error('Expected enterprise-only login copy');
  }
  for (const required of [
    'enterprise-login-dashboard-match',
    '--primary-bg: #315f95',
    '--body: ui-sans-serif',
    'letter-spacing: 0 !important',
    'Sign in to the place where your <em>API keys stay safe.</em>',
    'Enterprise access',
    'Move real API keys out of apps, env vars, and logs.',
    'Manage protected keys, access rules, team members, audit records, and provider settings.',
    'continue with microsoft',
    'Continue with company SAML SSO',
    'email me a sign-in link',
    'recoveryForm',
    'back to enterprise homepage',
  ]) {
    if (!html.includes(required)) {
      throw new Error(`Expected themed enterprise login page to include ${required}`);
    }
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
  if (
    loginScriptResponse.status !== 200
    || !loginScript.includes('IS_INTERNAL_ADMIN_HOST')
    || !loginScript.includes("window.location.hostname === 'admin.vaultproof.dev'")
    || !loginScript.includes('/internal/admin')
    || !loginScript.includes('normalizeOrgTarget')
    || !loginScript.includes("params.set('org', orgTarget)")
    || !loginScript.includes('IS_AZURE_CONTROL_PLANE_HOST')
    || !loginScript.includes("hd: 'vaultproof.dev'")
    || !loginScript.includes("loginWithProvider('azure'")
    || !loginScript.includes('signInWithOtp')
    || !loginScript.includes('updateUser({ password })')
    || !loginScript.includes("auth: 'recovery'")
  ) {
    throw new Error(`Expected enterprise login script to route enterprise users to dashboard, got ${loginScriptResponse.status}`);
  }

  function assertDashboardShellTheme(path, pageHtml) {
    for (const required of [
      'VaultProof Enterprise',
      'nav-label">workspace',
      'nav-label">evidence',
      'nav-label">guides',
      'Organization Workspace',
      'Provisioned organization',
      '/app/dashboard',
      '/app/evidence',
      '/app/release',
      '/app/control',
      '/app/policy',
      '/app/verifier',
      '/app/org',
      'Readiness',
      'Health',
      '/app/technical-guide',
      '/app/runbooks',
      '/app/logout',
      'Sign out',
      'confidential dashboard',
      'enterprise-app-sidebar',
      'data-enterprise-sidebar="universal"',
      'data-ui-kit="shadcn-studio"',
      'sidebar-panel',
      'workspace-card',
      'nav-group-summary',
      'nav-group-count',
      'nav-group-links',
      'active-group',
      'nav-link-blurb',
      'enterprise-universal-sidebar',
      '--background: #f8fafc',
      '--foreground: #0f172a',
      '--sidebar-bg: var(--card)',
      '--sidebar-card-bg: var(--muted-bg)',
      '--sidebar-link-active-bg: var(--accent-bg)',
      '--sidebar-link-active-border: rgba(49, 95, 149, 0.22)',
      '--card-bg: var(--card)',
      '--primary-bg: var(--primary)',
      '--radius: 8px',
      '.sidebar.enterprise-app-sidebar .nav-link',
      'border: 1px solid var(--border);',
      'background: var(--muted-bg);',
      'color: var(--sidebar-muted);',
      'box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);',
      'letter-spacing: 0 !important;',
      '--muted: var(--muted-foreground)',
      '--soft: var(--muted-foreground)',
      'font-size: 14px;',
      'font-weight: 600;',
      'font-size: 1.875rem',
    ]) {
      if (!pageHtml.includes(required)) {
        throw new Error(`Expected ${path} to use the main enterprise dashboard shell theme (${required})`);
      }
    }
    if (!pageHtml.includes('font-size: 2.6rem') && !pageHtml.includes('font-size: 2.25rem')) {
      throw new Error(`Expected ${path} to use a responsive enterprise hero heading size`);
    }
    if (pageHtml.includes('https://admin.vaultproof.dev/internal/admin')) {
      throw new Error(`Expected ${path} customer shell to keep internal admin off the enterprise host`);
    }
    for (const pageSpecificSidebarSubtitle of [
      'policy control',
      'organization setup',
      'members + access',
      'audit evidence',
      'alert operations',
    ]) {
      if (pageHtml.includes(`<div class="brand-sub">${pageSpecificSidebarSubtitle}</div>`)) {
        throw new Error(`Expected ${path} to use the shared sidebar subtitle, not ${pageSpecificSidebarSubtitle}`);
      }
    }
    for (const removedShellElement of [
      'class="mark">VP',
      'Setup order',
      'overflow-y: auto',
      '--card-bg: linear-gradient',
    ]) {
      if (pageHtml.includes(removedShellElement)) {
        throw new Error(`Expected ${path} to omit removed dashboard shell element (${removedShellElement})`);
      }
    }
  }

  function assertPilotTesterLocalStorage(pageHtml) {
    for (const required of [
      "return 'vaultproof_pilot_testers::' + (currentOrgId || 'default');",
      'localStorage.setItem(pilotTesterStorageKey(), JSON.stringify((rows || []).slice(0, 60)));',
      "id: 'tester-' + Date.now().toString(36)",
      'created_at: now',
      'updated_at: now',
      "target.hasAttribute('data-tester-field')",
      "target.getAttribute('data-action') === 'remove-pilot-tester'",
      'redactTesterText',
      'testerSecretPattern',
    ]) {
      if (!pageHtml.includes(required)) {
        throw new Error(`Expected pilot tester local-storage behavior to include ${required}`);
      }
    }
  }

  function assertPaidOnboardingLocalStorage(pageHtml) {
    for (const required of [
      "return 'vaultproof_paid_onboarding:' + (currentOrgId || 'default');",
      'localStorage.setItem(paidOnboardingStorageKey(), JSON.stringify(state));',
      'PAID_ONBOARDING_MANUAL_STALE_MS',
      'PAID_ONBOARDING_ROLE_TASKS',
      'isStalePaidOnboardingEvidence',
      'paidOnboardingRoleTaskRows',
      'role_task_checklist',
      'role_task_summary',
      "status: target.checked ? 'passed' : 'missing'",
      "target.hasAttribute('data-onboarding-status')",
      "target.hasAttribute('data-onboarding-owner')",
      "target.hasAttribute('data-onboarding-due')",
      "target.hasAttribute('data-onboarding-note')",
    ]) {
      if (!pageHtml.includes(required)) {
        throw new Error(`Expected paid onboarding local-storage behavior to include ${required}`);
      }
    }
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
    if (!dashboardHtml.includes('loadPanel(sequence') || !dashboardHtml.includes('project stats')) {
      throw new Error('Expected enterprise dashboard to render data panels progressively');
    }
    assertDashboardShellTheme(dashboardPath, dashboardHtml);
    if (!dashboardHtml.includes('confidential dashboard') || dashboardHtml.includes('GCP confidential dashboard')) {
      throw new Error('Expected enterprise dashboard sidebar subtitle to omit GCP');
    }
    for (const requiredFeature of [
      'Enterprise dashboard',
      'API Key Security Overview',
      'enterprise-page-shell',
      'control-center-card',
      'dashboard-hero',
      'hero-row',
      'hero-status',
      'data-ui-kit="shadcn-studio"',
      '--background: #f8fafc',
      '--card: #ffffff',
      '--muted-bg: #f1f5f9',
      '--border: #e2e8f0',
      '--radius: 8px',
      'dashboard-overview-grid',
      'top-insight-grid',
      'overview-rail',
      'Needs attention',
      'attentionList',
      'Evidence readiness',
      'Control center',
      'Enterprise dashboard tabs',
      'Overview',
      'Key Map',
      'Security',
      'Access',
      'Operations',
      'API Calls',
      'callWindowTotal',
      'callWindowAllowed',
      'Selected window:',
      'trend-line-chart',
      'trend-svg',
      'trend-area',
      'trend-axis',
      'data-call-range="7"',
      'data-call-range="14"',
      'data-call-range="30"',
      'DASHBOARD_SAMPLE_DATA_ENABLED',
      'sample_dashboard',
      'sample data',
      'Key readiness',
      'materialDonut',
      'API call results',
      'trafficOutcomeBar',
      'Project coverage',
      'projectCoverageList',
      'callTrendChart',
      'Provider usage',
      'providerUsageList',
      'Key map by provider',
      'keyMapProviderList',
      'Key setup readiness',
      'Organization coverage',
      'providerSlotSummary',
      'providerUsage',
      'trafficBreakdown',
      'callTrend',
      'Setup access checklist',
      'Release evidence',
      'Tester readiness',
      'Provider slots',
      'Access review',
      'Attention signals',
      'Operational runbooks',
    ]) {
      if (!dashboardHtml.includes(requiredFeature)) {
        throw new Error(`Expected enterprise dashboard feature map to include ${requiredFeature}`);
      }
    }
    if (dashboardHtml.indexOf('API Calls') > dashboardHtml.indexOf('Needs attention')) {
      throw new Error('Expected enterprise dashboard API call chart to render before attention items');
    }
    for (const forbiddenFeature of [
      'Set up and run your business account.',
      'Use this dashboard to finish onboarding',
      'Connect the organization.',
      'Configure projects.',
      'Go live safely.',
      'Enterprise homepage',
      'Public page for people who have not signed in yet',
      'Enterprise login',
      'Enterprise-only sign-in',
      'Workspace tools',
      'Operator shortcuts',
      'Use these pages to configure the account',
      'dashboard-primary-actions',
      'Enterprise key security metrics',
      'security-status-card',
      'Workspace status',
      'API calls over time',
      'dashboard-context-grid',
      'dashboard-refresh-control',
      'Refresh data',
      'chart-context-grid',
      'contextKeySlots',
      'trend-bars',
      'trend-column',
      'Provider material',
      'Traffic outcome',
      'API call trend',
      'Material readiness',
      'status-check-grid',
      'statusMaterial',
      'statusTraffic',
      'statusCoverage',
      'Open provider slots',
      'Export evidence',
    ]) {
      if (dashboardHtml.includes(forbiddenFeature)) {
        throw new Error(`Enterprise dashboard must not include forbidden copy or duplicate navigation: ${forbiddenFeature}`);
      }
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
  for (const requiredIamCopy of ['Role guide', 'IAM Admin', 'Security Admin', 'Platform Admin', 'Auditor']) {
    if (!membersHtml.includes(requiredIamCopy)) {
      throw new Error(`Expected enterprise members page to include expanded IAM role copy: ${requiredIamCopy}`);
    }
  }
  assertDashboardShellTheme('/app/members', membersHtml);

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
  assertDashboardShellTheme('/app/audit', auditHtml);

  const alertsResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/alerts'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
    },
  );
  const alertsHtml = await alertsResponse.text();
  if (alertsResponse.status !== 200 || !alertsHtml.includes('Alerts - VaultProof Enterprise')) {
    throw new Error(`Expected enterprise alerts page, got ${alertsResponse.status}`);
  }
  if (!alertsHtml.includes('/api/v1/enterprise/alerts') || !alertsHtml.includes('deliveryFilterForm')) {
    throw new Error('Expected enterprise alerts page to use enterprise alerts API and delivery filters');
  }
  if (!alertsHtml.includes('/api/v1/enterprise/alerts/test-send') || alertsHtml.includes('Test-send API is planned') || alertsHtml.includes('https://init.vaultproof.dev')) {
    throw new Error('Expected enterprise alerts page to use enterprise test-send API and avoid B2C APIs');
  }
  assertDashboardShellTheme('/app/alerts', alertsHtml);

  const operationsPages = [
    {
      path: '/app/activity',
      title: 'Activity - VaultProof Enterprise',
      required: ['/api/v1/enterprise/audit', 'activityFilterForm'],
    },
    {
      path: '/app/projects',
      title: 'Projects - VaultProof Enterprise',
      required: ['/api/v1/enterprise/projects/bootstrap', 'Project inventory'],
    },
    {
      path: '/app/inventory',
      title: 'API Inventory - VaultProof Enterprise',
      required: ['/api/v1/enterprise/projects/bootstrap', 'API inventory board', 'add API key', 'manual API key', 'vaultproof_manual_api_keys', 'data-manual-key-field', 'key fingerprint', 'needs sealed ingest', 'import CSV/OpenAPI', 'inventoryImportForm', 'parseInventoryCsv', 'parseOpenApiInventoryHints', 'vaultproof_inventory_import', 'imported_api_hints', 'inventoryFilterForm', 'inventorySearch', 'inventoryStatusFilter', 'inventoryReviewFilter', 'inventoryRiskFilter', 'inventorySourceFilter', 'apply filters', 'clearInventoryFilters', 'copy filtered CSV', 'copyFilteredInventoryCsvBtn', 'copyFilteredInventoryCsv', 'copy-filtered-inventory-csv', 'filteredInventoryRows', 'inventoryBulkReviewForm', 'bulkInventoryReviewStatus', 'bulkInventoryNextReview', 'apply filtered review', 'applyInventoryBulkReview', 'bulk_reviewed_at', 'copy review brief', 'copyInventoryReviewBriefBtn', 'copyInventoryReviewBrief', 'copy-inventory-review-brief', 'inventoryReviewBrief', 'VaultProof API inventory review brief', 'Priority actions', 'inventoryRowMatchesFilters', 'vaultproof_api_inventory', 'data-inventory-field', 'business owner', 'technical owner', 'data sensitivity', 'review status', 'review due', 'copy inventory CSV', 'copyInventoryCsvBtn', 'copy-inventory-csv', 'inventoryEvidenceCsv', 'export_formats', 'copy inventory JSON', 'vaultproof_enterprise_api_inventory', '/app/control', '/app/keys', '/app/activity', '/app/evidence', '/app/security-review', '/api/v1/enterprise/audit?format=csv&days=30', '/api/v1/enterprise/members/access-review?format=csv'],
    },
    {
      path: '/app/policy',
      title: 'Policy Drift - VaultProof Enterprise',
      required: ['/api/v1/enterprise/projects/bootstrap', 'Policy drift board', 'Exception evidence', 'accepted-risk records', 'vaultproof_policy_exceptions', 'policyFilterForm', 'policySearch', 'policySeverityFilter', 'policyStatusFilter', 'policyControlFilter', 'clearPolicyFilters', 'policyRowMatchesFilters', 'filteredPolicyRows', 'copy drift brief', 'copyPolicyBriefBtn', 'copyPolicyBrief', 'copy-policy-brief', 'policyDriftBrief', 'VaultProof policy drift review brief', 'data-policy-field', 'exception owner', 'accepted-risk reason', 'compensating control', 'expiration date', 'copy policy JSON', 'vaultproof_enterprise_policy_drift', 'strict-origin-missing', 'gateway-lock-missing', '/app/control', '/app/inventory', '/app/keys', '/app/activity', '/app/evidence', '/app/security-review'],
    },
    {
      path: '/app/rollout',
      title: 'Rollout Manager - VaultProof Enterprise',
      required: ['/api/v1/enterprise/projects/bootstrap', 'Integration rollout board', 'Rollout evidence', 'workload cutover', 'vaultproof_integration_rollouts', 'rolloutFilterForm', 'rolloutSearch', 'rolloutStatusFilter', 'rolloutModeFilter', 'rolloutTestFilter', 'rolloutBlockerFilter', 'clearRolloutFilters', 'rolloutRowMatchesFilters', 'filteredRolloutRows', 'copy rollout brief', 'copyRolloutBriefBtn', 'copyRolloutBrief', 'copy-rollout-brief', 'rolloutBrief', 'VaultProof integration rollout brief', 'data-rollout-field', 'application/workload', 'integration mode', 'app owner', 'gateway owner', 'canary percent', 'rollback path', 'copy rollout JSON', 'copy snippet', 'vaultproof_enterprise_integration_rollout', 'YOUR_VAULTPROOF_SESSION_JWT', '/app/control', '/app/inventory', '/app/policy', '/app/keys', '/app/activity', '/app/evidence', '/app/security-review'],
    },
    {
      path: '/app/keys',
      title: 'Provider Slots - VaultProof Enterprise',
      required: ['/api/v1/enterprise/projects', 'add slot', 'create slot', 'Extra headers JSON', 'slotExtraHeaders', 'generic-bearer', 'generic-header', 'minimax', 'github', 'notion', 'cloudflare', 'anthropic-version', 'apikey', 'x-algolia-application-id', 'emergency revoke', 'live sealed material', 'placeholder material', 'Customer API proxy test kit', 'copy dry-run request', 'copy blocked-recipient request', 'YOUR_VAULTPROOF_SESSION_JWT', 'Email API key walkthrough', 'protected email dry-run', 'blocked recipient test', 'Policy denial evidence', 'resend', 'sendgrid', 'postmark', 'brevo', 'mailersend', 'sendinblue', 'sparkpost', 'mailtrap', 'supabase', 'algolia', 'shopify', 'grafana', 'weaviate', 'langfuse', 'azure-openai', 'nvidia', 'sambanova', 'fal', 'brave-search', 'serper', 'unstructured', 'qdrant', 'turso', 'netlify', 'digitalocean', 'heroku', 'fly', 'railway', 'terraform-cloud', 'pulumi', 'fastly', 'tailscale', 'azure-management', 'gcp-resource-manager', 'microsoft-graph', 'google-workspace', 'bitbucket', 'circleci', 'buildkite', 'dockerhub', 'quay', 'npm-registry', 'betterstack', 'logsnag', 'raygun', 'semgrep', 'sonarcloud', 'elasticsearch', 'elastic-cloud', 'meilisearch', 'typesense', 'kubernetes', 'hashicorp-vault', 'onepassword-connect', 'doppler', 'infisical', 'segment', 'plausible', 'hume', 'runpod', 'webflow', 'salesforce', 'zoho-crm', 'zoom', 'facebook-graph', 'linkedin', 'wordpress', 'okta', 'opsgenie', 'axiom', 'rollbar', 'asana', 'monday', 'clickup', 'figma', 'zendesk', 'jira', 'adyen', 'chargebee', 'x-figma-token', 'SSWS {key}', 'GenieKey {key}', 'ApiKey {key}', 'x-vault-token', 'circle-token', 'Zoho-oauthtoken {key}', 'fastly-key', 'application/vnd.heroku+json; version=3'],
    },
  ];
  for (const page of operationsPages) {
    const response = await handleEnterpriseControlPlaneRequest(
      buildRequest(page.path),
      {
        enterpriseHostname: ENTERPRISE_HOSTNAME,
      },
    );
    const html = await response.text();
    if (response.status !== 200 || !html.includes(page.title)) {
      throw new Error(`Expected enterprise operations page for ${page.path}, got ${response.status}`);
    }
    for (const required of page.required) {
      if (!html.includes(required)) {
        throw new Error(`Expected ${page.path} to include ${required}`);
      }
    }
    if (html.includes('https://init.vaultproof.dev') || html.includes('https://api.vaultproof.dev')) {
      throw new Error(`Enterprise operations page ${page.path} must not load B2C APIs`);
    }
    assertDashboardShellTheme(page.path, html);
  }

  const supportPages = [
    {
      path: '/app/docs',
      title: 'Enterprise docs - VaultProof Enterprise',
      required: ['Enterprise-only documentation', 'Enterprise docs index', 'Dashboard functions', 'Overview tab', 'Key Map tab', 'Security tab', 'Access tab', 'Operations tab', 'Workspace features and functions', 'API Inventory', 'Policy Drift', 'Rollout Manager', 'AI Proof Verifier', 'Org + SSO', 'Dashboard exports and evidence functions', 'vaultproof_enterprise_evidence_packet', 'vaultproof_enterprise_key_exposure_response', 'Key exposure response', 'Exposure response sequence', 'Enterprise SSO docs', 'Provider Slots', 'scanner_open_exposure', 'needs_rotation', 'ready_to_contain', 'incident JSON packet', 'VaultProof can immediately disable or audit traffic routed through VaultProof', '/app/setup', '/app/technical-guide', '/app/security-review', '/app/runbooks', '/app/evidence', '/app/keys', '/app/scanner', '/app/inventory', '/app/policy', '/app/rollout'],
    },
    {
      path: '/app/setup',
      title: 'Enterprise setup guide - VaultProof Enterprise',
      required: ['Welcome to VaultProof Enterprise', 'Map your enterprise environment', 'Configure identity and access', 'Choose the gateway and network pattern', 'Configure projects, provider slots, and policy', 'Evidence, alerts, and compliance', 'Go live gradually', 'Customer-managed gateway', 'Dry-run first', '/app/technical-guide'],
    },
    {
      path: '/app/evidence',
      title: 'Evidence packet - VaultProof Enterprise',
      required: ['Evidence readiness', 'Customer exports', 'Proof inventory', 'Review workflow', 'Identity/OAuth proof', 'Key rotation proof', 'Key exposure response proof', 'Pilot operations proof', 'API proxy self-test proof', 'API inventory proof', 'Policy drift proof', 'Integration rollout proof', 'Scanner exposure proof', 'Launch support proof', 'Monitoring evidence proof', 'Release evidence proof', 'Paid-pilot tester proof', 'Contract entitlements proof', 'Paid onboarding proof', 'Go/no-go launch decision', 'go_no_go', 'manual_evidence', 'identity_login_qa', 'key_rotation_evidence', 'key_exposure_response', 'pilot_operations_evidence', 'api_proxy_self_test', 'api_inventory', 'policy_drift_exceptions', 'integration_rollout', 'scanner_exposure_review', 'launch_support_readiness', 'monitoring_evidence', 'release_evidence', 'pilot_tester_readiness', 'contract_entitlements', 'paid_onboarding', 'security_review_packet', 'vaultproof_enterprise_security_review_packet', 'vaultproof_enterprise_api_inventory', 'vaultproof_enterprise_policy_drift', 'vaultproof_enterprise_integration_rollout', 'vaultproof_enterprise_scanner_exposure_review', 'vaultproof_enterprise_key_exposure_response', 'vaultproof_enterprise_release_evidence', 'vaultproof_enterprise_paid_pilot_tester_readiness', 'vaultproof_enterprise_entitlements', 'vaultproof_enterprise_paid_onboarding', 'execute_endpoint_pattern', 'paid_onboarding_actions', 'rollback_paths', 'monitoring_review', 'budget_alert', 'live_gate', 'oauth_redirect_qa_command', 'Email API key protection', 'Evidence packet JSON', 'copy JSON', 'download JSON', 'vaultproof_enterprise_evidence_packet', 'email_provider_slots', '/app/inventory', '/app/policy', '/app/rollout', '/app/scanner', '/app/release', '/app/testers', '/app/entitlements', '/app/control', '/app/alerts', '/app/security-review', '/api/v1/enterprise/audit?format=csv&days=30', '/api/v1/enterprise/members/access-review?format=csv'],
    },
    {
      path: '/app/technical-guide',
      title: 'Technical guide - VaultProof Enterprise',
      required: ['Architecture at a glance', 'Identity and authorization model', 'Gateway and network patterns', 'Provider key custody and Cloud KMS', 'Caller lock and execution policy', 'Evidence, logs, exports, and audit', 'Troubleshooting map', 'Integration questions for technical review'],
    },
    {
      path: '/app/security-review',
      title: 'Security review packet - VaultProof Enterprise',
      required: ['Review readiness', 'Control coverage', 'Evidence map', 'Open review items', 'securityReviewOpenFilterForm', 'securityReviewOpenSearch', 'securityReviewOpenType', 'clearSecurityReviewFilters', 'filteredSecurityReviewOpenItems', 'securityReviewOpenItemMatches', 'Copyable security review packet', 'copy review brief', 'copySecurityReviewBriefBtn', 'securityReviewFocusBriefText', 'VaultProof Enterprise security review brief', 'vaultproof_enterprise_security_review_packet', 'Architecture summary', 'Control coverage', 'Evidence links', 'Common answers', 'Secrets excluded', 'Identity and RBAC', 'Caller-lock policy', 'Provider key custody', 'Policy drift and exceptions', 'Integration rollout', 'Secret exposure review', 'Key exposure response', 'Release evidence', 'Paid-pilot tester readiness', 'Contract entitlements', 'Paid customer onboarding', 'Runtime attestation', 'Monitoring and edge protection', 'Security review packet status', 'scanner_exposure_review', 'key_exposure_response', 'release_evidence', 'pilot_tester_readiness', 'contract_entitlements', 'paid_onboarding', 'copy packet', '/app/evidence', '/app/audit', '/app/alerts', '/app/policy', '/app/rollout', '/app/scanner', '/app/release', '/app/testers', '/app/entitlements', '/app/runbooks'],
    },
    {
      path: '/app/release',
      title: 'Release evidence - VaultProof Enterprise',
      required: ['Release intake', 'Release posture', 'Release records', 'Release workflow', 'Release evidence JSON', 'vaultproof_release_evidence', 'data-release-field', 'build/image tag', 'verification status', 'rollout status', 'rollback path', 'copy release JSON', 'vaultproof_enterprise_release_evidence', 'operator_commands', 'secrets_excluded', '/app/runbooks', '/app/rollout', '/app/evidence', '/app/security-review'],
    },
    {
      path: '/app/testers',
      title: 'Pilot testers - VaultProof Enterprise',
      required: ['Tester intake', 'Tester readiness', 'Guided session plan', 'testerSessionForm', 'data-tester-session-field', 'testerSessionList', 'testerSessionBrief', 'copy session brief', 'copyTesterSessionBriefBtn', 'testerSessionBriefText', 'VaultProof paid-pilot guided tester session brief', 'guided_session', 'guided_session_ready', 'session_window', 'success_criteria', 'customer_action', 'Tester roster', 'Scenario workflow', 'Tester readiness JSON', 'vaultproof_pilot_testers', 'vaultproof_pilot_tester_session', 'data-tester-field', 'tester name/email', 'login and SSO', 'API proxy self-test', 'provider slot review', 'copy tester JSON', 'vaultproof_enterprise_paid_pilot_tester_readiness', 'ready_for_guided_testing', '/app/members', '/app/org', '/app/evidence', '/app/keys', '/app/security-review'],
    },
    {
      path: '/app/settings',
      title: 'Settings - VaultProof Enterprise',
      required: ['/api/v1/enterprise/projects/bootstrap', '/api/v1/enterprise/orgs/current', '/readiness', 'Security notices'],
    },
    {
      path: '/app/plans',
      title: 'Plans - VaultProof Enterprise',
      required: [
        '/api/v1/enterprise/projects/bootstrap',
        'Commercial package',
        'Enterprise paid pilot starts at $5,000/month',
        'Capacity envelope',
        'Contract guardrails',
        'Plan limits',
        'Security boundaries',
        'provider/email key slot controls',
        'Buyer review path',
        '/app/entitlements',
        '/app/security-review',
        '/app/testers',
        '/app/evidence',
      ],
    },
    {
      path: '/app/entitlements',
      title: 'Entitlements - VaultProof Enterprise',
      required: ['Contract intake', 'Paid-user readiness', 'Capacity envelope', 'Commercial handoff', 'entitlementsBillingForm', 'entitlementsBillingList', 'entitlementsBillingRows', 'billing_handoff', 'commercial_ready', 'commercial_review', 'invoice status', 'PO status', 'procurement owner', 'payment terms', 'billing-safe note', 'Amendment and renewal log', 'entitlementAmendmentForm', 'entitlementsRenewalList', 'entitlementAmendmentList', 'amendment_history', 'renewal_summary', 'missing_review_date', 'review_due', 'review_soon', 'amendment_blocked', 'add amendment', 'removeEntitlementAmendment', 'Usage guardrails', 'entitlementsUsageMeterList', 'entitlementsUsageGuardrailList', 'capacity_status', 'remaining_calls', 'expansion_recommendation', 'hard_limit_enforcement', 'copy capacity brief', 'copyEntitlementsCapacityBriefBtn', 'entitlementsCapacityBriefText', 'VaultProof entitlement capacity brief', 'Contract guardrails', 'Handoff path', 'Paid onboarding evidence', 'Launch readiness evidence', 'Support evidence', 'Entitlements JSON', 'vaultproof_enterprise_entitlements', 'data-entitlement-field', 'contract status', 'monthly calls', 'provider slots', 'billing owner', 'success owner', 'support tier', 'incident response', 'renewal/review date', 'copy entitlements JSON', 'ready_for_paid_pilot', 'contract_review', 'Manual contract-controlled', '/app/evidence', '/app/plans', '/app/security-review'],
    },
    {
      path: '/app/scanner',
      title: 'Scanner - VaultProof Enterprise',
      required: ['Secret exposure intake', 'Scanner posture', 'Exposure findings', 'Remediation workflow', 'Scanner evidence JSON', 'vaultproof_scanner_findings', 'data-scanner-field', 'redacted scanner evidence', 'copy scanner JSON', 'vaultproof_enterprise_scanner_exposure_review', 'manual_scanner_evidence_required', '/app/keys', '/app/policy', '/app/rollout', '/app/evidence'],
    },
    {
      path: '/app/verifier',
      title: 'AI Proof Verifier - VaultProof Enterprise',
      required: ['Model registry', 'Register external model', 'Submit proof bundle', 'Shared pilot attestation', 'Shared enterprise runtime attestation', 'verify evidence only', '/api/v1/enterprise/verifier', 'VaultProof does not run it'],
    },
    {
      path: '/app/runbooks',
      title: 'Runbooks - VaultProof Enterprise',
      required: ['Hardening status', 'Production verifier', 'Evidence bundle', 'Security review packet', 'Tester readiness review', 'Monitoring evidence review', 'Customer launch gate', 'RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch', 'Handoff package', 'npm run package:enterprise-handoff', 'Handoff gate', 'npm run gate:enterprise-handoff', 'Finish gate', 'blocker/warning details', 'npm run gate:enterprise-finish', 'Key exposure response runbook', 'runbooksExposureMeta', 'Current exposure response status', 'Open Provider Slots incident mode', 'incident JSON', 'Export audit CSV', 'Proof boundary', 'Operator order', 'mTLS caller-lock preparation', 'npm run prepare:enterprise-mtls', 'Gateway JWT validation preparation', 'discover the Supabase issuer', 'gateway policy template smoke', 'caller-lock header delete/override', 'npm run test:enterprise-apim-policies', 'Origin TLS certificate plan', 'Origin TLS preparation plan', 'Origin DNS guardrail', 'Origin DNS record', 'DNS record updates', 'Origin TLS preflight', 'TLS origin cutover', 'gateway cutover', 'GCP runtime reset rollback', 'old prototype cleanup'],
    },
  ];
  for (const page of supportPages) {
    const response = await handleEnterpriseControlPlaneRequest(
      buildRequest(page.path),
      {
        enterpriseHostname: ENTERPRISE_HOSTNAME,
      },
    );
    const html = await response.text();
    if (response.status !== 200 || !html.includes(page.title)) {
      throw new Error(`Expected enterprise support page for ${page.path}, got ${response.status}`);
    }
    for (const required of page.required) {
      if (!html.includes(required)) {
        throw new Error(`Expected ${page.path} to include ${required}`);
      }
    }
    if (html.includes('https://init.vaultproof.dev') || html.includes('https://api.vaultproof.dev') || html.includes('/api/scanner')) {
      throw new Error(`Enterprise support page ${page.path} must not load B2C APIs`);
    }
    if (page.path === '/app/testers') {
      assertPilotTesterLocalStorage(html);
    }
    assertDashboardShellTheme(page.path, html);
  }

  for (const internalPagePath of ['/app/launch', '/app/demo', '/app/onboarding', '/app/support', '/app/pilot', '/app/pilot-success']) {
    const enterpriseInternalPageResponse = await handleEnterpriseControlPlaneRequest(
      buildRequest(internalPagePath),
      {
        enterpriseHostname: ENTERPRISE_HOSTNAME,
      },
    );
    const enterpriseInternalPageBody = await enterpriseInternalPageResponse.text();
    if (enterpriseInternalPageResponse.status !== 404 || !enterpriseInternalPageBody.includes('internal admin host')) {
      throw new Error(`Expected enterprise ${internalPagePath} to be removed from customer host, got ${enterpriseInternalPageResponse.status}`);
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
  if (!controlHtml.includes('control-dashboard-theme')) {
    throw new Error('Expected control page to include the dashboard-matched control theme');
  }
  if (
    !controlHtml.includes('enterprise-static-canonical-org-url')
    || !controlHtml.includes('.page > .topbar { display: none !important; }')
    || controlHtml.includes('/app/org?org=')
  ) {
    throw new Error('Expected control page to use canonical app URLs and hide the legacy static topbar');
  }
  if (controlHtml.includes('/css/site-theme.css')) {
    throw new Error('Control page must not load public site-theme.css over the enterprise dashboard theme');
  }
  for (const legacySidebarToken of ['sidebar-group', 'sidebar-head', 'sidebar-item', 'sidebar-dot', 'usage-box']) {
    if (controlHtml.includes(legacySidebarToken)) {
      throw new Error(`Control page must not include legacy sidebar artifact ${legacySidebarToken}`);
    }
  }
  assertDashboardShellTheme('/app/control', controlHtml);

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
  if (!orgHtml.includes('org-dashboard-theme')) {
    throw new Error('Expected org page to include the dashboard-matched org theme');
  }
  if (
    !orgHtml.includes('enterprise-static-canonical-org-url')
    || !orgHtml.includes('.page > .topbar { display: none !important; }')
    || orgHtml.includes('/app/control?org=')
  ) {
    throw new Error('Expected org page to use canonical app URLs and hide the legacy static topbar');
  }
  if (orgHtml.includes('/css/site-theme.css')) {
    throw new Error('Org page must not load public site-theme.css over the enterprise dashboard theme');
  }
  for (const legacySidebarToken of ['sidebar-group', 'sidebar-head', 'sidebar-item', 'sidebar-dot', 'usage-box']) {
    if (orgHtml.includes(legacySidebarToken)) {
      throw new Error(`Org page must not include legacy sidebar artifact ${legacySidebarToken}`);
    }
  }
  assertDashboardShellTheme('/app/org', orgHtml);
}

function assertSecurityHeaders(path, response, html = '') {
  const csp = response.headers.get('content-security-policy') || '';
  if (!csp.includes("default-src 'self'") || !csp.includes("frame-ancestors 'none'")) {
    throw new Error(`Expected strict HTML CSP for ${path}, got ${csp}`);
  }
  if (!/script-src[^;]+nonce-/.test(csp)) {
    throw new Error(`Expected nonce-based script CSP for ${path}, got ${csp}`);
  }
  if (response.headers.get('x-frame-options') !== 'DENY') {
    throw new Error(`Expected X-Frame-Options DENY for ${path}`);
  }
  if (response.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error(`Expected X-Content-Type-Options nosniff for ${path}`);
  }
  if (!response.headers.get('strict-transport-security')?.includes('max-age=31536000')) {
    throw new Error(`Expected HSTS for ${path}`);
  }
  if (!response.headers.get('permissions-policy')?.includes('camera=()')) {
    throw new Error(`Expected Permissions-Policy for ${path}`);
  }
  if (html.includes('<script') && !/<script nonce="[^"]+"/.test(html)) {
    throw new Error(`Expected inline/external scripts to carry a CSP nonce for ${path}`);
  }
}

async function assertEnterpriseSecurityHeaders() {
  const htmlPaths = ['/', '/app/login', '/app/logout', '/app/dashboard', '/app/evidence', '/app/control', '/app/verifier', '/app/org', '/app/setup', '/app/technical-guide', '/app/security-review', '/app/entitlements', '/app/testers', '/app/release', '/app/scanner', '/app/runbooks', '/app/inventory', '/app/policy', '/app/rollout'];
  for (const path of htmlPaths) {
    const response = await handleEnterpriseControlPlaneRequest(
      buildRequest(path),
      { enterpriseHostname: ENTERPRISE_HOSTNAME },
    );
    const html = await response.text();
    if (response.status !== 200) {
      throw new Error(`Expected security header page ${path} to render, got ${response.status}`);
    }
    assertSecurityHeaders(path, response, html);
  }

  const scriptResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/enterprise-login.js'),
    { enterpriseHostname: ENTERPRISE_HOSTNAME },
  );
  const scriptCsp = scriptResponse.headers.get('content-security-policy') || '';
  if (!scriptCsp.includes("default-src 'none'") || !scriptCsp.includes("frame-ancestors 'none'")) {
    throw new Error(`Expected non-HTML CSP for login script, got ${scriptCsp}`);
  }
  if (scriptResponse.headers.get('x-content-type-options') !== 'nosniff') {
    throw new Error('Expected login script to include nosniff security header');
  }
}

function extractHrefValues(html) {
  const hrefs = [];
  const pattern = /\shref\s*=\s*["']([^"']+)["']/gi;
  let match = pattern.exec(html);
  while (match) {
    hrefs.push(match[1]);
    match = pattern.exec(html);
  }
  return hrefs;
}

async function assertEnterpriseAppLinkCrawl() {
  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
  };
  const startPaths = [
    '/app/login',
    '/app',
    '/app/dashboard',
    '/app/control',
    '/app/org',
    '/app/members',
    '/app/audit',
    '/app/alerts',
    '/app/activity',
    '/app/projects',
    '/app/inventory',
    '/app/policy',
    '/app/rollout',
    '/app/keys',
    '/app/verifier',
    '/app/evidence',
    '/app/docs',
    '/app/setup',
    '/app/technical-guide',
    '/app/security-review',
    '/app/entitlements',
    '/app/testers',
    '/app/release',
    '/app/settings',
    '/app/plans',
    '/app/scanner',
    '/app/runbooks',
    '/app/logout',
  ];
  const checkedPaths = new Set();
  const queue = [...startPaths];

  while (queue.length) {
    const path = queue.shift();
    if (!path || checkedPaths.has(path)) continue;
    checkedPaths.add(path);

    const response = await handleEnterpriseControlPlaneRequest(buildRequest(path), env);
    const html = await response.text();
    if (response.status !== 200) {
      throw new Error(`Expected enterprise app link ${path} to resolve, got ${response.status}`);
    }
    if (html.includes('"error":"Not found"') || html.includes('service":"vaultproof-enterprise-control-plane"')) {
      throw new Error(`Enterprise app link ${path} rendered a Not found payload`);
    }
    if (html.includes('https://init.vaultproof.dev') || html.includes('https://api.vaultproof.dev')) {
      throw new Error(`Enterprise app link ${path} references B2C API origins`);
    }
    if (html.includes('cdn.mxpnl.com') || html.includes('Enterprise Page Viewed')) {
      throw new Error(`Enterprise app link ${path} must not load Mixpanel unless ENTERPRISE_MIXPANEL_TOKEN is configured`);
    }

    for (const href of extractHrefValues(html)) {
      if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('javascript:')) continue;
      const resolved = new URL(href, `https://${ENTERPRISE_HOSTNAME}${path}`);
      if (resolved.hostname !== ENTERPRISE_HOSTNAME) continue;
      if (resolved.pathname === '/app/enterprise-login.js') continue;
      if (!resolved.pathname.startsWith('/app')) continue;
      const normalized = resolved.pathname.replace(/\.html$/, '').replace(/\/+$/, '') || '/app';
      if (!checkedPaths.has(normalized)) queue.push(normalized);
    }
  }

  for (const expectedPath of startPaths) {
    const normalized = expectedPath.replace(/\/+$/, '') || '/app';
    if (!checkedPaths.has(normalized)) {
      throw new Error(`Expected enterprise app link crawler to cover ${expectedPath}`);
    }
  }
}

async function assertEnterpriseMixpanelAnalytics() {
  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    mixpanelToken: 'mixpanel-enterprise-smoke-token',
  };

  const pageChecks = [
    ['/', 'homepage'],
    ['/app', 'dashboard'],
    ['/app/login', 'login'],
    ['/app/dashboard', 'dashboard'],
    ['/app/activity', 'activity'],
    ['/app/alerts', 'alerts'],
    ['/app/control', 'control'],
    ['/app/org', 'org'],
    ['/app/projects', 'projects'],
    ['/app/inventory', 'inventory'],
    ['/app/policy', 'policy'],
    ['/app/rollout', 'rollout'],
    ['/app/keys', 'keys'],
    ['/app/verifier', 'verifier'],
    ['/app/evidence', 'evidence'],
    ['/app/docs', 'docs'],
    ['/app/setup', 'setup'],
    ['/app/technical-guide', 'technical-guide'],
    ['/app/security-review', 'security-review'],
    ['/app/settings', 'settings'],
    ['/app/plans', 'plans'],
    ['/app/entitlements', 'entitlements'],
    ['/app/testers', 'testers'],
    ['/app/release', 'release'],
    ['/app/members', 'members'],
    ['/app/scanner', 'scanner'],
    ['/app/runbooks', 'runbooks'],
    ['/app/audit', 'audit'],
    ['/app/logout', 'logout'],
  ];

  for (const [path, pageName] of pageChecks) {
    const response = await handleEnterpriseControlPlaneRequest(buildRequest(path), env);
    const html = await response.text();
    if (response.status !== 200) {
      throw new Error(`Expected enterprise analytics page ${path} to render, got ${response.status}`);
    }
    if (!html.includes('cdn.mxpnl.com/libs/mixpanel-2-latest.min.js')) {
      throw new Error(`Expected ${path} to load Mixpanel library when configured`);
    }
    if (!html.includes('mixpanel-enterprise-smoke-token')) {
      throw new Error(`Expected ${path} to include configured Mixpanel token`);
    }
    if (!html.includes('Enterprise Page Viewed') || !html.includes(`var pageName = "${pageName}";`)) {
      throw new Error(`Expected ${path} to track enterprise page view for ${pageName}`);
    }
    if (!html.includes('"record_sessions_percent":0') || !html.includes('"autocapture":false')) {
      throw new Error(`Expected ${path} to keep enterprise autocapture/session recording disabled by default`);
    }
    if (html.includes('access_token') || html.includes('refresh_token') || html.includes('provider_token')) {
      throw new Error(`Enterprise analytics snippet for ${path} must not reference URL token fragments`);
    }
  }

  const recordingResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/app/dashboard'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      mixpanelToken: 'mixpanel-enterprise-smoke-token',
      mixpanelAutocapture: true,
      mixpanelRecordSessionsPercent: 5,
    },
  );
  const recordingHtml = await recordingResponse.text();
  if (!recordingHtml.includes('"record_sessions_percent":5') || !recordingHtml.includes('"autocapture":true')) {
    throw new Error('Expected explicit enterprise Mixpanel recording/autocapture env flags to be reflected');
  }

  installSupabaseStub();
  stubAuthUserEmail = 'owner@vaultproof.dev';
  const adminEnv = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    internalAdminHostname: INTERNAL_ADMIN_HOSTNAME,
    internalAdminAllowedEmails: 'owner@vaultproof.dev',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
    mixpanelToken: 'mixpanel-enterprise-smoke-token',
  };
  const adminLoginResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/app/login'),
    adminEnv,
  );
  const adminLoginHtml = await adminLoginResponse.text();
  if (adminLoginResponse.status !== 200
    || !adminLoginHtml.includes('Enterprise Page Viewed')
    || !adminLoginHtml.includes('var pageName = "internal-admin-login";')) {
    throw new Error(`Expected internal admin login page to include Mixpanel analytics, got ${adminLoginResponse.status}`);
  }

  const adminSessionResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/session', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    adminEnv,
  );
  const adminSessionCookie = adminSessionResponse.headers.get('set-cookie') || '';
  if (adminSessionResponse.status !== 200 || !adminSessionCookie.includes('vp_internal_admin_session=')) {
    throw new Error(`Expected internal admin session for Mixpanel coverage checks, got ${adminSessionResponse.status}`);
  }

  for (const [path, pageName] of [
    ['/', 'internal-admin'],
    ['/orgs/org_123', 'internal-admin'],
    ['/app/launch', 'launch'],
    ['/app/demo', 'demo'],
    ['/app/onboarding', 'onboarding'],
    ['/app/support', 'support'],
    ['/app/pilot', 'pilot'],
    ['/app/pilot-success', 'pilot-success'],
  ]) {
    const response = await handleEnterpriseControlPlaneRequest(
      buildHostRequest(INTERNAL_ADMIN_HOSTNAME, path, {
        headers: {
          cookie: adminSessionCookie.split(';')[0],
        },
      }),
      adminEnv,
    );
    const html = await response.text();
    if (response.status !== 200
      || !html.includes('cdn.mxpnl.com/libs/mixpanel-2-latest.min.js')
      || !html.includes('mixpanel-enterprise-smoke-token')
      || !html.includes('Enterprise Page Viewed')
      || !html.includes(`var pageName = "${pageName}";`)) {
      throw new Error(`Expected internal admin analytics page ${path} to track ${pageName}, got ${response.status}`);
    }
  }
}

async function assertInternalAdminConsole() {
  installSupabaseStub();

  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    internalAdminHostname: INTERNAL_ADMIN_HOSTNAME,
    internalAdminAllowedEmails: 'owner@vaultproof.dev',
    supabaseUrl: 'https://supabase.example.co',
    supabaseServiceRoleKey: 'service-role-key',
  };
  stubAuthUserEmail = 'owner@vaultproof.dev';

  const unauthenticatedPageResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/'),
    env,
  );
  if (unauthenticatedPageResponse.status !== 302
    || unauthenticatedPageResponse.headers.get('location') !== '/app/login') {
    throw new Error(`Expected internal admin page to redirect to login, got ${unauthenticatedPageResponse.status}`);
  }

  const unauthenticatedLaunchResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/app/launch'),
    env,
  );
  if (unauthenticatedLaunchResponse.status !== 302
    || unauthenticatedLaunchResponse.headers.get('location') !== '/app/login') {
    throw new Error(`Expected internal admin launch board to redirect to login, got ${unauthenticatedLaunchResponse.status}`);
  }
  for (const internalPagePath of ['/app/demo', '/app/onboarding', '/app/support', '/app/pilot', '/app/pilot-success']) {
    const unauthenticatedInternalPageResponse = await handleEnterpriseControlPlaneRequest(
      buildHostRequest(INTERNAL_ADMIN_HOSTNAME, internalPagePath),
      env,
    );
    if (unauthenticatedInternalPageResponse.status !== 302
      || unauthenticatedInternalPageResponse.headers.get('location') !== '/app/login') {
      throw new Error(`Expected internal admin ${internalPagePath} to redirect to login, got ${unauthenticatedInternalPageResponse.status}`);
    }
  }

  const adminLoginResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/app/login'),
    env,
  );
  const adminLoginHtml = await adminLoginResponse.text();
  if (adminLoginResponse.status !== 200
    || !adminLoginHtml.includes('<title>Login</title>')
    || !adminLoginHtml.includes('id="loginWithGoogleBtn"')
    || !adminLoginHtml.includes('Continue with Google')
    || !adminLoginHtml.includes('id="loginForm"')) {
    throw new Error(`Expected minimal internal admin login page, got ${adminLoginResponse.status}`);
  }
  for (const forbidden of [
    'Manage enterprise customers',
    'employee admin console',
    'Enterprise account administration',
    'per-business login links',
    'VaultProof Admin',
  ]) {
    if (adminLoginHtml.includes(forbidden)) {
      throw new Error(`Internal admin login page should not expose ${forbidden}`);
    }
  }

  const spoofedAdminHostResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(ENTERPRISE_HOSTNAME, '/', {
      headers: {
        'x-forwarded-host': INTERNAL_ADMIN_HOSTNAME,
      },
    }),
    env,
  );
  if (spoofedAdminHostResponse.headers.get('location') === '/app/login') {
    throw new Error('Enterprise host must not route to internal admin via spoofed x-forwarded-host');
  }

  const sessionResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/session', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const sessionCookie = sessionResponse.headers.get('set-cookie') || '';
  if (sessionResponse.status !== 200 || !sessionCookie.includes('vp_internal_admin_session=')) {
    throw new Error(`Expected internal admin session cookie, got ${sessionResponse.status}: ${sessionCookie}`);
  }

  const pageResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/', {
      headers: {
        cookie: sessionCookie.split(';')[0],
      },
    }),
    env,
  );
  const pageHtml = await pageResponse.text();
  if (pageResponse.status !== 200 || !pageHtml.includes('VaultProof Internal Admin')) {
    throw new Error(`Expected internal admin page to render, got ${pageResponse.status}`);
  }
  const headPageResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/', {
      method: 'HEAD',
      headers: {
        cookie: sessionCookie.split(';')[0],
      },
    }),
    env,
  );
  if (headPageResponse.status !== 200) {
    throw new Error(`Expected internal admin HEAD check to return 200, got ${headPageResponse.status}`);
  }
  for (const required of [
    'Enterprise customer operations',
    'Control Center',
    'Enterprise business command view',
    'businessUserChart',
    'businessCallChart',
    'apiTrendChart',
    'accountMixDonut',
    'blockerChart',
    'sparkline-chart',
    'API call trend',
    'API calls by business',
    'controlTotalCalls',
    '--sidebar-muted',
    '--primary-bg:#315f95',
    '--sidebar-bg:#18201f',
    '--bg:#f5f7fb',
    'Create business',
    'Businesses',
    'Users and access',
    'SSO rollout',
    'Enterprise account administration',
    'SSO settings',
    'Invite enterprise user',
    'business_login_links',
    'Internal admin audit',
    'approval gate',
    'Launch board',
    'Buyer walkthrough',
    'Paid onboarding',
    'Support room',
    'Pilot proposal',
    'Pilot success',
    '/app/launch',
    '/app/demo',
    '/app/onboarding',
    '/app/support',
    '/app/pilot',
    '/app/pilot-success',
    '/api/v1/internal-admin/overview',
  ]) {
    if (!pageHtml.includes(required)) {
      throw new Error(`Expected internal admin page to include ${required}`);
    }
  }
  if (pageHtml.includes('internal_admin=true') || pageHtml.includes('next=%2F')) {
    throw new Error('Internal admin page must not expose admin mode or next-route query parameters in login links');
  }
  for (const forbidden of [
    'Safe first slice',
    'Read visibility is live',
    'VaultProof employees only',
    'Manage enterprise customers.',
    'employee sign in',
    'Employee sign in',
  ]) {
    if (pageHtml.includes(forbidden)) {
      throw new Error(`Internal admin page should not include removed copy: ${forbidden}`);
    }
  }
  if (pageHtml.includes('https://api.vaultproof.dev') || pageHtml.includes('https://init.vaultproof.dev')) {
    throw new Error('Internal admin page must not use B2C API origins');
  }

  const adminLaunchResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/app/launch', {
      headers: {
        cookie: sessionCookie.split(';')[0],
      },
    }),
    env,
  );
  const adminLaunchHtml = await adminLaunchResponse.text();
  if (adminLaunchResponse.status !== 200 || !adminLaunchHtml.includes('Launch checklist - VaultProof Enterprise')) {
    throw new Error(`Expected internal admin launch board to render, got ${adminLaunchResponse.status}`);
  }
  for (const required of [
    'Go/No-Go Readiness',
    'Cloud Armor verification passed',
    'Strict login QA run',
    'Key rotation status',
    'Rollback owner/path confirmed',
    'go/hold decision copy',
    'vaultproof_go_no_go_evidence',
    'data-go-no-go-check',
    'data-go-no-go-status',
    'data-go-no-go-note',
    'vaultproof_launch_checklist',
  ]) {
    if (!adminLaunchHtml.includes(required)) {
      throw new Error(`Expected internal admin launch board to include ${required}`);
    }
  }
  assertLaunchGoNoGoLocalStorage(adminLaunchHtml);

  for (const internalPage of [
    {
      path: '/app/demo',
      title: 'Buyer walkthrough - VaultProof Enterprise',
      required: ['Walkthrough objective', 'Copyable walkthrough talk track', 'Launch support kit', 'Paid onboarding', 'copy script'],
    },
    {
      path: '/app/onboarding',
      title: 'Paid onboarding - VaultProof Enterprise',
      required: ['Customer activation', 'Role task checklist', 'onboardingTaskMeta', 'onboardingTaskList', 'copy task brief', 'copyOnboardingTaskBriefBtn', 'paidOnboardingTaskBriefText', 'VaultProof paid onboarding task brief', 'task-security-review', 'task-platform-owner', 'task-app-owner', 'task-billing-owner', 'task-support-owner', 'role_task_checklist', 'role_task_summary', 'Onboarding JSON', 'vaultproof_enterprise_paid_onboarding', 'copy onboarding JSON'],
      localStorageRequired: [
        "return 'vaultproof_paid_onboarding:' + (currentOrgId || 'default');",
        'localStorage.setItem(paidOnboardingStorageKey(), JSON.stringify(state));',
        'PAID_ONBOARDING_MANUAL_STALE_MS',
        'PAID_ONBOARDING_ROLE_TASKS',
        'isStalePaidOnboardingEvidence',
        'paidOnboardingRoleTaskRows',
        'role_task_checklist',
        'role_task_summary',
        "status: target.checked ? 'passed' : 'missing'",
        "target.hasAttribute('data-onboarding-status')",
        "target.hasAttribute('data-onboarding-owner')",
        "target.hasAttribute('data-onboarding-due')",
        "target.hasAttribute('data-onboarding-note')",
      ],
    },
    {
      path: '/app/support',
      title: 'Launch support room - VaultProof Enterprise',
      required: ['Support readiness', 'Guided pilot guide', 'Nelson + Max', 'Buyer qualification', 'Customer setup sequence', 'supportGuidedPilotList', 'supportQualificationList', 'supportSetupSequenceList', 'Are we ready?', 'Guided design partners and paid pilots', 'PMF focus', 'Full repo playbook', 'docs/enterprise/guided-pilot-playbook.md', 'Internal admin boundary', 'Launch-week workflow', 'Exposure response handoff', 'supportExposureList', 'Provider Slots incident JSON', 'Exposure response status', 'Exposure response decision', 'Exposure linked scanner findings', 'launch_support_readiness', 'copy brief'],
    },
    {
      path: '/app/pilot-success',
      title: 'Pilot success tracker - VaultProof Enterprise',
      required: ['Success posture', 'Evidence path', 'Success milestones', 'Expansion decision', 'pilotSuccessDecisionMeta', 'pilotSuccessDecisionList', 'pilotSuccessDecisionForm', 'data-pilot-success-decision-field', 'copy decision brief', 'copyPilotSuccessDecisionBtn', 'pilotSuccessDecisionBriefText', 'VaultProof pilot expansion decision brief', 'expansion_decision', 'Copyable weekly update', 'vaultproof_enterprise_pilot_success_tracker', 'copy update'],
      localStorageRequired: [
        "return 'vaultproof_pilot_success:' + (currentOrgId || 'default');",
        'localStorage.setItem(pilotSuccessStorageKey(), JSON.stringify(state));',
        'expansion_decision',
        'pilotSuccessDecisionForm',
        'data-pilot-success-decision-field',
        'setPilotSuccessDecisionState',
        'copyPilotSuccessDecisionBtn',
        'pilotSuccessDecisionBriefText',
        "target.hasAttribute('data-pilot-success-check')",
        "target.hasAttribute('data-pilot-success-note')",
        "target.hasAttribute('data-pilot-success-decision-field')",
      ],
    },
  ]) {
    const internalPageResponse = await handleEnterpriseControlPlaneRequest(
      buildHostRequest(INTERNAL_ADMIN_HOSTNAME, internalPage.path, {
        headers: {
          cookie: sessionCookie.split(';')[0],
        },
      }),
      env,
    );
    const internalPageHtml = await internalPageResponse.text();
    if (internalPageResponse.status !== 200 || !internalPageHtml.includes(internalPage.title)) {
      throw new Error(`Expected internal admin ${internalPage.path} to render, got ${internalPageResponse.status}`);
    }
    for (const required of internalPage.required) {
      if (!internalPageHtml.includes(required)) {
        throw new Error(`Expected internal admin ${internalPage.path} to include ${required}`);
      }
    }
    for (const required of internalPage.localStorageRequired || []) {
      if (!internalPageHtml.includes(required)) {
        throw new Error(`Expected internal admin ${internalPage.path} local-storage behavior to include ${required}`);
      }
    }
    assertSecurityHeaders(`internal-admin ${internalPage.path}`, internalPageResponse, internalPageHtml);
  }

  const orgDetailPageResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/orgs/org_123', {
      headers: {
        cookie: sessionCookie.split(';')[0],
      },
    }),
    env,
  );
  const orgDetailPageHtml = await orgDetailPageResponse.text();
  if (orgDetailPageResponse.status !== 200) {
    throw new Error(`Expected internal admin org detail page shell to render, got ${orgDetailPageResponse.status}`);
  }
  for (const required of [
    'Business detail',
    'SSO setup checklist',
    'Business login links',
    'data-internal-admin-action="org-account-management"',
    '/sso-settings',
    'save SSO',
    'create invite',
    'User/member timeline',
    'Support notes',
    'Evidence links',
    '/api/v1/internal-admin/orgs/',
  ]) {
    if (!orgDetailPageHtml.includes(required)) {
      throw new Error(`Expected internal admin org detail shell to include ${required}`);
    }
  }

  const unauthenticatedResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/overview'),
    env,
  );
  if (unauthenticatedResponse.status !== 401) {
    throw new Error(`Expected internal admin API to require auth, got ${unauthenticatedResponse.status}`);
  }
  const unauthenticatedHeadResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/overview', { method: 'HEAD' }),
    env,
  );
  if (unauthenticatedHeadResponse.status !== 401) {
    throw new Error(`Expected internal admin API HEAD check to require auth, got ${unauthenticatedHeadResponse.status}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/overview', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    {
      ...env,
      internalAdminAllowedEmails: 'security@vaultproof.dev',
    },
  );
  if (deniedResponse.status !== 403) {
    throw new Error(`Expected internal admin API to reject non-allowlisted employee, got ${deniedResponse.status}`);
  }

  stubAuthUserEmail = 'owner@gmail.com';
  const publicDomainDeniedResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/overview', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    {
      ...env,
      internalAdminAllowedEmails: '',
      internalAdminAllowedDomains: 'gmail.com',
    },
  );
  if (publicDomainDeniedResponse.status !== 403) {
    throw new Error(`Expected internal admin API to ignore public email-domain allowlists, got ${publicDomainDeniedResponse.status}`);
  }
  stubAuthUserEmail = 'owner@vaultproof.dev';

  const overviewResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/overview', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const overview = await overviewResponse.json();
  if (overviewResponse.status !== 200) {
    throw new Error(`Expected internal admin overview, got ${overviewResponse.status}: ${JSON.stringify(overview)}`);
  }
  if (overview.mode !== 'read_only' || overview.admin_actions_enabled !== false) {
    throw new Error('Expected internal admin overview to be read-only by default');
  }
  if (overview.summary?.active_business_count !== 1 || overview.summary?.pending_invitation_count !== 1) {
    throw new Error(`Expected internal admin business summary, got ${JSON.stringify(overview.summary)}`);
  }
  if (overview.summary?.total_api_call_count !== 1 || overview.summary?.api_call_source !== 'rollup_table') {
    throw new Error(`Expected internal admin API call rollup summary, got ${JSON.stringify(overview.summary)}`);
  }
  if (!Array.isArray(overview.api_call_trend) || overview.api_call_trend[0]?.day !== '2026-04-26' || overview.api_call_trend[0]?.call_count !== 1) {
    throw new Error(`Expected internal admin overview to include daily API call trend, got ${JSON.stringify(overview.api_call_trend)}`);
  }
  if (!Array.isArray(overview.businesses) || overview.businesses[0]?.name !== 'Example Org') {
    throw new Error(`Expected internal admin overview to include Example Org, got ${JSON.stringify(overview.businesses)}`);
  }
  if (overview.businesses[0]?.api_call_count !== 1 || overview.businesses[0]?.last_api_call_at !== '2026-04-26T12:01:00.000Z') {
    throw new Error(`Expected internal admin overview to include per-business API call totals, got ${JSON.stringify(overview.businesses[0])}`);
  }
  if (!overview.businesses[0]?.business_login_links?.find((link) => link.href.includes('/app/login?org=org_123'))) {
    throw new Error(`Expected internal admin overview to include per-business login links, got ${JSON.stringify(overview.businesses[0]?.business_login_links)}`);
  }
  if (!Array.isArray(overview.recent_internal_admin_audit)
    || overview.recent_internal_admin_audit[0]?.event_type !== 'internal_admin_overview_viewed') {
    throw new Error(`Expected internal admin overview to include employee audit stream, got ${JSON.stringify(overview.recent_internal_admin_audit)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_overview_viewed')) {
    throw new Error(`Expected internal admin overview request to insert audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  organizationSsoSettingsSchemaReady = false;
  const missingSsoOverviewResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/overview', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const missingSsoOverview = await missingSsoOverviewResponse.json();
  if (missingSsoOverviewResponse.status !== 200
    || missingSsoOverview.sso_schema_ready !== false
    || !String(missingSsoOverview.migration_required || '').includes('organization_sso_settings')) {
    throw new Error(`Expected internal admin overview to tolerate missing SSO schema, got ${missingSsoOverviewResponse.status}: ${JSON.stringify(missingSsoOverview)}`);
  }

  const missingSsoOrgDetailResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const missingSsoOrgDetail = await missingSsoOrgDetailResponse.json();
  if (missingSsoOrgDetailResponse.status !== 200
    || missingSsoOrgDetail.sso_schema_ready !== false
    || !String(missingSsoOrgDetail.migration_required || '').includes('organization_sso_settings')) {
    throw new Error(`Expected internal admin org detail to tolerate missing SSO schema, got ${missingSsoOrgDetailResponse.status}: ${JSON.stringify(missingSsoOrgDetail)}`);
  }
  organizationSsoSettingsSchemaReady = true;

  const orgDetailResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  const orgDetail = await orgDetailResponse.json();
  if (orgDetailResponse.status !== 200) {
    throw new Error(`Expected internal admin org detail API, got ${orgDetailResponse.status}: ${JSON.stringify(orgDetail)}`);
  }
  if (orgDetail.business?.name !== 'Example Org' || orgDetail.business?.member_count !== 1) {
    throw new Error(`Expected org detail business summary, got ${JSON.stringify(orgDetail.business)}`);
  }
  if (!Array.isArray(orgDetail.sso_checklist) || !orgDetail.sso_checklist.find((item) => item.label === 'Choose identity provider')) {
    throw new Error(`Expected org detail SSO checklist, got ${JSON.stringify(orgDetail.sso_checklist)}`);
  }
  if (!Array.isArray(orgDetail.member_timeline) || !orgDetail.member_timeline.find((item) => item.type === 'member')) {
    throw new Error(`Expected org detail member timeline, got ${JSON.stringify(orgDetail.member_timeline)}`);
  }
  if (!orgDetail.support_notes_schema_ready || orgDetail.support_notes?.[0]?.body !== 'Customer asked for Entra SSO rollout help.') {
    throw new Error(`Expected org detail support notes, got ${JSON.stringify(orgDetail.support_notes)}`);
  }
  if (!orgDetail.business_status_schema_ready || orgDetail.business_status_updates?.[0]?.status !== 'onboarding') {
    throw new Error(`Expected org detail business status updates, got ${JSON.stringify(orgDetail.business_status_updates)}`);
  }
  if (!orgDetail.action_requests_schema_ready || orgDetail.action_requests?.[0]?.action_type !== 'disable_org_access') {
    throw new Error(`Expected org detail action request approvals, got ${JSON.stringify(orgDetail.action_requests)}`);
  }
  if (!orgDetail.execution_records_schema_ready || !Array.isArray(orgDetail.execution_records)) {
    throw new Error(`Expected org detail execution record ledger readiness, got ${JSON.stringify(orgDetail.execution_records)}`);
  }
  if (!orgDetail.evidence_links?.find((link) => link.href.includes('/app/audit?organization_id=org_123'))) {
    throw new Error(`Expected org detail evidence links, got ${JSON.stringify(orgDetail.evidence_links)}`);
  }
  if (!orgDetail.business?.business_login_links?.find((link) => link.href.includes('/app/login?org=org_123'))) {
    throw new Error(`Expected org detail business login links, got ${JSON.stringify(orgDetail.business?.business_login_links)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_org_detail_viewed')) {
    throw new Error(`Expected org detail request to insert audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const disabledBusinessCreateResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Pilot Customer',
        owner_email: 'pilot-admin@example.com',
        company_domain: 'pilot.example.com',
      }),
    }),
    env,
  );
  if (disabledBusinessCreateResponse.status !== 403) {
    throw new Error(`Expected internal business create to be disabled by default, got ${disabledBusinessCreateResponse.status}`);
  }

  const businessCreateResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        name: 'Pilot Customer',
        slug: 'pilot-customer',
        owner_email: 'pilot-admin@example.com',
        company_domain: 'pilot.example.com',
        sso_provider: 'okta',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const businessCreatePayload = await businessCreateResponse.json();
  if (businessCreateResponse.status !== 201
    || businessCreatePayload.business?.name !== 'Pilot Customer'
    || businessCreatePayload.owner?.delivery !== 'supabase_invite_email_sent'
    || internalAdminCreatedBusiness?.owner_user_id !== 'user_new_owner'
    || internalAdminOwnerInvite?.email !== 'pilot-admin@example.com') {
    throw new Error(`Expected approved business create, got ${businessCreateResponse.status}: ${JSON.stringify(businessCreatePayload)}`);
  }
  if (!businessCreatePayload.business?.business_login_links?.find((link) => link.href.includes('/app/login?org=org_created_123'))) {
    throw new Error(`Expected created business to include login links, got ${JSON.stringify(businessCreatePayload.business?.business_login_links)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_business_created')) {
    throw new Error(`Expected business create audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }
  if (!auditEvents.some((event) => event.event_type === 'organization_created' && event.metadata?.created_via === 'internal_admin')) {
    throw new Error(`Expected customer org audit event for internal business create, got ${JSON.stringify(auditEvents)}`);
  }

  const disabledSsoResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/sso-settings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company_domain: 'pilot.example.com',
        sso_provider: 'microsoft-entra',
        status: 'configured',
        login_mode: 'sso-first',
      }),
    }),
    env,
  );
  if (disabledSsoResponse.status !== 403) {
    throw new Error(`Expected internal SSO settings update to be disabled by default, got ${disabledSsoResponse.status}`);
  }

  const invalidSsoProviderResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/sso-settings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        company_domain: 'pilot.example.com',
        sso_provider: 'https://idp.example.com/metadata',
        status: 'configured',
        login_mode: 'sso-first',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  if (invalidSsoProviderResponse.status !== 400) {
    throw new Error(`Expected internal SSO settings update to reject URL-like provider values, got ${invalidSsoProviderResponse.status}`);
  }

  const ssoUpdateResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/sso-settings', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        company_domain: 'pilot.example.com',
        sso_provider: 'okta',
        status: 'configured',
        login_mode: 'sso-first',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const ssoUpdatePayload = await ssoUpdateResponse.json();
  if (ssoUpdateResponse.status !== 200
    || ssoUpdatePayload.sso_settings?.company_domain !== 'pilot.example.com'
    || ssoUpdatePayload.sso_settings?.sso_provider !== 'okta'
    || ssoUpdatePayload.sso_settings?.status !== 'configured') {
    throw new Error(`Expected approved internal SSO settings update, got ${ssoUpdateResponse.status}: ${JSON.stringify(ssoUpdatePayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_sso_settings_updated')) {
    throw new Error(`Expected internal SSO settings update audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }
  if (!auditEvents.some((event) => event.event_type === 'organization_sso_settings_updated' && event.metadata?.updated_via === 'internal_admin')) {
    throw new Error(`Expected customer org audit event for internal SSO settings update, got ${JSON.stringify(auditEvents)}`);
  }

  const ssoStartCheckResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/sso-start-check', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        company_domain: 'pilot.example.com',
      }),
    }),
    {
      ...env,
      supabaseUrl: 'https://supabase.example.co',
      supabaseAnonKey: 'anon-key',
    },
  );
  const ssoStartCheckPayload = await ssoStartCheckResponse.json();
  if (ssoStartCheckResponse.status !== 200
    || ssoStartCheckPayload.sso_start_check?.broker_status !== 'ready'
    || ssoStartCheckPayload.sso_start_check?.redirect_host !== 'idp.example.com') {
    throw new Error(`Expected internal SSO start check to verify broker redirect, got ${ssoStartCheckResponse.status}: ${JSON.stringify(ssoStartCheckPayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_sso_start_checked')) {
    throw new Error(`Expected internal SSO start check audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const disabledNoteResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/support-notes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        note_type: 'onboarding',
        body: 'Follow up on SSO rollout.',
      }),
    }),
    env,
  );
  if (disabledNoteResponse.status !== 403) {
    throw new Error(`Expected support-note write to be disabled by default, got ${disabledNoteResponse.status}`);
  }

  const badApprovalResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/support-notes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'wrong-secret',
      },
      body: JSON.stringify({
        note_type: 'onboarding',
        body: 'Follow up on SSO rollout.',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  if (badApprovalResponse.status !== 403) {
    throw new Error(`Expected support-note write to reject bad approval header, got ${badApprovalResponse.status}`);
  }

  const noteResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/support-notes', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        note_type: 'onboarding',
        body: 'Follow up on SSO rollout.',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const notePayload = await noteResponse.json();
  if (noteResponse.status !== 201 || notePayload.note?.body !== 'Follow up on SSO rollout.') {
    throw new Error(`Expected approved support-note write to succeed, got ${noteResponse.status}: ${JSON.stringify(notePayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_support_note_created')) {
    throw new Error(`Expected support-note write to insert audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const disabledInviteResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/invitations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: 'new-admin@example.com',
        role: 'iam_admin',
      }),
    }),
    env,
  );
  if (disabledInviteResponse.status !== 403) {
    throw new Error(`Expected internal invite creation to be disabled by default, got ${disabledInviteResponse.status}`);
  }

  const inviteCreateResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/invitations', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        email: 'new-admin@example.com',
        role: 'iam_admin',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const inviteCreatePayload = await inviteCreateResponse.json();
  if (inviteCreateResponse.status !== 201
    || inviteCreatePayload.invitation?.email !== 'new-admin@example.com'
    || createdMemberInvitation?.role !== 'iam_admin') {
    throw new Error(`Expected approved internal invite creation, got ${inviteCreateResponse.status}: ${JSON.stringify(inviteCreatePayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_invitation_created')) {
    throw new Error(`Expected internal invite creation audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const inviteResendResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/invitations/invite_123/resend', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const inviteResendPayload = await inviteResendResponse.json();
  if (inviteResendResponse.status !== 200
    || inviteResendPayload.resend?.requested !== true
    || inviteResendPayload.resend?.email_delivery !== 'not_sent_by_internal_admin_endpoint') {
    throw new Error(`Expected approved internal invite resend request, got ${inviteResendResponse.status}: ${JSON.stringify(inviteResendPayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_invitation_resend_requested')) {
    throw new Error(`Expected internal invite resend audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const inviteRevokeResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/invitations/invite_123/revoke', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const inviteRevokePayload = await inviteRevokeResponse.json();
  if (inviteRevokeResponse.status !== 200
    || inviteRevokePayload.invitation?.status !== 'revoked'
    || !revokedMemberInvitation) {
    throw new Error(`Expected approved internal invite revoke, got ${inviteRevokeResponse.status}: ${JSON.stringify(inviteRevokePayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_invitation_revoked')) {
    throw new Error(`Expected internal invite revoke audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const statusUpdateResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/status', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        status: 'active',
        plan_label: 'Enterprise Production',
        summary: 'Production path is live and customer is ready for monitored rollout.',
        next_step: 'Schedule first access review.',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const statusUpdatePayload = await statusUpdateResponse.json();
  if (statusUpdateResponse.status !== 201
    || statusUpdatePayload.status_update?.status !== 'active'
    || statusUpdatePayload.status_update?.plan_label !== 'Enterprise Production') {
    throw new Error(`Expected approved business status update, got ${statusUpdateResponse.status}: ${JSON.stringify(statusUpdatePayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_business_status_updated')) {
    throw new Error(`Expected business status update audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const disabledActionRequestResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/action-requests', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        action_type: 'disable_org_access',
        reason: 'Customer requested temporary disable during incident response.',
      }),
    }),
    env,
  );
  if (disabledActionRequestResponse.status !== 403) {
    throw new Error(`Expected destructive action request creation to be disabled by default, got ${disabledActionRequestResponse.status}`);
  }

  const missingBreakGlassResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/action-requests', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        action_type: 'disable_org_access',
        reason: 'Customer requested temporary disable during incident response.',
        requested_payload: {
          requested_duration: '24h',
        },
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  if (missingBreakGlassResponse.status !== 400) {
    throw new Error(`Expected destructive action request to require break-glass evidence, got ${missingBreakGlassResponse.status}`);
  }

  const actionRequestResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/orgs/org_123/action-requests', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        action_type: 'disable_org_access',
        reason: 'Customer requested temporary disable during incident response.',
        requested_payload: {
          requested_duration: '24h',
          customer_authorization_ref: 'ticket-CUST-456',
          rollback_owner_email: 'ops@vaultproof.dev',
          rollback_plan_summary: 'Restore the previous organization archive fields from the captured rollback payload.',
          break_glass_reason: 'Customer confirmed emergency access pause during incident response.',
        },
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const actionRequestPayload = await actionRequestResponse.json();
  if (actionRequestResponse.status !== 201
    || actionRequestPayload.action_request?.action_type !== 'disable_org_access'
    || actionRequestPayload.action_request?.requested_payload?.rollback_owner_email !== 'ops@vaultproof.dev'
    || actionRequestPayload.execution_enabled !== false) {
    throw new Error(`Expected approved destructive action request creation, got ${actionRequestResponse.status}: ${JSON.stringify(actionRequestPayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_action_request_created')) {
    throw new Error(`Expected destructive action request audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const sameUserApproveResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, `/api/v1/internal-admin/action-requests/${actionRequestPayload.action_request.id}/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        decision_note: 'Approving my own request should not be allowed.',
      }),
    }),
    {
      ...env,
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  if (sameUserApproveResponse.status !== 409) {
    throw new Error(`Expected same employee action approval to be rejected, got ${sameUserApproveResponse.status}`);
  }

  stubAuthUserId = 'user_789';
  stubAuthUserEmail = 'ops@vaultproof.dev';
  const approveResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, `/api/v1/internal-admin/action-requests/${actionRequestPayload.action_request.id}/approve`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        decision_note: 'Second employee approved after customer confirmation.',
      }),
    }),
    {
      ...env,
      internalAdminAllowedEmails: 'owner@vaultproof.dev,ops@vaultproof.dev',
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const approvePayload = await approveResponse.json();
  if (approveResponse.status !== 200
    || approvePayload.action_request?.status !== 'approved'
    || approvePayload.execution_enabled !== false) {
    throw new Error(`Expected second employee action approval, got ${approveResponse.status}: ${JSON.stringify(approvePayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_action_request_approved')) {
    throw new Error(`Expected destructive action approval audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const rejectResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, '/api/v1/internal-admin/action-requests/action_request_123/reject', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
      body: JSON.stringify({
        decision_note: 'Rejected because customer asked to wait.',
      }),
    }),
    {
      ...env,
      internalAdminAllowedEmails: 'owner@vaultproof.dev,ops@vaultproof.dev',
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const rejectPayload = await rejectResponse.json();
  if (rejectResponse.status !== 200 || rejectPayload.action_request?.status !== 'rejected') {
    throw new Error(`Expected second employee action rejection, got ${rejectResponse.status}: ${JSON.stringify(rejectPayload)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_action_request_rejected')) {
    throw new Error(`Expected destructive action rejection audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const executePlanResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, `/api/v1/internal-admin/action-requests/${actionRequestPayload.action_request.id}/execute-plan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
    }),
    {
      ...env,
      internalAdminAllowedEmails: 'owner@vaultproof.dev,ops@vaultproof.dev',
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const executePlanPayload = await executePlanResponse.json();
  if (executePlanResponse.status !== 201
    || executePlanPayload.execution_enabled !== false
    || executePlanPayload.execution_record?.execution_mode !== 'dry_run'
    || executePlanPayload.execution_record?.status !== 'planned'
    || executePlanPayload.preflight_result?.break_glass_evidence?.customer_authorization_ref !== 'ticket-CUST-456') {
    throw new Error(`Expected approved destructive action dry-run execution plan, got ${executePlanResponse.status}: ${JSON.stringify(executePlanPayload)}`);
  }
  if (executePlanPayload.preflight_result?.would_set_archived_at !== true
    || executePlanPayload.rollback_payload?.organization?.archived_at !== null) {
    throw new Error(`Expected execution plan to include org archive preflight and rollback payload, got ${JSON.stringify(executePlanPayload)}`);
  }
  if (!internalAdminActionExecutionRecords.find((record) => record.action_request_id === actionRequestPayload.action_request.id)) {
    throw new Error(`Expected dry-run execution record to be inserted, got ${JSON.stringify(internalAdminActionExecutionRecords)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_action_execution_planned')) {
    throw new Error(`Expected dry-run execution plan audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }

  const rollbackPlanResponse = await handleEnterpriseControlPlaneRequest(
    buildHostRequest(INTERNAL_ADMIN_HOSTNAME, `/api/v1/internal-admin/action-execution-records/${executePlanPayload.execution_record.id}/rollback-plan`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
        'content-type': 'application/json',
        'x-vaultproof-internal-admin-approval': 'approval-secret',
      },
    }),
    {
      ...env,
      internalAdminAllowedEmails: 'owner@vaultproof.dev,ops@vaultproof.dev',
      internalAdminActionsEnabled: true,
      internalAdminApprovalSecret: 'approval-secret',
    },
  );
  const rollbackPlanPayload = await rollbackPlanResponse.json();
  if (rollbackPlanResponse.status !== 201
    || rollbackPlanPayload.rollback_enabled !== false
    || rollbackPlanPayload.rollback_record?.execution_mode !== 'dry_run'
    || rollbackPlanPayload.rollback_record?.status !== 'planned'
    || rollbackPlanPayload.rollback_plan?.action_direction !== 'rollback') {
    throw new Error(`Expected approved destructive action rollback dry-run plan, got ${rollbackPlanResponse.status}: ${JSON.stringify(rollbackPlanPayload)}`);
  }
  if (rollbackPlanPayload.rollback_plan?.would_restore_organization_fields?.archived_at !== null
    || rollbackPlanPayload.rollback_record?.rollback_payload?.organization?.archived_at !== null) {
    throw new Error(`Expected rollback plan to preserve original org archive fields, got ${JSON.stringify(rollbackPlanPayload)}`);
  }
  if (!internalAdminActionExecutionRecords.find((record) => record.id === rollbackPlanPayload.rollback_record.id)) {
    throw new Error(`Expected dry-run rollback record to be inserted, got ${JSON.stringify(internalAdminActionExecutionRecords)}`);
  }
  if (!internalAdminAuditEvents.some((event) => event.event_type === 'internal_admin_action_rollback_planned')) {
    throw new Error(`Expected dry-run rollback plan audit event, got ${JSON.stringify(internalAdminAuditEvents)}`);
  }
  stubAuthUserId = 'user_123';
  stubAuthUserEmail = 'owner@example.com';

  const enterpriseHostResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/api/v1/internal-admin/overview', {
      headers: {
        authorization: `Bearer ${AUTH_TOKEN}`,
      },
    }),
    env,
  );
  if (enterpriseHostResponse.status !== 404) {
    throw new Error(`Expected internal admin API to stay unavailable on enterprise host, got ${enterpriseHostResponse.status}`);
  }
}

async function assertEnterpriseReadinessRoute() {
  installSupabaseStub();

  const response = await handleEnterpriseControlPlaneRequest(
    buildRequest('/readiness'),
    {
      enterpriseHostname: ENTERPRISE_HOSTNAME,
      enterpriseRuntimeTier: 'shared-demo',
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
  if (payload?.runtime_tier !== 'shared-demo' || payload?.customer_dedicated_runtime !== false) {
    throw new Error(`Expected readiness route to expose shared demo runtime tier, got ${JSON.stringify(payload)}`);
  }
  if (!payload?.production_blockers?.includes('executor: key release is not hardware-bound')) {
    throw new Error(`Expected readiness route to include executor production blockers, got ${JSON.stringify(payload)}`);
  }
  if (payload?.detail !== 'summary') {
    throw new Error(`Expected public readiness to return summary detail, got ${JSON.stringify(payload)}`);
  }
  if (payload?.executor?.health?.accepted_key_ids || payload?.executor?.health?.key_release_hardware_bound !== undefined) {
    throw new Error(`Expected public readiness to hide raw executor internals, got ${JSON.stringify(payload.executor?.health)}`);
  }
  if (payload?.executor?.health?.production_blocker_count !== 3) {
    throw new Error(`Expected public readiness to expose only executor blocker count, got ${JSON.stringify(payload.executor?.health)}`);
  }
}

async function assertFrontDoorOriginLock() {
  const env = {
    enterpriseHostname: ENTERPRISE_HOSTNAME,
    executorBaseUrl: 'https://executor.internal',
    azureFrontDoorId: 'front-door-id',
    originLockSecret: 'origin-lock-secret',
  };

  const healthResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/health'),
    env,
  );
  const healthPayload = await healthResponse.json();
  if (healthResponse.status !== 200 || healthPayload?.origin_lock_configured !== true) {
    throw new Error(`Expected health route to stay available for load-balancer checks, got ${healthResponse.status} ${JSON.stringify(healthPayload)}`);
  }

  const deniedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/readiness'),
    env,
  );
  const deniedPayload = await deniedResponse.json();
  if (deniedResponse.status !== 403 || !String(deniedPayload?.error || '').includes('origin lock')) {
    throw new Error(`Expected Front Door origin lock denial, got ${deniedResponse.status} ${JSON.stringify(deniedPayload)}`);
  }

  const allowedResponse = await handleEnterpriseControlPlaneRequest(
    buildRequest('/readiness', {
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
    buildRequest('/readiness', {
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
    buildRequest('/readiness', {
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
await assertEnterpriseSecurityHeaders();
await assertEnterpriseAppLinkCrawl();
await assertInternalAdminConsole();
await assertEnterpriseMixpanelAnalytics();
await assertEnterpriseReadinessRoute();
await assertFrontDoorOriginLock();
await assertExecuteRoute();
await assertEnterpriseExecuteDryRun();
await assertEnterpriseRuntimeExecuteToken();
await assertEnterpriseOriginLock();
await assertEnterpriseCallerLockPolicy();
await assertEnterpriseCallerLockIpPolicy();
await assertEnterpriseCallerLockIpv6Policy();
await assertEnterpriseCallerLockCertificatePolicy();
await assertEnterpriseProviderCallerLockPolicy();
await assertEnterpriseExecutionPolicy();
await assertEnterpriseProviderExecutionPolicy();
await assertEnterpriseRateLimitPolicy();
await assertEnterpriseProjectOverviewRollup();
await assertEnterpriseCreateProviderSlot();
await assertEnterpriseEmergencyRevoke();
await assertEnterpriseAuditCsvExport();
await assertEnterpriseAccessReviewEvidenceExport();
await assertEnterpriseAlertsApi();
await assertEnterpriseMembersAdminActions();
await assertEnterpriseVerifierApi();
await assertEnterpriseSsoLifecycle();
console.log('enterprise control plane smoke test passed');
