import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const projectId = process.env.PROJECT_ID || 'vaultproof-prod';
const location = process.env.LOCATION || 'us-central1';
const zone = process.env.ZONE || 'us-central1-a';
const repository = process.env.REPOSITORY || 'vaultproof';
const vmName = process.env.VM_NAME || 'vaultproof-enterprise-runtime-1';
const keyRing = process.env.KEY_RING || 'vaultproof-runtime';
const kmsKey = process.env.KMS_KEY || 'vaultproof-unwrap';
const network = process.env.NETWORK || 'vaultproof-enterprise';
const firewall = process.env.FIREWALL || 'vaultproof-enterprise-allow-iap-ssh';
const edgeDomain = process.env.EDGE_DOMAIN || 'enterprise.vaultproof.dev';
const edgeIpName = process.env.EDGE_IP_NAME || 'vaultproof-enterprise-edge-ip';
const edgeFirewall = process.env.EDGE_FIREWALL || 'vaultproof-enterprise-allow-lb-to-control-plane';
const edgeInstanceGroup = process.env.EDGE_INSTANCE_GROUP || 'vaultproof-enterprise-runtime-ig';
const edgeHealthCheck = process.env.EDGE_HEALTH_CHECK || 'vaultproof-enterprise-health';
const edgeBackendService = process.env.EDGE_BACKEND_SERVICE || 'vaultproof-enterprise-backend';
const edgeSecurityPolicy = process.env.EDGE_SECURITY_POLICY || 'vaultproof-enterprise-armor';
const edgeSslCertificate = process.env.EDGE_SSL_CERTIFICATE || 'vaultproof-enterprise-cert';
const edgeForwardingRule = process.env.EDGE_FORWARDING_RULE || 'vaultproof-enterprise-https';
let buildTag = process.env.BUILD_TAG || '';
const buildDocPath = resolve('docs/enterprise/gcp-build-status.md');
let existingBuildDoc = '';
try {
  existingBuildDoc = readFileSync(buildDocPath, 'utf8');
} catch {
  existingBuildDoc = '';
}

function shellValue(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function gcloudJson(args) {
  try {
    const stdout = execFileSync('gcloud', [...args, '--format=json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

function imageFor(images, imageName) {
  const packageName = `${location}-docker.pkg.dev/${projectId}/${repository}/${imageName}`;
  return images
    .filter((image) => image.package === packageName)
    .sort((left, right) => {
      const leftTagged = Array.isArray(left.tags) && left.tags.includes(buildTag) ? 1 : 0;
      const rightTagged = Array.isArray(right.tags) && right.tags.includes(buildTag) ? 1 : 0;
      if (leftTagged !== rightTagged) return rightTagged - leftTagged;
      const leftTime = left.metadata?.buildTime || left.updateTime || '';
      const rightTime = right.metadata?.buildTime || right.updateTime || '';
      return String(rightTime).localeCompare(String(leftTime));
    })[0] || null;
}

function valueOrUnknown(value) {
  return value === undefined || value === null || value === '' ? 'unknown' : String(value);
}

function bool(value) {
  return value === true ? 'true' : value === false ? 'false' : 'unknown';
}

function markdownList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}

async function fetchJson(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: null,
      body: null,
      error: error instanceof Error ? error.message : 'request failed',
    };
  }
}

async function fetchText(url) {
  try {
    const response = await fetch(url, {
      headers: { accept: 'text/plain,application/javascript,*/*' },
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      text: '',
      error: error instanceof Error ? error.message : 'request failed',
    };
  }
}

function parseJwtPayload(token) {
  try {
    const payloadPart = String(token || '').split('.')[1] || '';
    return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function metadataValue(resource, key) {
  const item = Array.isArray(resource?.metadata?.items)
    ? resource.metadata.items.find((entry) => entry.key === key)
    : null;
  return item?.value || '';
}

const registry = `${location}-docker.pkg.dev/${projectId}/${repository}`;
const kms = gcloudJson([
  'kms', 'keys', 'describe', kmsKey,
  '--keyring', keyRing,
  '--location', location,
  '--project', projectId,
]);
const vm = gcloudJson([
  'compute', 'instances', 'describe', vmName,
  '--zone', zone,
  '--project', projectId,
]);
buildTag = buildTag || metadataValue(vm, 'vaultproof-build-tag') || shellValue('git', ['rev-parse', '--short', 'HEAD']) || 'manual';
const images = gcloudJson([
  'artifacts', 'docker', 'images', 'list',
  registry,
  '--include-tags',
  '--project', projectId,
]) || [];
const controlImage = imageFor(images, 'enterprise-control-plane');
const executorImage = imageFor(images, 'enterprise-secure-executor');
const vpc = gcloudJson([
  'compute', 'networks', 'describe', network,
  '--project', projectId,
]);
const fw = gcloudJson([
  'compute', 'firewall-rules', 'describe', firewall,
  '--project', projectId,
]);
const edgeAddress = gcloudJson([
  'compute', 'addresses', 'describe', edgeIpName,
  '--global',
  '--project', projectId,
]);
const edgeFw = gcloudJson([
  'compute', 'firewall-rules', 'describe', edgeFirewall,
  '--project', projectId,
]);
const edgeIg = gcloudJson([
  'compute', 'instance-groups', 'unmanaged', 'describe', edgeInstanceGroup,
  '--zone', zone,
  '--project', projectId,
]);
const edgeHc = gcloudJson([
  'compute', 'health-checks', 'describe', edgeHealthCheck,
  '--global',
  '--project', projectId,
]);
const edgeBackend = gcloudJson([
  'compute', 'backend-services', 'describe', edgeBackendService,
  '--global',
  '--project', projectId,
]);
const cloudArmorPolicy = gcloudJson([
  'compute', 'security-policies', 'describe', edgeSecurityPolicy,
  '--global',
  '--project', projectId,
]);
const edgeBackendHealth = gcloudJson([
  'compute', 'backend-services', 'get-health', edgeBackendService,
  '--global',
  '--project', projectId,
]);
const edgeCert = gcloudJson([
  'compute', 'ssl-certificates', 'describe', edgeSslCertificate,
  '--global',
  '--project', projectId,
]);
const edgeRule = gcloudJson([
  'compute', 'forwarding-rules', 'describe', edgeForwardingRule,
  '--global',
  '--project', projectId,
]);
const serviceAccounts = gcloudJson([
  'iam', 'service-accounts', 'list',
  '--project', projectId,
]) || [];
const secrets = gcloudJson([
  'secrets', 'list',
  '--project', projectId,
]) || [];

const vmInterface = vm?.networkInterfaces?.[0] || {};
const vmAccess = vmInterface.accessConfigs?.[0] || {};
const shielded = vm?.shieldedInstanceConfig || {};
const confidential = vm?.confidentialInstanceConfig || {};
const runtimeSa = vm?.serviceAccounts?.[0]?.email || '';
const edgeHealthStates = (Array.isArray(edgeBackendHealth) ? edgeBackendHealth : [])
  .flatMap((backend) => backend?.status?.healthStatus || [])
  .map((status) => `${status.healthState || 'unknown'} ${status.ipAddress || 'unknown'}:${status.port || 'unknown'}`);
const edgeDnsA = shellValue('dig', ['+short', edgeDomain])
  .split('\n')
  .map((value) => value.trim())
  .filter(Boolean);
const edgeIp = edgeAddress?.address || edgeRule?.IPAddress || '';
const edgeDnsPointsAtGcp = edgeIp !== '' && edgeDnsA.includes(edgeIp);
const edgeCertDomainStatus = edgeCert?.managed?.domainStatus?.[edgeDomain] || '';
const edgeTlsActive = edgeCert?.managed?.status === 'ACTIVE' && edgeCertDomainStatus === 'ACTIVE';
const edgeBackendHealthy = edgeHealthStates.some((state) => state.startsWith('HEALTHY '));
const cloudArmorAttached = Boolean(edgeBackend?.securityPolicy && String(edgeBackend.securityPolicy).includes(`/securityPolicies/${edgeSecurityPolicy}`));
const cloudArmorPolicyResource = Array.isArray(cloudArmorPolicy) ? cloudArmorPolicy[0] : cloudArmorPolicy;
const cloudArmorRules = Array.isArray(cloudArmorPolicyResource?.rules) ? cloudArmorPolicyResource.rules : [];
const cloudArmorExpectedPriorities = [1000, 1001, 1002, 1003, 1100, 1200, 1300];
const cloudArmorRulesReady = cloudArmorExpectedPriorities.every((priority) => (
  cloudArmorRules.some((rule) => Number(rule.priority) === priority)
));
const cloudArmorState = cloudArmorAttached && cloudArmorRulesReady
  ? 'attached and enforced'
  : cloudArmorAttached
    ? 'attached but expected rules are incomplete'
    : cloudArmorPolicyResource
      ? 'created but not attached'
      : 'not configured';
const publicEdgeState = edgeRule && edgeDnsPointsAtGcp && edgeTlsActive && edgeBackendHealthy ? 'live' : 'in progress';
const readinessCheck = await fetchJson(`https://${edgeDomain}/readiness`);
const readinessBody = readinessCheck.body && typeof readinessCheck.body === 'object' ? readinessCheck.body : {};
const readinessProductionReady = readinessCheck.ok && readinessBody.production_ready === true;
const readinessBlockers = Array.isArray(readinessBody.production_blockers)
  ? readinessBody.production_blockers.map((item) => String(item)).filter(Boolean)
  : [];
const loginScriptCheck = await fetchText(`https://${edgeDomain}/app/enterprise-login.js`);
const loginSupabaseUrl = loginScriptCheck.text.match(/const SUPABASE_URL = ["']([^"']+)["']/)?.[1] || '';
const loginSupabaseAnonKey = loginScriptCheck.text.match(/const SUPABASE_ANON_KEY = ["']([^"']+)["']/)?.[1] || '';
const loginSupabaseAnonPayload = parseJwtPayload(loginSupabaseAnonKey);
const publicSupabaseAnonReady = loginScriptCheck.ok
  && loginSupabaseUrl.includes('.supabase.co')
  && loginSupabaseAnonPayload?.role === 'anon'
  && loginSupabaseAnonPayload?.ref;
const runtimeReadiness = readinessProductionReady
  ? 'production ready on the live GCP edge'
  : 'degraded until real Secret Manager env versions are published';
const firstGoalGateDone = process.env.GCP_FIRST_GOAL_GATE_STATUS === 'done'
  || existingBuildDoc.includes('Status: `done for demo dry-run')
  || existingBuildDoc.includes('returned `status: done` against');
const goal1Status = firstGoalGateDone
  ? 'done for the demo dry-run goal'
  : readinessProductionReady
    ? 'runtime ready; run the first-goal gate with pilot data and a dry execute token'
    : 'blocked on runtime secrets, Supabase auth settings, and demo pilot data';
const knownBlockers = readinessProductionReady
  ? [
      ...(publicSupabaseAnonReady
        ? ['Run strict login readiness QA with `LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login` to verify the Supabase redirect/session/API path.']
        : ['Browser OAuth/password login still needs the valid public Supabase anon key published as `SUPABASE_ANON_KEY`.']),
      'Human OAuth/password login still needs final browser click-through QA.',
      `Supabase Auth redirect/provider settings still need confirmation for \`https://${edgeDomain}/app/login\`.`,
      ...(cloudArmorAttached && cloudArmorRulesReady
        ? []
        : ['Attach and verify Cloud Armor WAF/rate-limit policy on the enterprise backend service.']),
      'Rotate the pilot MiniMax key before paid customer onboarding because it was shared in chat; keep using sealed local ingest for any future live provider key.',
    ]
  : readinessBlockers.length
    ? readinessBlockers
    : [
        'Supabase service role is not configured.',
        'Executor material resolver is not ready.',
        'GCP encrypted vault unwrap key ciphertext is not configured.',
        'Attestation token hash is missing.',
        'Control-plane origin-lock enforcement is waiting for real runtime env secret versions.',
      ];
if (!readinessProductionReady && edgeCert?.managed?.status !== 'ACTIVE') {
  knownBlockers.push('Google-managed TLS certificate is still provisioning.');
}
const nextSteps = readinessProductionReady
  ? [
      ...(publicSupabaseAnonReady
        ? [`Run \`LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login\` with Supabase service-role env for \`ken@vaultproof.dev\`.`]
        : ['Copy the valid public Supabase anon key from Supabase Project Settings > API and publish it as `SUPABASE_ANON_KEY` in the control-plane env.']),
      `Browser-test \`https://${edgeDomain}/app/login\` with \`ken@vaultproof.dev\`.`,
      `Confirm managed Supabase Auth redirect settings include \`https://${edgeDomain}/app/login\`.`,
      'Configure the external OAuth provider app callback as `https://gwzkjiomemjlhtrdrlan.supabase.co/auth/v1/callback` if using Google/GitHub/Microsoft login; add `LOGIN_QA_OAUTH_PROVIDER=google` to the login QA command to verify the public OAuth authorize redirect.',
      ...(cloudArmorAttached && cloudArmorRulesReady
        ? ['Keep `npm run verify:gcp-enterprise-cloud-armor` in the strict live launch gate.']
        : ['Run `npm run configure:gcp-enterprise-cloud-armor`, then `npm run verify:gcp-enterprise-cloud-armor`.']),
      'Add a valid OpenAI Platform key only if the demo specifically needs OpenAI; MiniMax upstream dispatch is now live.',
      'Keep running `npm run gate:gcp-first-goal`; it can generate a temporary Supabase magic-link test session when no `ENTERPRISE_TEST_ACCESS_TOKEN` is provided.',
    ]
  : [
      'Use `npm run prepare:gcp-first-goal-runtime` to render and publish real `enterprise-control-plane-env` and `enterprise-secure-executor-env` Secret Manager versions.',
      'Configure Supabase service-role credentials for the control plane and executor.',
      `Confirm managed Supabase OAuth/Auth settings include \`https://${edgeDomain}/app/login\`.`,
      'Encrypt the VaultProof unwrap root with standard Cloud KMS and set `GCP_KMS_ENCRYPTED_VAULT_UNWRAP_KEY_BASE64`.',
      'Let `npm run collect:gcp-runtime-evidence` provide the GCP attestation hash and measurement summary values expected by executor readiness.',
      'Enable control-plane origin-lock enforcement with `ENTERPRISE_REQUIRE_ORIGIN_LOCK=true` after the env secret includes the same `enterprise-origin-lock-secret` value used by the backend service.',
      'Seed the first pilot organization/project/member data. Demo-only seeding can use a dashboard placeholder provider slot; add `DEMO_PROVIDER_API_KEY` with the matching unwrap root later to create live encrypted provider material.',
      'Run `npm run gate:gcp-first-goal` with Supabase service-role env and a pilot access token; only start Ken testing when it reports `status: done`.',
    ];
const secretVersionStatus = readinessProductionReady
  ? 'As of this build, real runtime env secret versions are live and the VM has reloaded them.'
  : 'As of this build, real secret versions still need to be added before production readiness can pass.';
const readinessStatusLines = readinessProductionReady
  ? [
      'Containers are running.',
      'Public `/health` and `/readiness` pass through the GCP edge.',
      'Readiness reports `production_ready: true` and `security_profile: google-confidential-production`.',
    ]
  : [
      'Containers are running.',
      'Executor `/health` responds locally.',
      'Control plane `/readiness` responds locally.',
      'Readiness is intentionally degraded until real env secret versions exist.',
    ];
const monthlyHours = 730;
const monthlyCostItems = [
  {
    item: 'Confidential VM `n2d-standard-2`',
    basis: '$0.084492/hour on-demand in `us-central1`',
    monthlyUsd: 0.084492 * monthlyHours,
  },
  {
    item: '30 GB `pd-balanced` boot disk',
    basis: '$0.10/GB-month in `us-central1`',
    monthlyUsd: 30 * 0.10,
  },
  {
    item: 'VM external IPv4 address',
    basis: '$0.005/hour while attached to the VM',
    monthlyUsd: 0.005 * monthlyHours,
  },
  {
    item: 'Global HTTPS forwarding rule',
    basis: '$0.025/hour for the first 5 global forwarding rules',
    monthlyUsd: 0.025 * monthlyHours,
  },
  {
    item: 'Cloud KMS software key version',
    basis: '$0.000082192/hour for one active software key version',
    monthlyUsd: 0.000082192 * monthlyHours,
  },
  {
    item: 'Secret Manager active versions',
    basis: '$0.06/version-month; current billable usage may fit inside the 6-version free tier',
    monthlyUsd: 0.06,
  },
];
const monthlyFixedEstimate = monthlyCostItems.reduce((sum, item) => sum + item.monthlyUsd, 0);

function usd(value) {
  return `$${value.toFixed(2)}`;
}

function costTable(items) {
  return [
    '| Item | Basis | Estimated monthly |',
    '| --- | --- | --- |',
    ...items.map((item) => `| ${item.item} | ${item.basis} | ${usd(item.monthlyUsd)} |`),
  ].join('\n');
}

const buildDoc = `# VaultProof GCP Build Status

Last updated: ${new Date().toISOString()}

This file is the living inventory of what has been built for VaultProof on Google Cloud. It is refreshed after every successful enterprise image build by \`infra/gcp/enterprise-secure-runtime/build-images.sh\`.

## Build Snapshot

- Public edge: \`${publicEdgeState}\`
- Enterprise URL: \`https://${edgeDomain}\`
- DNS: \`${edgeDnsPointsAtGcp ? `Cloudflare A record points at ${edgeIp}` : 'not yet pointing at the GCP edge'}\`
- TLS: \`${edgeTlsActive ? 'Google-managed certificate active' : `Google-managed certificate ${valueOrUnknown(edgeCert?.managed?.status)}`}\`
- Staff/admin boundary: \`vaultproof.dev is the B2C/root system; enterprise.vaultproof.dev is customer enterprise only\`
- Backend: \`${edgeBackendHealthy ? 'healthy' : 'not healthy'}\`
- Origin-lock backend header: \`${edgeBackend?.customRequestHeaders?.length ? 'configured' : 'not configured'}\`
- Cloud Armor edge policy: \`${cloudArmorState}\`
- Auth/database provider: \`managed Supabase for Goal 1 demo; fresh database later\`
- Public Supabase anon key: \`${publicSupabaseAnonReady ? 'configured' : 'not confirmed'}\`
- Runtime readiness: \`${runtimeReadiness}\`

## Goal 1: Testable Paid Pilot

Status: \`${goal1Status}\`

${firstGoalGateDone
    ? `\`SKIP_LOCAL_CHECKS=true npm run gate:gcp-first-goal\` returned \`status: done\` against \`https://${edgeDomain}\` on 2026-05-10. The gate verified the live GCP edge, runtime readiness, origin lock, GCP KMS unwrap path, Supabase-backed material resolver, first pilot data for \`ken@vaultproof.dev\`, a generated Supabase test session, and the dry execute path end to end. For the demo path, the provider slot uses dashboard placeholder shares; live encrypted provider material is a later switch when we are ready to call an upstream provider.`
    : 'Goal 1 is done when `npm run gate:gcp-first-goal` returns `status: done`. That means the live GCP edge, runtime readiness, origin lock, GCP KMS unwrap path, Supabase-backed material resolver, first pilot data, and dry execute path are testable end to end. For the demo path, the provider slot may use dashboard placeholder shares; live encrypted provider material is a later switch when we are ready to call an upstream provider.'}

Current blockers:

${markdownList(knownBlockers)}

## Login Readiness QA

Status: \`built in login-readiness-20260510\`

\`npm run qa:enterprise-login\` now checks the live enterprise login page, validates the public Supabase URL/anon key embedded in \`https://${edgeDomain}/app/enterprise-login.js\`, and verifies the login script still sends OAuth, magic-link, confirmation, and recovery redirects back to \`https://${edgeDomain}/app/login\`.

For the final demo go/no-go run, use \`LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login\` with Supabase service-role env loaded. That strict mode generates a temporary magic-link session for \`ken@vaultproof.dev\`, which also proves the Supabase Auth redirect allowlist accepts \`https://${edgeDomain}/app/login\`, then calls \`/api/v1/enterprise/orgs\`, \`/orgs/current\`, and \`/projects/bootstrap\` with the generated browser session. To verify a specific external provider redirect, add \`LOGIN_QA_OAUTH_PROVIDER=google\` after the provider is configured.

## Cloud Armor Edge Guardrail

Status: \`${cloudArmorState}\`

\`npm run configure:gcp-enterprise-cloud-armor\` creates or updates \`${edgeSecurityPolicy}\` and attaches it to \`${edgeBackendService}\`. The policy blocks common secret/config/admin scanner paths before they reach the VM and applies per-IP throttles to the secure execute route, enterprise API routes, and the public edge. \`npm run verify:gcp-enterprise-cloud-armor\` checks the policy attachment, expected rule priorities, \`/health\` availability, and a blocked \`/.env\` scanner probe.

## App Shell Notes

- Build \`${buildTag}\` is the current deployed GCP image tag for both control plane and executor containers.
- Homepage hero headline is \`Active Key Protection for every API call.\`
- All customer-facing enterprise pages below live under \`https://${edgeDomain}\`; route-only mentions are in-app links on that subdomain.
- \`https://${edgeDomain}/app/demo\` is the buyer walkthrough: live workspace facts, proof path, identity/OAuth proof kit, key-rotation proof kit, pilot operations proof kit, API proxy self-test kit, monitoring evidence kit, safety guardrails, objection answers, paid-pilot close steps, and a copyable demo talk track generated without secrets.
- \`https://${edgeDomain}/app/launch\` is the customer go-live board: live readiness summary, auto/manual customer tasks, browser-saved checklist progress, safe-to-pilot go/no-go readiness, browser-local status/timestamp evidence with stale holds, workflow links, identity/OAuth, key-rotation, and pilot-operations evidence packets, and a copyable launch brief.
- \`https://${edgeDomain}/app/evidence\` is the customer proof packet: runtime readiness, go/no-go launch decision and blockers, identity/login QA evidence, key-rotation/demo-only acceptance evidence, pilot operations rollback and budget/monitoring evidence, API proxy self-test evidence, API inventory proof, policy drift proof, integration rollout proof, launch support readiness, monitoring evidence with alert workflow/Cloud Armor/budget guardrails, access-review and audit export links, provider posture, rollout workflow, and copy/download JSON evidence summary without secrets.
- \`https://${edgeDomain}/app/inventory\` is the customer API inventory board: metadata-only API surfaces from existing projects, provider slots, caller-lock policy, project health, and access-log rollups; browser-local owner/environment/risk/review annotations; protected/missing-provider/policy-incomplete/no-traffic/stale/review-due posture; workflow links; and copyable \`vaultproof_enterprise_api_inventory\` JSON without secrets.
- \`https://${edgeDomain}/app/policy\` is the customer policy drift board: control-gap rows from existing project/provider/policy/inventory/traffic evidence; browser-local accepted-risk records with owner, reason, risk, compensating control, expiration date, approval status, and next action; launch hold summary; workflow links; and copyable \`vaultproof_enterprise_policy_drift\` JSON without secrets.
- \`https://${edgeDomain}/app/rollout\` is the customer integration rollout board: workload cutover rows from API inventory/policy/traffic evidence; browser-local application, integration mode, owner, target date, canary, test status, rollback, and support metadata; derived blockers; copy-safe dry-run snippets with placeholders; and copyable \`vaultproof_enterprise_integration_rollout\` JSON without secrets.
- \`https://${edgeDomain}/app/security-review\` is the buyer security packet: concise architecture summary, control coverage, evidence links, open review items, common customer answers, known limitations, secret exclusions, and copyable security/procurement review text.
- \`https://${edgeDomain}/app/plans\` is the buyer package view: rollout posture, paid-pilot commercial package, contract guardrails, security boundaries, and direct links into evidence, launch, technical guide, and runbooks.
- \`https://${edgeDomain}/app/pilot\` is the paid-pilot proposal builder: browser-local first workload scope, expected volume, monthly price, 20% sales commission math, support/incident-response terms, success metric, and copyable customer proposal text without secrets.
- \`https://${edgeDomain}/app/pilot-success\` is the pilot success tracker: live checks, browser-local customer milestones, evidence links, blockers, expansion/no-go readiness, and copyable weekly customer update without secrets.
- \`https://${edgeDomain}/app/support\` is the launch support room: founder-led support scope, optional 24-hour incident-response boundary, customer-safe staff/admin boundary, read-only default, approval-gated actions, support handoff checklist, and copyable support brief without secrets.
- \`https://${edgeDomain}/app/keys\` includes the API proxy self-test kit and email API key demo path: copy-safe dry-run requests with required caller-lock headers, Resend/SendGrid/Mailgun/Postmark/AWS SES slot defaults, protected email dry-run, blocked-recipient policy testing, no raw key reveal, launch/evidence coverage, and email-specific audit metadata.
- \`https://${edgeDomain}/app/control\` and \`https://${edgeDomain}/app/org\` use the shared universal sidebar with explicit sidebar typography, hide the legacy static topbar/page frame, and clean old \`?org=<uuid>\` URLs back to canonical \`https://${edgeDomain}/app/control\` and \`https://${edgeDomain}/app/org\` while preserving the selected org in local storage.
- Live HTML verification on both long-form URLs confirmed the universal sidebar, URL cleanup script, hidden legacy topbar, explicit sidebar font sizing, and no legacy sidebar/site-theme artifacts.
- Staff/admin pages belong to the separate VaultProof B2C/root system on \`vaultproof.dev\`. The enterprise runtime does not default to an employee admin hostname, and \`enterprise.vaultproof.dev\` remains customer-facing only.
- Root admin boundary page lives at \`vaultproof.dev/admin\` in the B2C static site so staff/B2C admin entry is distinct from enterprise customer login.

## Projects Page Performance

Status: \`built and deployed in bootstrap-rpc-20260510\`

The enterprise Projects/Inventory/Policy/Rollout/Keys/Activity pages load organization options, accessible projects, provider slots, and overview stats through \`GET /api/v1/enterprise/projects/bootstrap\` instead of chaining \`/orgs\`, \`/projects\`, and \`/projects/stats/overview\` from the browser. In \`bootstrap-rpc-20260510\`, bootstrap now uses the service-role-only Supabase \`enterprise_projects_bootstrap(...)\` RPC, which wraps the existing \`enterprise_project_access_overview(...)\` rollup inside Postgres.

The deployed bootstrap request removes these separate Supabase calls after auth:

- \`organization_members\` joined to \`organizations\` for membership/org options.
- \`project_members\` joined to \`projects\` for direct project access.
- \`organization_members\` joined through \`organizations.projects\` for org-wide project access.
- \`project_keys\` for provider-slot material status.
- duplicate \`project_keys\` for overview key/provider counts.
- separate \`enterprise_project_access_overview(...)\` HTTP RPC call; the new bootstrap RPC calls the rollup inside Postgres.

The remaining external call is Supabase Auth \`getUser(token)\`, which is still needed to validate the browser session before any service-role data read. The live bootstrap response reports \`statsSource: bootstrap_rpc\` and \`accessLogStatsSource: rollup_rpc\`.

Live timing on \`https://${edgeDomain}\` with a temporary Supabase pilot session on 2026-05-09:

| Endpoint | Before | After |
| --- | ---: | ---: |
| \`https://${edgeDomain}/app/projects\` HTML | 132 ms | 140 ms |
| \`/api/v1/enterprise/orgs\` | 1,709 ms | 209 ms median |
| \`/api/v1/enterprise/projects\` | 2,173 ms | 456 ms median |
| \`/api/v1/enterprise/projects/stats/overview\` | 880 ms | 513 ms median |
| \`/api/v1/enterprise/projects/bootstrap\` | not present | 605 ms median after first warm-up hit |

Live authenticated timing after \`rollup-stats-20260509\` deployed on 2026-05-10 with a temporary Supabase pilot session:

| Endpoint | Status | Source | Median | p95 |
| --- | ---: | --- | ---: | ---: |
| \`/api/v1/enterprise/projects/bootstrap\` | 200 | \`rollup_rpc\` | 452 ms | 682 ms |
| \`/api/v1/enterprise/projects/stats/overview\` | 200 | \`rollup_rpc\` | 439 ms | 642 ms |

Live authenticated timing after \`bootstrap-rpc-20260510\` deployed on 2026-05-10 with a generated Supabase pilot session:

| Endpoint | Status | Source | Median | p95 |
| --- | ---: | --- | ---: | ---: |
| \`/api/v1/enterprise/projects/bootstrap\` | 200 | \`bootstrap_rpc\` / \`rollup_rpc\` | 383 ms | 596 ms |
| \`/api/v1/enterprise/projects/stats/overview\` | 200 | \`rollup_rpc\` | 474 ms | 642 ms |
| \`/api/v1/enterprise/orgs\` | 200 | n/a | 179 ms | 189 ms |

Scale item update: raw logs remain the evidence stream, and \`project_access_log_daily_rollups\` now carries dashboard counters. The next scale pass is to add retention/partitioning policy for very high call volume.

## API Proxy Speed

Status: \`runtime-token fast path deployed in runtime-fastpath-20260510\`

The pilot MiniMax slot was sealed with live encrypted material on 2026-05-10. \`runtime-fastpath-20260510\` added a short-lived HMAC runtime token for product proxy calls plus a short TTL non-secret execution context cache. Provider key material still stays out of the control-plane cache; the executor remains responsible for decrypting provider material and returning attestation.

The live speed test measured the enterprise secure execute route with the pilot policy headers:

- endpoint shape: \`/api/v1/enterprise/projects/:projectId/providers/:slug/execute\`
- method/path: \`POST /v1/chat/completions\`
- required headers: \`Origin: https://enterprise.vaultproof.dev\` and \`x-vaultproof-customer-gateway: vaultproof-managed\`
- dashboard dry-run behavior covered: Supabase Auth session validation, project/member authorization, strict origin lock, caller-lock policy, provider slot lookup, signed execution envelope creation, and governance audit write
- runtime-token dry-run behavior covered: HMAC token validation, project/provider policy fetch, short TTL context cache, strict origin lock, caller-lock policy, signed execution envelope creation, and governance audit write
- upstream behavior covered: executor material decrypt, GCP KMS unwrap path, provider dispatch to MiniMax, execution result recording, and attestation return

Live authenticated timing on 2026-05-10:

| Product path | Status | Samples | Median | p90 | p95 | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| secure execute dry run | 202 | 12 | 634 ms | 690 ms | 752 ms | 571 ms | 847 ms |
| MiniMax upstream dispatch | 200 | 5 | 5,713 ms | 6,258 ms | 6,258 ms | 3,936 ms | 7,054 ms |

Live runtime-token timing after \`runtime-fastpath-20260510\` deployed on 2026-05-10:

| Product path | Status | Samples | Median | p95 | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| runtime-token secure execute dry run | 202 | 6 | 255 ms | 320 ms | 217 ms | 1,320 ms |
| runtime-token MiniMax upstream dispatch | 200 | 3 | 2,198 ms | 2,198 ms | 1,671 ms | 3,023 ms |

The dry-run runtime-token samples reported \`auth_mode: runtime_token\`; the first context lookup came from Supabase and the next five came from the short TTL cache. This cuts VaultProof proxy overhead to about 250 ms median on the cached path while keeping origin/caller-lock/audit checks in place.

The first invalid probe without the required \`Origin\` header returned \`403\` with \`Origin lock rejected this request because no Origin or Referer origin was present.\`

Upstream dispatch reached MiniMax and returned \`chat.completion\` responses from \`MiniMax-M2.7\` with executor attestation present. MiniMax did not return an \`x-request-id\`/\`request-id\` header in the sampled responses.

## Provider Material Status

Status: \`built and deployed in provider-material-status-20260509\`

Project and Provider Slots pages now classify each active slot as \`live sealed\`, \`demo placeholder\`, \`mixed\`, or \`missing\` without returning \`share1_encrypted\` or \`share2_encrypted\` to the browser. After sealing provider material on 2026-05-10, live API verification returned one MiniMax slot for \`First Paid Pilot\` with \`material_mode: sealed-live\`, \`material_ready: true\`, and no encrypted share fields in the payload. The OpenAI slot was reset to \`demo-placeholder\` because the supplied key was for MiniMax.

## Feature: API Inventory Management

Status: \`built for enterprise demo\`

\`https://${edgeDomain}/app/inventory\` gives customer security and platform teams a metadata-only system of record for protected API surfaces: project, provider slot, owner, environment, business service, risk level, data sensitivity, caller-lock posture, policy status, last-seen traffic, denial/error posture, review status, and evidence/export links.

The demo slice starts from existing data instead of new infrastructure: it derives inventory rows from projects, provider slots, project policies, project health, access logs, and rollups; adds browser-local/manual annotations for owner, environment, business service, sensitivity, risk, review status, next review date, and notes; flags missing provider slots, stale APIs, no recent traffic, policy gaps, blocked rows, exceptions, and review-due items; then includes the summary in the evidence packet under \`api_inventory\`. Persistent audited inventory tables, CSV/OpenAPI import, and automatic discovery can follow after the customer demo slice.

Inventory records must never store raw provider keys, bearer tokens, OAuth client secrets, SAML material, request bodies, response bodies, or customer payloads.

## Feature: Policy Drift And Exceptions

Status: \`built for enterprise demo\`

\`https://${edgeDomain}/app/policy\` gives customer security, platform, and app teams a policy drift board tied to API inventory. It shows customer-safe control-gap rows for missing provider slots, weak or absent caller-lock policy, demo-placeholder material on a paid path, missing owners, stale or no recent traffic, review overdue, and blocked inventory rows.

The demo slice starts from existing data instead of new infrastructure: it derives rows from projects, provider slots, project policies, API inventory annotations, project health, traffic rollups, and \`GET /api/v1/enterprise/projects/bootstrap\`; saves metadata-only accepted-risk records in browser local storage per organization; and includes the summary in the evidence packet under \`policy_drift_exceptions\`. Persistent audited exceptions, second-person approval, expiry reminders, policy-as-code export, and alerting can follow after the demo slice.

Exception records must never store raw provider keys, bearer tokens, OAuth client secrets, SAML material, request bodies, response bodies, or customer payloads.

## Feature: Integration Rollout Manager

Status: \`built for enterprise demo\`

\`https://${edgeDomain}/app/rollout\` helps a customer move one workload from direct provider calls into VaultProof by showing rollout state, integration mode, app and gateway owners, target date, support window, canary percentage, test status, rollback path, blockers, snippets, and evidence links.

The demo slice starts from existing data instead of new infrastructure: it derives candidate workloads from projects, provider slots, API inventory rows, policy drift, project health, and traffic evidence; saves metadata-only rollout records in browser local storage per organization; generates copy-safe dry-run snippets with \`YOUR_VAULTPROOF_SESSION_JWT\` placeholders; and includes the summary in the evidence packet under \`integration_rollout\`. Persistent audited rollout tables, gateway templates, canary metrics, approval gates, rollback links, and notifications can follow after the demo slice.

Rollout records must never store raw provider keys, bearer tokens, OAuth client secrets, SAML material, request bodies, response bodies, or customer payloads.

## What's Next

${nextSteps.map((step, index) => `${index + 1}. ${step}`).join('\n')}

## Rough Monthly Cost

Assumption: USD list pricing, \`${location}\`, always-on runtime, about ${monthlyHours} hours/month, low traffic, no committed-use discount, no custom contract, and no Cloud HSM.

${costTable(monthlyCostItems)}

Estimated fixed idle run rate: **${usd(monthlyFixedEstimate)}/month** before traffic, Cloud Logging volume, and Supabase.

Database/auth cost note: Goal 1 is demo-only and keeps managed Supabase, so there is no added Cloud SQL or AlloyDB line item. A fresh database can be started later.

Usage-based adders:

- Load balancer data processing: about \`$0.008/GiB\` inbound and \`$0.008/GiB\` outbound through the load balancer.
- Internet data transfer out from \`us-central1\`: first 1 GiB/month free, then about \`$0.12/GiB\` to North America for the first 1 TiB.
- Backend custom request header feature: \`$0.75 per 1,000,000 HTTP(S) requests\` when using custom headers without Cloud Armor; Cloud Armor request/rule charges may apply after the edge policy is attached.
- KMS decrypt/encrypt operations: \`$0.03 per 10,000 cryptographic operations\`.
- Secret Manager access operations: \`$0.03 per 10,000 access operations\`, with 10,000/month free at the billing-account level.
- Artifact Registry storage is currently tiny; first 0.5 GB is free, then \`$0.10/GB-month\`.
- Cloud Build image builds are usage-based; the current Docker build is short and should be cents or covered by free/promotional minutes, depending on account eligibility.

Cost note: the current fixed estimate is above the existing \`VaultProof Production Monthly\` USD 50 budget alert. Either raise the alert for this pilot, stop the VM when idle, or resize/remove the VM external IP path before treating that alert as a production guardrail.

## Build Pointer

- Build tag: \`${buildTag}\`
- Registry: \`${registry}\`
- Control plane image: \`${registry}/enterprise-control-plane:${buildTag}\`
- Control plane digest: \`${valueOrUnknown(controlImage?.version)}\`
- Control plane built at: \`${valueOrUnknown(controlImage?.metadata?.buildTime || controlImage?.updateTime)}\`
- Executor image: \`${registry}/enterprise-secure-executor:${buildTag}\`
- Executor digest: \`${valueOrUnknown(executorImage?.version)}\`
- Executor built at: \`${valueOrUnknown(executorImage?.metadata?.buildTime || executorImage?.updateTime)}\`

## Project

- Project ID: \`${projectId}\`
- Project number: \`${shellValue('gcloud', ['projects', 'describe', projectId, '--format=value(projectNumber)']) || 'unknown'}\`
- Organization: \`947188006889\`
- Region: \`${location}\`
- Zone: \`${zone}\`
- Billing guardrail: \`VaultProof Production Monthly\`, USD 50 alerting budget
- HSM status: not used. The shared pilot uses standard Cloud KMS.

## Runtime VM

- Name: \`${vmName}\`
- Status: \`${valueOrUnknown(vm?.status)}\`
- Machine type: \`${valueOrUnknown(vm?.machineType?.split('/').pop())}\`
- Confidential Compute type: \`${valueOrUnknown(confidential.confidentialInstanceType)}\`
- CPU platform: \`${valueOrUnknown(vm?.cpuPlatform)}\`
- Service account: \`${valueOrUnknown(runtimeSa)}\`
- Internal IP: \`${valueOrUnknown(vmInterface.networkIP)}\`
- External IP: \`${valueOrUnknown(vmAccess.natIP)}\`
- Network tag: \`${valueOrUnknown(vm?.tags?.items?.join(', '))}\`
- Shielded Secure Boot: \`${bool(shielded.enableSecureBoot)}\`
- Shielded vTPM: \`${bool(shielded.enableVtpm)}\`
- Shielded integrity monitoring: \`${bool(shielded.enableIntegrityMonitoring)}\`

The VM runs both containers on localhost:

- Control plane: \`127.0.0.1:3001\`
- Secure executor: \`127.0.0.1:3002\`

## Network

- VPC: \`${valueOrUnknown(vpc?.name)}\`
- Subnet mode: \`${valueOrUnknown(vpc?.x_gcloud_subnet_mode || (vpc?.autoCreateSubnetworks === false ? 'CUSTOM' : 'AUTO'))}\`
- Routing mode: \`${valueOrUnknown(vpc?.routingConfig?.routingMode)}\`
- Subnet: \`vaultproof-enterprise-us-central1\`
- Subnet range: \`10.60.0.0/24\`
- IAP SSH firewall: \`${valueOrUnknown(fw?.name)}\`
- IAP SSH source range: \`${valueOrUnknown(fw?.sourceRanges?.join(', '))}\`
- IAP SSH target tags: \`${valueOrUnknown(fw?.targetTags?.join(', '))}\`
- Public HTTP/HTTPS ingress: not open
- DNS cutover: \`${edgeDnsPointsAtGcp ? 'done' : 'not done'}\`

## Public Edge

- Domain: \`${edgeDomain}\`
- DNS authority: Cloudflare nameservers observed for \`vaultproof.dev\`; Cloud DNS is not authoritative today.
- Edge build status: \`${edgeRule ? 'built' : 'not built'}\`
- Global IP resource: \`${valueOrUnknown(edgeAddress?.name)}\`
- Global IP address: \`${valueOrUnknown(edgeAddress?.address)}\`
- HTTPS forwarding rule: \`${valueOrUnknown(edgeRule?.name)}\`
- HTTPS forwarding IP: \`${valueOrUnknown(edgeRule?.IPAddress)}\`
- HTTPS forwarding port range: \`${valueOrUnknown(edgeRule?.portRange)}\`
- Backend service: \`${valueOrUnknown(edgeBackend?.name)}\`
- Backend protocol: \`${valueOrUnknown(edgeBackend?.protocol)}\`
- Backend port name: \`${valueOrUnknown(edgeBackend?.portName)}\`
- Backend logging enabled: \`${bool(edgeBackend?.logConfig?.enable)}\`
- Backend custom headers configured: \`${edgeBackend?.customRequestHeaders?.length ? 'true' : 'false'}\`
- Cloud Armor policy: \`${edgeBackend?.securityPolicy ? edgeSecurityPolicy : 'none'}\`
- Cloud Armor expected rules ready: \`${bool(cloudArmorRulesReady)}\`
- Backend health: \`${valueOrUnknown(edgeHealthStates.join(', '))}\`
- Instance group: \`${valueOrUnknown(edgeIg?.name)}\`
- Health check: \`${valueOrUnknown(edgeHc?.name)}\`
- Health check host: \`${valueOrUnknown(edgeHc?.httpHealthCheck?.host)}\`
- Health check path: \`${valueOrUnknown(edgeHc?.httpHealthCheck?.requestPath)}\`
- Health check port: \`${valueOrUnknown(edgeHc?.httpHealthCheck?.port)}\`
- SSL certificate: \`${valueOrUnknown(edgeCert?.name)}\`
- SSL certificate status: \`${valueOrUnknown(edgeCert?.managed?.status)}\`
- SSL certificate domain status: \`${valueOrUnknown(edgeCertDomainStatus)}\`
- SSL certificate domains: \`${valueOrUnknown(edgeCert?.managed?.domains?.join(', '))}\`
- Load-balancer firewall: \`${valueOrUnknown(edgeFw?.name)}\`
- Load-balancer firewall source ranges: \`${valueOrUnknown(edgeFw?.sourceRanges?.join(', '))}\`
- Observed DNS A records: \`${valueOrUnknown(edgeDnsA.join(', '))}\`
- DNS cutover: \`${edgeDnsPointsAtGcp ? 'done; Cloudflare enterprise A record points at the GCP global IP' : 'not done until Cloudflare enterprise A record points at the GCP global IP'}\`

## KMS

- Key ring: \`projects/${projectId}/locations/${location}/keyRings/${keyRing}\`
- KMS key: \`${valueOrUnknown(kms?.name)}\`
- Purpose: \`${valueOrUnknown(kms?.purpose)}\`
- Primary version: \`${valueOrUnknown(kms?.primary?.name?.split('/').pop())}\`
- Primary state: \`${valueOrUnknown(kms?.primary?.state)}\`
- Protection level: \`${valueOrUnknown(kms?.primary?.protectionLevel)}\`
- Algorithm: \`${valueOrUnknown(kms?.primary?.algorithm)}\`

The executor service account has decrypt access on this key. Raw key material is not exportable from Cloud KMS.

## Service Accounts

${markdownList(serviceAccounts
  .filter((account) => account.email?.includes('vaultproof'))
  .map((account) => `\`${account.email}\` - ${account.displayName || 'no display name'}`))}

## Secret Manager

${markdownList(secrets.map((secret) => `\`${secret.name?.split('/').pop()}\``))}

Expected runtime env secret containers:

- \`enterprise-control-plane-env\`
- \`enterprise-secure-executor-env\`

${secretVersionStatus}

## Current Readiness

Current runtime status:

${markdownList(readinessStatusLines)}

Known blockers:

${markdownList(knownBlockers)}

## Verification Commands

\`\`\`bash
gcloud compute ssh ${vmName} \\
  --zone=${zone} \\
  --project=${projectId} \\
  --tunnel-through-iap \\
  --command='curl -sS http://127.0.0.1:3002/health; echo; curl -sS -H "Host: enterprise.vaultproof.dev" http://127.0.0.1:3001/readiness; echo'
\`\`\`

\`\`\`bash
gcloud artifacts docker images list ${registry} \\
  --include-tags \\
  --project=${projectId}
\`\`\`

## Update Rule

- This file updates automatically after \`npm run build:gcp-enterprise-images\`.
- Infrastructure changes must also update this file in the same PR or run.
- Feature changes should update \`docs/enterprise/gcp-feature-inventory.md\`.
`;

mkdirSync(dirname(buildDocPath), { recursive: true });
writeFileSync(buildDocPath, buildDoc);

const featureDocPath = resolve('docs/enterprise/gcp-feature-inventory.md');
const markerStart = '<!-- gcp-build-marker:start -->';
const markerEnd = '<!-- gcp-build-marker:end -->';
const markerBlock = `${markerStart}
Last validated GCP image build: \`${buildTag}\`

- Control plane digest: \`${valueOrUnknown(controlImage?.version)}\`
- Executor digest: \`${valueOrUnknown(executorImage?.version)}\`
- Updated: ${new Date().toISOString()}
${markerEnd}`;

try {
  const current = readFileSync(featureDocPath, 'utf8');
  const next = current.includes(markerStart) && current.includes(markerEnd)
    ? current.replace(new RegExp(`${markerStart}[\\s\\S]*?${markerEnd}`), markerBlock)
    : `${current.trim()}\n\n${markerBlock}\n`;
  writeFileSync(featureDocPath, next);
} catch {
  // The feature inventory is usually committed as a hand-authored document.
}

console.log(`Updated ${buildDocPath}`);
console.log(`Refreshed GCP build marker in ${featureDocPath}`);
