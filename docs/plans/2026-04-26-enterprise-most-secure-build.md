# VaultProof Enterprise Most-Secure Build

Status: active
Owner: VaultProof enterprise
Last updated: 2026-04-26

## Decision

Keep B2C on the existing Cloudflare Worker path for now.

Build the enterprise path directly toward the strongest Azure-native design:

- `enterprise.vaultproof.dev` runs on Azure.
- The public control plane never receives provider key plaintext.
- Both Shamir shares are encrypted at rest.
- The executor is the only service allowed to decrypt shares and reconstruct keys.
- Production executor runs on an Azure Confidential VM.
- The unwrap/root key is released through Azure Secure Key Release only after attestation.
- Highest-security production uses Azure Managed HSM with an `oct-HSM` AES-256 unwrap key.
- Plain provider keys exist only inside confidential execution memory for one outbound call and are zeroed immediately.
- Azure API Management provides API lifecycle governance in front of the enterprise control plane.
- Enterprise caller lock binds execution to approved origins, gateways, devices, fleets, and client classes.

## Current State

Working prototype:

- Azure Front Door routes `enterprise.vaultproof.dev`.
- Azure API Management is not deployed yet.
- Azure Container Apps runs the enterprise control plane.
- Azure Container Apps runs the current executor prototype.
- Supabase stores enterprise org/project metadata.
- Executor request signing is implemented.
- Enterprise executor now supports encrypted `share1_encrypted` and encrypted `share2_encrypted`.
- Executor has explicit `demo` vs `confidential` key-release mode.
- Executor blocks replayed signed execution envelopes.
- Executor health reports `production_ready`, `security_profile`, and concrete production blockers.
- Control plane `/readiness` summarizes whole-path demo readiness and production-confidential blockers.
- Enterprise caller-lock policy supports origin, customer gateway, client class, device identity requirement, fleet, firmware, IPv4/IPv6 CIDR, mTLS certificate identity checks, and stricter per-provider overrides.
- Azure secure-runtime IaC exists at `infra/azure/enterprise-secure-runtime`.

Important limitation:

- Container Apps is only the prototype runtime.
- Production “most secure” requires Confidential VM plus Secure Key Release.

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

- Keep B2C Cloudflare code separate.
- Use `share1_encrypted` and `share2_encrypted` for enterprise rows.
- Remove any enterprise dependency on `share2_b64`.
- Keep env-based unwrap key only under `VAULTPROOF_EXECUTOR_MODE=demo`.
- Make `VAULTPROOF_EXECUTOR_MODE=confidential` fail closed until Secure Key Release is wired.
- Block replayed execution envelopes by request ID and nonce.
- Enforce enterprise caller lock for origins and sign caller-lock metadata into the execution envelope.
- Store enterprise caller-lock policy in `projects.caller_lock_policy`.
- Keep `/admin/seed-openai-demo` disabled by default and never enable it in confidential mode.
- Remove `/admin/seed-openai-demo` entirely before production customer demos.

### Phase 2: Azure Confidential VM Runtime

- Deploy `infra/azure/enterprise-secure-runtime/main.bicep`.
- Create enterprise VNet.
- Create Confidential VM in West US 2.
- Install Docker or run the executor as a systemd service.
- Bind executor to private IP only if possible.
- Restrict inbound traffic to control plane/private network.
- Add health endpoint for private monitoring.
- Use control-plane `/readiness` as the operator-facing gate before saying the enterprise path is production-confidential ready.
- Add deployment script for the executor image or systemd artifact.

### Phase 3: Secure Key Release

- Create Azure Key Vault Premium.
- Create enterprise unwrap key.
- Mark key export/release policy for Secure Key Release.
- Create Azure Attestation provider.
- Generate guest attestation evidence from the Confidential VM.
- Exchange attestation evidence for a token.
- Call Azure Key Vault release API from the executor.
- Pin the release policy to approved MAA claims/measurements.
- Add customer-verifiable attestation evidence to execution audit metadata.
- Cache released unwrap material only in process memory with a short TTL.
- Never place unwrap key in Azure app settings or container env vars in production.

Important key-type decision:

- Azure Key Vault Premium supports HSM-backed RSA/EC keys but not symmetric `oct-HSM`.
- Azure Managed HSM supports symmetric `oct-HSM` 256-bit keys.
- Because VaultProof enterprise share encryption uses AES-256-style symmetric unwrap material, the strongest production path should use Managed HSM `oct-HSM`.
- Key Vault Premium remains acceptable for prototype/key-release plumbing, but do not sell it as the final AES-256 HSM-root story unless the wrapping design changes.

### Phase 4: Private Network And Call Authentication

- Add Azure API Management in front of the enterprise control plane.
- Configure APIM policies for JWT validation, coarse rate limits, quotas, request size limits, and observability.
- Support customer-managed APIM mode using `docs/enterprise/customer-managed-apim-policy.xml`.
- Support customer device/IoT mode using `docs/enterprise/customer-managed-apim-device-policy.xml`.
- Keep VaultProof-specific org/project authorization in the control plane.
- Put executor behind private networking.
- Prefer private endpoint/internal load balancer over public ingress.
- Keep control-plane-to-executor HMAC request signing.
- Add replay protection using nonce/request ID storage.
- Add mTLS after private networking is stable.
- Block direct public access to executor.

### Phase 5: Enterprise Controls

- Add Microsoft Entra ID SSO.
- Add org-level provider allowlist.
- Add allowed upstream domains/methods.
- Add policy UI for editing caller-lock provider overrides.
- Add per-project rate limits.
- Add emergency key revoke.
- Add audit export.
- Add access review evidence for SOC 2.

## Azure Resources

Already created:

- Resource group: `vaultproof-enterprise`
- Container Apps environment: `managedEnvironment-vaultproofenter-9c88`
- Container registry: `vaultproofenterpriseacr.azurecr.io`
- Control plane app: `vp-enterprise-control-plane`
- Prototype executor app: `vp-enterprise-secure-executor`
- Front Door custom domain: `enterprise.vaultproof.dev`

Needed for most-secure production:

- Azure API Management Standard v2 or Premium v2 for API lifecycle/governance
- Azure Confidential VM
- Azure Managed HSM for the enterprise AES-256 unwrap key
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
- Must receive an attested `oct-HSM` symmetric unwrap key from Azure Managed HSM for the final AES-256 design.
- Should be treated as the only sellable “most secure” architecture.
- `/health.production_ready` must be `true`.
- `/health.security_profile` must be `azure-confidential-production`.
- `/health.production_blockers` must be empty.
- Production readiness must fail closed if a static `AZURE_ATTESTATION_TOKEN` is configured instead of dynamic guest attestation.
- Production readiness must fail closed unless attestation evidence includes token hash, release-policy hash, key ID/version, executor build digest, Confidential VM resource ID, Azure MAA claim summary, and measurement summary.
