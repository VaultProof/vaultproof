# VaultProof Enterprise Admin Guided Customer Onboarding

Last updated: 2026-06-01

This runbook is for VaultProof sales, customer success, support, and technical staff who are onboarding a new Enterprise customer through the staff admin console.

## Readiness Answer

The admin page is ready for guided Enterprise pilots and controlled paid-customer onboarding after the production prerequisites below are confirmed.

It is not yet ready for fully self-serve, unsupervised enterprise onboarding where a customer signs up, configures every security control, moves production traffic, and runs alone without VaultProof staff.

Use this positioning with customers:

```text
VaultProof Enterprise is ready for a guided onboarding. VaultProof staff will help create the business, confirm the first workload, set the proxy access tier, verify customer-safe evidence, and support the first live test.
```

## Production Prerequisites

Before sales schedules a live onboarding session, a VaultProof technical owner must confirm:

1. `admin.vaultproof.dev` is reachable only as the staff admin host.
2. `enterprise.vaultproof.dev` does not expose `/api/v1/internal-admin/*`.
3. Internal admin sign-in is restricted by employee email or domain allowlist.
4. `INTERNAL_ADMIN_ACTIONS_ENABLED` is enabled only for the environment where staff writes are intended.
5. `INTERNAL_ADMIN_APPROVAL_SECRET` is set and stored outside browser-visible code.
6. The Supabase service-role key is server-side only.
7. Required migrations are applied:
   - `supabase/migrations/20260419010000_organization_sso_settings.sql`
   - `supabase/migrations/20260531000000_organization_kms_connections.sql`
   - `supabase/migrations/20260601000000_organization_proxy_access_policies.sql`
8. The internal admin overview at `https://admin.vaultproof.dev/` or `https://admin.vaultproof.dev/app` shows no `migration_required` warning.
9. `npm run test:enterprise-control-plane-smoke` passes on the release candidate.
10. A staff member has manually opened the target business detail page and confirmed the proxy access tier form renders.

Current caveat: proxy access tier code has smoke coverage for admin writes, freeze/thaw, audit events, enforcement, and evidence redaction. Manual browser QA on the live `admin.vaultproof.dev` business detail page is still a required launch check.

## Roles

| Role | Owner | Responsibility |
| --- | --- | --- |
| Sales owner | Max or account owner | Qualify the customer, schedule calls, keep scope tied to one first workload. |
| Technical owner | Nelson or assigned engineer | Configure org, SSO/KMS/proxy tier, provider slot, caller-lock policy, and test traffic. |
| Customer business owner | Customer | Approves pilot scope, business risk, support window, and go-live. |
| Customer security/platform owner | Customer | Provides egress IPs, SSO/KMS requirements, mTLS/private connectivity needs, and security review questions. |
| Customer app owner | Customer | Owns code change, test workload, rollback path, and live validation. |

## Sales Qualification

Use this before technical setup. The goal is to decide whether the customer is a good guided onboarding fit.

1. Ask which external APIs the customer depends on.
2. Ask where those provider keys live today: `.env`, CI, cloud secret manager, internal tools, notebooks, agents, or customer laptops.
3. Ask which one key would hurt most if leaked.
4. Ask whether API calls originate from stable backend egress IPs, private connectivity, or many unmanaged devices.
5. Ask whether they need SSO, customer-managed KMS, mTLS, private connectivity, SOC 2 evidence, or procurement review.
6. Pick one first workload with one app owner, one provider, one upstream host/path set, and one success metric.
7. Confirm they accept a guided onboarding with VaultProof staff present.

Good first workloads are backend service calls with stable ownership, clear provider paths, and a rollback path. Avoid starting with broad personal-device traffic, unknown owners, or many providers at once.

## Tier Decision

Use this tier selection in the admin business detail page.

| Tier | Use When | Customer Must Provide | Staff Setting |
| --- | --- | --- | --- |
| Basic | Sandbox, demo, low-risk pilot, or customer cannot yet provide stable egress IPs. | Workload owner, provider, upstream host/path/methods, expected call volume. | `tier=basic`, `default_provider_scope_mode=deny_unscoped`, rate limit set, `enforcement_mode=monitor` first. |
| Recommended | Default for production pilot traffic. | Everything in Basic plus stable customer egress CIDRs. | `tier=recommended`, CIDRs entered, auto-freeze enabled, rate limit set, monitor first then enforce. |
| High Security | Regulated workload, sensitive production key, or security team requires stronger origin binding. | Everything in Recommended plus mTLS certificate details or private connectivity proof. | `tier=high_security`, require mTLS or private connectivity, auto-freeze enabled, enforce only after proof is verified. |

Default recommendation: use `recommended` for any real production pilot where the customer has stable backend egress IPs.

## Staff Admin Setup

Use this after the customer says yes to a guided onboarding.

1. Sign in at `https://admin.vaultproof.dev/app/login`.
2. Open `https://admin.vaultproof.dev/app` or `https://admin.vaultproof.dev/`.
3. Confirm the overview guardrails:
   - employee allowlist is active
   - admin actions are enabled only if this is a write session
   - no migration warning is shown
   - proxy access policy schema is ready
4. Create or find the customer business.
5. Open the business detail page.
6. Confirm business name, domain, plan, status, and support owner.
7. Invite the first customer owner or confirm the existing owner membership.
8. Record SSO posture in the SSO settings form:
   - company domain
   - provider
   - rollout status: `requested` or `configured`
   - login mode: `sso-first` or `assisted`
   - for temporary email/password or invite-only onboarding, create the customer invite and record the temporary posture in account status or support notes
9. Record AWS customer-managed KMS posture if applicable:
   - AWS account ID
   - AWS region
   - AWS KMS key ARN
   - customer role ARN
   - generated or customer-confirmed external ID
   - verification status
   - no raw secrets in notes
10. Configure proxy access tier:
    - select `basic`, `recommended`, or `high_security`
    - start in `monitor` for first validation unless the customer explicitly approved enforcement
    - enter customer egress CIDRs only if provided by the customer
    - set a conservative default rate limit
    - set `default_provider_scope_mode=deny_unscoped`
    - keep auto-freeze enabled
    - set mTLS/private connectivity requirements only when proof exists
    - use notes for customer-safe rollout context only
11. Save the proxy tier with the internal admin approval secret.
12. Confirm the business detail page shows the expected tier badge and checklist.
13. Open `https://admin.vaultproof.dev/app/onboarding` and create the browser-local activation record:
    - kickoff owner
    - login handoff
    - first workload owner
    - support handoff
    - capacity and renewal review
    - key posture
    - customer testing window
14. Open `https://admin.vaultproof.dev/app/support` and confirm launch-week support scope.
15. Open `https://admin.vaultproof.dev/app/pilot-success` and create the first weekly success tracking record.

## Customer Workspace Setup

Use the customer workspace after the admin record exists.

1. Ask the customer owner to sign in at `https://enterprise.vaultproof.dev/app/login`.
2. Open `/app/projects` and confirm the first project.
3. Open `/app/inventory` and record the API surface:
   - provider
   - upstream host
   - paths
   - methods
   - environment
   - owner
   - sensitivity
   - risk
4. Open `/app/keys` and create or confirm the provider slot. Do not paste raw provider keys in docs, notes, chat, or screenshots.
5. Open `/app/control` and confirm caller-lock policy:
   - allowed provider
   - allowed upstream host
   - allowed path prefixes
   - allowed methods
   - rate limits
   - gateway/client facts if used
6. Confirm the app will use the `vp-proj-*` key only through VaultProof.
7. Run dry-run traffic first.
8. Check `/app/activity` and `/app/audit`.
9. Open `/app/evidence` and confirm customer-safe evidence includes proxy access posture.
10. Open `/app/security-review` for customer security/procurement questions.
11. Open `/app/runbooks` and review leaked `vp-proj-*` response steps with the customer.

## Guided Technical Test

Run this with the customer app owner present.

1. Confirm the test request uses a scoped `vp-proj-*` key.
2. Confirm the request maps to the intended project and provider slot.
3. Confirm upstream host, path, and method match the caller-lock policy.
4. For Recommended, confirm the request comes from an allowed egress CIDR.
5. For High Security, confirm mTLS or private connectivity proof is present.
6. Send a dry-run request.
7. Confirm the response is denied or allowed exactly as expected.
8. Check audit/activity evidence.
9. If dry-run is correct, ask for customer approval to send the first live request.
10. Send a low-risk live request.
11. Confirm upstream result, latency, audit event, and evidence packet.
12. Record the result in `https://admin.vaultproof.dev/app/pilot-success`.

## Freeze And Thaw Procedure

Use this when a `vp-proj-*` key is suspected to be leaked or misused.

1. Open the customer business detail page in internal admin.
2. Freeze proxy access for the organization by setting proxy access `freeze_state=frozen` or by using the approval-gated freeze endpoint.
3. Record the incident ticket or reason in `freeze_reason`.
4. Confirm execute requests are blocked for the organization.
5. Review `/app/activity`, `/app/audit`, and provider-specific logs.
6. Ask the customer to remove the leaked `vp-proj-*` key from the affected app, laptop, CI job, notebook, or secret store.
7. Rotate the VaultProof project key if the key remains exposed or the customer cannot identify all copies.
8. Do not rotate the original provider key unless provider material also leaked or upstream compromise is suspected.
9. After customer remediation, thaw proxy access with approval.
10. Re-test with a fresh scoped request and capture evidence.

## Sales Talk Track

Use this in plain language:

```text
For the first rollout, VaultProof gives you a proxy project key instead of spreading the original provider key across apps. We scope where it can go, rate-limit it, optionally bind it to your egress IPs, and can freeze it quickly if it leaks. For higher-security customers, we add mTLS or private connectivity.
```

Do not say:

- "This is fully self-serve today."
- "You never need to rotate keys."
- "A leaked proxy key is harmless."
- "TEE protects a leaked proxy key."
- "VaultProof can take over production traffic without your app owner and rollback owner present."

Say this instead:

```text
The original provider key is better protected because apps use the VaultProof proxy key. If that proxy key leaks, VaultProof can limit where it works, how fast it works, what provider paths it can call, and can freeze access while your team removes the leaked key.
```

## Customer Intake Checklist

Collect this before the technical onboarding call:

- Company name and domain.
- Business owner and technical owner.
- First workload name.
- App owner and rollback owner.
- Provider name.
- Upstream host.
- Allowed paths and methods.
- Expected monthly and peak call volume.
- Environment: sandbox, staging, or production.
- Customer egress CIDRs if using Recommended.
- mTLS certificate subject or thumbprint if using High Security with mTLS.
- Private connectivity status if using High Security private connectivity.
- AWS KMS account ID, KMS key ARN, role ARN, and key owner if customer-managed AWS KMS is required.
- SSO requirement and identity provider.
- Support window and escalation contact.
- Success metric for the first guided session.

## Launch Gate

Do not move live production traffic until all of these are true:

1. Customer owner approved the first workload scope.
2. App owner and rollback owner are known.
3. Provider slot exists and does not expose raw secret material in notes or screenshots.
4. Caller-lock policy is scoped to provider, host, path, and method.
5. Proxy access tier is saved and visible in admin.
6. Recommended or High Security prerequisites are verified if those tiers are selected.
7. Dry-run test passed.
8. Activity and audit evidence is visible.
9. Customer-safe evidence packet is ready.
10. Support window and incident contact are recorded.

## Status Tracking

Use these staff pages during the lifecycle:

| Stage | Page |
| --- | --- |
| Qualification and walkthrough | `https://admin.vaultproof.dev/app/demo` |
| Customer account setup | `https://admin.vaultproof.dev/app` |
| Paid onboarding | `https://admin.vaultproof.dev/app/onboarding` |
| Support handoff | `https://admin.vaultproof.dev/app/support` |
| Proposal | `https://admin.vaultproof.dev/app/pilot` |
| First test and weekly update | `https://admin.vaultproof.dev/app/pilot-success` |
| Customer security review | `https://enterprise.vaultproof.dev/app/security-review` |
| Customer evidence | `https://enterprise.vaultproof.dev/app/evidence` |
| Customer runbooks | `https://enterprise.vaultproof.dev/app/runbooks` |
