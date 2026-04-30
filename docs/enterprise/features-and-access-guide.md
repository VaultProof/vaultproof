# VaultProof Enterprise Features And Access Guide

Last updated: 2026-04-29

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

### Emergency Revoke

Enterprise admins can revoke provider slots.

Revoked provider slots:

- Are excluded from future secure execution dispatch.
- Remain visible in audit/history.
- Do not decrypt or expose the provider secret during revoke.

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
