# VaultProof Enterprise Technical Implementation Guide

Last updated: 2026-04-30

This guide is for technical teams implementing VaultProof Enterprise after purchase. Use it when identity, network, platform, application, security, audit, or incident response teams need more detail than the dashboard setup guide.

If you need a business-facing operating model first, read `docs/enterprise/customer-operating-guide.md`. It explains how customer teams should use VaultProof Enterprise across onboarding, identity, projects, provider slots, dry-run, go-live, day-2 operations, incident response, and access reviews.

The short version:

- VaultProof Enterprise protects provider/API keys by moving sensitive provider execution out of customer apps and into a controlled enterprise runtime.
- Users sign in to the enterprise dashboard to configure organizations, members, projects, provider slots, policies, evidence, and alerts.
- Applications call the enterprise gateway path instead of holding raw provider keys.
- The control plane authorizes the request, signs the secure execution handoff, and records governance/runtime evidence.
- The secure executor verifies the signed request, replay protection, caller-lock facts, attestation posture, and key-release readiness before provider dispatch.
- Provider key material is released only to the expected Azure confidential runtime through Azure Secure Key Release.

## Who Should Read This

Identity teams should read the identity and SSO sections.

Network and platform teams should read the gateway, APIM, Front Door, TLS, and origin sections.

Application teams should read the project modeling, caller lock, dry-run, and rollout sections.

Security and compliance teams should read the key custody, attestation, audit, evidence, alerting, and incident response sections.

Operators should read the runbooks, validation, troubleshooting, and rollback sections.

## Enterprise Tech Stack

| Area | Enterprise Component | Purpose |
| --- | --- | --- |
| Public enterprise edge | Azure Front Door | Public enterprise hostname, routing, health probes, TLS, WAF/edge posture, and origin protection. |
| Optional API gateway | Azure API Management | Customer/VaultProof-managed API gateway, JWT validation, mTLS/device policy, caller-lock header creation, and throttling. |
| Runtime host | Azure Confidential VM | Runs the enterprise control plane and secure executor on confidential compute. |
| Control plane | Node.js + TypeScript | Dashboard pages, enterprise APIs, organization/project policy, signing, audit, alerts, and readiness. |
| Secure executor | Node.js + TypeScript | Request verification, replay protection, key-release integration, provider dispatch, and runtime health. |
| Identity/session provider | Supabase Auth | Enterprise browser sessions, SAML broker path, JWT/session validation, and auth admin functions. |
| Data store | Supabase Postgres | Organizations, members, projects, policy, provider-slot metadata, audit events, alerts, and settings. |
| Customer IdP | Microsoft Entra ID | Corporate identity, MFA, conditional access, SAML app assignment, and identity lifecycle. |
| Key custody | Azure Managed HSM | Secure Key Release policy and release-root key material. |
| Attestation | Microsoft Azure Attestation | Confirms Azure confidential VM evidence used by Secure Key Release and readiness. |
| AI Proof Verifier | Proof bundle verifier and evidence recorder | Registers external models, verifies submitted proof bundles or attestation records, and records evidence without VaultProof running the model. |
| Operations | systemd, nginx, Azure CLI scripts | Service lifecycle, local health routing, deploys, evidence capture, TLS/APIM cutovers, SSH hardening, and cleanup. |

## Architecture At A Glance

```text
enterprise.vaultproof.dev
  -> Azure Front Door
  -> enterprise control plane on Azure Confidential VM
  -> signed internal execution request
  -> secure executor on Azure Confidential VM
  -> Azure Managed HSM Secure Key Release after attestation
  -> upstream provider request
  -> audit, activity, readiness, and alert evidence
```

The enterprise dashboard and enterprise APIs are part of the same product surface. Dashboard pages call `/api/v1/enterprise/*` APIs. The control plane decides whether a user, organization, project, and request are allowed. The secure executor decides whether the runtime and signed request are safe enough to touch protected provider material.

## Trust Boundaries

VaultProof Enterprise has several important boundaries:

| Boundary | What Crosses It | Main Control |
| --- | --- | --- |
| Browser to control plane | User session, selected organization, dashboard API calls | Supabase session, organization membership, project permissions, security headers. |
| Control plane to executor | Signed execution request | HMAC signing, key ID allowlist, replay protection, internal URL, executor health checks. |
| Executor to key release | Attestation token and release request | Microsoft Azure Attestation, Managed HSM Secure Key Release policy, key version binding. |
| Gateway to control plane | Caller-lock facts and request metadata | Front Door/APIM origin lock, trusted headers, mTLS/device/JWT policy, header stripping/override. |
| Runtime to provider | Provider request | Project policy, provider allowlist, upstream method/host/path restrictions, rate limits. |

## Identity And SSO

VaultProof Enterprise should use company identity for production users.

The current customer-facing identity model is:

```text
Microsoft Entra ID
  -> SAML SSO
  -> Supabase Auth session
  -> VaultProof organization membership
  -> project/member role authorization
```

Entra ID owns the corporate identity controls:

- User lifecycle and group assignment.
- MFA and conditional access.
- Device or location rules.
- SAML enterprise app approval.
- Identity team change control.

VaultProof owns the product authorization controls:

- Organization membership.
- Project access and project role.
- Owner/admin/security reviewer/developer/viewer permissions.
- Audit events for invitations, member changes, policy updates, provider changes, and runtime actions.
- Break-glass path planning.

A user can authenticate successfully and still be blocked by VaultProof if they are not a member of the correct organization or do not have project access.

## Organization And Role Model

Use shared organizations for enterprise customers. Avoid putting production enterprise work into a personal organization.

Recommended role split:

| Role | Typical Owner | Can Do |
| --- | --- | --- |
| Owner | Business/security owner | Approve setup, admins, SSO rollout, go-live, major policy changes, and emergency actions. |
| Admin | Platform/security admin | Manage projects, provider slots, members, alerts, and policy. |
| Security reviewer | Security/compliance | Review readiness, audit, evidence, access reviews, and alerts. |
| Developer/operator | Application/platform team | Configure project policy, test dry-runs, monitor activity, and troubleshoot app flows. |
| Viewer | Read-only stakeholder | Inspect posture and evidence without making changes. |

Before go-live, export an access review and confirm every admin has a reason to hold that role.

## Project Modeling

Projects should match real security boundaries. They should not be only a folder for “all apps that use the same provider.”

Create separate projects when workloads differ by:

- Environment: production, staging, development, sandbox.
- Business owner or app owner.
- Provider account or provider key.
- Regulated data handling.
- Region or subsidiary.
- Incident response owner.
- Rate-limit needs.
- Caller-lock facts.
- Approval flow.

Each project should have:

- A clear name and purpose.
- Owner team.
- Allowed provider family or families.
- Allowed upstream hosts and paths.
- Caller-lock policy.
- Rate-limit expectations.
- Provider slot owner and rotation schedule.
- Audit/evidence owner.

## Gateway And Network Patterns

The gateway pattern decides how VaultProof knows a request came from the expected caller.

### VaultProof-Managed Edge

Use this for the fastest production pilot. Azure Front Door routes the enterprise hostname to the enterprise control plane. VaultProof manages the origin route, health checks, HTTPS posture, readiness checks, and rollback path.

Good fit:

- First enterprise rollout.
- Lower integration burden.
- Customer does not need to own every gateway policy before pilot.

### Customer-Managed Azure API Management

Use this when the customer requires API traffic to enter through their own APIM or policy gateway.

Customer APIM can validate:

- Entra JWT issuer and audience.
- Subscription or API product.
- mTLS client certificate.
- Device identity.
- Source network or private route.
- Customer rate limits.

Then APIM forwards only trusted caller-lock headers to VaultProof. APIM policy should strip spoofable incoming caller-lock headers before setting the trusted values.

### mTLS Gateway

Use mTLS when server, device, or agent clients need certificate-bound access.

Typical caller-lock facts:

- Certificate thumbprint.
- Certificate subject fragment.
- APIM mTLS validation status.
- Device fleet ID.
- Service identity.

### Device Or Fleet Gateway

Use this for devices, agents, or IoT-like deployments.

Typical caller-lock facts:

- Device ID.
- Fleet ID.
- Firmware version.
- Gateway marker.
- Network or region marker.
- Request-volume limits.

### Private Origin Phase

After the first production path is stable, harden the origin. The target is to keep public traffic at Front Door/APIM and avoid exposing the origin directly. Keep an approved break-glass access path before closing public SSH or changing origin access.

## Caller Lock

Caller lock is the policy that binds provider access to the expected caller facts.

A strong caller-lock policy can include:

- Allowed origins.
- Gateway markers.
- APIM-trusted headers.
- CIDR ranges.
- mTLS certificate thumbprints.
- Certificate subject fragments.
- Device IDs.
- Fleet IDs.
- Firmware versions.
- Service identities.
- Allowed HTTP methods.
- Allowed upstream hosts.
- Allowed upstream path prefixes.
- Expected request volume.

The goal is to make a stolen session, leaked app token, or copied request insufficient by itself. The request should still fail if it comes from the wrong gateway, origin, network, certificate, device, or project.

## Provider Slots

Provider slots represent protected provider access for a project.

Each provider slot should have:

- Provider name.
- Business purpose.
- Owner.
- Environment.
- Rotation schedule.
- Emergency revoke process.
- Allowed projects.
- Allowed upstream families.
- Audit owner.

Provider keys should not be visible to normal dashboard users. The dashboard tracks slot state and governance metadata; the secure executor handles protected material inside the confidential runtime.

## Key Custody And Secure Key Release

VaultProof Enterprise uses Azure confidential computing and Azure Secure Key Release for the production key path.

The intended security posture:

- Raw provider key material is not stored in customer app code.
- Raw provider key material is not stored in customer app environment variables.
- Raw provider key material is not rendered in the browser.
- Key release is bound to Azure confidential runtime evidence.
- The executor verifies signed requests before provider dispatch.
- Plaintext material is kept inside execution memory and cleared after use.

Secure Key Release depends on:

- Azure Managed HSM.
- Exportable release-root key material where appropriate for the release flow.
- A key-release policy generated from attestation evidence.
- Microsoft Azure Attestation token hash.
- Policy hash.
- Key ID and key version.
- Executor runtime configuration.

## Attestation

Attestation proves that the executor is running in the expected confidential environment.

Production readiness requires:

- Azure confidential VM security profile.
- Secure boot enabled.
- vTPM enabled.
- Microsoft Azure Attestation reachable.
- Dynamic attestation evidence available.
- Attestation token hash configured.
- Key-release policy hash configured.
- Secure Key Release URL configured.
- Released key ID and version configured.
- Executor build digest and measurement summary captured.

If attestation evidence is missing or stale, readiness should not claim production-ready.

## Request Flow

Normal protected execution flow:

1. Client sends request to the enterprise hostname or approved gateway.
2. Gateway adds trusted caller-lock facts and strips spoofable inbound policy headers.
3. Control plane validates user/session/project/policy context.
4. Control plane creates a signed internal execution request.
5. Executor verifies key ID, signature, timestamp, replay token, project, provider, and caller-lock metadata.
6. Executor verifies key-release/attestation readiness.
7. Executor obtains or derives protected provider material.
8. Executor sends the upstream provider request.
9. Executor returns the provider result without returning the provider key.
10. Control plane/audit records runtime and governance evidence.

## Dry-Run Validation

Dry-run is the safest way to test enterprise wiring before real provider calls.

Dry-run should prove:

- User session is valid.
- Organization membership is valid.
- Project access is valid.
- Policy accepts the request.
- Caller-lock facts match.
- Request signing works.
- Executor is reachable.
- Replay protection works.
- Audit metadata is recorded.
- Provider dispatch is intentionally skipped.

Do not launch real provider traffic until dry-run passes.

## AI Proof Verifier

VaultProof AI Proof Verifier is the verifiable AI/ML proof layer. It is verifier-first: a customer app, model provider, or partner system runs the model outside VaultProof, submits a proof bundle, VaultProof verifies the evidence it can verify, and VaultProof records the verifier decision as enterprise evidence. VaultProof does not host, run, or train the model in this feature.

Demo mode uses shared enterprise runtime attestation. The verifier API exposes `shared-enterprise-runtime-attestation` so demo proof records can reference the shared Azure Confidential VM readiness path and Microsoft Azure Attestation posture without minting static attestation tokens or claiming model execution happened inside VaultProof.

For cost control, the enterprise demo control plane can set `ENTERPRISE_RUNTIME_TIER=shared-demo`. That tier means demo tenants share the VaultProof-operated demo runtime and are isolated at the organization, project, IAM, policy, audit, and data layers. Dedicated customer production should use `ENTERPRISE_RUNTIME_TIER=dedicated-production` and a customer-dedicated runtime/key boundary.

Technical model:

- Proof input: proof bundle, model identifier, claimed output, public metadata, project ID, caller-lock metadata, and verifier version.
- Verification path: control plane authenticates the user/service, checks organization/project policy, runs or calls an approved verifier, and records the decision.
- Evidence path: audit event stores verifier result, verifier version, model ID, proof hash, runtime readiness, attestation token hash, key-release policy hash, actor, organization, project, and timestamp.
- Demo attestation path: proof evidence stores the shared attestation mode and `/readiness` source while keeping model execution external.
- Privacy path: raw private inputs and protected provider keys are not rendered in dashboard pages or exported by default.
- Out-of-scope path: VaultProof does not host model execution or operate a prover runtime for customers in this product.

Security improvements over a raw proof-compute integration:

- Bind verification evidence to Azure Confidential VM readiness and Microsoft Azure Attestation, not only to a standalone verifier result.
- Require enterprise RBAC, project roles, caller lock, allowed model IDs, verifier version pinning, and rate limits before proof acceptance.
- Treat proof verification, export, failed verification, model registration, and verifier-version changes as audit events.
- Keep model execution and managed proving outside VaultProof. The product verifies submitted evidence and records the decision.

## Evidence And Audit

VaultProof Enterprise should give security teams proof they can review.

Useful evidence surfaces:

- `/readiness` for current production posture.
- Audit page for governance and runtime events.
- Audit CSV export.
- Members page access-review CSV export.
- Activity page for runtime status, provider request IDs, denials, latency, and attestation summaries.
- Alerts page for alert destination and delivery evidence.
- Runbooks page for production verifier, evidence bundle, evidence validator, handoff package, and finish gate.

Evidence should answer:

- Who changed access?
- Who changed project policy?
- Which provider slot was used?
- Which caller facts were accepted?
- Which requests were denied?
- Was the executor production-ready?
- Was attestation evidence available?
- Which alert destinations were configured?
- Was there an emergency revoke?

## Alerts And Incident Response

Set alert destinations before production traffic.

Recommended alert categories:

- Key leak report.
- Emergency revoke.
- Readiness drift.
- Denial spike.
- Provider error spike.
- Executor unavailable.
- Attestation/key-release failure.
- Suspicious volume change.
- SSO/member/access change.

Incident response should define:

- Who receives alerts.
- Who can revoke a provider slot.
- Who can disable a project.
- Who can change caller-lock policy.
- Who can rollback gateway/TLS/APIM changes.
- How evidence is exported after an incident.

## Production Readiness

Production readiness is a gate, not a one-time checkbox.

Before first production traffic:

- `/readiness` returns production-ready.
- Enterprise dashboard loads through the enterprise hostname.
- Secure executor health is production-ready.
- Secure Key Release is hardware-bound.
- Attestation evidence is ready.
- Replay protection is ready.
- SSO/admin access is confirmed.
- Provider slot owner is confirmed.
- Caller-lock policy is configured.
- Alert destination test passes.
- Audit and access-review exports work.
- Rollback path is documented.

## Runbooks

The dashboard Runbooks page lists the operator commands. Most runbooks are read-only until an explicit confirmation variable or operator action is supplied.

Important runbook groups:

- `verify:enterprise-production`: checks live production posture.
- `evidence:enterprise-production`: captures timestamped infrastructure/app/readiness evidence.
- `validate:enterprise-evidence`: validates the latest evidence bundle.
- `qa:enterprise-live-app`: checks live enterprise pages and links.
- `qa:enterprise-live-execute`: validates auth, policy, signing, and executor reachability without provider dispatch.
- `prepare:enterprise-secret-rotation`: plans signing/secret rotation without printing secrets.
- `prepare:enterprise-private-origin`: inventories private-origin migration options.
- `prepare:enterprise-apim-jwt`: plans APIM JWT validation.
- `prepare:enterprise-mtls`: prepares mTLS caller-lock values and APIM snippets.
- `verify:enterprise-origin-tls`: checks TLS origin readiness.
- `harden:enterprise-ssh`: closes or reopens bootstrap SSH with gates.
- `cleanup:enterprise-container-apps`: inventories and gates cleanup of old prototype resources.

## Troubleshooting

### User cannot sign in

Check:

- Entra enterprise app assignment.
- Supabase SAML configuration.
- Invite status.
- Organization membership.
- Browser local storage/session.
- Correct enterprise hostname.
- Whether the user has an approved role.

### User signs in but sees no data

Check:

- Active organization dropdown.
- Organization membership.
- Project membership.
- Role level.
- API auth errors.
- Supabase user ID matching expected membership.

### Dry-run fails

Check:

- Bearer token.
- Selected organization.
- Project role.
- Caller-lock facts.
- Provider allowlist.
- Upstream method/host/path.
- Request signature.
- Executor reachability.
- Replay nonce/timestamp.

### Readiness is not production-ready

Check:

- `/readiness` blockers.
- Executor health.
- Secure Key Release URL.
- Attestation token hash.
- Key-release policy hash.
- Released key ID/version.
- Executor build digest.
- Measurement summary.
- Front Door origin lock.

### Front Door returns 503 or 504

Check:

- Origin hostname/IP.
- Origin protocol and port.
- Health probe path and method.
- Azure NSG rule.
- UFW rule.
- nginx status.
- `vaultproof-control-plane` systemd status.
- Whether origin traffic is allowed from Front Door.

### Provider call is denied

Check:

- Project policy.
- Provider slot state.
- Caller-lock mismatch.
- Rate limit.
- Upstream host/path/method.
- Emergency revoke.
- Audit/activity denial details.

## Technical Review Questions

Ask these before approving production traffic:

- Which Entra tenant and enterprise app are used?
- Which groups or users can sign in?
- Which MFA and conditional access policies apply?
- Which organizations and projects are in scope?
- Which apps and environments move first?
- Which provider keys move first?
- Which gateway pattern is required?
- Which caller-lock facts can be trusted?
- Who owns provider rotation?
- Who can emergency revoke?
- Which alert destinations are required?
- Which audit exports are required?
- What is the rollback path?
- What is the break-glass access path?

## Related Enterprise Pages

| Page | URL | Purpose |
| --- | --- | --- |
| Dashboard | `https://enterprise.vaultproof.dev/app/dashboard` | Start point for runtime, access, evidence, and workspace tools. |
| Setup guide | `https://enterprise.vaultproof.dev/app/setup` | Step-by-step onboarding and rollout guide. |
| Technical guide | `https://enterprise.vaultproof.dev/app/technical-guide` | Browser version of this implementation reference. |
| Org + SSO | `https://enterprise.vaultproof.dev/app/org` | Organization settings and Entra/SAML rollout controls. |
| Members | `https://enterprise.vaultproof.dev/app/members` | Roles, invites, project assignments, and access review export. |
| Control | `https://enterprise.vaultproof.dev/app/control` | Project policy, caller lock, provider allowlists, and execution settings. |
| AI Proof Verifier | `https://enterprise.vaultproof.dev/app/verifier` | External model registry, proof bundle verification, evidence storage, and Azure confidential binding. |
| API Inventory | `https://enterprise.vaultproof.dev/app/inventory` | Metadata-only API catalog, owner/risk/review annotations, provider-slot mapping, traffic posture, and customer-safe evidence export. |
| Provider slots | `https://enterprise.vaultproof.dev/app/keys` | Provider-slot status, rotation notes, Secure Key Release posture, and emergency revoke. |
| Audit | `https://enterprise.vaultproof.dev/app/audit` | Governance/runtime audit events and CSV export. |
| Activity | `https://enterprise.vaultproof.dev/app/activity` | Runtime events, provider request IDs, denials, latency, and attestation summaries. |
| Alerts | `https://enterprise.vaultproof.dev/app/alerts` | Alert destinations, tests, delivery logs, and dispatch runs. |
| Runbooks | `https://enterprise.vaultproof.dev/app/runbooks` | Operator verification, evidence, deployment, hardening, and cleanup commands. |
