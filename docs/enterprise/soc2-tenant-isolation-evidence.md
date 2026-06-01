# SOC 2 Tenant Isolation Evidence

VaultProof Enterprise uses `organization_id` as the customer tenant boundary. Customer data, KMS onboarding rows, provider slots, audit events, access-review exports, and runtime traffic evidence must resolve through authenticated organization membership before a user can read or change them.

Run the tenant-isolation evidence pack before a guided pilot, before a security review, and before a SOC 2 readiness review:

```bash
npm run evidence:enterprise-tenant-isolation
```

The command builds the enterprise packages, runs a local control-plane evidence test with two synthetic customers, and writes a JSON evidence file under:

```text
/tmp/vaultproof-tenant-isolation-evidence/
```

## What The Evidence Proves

The evidence runner creates two synthetic tenants:

- `org_alpha` with `proj_alpha`, `key_alpha_openai`, `kms_alpha`, Alpha audit events, Alpha access logs, and Alpha access-review records.
- `org_beta` with `proj_beta`, `key_beta_openai`, `kms_beta`, Beta audit events, Beta access logs, and Beta access-review records.

It then verifies:

- Unauthenticated enterprise API requests are denied.
- Tenant Alpha project bootstrap cannot see Tenant Beta organization, project, provider-slot, or traffic markers.
- Tenant Beta project bootstrap cannot see Tenant Alpha markers.
- A forged `x-vaultproof-organization: org_beta` header with an Alpha session does not switch Alpha into Beta.
- Customer KMS status only returns the signed-in organization and its own `ExternalId` trust policy.
- Audit evidence only returns the signed-in organization's governance and proxy events.
- Access-review evidence only returns the signed-in organization's members, projects, project assignments, and invitations.
- Tenant Alpha cannot create provider slots on Tenant Beta's project.
- Tenant Alpha cannot execute a provider request against Tenant Beta's project.
- Tenant Alpha can still create an allowed provider slot inside its own project, and the audit event stays on Alpha's `organization_id`.

## SOC 2 Mapping

This evidence supports the technical side of these control areas:

- `CC6.1`: logical access requires authentication.
- `CC6.2`: tenant data access is restricted by organization membership.
- `CC6.3`: privileged actions require the right organization/project role.
- `CC6.6`: unauthorized tenant access fails closed.
- `CC7.2`: security-relevant tenant operations produce audit evidence.

The evidence file is not a SOC 2 report by itself. For Type II, keep running this command during the observation period and retain the generated JSON files with deploy, access-review, vulnerability-management, incident-response, backup, and change-management evidence.

## Boundaries Still Needed For Production SOC 2

The evidence runner tests the control-plane authorization layer. Production SOC 2 readiness should also include:

- Database RLS policy tests against real Supabase migrations.
- Live authenticated tests against `enterprise.vaultproof.dev`.
- Cache-key, queue-key, storage-path, and rate-limit tests proving all shared resources include tenant context.
- Runtime tests proving customer KMS, provider material, execution envelopes, and audit events cannot cross organizations.
- Administrative tests proving staff actions are read-only by default, approval-gated, audited, and scoped to the selected business.
