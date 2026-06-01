# VaultProof Enterprise Proxy Access Tiers Plan

Status: implementation in progress
Owner: VaultProof enterprise
Last updated: 2026-06-01

## Goal

Build three configurable proxy-abuse-control tiers for VaultProof Enterprise and make them settable per company from the staff internal admin page.

The problem this solves is leaked `vp-proj-*` identifiers. Customer KMS protects provider key material, but `vp-proj-*` can still be abused for routed proxy traffic if the proxy accepts it by itself. The tier model makes `vp-proj-*` a stable project identifier with extra controls around who can use it, where it can be used from, and when VaultProof should freeze suspicious usage.

## Tier Model

| Tier | Name | Controls | Customer Work | Default Use |
| --- | --- | --- | --- | --- |
| 1 | Basic | `vp-proj-*`, provider/path/method scoping, per-project/provider rate limits, audit, emergency revoke | Low | Early pilots, low-risk internal tools |
| 2 | Recommended | Basic plus customer egress IP/CIDR allowlist and anomaly auto-freeze | Medium-low | Server workloads, production SaaS apps, CI/CD |
| 3 | High security | Recommended plus mTLS customer gateway or private connectivity requirement | Medium-high | Regulated/high-trust workloads, sensitive automation, high spend APIs |

## Product Decision

Do not rotate `vp-proj-*` hourly as the default control. Keep it stable and make it insufficient by itself.

Hourly short-lived tokens can remain a later option, but the lower-work enterprise path is:

- Stable `vp-proj-*` for project/workload identity.
- Organization-level proxy access tier selected by VaultProof staff.
- Project/provider policy limits enforced on every request.
- Optional egress source, mTLS, or private-connectivity requirement.
- Automatic freeze/revoke behavior when traffic looks compromised.

## Admin Surface

Add a "Proxy access tier" card to the internal admin business detail page.

Fields:

- `tier`: `basic`, `recommended`, or `high_security`.
- `enforcement_mode`: `monitor`, `enforce`, or `paused`.
- `allowed_egress_cidrs`: comma/newline list for Recommended and High Security.
- `require_mtls`: boolean for High Security.
- `require_private_connectivity`: boolean for High Security when a private link path exists.
- `anomaly_auto_freeze_enabled`: boolean.
- `default_rate_limit_per_minute`: integer.
- `default_provider_scope_mode`: `project_policy` or `deny_unscoped`.
- `notes`: staff-only, metadata only, no secrets.

The page should show the effective company posture:

- selected tier
- missing prerequisites
- projects covered
- projects still missing provider/path scoping
- current freeze state
- recent abuse/anomaly events

## Data Model

Add a new organization-level policy table instead of overloading KMS connections.

Proposed table: `organization_proxy_access_policies`

Columns:

- `organization_id uuid primary key references organizations(id)`
- `tier text not null default 'basic'`
- `enforcement_mode text not null default 'monitor'`
- `allowed_egress_cidrs text[] not null default '{}'`
- `require_mtls boolean not null default false`
- `require_private_connectivity boolean not null default false`
- `anomaly_auto_freeze_enabled boolean not null default true`
- `default_rate_limit_per_minute integer`
- `default_provider_scope_mode text not null default 'project_policy'`
- `freeze_state text not null default 'active'`
- `freeze_reason text`
- `frozen_at timestamptz`
- `created_by uuid`
- `updated_by uuid`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Checks:

- `tier in ('basic', 'recommended', 'high_security')`
- `enforcement_mode in ('monitor', 'enforce', 'paused')`
- `default_provider_scope_mode in ('project_policy', 'deny_unscoped')`
- `freeze_state in ('active', 'frozen', 'thaw_pending')`
- `default_rate_limit_per_minute is null or default_rate_limit_per_minute between 1 and 60000`

RLS/grants:

- Service role read/write.
- Organization admins/auditors can read their own effective policy through a customer-safe endpoint.
- Only internal admin action routes can write.

## API Work

Internal admin endpoints:

- `GET /api/v1/internal-admin/orgs/:orgId/proxy-access-policy`
- `PUT /api/v1/internal-admin/orgs/:orgId/proxy-access-policy`
- `POST /api/v1/internal-admin/orgs/:orgId/proxy-access-policy/freeze`
- `POST /api/v1/internal-admin/orgs/:orgId/proxy-access-policy/thaw`

Customer-safe endpoints:

- Add proxy access posture to organization/bootstrap payloads.
- Add proxy access posture to evidence packets.
- Do not expose staff notes, raw CIDR lists if customer has asked to hide network details, mTLS private material, origin-lock secrets, or runtime-token secrets.

Audit events:

- `enterprise_proxy_access_policy_updated`
- `enterprise_proxy_access_frozen`
- `enterprise_proxy_access_thawed`
- `enterprise_proxy_access_anomaly_detected`
- `enterprise_proxy_access_denied`

## Enforcement Work

Centralize a resolver that combines:

- organization proxy access policy
- project `caller_lock_policy`
- provider override policy
- request source facts
- mTLS/private connectivity facts
- rate-limit and anomaly state

Apply it to:

- Enterprise execute route: `packages/enterprise-control-plane/src/routes/execute.ts`
- Public/init proxy path only where organization-backed projects use enterprise policy
- Customer evidence/readiness summaries

Enforcement rules:

- Basic: project/provider policy and rate limits are enforced; unscoped providers are allowed only if `default_provider_scope_mode=project_policy`.
- Recommended: if `enforcement_mode=enforce`, request source must match allowed egress CIDRs or trusted gateway facts.
- High Security: require mTLS thumbprint/subject or private-connectivity proof, depending on selected controls.
- Paused/frozen company policy blocks execute/proxy traffic with a safe error and writes audit.
- Monitor mode writes warnings/audit but does not block, except explicit emergency freeze.

## Anomaly Auto-Freeze

Start with simple deterministic rules:

- Unknown source for Recommended or High Security in enforce mode.
- Provider not in project/provider scope.
- Path outside allowed prefixes.
- Rate exceeds configured per-minute limit.
- Sudden spike over baseline once enough traffic history exists.
- Repeated 401/403/429 denials for the same project/provider/source.

Freeze behavior:

- Freeze organization or project/provider slot depending on configured blast radius.
- Emit audit event.
- Show banner in staff admin and customer evidence.
- Allow staff thaw with approval secret and note.

## UI Work

Internal admin:

- Add proxy access tier form beside SSO/KMS/status forms.
- Add posture badges in business list: `basic`, `recommended`, `high security`, `frozen`, `monitor`.
- Add missing-prerequisite checklist for egress CIDRs, mTLS, private connectivity, provider/path scoping, and rate limits.

Customer dashboard:

- Show read-only proxy access posture.
- Show what the customer must provide for Recommended or High Security.
- Include posture in evidence packet and security review packet.

## Verification

Unit/smoke checks:

- Policy normalization rejects invalid tiers/modes/rate limits.
- Internal admin writes require approval secret and are audited.
- Customer orgs can only read their own posture.
- Basic allows valid scoped traffic.
- Recommended denies traffic outside CIDR in enforce mode.
- Recommended monitor mode audits but allows.
- High Security denies missing mTLS/private-connectivity proof.
- Freeze blocks execution and thaw restores it.
- Evidence packet never includes secrets.

Manual QA:

- Create a test business in internal admin.
- Set each tier.
- Run dry execute with allowed and denied source/caller-lock facts.
- Confirm admin and customer pages show the same posture.
- Confirm audit/events are customer-safe.

## Rollout Plan

Phase 1: Data and read model - complete

- Added migration and typed policy helpers.
- Returned policy in admin org detail and overview.
- Returned customer-safe posture in org current, projects bootstrap, evidence, and security-review surfaces.

Phase 2: Admin write flow - in progress

- Added internal admin form and approval-gated update endpoint.
- Audited every policy update.
- Added approval-gated freeze/thaw endpoints.

Phase 3: Enforcement - in progress

- Enforced Basic scoping and rate limit defaults.
- Added Recommended source checks.
- Added High Security mTLS/private-connectivity checks.
- Added smoke coverage for Recommended egress and High Security mTLS.

Phase 4: Anomaly auto-freeze - in progress

- Added first deterministic freeze trigger for enforced proxy access denials.
- Added staff/customer status surfaces.
- Added evidence and security-review checks.

Phase 5: Customer handoff docs

- Update operating guide and technical guide.
- Add tier selection guidance.
- Added support runbook guidance for leaked `vp-proj-*`.

## Open Questions

- Should Recommended require CIDR-only source checks, or allow trusted gateway headers when the customer cannot provide fixed NAT?
- Should auto-freeze default to organization-wide, project-wide, or provider-slot only?
- Should customers be allowed to request tier changes from their dashboard, with staff approval?
- Should High Security require mTLS, private connectivity, or either one?
- How much source detail should be visible in customer evidence for privacy-sensitive customers?
