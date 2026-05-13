# VaultProof Enterprise Features And Access Guide

Last updated: 2026-05-12

This guide explains what has been built for VaultProof Enterprise, where to access it, and which operator commands verify the production-confidential path.

## Short Version

VaultProof Enterprise is a separate GCP-hosted demo product path at:

- Public homepage: `https://enterprise.vaultproof.dev`
- Enterprise login: `https://enterprise.vaultproof.dev/app/login`
- Enterprise dashboard: `https://enterprise.vaultproof.dev/app/dashboard`
- Production readiness: `https://enterprise.vaultproof.dev/readiness`

Dashboard user guide:

- `docs/enterprise/dashboard-usage-guide.md`

Customer operating guide:

- `docs/enterprise/customer-operating-guide.md`

Technical implementation guide:

- `docs/enterprise/technical-implementation-guide.md`

Paid customer dedicated environment runbook:

- `docs/enterprise/paid-customer-dedicated-environment-runbook.md`

The enterprise product is served by the GCP enterprise control plane and backed by `/api/v1/enterprise/*`.

## Which Enterprise Doc To Use

| Document | Best For | Use It When |
| --- | --- | --- |
| `docs/enterprise/customer-operating-guide.md` | Customer admins, business owners, security owners, app teams, identity teams, platform teams. | You need to understand how a business should use VaultProof Enterprise day to day. |
| `docs/enterprise/dashboard-usage-guide.md` | Dashboard users. | You need step-by-step instructions for using the pages in the enterprise dashboard. |
| `docs/enterprise/technical-implementation-guide.md` | Technical reviewers, architects, network/platform/identity/security teams. | You need architecture, trust boundaries, identity, gateway, key custody, attestation, rollout, or troubleshooting detail. |
| `docs/enterprise/paid-customer-dedicated-environment-runbook.md` | VaultProof operators and customer onboarding owners. | A demo converts to paid, or a customer needs a dedicated runtime, database, SSO, gateway, monitoring, and evidence boundary. |
| `docs/enterprise/features-and-access-guide.md` | VaultProof team, customer reviewers, handoff packages. | You need the full list of built features, URLs, hardening, and operator commands. |

The current production-confidential runtime is:

```text
enterprise.vaultproof.dev
  -> Cloudflare DNS
  -> GCP global HTTPS load balancer
  -> Enterprise control plane on GCP Confidential VM
  -> signed loopback handoff
  -> secure executor on the same GCP Confidential VM
  -> Google Cloud KMS unwrap after runtime readiness checks
  -> upstream provider call without returning provider keys
```

## Login And Accounts

Use:

```text
https://enterprise.vaultproof.dev/app/login
```

Enterprise login is invite/admin oriented. The login page intentionally does not expose open self-serve account creation.

Supported access paths:

- Email/password through Supabase Auth for current demo/admin testing.
- Microsoft Entra ID SSO through Supabase Auth SAML for customer-facing SSO.
- Pending invitation acceptance for users invited into an enterprise organization.

Demo account:

- Email: `enterprise-demo+test@vaultproof.dev`
- Password: use the current temporary password from the secure operator notes or reset it. Do not commit demo passwords into docs, scripts, or git history.

If you see an auth message:

- Friendly UI/API message: `Not authenticated. Sign in to VaultProof Enterprise.`
- Fix: sign in again at `/app/login`.

## Enterprise Pages

| Page | URL | What It Does |
| --- | --- | --- |
| Homepage | `https://enterprise.vaultproof.dev/` | Public enterprise landing page with the product story, architecture, proof points, and CTAs. |
| Login | `/app/login` | Enterprise-only login, SSO start, password reset, and approved access messaging. |
| Dashboard | `/app/dashboard` | Business-ready enterprise command center with sidebar navigation, Overview/Security/Access/Operations/Workspace tabs, runtime posture, org summary, project health, members/access, audit, recent activity, and a workspace tools map. |
| Setup Guide | `/app/setup` | Enterprise implementation guide for purchased workspaces, covering environment mapping, Entra SSO, members, gateway choices, projects, provider slots, policy, evidence, alerts, go-live, and operations. |
| Technical Guide | `/app/technical-guide` | Detailed implementation reference for identity, network patterns, project modeling, caller lock, provider key custody, GCP runtime posture, evidence, alerts, rollout, and troubleshooting. |
| Control | `/app/control` | Project policy, provider overrides, incoming invites, export summaries, and secure execution posture. |
| AI Proof Verifier | `/app/verifier` | Register external AI/ML models, verify submitted proof bundles, and store evidence without VaultProof running the model. |
| Organization + SSO | `/app/org` | Organization settings and Microsoft Entra/Supabase SAML SSO rollout controls. |
| Members | `/app/members` | Members, pending invites, expanded IAM roles, project-specific roles, invite create/revoke, project assignment/removal, and access-review links. |
| Audit | `/app/audit` | Governance/runtime timeline, CSV export, search, filters, and evidence-friendly event details. |
| Alerts | `/app/alerts` | Alert destinations, delivery logs, dispatch runs, policy status, and admin test-send workflow. |
| Activity | `/app/activity` | Runtime proxy/executor events, status codes, latency, provider request IDs, and attestation summaries. |
| Projects | `/app/projects` | Project inventory, project health, provider slots, policy status, and quick links into Control. |
| Provider Slots | `/app/keys` | Active providers, emergency revoke, rotation checklist, and Secure Key Release notes. |
| Settings | `/app/settings` | Tenant preferences, session/security notices, and org defaults. |
| Plans | `/app/plans` | Paid-pilot package, included controls, capacity envelope, contract guardrails, security boundaries, rollout posture, and customer review links. |
| Scanner | `/app/scanner` | Placeholder entry for future enterprise-safe repository/security scanning integration. |
| Runbooks | `/app/runbooks` | Operator guide for production verification, evidence capture, deployment, secret checks, DNS/edge checks, SSH hardening, and cleanup. |

## VaultProof AI Proof Verifier

VaultProof AI Proof Verifier is the verifiable AI/ML evidence layer. VaultProof does not run the model. The model runs in the customer's app, provider environment, partner prover, or another approved external path. VaultProof verifies the submitted proof bundle or attestation record, then stores the result as enterprise evidence tied to the organization, project, actor, model, verifier version, timestamp, and confidential-runtime posture.

For demos, AI Proof Verifier uses shared enterprise runtime attestation language from the production-ready GCP Confidential VM readiness path. It does not mean VaultProof ran the model, and it does not create a fake or static attestation token.

The broader enterprise demo environment should also run as shared demo infrastructure. Use `ENTERPRISE_RUNTIME_TIER=shared-demo` for the shared demo control plane, reuse one shared confidential runtime when live attestation is needed, and keep per-customer dedicated runtime, monitoring, database, SSO, and gateway stacks for paid production or high-trust pilots only.

What it does:

- Verifies that an AI/ML computation produced the claimed output without requiring the reviewer to rerun the model.
- Keeps raw model inputs and provider material out of ordinary dashboard views.
- Stores the verifier decision, proof metadata, policy decision, and export history in the enterprise audit/evidence path.
- Shows the operational status in `/app/verifier`.
- Keeps managed proving and model hosting out of scope.

How VaultProof improves the baseline proof-compute pattern:

- GCP confidential binding: attach runtime readiness, Cloud KMS posture, build digest, and enterprise evidence metadata to compute evidence.
- Demo-safe shared attestation: demos reuse the shared enterprise runtime attestation mode, while customer model execution and private inputs stay outside VaultProof.
- Enterprise policy: require org/project RBAC, caller lock, allowed model IDs, verifier version pinning, rate limits, and export permissions.
- Evidence workflow: connect proof verification to Audit, Activity, access reviews, handoff packages, and production-readiness checks.
- Safer rollout: keep the product verifier-only. Customer systems run models; VaultProof verifies submitted proof evidence and records the decision.

## Enterprise IAM Roles

Organization roles are for workspace-wide responsibility:

| Role | What It Can Do |
| --- | --- |
| Owner | Full workspace control, ownership transfer, archive/restore, and break-glass decisions. |
| Admin | Legacy broad admin. Keep for compatibility; prefer narrower roles for new users. |
| IAM Admin | Invites users, changes roles, assigns project access, manages SSO setup, and exports access reviews. |
| Security Admin | Manages security posture, provider slot controls, alerts, evidence, and security operations across projects. |
| Platform Admin | Manages runtime/gateway operations, DNS/TLS rollout, project policy, and production runbooks. |
| Developer | Works on assigned projects only. |
| Auditor | Read-only evidence, audit, readiness, and access-review visibility. |
| Member | Legacy contributor. Prefer `Developer` for new users. |
| Viewer | Read-only dashboard visibility. |

Project roles are for one project at a time:

| Role | What It Can Do |
| --- | --- |
| Project Owner / Project Admin | Project policy, provider slots, execution, and project evidence. |
| Operator | Approved execution and activity review without policy/provider-slot changes. |
| Developer | Integration and test execution without policy/provider-slot changes. |
| Auditor | Read-only project evidence and activity. |
| Viewer | Read-only project summary visibility. |

## VaultProof Employee Admin Console

This is separate from the customer dashboard and must not be exposed through `enterprise.vaultproof.dev`. The current internal-admin code remains in the enterprise control-plane package for local/explicit staff-system wiring, but the GCP enterprise runtime no longer defaults to `admin.vaultproof.dev`.

| Surface | URL | What It Does |
| --- | --- | --- |
| Root/B2C admin system | `vaultproof.dev` admin pages | VaultProof staff/admin belongs to the separate B2C/root system. It should manage B2C users and staff-only enterprise account operations without turning `enterprise.vaultproof.dev` into an employee console. |
| Internal admin API | `/api/v1/internal-admin/overview` | Opt-in staff API code path for future explicit wiring. Requires a Supabase user session plus explicit employee email/domain allowlist. The browser never receives the Supabase service-role key. Successful overview views are written to the internal admin audit stream. |
| Internal org detail | `/api/v1/internal-admin/orgs/<organization-id>` | Business detail for member timeline, SSO setup checklist, support notes, active projects, customer audit, destructive action approvals, execution/rollback plans, and evidence links back to the enterprise dashboard. The page includes approval-gated staff forms for SSO metadata, invitations, business/account status, support notes, and invite resend/revoke requests. Detail views are audit logged. |
| Internal SSO settings | `/api/v1/internal-admin/orgs/<organization-id>/sso-settings` | Approval-gated employee action for setting enterprise SSO metadata: company domain, provider label, login mode, and rollout status. It does not accept OAuth client secrets, SAML metadata XML, certificates, or IdP private material. Successful changes are written to both organization audit and internal admin audit. |
| Internal invitation actions | `/api/v1/internal-admin/orgs/<organization-id>/invitations` and `/api/v1/internal-admin/orgs/<organization-id>/invitations/<invitation-id>/(resend|revoke)` | Approval-gated employee actions for creating an invite, recording a resend request, and revoking a pending invite. Resend is audit/request-only until email delivery tooling is wired. |
| Internal business status | `/api/v1/internal-admin/orgs/<organization-id>/status` | Approval-gated employee status history for onboarding, active, at-risk, paused, and offboarding states. This tracks VaultProof support posture without mutating customer organization records. |
| Internal destructive action requests | `/api/v1/internal-admin/orgs/<organization-id>/action-requests` and `/api/v1/internal-admin/action-requests/<request-id>/(approve|reject)` | Approval-request workflow for dangerous actions such as `disable_org_access`. Requests require customer authorization, rollback owner, rollback plan, and break-glass reason evidence. A requester cannot approve their own request. Execution remains disabled until live rollback controls are finalized. |
| Internal destructive execution plans | `/api/v1/internal-admin/action-requests/<request-id>/execute-plan` | Approval-gated dry-run execution planner for approved destructive requests. Captures preflight checks and rollback payload without changing customer organization records. |
| Internal destructive rollback plans | `/api/v1/internal-admin/action-execution-records/<execution-record-id>/rollback-plan` | Approval-gated dry-run rollback planner for destructive execution records. Reads the stored rollback payload, records a rollback plan, and audits the event without changing customer organization records. |
| Internal admin audit table | `public.internal_admin_audit_events` | Service-role-only employee audit stream for internal admin page views and future admin actions. Customer sessions and normal authenticated users do not receive table access. |
| Internal support notes table | `public.internal_admin_support_notes` | Service-role-only support notes for the org detail page. Note creation is available only when internal admin write actions are enabled and the approval secret header is provided. |
| Internal business status table | `public.internal_admin_business_status_updates` | Service-role-only business status history for VaultProof employee onboarding/support tracking. |
| Internal action request table | `public.internal_admin_action_requests` | Service-role-only approval ledger for destructive actions. Stores requester, second-employee decision, risk level, status, reason, and requested payload. |
| Internal execution record table | `public.internal_admin_action_execution_records` | Service-role-only execution/rollback ledger. Current endpoint writes dry-run records only, including preflight result and rollback payload. |

Required environment before explicitly wiring this code into a staff system:

- `VAULTPROOF_INTERNAL_ADMIN_HOSTNAME=<explicit staff/admin host>`
- `VAULTPROOF_INTERNAL_ADMIN_EMAILS=employee@vaultproof.dev,...` or `VAULTPROOF_INTERNAL_ADMIN_DOMAINS=vaultproof.dev`
- Optional write-action gate: `VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED=true`
- Optional write-action approval secret: `VAULTPROOF_INTERNAL_ADMIN_APPROVAL_SECRET=<strong-random-secret>`
- Staff/admin routing must stay outside `enterprise.vaultproof.dev`.
- Supabase migration `20260501000000_internal_admin_audit_events.sql` applied before relying on durable employee access audit history.
- Supabase migration `20260501001000_internal_admin_support_notes.sql` applied before relying on internal support notes.
- Supabase migration `20260501002000_internal_admin_business_status_updates.sql` applied before relying on internal business status history.
- Supabase migration `20260501003000_internal_admin_action_requests.sql` applied before relying on destructive-action approval history.
- Supabase migration `20260501004000_internal_admin_action_execution_records.sql` applied before relying on destructive-action execution/rollback planning.

Keep `VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED=false` until VaultProof is ready to operate approval-gated employee write actions live.

Before exposing any staff-admin host, run:

```bash
VAULTPROOF_INTERNAL_ADMIN_EMAILS='employee@vaultproof.dev' \
SUPABASE_URL='https://<project>.supabase.co' \
SUPABASE_SERVICE_ROLE_KEY='<service-role-key>' \
npm run prepare:enterprise-internal-admin
```

This is read-only. It checks employee allowlist env, the required internal-admin/verifier tables, customer-host separation, the exact unauthenticated employee-login redirect, and internal-admin API auth behavior. The expected enterprise-host result remains `404` for `/api/v1/internal-admin/*`.

Support notes, invitation create/resend-request/revoke, and business status updates are approval-gated write actions. Leave `VAULTPROOF_INTERNAL_ADMIN_ACTIONS_ENABLED` unset or `false` in production until the team is ready to operate employee writes. Every future write action should insert into `internal_admin_audit_events`.

For destructive actions, use the action-request workflow first. `disable_org_access` can be requested only with customer authorization, rollback owner, rollback plan, and break-glass reason evidence; it can then be approved, rejected, dry-run planned, and rollback dry-run planned. The execution dry-run records current organization archive fields as rollback payload. The rollback dry-run reads that payload and records what would be restored. Neither endpoint mutates customer organization records in the current internal admin API.

## Security Features Built

### Confidential Runtime

- Azure Confidential VM is deployed in `eastus`.
- VM security profile verifies as `ConfidentialVM`.
- Secure Boot is enabled.
- vTPM is enabled.
- The control plane and secure executor run as separate systemd services on the VM.
- The control plane calls the executor over loopback with signed execution envelopes.
- The executor is not publicly reachable.

### Secure Key Release

- Shared-demo Secure Key Release now uses Azure Key Vault Premium.
- The old Azure Managed HSM is no longer the active shared-demo release-key backend and has been deleted from the active resource list.
- Immediate Managed HSM purge was blocked by purge protection; Azure reports scheduled purge at `2026-07-30T08:06:41Z`.
- Use a fresh Managed HSM only for a dedicated regulated/high-trust customer that requires that boundary.
- Secure Key Release is wired to Microsoft Azure Attestation evidence.
- Current implementation uses an exportable `RSA-HSM` release-root key and derives AES-256 unwrap material inside the Confidential VM.
- This is intentional because Azure rejects generated symmetric `oct-HSM` keys for export/release in the SKR path.
- The control plane never receives unwrap key material.
- The executor caches released unwrap material only in process memory with a short TTL.
- Production readiness fails closed if Secure Key Release or attestation evidence is incomplete.

### Encrypted Provider Key Storage

- Enterprise provider key rows use encrypted `share1_encrypted` and `share2_encrypted`.
- The old `share2_b64` path is not used for enterprise.
- Plain provider keys are reconstructed only inside confidential execution memory.
- Provider keys are not returned to clients.
- Provider keys are not logged in audit events.
- Provider key plaintext is zeroed after use.

### Request Signing And Replay Protection

- Control plane signs secure execution envelopes with a configured executor signing key.
- Executor verifies signed envelopes.
- Replay protection blocks reused request IDs/nonces.
- Execution envelopes include caller-lock metadata.

### Caller Lock And Policy Controls

Enterprise caller lock can restrict execution by:

- Browser `Origin` or fallback `Referer`.
- Customer gateway marker, such as `x-vaultproof-customer-gateway`.
- Client class: browser, server, device, IoT, gateway.
- Device identity hash.
- Fleet ID.
- Firmware version.
- IPv4/IPv6 CIDR.
- mTLS certificate thumbprint.
- mTLS certificate subject fragment.
- Provider allowlist.
- HTTP method allowlist.
- Upstream host allowlist.
- Upstream path-prefix allowlist.
- Per-project and per-provider rate limits.
- Provider-specific stricter overrides.

Policy editing is available in `/app/control`.

### mTLS Caller-Lock Preparation

The control plane can already require an approved client certificate identity before it signs a secure execution envelope. The gateway, usually VaultProof APIM or a customer-managed APIM, must validate mTLS first and then forward trusted certificate metadata to the control plane.

Use the read-only helper to plan the policy:

```bash
npm run prepare:enterprise-mtls
```

When you have the customer or gateway client certificate:

```bash
CLIENT_CERT_FILE=/path/to/client-cert.pem \
CLIENT_CLASS=gateway \
CUSTOMER_GATEWAY=customer-apim \
PROJECT_ID='<project-id>' \
npm run prepare:enterprise-mtls
```

This prints the normalized certificate thumbprint, subject fragment, APIM header contract, and a `caller_lock_policy` JSON snippet for `allowed_client_certificate_thumbprints` and `allowed_client_certificate_subjects`. It does not change APIM, Supabase, project policy, or live traffic.

For a customer-owned APIM gateway that terminates mTLS, start from:

```text
docs/enterprise/customer-managed-apim-mtls-policy.xml
```

This template validates the presented client certificate, strips spoofable VaultProof caller-lock headers from the inbound request, sets trusted certificate metadata from `context.Request.Certificate`, preserves `Authorization` for VaultProof org/project auth, and forwards to `https://enterprise.vaultproof.dev`.

### Emergency Revoke

Enterprise admins can revoke provider slots.

Revoked provider slots:

- Are excluded from future secure execution dispatch.
- Remain visible in audit/history.
- Do not decrypt or expose the provider secret during revoke.

## Enterprise Hardening Built

The enterprise path now has hardening at four layers:

```text
Internet edge
  -> Azure Front Door origin controls
  -> optional APIM governance gateway
  -> Confidential VM control plane
  -> signed loopback executor handoff
  -> Azure Secure Key Release after attestation
```

### Hardening Dashboard And One-Command Status

Access:

```text
https://enterprise.vaultproof.dev/app/runbooks
```

Primary read-only command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
MONITORING_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-monitoring \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run status:enterprise-hardening
```

What it checks:

- Production verifier for Front Door, APIM sidecar, monitoring, NSG posture, Confidential VM, executor, and readiness.
- TLS-origin preparation plan for DNS, NSG `443`, and APIM backend changes.
- TLS-origin readiness preflight.
- APIM cutover plan.
- SSH bootstrap hardening plan.
- Old Container Apps prototype inventory.

Current live result:

- Production verifier passes.
- APIM plan passes as a read-only plan.
- SSH hardening plan passes as a read-only plan.
- Container Apps inventory passes.
- TLS-origin readiness is the remaining attention item because public DNS, trusted certificate, and NSG `443` are not fully cut over yet.

### Front Door And Origin Hardening

Built:

- `enterprise.vaultproof.dev` is routed through Azure Front Door.
- The enterprise control plane requires Azure Front Door ID origin lock.
- Direct public origin access is blocked before the app layer.
- Private/non-loopback origin requests without the Front Door ID are rejected with `403`.
- The VM executor port is not publicly exposed.
- Control-plane ingress on port `3001` is restricted by NSG rules instead of broad Internet access.

### Browser And Dashboard Hardening

Built:

- Enterprise control-plane HTML responses include nonce-based Content Security Policy.
- Enterprise pages deny framing through CSP `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
- Enterprise responses include `X-Content-Type-Options: nosniff`, HSTS, strict referrer policy, and restrictive permissions policy.
- Employee-only executive workspace and internal finance APIs require a valid Supabase session plus an explicit VaultProof employee allowlist.
- Employee/domain allowlists ignore broad public domains such as `gmail.com`; public-domain accounts must be allowlisted by exact email.
- Token-bearing dashboard UI escapes project, scanner alert, and activity data before rendering into HTML.

Required environment for the employee-only dashboard APIs:

```bash
DASHBOARD_INTERNAL_ALLOWED_EMAILS=employee@vaultproof.dev,...
# Optional for a company-owned domain only:
DASHBOARD_INTERNAL_ALLOWED_DOMAINS=vaultproof.dev
```

Access and verification:

```bash
EXPECTED_MONITORING_DEPLOYED=true \
EXPECTED_APIM_DEPLOYED=true \
npm run verify:enterprise-production
```

Current status:

- Active Front Door origin points to the Confidential VM.
- Front Door still forwards to the VM origin over `HttpOnly` while TLS origin cutover is pending.

### Private Origin Hardening

Built:

- Read-only private-origin preparation helper inventories Front Door SKU/origins, APIM gateway/backend/network posture, Confidential VM IP/subnets, and watched public ingress rules.
- The helper documents both supported migration tracks: Front Door Premium to APIM over Private Link, or Front Door Premium to an internal load balancer through a Private Link service.
- The helper flags key blockers such as non-Premium Front Door profiles and mixed public/private origins in a single origin group.

Plan command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
FRONT_DOOR_PROFILE=vaultproof-enterprise-fd \
npm run prepare:enterprise-private-origin
```

Current status:

- Current production path still uses public Front Door to VM origin with NSG service tags and Front Door ID origin lock.
- Private-origin migration remains a planned hardening step after TLS/APIM readiness decisions.

### TLS Origin Hardening

Built:

- VM-local nginx TLS proxy installer exists.
- The TLS proxy is installed on the Confidential VM.
- Origin certificate helper exists for VM-generated CSR, CA-signed certificate install, self-signed marker cleanup, and VM-local TLS health checks.
- TLS origin cutover helper exists for plan, confirmation-gated enable, strict preflight, and confirmation-gated rollback.
- TLS origin preparation helper exists for DNS/NSG/APIM backend planning and guarded Azure-side prep.
- Read-only TLS readiness preflight exists and is exposed in runbooks.
- Production verifier can validate TLS-origin posture when `ORIGIN_TLS_HOSTNAME` is enabled.

Certificate plan:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run prepare:enterprise-origin-cert
```

Certificate actions:

- `ACTION=generate-csr CONFIRM_ORIGIN_TLS_CERT=generate-origin-csr npm run prepare:enterprise-origin-cert`
- `ACTION=install LOCAL_CERT_FILE=/path/to/fullchain.pem CONFIRM_ORIGIN_TLS_CERT=install-origin-cert npm run prepare:enterprise-origin-cert`
- `ACTION=install LOCAL_CERT_FILE=/path/to/fullchain.pem LOCAL_KEY_FILE=/path/to/privkey.pem CONFIRM_ORIGIN_TLS_CERT=install-origin-cert npm run prepare:enterprise-origin-cert`
- `ACTION=check npm run prepare:enterprise-origin-cert`

Preparation plan:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run prepare:enterprise-origin-tls
```

Guarded prep actions:

- `ACTION=upsert-origin-dns CONFIRM_ORIGIN_TLS_PREP=create-origin-dns-record npm run prepare:enterprise-origin-tls`
- `ACTION=remove-origin-dns CONFIRM_ORIGIN_TLS_PREP=remove-origin-dns-record npm run prepare:enterprise-origin-tls`
- `ACTION=enable-nsg443 CONFIRM_ORIGIN_TLS_PREP=open-origin-443 npm run prepare:enterprise-origin-tls`
- `ACTION=disable-nsg443 CONFIRM_ORIGIN_TLS_PREP=close-origin-443 npm run prepare:enterprise-origin-tls`
- `ACTION=update-apim-backend-https CONFIRM_ORIGIN_TLS_PREP=point-apim-to-origin-tls npm run prepare:enterprise-origin-tls`
- `ACTION=rollback-apim-backend-http CONFIRM_ORIGIN_TLS_PREP=rollback-apim-backend-http npm run prepare:enterprise-origin-tls`

The DNS actions work only when the DNS zone is hosted in Azure DNS for the current subscription or when `DNS_ZONE_NAME` and `DNS_RESOURCE_GROUP` point at the real Azure DNS zone. Current shared-demo discovery reports that `vaultproof.dev` is not hosted in this Azure subscription, so `origin.enterprise.vaultproof.dev -> 20.85.214.14` must be created at the external DNS provider first.

Readiness command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run verify:enterprise-origin-tls
```

Cutover plan:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run cutover:enterprise-origin-tls
```

Guarded cutover actions:

- `ACTION=enable CONFIRM_ORIGIN_TLS_CUTOVER=enable-origin-https RUN_VERIFIER=true npm run cutover:enterprise-origin-tls`
- `ACTION=rollback CONFIRM_ORIGIN_TLS_CUTOVER=rollback-origin-http npm run cutover:enterprise-origin-tls`

Current blockers before enabling `HttpsOnly`:

- `origin.enterprise.vaultproof.dev` needs a public IPv4 DNS record pointing to the Confidential VM origin.
- NSG needs Front Door/service-tag access to port `443`.
- The temporary self-signed origin certificate needs to be replaced with a publicly trusted certificate.
- The self-signed marker at `/etc/vaultproof/tls/origin.self-signed` should be gone before production TLS-origin claims.

### API Management Hardening

Built:

- Azure API Management StandardV2 sidecar is deployed.
- APIM health/readiness routes are verified.
- APIM policies include request-size guards, rate limits, quotas, provider-secret header stripping, spoofable VaultProof caller-lock header stripping, trusted gateway/device/mTLS header re-setting, APIM marker headers, origin-lock forwarding, and App Insights diagnostics.
- Optional JWT validation support exists in IaC/policy.
- APIM JWT validation preparation helper exists for Supabase-session or direct-Entra token paths before enabling `validate-jwt`.
- APIM Front Door cutover helper exists for plan, confirmation-gated enable, and confirmation-gated rollback.

Access:

```text
https://vpenteuutf4ahzja5l3oapim.azure-api.net/enterprise
```

Plan command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
npm run cutover:enterprise-apim
```

JWT validation plan:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
JWT_PROVIDER=supabase \
SUPABASE_URL='https://<project-ref>.supabase.co' \
npm run prepare:enterprise-apim-jwt
```

If `JWT_PROVIDER=supabase` and `SUPABASE_URL` is not set, the helper tries to discover the public Supabase issuer from `https://enterprise.vaultproof.dev/app/enterprise-login.js`. This is read-only and uses only public auth configuration.

For direct Entra access-token validation:

```bash
JWT_PROVIDER=entra \
ENTRA_TENANT_ID='<tenant-id>' \
JWT_AUDIENCES='["api://vaultproof-enterprise"]' \
npm run prepare:enterprise-apim-jwt
```

Live mutation is guarded. `ACTION=enable` refuses to run unless:

- Enterprise `/readiness` is production-ready.
- APIM `/health` and `/readiness` pass.
- Backend safety checks pass.
- `CONFIRM_APIM_CUTOVER=route-enterprise-through-apim` is set.

Rollback is also guarded:

- `ACTION=rollback CONFIRM_APIM_CUTOVER=rollback-enterprise-to-vm npm run cutover:enterprise-apim`

Current status:

- APIM is deployed and verified as a sidecar.
- APIM is not yet the active Front Door route.
- APIM cutover waits until TLS/private-origin risk is resolved.
- APIM JWT validation remains disabled until the final Supabase-session or direct-Entra issuer/audience decision is confirmed.
- Private-origin preparation tooling now inventories Front Door/APIM/VM network state and documents the APIM Private Link or internal-load-balancer Private Link migration choices.

### Monitoring And Drift Detection

Built:

- Azure Monitor Log Analytics workspace.
- Application Insights component.
- Action group for operations alerting.
- Front Door `/health` availability test.
- Front Door `/readiness` availability test.
- Readiness drift alert that checks for `"production_ready":true`.
- Confidential VM availability alert.

Verify:

```bash
EXPECTED_MONITORING_DEPLOYED=true npm run verify:enterprise-production
```

Why it matters:

- If the live path stops responding, alerts fire.
- If `/readiness` is reachable but no longer production-ready, drift is detected.
- If the Confidential VM becomes unavailable, operators get a VM-specific signal.

### Secret And Runtime Env Hardening

Built:

- Installed env verifier checks control-plane and executor env files.
- Secret rotation preparation helper exists for signing-key generation, install order, and customer-handoff evidence markers.
- Verifier catches missing signing material, Supabase service-role issues, origin-lock misconfiguration, and confidential-mode footguns.
- Confidential mode fails closed if static/demo unwrap key configuration is present.
- Production readiness fails closed if a static `AZURE_ATTESTATION_TOKEN` is configured instead of dynamic guest attestation.

Prepare rotation:

```bash
npm run prepare:enterprise-secret-rotation
```

Generate new executor signing material:

```bash
ACTION=generate-signing-material npm run prepare:enterprise-secret-rotation
```

Verify:

```bash
CONTROL_PLANE_ENV_FILE=/etc/vaultproof/enterprise-control-plane.env \
EXECUTOR_ENV_FILE=/etc/vaultproof/enterprise-secure-executor.env \
npm run verify:enterprise-secrets
```

Current status:

- Verification tooling exists.
- Rotation preparation tooling exists; generated signing material stays in chmod-600 local files and is not printed to stdout.
- Setup-time Supabase/service/signing secrets still need operator rotation before external customer production use.

### SSH Bootstrap Hardening

Built:

- Alternate access preparation helper exists for guarded boot diagnostics and Azure Bastion setup planning.
- Alternate operator access readiness check exists for Bastion, boot diagnostics/serial-console prerequisites, Defender JIT visibility, and the current SSH NSG rule.
- Reversible SSH bootstrap hardening script exists.
- Plan mode shows the current NSG rule and safe next command.
- Close mode requires production readiness, an alternate-access acknowledgment, and `CONFIRM_SSH_LOCKDOWN=close-public-ssh` before setting the SSH bootstrap rule to `Deny`.
- Reopen mode exists for break-glass rollback and requires `CONFIRM_SSH_LOCKDOWN=reopen-public-ssh`.
- Production verifier can assert expected SSH bootstrap access.
- The VM deploy helper runs an SSH preflight before archive/upload and prints the approved reopen/deploy/close/verify sequence when public SSH is locked down.

Alternate access preparation command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
npm run prepare:enterprise-alternate-access
```

Alternate access readiness command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
npm run verify:enterprise-alternate-access
```

SSH hardening plan command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
npm run harden:enterprise-ssh
```

Current status:

- Boot diagnostics is enabled and alternate-access readiness reports a ready break-glass signal.
- Public SSH bootstrap is closed with the NSG rule set to `Deny`.
- Use the break-glass reopen command before SSH-based VM deployments, then close SSH again after verification.
- `npm run deploy:enterprise-vm` now fails fast with operator guidance instead of hanging when SSH is closed. Use `SKIP_SSH_PREFLIGHT=true` only for a verified private SSH path.

### Old Container Apps Cleanup Hardening

Built:

- Inventory command lists old Container Apps, revisions, ingress, scale, environment, ACR, and Front Door origin state.
- Disable-ingress action exists for reversible cleanup.
- Delete actions exist for apps, environment, and ACR.
- Restore-ingress action exists for rollback while apps still exist.
- Disable/delete actions require production readiness, confirmation phrases, and refuse to run if Front Door still has an enabled Container Apps origin.
- Restore-ingress requires a confirmation phrase because it reopens the prototype public path.

Inventory command:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
npm run cleanup:enterprise-container-apps
```

Guarded actions:

- `ACTION=disable-ingress CONFIRM_CONTAINER_APPS_CLEANUP=disable-prototype-ingress npm run cleanup:enterprise-container-apps`
- `ACTION=restore-ingress CONFIRM_CONTAINER_APPS_CLEANUP=restore-prototype-ingress npm run cleanup:enterprise-container-apps`
- `ACTION=delete-apps CONFIRM_CONTAINER_APPS_CLEANUP=delete-prototype-apps npm run cleanup:enterprise-container-apps`
- `ACTION=delete-environment CONFIRM_CONTAINER_APPS_CLEANUP=delete-prototype-environment npm run cleanup:enterprise-container-apps`
- `ACTION=delete-acr CONFIRM_CONTAINER_APPS_CLEANUP=delete-prototype-acr npm run cleanup:enterprise-container-apps`

Current status:

- Old Container Apps resources still exist.
- Front Door's old Container Apps origin is disabled.
- Both old prototype apps are scaled to `minReplicas=0`.
- Cleanup remains pending explicit operator approval and soak.

### Deployment And QA Hardening

Built:

- `npm run deploy:enterprise-vm` deploys code to the Confidential VM, rebuilds, and restarts selected systemd services.
- Deploy script can restart only the control plane or both control plane and executor.
- Deploy script preflights SSH reachability before packaging/uploading so locked-down public SSH produces actionable guidance instead of a long timeout.
- Live app QA checks enterprise-owned pages and links.
- Enterprise smoke tests cover route rendering and runbook entries.
- Safe execute-path QA defaults to `dry_run` and will not call upstream providers unless explicitly disabled.

Useful commands:

```bash
npm run qa:enterprise-live-app
npm run test:enterprise-control-plane-smoke
printf '%s' "$SUPABASE_ACCESS_TOKEN" | npm run qa:enterprise-live-execute
```

Real provider dispatch requires:

```bash
EXECUTE_DRY_RUN=false printf '%s' "$SUPABASE_ACCESS_TOKEN" | npm run qa:enterprise-live-execute
```

Do not use real dispatch unless the selected provider slot is expected to call a real provider API.

### Evidence And Customer Verification Hardening

Built:

- Production evidence collector captures timestamped Azure, app, readiness, monitoring, SSH/local, and Front Door evidence.
- Evidence validator checks production readiness, Confidential VM posture, Front Door origin-lock posture, service health, and obvious secret-shaped material.
- Execution audit metadata includes compact attestation references without logging request bodies or provider keys.
- Audit CSV and SOC 2 access-review exports are available from the enterprise app.

Commands:

```bash
npm run evidence:enterprise-production
npm run validate:enterprise-evidence
```

Customer-verifiable evidence includes:

- Confidential VM resource ID.
- Attestation provider URI.
- Attestation token hash.
- Secure Key Release policy hash.
- Key Vault or Managed HSM key ID and version.
- Executor build digest.
- Azure MAA claim summary.
- Measurement summary.
- Caller-lock decision metadata.

## API Management

Azure API Management is deployed as a verified sidecar:

```text
https://vpenteuutf4ahzja5l3oapim.azure-api.net/enterprise
```

Current APIM capabilities:

- Enterprise API operations for health, readiness, execute, and proxy paths.
- Request-size guard.
- Coarse rate limits and quotas.
- Provider-secret header stripping.
- Spoofable VaultProof caller-lock header stripping before trusted APIM/device/mTLS values are set.
- APIM marker headers.
- APIM origin-lock forwarding.
- App Insights diagnostics.
- Optional JWT validation support in IaC.

Current state:

- APIM is deployed and verified.
- Front Door is not cut over to APIM yet.
- Cutover is intentionally waiting until TLS/private-origin risk is resolved.
- `npm run cutover:enterprise-apim` now previews the APIM route cutover and refuses live Front Door changes unless production readiness, APIM readiness, backend safety, and an explicit confirmation string pass.

Policy files:

- VaultProof-managed APIM: `docs/enterprise/vaultproof-managed-apim-policy.xml`
- Customer-managed APIM: `docs/enterprise/customer-managed-apim-policy.xml`
- Customer device/IoT APIM: `docs/enterprise/customer-managed-apim-device-policy.xml`
- Customer-managed APIM mTLS: `docs/enterprise/customer-managed-apim-mtls-policy.xml`

Policy smoke test:

```bash
npm run test:enterprise-apim-policies
```

This checks provider-secret stripping and verifies every policy deletes caller-supplied VaultProof caller-lock headers before overriding them with trusted APIM, device, or certificate-derived values.

## SSO

Microsoft Entra ID SSO is supported through Supabase Auth SAML.

What that means:

- Customer configures an Entra enterprise application.
- Supabase acts as the SAML broker/session provider.
- VaultProof uses the Supabase session token to authorize enterprise org/project access.
- VaultProof still enforces org membership, project permissions, caller lock, and execution policy.

SSO controls live at:

```text
https://enterprise.vaultproof.dev/app/org
```

SSO behavior:

- Configurable company domain.
- Configurable SSO provider value, currently Microsoft Entra.
- SSO start and completion audit events.
- Existing membership resolves into the org.
- Matching pending invites can be accepted safely.
- Unknown matching-domain users fail closed into pending/no-access rather than broad auto-join.

## Audit, Evidence, And Compliance

### Audit

Access:

```text
https://enterprise.vaultproof.dev/app/audit
```

Built features:

- Governance audit events.
- Runtime/proxy activity.
- CSV export.
- Search and filters.
- Execution result metadata.
- Attestation summary references.
- Caller-lock decision metadata.

### Access Review Evidence

Access:

```text
https://enterprise.vaultproof.dev/app/members
```

Exports include:

- Active organization members.
- Project assignments.
- Pending invitations.
- Reviewer metadata.
- SOC 2 control tags for access review evidence.

### Production Evidence Bundle

Collect evidence:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ENTERPRISE_URL=https://enterprise.vaultproof.dev \
FRONT_DOOR_PROFILE=vaultproof-enterprise-fd \
FRONT_DOOR_ENDPOINT=vaultproof-enterprise \
FRONT_DOOR_ROUTE=default-route \
npm run evidence:enterprise-production
```

Validate the latest evidence bundle:

```bash
npm run validate:enterprise-evidence
```

Validate a specific file:

```bash
npm run validate:enterprise-evidence -- /tmp/vaultproof-production-evidence/<file>.json
```

The validator checks:

- Production readiness is true.
- Security profile is `azure-confidential-production`.
- Executor is reachable and production-ready.
- Azure Confidential VM posture is present.
- Secure Boot and vTPM are enabled.
- Managed identity is present.
- Front Door route is enabled.
- Old Container Apps origin is not enabled in Front Door.
- Direct public VM origin access is blocked.
- Private origin without Front Door ID is rejected.
- No broad public NSG allow exists for port `3001`.
- No obvious secret-shaped material appears in the evidence JSON.

Expected current warning:

- Front Door origin forwarding is still `HttpOnly` until TLS origin cutover is complete.

## QA And Operator Commands

Run these from the repo root.

### Verify live production path

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
MONITORING_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-monitoring \
EXPECTED_APIM_DEPLOYED=true \
EXPECTED_APIM_INGRESS_SOURCE=AzureCloud.eastus \
EXPECTED_MONITORING_DEPLOYED=true \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
ORIGIN_TLS_INSECURE=true \
npm run verify:enterprise-production
```

### QA live enterprise pages

```bash
npm run qa:enterprise-live-app
```

This checks:

- Homepage and `/app/*` pages return 200.
- Enterprise-owned links return 200.
- No `{"error":"Not found"}` pages.
- No cross-product API fallback on enterprise pages.
- `/readiness` remains production-ready.
- `/readiness` is retried briefly to avoid false negatives during transient executor attestation refreshes.

Optional authenticated demo check:

```bash
ENTERPRISE_DEMO_EMAIL='enterprise-demo+test@vaultproof.dev' \
ENTERPRISE_DEMO_PASSWORD='<current-demo-password>' \
npm run qa:enterprise-live-app
```

Do not commit the password.

### Safe execute-path QA

Pass a Supabase access token on stdin:

```bash
printf '%s' "$SUPABASE_ACCESS_TOKEN" | npm run qa:enterprise-live-execute
```

By default this uses dry-run mode.

Dry-run execution:

- Authenticates the user.
- Resolves org/project/provider slot.
- Enforces caller-lock and execution policy.
- Signs the secure-execution envelope.
- Writes validation audit metadata.
- Skips upstream provider dispatch.

Real provider dispatch requires an explicit opt-in:

```bash
EXECUTE_DRY_RUN=false printf '%s' "$SUPABASE_ACCESS_TOKEN" | npm run qa:enterprise-live-execute
```

Only use real dispatch when the selected provider slot is expected to call a real provider API.

### Verify installed secrets posture

```bash
CONTROL_PLANE_ENV_FILE=/etc/vaultproof/enterprise-control-plane.env \
EXECUTOR_ENV_FILE=/etc/vaultproof/enterprise-secure-executor.env \
npm run verify:enterprise-secrets
```

Use this before customer handoff and after rotating setup-time secrets.

### Check Azure hardening status

Read-only finish-line summary:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
MONITORING_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-monitoring \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run status:enterprise-hardening
```

This runs the production verifier, TLS-origin preparation plan, TLS-origin readiness preflight, APIM cutover plan, SSH bootstrap hardening plan, and Container Apps prototype inventory without mutating Azure resources. It defaults the production verifier to the current locked-down SSH posture with `EXPECTED_SSH_BOOTSTRAP_ACCESS=Deny` and `RUN_SSH_CHECKS=false`; override those only while testing a temporary SSH reopen. Set `RUN_LIVE_APP_QA=true` to include the live `/app/*` link/readiness sweep. Set `EXIT_NONZERO_ON_ATTENTION=true` if CI should fail when any enabled step reports blockers or exits nonzero.

### Run the finish gate

Use this when you want the short answer for whether the enterprise build is green, needs attention, or is blocked:

```bash
OUTPUT_DIR=/tmp/vaultproof-enterprise-finish-gate \
npm run gate:enterprise-finish
```

The finish gate runs the enterprise control-plane smoke, APIM policy smoke, handoff gate, live app QA, and read-only hardening status. It returns `ok`, `attention`, or `blocked`, writes `finish-gate-result.json` in the output directory, and lists the named pending actions with the exact `BLOCKER`/`WARN` lines from the hardening summary. Use `STRICT_HARDENING_CLEAR=true` when CI should fail on remaining live cutover/cleanup attention items, and use `REQUIRE_EVIDENCE=true REQUIRE_VALID_EVIDENCE=true STRICT_CUSTOMER_HANDOFF=true` before external customer handoff.

### Build a handoff package

```bash
OUTPUT_DIR=/tmp/vaultproof-enterprise-handoff \
npm run package:enterprise-handoff
```

This creates a local folder with the enterprise features guide, source-of-truth plan, APIM policy templates, secure-runtime runbook, manifest, and latest local production evidence bundle if one exists. It does not call Azure or change live infrastructure.

Run the local handoff gate before sharing the package:

```bash
npm run gate:enterprise-handoff
```

The gate validates APIM policy templates, including provider-secret stripping and caller-lock header delete/override checks, builds the package, and verifies the manifest includes required docs, policy files, and operator commands. Set `REQUIRE_EVIDENCE=true REQUIRE_VALID_EVIDENCE=true RUN_LIVE_APP_QA=true` for a stricter pre-handoff pass.

### Prepare origin TLS cutover

Read-only plan:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run prepare:enterprise-origin-tls
```

This prints the expected DNS record, current DNS records, TLS NSG rule access, current APIM backend URL, and the guarded commands for opening port `443` and pointing APIM at the trusted HTTPS origin.

### Verify origin TLS readiness

Read-only preflight:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
ORIGIN_TLS_HOSTNAME=origin.enterprise.vaultproof.dev \
npm run verify:enterprise-origin-tls
```

This checks DNS, Front Door route state, NSG port 443 from Front Door service tags, nginx, certificate SAN/trust, and VM-local TLS `/health`. It runs in report-only mode by default because the current live path is intentionally still HTTP-to-origin. Set `CUTOVER_READY_REQUIRED=true` when you want TLS blockers to fail the command before an actual cutover.

Report-only mode treats unreachable SSH as a warning because public SSH bootstrap is intentionally closed. Strict cutover mode still treats failed VM-local SSH checks as a blocker unless `RUN_SSH_CHECKS=false` is set after independent VM-local TLS verification.

### Deploy app updates to the Confidential VM

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
RUN_NPM_CI=false \
RUN_BUILD=true \
RESTART_SERVICES='vaultproof-control-plane vaultproof-executor' \
VERIFY_AFTER_DEPLOY=false \
npm run deploy:enterprise-vm
```

For control-plane-only changes:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
RUN_NPM_CI=false \
RUN_BUILD=true \
RESTART_SERVICES='vaultproof-control-plane' \
VERIFY_AFTER_DEPLOY=false \
npm run deploy:enterprise-vm
```

If public SSH bootstrap is locked down, the deploy helper exits before archiving/uploading and prints the temporary reopen flow. The approved sequence is:

```bash
CONFIRM_SSH_LOCKDOWN=reopen-public-ssh ACTION=reopen npm run harden:enterprise-ssh
npm run deploy:enterprise-vm
ALTERNATE_ACCESS_ACK=true CONFIRM_SSH_LOCKDOWN=close-public-ssh ACTION=close npm run harden:enterprise-ssh
EXPECTED_SSH_BOOTSTRAP_ACCESS=Deny RUN_SSH_CHECKS=false npm run verify:enterprise-production
```

### Preview APIM Front Door cutover

Read-only plan:

```bash
RESOURCE_GROUP=vaultproof-enterprise \
DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm \
APIM_DEPLOYMENT_NAME=vp-enterprise-secure-runtime-eastus-hsm-apim \
npm run cutover:enterprise-apim
```

The helper refuses `ACTION=enable` unless production readiness, APIM readiness, backend safety, and `CONFIRM_APIM_CUTOVER=route-enterprise-through-apim` pass. Keep this as a plan-only command until TLS/private-origin risk is resolved.

### Local smoke tests

```bash
npm run test:enterprise-control-plane-smoke
npm run test:enterprise-smoke
```

## Monitoring And Alerts

Azure Monitor/App Insights are deployed and verified.

Monitoring covers:

- Front Door `/health` availability.
- Front Door `/readiness` availability.
- Readiness drift where `production_ready` is not true.
- Confidential VM availability.
- Action group wiring for alerts.

Verifier command:

```bash
EXPECTED_MONITORING_DEPLOYED=true npm run verify:enterprise-production
```

## Current Known Limitations

These are intentionally not finished yet:

- Front Door to VM origin still uses HTTP forwarding. VM-local TLS proxy exists, but public DNS/certificate and Front Door `HttpsOnly` cutover are pending.
- APIM is a verified sidecar, not the active Front Door route.
- Public SSH bootstrap is closed; SSH-based VM deployment requires temporary break-glass reopen through Azure CLI.
- Old Container Apps prototype resources still exist as rollback/legacy inventory until cleanup is approved.
- Setup-time Supabase/service/signing secrets must be rotated before external customer production use.
- Enterprise billing/plan enforcement is still manual.
- Scanner page is an enterprise-safe placeholder until scanner APIs are ready.

## Useful Resource Names

| Resource | Name |
| --- | --- |
| Resource group | `vaultproof-enterprise` |
| Main deployment | `vp-enterprise-secure-runtime-eastus-hsm` |
| Confidential VM | `vpenteu-executor-cvm` |
| Key Vault Premium | `vpenteuutf4ahzja5l3okv` |
| Soft-deleted Managed HSM | `vpenteuutf4ahzja5l3ohsm`, scheduled purge `2026-07-30T08:06:41Z` |
| Attestation provider | `vpenteuutf4ahzja5l3omaa` |
| APIM deployment | `vp-enterprise-secure-runtime-eastus-hsm-apim` |
| APIM gateway | `https://vpenteuutf4ahzja5l3oapim.azure-api.net/enterprise` |
| Monitoring deployment | `vp-enterprise-secure-runtime-eastus-hsm-monitoring` |
| Front Door profile | `vaultproof-enterprise-fd` |
| Front Door endpoint | `vaultproof-enterprise` |

## What To Tell A Customer

Simple explanation:

VaultProof lets a business use API keys without putting those keys inside apps, `.env` files, logs, or devices. The customer app asks VaultProof to make an approved provider call. VaultProof checks policy first. Then a confidential Azure VM reconstructs the key only in protected memory, makes the provider call, and throws the plaintext key away. The customer gets the provider response, not the key.

More technical explanation:

VaultProof Enterprise separates policy from secret use. The Azure control plane authenticates the user, checks org/project/caller policy, and signs a short-lived execution envelope. The secure executor verifies the envelope inside an Azure Confidential VM, obtains unwrap capability through Azure Secure Key Release after Microsoft Azure Attestation succeeds, decrypts the encrypted Shamir shares in memory, calls the upstream provider, and records audit/evidence metadata without exposing provider secrets. Shared demo uses Key Vault Premium SKR; dedicated regulated deployments can use Managed HSM SKR.
