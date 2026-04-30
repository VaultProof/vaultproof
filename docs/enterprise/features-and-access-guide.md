# VaultProof Enterprise Features And Access Guide

Last updated: 2026-04-30

This guide explains what has been built for VaultProof Enterprise, where to access it, and which operator commands verify the production-confidential path.

## Short Version

VaultProof Enterprise is a separate Azure-hosted product path at:

- Public homepage: `https://enterprise.vaultproof.dev`
- Enterprise login: `https://enterprise.vaultproof.dev/app/login`
- Enterprise dashboard: `https://enterprise.vaultproof.dev/app/dashboard`
- Production readiness: `https://enterprise.vaultproof.dev/readiness`

The enterprise path is not the B2C dashboard shell. It is served by the Azure enterprise control plane and backed by `/api/v1/enterprise/*`.

The current production-confidential runtime is:

```text
enterprise.vaultproof.dev
  -> Azure Front Door
  -> Enterprise control plane on Azure Confidential VM
  -> signed loopback handoff
  -> secure executor on the same Azure Confidential VM
  -> Azure Managed HSM Secure Key Release after attestation
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
| Dashboard | `/app/dashboard` | Main enterprise command center with a built-feature map plus runtime posture, org summary, project health, members/access, audit, and recent activity. |
| Control | `/app/control` | Project policy, provider overrides, incoming invites, export summaries, and secure execution posture. |
| Organization + SSO | `/app/org` | Organization settings and Microsoft Entra/Supabase SAML SSO rollout controls. |
| Members | `/app/members` | Members, pending invites, roles, project assignments, invite create/revoke, and access-review links. |
| Audit | `/app/audit` | Governance/runtime timeline, CSV export, search, filters, and evidence-friendly event details. |
| Alerts | `/app/alerts` | Alert destinations, delivery logs, dispatch runs, policy status, and admin test-send workflow. |
| Activity | `/app/activity` | Runtime proxy/executor events, status codes, latency, provider request IDs, and attestation summaries. |
| Projects | `/app/projects` | Project inventory, project health, provider slots, policy status, and quick links into Control. |
| Provider Slots | `/app/keys` | Active providers, emergency revoke, rotation checklist, and Secure Key Release notes. |
| Settings | `/app/settings` | Tenant preferences, session/security notices, and org defaults. |
| Plans | `/app/plans` | APIM/enterprise rollout status, limits, and contract-facing packaging notes. |
| Scanner | `/app/scanner` | Placeholder entry for future enterprise-safe repository/security scanning integration. |
| Runbooks | `/app/runbooks` | Operator guide for production verification, evidence capture, deployment, secret checks, TLS/APIM cutover, SSH hardening, and cleanup. |

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

- Azure Managed HSM is deployed.
- Current decision: keep Managed HSM for the Azure finish pass, then design AWS separately after the Azure path is stable.
- Secure Key Release is wired to Microsoft Azure Attestation evidence.
- Current implementation uses an exportable `RSA-HSM` release-root key and derives AES-256 unwrap material inside the Confidential VM.
- This is intentional because Azure Managed HSM rejects generated symmetric `oct-HSM` keys for export/release.
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
  -> Managed HSM Secure Key Release after attestation
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

- `ACTION=enable-nsg443 CONFIRM_ORIGIN_TLS_PREP=open-origin-443 npm run prepare:enterprise-origin-tls`
- `ACTION=disable-nsg443 CONFIRM_ORIGIN_TLS_PREP=close-origin-443 npm run prepare:enterprise-origin-tls`
- `ACTION=update-apim-backend-https CONFIRM_ORIGIN_TLS_PREP=point-apim-to-origin-tls npm run prepare:enterprise-origin-tls`
- `ACTION=rollback-apim-backend-http CONFIRM_ORIGIN_TLS_PREP=rollback-apim-backend-http npm run prepare:enterprise-origin-tls`

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
- APIM policies include request-size guards, rate limits, quotas, provider-secret header stripping, APIM marker headers, origin-lock forwarding, and App Insights diagnostics.
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

- Public SSH bootstrap remains open for break-glass while alternate access/Bastion/JIT is not finalized.
- Next hardening step is to close it after alternate operator access is confirmed.

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
- Cleanup remains pending explicit operator approval and soak.

### Deployment And QA Hardening

Built:

- `npm run deploy:enterprise-vm` deploys code to the Confidential VM, rebuilds, and restarts selected systemd services.
- Deploy script can restart only the control plane or both control plane and executor.
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
- Managed HSM key ID and version.
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
- No B2C API fallback on enterprise pages.
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

This runs the production verifier, TLS-origin preparation plan, TLS-origin readiness preflight, APIM cutover plan, SSH bootstrap hardening plan, and Container Apps prototype inventory without mutating Azure resources. Set `RUN_LIVE_APP_QA=true` to include the live `/app/*` link/readiness sweep. Set `EXIT_NONZERO_ON_ATTENTION=true` if CI should fail when any enabled step reports blockers or exits nonzero.

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

The gate validates APIM policy templates, builds the package, and verifies the manifest includes required docs, policy files, and operator commands. Set `REQUIRE_EVIDENCE=true REQUIRE_VALID_EVIDENCE=true RUN_LIVE_APP_QA=true` for a stricter pre-handoff pass.

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
- Public SSH bootstrap remains open for break-glass until alternate access or a controlled Bastion/JIT process is ready.
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
| Managed HSM | `vpenteuutf4ahzja5l3ohsm` |
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

VaultProof Enterprise separates policy from secret use. The Azure control plane authenticates the user, checks org/project/caller policy, and signs a short-lived execution envelope. The secure executor verifies the envelope inside an Azure Confidential VM, obtains unwrap capability through Azure Managed HSM Secure Key Release after Microsoft Azure Attestation succeeds, decrypts the encrypted Shamir shares in memory, calls the upstream provider, and records audit/evidence metadata without exposing provider secrets.
