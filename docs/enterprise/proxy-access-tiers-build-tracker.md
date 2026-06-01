# Proxy Access Tiers Build Tracker

Status: in progress
Owner: VaultProof enterprise
Last updated: 2026-06-01

This tracker follows the implementation plan in `docs/plans/2026-06-01-enterprise-proxy-access-tiers-plan.md`.

## Build Checklist

### 1. Data Model

- [x] Add `organization_proxy_access_policies` migration.
- [x] Add grants/RLS for service-role writes and organization read posture.
- [x] Add TypeScript policy types and normalization helpers.
- [x] Add default policy fallback for existing enterprise businesses.
- [x] Add audit event names for policy update and execution denial.

### 2. Internal Admin

- [x] Add proxy access policy to internal admin org detail API.
- [x] Add approval-gated update endpoint.
- [x] Add approval-gated freeze endpoint.
- [x] Add approval-gated thaw endpoint.
- [x] Add "Proxy access tier" form to business detail.
- [x] Add tier/freeze badges to business list.
- [x] Add missing-prerequisite checklist.

### 3. Customer Visibility

- [x] Add customer-safe posture to org bootstrap.
- [x] Add posture to dashboard/security review pages.
- [x] Add posture to evidence packet.
- [x] Add leaked `vp-proj-*` response guidance to runbooks.

### 4. Enforcement

- [x] Build shared proxy access policy resolver.
- [x] Enforce Basic provider/path/method/rate controls.
- [x] Enforce Recommended egress CIDR/source controls.
- [x] Enforce High Security mTLS/private-connectivity controls.
- [x] Add monitor mode audit-only behavior.
- [x] Add frozen-state blocking.

### 5. Anomaly Auto-Freeze

- [x] Define initial deterministic anomaly rule: enforced proxy access denial freezes when auto-freeze is enabled.
- [ ] Add repeated-denial detection.
- [ ] Add rate-spike detection after baseline exists.
- [ ] Add project/provider-slot freeze target selection.
- [x] Add customer-safe anomaly audit metadata.

### 6. Tests and QA

- [ ] Unit tests for policy parsing and validation.
- [x] Smoke tests for admin writes and audit events.
- [x] Execute-route test for Recommended egress enforcement.
- [x] Execute-route test for High Security mTLS enforcement.
- [x] Freeze/thaw tests.
- [x] Evidence redaction tests.
- [ ] Manual QA on `admin.vaultproof.dev` business detail.

## Tier Acceptance Criteria

### Basic

- A company can be set to `basic` in internal admin.
- Project/provider path and method scope can be evaluated.
- Rate limits are enforced or monitored as configured.
- Leaked `vp-proj-*` abuse can be slowed and audited.

### Recommended

- A company can be set to `recommended`.
- Egress CIDR/source requirements are visible and configurable.
- Requests outside the approved source are denied in enforce mode.
- Monitor mode records what would have been denied.
- Anomaly auto-freeze can block abusive traffic without rotating provider keys.

### High Security

- A company can be set to `high_security`.
- mTLS or private connectivity requirements are visible and configurable.
- Requests missing required mTLS/private connectivity proof are denied.
- Customer evidence shows High Security posture without exposing secrets.

## Current Implementation Notes

- Existing project `caller_lock_policy` already models many enforcement facts: providers, methods, upstream hosts, path prefixes, gateway, client class, fleet/device, mTLS thumbprints/subjects, and rate limit.
- Existing internal admin already supports approval-gated organization writes for SSO, KMS, invites, status, and support notes.
- Existing enterprise execute route already receives caller-lock facts and enforces project/provider policy; the tier resolver should extend this rather than duplicate it.
- Existing evidence pages already include key rotation, proxy self-test, scanner exposure, release, and monitoring proof; proxy access tier posture should be another customer-safe proof block.

## Deferred Ideas

- Hourly `vp_exec_v1` token rotation for customers that want short-lived proxy credentials.
- Customer self-service tier-change request workflow.
- PrivateLink/Private Service Connect setup automation per customer cloud.
- Attestation-bound customer key release broker for highest-security deployments.
