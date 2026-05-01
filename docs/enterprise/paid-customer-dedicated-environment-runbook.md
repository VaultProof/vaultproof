# Paid Customer Dedicated Environment Runbook

Last updated: 2026-05-01

This runbook is the checklist for moving from the shared enterprise demo environment to a paid customer environment. The shared demo path stays cheap and reusable. Paid customers get a clearly separated production boundary.

## Short Version

For demos:

- Use `ENTERPRISE_RUNTIME_TIER=shared-demo`.
- Reuse the shared enterprise demo runtime.
- Use shared demo attestation for proof and dashboard demos.
- Do not create a new Confidential VM, Managed HSM, APIM instance, monitoring stack, or database per demo org.
- Use Key Vault Premium SKR for shared demos when we need live attestation-gated key release without the Managed HSM pool cost.

For paid customers:

- Use `ENTERPRISE_RUNTIME_TIER=dedicated-production`.
- Provision a customer-dedicated runtime boundary.
- Use a separate database or separate Supabase project for high-value enterprise customers.
- Use a customer-specific key-release boundary.
- Use customer-specific SSO, IAM, project policy, provider slots, audit, monitoring, and evidence exports.

## Customer Environment Decision

| Customer Type | Runtime | Database | Key Release | APIM/Gateway | Notes |
| --- | --- | --- | --- | --- | --- |
| Demo / trial | Shared demo runtime | Shared demo Supabase org/project | Shared demo attestation path; preferably Key Vault Premium SKR for cost | Shared Front Door route | Lowest cost. Never call it customer-dedicated. |
| Paid standard enterprise | Dedicated production runtime | Dedicated Supabase project or dedicated Postgres database | Key Vault Premium SKR or customer-owned Key Vault | VaultProof APIM or customer APIM | Good default for first paid customers. |
| Regulated / high-trust enterprise | Dedicated production runtime | Dedicated database, backups, logs, and retention policy | Managed HSM or customer-owned HSM/Key Vault | Customer APIM, mTLS, private origin | Use when contract requires single-tenant HSM or stronger isolation. |

## Required Paid Customer Inputs

Collect these before provisioning anything:

- Customer legal name and short environment slug.
- Customer production hostname, such as `acme.enterprise.vaultproof.dev` or customer-owned CNAME.
- Azure region requirement.
- Compliance requirements: SOC 2, HIPAA, PCI, financial services, data residency, retention, audit export cadence.
- Identity provider: Microsoft Entra tenant ID, SAML metadata, groups, MFA/conditional access requirements.
- Network pattern: VaultProof-managed Front Door/APIM, customer APIM, mTLS gateway, device gateway, private origin, or hybrid.
- Key custody requirement: VaultProof-owned Key Vault Premium, VaultProof-owned Managed HSM, customer-owned Key Vault/HSM, or bring-your-own-key process.
- Database isolation requirement: shared SaaS database, dedicated Supabase project, dedicated Postgres, or customer-hosted database.
- Provider inventory: OpenAI, Anthropic, Stripe, internal APIs, or other provider accounts.
- Security contacts, incident contacts, billing owner, app owners, and customer admin users.

## Provisioning Checklist

### 1. Create Customer Tracking Record

- Assign customer slug, for example `acme`.
- Pick environment name, for example `vpacme`.
- Create internal owner, support owner, and security owner.
- Record contract tier: standard enterprise or regulated enterprise.
- Record whether the customer is allowed to use shared services or requires dedicated resources.

### 2. Create Azure Resource Boundary

Recommended for paid production:

- Create a dedicated resource group, for example `vaultproof-enterprise-acme-prod`.
- Use separate Azure tags:
  - `customer=acme`
  - `environment=production`
  - `tier=dedicated-production`
  - `data-classification=customer`
- Deploy dedicated network resources:
  - VNet
  - control-plane subnet
  - executor subnet
  - NSG
  - public IP only if needed during bootstrap
  - private endpoint/private origin path if required
- Deploy dedicated Confidential VM runtime.
- Set `ENTERPRISE_RUNTIME_TIER=dedicated-production`.

Do not reuse the shared demo VM for a paid customer production claim.

### 3. Choose Key Release Option

Cheapest paid default:

- Azure Key Vault Premium with an exportable `RSA-HSM` Secure Key Release key.
- Keeps hardware-backed key release and Microsoft Azure Attestation.
- Avoids the hourly Managed HSM pool cost.

Highest-security option:

- Azure Managed HSM Standard B1.
- Use when the customer requires single-tenant HSM isolation, strict compliance language, or customer-specific security domain.
- Back up the Managed HSM security domain immediately after activation.

Customer-owned option:

- Customer owns Key Vault Premium or Managed HSM.
- VaultProof receives only the release URL and required identity access.
- Customer can revoke VaultProof by changing key release policy or role assignments.

Required key-release steps:

1. Generate fresh attestation evidence from the dedicated Confidential VM.
2. Build a customer-specific SKR policy from that evidence.
3. Create the exportable release key with the policy.
4. Grant only the dedicated VM managed identity release permission.
5. Store these values in the executor env:
   - `AZURE_KEY_RELEASE_URL`
   - `AZURE_KEY_RELEASE_POLICY_HASH`
   - `AZURE_KEY_ID`
   - `AZURE_KEY_VERSION`
   - `AZURE_ATTESTATION_PROVIDER_URI`
   - `AZURE_CONFIDENTIAL_VM_RESOURCE_ID`
   - `AZURE_MEASUREMENT_SUMMARY`
6. Verify `AZURE_ATTESTATION_TOKEN` is not set.

Shared demo migration command:

```bash
KEY_VAULT_NAME='<keyVaultName output>' \
POLICY_FILE='/tmp/vaultproof-skr/skr-policy.json' \
VM_PRINCIPAL_ID='<confidentialVmPrincipalId output>' \
npm run provision:enterprise-key-vault-release-key
```

Use the generated `key-vault-key-env.sh` only after verifying the release policy was built from the current shared demo Confidential VM attestation.

### 4. Create Separate Database Boundary

Recommended first paid-customer default:

- Create a dedicated Supabase project or dedicated Postgres database.
- Run all enterprise migrations against that database.
- Configure separate Supabase Auth settings and SAML/SSO for the customer.
- Use a separate service role key for that customer environment.
- Store the customer database URL and service role key only in the customer control-plane env.

Minimum database checklist:

- Apply enterprise migrations.
- Apply IAM role migration.
- Apply AI Proof Verifier migration.
- Create customer organization.
- Create initial owner/admin user.
- Create starter project.
- Configure RLS policies.
- Configure backup policy.
- Configure log retention and export policy.
- Store database credentials in secure operator vault, not in docs or git.

If we keep a shared SaaS database for smaller customers, the customer still needs strict org/project RLS, separate audit exports, separate provider slots, separate SSO, and clear contract language that the database is multi-tenant.

### 5. Configure Identity And SSO

- Create or configure the customer enterprise app in Microsoft Entra ID.
- Configure Supabase SAML provider for the customer.
- Map customer SAML claims:
  - email
  - name
  - groups if needed
  - tenant ID if needed
- Invite initial customer owners.
- Assign VaultProof roles:
  - owner
  - iam_admin
  - security_admin
  - platform_admin
  - auditor
  - developer
  - viewer
- Confirm login at the customer hostname.
- Export an initial access review.

### 6. Configure Control Plane Environment

Required control-plane env values:

```bash
ENTERPRISE_HOSTNAME=<customer-hostname>
ENTERPRISE_RUNTIME_TIER=dedicated-production
ENTERPRISE_EXECUTOR_BASE_URL=http://127.0.0.1:3002
ENTERPRISE_EXECUTOR_SIGNING_KEY_ID=<customer-key-id>
ENTERPRISE_EXECUTOR_SIGNING_SECRET=<customer-signing-secret>
ENTERPRISE_AZURE_FRONT_DOOR_ID=<customer-front-door-id>
ENTERPRISE_REQUIRE_ORIGIN_LOCK=true
ENTERPRISE_ORIGIN_LOCK_SECRET=<customer-origin-lock-secret-if-used>
SUPABASE_URL=<customer-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<customer-service-role-key>
```

Rules:

- Do not reuse demo signing secrets.
- Do not reuse demo Supabase service role keys.
- Do not reuse demo origin-lock secrets.
- Keep the executor reachable over loopback or a private internal path only.

### 7. Configure Executor Environment

Required executor env values:

```bash
VAULTPROOF_EXECUTOR_MODE=confidential
SUPABASE_URL=<customer-supabase-url>
SUPABASE_SERVICE_ROLE_KEY=<customer-service-role-key>
ENTERPRISE_EXECUTOR_ACCEPTED_SIGNING_KEYS=<customer-key-id>:<customer-signing-secret>
AZURE_KEY_RELEASE_URL=<customer-release-url>
AZURE_ATTESTATION_PROVIDER_URI=<customer-attestation-uri>
AZURE_ATTESTATION_CLIENT_PATH=/usr/local/bin/AttestationClient
AZURE_KEY_RELEASE_POLICY_HASH=<customer-policy-hash>
AZURE_KEY_ID=<customer-key-id-url>
AZURE_KEY_VERSION=<customer-key-version>
VAULTPROOF_EXECUTOR_BUILD_DIGEST=<build-digest>
AZURE_CONFIDENTIAL_VM_RESOURCE_ID=<customer-vm-resource-id>
AZURE_MEASUREMENT_SUMMARY=<customer-measurement-summary>
```

Rules:

- Do not configure `VAULT_ENCRYPTION_KEY` in confidential mode.
- Do not configure static `AZURE_ATTESTATION_TOKEN` in production.
- Keep `AZURE_KEY_RELEASE_CACHE_TTL_MS` short.
- Verify the service user can run the guest attestation client without interactive sudo.

### 8. Configure Gateway And Network

Choose one:

- VaultProof-managed Front Door to dedicated VM origin.
- VaultProof-managed APIM sidecar in front of the control plane.
- Customer-managed APIM forwarding trusted caller-lock headers.
- mTLS gateway with client certificate binding.
- Private origin through Private Link or internal load balancer.

Minimum production controls:

- Front Door origin lock enabled.
- Direct public origin access blocked.
- NSG allows only required Front Door/APIM/private-origin sources.
- SSH bootstrap closed after alternate access is ready.
- TLS origin forwarding planned or enabled.
- Rate limits and request-size limits configured.
- Caller-lock spoofable headers stripped at gateway.

### 9. Configure Provider Slots And Policy

- Create customer projects around real environment boundaries.
- Create provider slots for each provider account.
- Set provider owner, purpose, rotation cadence, and emergency revoke path.
- Configure caller-lock policy:
  - allowed origins
  - gateway marker
  - CIDRs
  - mTLS thumbprints
  - device/fleet IDs
  - allowed upstream hosts
  - allowed methods and path prefixes
  - rate limits
- Run dry-run execution before live provider calls.
- Record initial policy export.

### 10. Configure Monitoring, Alerts, And Evidence

Paid production should include:

- Azure Monitor/App Insights or customer-approved equivalent.
- Availability checks for `/health` and `/readiness`.
- Readiness drift alert.
- VM availability alert.
- Control-plane and executor service status alert.
- Alert destinations for customer security and platform contacts.
- Audit CSV export.
- Access-review CSV export.
- Evidence bundle generation.
- Evidence validation.

Recommended commands:

```bash
npm run verify:enterprise-production
npm run evidence:enterprise-production
npm run validate:enterprise-evidence
npm run package:enterprise-handoff
npm run gate:enterprise-handoff
```

### 11. Cutover Checklist

Before customer traffic:

- `/health` returns OK from customer hostname.
- `/readiness` returns:
  - `runtime_tier: dedicated-production`
  - `customer_dedicated_runtime: true`
  - `production_ready: true`
  - empty `production_blockers`
- Control plane can reach executor.
- Executor reports hardware-bound key release.
- Dynamic Azure guest attestation works.
- SSO login works.
- Owner/admin/auditor roles work.
- Audit export works.
- Access review export works.
- Alert test send works.
- Dry-run execution writes audit metadata.
- Emergency revoke path is tested.

After cutover:

- Watch readiness, activity, audit, alerts, and provider errors.
- Keep rollback path documented.
- Disable bootstrap SSH if alternate access is ready.
- Remove demo credentials and sample data.

## Demo-To-Paid Migration Checklist

When a demo customer converts:

- Keep their demo org as reference only; do not silently turn it into production.
- Create a fresh paid production org or migrate after approval.
- Create dedicated database or dedicated Supabase project if required.
- Create dedicated Azure runtime resources.
- Create customer-specific SSO.
- Create customer-specific signing secrets.
- Create customer-specific key-release policy.
- Create customer-specific provider slots.
- Reinvite customer admins into the paid environment.
- Export demo audit if the customer wants it, but label it as demo evidence.
- Run production readiness and evidence validation before sending paid traffic.

## Resource Cleanup After Paid Cutover

If the customer no longer needs the demo:

- Disable demo user access.
- Revoke demo provider slots.
- Remove demo sample data if no retention hold exists.
- Keep only shared demo runtime for future demos.
- Do not delete production HSM/Key Vault/database resources without written customer approval and backup/export confirmation.

## Do Not Do This

- Do not claim a shared demo runtime is customer-dedicated.
- Do not share signing secrets between demo and paid customers.
- Do not share Supabase service role keys between dedicated customer environments.
- Do not use static attestation tokens for production.
- Do not create Managed HSM pools for every demo.
- Do not delete a Managed HSM before backing up the security domain and confirming the customer does not need the key material.
- Do not route paid customer traffic through old Container Apps prototype resources.
- Do not expose provider keys in dashboard pages, logs, docs, screenshots, or tickets.

## First Paid Customer Minimum Bar

Before calling the first paid environment production-ready, all of this should be true:

- Dedicated customer hostname.
- `ENTERPRISE_RUNTIME_TIER=dedicated-production`.
- Dedicated database or approved shared-database contract language.
- Customer SSO configured and tested.
- Dedicated signing secret and origin-lock secret.
- Dedicated key-release policy.
- Key Vault Premium SKR at minimum, Managed HSM if contract requires it.
- Confidential VM executor production-ready.
- Front Door origin lock required.
- Direct public origin blocked.
- Audit, access review, alerting, evidence, and readiness exports working.
- Customer admins know how to sign in, invite teammates, create projects, configure provider slots, review audit, and trigger emergency revoke.
