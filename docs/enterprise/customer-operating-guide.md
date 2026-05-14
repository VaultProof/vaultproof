# VaultProof Enterprise Customer Operating Guide

Last updated: 2026-04-30

This guide explains how a business should use VaultProof Enterprise after purchase. It is written for customer admins, identity teams, platform teams, app owners, security teams, and compliance reviewers.

It is the customer operating model: what each team does, which dashboard pages they use, how rollout should happen, and how the business runs VaultProof after launch.

## What VaultProof Enterprise Does

VaultProof Enterprise helps a business stop putting raw provider/API keys inside apps, `.env` files, CI variables, logs, browser code, and team handoffs.

Instead of every app holding dangerous provider keys, the business routes sensitive provider calls through VaultProof Enterprise:

```text
business app
  -> approved gateway path
  -> VaultProof Enterprise control plane
  -> signed secure execution request
  -> Azure confidential executor
  -> attestation-gated key release
  -> provider call
```

The business gets:

- A safer place to operate provider access.
- Project-level policy for which apps can use which providers.
- Caller-lock rules that bind access to expected origins, gateways, networks, devices, certificates, or fleets.
- Secure Key Release and Azure confidential execution for protected key use.
- Audit logs, access-review exports, alerts, and readiness checks for security review.
- Operator runbooks for deploys, evidence, TLS/APIM cutover, SSH hardening, and cleanup.

## How Enterprise SaaS Customers Usually Use Products Like This

Enterprise SaaS rollout is not just “create an account and click start.” Mature business customers usually do the same pattern:

1. Pick an owner and a pilot use case.
2. Connect company identity and access lifecycle.
3. Assign roles by job responsibility.
4. Integrate one business workflow first.
5. Test in a safe mode before production.
6. Review logs, alerts, and evidence.
7. Expand one team/app/environment at a time.
8. Run recurring access, audit, and incident reviews.

VaultProof Enterprise should be used the same way. Start with one real project, one provider path, one owner group, and one rollout plan. After that path is stable, expand.

## Enterprise SaaS Patterns Used As Reference

These are common patterns from mature enterprise SaaS docs that shaped this guide:

- Microsoft Entra provisioning describes automatic creation, update, and removal of user identities and roles for SaaS apps, usually using SCIM and assignment-based scoping.
- Okta app integrations centralize SSO, provisioning, and security policies across connected apps.
- Slack Enterprise SCIM supports creating, deactivating, syncing, and updating members and user groups from an identity provider.
- Atlassian, Slack, and Datadog all position audit logs as a way for admins/security teams to understand user activity, configuration changes, compliance posture, and suspicious behavior.
- Stripe go-live guidance emphasizes testing edge cases, reviewing error handling/logging, ensuring production endpoints exist, and rotating/securing keys before launch.
- Cloudflare Zero Trust onboarding patterns use guided setup flows plus extra context explaining what each step accomplishes and why it matters.

## Product Areas

VaultProof Enterprise has four main product areas.

| Area | What It Means | Primary Users |
| --- | --- | --- |
| VaultProof Protect | Provider key custody, provider slots, rotation state, emergency revoke, and key-release posture. | Security, platform, app owners. |
| VaultProof Gateway | The approved path apps use to reach protected providers through Front Door, APIM, mTLS, device, or private-origin patterns. | Network, platform, app teams. |
| VaultProof Control | Organization, SSO, members, roles, projects, caller lock, provider allowlists, upstream policy, and rate limits. | Admins, identity, platform, app owners. |
| VaultProof AI Proof Verifier | Verifiable AI/ML proof evidence: external model registry, proof bundle verification, shared demo attestation, Azure confidential attestation binding, and policy gates. VaultProof does not run the model. | AI platform, security, compliance, app owners. |
| VaultProof Evidence | Audit logs, activity, access-review exports, readiness, alert history, evidence bundles, and compliance proof. | Security, compliance, audit, incident response. |

## Customer Roles

Most enterprise customers should name people for these jobs.

| Role | What They Own | VaultProof Pages |
| --- | --- | --- |
| Business owner | Why VaultProof is used, budget, rollout scope, go-live approval, business risk. | Dashboard, Setup guide, Plans. |
| Security owner | Policy, key custody, audit, incident response, readiness, evidence, reviews. | Dashboard, Provider slots, Audit, Alerts, Runbooks, Readiness. |
| Identity owner | SSO, groups, user lifecycle, access assignment, deprovisioning. | Org + SSO, Members, Access review CSV. |
| Platform owner | Gateway pattern, APIM, Front Door, TLS, networking, reliability. | Technical guide, Plans, Runbooks, Readiness. |
| Application owner | Which app uses which provider, request paths, rate limits, errors, launch timing. | Projects, Control, Activity. |
| Compliance reviewer | Access evidence, audit records, production proof, customer questionnaire support. | Audit, Members, Runbooks, Features guide. |
| Incident responder | Leak response, revoke decisions, traffic pause, evidence export, recovery. | Alerts, Provider slots, Activity, Audit, Runbooks. |

## Role-Based Playbooks

Use these playbooks to make ownership clear. In large companies, VaultProof works best when each team knows its part and nobody assumes another team is quietly handling security-critical work.

### Business Owner Playbook

The business owner decides why VaultProof is being used and what “ready” means.

First tasks:

1. Pick the first business workflow to protect.
2. Name the app owner, security owner, and platform owner.
3. Decide the launch window and rollback expectation.
4. Confirm which compliance or customer-trust evidence is required.
5. Approve the first production go-live only after readiness, dry-run, alerts, and audit exports are clean.

Recurring tasks:

- Review monthly rollout status.
- Confirm more teams are added only after the first path is stable.
- Ask for access-review and audit evidence before major customer/security reviews.
- Ensure provider-key ownership is not orphaned when teams reorganize.

Questions to ask:

- Which provider key would hurt the business most if leaked?
- Which app should move first?
- Who can approve emergency revoke?
- What evidence does the customer/security team need before launch?

### Identity Owner Playbook

The identity owner controls who can sign in and how users leave cleanly.

First tasks:

1. Configure the approved Microsoft Entra ID SSO path.
2. Decide which users or groups are assigned to VaultProof.
3. Confirm MFA and conditional access requirements.
4. Confirm break-glass access for SSO outages or identity changes.
5. Work with VaultProof admins to map company roles to VaultProof roles.

VaultProof organization roles:

| Role | Best For | Access Level |
| --- | --- | --- |
| Owner | Executive/security owner and break-glass owner. | Full workspace control, ownership transfer, archive/restore, and final authority. |
| IAM Admin | Identity team. | Invites users, changes roles, assigns project access, manages SSO rollout, and exports access reviews. |
| Security Admin | Security engineering, SecOps, GRC. | Security policy, provider slot controls, alerts, evidence, and project security operations. |
| Platform Admin | Platform/network/SRE. | Gateway, runtime readiness, APIM/TLS coordination, project policy, and runbooks. |
| Developer | Application teams. | Assigned project work only. Use project roles for execution permissions. |
| Auditor | Compliance reviewers and external audit prep. | Read-only audit, evidence, readiness, and access-review visibility. |
| Viewer | Business stakeholders. | Read-only dashboard visibility. |
| Admin / Member | Legacy compatibility roles. | Use narrower roles for new access whenever possible. |

Recurring tasks:

- Remove access when users leave or change teams.
- Review owner, admin, IAM admin, security admin, and platform admin roles monthly.
- Export access review evidence before audits.
- Confirm temporary access was removed after onboarding.

Questions to ask:

- Which Entra group controls VaultProof access?
- Who owns changes to that group?
- How quickly can access be removed for a departing employee?
- Which users need admin access versus read-only review?

### Platform And Network Owner Playbook

The platform owner controls the path between business apps and VaultProof.

First tasks:

1. Pick the gateway pattern: VaultProof-managed edge, customer APIM, mTLS, device gateway, or private-origin phase.
2. Decide which caller-lock facts the gateway can reliably provide.
3. Confirm DNS, TLS, APIM, Front Door, firewall, and monitoring requirements.
4. Test health and readiness before production.
5. Document rollback steps for gateway, TLS, APIM, and routing changes.

Recurring tasks:

- Review readiness before major routing changes.
- Confirm health probes still match the live service.
- Review APIM/gateway logs if denials or errors spike.
- Keep break-glass access ready before closing SSH or changing origin access.

Questions to ask:

- Can the gateway strip spoofed headers before setting trusted caller-lock headers?
- Which networks, certificates, devices, or service identities are trustworthy?
- What happens if Front Door/APIM cannot reach the origin?
- How do we rollback within minutes?

### Application Owner Playbook

The application owner moves one app away from raw provider-key storage.

First tasks:

1. Identify the provider call the app needs.
2. Document upstream host, path, method, request volume, and expected errors.
3. Remove direct provider-key dependency from the app design.
4. Work with admins to create the project and provider slot.
5. Run dry-run before real provider dispatch.
6. Watch activity during low-volume launch.

Recurring tasks:

- Review denials after releases.
- Tell security before changing upstream paths or request shape.
- Confirm old provider keys were removed from app env vars and CI.
- Participate in rotation tests.

Questions to ask:

- Which raw keys does this app still hold?
- Which exact provider paths does the app need?
- What traffic volume is normal?
- What should happen when VaultProof denies a request?

### Security And Compliance Playbook

Security and compliance teams use VaultProof to prove access is controlled and provider key use is monitored.

First tasks:

1. Review project model and provider-slot ownership.
2. Confirm caller lock is strict enough for production.
3. Confirm audit export and access-review export work.
4. Confirm alert destinations and test delivery.
5. Confirm `/readiness` is production-ready before go-live.

Recurring tasks:

- Export access review monthly or quarterly.
- Review provider slot ownership and rotation schedules.
- Review emergency revokes and policy loosenings.
- Review audit events before customer/security questionnaires.
- Confirm readiness after infrastructure changes.

Questions to ask:

- Can we prove who changed project policy?
- Can we prove who had access during a time window?
- Can we prove which project used which provider slot?
- Can we prove the executor was production-ready?

### Incident Responder Playbook

Incident responders use VaultProof to pause unsafe provider access quickly and preserve evidence.

First tasks:

1. Know where Alerts, Provider slots, Activity, Audit, and Runbooks live.
2. Know who can emergency revoke.
3. Know how to export audit/activity evidence.
4. Know how to rotate provider material.
5. Know who can approve restoring traffic.

During an incident:

1. Identify affected provider slot and project.
2. Emergency revoke if provider access may be unsafe.
3. Export audit/activity evidence.
4. Rotate provider material if exposure is possible.
5. Tighten caller lock if the allowed path was too broad.
6. Restore traffic only after owner/security approval.

After an incident:

- Document root cause.
- Review alert timing.
- Review policy gaps.
- Confirm stale provider material is revoked.
- Add the lesson to the customer runbook.

## Dashboard Pages And When To Use Them

| Page | Use It When |
| --- | --- |
| Dashboard | You need the current workspace summary, readiness posture, projects, members, recent activity, and shortcuts. |
| Setup guide | You are onboarding the business or a new large team and need the step-by-step path. |
| Technical guide | A technical reviewer needs architecture, trust boundaries, identity, gateway, key custody, attestation, or troubleshooting detail. |
| Org + SSO | Identity admins are configuring company sign-in, SSO rollout, or organization settings. |
| Members | Admins invite teammates, assign roles, manage project access, and export access reviews. |
| Projects | App/platform teams review project inventory, project health, provider slots, and policy posture. |
| Control | Admins configure caller lock, provider allowlists, upstream method/host/path policy, rate limits, and execution settings. |
| AI Proof Verifier | AI/platform/security teams register external models, submit proof bundles, review verification evidence, and keep model execution outside VaultProof. |
| Provider slots | Security/platform teams review active providers, rotation state, Secure Key Release posture, and emergency revoke. |
| Activity | Operators inspect runtime events, provider status codes, request IDs, denials, latency, and attestation summaries. |
| Audit | Security/compliance teams search governance/runtime events and export CSV evidence. |
| Alerts | Admins configure destinations, review delivery logs, and test alert delivery. |
| Runbooks | Operators run verification, evidence, deployment, hardening, TLS/APIM, SSH, and cleanup commands. |
| Settings | Admins review tenant defaults and security notices. |
| Plans | Owners track APIM, TLS, limits, packaging, and rollout notes. |
| Scanner | Teams record redacted repository exposure findings, owners, rotation/remediation status, and evidence references without uploading repo contents or secret values. |

## Recommended First Rollout

Start with one low-risk but real production use case.

Good first use case:

- One application.
- One provider.
- One environment.
- One owner team.
- Clear expected traffic volume.
- Clear rollback path.
- Clear security reviewer.
- No urgent customer deadline during the first test.

Avoid starting with:

- Many apps at once.
- Multiple provider accounts at once.
- A high-volume production path with no dry-run history.
- A provider key nobody owns.
- Traffic that cannot be rolled back.

## Phase 1: Prepare The Business

Before touching production traffic, collect:

- Business owner.
- Security owner.
- Identity owner.
- Platform/network owner.
- Application owner.
- Incident contact.
- Provider inventory.
- Environment list.
- Compliance needs.
- Gateway preference.
- First pilot project.
- Rollback plan.

Output of this phase:

- A named first project.
- A named first provider slot.
- A named first owner team.
- A decision about identity and gateway pattern.
- A decision about what evidence is needed for launch approval.

## Phase 2: Connect Identity And Access

Production users should use company identity.

Recommended operating model:

1. Configure Microsoft Entra ID SSO through the approved VaultProof Enterprise path.
2. Decide which Entra groups or users can sign in.
3. Add only required admins first.
4. Assign VaultProof roles based on job responsibility.
5. Keep one documented break-glass path for SSO changes or identity outages.
6. Export an access review before go-live.

For users:

- Owners approve major rollout and emergency actions.
- Admins configure projects, policy, members, and provider slots.
- Security reviewers inspect evidence and alerts.
- Developers/operators troubleshoot project runtime behavior.
- Viewers inspect posture without changing policy.

When someone changes teams or leaves the company:

- Remove or update the user from the IdP group.
- Confirm VaultProof organization/project access changed.
- Export or review audit/access evidence if the user had admin or provider access.

## Phase 3: Model Projects Around Business Risk

Create projects based on security and ownership boundaries.

Use separate projects for:

- Production vs staging.
- Regulated vs non-regulated flows.
- Different subsidiaries or regions.
- Different app owner teams.
- Different provider accounts.
- Different incident response owners.
- Different rate limits.
- Different caller-lock facts.

Each project should document:

- Name.
- Business purpose.
- App owner.
- Security owner.
- Environment.
- Allowed provider.
- Allowed upstream host/path/method.
- Caller-lock requirements.
- Expected volume.
- Rotation owner.
- Emergency revoke contact.

## Phase 4: Choose The Gateway Pattern

The gateway is how the business proves a request came from the right app, network, device, certificate, or internal API platform.

### VaultProof-Managed Gateway

Use this when the business wants the fastest enterprise rollout.

The app calls:

```text
https://enterprise.vaultproof.dev
```

VaultProof manages the edge route, origin lock, readiness, health, and rollback tooling.

### Customer-Managed APIM

Use this when the customer requires all API traffic to pass through its own Azure API Management.

Customer APIM should:

- Validate Entra JWTs, mTLS certificates, subscriptions, device identity, or internal policy.
- Strip spoofable caller-lock headers from inbound requests.
- Set trusted caller-lock headers after validation.
- Apply customer-side quotas and rate limits.
- Forward to the VaultProof Enterprise route.
- Log request metadata into customer monitoring/SIEM if required.

VaultProof still enforces organization/project/policy checks after APIM.

### mTLS Or Device Gateway

Use this when callers are servers, devices, agents, or fleets.

Caller-lock facts can include:

- Certificate thumbprint.
- Certificate subject.
- Device ID.
- Fleet ID.
- Firmware version.
- Gateway marker.
- CIDR.
- Region.

## Phase 5: Add Provider Slots

Provider slots represent protected provider access for a project.

Before adding a provider slot, answer:

- Which provider is this?
- Which app needs it?
- Which project owns it?
- Which environment is it for?
- Who owns rotation?
- What is the emergency revoke path?
- What is the expected traffic volume?
- Which upstream hosts and paths are allowed?
- Is the provider key already present in any app, repo, CI system, or team doc?

After adding a provider slot:

- Do not paste raw provider keys into tickets, docs, chat, or browser screenshots.
- Confirm the provider slot appears in the dashboard.
- Confirm Secure Key Release/readiness state.
- Configure caller lock before real traffic.
- Plan rotation before go-live if the key was used during setup.

## Phase 6: Configure Caller Lock And Policy

Caller lock is what prevents a stolen token or copied request from being enough.

Strong policy should include as many trustworthy facts as the business can provide:

- Allowed origin.
- Gateway marker.
- APIM trusted header.
- CIDR.
- mTLS certificate thumbprint.
- Device ID.
- Fleet ID.
- Firmware version.
- Service identity.
- Allowed provider.
- Allowed upstream host.
- Allowed upstream path.
- Allowed HTTP method.
- Rate limit.

Business guidance:

- Start strict.
- Use dry-run to discover missing legitimate caller facts.
- Do not loosen policy globally for one app problem.
- Prefer per-project or per-provider overrides.
- Review denial logs before changing policy.

## Phase 7: Test With Dry-Run

Dry-run is the required safety step before real provider calls.

Dry-run proves:

- User/session is valid.
- Organization and project access work.
- Caller-lock facts match.
- Provider allowlist is correct.
- Upstream method/host/path policy works.
- Control plane can sign the request.
- Executor is reachable.
- Replay protection is active.
- Audit metadata is written.
- Provider dispatch is intentionally skipped.

Do not launch production provider traffic until dry-run is clean.

## Phase 8: Go Live

Use this go-live checklist.

### Business Approval

- Business owner approves the first workload.
- Security owner approves policy.
- App owner approves request shape and expected volume.
- Platform owner approves gateway path.
- Incident contact is available during launch.

### Technical Approval

- `/readiness` is production-ready.
- SSO/admin access is confirmed.
- Provider slot is active.
- Caller lock is configured.
- Alert destination test passes.
- Audit export works.
- Access-review export works.
- Dry-run passes.
- Rollback path is documented.

### Launch Approach

1. Start with low-volume traffic.
2. Watch Activity, Audit, Alerts, and provider errors.
3. Confirm expected denials are explained.
4. Confirm no raw provider key is needed by the app.
5. Increase traffic gradually.
6. Do not add a second app until the first path is stable.

## Day-2 Operations

After launch, VaultProof should become part of normal security operations.

### Daily

- Check dashboard readiness.
- Review alert delivery.
- Look at unusual denials or errors.
- Confirm critical provider paths are healthy.

### Weekly

- Review Activity for abnormal traffic.
- Review Audit for admin/policy changes.
- Confirm provider slots match current projects.
- Check unresolved alerts.

### Monthly

- Export access review.
- Review admins and project roles.
- Review provider slot ownership.
- Confirm rotation schedules.
- Review policy loosenings or emergency overrides.

### Quarterly

- Rotate provider material based on policy.
- Review SSO/group assignment.
- Review incident runbooks.
- Export compliance evidence.
- Revalidate gateway and origin posture.
- Confirm break-glass access still works.

## Common Workflows

### Onboard A New Application

1. Create or select the project.
2. Add the app owner and security reviewer.
3. Document provider and upstream needs.
4. Choose gateway pattern.
5. Configure caller lock.
6. Add provider slot.
7. Run dry-run.
8. Review audit/activity.
9. Approve low-volume production.
10. Watch alerts and denials after launch.

### Add A New Team

1. Add users through SSO/invite path.
2. Assign least-privilege roles.
3. Grant project access only where needed.
4. Export an access review.
5. Confirm the team can see only its projects.
6. Remove temporary admin access after setup.

### Rotate A Provider Key

1. Identify affected project and provider slot.
2. Notify app owner and incident contact if needed.
3. Add or prepare replacement provider material.
4. Verify secure execution readiness.
5. Run dry-run.
6. Cut traffic to replacement material.
7. Revoke old provider material.
8. Export audit evidence.

### Respond To A Suspected Leak

1. Open Alerts and Audit.
2. Identify provider slot and affected projects.
3. Emergency revoke provider slot if needed.
4. Review Activity for suspicious calls.
5. Rotate provider material.
6. Tighten caller lock if a route was too broad.
7. Export incident evidence.
8. Document lessons learned.

### Investigate A Denied Request

1. Open Activity.
2. Find request time, project, provider, and denial reason.
3. Check caller-lock facts.
4. Check upstream host/path/method policy.
5. Check rate limits.
6. Check provider slot state.
7. Decide whether the request was a real bug, abuse attempt, or missing policy entry.
8. If policy changes, record why and review later.

### Run An Access Review

1. Open Members.
2. Export access-review CSV.
3. Review owners/admins first.
4. Review project access.
5. Remove stale users.
6. Remove temporary roles.
7. Store evidence for compliance.

## What Good Looks Like

After a healthy rollout:

- No application needs the raw provider key in environment variables.
- Every production provider path is tied to a project.
- Every project has an owner.
- Every provider slot has a rotation owner.
- SSO is the normal sign-in path.
- Admin roles are limited.
- Caller lock is configured for production paths.
- Dry-run is used before new production traffic.
- Audit and access-review exports are part of regular operations.
- Alerts go to people who can act.
- Readiness is checked before major changes.

## What To Avoid

Avoid:

- Putting all apps into one project.
- Making every technical user an admin.
- Launching multiple provider paths at once.
- Weak caller lock such as only checking a host name.
- Treating dry-run as optional.
- Rotating provider keys without an audit trail.
- Ignoring denied requests.
- Letting old provider keys stay in apps after VaultProof is live.
- Using emergency revoke without documenting follow-up.
- Changing gateway/TLS/APIM settings without rollback.

## Success Metrics

Track:

- Number of apps removed from raw provider-key storage.
- Number of provider slots with owner and rotation schedule.
- Number of projects with caller lock configured.
- Number of projects with dry-run completed before go-live.
- Number of stale admins removed during access reviews.
- Time from suspected leak to emergency revoke.
- Number of production readiness blockers.
- Denial rate after launch.
- Provider error rate after launch.
- Audit export cadence.

## Customer Implementation Checklist

Use this checklist for each production rollout.

- [ ] Business owner named.
- [ ] Security owner named.
- [ ] Identity owner named.
- [ ] Platform/network owner named.
- [ ] App owner named.
- [ ] First project selected.
- [ ] Provider inventory completed.
- [ ] Gateway pattern selected.
- [ ] SSO/admin path confirmed.
- [ ] Members and roles assigned.
- [ ] Provider slot created.
- [ ] Caller lock configured.
- [ ] Upstream host/path/method policy configured.
- [ ] Rate limit configured.
- [ ] Dry-run passed.
- [ ] Audit export tested.
- [ ] Access-review export tested.
- [ ] Alert destination tested.
- [ ] Readiness production-ready.
- [ ] Rollback path documented.
- [ ] First low-volume production traffic approved.

## Related Pages

| Page | URL |
| --- | --- |
| Dashboard | `https://enterprise.vaultproof.dev/app/dashboard` |
| Setup guide | `https://enterprise.vaultproof.dev/app/setup` |
| Technical guide | `https://enterprise.vaultproof.dev/app/technical-guide` |
| Org + SSO | `https://enterprise.vaultproof.dev/app/org` |
| Members | `https://enterprise.vaultproof.dev/app/members` |
| Projects | `https://enterprise.vaultproof.dev/app/projects` |
| API Inventory | `https://enterprise.vaultproof.dev/app/inventory` |
| Policy Drift | `https://enterprise.vaultproof.dev/app/policy` |
| Rollout Manager | `https://enterprise.vaultproof.dev/app/rollout` |
| Control | `https://enterprise.vaultproof.dev/app/control` |
| AI Proof Verifier | `https://enterprise.vaultproof.dev/app/verifier` |
| Provider slots | `https://enterprise.vaultproof.dev/app/keys` |
| Activity | `https://enterprise.vaultproof.dev/app/activity` |
| Audit | `https://enterprise.vaultproof.dev/app/audit` |
| Alerts | `https://enterprise.vaultproof.dev/app/alerts` |
| Runbooks | `https://enterprise.vaultproof.dev/app/runbooks` |
| Readiness | `https://enterprise.vaultproof.dev/readiness` |

## Research References

- Microsoft Entra provisioning: `https://learn.microsoft.com/en-us/entra/identity/app-provisioning/how-provisioning-works`
- Okta app integrations: `https://developer.okta.com/docs/guides/create-an-app-integration/scim/main/`
- Slack SCIM provisioning: `https://slack.com/hc/en-us/articles/212572638-Manage-members-with-SCIM-provisioning`
- Atlassian audit logs: `https://support.atlassian.com/security-and-access-policies/docs/accessing-audit-log-activities/`
- Datadog Audit Trail: `https://docs.datadoghq.com/account_management/audit_trail/`
- Stripe go-live checklist: `https://docs.stripe.com/get-started/checklist/go-live`
- Cloudflare Zero Trust onboarding patterns: `https://developers.cloudflare.com/changelog/2025-07-09-onboarding-resources/`
