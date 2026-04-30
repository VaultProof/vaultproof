# VaultProof Enterprise Most-Secure Build

Status: active - source of truth
Owner: VaultProof enterprise
Last updated: 2026-04-29

## Operating Rule

This file is the single source-of-truth plan for the enterprise most-secure build. Supporting runbooks and implementation notes can live in sub-docs, but status, priorities, and phase ownership should be updated here first.

## Decision

Keep B2C on the existing Cloudflare Worker path for now.

Build the enterprise path directly toward the strongest Azure-native design:

- `enterprise.vaultproof.dev` runs on Azure.
- The public control plane never receives provider key plaintext.
- Both Shamir shares are encrypted at rest.
- The executor is the only service allowed to decrypt shares and reconstruct keys.
- Production executor runs on an Azure Confidential VM.
- The unwrap/root key is released through Azure Secure Key Release only after attestation.
- Highest-security production uses Azure Managed HSM Secure Key Release. Current Azure implementation uses an exportable `RSA-HSM` release-root key and derives AES-256 unwrap material inside the Confidential VM, because Azure Managed HSM does not allow generated symmetric `oct-HSM` keys to be released/exported.
- Plain provider keys exist only inside confidential execution memory for one outbound call and are zeroed immediately.
- Azure API Management provides API lifecycle governance in front of the enterprise control plane.
- Enterprise caller lock binds execution to approved origins, gateways, devices, fleets, and client classes.

Current architecture decision:

- Keep Azure Managed HSM as the production Secure Key Release key home for the next week while finishing the Azure build.
- Do not switch back to Key Vault Premium/Standard during this hardening pass unless Managed HSM blocks a required customer/demo milestone.
- After the Azure build is finished and stable, start the AWS equivalent design as a separate cloud track instead of mixing AWS work into the active Azure cutover/hardening work.

## Current State

Live production-confidential path:

- Azure Front Door routes `enterprise.vaultproof.dev`.
- Azure API Management is deployed as a verified sidecar gateway at `https://vpenteuutf4ahzja5l3oapim.azure-api.net/enterprise`; Front Door is not cut over to APIM yet.
- Azure Container Apps remains available only as an old prototype/rollback path; it is not the active production-confidential runtime.
- Azure Front Door routes active enterprise traffic to the co-located control plane on the Azure Confidential VM.
- Azure Front Door ID origin lock is required by the control plane.
- NSG ingress to the control plane is restricted to Azure Front Door service tags; direct public origin access is blocked.
- Azure Confidential VM runs both the enterprise control plane and secure executor as systemd services.
- The control plane calls the executor over loopback with signed execution envelopes.
- Managed HSM Secure Key Release is wired and the executor reports `production_ready: true`.
- `npm run verify:enterprise-production` verifies the live path and passes against the current Azure CLI/Front Door/NSG output shapes.
- `npm run deploy:enterprise-vm` deploys/rebuilds/restarts the CVM runtime and can run the verifier.
- `npm run evidence:enterprise-production` captures customer/audit evidence snapshots.
- `npm run validate:enterprise-evidence` validates the latest production evidence bundle for production readiness, Confidential VM posture, Front Door/origin-lock posture, service health, and obvious secret-shaped material before customer handoff.
- `npm run verify:enterprise-secrets` verifies the installed control-plane/executor env files for secret-rotation readiness and confidential-mode footguns.
- `npm run qa:enterprise-live-app` verifies the live enterprise homepage/app pages, crawls enterprise-owned links, confirms `/readiness` remains production-ready, and can optionally authenticate the demo account when `ENTERPRISE_DEMO_EMAIL` and `ENTERPRISE_DEMO_PASSWORD` are provided.
- Azure Monitor/App Insights alerting is deployed as `vp-enterprise-secure-runtime-eastus-hsm-monitoring` and `EXPECTED_MONITORING_DEPLOYED=true npm run verify:enterprise-production` verifies the workspace, App Insights component, action group, health/readiness availability tests, readiness drift alert, health alert, and Confidential VM availability alert.
- The enterprise control plane serves a separate public `/` enterprise homepage plus `/app` and `/app/dashboard` dashboard instead of relying on the B2C dashboard shell. Current state: the root page implements the editorial/terminal VaultProof Homepage design handoff; dashboard includes a built-feature map and live posture panels; login, control, org, runbooks, and remaining enterprise app pages exist under `/app/*`.
- Enterprise dashboard/API unauthenticated errors are product-safe: users see a normal sign-in prompt instead of implementation details about bearer tokens or Supabase JWTs.
- Enterprise `/app/*` pages support opt-in Mixpanel page/navigation analytics through `ENTERPRISE_MIXPANEL_TOKEN`; autocapture and session recording remain disabled by default for enterprise privacy.
- APIM IaC/policy support is deployed and verified with coarse limits, request-size guards, origin locking, forwarded enterprise host headers, App Insights diagnostics, and `EXPECTED_APIM_DEPLOYED=true npm run verify:enterprise-production`. JWT validation remains disabled until the final Entra/Supabase API audience is selected. `npm run cutover:enterprise-apim` now provides a guarded Front Door-to-APIM cutover/rollback helper that defaults to read-only planning.
- Azure Monitor/App Insights alerting is live for Front Door health, production readiness drift, and Confidential VM availability.
- TLS-origin proxy and Front Door cutover tooling exist and use the current Azure CLI Front Door origin command shape. A VM-local TLS proxy is installed and verified with a lab-only self-signed certificate, but Front Door still uses HTTP origin forwarding until a real origin DNS name and publicly trusted certificate are installed and cut over.
- SSH bootstrap lockdown tooling exists but public SSH remains open until alternate access or a controlled break-glass process is ready.
- Old Container Apps prototype cleanup tooling exists with inventory, ingress-disable, and explicit deletion actions.
- Supabase stores enterprise org/project metadata.
- Executor request signing is implemented.
- Enterprise executor now supports encrypted `share1_encrypted` and encrypted `share2_encrypted`.
- Executor has explicit `demo` vs `confidential` key-release mode.
- Released unwrap material is cached only in executor process memory with a short TTL.
- Executor blocks replayed signed execution envelopes.
- Executor health reports `production_ready`, `security_profile`, and concrete production blockers.
- Control plane `/readiness` summarizes whole-path demo readiness and production-confidential blockers.
- Enterprise caller-lock policy supports origin, provider allowlists, upstream method/host/path policy, per-project/provider rate limits, customer gateway, client class, device identity requirement, fleet, firmware, IPv4/IPv6 CIDR, mTLS certificate identity checks, and stricter per-provider overrides.
- Enterprise admins can emergency-revoke provider slots; revoked keys are excluded from future execution dispatch.
- Enterprise audit events can be exported as CSV from the control plane.
- Execution dispatch audit events include executor result metadata and customer-verifiable Azure attestation evidence summaries.
- Enterprise execution now supports a safe `dry_run` / `validate_only` mode that authenticates, enforces caller-lock/execution policy, signs the secure-execution envelope, writes validation audit metadata, and skips upstream provider dispatch. `npm run qa:enterprise-live-execute` uses this path by default when passed a Supabase access token on stdin.
- Azure secure-runtime IaC and operational scripts exist at `infra/azure/enterprise-secure-runtime`.
- Production evidence bundles are now machine-validated against the customer verification target before handoff.
- Enterprise audit events and SOC 2 access-review evidence can be exported from the control plane.
- The Control page includes project policy and provider-level execution override editing.
- Microsoft Entra ID SSO is supported through the Supabase Auth SAML path, with org-level rollout settings, SSO start/completion audit events, and safe membership resolution into existing access or matching pending invites.

Important limitation:

- The active production-confidential runtime is now Confidential VM plus Secure Key Release.
- Azure API Management Front Door route cutover, TLS-origin cutover, SSH bootstrap lockdown, prototype Container Apps cleanup, and enterprise UI/policy controls are still pending live actions.
- Secrets used during setup must be rotated before external/customer production use.

## Next Execution Order

1. Keep Managed HSM and finish Azure hardening first; defer Key Vault Premium simplification and AWS design until after the Azure path is stable.
2. TLS from Front Door to the VM origin, then switch Front Door origin forwarding to HTTPS.
3. Azure API Management route cutover after TLS/private-origin risk is resolved.
4. SSH/Bastion/JIT hardening and cleanup of old prototype Container Apps resources. In progress: reversible SSH bootstrap lockdown tooling, verifier expectations, and prototype Container Apps cleanup tooling are implemented; live SSH closure and live prototype cleanup are pending alternate access/break-glass readiness and soak.
5. End-to-end enterprise API execution through `enterprise.vaultproof.dev` with evidence/audit metadata. In progress: safe dry-run execution validates auth, policy, signed-envelope creation, and audit metadata without calling upstream providers; real provider dispatch remains an explicit `EXECUTE_DRY_RUN=false` action.
6. Enterprise controls: SSO, provider allowlists, upstream domain/method policy, policy UI, per-project rate limits, emergency revoke, audit export, SOC 2 access review evidence.
7. Enterprise dashboard completion: make every `/app/*` link resolve on `enterprise.vaultproof.dev`, then replace placeholders with API-backed enterprise pages one page at a time with tests between each slice.
8. Start AWS equivalent architecture after Azure finish line: Nitro Enclaves or equivalent confidential compute, KMS/HSM key-release equivalent, API Gateway/PrivateLink routing, monitoring, evidence, and dashboard parity.

## Security Boundary

Control plane responsibilities:

- Validate user/session auth.
- Enforce org/project policy.
- Rate limit enterprise calls.
- Create signed secure-execution envelopes.
- Write audit events.
- Never read unwrap keys.
- Never reconstruct provider keys.
- Enforce enterprise caller locks before secure execution dispatch.
- Expose `/readiness` so operators can distinguish demo readiness from production-confidential readiness.

API Management responsibilities:

- Route public enterprise API traffic to the control plane.
- Validate JWTs, API products/subscriptions, and customer access policies where appropriate.
- Enforce coarse rate limits, quotas, request size limits, and abuse controls.
- Provide API lifecycle governance, versioning, developer portal/catalog, policy management, and observability.
- Emit API telemetry to Azure Monitor/Application Insights.
- Never receive unwrap/root keys.
- Never reconstruct provider keys.
- Never call provider APIs directly with customer secrets.

## API Management Deployment Models

VaultProof should support two enterprise API management modes.

### Mode A: VaultProof-Managed APIM

Default SaaS model:

```text
customer app
  -> enterprise.vaultproof.dev
  -> VaultProof Azure Front Door + WAF
  -> VaultProof Azure API Management
  -> VaultProof Enterprise Control Plane
  -> private signed handoff
  -> VaultProof Azure Confidential VM Executor
```

VaultProof controls:

- API gateway configuration
- product tiers and subscriptions
- coarse rate limits/quotas
- API versioning
- developer portal/API catalog
- Azure Monitor/Application Insights telemetry
- backend routing to the enterprise control plane

Best for customers who want the fastest onboarding and do not already require all third-party SaaS calls through their own API gateway.

### Mode B: Customer-Managed APIM

Enterprise-controlled gateway model:

```text
customer app
  -> customer Azure API Management
  -> enterprise.vaultproof.dev
  -> VaultProof Azure Front Door + WAF
  -> VaultProof Enterprise Control Plane
  -> private signed handoff
  -> VaultProof Azure Confidential VM Executor
```

Customer controls:

- their own APIM products/subscriptions
- their own Entra/JWT policies
- their own request approval and routing policies
- their own internal quotas/rate limits
- their own observability and SIEM exports
- their own API lifecycle governance

VaultProof still controls:

- org/project authorization inside VaultProof
- encrypted share storage format
- secure execution envelope signing
- confidential executor runtime
- attested key release
- Shamir reconstruction inside the Azure confidential runtime
- upstream provider call and zeroization

Contract for customer-managed APIM:

- customer APIM routes to `https://enterprise.vaultproof.dev`
- customer APIM forwards the end-user/customer auth token or uses a mutually agreed service token
- customer APIM must not inject provider secrets
- customer APIM must not route directly to the Confidential VM executor
- VaultProof control plane must validate the caller/org/project after APIM
- VaultProof should optionally require a customer APIM marker header or mTLS certificate for dedicated enterprise tenants

Minimum customer APIM policy:

- validate JWT or client certificate
- enforce customer-side quota/rate limits
- strip inbound provider-secret headers
- set a non-secret tenant marker header, for example `x-vaultproof-customer-gateway`
- forward to `https://enterprise.vaultproof.dev`
- log request metadata to the customer's Azure Monitor/SIEM

### Mode C: Customer Devices And IoT

Device and IoT model:

```text
device / IoT gateway / fleet agent
  -> customer APIM, IoT Hub, or device gateway
  -> enterprise.vaultproof.dev
  -> VaultProof Enterprise Control Plane
  -> private signed handoff
  -> VaultProof Azure Confidential VM Executor
```

Supported device classes:

- factory/industrial IoT gateways
- retail/edge devices
- robots/drones/field equipment
- medical/lab devices
- mobile/desktop agents
- embedded fleet agents
- customer-hosted service connectors

Device identity options:

- per-device certificate and mTLS at customer APIM
- device JWT issued by customer Entra ID or IoT identity provider
- Azure IoT Hub or DPS identity upstream of customer APIM
- customer gateway exchanges device identity for a short-lived VaultProof enterprise token
- dedicated project/provider policy per fleet, facility, environment, or device class

Device-specific constraints:

- devices must never store third-party provider API keys
- devices should call VaultProof with device identity, project ID, and requested provider/action only
- customer APIM or IoT gateway should absorb bursty device traffic and enforce fleet quotas
- offline devices should queue intent, not provider secrets
- low-power devices should prefer a local gateway/proxy rather than doing heavy auth flows directly
- device requests should include stable non-secret identifiers such as fleet ID, device ID hash, firmware version, and environment

VaultProof guarantees stay the same:

- no provider key is returned to the device
- no provider key is exposed to customer APIM
- VaultProof control plane validates policy before execution
- the confidential executor reconstructs only inside Azure confidential runtime
- execution audit records device/fleet metadata without logging secrets

Recommended APIM/device gateway policy:

- validate device certificate or JWT
- normalize device identity into non-secret headers
- strip provider-secret headers
- enforce per-device and per-fleet rate limits
- optionally block unapproved firmware versions or device classes
- route only approved VaultProof enterprise paths

## Enterprise Caller Lock

Caller lock is the enterprise version of origin lock. It limits secure execution to approved callers before the control plane signs an executor envelope.

Supported lock dimensions:

- browser origin from `Origin`
- fallback referer origin from `Referer`
- customer APIM/gateway marker from `x-vaultproof-customer-gateway`
- client class from `x-vaultproof-client-class`
- device identity hash from `x-vaultproof-device-id` or `x-device-id`
- fleet ID from `x-vaultproof-fleet-id` or `x-fleet-id`
- firmware version from `x-vaultproof-firmware-version` or `x-firmware-version`
- source IP from `x-forwarded-for`, `x-real-ip`, `x-client-ip`, or `cf-connecting-ip`
- verified client certificate thumbprint from `x-vaultproof-client-cert-thumbprint`
- verified client certificate subject from `x-vaultproof-client-cert-subject`

Current implementation:

- project `strict_origin=true` requires the request origin/referer origin to match `allowed_origins`
- project `caller_lock_policy.allowed_customer_gateways` can restrict requests to approved customer gateways
- project `caller_lock_policy.allowed_providers` can restrict execution to approved provider slugs/providers
- project `caller_lock_policy.allowed_methods` can restrict execution to approved HTTP methods
- project `caller_lock_policy.allowed_upstream_hosts` can restrict execution to approved upstream hosts
- project `caller_lock_policy.allowed_upstream_path_prefixes` can restrict execution to approved upstream API path prefixes
- project `caller_lock_policy.rate_limit_per_minute` can cap signed execution dispatches per minute
- project `caller_lock_policy.allowed_client_classes` can restrict requests to approved client classes
- project `caller_lock_policy.allowed_fleet_ids` can restrict requests to approved fleets
- project `caller_lock_policy.allowed_firmware_versions` can restrict requests to approved firmware versions
- project `caller_lock_policy.require_device_id=true` requires a device identity header
- project `caller_lock_policy.allowed_ip_cidrs` can restrict requests to approved IPv4 or IPv6 ranges
- project `caller_lock_policy.allowed_client_certificate_thumbprints` can restrict requests to approved mTLS certificate thumbprints
- project `caller_lock_policy.allowed_client_certificate_subjects` can restrict requests to approved mTLS certificate subject fragments
- project `caller_lock_policy.provider_overrides.<provider-or-slug>` can add stricter provider-specific caller-lock policy
- denied origin-lock attempts produce governance audit events
- allowed caller-lock metadata is signed into the secure execution envelope
- executor audit metadata can include the caller-lock context without exposing secrets

Confidential executor responsibilities:

- Accept only signed execution envelopes.
- Resolve encrypted shares from storage.
- Get unwrap capability only via attested key release.
- Decrypt shares inside confidential runtime.
- Reconstruct provider key only in memory.
- Call upstream provider over TLS.
- Zero plaintext buffers.
- Record execution metadata without logging secrets.

## Non-Negotiable TEE Claim Requirements

Do not claim "TEE-backed key reconstruction" unless all of these are true:

- The Shamir reconstruction and upstream API call run inside the measured confidential runtime.
- The unwrap/root key is unavailable to the control plane, Container Apps, shell users, and normal environment variables.
- Key release is gated by remote attestation, not by ordinary service identity alone.
- The attestation evidence is bound to a specific runtime measurement/configuration.
- Customers can verify the attestation evidence or review a signed evidence bundle.
- Debug/insecure attestation modes are disabled for any production claim.
- The secure executor fails closed if attestation or Secure Key Release fails.

For VaultProof Enterprise, the customer-verifiable evidence is Azure-only:

- Azure Confidential VM guest attestation
- Microsoft Azure Attestation (MAA) token/claims
- vTPM-backed measurements and secure boot claims
- Azure Key Vault/Managed HSM Secure Key Release policy bound to those MAA claims

Use Azure Confidential Computing language only. If a customer asks about "PCRs," explain the Azure equivalent in terms of vTPM-backed measurements, Microsoft Azure Attestation claims, and Secure Key Release policy binding.

## Customer Verification Target

Enterprise customers should be able to verify:

- The request was handled by `enterprise.vaultproof.dev`.
- The control plane created a signed execution envelope but did not receive provider key plaintext.
- The executor produced fresh attestation evidence from inside the confidential runtime.
- The attestation claims match the approved runtime measurement and security settings.
- Azure Key Vault released unwrap capability only because those claims matched the release policy.
- The request matched configured enterprise caller-lock policy before dispatch.
- The execution audit event includes an attestation reference without exposing secrets.

Minimum evidence bundle for customer review:

- executor build artifact digest
- confidential VM identity/resource ID
- attestation provider URI
- attestation token hash or signed attestation token
- selected Azure vTPM/MAA measurement claim summary
- Key Vault key ID/version
- Secure Key Release policy hash
- execution request ID and timestamp
- statement that plaintext provider key was not returned or logged
- caller-lock decision summary: origin/gateway/device/fleet/client class

## Build Checklist

### Phase 1: Lock Prototype Into Enterprise Shape

- [x] Keep B2C Cloudflare code separate.
- [x] Use `share1_encrypted` and `share2_encrypted` for enterprise rows.
- [x] Remove any enterprise dependency on `share2_b64`.
- [x] Keep env-based unwrap key only under `VAULTPROOF_EXECUTOR_MODE=demo`.
- [x] Make `VAULTPROOF_EXECUTOR_MODE=confidential` fail closed until Secure Key Release is wired.
- [x] Block replayed execution envelopes by request ID and nonce.
- [x] Enforce enterprise caller lock for origins and sign caller-lock metadata into the execution envelope.
- [x] Store enterprise caller-lock policy in `projects.caller_lock_policy`.
- [x] Keep `/admin/seed-openai-demo` disabled by default and never enable it in confidential mode.
- [x] Remove `/admin/seed-openai-demo` entirely before production customer demos.

### Phase 2: Azure Confidential VM Runtime

- [x] Deploy `infra/azure/enterprise-secure-runtime/main.bicep`.
- [x] Create enterprise VNet.
- [x] Create Confidential VM. Note: deployed in `eastus` because the target `Standard_DC2as_v5` SKU was unavailable for this subscription in West US 2.
- [x] Run the executor as a systemd service.
- [x] Run the enterprise control plane as a co-located systemd service on the Confidential VM.
- [x] Bind executor to loopback/private access for the control plane path.
- [x] Restrict inbound traffic to Azure Front Door/control-plane paths and private executor paths.
- [x] Add health endpoint for private monitoring.
- [x] Use control-plane `/readiness` as the operator-facing gate before saying the enterprise path is production-confidential ready.
- [x] Add deployment script for the systemd artifact: `npm run deploy:enterprise-vm`.
- [x] Add live production verifier: `npm run verify:enterprise-production`.
- [x] Add production evidence collector: `npm run evidence:enterprise-production`.
- [x] Add production evidence validator: `npm run validate:enterprise-evidence`.
- [x] Deploy and verify Azure Monitor/App Insights alerting for Front Door health, production readiness drift, and Confidential VM availability.

### Phase 3: Secure Key Release

- [x] Create Azure Attestation provider.
- [x] Deploy Azure Managed HSM for production Secure Key Release.
- [x] Create enterprise release-root key.
- [x] Mark key export/release policy for Secure Key Release.
- [x] Generate guest attestation evidence from the Confidential VM.
- [x] Exchange attestation evidence for a token.
- [x] Call Azure Managed HSM release API from the executor.
- [x] Pin the release policy to approved MAA claims/measurements.
- [x] Never place unwrap key in Azure app settings or container env vars in production.
- [x] Add customer-verifiable attestation evidence to execution audit metadata.
- [x] Cache released unwrap material only in process memory with an explicit short TTL.
- [ ] Rotate setup-time Supabase/service/signing secrets before customer production. In progress: `npm run verify:enterprise-secrets` now validates installed runtime env files for matching rotated signing material, Supabase service-role presence, origin lock, and confidential-mode footguns; actual secret rotation remains an operator action.

Important key-type decision:

- Azure Key Vault Premium supports HSM-backed RSA/EC keys but not symmetric `oct-HSM`.
- Azure Managed HSM supports symmetric `oct-HSM` 256-bit keys, but Azure rejects generated symmetric keys for export/release.
- Current production-confidential implementation uses Managed HSM `RSA-HSM` Secure Key Release and derives AES-256 unwrap material inside the Confidential VM from the released private JWK.
- Do not sell this as direct symmetric `oct-HSM` release. Sell it as Azure Managed HSM Secure Key Release with AES material derived only inside the attested Confidential VM.

### Phase 4: Private Network And Call Authentication

- [x] Add Azure API Management sidecar in front of the enterprise control plane. Deployed as `vp-enterprise-secure-runtime-eastus-hsm-apim` with backend `http://20.85.214.14:3001`, forwarded host `enterprise.vaultproof.dev`, App Insights diagnostics, APIM origin-lock secret, and `AzureCloud.eastus` NSG source for StandardV2 shared egress.
- [ ] Cut Azure Front Door over to APIM after TLS/private-origin risk is resolved. In progress: APIM currently remains a verified sidecar, not the active `enterprise.vaultproof.dev` route; `cutover-front-door-apim.sh` and `npm run cutover:enterprise-apim` now provide read-only planning, guarded enable, rollback, APIM readiness checks, backend HTTPS safety, and verifier expectations.
- [x] Configure APIM policies for JWT validation, coarse rate limits, quotas, request size limits, and observability. Deployable APIM policy support now includes JWT validation, coarse limits, quota, request-size guard, provider-secret header stripping, APIM marker, APIM origin-lock forwarding, API operations, and App Insights diagnostics.
- [x] Support customer-managed APIM mode using `docs/enterprise/customer-managed-apim-policy.xml`.
- [x] Support customer device/IoT mode using `docs/enterprise/customer-managed-apim-device-policy.xml`.
- [x] Keep VaultProof-specific org/project authorization in the control plane.
- [x] Put executor behind loopback/private access from the co-located control plane.
- [ ] Prefer private endpoint/internal load balancer over public ingress. In progress: current state uses public Front Door to VM origin with NSG service tags and Front Door ID origin lock; private-origin architecture is still pending.
- [x] Keep control-plane-to-executor HMAC request signing.
- [x] Add replay protection using nonce/request ID storage.
- [ ] Add mTLS after private networking is stable.
- [x] Block direct public access to executor.
- [x] Require Azure Front Door ID origin lock for control-plane origin requests.
- [ ] Add TLS from Front Door to the VM origin and switch origin forwarding from HTTP to HTTPS. In progress: TLS proxy installer, guarded Front Door cutover/rollback helper, NSG 443 IaC, verifier/evidence support, lab-only self-signed verification support, and runbook are implemented. The VM-local nginx TLS proxy is installed and passes `ORIGIN_TLS_INSECURE=true` verifier checks; publicly trusted origin certificate/DNS, NSG 443 allow, and Front Door `HttpsOnly` cutover are pending.
- [ ] Close public SSH bootstrap ingress after alternate access is ready. In progress: `allowSshBootstrap` IaC switch, `harden-ssh-bootstrap.sh`, verifier expectations, and runbook are implemented; live NSG rule remains `Allow` for bootstrap/break-glass.
- [ ] Disable/delete old Container Apps prototype resources after soak. In progress: `cleanup-container-apps-prototype.sh` and `npm run cleanup:enterprise-container-apps` can inventory, disable ingress, and explicitly delete apps/environment/ACR; live cleanup is pending operator approval.

### Phase 5: Enterprise Controls

- [x] Add Microsoft Entra ID SSO.
- [x] Add project/provider allowlists.
- [x] Add allowed upstream host/path/method policy.
- [x] Add per-project/provider rate limits.
- [x] Add emergency key revoke.
- [x] Add audit export.
- [x] Add policy UI for editing caller-lock provider overrides.
- [x] Add access review evidence for SOC 2.
- [x] Add separate enterprise dashboard served by the Azure control plane.

### Phase 6: Enterprise Dashboard Completion

Goal: `enterprise.vaultproof.dev/app/*` should be a complete enterprise operator workspace, served by the Azure enterprise control plane and backed by `/api/v1/enterprise/*`, not the B2C dashboard shell.

Pages and links:

- [x] `/`: public enterprise homepage based on the VaultProof Homepage design handoff, with proof-led hero, animated proxy feed, sharded-key architecture figure, mechanism diagram, code diff, capabilities, trust roadmap, and CTAs into `/app/login`, `/app/dashboard`, `/readiness`, and email.
- [x] `/app`, `/app/`, `/app/dashboard`: enterprise dashboard home with a built-feature map plus runtime posture, org summary, project health, access, audit, and recent runtime activity.
- [x] `/app/login`: enterprise login entry point.
- [x] `/app/control`: detailed enterprise control surface for project policy, provider overrides, incoming invites, export summaries, and secure execution posture.
- [x] `/app/org`: organization settings and Microsoft Entra/Supabase SAML SSO rollout controls.
- [x] `/app/members`: enterprise-owned members page for members, pending invites, role changes, project assignments, CSV/JSON access evidence links, and invite acceptance. Current state: API-backed member/invite/project coverage page exists with access-review CSV link, invite create/revoke, role changes, project assignment/removal, and invite acceptance UI/API.
- [x] `/app/audit`: enterprise-owned audit page for governance/runtime timeline, CSV export, search, filters, and evidence-friendly event details.
- [x] `/app/alerts`: enterprise-owned alerts page for destinations, delivery logs, dispatch runs, policy status, and test-send workflow. Current state: API-backed alert operations page exists with admin-only test-send, webhook delivery, email skip logging until email transport is configured, delivery logs, and dispatch-run records.
- [x] `/app/activity`: enterprise-owned runtime activity page for recent proxy/executor events, status codes, latency, provider request IDs, and attestation summaries.
- [x] `/app/projects`: enterprise-owned project inventory page for project health, provider slots, policy status, and quick links to control.
- [x] `/app/keys`: enterprise-owned provider slots page for active providers, emergency revoke, rotation checklist, and SKR/confidential-mode notes. Revoked provider history is currently visible through `/app/audit`.
- [x] `/app/settings`: enterprise-owned tenant settings page for dashboard preferences, session/security notices, and org defaults that do not belong on SSO setup.
- [x] `/app/plans`: enterprise-owned plan/billing/governance page for APIM/enterprise rollout status, limits, and contract-facing packaging. Billing/limit enforcement remains manual until enterprise billing APIs exist.
- [x] `/app/scanner`: enterprise-owned repository/security scanning entry page, clearly marked as a separate future integration until enterprise-safe scanner APIs exist.
- [x] `/app/runbooks`: enterprise-owned operator runbooks page covering production verification, evidence capture, deploys, secret verification/rotation, TLS/APIM cutover, SSH hardening, and Container Apps cleanup.

Implementation/test order:

1. [x] Navigation no-404 baseline: every link rendered by enterprise dashboard/control/org resolves to an enterprise control-plane page and smoke tests assert HTTP 200. Placeholder pages are allowed only for this baseline slice.
2. [x] Members page read-only feature slice: wire `/app/members` to enterprise member APIs; test org selection, pending invites, access-review export link, and admin/member states.
3. [x] Members page admin-action slice: add invite acceptance, invite creation/revocation where supported, role changes, and project access assignment/removal.
4. [x] Audit page feature slice: wire `/app/audit` to enterprise audit APIs; test CSV export link, filter query generation, governance + proxy event rendering.
5. [x] Alerts page feature slice: wire `/app/alerts` to enterprise alert APIs; test destinations, policy, delivery logs, dispatch-run states, and admin-only test-send.
6. [x] Activity/projects/keys slice: wire runtime activity, project inventory, provider slot status, and emergency revoke paths; test no B2C API calls.
7. [x] Settings/plans/scanner slice: either wire real enterprise APIs or intentionally hide/disable unavailable actions; test no dead links and no B2C fallback.
8. [x] Enterprise analytics slice: add opt-in Mixpanel page/navigation events across login, dashboard, planned pages, and static enterprise pages; test disabled-by-default behavior and explicit enablement.
9. [x] Automated app-link QA smoke: crawl rendered enterprise `/app/*` links, verify every enterprise app link returns 200, and fail on `{"error":"Not found"}` or B2C API origins.
10. [x] Enterprise homepage design slice: serve the public `/` homepage from the enterprise control plane, smoke-test design landmarks, no B2C API origins, and disabled-by-default analytics.
11. [x] Live app QA automation: `npm run qa:enterprise-live-app` checks live `/app/*` routes, app-owned links, no `{"error":"Not found"}` pages, no B2C fallback, and production-ready `/readiness`; with demo credentials it also signs in through Supabase Auth and verifies authenticated enterprise org APIs.
12. [x] Runbooks page slice: expose the built operator commands in the enterprise dashboard, document which are read-only versus approval-gated, and cover it with smoke/link QA.
13. [x] Dashboard feature-map slice: expose every built enterprise feature from `/app/dashboard`, including live app pages, readiness/health, evidence/export surfaces, APIM/rollout status, scanner placeholder, and operator runbooks; cover it with smoke/link QA.
14. [ ] Live browser QA after each major deploy: run the automated live app QA, then manually login as demo user and click through sidebar/subnav links when visual regressions or browser-only session behavior are in scope.

## Azure Resources

Already created:

- Resource group: `vaultproof-enterprise`
- Container Apps environment: `managedEnvironment-vaultproofenter-9c88`
- Container registry: `vaultproofenterpriseacr.azurecr.io`
- Control plane app: `vp-enterprise-control-plane`
- Prototype executor app: `vp-enterprise-secure-executor`
- Front Door custom domain: `enterprise.vaultproof.dev`
- Confidential VM: `vpenteu-executor-cvm`
- Managed HSM: `vpenteuutf4ahzja5l3ohsm`
- Attestation provider: `vpenteuutf4ahzja5l3omaa`
- Enterprise VNet/subnets and NSG: `vpenteu-vnet`, `vpenteu-executor-nsg`

Needed for most-secure production:

- Azure API Management Standard v2 or Premium v2 for API lifecycle/governance
- Azure Confidential VM
- Azure Managed HSM Secure Key Release for the enterprise unwrap root
- Azure Key Vault Premium only if using the lower-friction prototype path
- Azure Attestation
- Enterprise VNet/subnets
- Private DNS/private endpoints where supported
- Azure Monitor/Log Analytics alerts

## Demo Versus Production

Demo mode:

- `VAULTPROOF_EXECUTOR_MODE=demo`
- Allows `VAULT_ENCRYPTION_KEY` from environment.
- Useful only to prove request signing, encrypted share storage, reconstruction, and outbound provider execution.

Confidential mode:

- `VAULTPROOF_EXECUTOR_MODE=confidential`
- Must not use `VAULT_ENCRYPTION_KEY`.
- Must use Azure Secure Key Release.
- Must receive release material from Azure Managed HSM only after attestation; current implementation derives AES-256 unwrap material inside the Confidential VM from the released `RSA-HSM` private JWK.
- Should be treated as the only sellable “most secure” architecture.
- `/health.production_ready` must be `true`.
- `/health.security_profile` must be `azure-confidential-production`.
- `/health.production_blockers` must be empty.
- Production readiness must fail closed if a static `AZURE_ATTESTATION_TOKEN` is configured instead of dynamic guest attestation.
- Production readiness must fail closed unless attestation evidence includes token hash, release-policy hash, key ID/version, executor build digest, Confidential VM resource ID, Azure MAA claim summary, and measurement summary.
