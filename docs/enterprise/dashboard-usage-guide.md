# VaultProof Enterprise Dashboard Usage Guide

Last updated: 2026-04-30

Welcome to VaultProof Enterprise, and congratulations on getting your secure workspace started.

This guide is for teams that have already purchased VaultProof and are ready to set up the product for real business use. Use it to connect your organization, add teammates, configure projects, review security posture, export evidence, and prepare for production traffic.

## Quick Access

| Area | URL | Use It For |
| --- | --- | --- |
| Enterprise login | `https://enterprise.vaultproof.dev/app/login` | Sign in with an approved enterprise account or SSO path. |
| Dashboard | `https://enterprise.vaultproof.dev/app/dashboard` | Start here after login. |
| Setup guide | `https://enterprise.vaultproof.dev/app/setup` | Enterprise implementation guide for identity, gateways, projects, provider keys, policy, evidence, and go-live. |
| Technical guide | `https://enterprise.vaultproof.dev/app/technical-guide` | Detailed implementation reference for identity, network, gateway, caller-lock, key custody, attestation, evidence, rollout, and troubleshooting. |
| AI Proof Verifier | `https://enterprise.vaultproof.dev/app/verifier` | Register external models, verify proof bundles, and store evidence without VaultProof running the model. |
| Production readiness | `https://enterprise.vaultproof.dev/readiness` | Verify the live Azure confidential path is production-ready. |
| Health | `https://enterprise.vaultproof.dev/health` | Lightweight control-plane health check. |

## Related Enterprise Guides

| Guide | Best For | Path |
| --- | --- | --- |
| Customer operating guide | How a business uses VaultProof Enterprise across owners, identity, platform, app teams, security, compliance, launch, and day-2 operations. | `docs/enterprise/customer-operating-guide.md` |
| Technical implementation guide | Architecture, trust boundaries, identity, gateway patterns, key custody, attestation, evidence, rollout, and troubleshooting. | `docs/enterprise/technical-implementation-guide.md` |
| Features and access guide | Built features, URLs, hardening, operator commands, production posture, and handoff references. | `docs/enterprise/features-and-access-guide.md` |

## What Your Team Should Prepare

VaultProof Enterprise usually lands inside a large environment with many teams, apps, providers, and approval paths. Before you configure production traffic, prepare:

- Your approved enterprise login or invite.
- Access to your VaultProof Enterprise organization.
- A supported browser with local storage enabled, because the dashboard stores your session and selected organization locally.
- Business owner, security owner, identity owner, network owner, developer owner, and incident contact.
- Production, staging, development, sandbox, regional, and subsidiary environment inventory.
- Provider inventory: provider name, account, model/API family, current key location, rotation schedule, owner, and blast radius if the key leaks.
- Microsoft Entra ID details for SSO, including the identity admin who can approve enterprise application settings.
- Gateway decision: VaultProof-managed APIM, customer-managed APIM, mTLS gateway, device gateway, or direct Front Door path.
- Compliance needs: SOC 2 evidence, audit exports, access reviews, retention requirements, regulated data handling, and customer-specific proof.

All dashboard pages are served by the enterprise control plane:

```text
enterprise.vaultproof.dev/app/*
  -> enterprise control plane
  -> /api/v1/enterprise/*
```

The enterprise dashboard is served by the enterprise control plane and calls enterprise APIs only.

## Enterprise Implementation Guide

Follow these sections in order the first time your team uses VaultProof. After launch, return to the same pages for daily checks, policy changes, evidence exports, incident review, and quarterly access/key reviews.

### Step 1: Sign In

Open:

```text
https://enterprise.vaultproof.dev/app/login
```

Use one of your approved sign-in paths:

- Email/password for the temporary admin or demo path.
- Microsoft Entra ID SSO when your company sign-in path is configured.
- Invitation acceptance when another admin invited you into the organization.

If you see `Not authenticated. Sign in to VaultProof Enterprise.`, sign in again. Do not paste service-role keys or admin secrets into the browser.

### Step 2: Open The Dashboard And Select The Organization

After login, open:

```text
https://enterprise.vaultproof.dev/app/dashboard
```

At the top:

- Select the active organization from the organization dropdown.
- Use `refresh` if the panels do not update after an invite, policy change, or new activity.
- Use `open control` when you are ready to edit project policy.

### Step 3: Map Your Enterprise Environment

Before adding provider traffic, document the real operating shape of the business.

For each workload, capture:

- Environment: production, staging, development, sandbox, regional, subsidiary, or regulated.
- Calling app or gateway.
- Source origin, gateway marker, CIDR, device fleet, or mTLS identity.
- Provider family and account.
- Allowed upstream host, methods, and path prefixes.
- Expected request volume and rate-limit needs.
- Business owner and security owner.
- Data sensitivity and incident priority.

Create separate VaultProof projects for high-risk boundaries. Do not mix unrelated production and development apps into one policy scope just because they call the same provider.

### Step 4: Confirm Production Readiness

On the `Overview` tab, check `Confidential runtime posture`.

Production-ready means the full path is healthy:

```text
Azure Front Door
  -> Enterprise control plane on Azure Confidential VM
  -> signed loopback handoff
  -> secure executor
  -> Azure Managed HSM Secure Key Release
  -> attestation evidence
```

Click:

- `open readiness JSON` for the full production readiness result.
- `open health JSON` for the lightweight health result.

Do not route production traffic if readiness shows blockers.

### Step 5: Configure Identity And Access

Open `Org + SSO` from the sidebar or the dashboard organization card.

Use it to:

- Confirm organization identity.
- Track Microsoft Entra ID SSO setup.
- Confirm SSO provider status.
- Review session/security notices.

Current SSO model:

```text
Customer Entra ID
  -> Supabase SAML broker/session provider
  -> VaultProof Enterprise organization membership
```

This lets your team use Entra ID while VaultProof keeps one session model across the enterprise dashboard and API.

Enterprise access model:

- Owners approve organization setup, admins, SSO rollout, and go-live timing.
- Admins manage projects, members, provider slots, and policies.
- Security reviewers use readiness, audit, access-review, alerts, and evidence exports.
- Developers/operators configure project rules and troubleshoot runtime activity.
- Viewers can inspect posture without changing policy.

Use the Members page and access-review CSV before rollout, after major org changes, and on a recurring schedule. Enterprise buyers usually need proof that old access was removed.

### Step 6: Invite And Review Members

Open `Members`.

Use it to:

- See owners, IAM admins, security admins, platform admins, developers, auditors, viewers, and legacy roles.
- Create or review invites.
- Assign project access with project-specific roles.
- Revoke pending invites when needed.
- Export access-review evidence.

Recommended invite roles:

| Invite Role | Use It When |
| --- | --- |
| IAM Admin | The person manages users, SSO, access reviews, or project assignments. |
| Security Admin | The person manages policy, protected provider access, incident response, or evidence. |
| Platform Admin | The person manages gateway/APIM/TLS, production readiness, or runtime operations. |
| Developer | The person is building or testing an assigned project integration. |
| Auditor | The person needs read-only compliance, audit, and access-review evidence. |
| Viewer | The person needs read-only business visibility. |

Recommended project roles:

| Project Role | Use It When |
| --- | --- |
| Project Owner / Project Admin | The person owns policy, provider slots, and rollout for one project. |
| Operator | The person can run approved traffic and review activity, but should not change security policy. |
| Developer | The person can integrate and test the project, but should not change provider slots. |
| Auditor | The person needs read-only project evidence and activity. |
| Viewer | The person only needs project summary visibility. |

Before inviting the broader team, confirm:

- Privileged roles are limited to the right people.
- Pending invites are expected.
- Project access matches your role plan.
- Access review CSV exports correctly.

### Step 7: Choose The Gateway And Network Pattern

VaultProof supports multiple enterprise traffic patterns. Pick the one that matches your organization’s network and governance rules.

VaultProof-managed gateway:

- Fastest path.
- Customer apps call `enterprise.vaultproof.dev`.
- VaultProof manages Front Door/APIM controls, coarse rate limits, origin lock, request-size guards, and telemetry.

Customer-managed APIM:

- Best when the customer requires all third-party API traffic through their own Azure API Management.
- Customer APIM validates customer identity, device, mTLS, or subscription policy first.
- Customer APIM forwards trusted caller-lock headers to VaultProof.

mTLS or device gateway:

- Best for server, device, IoT, or fleet traffic.
- Use certificate thumbprints, certificate subject fragments, device identity hashes, fleet IDs, firmware versions, CIDRs, and gateway markers.

Private/TLS origin hardening:

- Use this after the basic production path is stable.
- Plan TLS-origin cutover, APIM cutover, private-origin migration, and rollback during a controlled change window.

### Step 8: Configure Projects And Policy

Open `Projects` first, then `Control`.

Use `Projects` to inspect:

- Project inventory.
- Project health.
- Provider slot count.
- Policy status.
- Quick links into Control.

Use `Control` to configure:

- Provider allowlists.
- Caller-lock rules.
- Allowed origins.
- Allowed upstream methods, hosts, and path prefixes.
- Rate limits.
- Secure execution settings.
- Project-level and provider-level overrides.

Caller lock can bind execution to approved browsers, servers, gateways, devices, fleets, firmware versions, CIDRs, mTLS identities, providers, methods, hosts, and paths.

### Step 9: Review Provider Slots And Key Custody

Open `Provider slots`.

Use it to:

- View active provider slots.
- Confirm rotation state.
- Review Secure Key Release notes.
- Emergency-revoke a provider slot if a key or integration is no longer trusted.

Provider keys should not be visible in the dashboard. Enterprise execution reconstructs provider key material only inside confidential execution memory and zeroes plaintext after use.

For each slot, record:

- Provider owner.
- Business purpose.
- Rotation date.
- Emergency revoke approver.
- Expected project usage.
- Whether the key is production, staging, or development.

Use emergency revoke if a provider key, integration, project, or workload is no longer trusted.

### Step 10: Test With Dry-Run Traffic

Before sending real provider traffic, use dry-run or validate-only execution where possible.

Dry-run should prove:

- User/session auth works.
- Organization and project permissions are correct.
- Caller-lock rules match the expected origin, gateway, device, mTLS identity, CIDR, host, method, and path.
- The control plane can sign the secure execution envelope.
- The secure executor is reachable.
- Audit metadata is written.
- Provider dispatch is skipped until the team is ready.

### Step 11: Check Runtime Activity

Open `Activity`.

Use it to inspect:

- Proxy and executor events.
- Status codes.
- Latency.
- Provider request IDs.
- Attestation summaries.
- Recent runtime behavior after policy changes.

If a user says a request failed, start here after checking `readiness`.

### Step 12: Export Audit And Compliance Evidence

Open `Audit`.

Use it to:

- Search governance/runtime events.
- Filter recent activity.
- Export CSV evidence.
- Review customer-verifiable metadata.

Useful exports:

- `Audit CSV` from the sidebar.
- `Access review CSV` from the sidebar.
- `/api/v1/enterprise/audit?format=csv&days=30`
- `/api/v1/enterprise/members/access-review?format=csv`

### Step 13: Set Up Alerts

Open `Alerts`.

Use it to:

- Manage alert destinations.
- Review delivery logs.
- Inspect dispatch runs.
- Check alert policy state.
- Run admin test-send workflows.

Before relying on incident notifications, send a test alert and confirm the destination receives it.

Decide who receives:

- Key leak or emergency revoke events.
- Readiness drift.
- Denial spikes.
- Provider error spikes.
- Runtime availability issues.
- Access or policy changes.

### Step 14: Go Live Gradually

Do not move every app at once.

Recommended rollout:

1. Choose one low-risk production workload.
2. Confirm readiness is production-ready.
3. Confirm SSO/admin access works.
4. Confirm provider slot and policy are locked.
5. Send low-volume traffic.
6. Watch Activity, Audit, Alerts, readiness, provider denials, and provider errors.
7. Expand by project only after the first workload is stable.

### Step 15: Use Plans And Runbooks For Cutover Work

Open `Plans` for rollout state and APIM/TLS notes.

Open `Runbooks` for operational commands and hardening work:

- Production verification.
- Evidence capture.
- Evidence validation.
- Deployment.
- Secret verification and rotation planning.
- TLS origin cutover.
- APIM cutover.
- SSH hardening.
- Container Apps cleanup.

Use runbooks before making infrastructure changes. Many scripts default to read-only planning unless confirmation environment variables are set.

## Dashboard Tabs

### Overview

Use this tab first.

It shows:

- Production runtime state.
- Project count.
- Member count.
- 30-day call volume.
- Organization summary.
- Quick actions for readiness, access review, and policy control.

Best for:

- Daily health check.
- Pre-customer-demo check.
- Confirming whether it is safe to invite users or route traffic.

### Security

Use this tab to understand the security posture.

It shows:

- Confidential VM status.
- Secure Key Release status.
- Replay protection.
- TLS/APIM cutover status.
- Evidence links.
- Security control links.

Best for:

- Security reviews.
- Customer proof conversations.
- Confirming the key path is hardware-bound and attestation-gated.

### Access

Use this tab to manage identity readiness.

It shows:

- Members and pending invites.
- Privileged role counts.
- SSO setup checklist.
- Alert setup checklist.

Best for:

- Customer onboarding.
- Pre-rollout privileged-access review.
- Access-review evidence.

### Operations

Use this tab for live usage.

It shows:

- Project health.
- Recent runtime activity.
- Recent audit events.
- Operator shortcuts.

Best for:

- Troubleshooting failed calls.
- Watching traffic after a policy change.
- Checking recent governance events.

### Workspace

Use this tab as the feature map.

It links to every enterprise app area:

- Production readiness.
- Health.
- Policy control.
- Projects.
- Provider slots.
- Activity.
- Members.
- Audit.
- Alerts.
- Org + SSO.
- Settings.
- Plans.
- Scanner.
- Runbooks.

Best for:

- Finding the right page quickly.
- Training a new operator.
- Making sure all dashboard links resolve.

## Sidebar Navigation

| Sidebar Group | Link | What To Do There |
| --- | --- | --- |
| workspace | Dashboard | Start here; review setup, readiness, posture, and shortcuts. |
| workspace | Projects | Review project inventory, provider slots, and project health. |
| workspace | API Inventory | Review metadata-only API surfaces, owners, environment, risk, provider-slot mapping, policy posture, traffic evidence, and review status. |
| workspace | Policy Drift | Review control gaps, accepted-risk records, owners, compensating controls, expiration dates, and launch hold status. |
| workspace | Rollout Manager | Plan one workload cutover with integration mode, app/gateway owners, canary percentage, rollback path, blockers, and evidence export. |
| workspace | Activity | Inspect runtime/proxy/executor events. |
| workspace | Alerts | Configure alert destinations and test delivery. |
| workspace | Control | Edit project policy, caller lock, providers, and execution settings. |
| workspace | AI Proof Verifier | Register external models, submit proof bundles, and review verification evidence. |
| workspace | Org + SSO | Configure organization settings and Entra/Supabase SAML SSO. |
| evidence | Members | Manage members, invites, project access, and access reviews. |
| evidence | Audit | Search events and export governance/runtime evidence. |
| evidence | Provider slots | Review active provider slots, rotation, and emergency revoke. |
| evidence | Audit CSV | Download audit evidence. |
| evidence | Access review CSV | Download members/access evidence. |
| setup | Setup guide | Follow the enterprise implementation guide and open the right setup pages. |
| setup | Technical guide | Read detailed identity, network, gateway, key custody, attestation, evidence, and troubleshooting guidance. |
| setup | Settings | Review tenant defaults and session/security notices. |
| setup | Plans | Track APIM, TLS, limits, rollout, and handoff notes. |
| setup | Scanner | Record redacted repository exposure findings, owners, rotation/remediation status, and customer-safe scanner evidence. |
| setup | Runbooks | Use operator commands for verification, deployment, evidence, and hardening. |
| setup | Sign out | Clear the local enterprise session and return to the login page. |

## Feature Reference

### Organization Selection

The dashboard stores the selected organization in local storage under:

```text
vaultproof_active_org
```

Most authenticated enterprise API calls include:

```text
x-vaultproof-organization: <organization id>
Authorization: Bearer <user session token>
```

If panels look empty, confirm the selected org is correct and refresh.

### Production Readiness

Readiness is the top-level yes/no signal for the production-confidential path.

It checks:

- Control plane health.
- Executor reachability.
- Secure execution readiness.
- Signature verification readiness.
- Secure Key Release mode.
- Hardware-bound key release.
- Attestation evidence.
- Replay protection.
- Production blockers.

Use it before executive demos, team rollout, APIM/TLS cutovers, and real provider traffic.

### Policy Control

Control is where admins tighten how projects are allowed to call providers.

Policy categories include:

- Provider allowlists.
- Caller-lock origin rules.
- Gateway/device/fleet identity rules.
- mTLS identity rules.
- Upstream method/host/path restrictions.
- Rate limits.
- Secure execution settings.
- Emergency revoke flow through provider slots.

### AI Proof Verifier

AI Proof Verifier is the verifier-first AI/ML proof evidence page. VaultProof does not run the model. Your app, provider, or partner execution path runs the model and sends VaultProof a proof bundle or attestation record.

Demo proof records use shared enterprise runtime attestation. In plain English: the demo points to the same production-ready VaultProof confidential runtime proof instead of creating a separate fake attestation for each demo. The model still runs outside VaultProof, and the evidence record should say that clearly.

Use it to understand and later configure:

- Proof bundle verification for model outputs.
- Evidence records that say which verifier, model, project, actor, and timestamp were involved.
- Azure Confidential VM attestation and Secure Key Release posture attached to compute evidence.
- Shared demo attestation mode for demo records that need one reusable confidential runtime proof.
- Project RBAC, caller-lock facts, rate limits, allowed model IDs, and verifier version pinning.
- Guardrails that keep model execution and managed proving outside VaultProof.

The first safe production slice is verifier-first: register the external model, accept a proof bundle, verify/store the decision, and export evidence. Model execution stays outside VaultProof.

### Evidence

Evidence is split into two main exports:

- Audit evidence: governance/runtime events.
- Access-review evidence: members, roles, invites, and project access.

Use evidence exports for:

- Customer handoff.
- SOC 2 preparation.
- Security reviews.
- Incident review.
- Access recertification.

### Runbooks

Runbooks are for operators, not everyday customer users.

Use them when you need to run:

```bash
npm run verify:enterprise-production
npm run evidence:enterprise-production
npm run validate:enterprise-evidence
npm run status:enterprise-hardening
npm run gate:enterprise-finish
npm run gate:enterprise-handoff
npm run deploy:enterprise-vm
npm run verify:enterprise-secrets
npm run prepare:enterprise-secret-rotation
npm run prepare:enterprise-origin-tls
npm run verify:enterprise-origin-tls
npm run prepare:enterprise-apim-jwt
npm run prepare:enterprise-mtls
npm run test:enterprise-apim-policies
```

Prefer read-only plan commands first. Only use confirmation-gated mutation commands when the current plan says the cutover is ready.

## Recommended Daily Operator Flow

1. Open `/app/dashboard`.
2. Confirm the selected organization.
3. Check the `Overview` runtime posture.
4. Open `/readiness` if the dashboard says `watch` or `not production ready`.
5. Review `Operations` for recent activity and project health.
6. Review `Alerts` if any runtime or readiness issue appears.
7. Export audit/access evidence when needed.
8. Use `Runbooks` for hardening, deployment, or customer handoff work.

## Recommended Customer Onboarding Flow

1. Create or select the customer organization.
2. Configure organization identity and Entra SSO.
3. Invite owners/admins first.
4. Add project access for the right users.
5. Configure project policy in Control.
6. Add or rotate provider slots through the approved secret process.
7. Confirm production readiness.
8. Run safe dry-run execution QA.
9. Export audit and access-review evidence.
10. Enable alerts and test delivery.
11. Move to real provider traffic only after readiness and policy checks pass.

## Troubleshooting

### I Am Not Authenticated

Go to:

```text
/app/login
```

Sign in again. If SSO is expected but unavailable, use the current approved demo/admin path or finish Org + SSO setup first.

### The Dashboard Is Empty

Check:

- You are signed in.
- The org dropdown has the correct organization.
- The user belongs to the selected organization.
- The enterprise API is reachable.
- `/readiness` and `/health` return JSON.

### The Dashboard Loads Slowly

Common causes:

- The dashboard is fetching several authenticated panels.
- The first org lookup must complete before org-specific data can load if no active org is stored.
- `/readiness` checks the executor path and may wait briefly for health.
- Supabase-backed org/project/member/audit queries can add latency.

Practical fixes:

- Keep the active org selected.
- Click `refresh` after changing access or policy.
- Use the specific sidebar page if you only need one dataset.
- If this stays slow, build or use an aggregated dashboard summary endpoint.

### Production Readiness Is False

Open `/readiness` and read `production_blockers`.

Common blockers:

- Executor not reachable.
- Secure Key Release not configured.
- Attestation evidence missing.
- Replay protection disabled.
- Key release mode is demo instead of Azure Secure Key Release.
- TLS/APIM/hardening cutover item still pending.

### A User Cannot Access A Project

Check:

- Members page for user role and organization membership.
- Project assignment.
- Pending invite status.
- SSO mapping or email match.
- Audit events for denied access.

### A Provider Call Fails

Check:

- Production readiness.
- Project policy in Control.
- Provider slot status.
- Caller-lock origin/gateway/device fields.
- Activity page for status code and executor metadata.
- Audit page for policy denial or secure execution event.

## What Is Ready vs Pending

Ready:

- Enterprise login and authenticated dashboard.
- Universal enterprise sidebar.
- Dashboard overview/security/access/operations/workspace tabs.
- Org selection.
- Production readiness and health links.
- Projects, activity, alerts, control, org, members, audit, provider slots, settings, plans, scanner, and runbooks pages.
- Audit CSV and access-review CSV exports.
- Confidential VM production readiness path.
- Secure Key Release status in readiness.
- Operator runbook links.

Pending or still operationally controlled:

- Scanner is now a metadata-only exposure intake for the demo. It does not upload repositories or raw secret values; persistent scanner APIs and audited CI imports can come later.
- APIM route cutover is planned/verified but not the active Front Door path yet.
- Origin TLS cutover needs final trusted cert/DNS/NSG/cutover work.
- SSH closure waits for alternate access or break-glass readiness.
- Old Container Apps cleanup is planned but should happen only after rollback risk is accepted.
- Setup-time secrets should be rotated before external customer production use.

## Related Docs

- `docs/enterprise/features-and-access-guide.md`
- `docs/plans/2026-04-26-enterprise-most-secure-build.md`
- `infra/azure/enterprise-secure-runtime/README.md`
