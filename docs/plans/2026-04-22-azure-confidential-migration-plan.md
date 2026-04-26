# Azure-First Enterprise Confidential Plan

Status: superseded by `docs/plans/2026-04-26-enterprise-most-secure-build.md`
Owner: VaultProof core product
Last updated: 2026-04-22

## Superseded Note

This plan is retained as migration history and prototype context.

The current source of truth is `docs/plans/2026-04-26-enterprise-most-secure-build.md`.
Use that newer plan for the production enterprise architecture:

- B2C remains on Cloudflare Workers.
- Enterprise is Azure-only.
- Container Apps is prototype/control-plane infrastructure, not the final secure executor.
- The final executor target is Azure Confidential VM plus Azure Key Vault Secure Key Release.

## Why this plan exists

VaultProof's current live execution path depends on Cloudflare Workers. That got us to market quickly, but it no longer matches the security target for the enterprise demo we want to sell.

The new requirement is stricter:

- raw provider secrets must not live in the public edge runtime
- the unwrap/decrypt key must not live in the public control plane
- plaintext provider keys should exist only at the moment of use
- that plaintext should exist only inside an attested hardware-backed trusted execution environment
- we want to spend the Azure credits we already have within the next 3 months
- we want to remove Cloudflare from the enterprise serving path
- we want to preserve the current lower-cost Cloudflare path for B2C customers
- we want a hard boundary between the B2C runtime and the enterprise runtime

This file is the execution source of truth for that migration.

## Current implementation status

Completed in repo:

- shared runtime-independent enterprise helpers now live under `packages/vaultproof-core`
- a new Azure enterprise public API package exists at `packages/enterprise-control-plane`
- a new enterprise secure executor package exists at `packages/enterprise-secure-executor`
- existing enterprise site flows now know how to use `enterprise.vaultproof.dev`:
  - `apps/site/js/app-login-3.js`
  - `apps/site/js/app-org-1.js`
  - `apps/site/js/app-control-1.js`
- the Azure control plane currently supports the core enterprise surface:
  - org list/create/update
  - SSO start + SSO resolve
  - org archive/unarchive
  - transfer ownership
  - members list
  - invitation accept
  - projects list
  - project overview stats
  - project policy update
  - audit read
  - alerts read

Not done yet:

- `enterprise.vaultproof.dev` DNS is not provisioned
- Azure Front Door is not provisioned
- the enterprise control plane is not deployed to Azure yet
- the secure executor is still a stub and is not yet running inside a Confidential VM
- Key Vault Premium, Secure Key Release, and Azure Attestation are not wired into code yet

## What you need to do now

The repo is ready for the next external setup steps. These are the items that require your Azure / DNS access.

### 1. Create the Azure enterprise ingress

- create an `Azure Front Door Standard or Premium` profile for enterprise traffic
- create a Front Door endpoint for the enterprise API
- add the custom domain `enterprise.vaultproof.dev`
- complete domain validation in Azure
- enable managed TLS for the custom domain

### 2. Point DNS to Azure

- in your DNS provider, create the record Azure gives you for `enterprise.vaultproof.dev`
- complete any TXT validation record Azure requests
- confirm `enterprise.vaultproof.dev` resolves to the Front Door endpoint

### 3. Create the public control plane runtime

- create an `Azure Container Apps Environment`
- deploy the enterprise control plane service from `packages/enterprise-control-plane`
- make sure Front Door routes to that service

Minimum environment variables the control plane needs:

- `ENTERPRISE_HOSTNAME=enterprise.vaultproof.dev`
- `SUPABASE_URL=...`
- `SUPABASE_SERVICE_ROLE_KEY=...`
- `ENTERPRISE_EXECUTOR_BASE_URL=...`

Optional for the next slice:

- `ENTERPRISE_EXECUTOR_SIGNING_KEY_ID=...`

### 4. Create the secure enterprise network boundary

- create a dedicated `VNet` for enterprise runtime traffic
- place the control plane and Confidential VM path behind private networking where possible
- reserve the subnet(s) we will use for the Confidential VM and private endpoints

### 5. Stand up the first secure runtime resources

- create `Azure Key Vault Premium`
- create `Azure Attestation`
- create one `Azure Confidential VM` for the secure executor path

This does not need to be fully wired before the control plane deploy, but we need the resources created before the true secure execution path can replace the stub.

### 6. Give me the values I need back in the repo

Once the above exists, I need these from you:

- the final `enterprise.vaultproof.dev` hostname status
- the Azure Front Door endpoint / backend target info
- the value for `ENTERPRISE_EXECUTOR_BASE_URL`
- confirmation that `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are available for the Azure service
- if you want me to wire real executor signing next, the key identifier or signing approach we want to use

### 7. Fast validation after deploy

After deployment, verify:

- `https://enterprise.vaultproof.dev/health`
- `https://enterprise.vaultproof.dev/api/v1/enterprise/orgs` with a valid Supabase JWT
- the enterprise login/org/control pages call `window.location.origin + /api/v1/enterprise` on the enterprise host

## Product goal

Turn VaultProof into an Azure-hosted enterprise control plane on `enterprise.vaultproof.dev` where:

- the public API layer handles auth, org/project policy, rate limiting, and audit
- encrypted secret material is stored outside the sensitive runtime
- the unwrap key is held in Azure Key Vault Premium
- Azure Secure Key Release releases unwrap capability only to an attested Azure Confidential VM
- plaintext secrets exist only inside the confidential runtime for one outbound provider call
- no raw provider key is returned, logged, or stored

At the same time:

- `api.vaultproof.dev` remains the B2C / self-serve path on Cloudflare
- `enterprise.vaultproof.dev` becomes the B2B / enterprise path on Azure
- both products can share selected core logic and the existing data model where appropriate
- the enterprise security guarantees must not be diluted by the B2C runtime

## Non-goals for v1

- do not move the Supabase data layer off-platform yet
- do not adopt Azure Managed HSM in the first 90 days
- do not build multi-cloud support during the initial migration
- do not boil the ocean with every provider; start with one or two golden-path providers
- do not preserve Cloudflare in front of Azure for enterprise traffic
- do not force all B2C customers onto the enterprise stack
- do not block the secure-execution build on enterprise SSO; Entra comes after the Azure execution path is stable

## Security target

For the Azure-first enterprise path, the strongest practical story is:

- `enterprise.vaultproof.dev` is the only public enterprise edge
- the public control plane cannot decrypt provider keys
- Azure Confidential VM is the only runtime allowed to reconstruct or decrypt provider keys
- Azure Attestation verifies the Confidential VM state
- Azure Key Vault Premium with Secure Key Release gates the unwrap key on attestation claims
- provider key plaintext exists only inside the Confidential VM, only during request execution, and is zeroed immediately after use

This is not as narrow a trusted boundary as AWS Nitro Enclaves, but it is the strongest practical Azure-native design for the next 90 days and uses our expiring credits.

The B2C runtime does not inherit these guarantees automatically. We should document the security model per path.

## Target architecture

```text
Enterprise Customer App / Admin UI
        |
        v
enterprise.vaultproof.dev
Azure Front Door + WAF
        |
        v
Public Control Plane API
  - auth/session validation
  - org/project policy checks
  - rate limits
  - audit enqueue
  - signed handoff to secure executor
        |
        v
Private VNet
        |
        v
Azure Confidential VM
  - guest attestation
  - secure key release
  - decrypt / reconstruct in TEE
  - outbound provider request
  - zeroize memory
        |
        v
Provider API (OpenAI / Anthropic / Stripe / etc.)

Supporting systems:
- Supabase/Postgres: orgs, projects, members, policies, audit metadata, encrypted secret blobs
- Azure Key Vault Premium: unwrap/root key
- Azure Attestation: attestation verification and claims
- Azure Monitor / Log Analytics: infra telemetry

Reference surfaces already in repo:
- `apps/site/enterprise-demo.html`
- `apps/site/js/app-control-1.js`
- `apps/site/js/app-org-1.js`
- `apps/site/js/app-login-3.js`
- `packages/init-worker/src/routes/orgs.ts`
```

## Azure services to use

### Required

- `Azure Front Door Standard/Premium`
  Public ingress, TLS termination, edge routing, optional WAF.

- `Azure Container Apps` or `Azure App Service` for the public control plane API
  Use `Container Apps` if we want better private networking and cleaner future service decomposition. This plan assumes `Container Apps`.

- `Azure Confidential VM`
  The secure executor runtime. This is the only place plaintext provider key material may exist.

- `Azure Key Vault Premium`
  Holds HSM-backed unwrap/root keys.

- `Azure Attestation`
  Validates the Confidential VM and produces attestation claims.

- `Azure Virtual Network`
  Private connectivity between control plane, Confidential VM, and Key Vault private endpoints.

- `Azure Monitor` and `Log Analytics`
  Infra health, security telemetry, and operational visibility.

### Optional in phase 2+

- `Azure API Management`
  Add later if enterprise API governance or external developer API packaging becomes important. Not required for the first secure demo.

- `Azure DDoS Protection`
  Evaluate after the first production-hardening pass. Front Door + WAF is enough for the demo phase.

- `Azure Managed HSM`
  Only if procurement or compliance specifically requires single-tenant HSM custody.

- `Microsoft Entra ID`
  Add later as the first enterprise SSO provider for customer-managed login. Prefer OIDC as the default path and support SAML later when a customer specifically requires it.

## Current repo reality

### What we already have

- `packages/init-worker` contains the core auth, proxy, rate limiting, audit, and org/project policy logic
- `supabase/migrations/*` already supports orgs, members, audit, alerts, and project governance
- `apps/dashboard` is the right long-term admin UI
- `apps/site/enterprise-demo.html` already exists and can be updated to match the Azure architecture
- the live static app already has an enterprise/control surface:
  - `apps/site/app/control.html`
  - `apps/site/app/org.html`
  - `apps/site/js/app-control-1.js`
  - `apps/site/js/app-org-1.js`
- `packages/init-worker/src/routes/orgs.ts` already contains enterprise org and SSO governance behavior we should treat as a reference implementation

### What we need to change

- keep Cloudflare for B2C and remove it from the enterprise serving path
- move enterprise public API logic into an Azure-hosted runtime
- split current worker code into:
  - shared auth/policy/business logic
  - B2C Cloudflare adapters
  - Azure enterprise public control plane API
  - Azure enterprise secure executor
- move the unwrap/decrypt trust anchor out of the public runtime
- introduce attestation and secure key release

## Implementation principles

- migrate in additive phases, not a big-bang rewrite
- keep Supabase as the existing system of record during the Azure move
- build one secure golden path first, then broaden provider coverage
- keep plaintext key handling out of logs, traces, shells, and normal runtime memory
- make the secure executor a small, explicit interface
- design for future Nitro support, but do not build for two clouds at once
- use `enterprise.vaultproof.dev` as the hard boundary for the enterprise runtime
- use the existing enterprise control plane behavior as the reference product surface

## Phase 0 - Architecture freeze and repo tracking

Status: pending

Goal:

- turn the Azure direction into a concrete engineering path

Milestones:

- [ ] approve Azure-only serving path
- [ ] approve `enterprise.vaultproof.dev` as the enterprise hostname
- [ ] approve `Container Apps + Confidential VM + Key Vault Premium + Attestation`
- [ ] approve keeping Supabase during the first migration
- [ ] define one initial provider golden path: `OpenAI` or `Anthropic`
- [ ] define one internal interface name for the secure executor

Exit criteria:

- the enterprise serving path no longer assumes Cloudflare
- the secure executor interface is defined
- one provider and one pilot flow are chosen for v1

## Phase 1 - Codebase decomposition

Status: pending

Goal:

- separate current Worker-specific code from portable VaultProof logic while preserving the B2C runtime

Files / surfaces:

- `packages/init-worker/src/index.ts`
- `packages/init-worker/src/routes/*`
- `packages/init-worker/src/lib/*`
- new shared library package for portable business logic
- existing enterprise reference surfaces:
  - `apps/site/js/app-control-1.js`
  - `apps/site/js/app-org-1.js`
  - `packages/init-worker/src/routes/orgs.ts`

Milestones:

- [ ] identify Worker-runtime-specific dependencies
- [ ] extract portable logic for:
  - auth parsing
  - project membership enforcement
  - origin policy checks
  - audit payload construction
  - provider request shaping
- [ ] define interfaces for:
  - secret material lookup
  - secure executor handoff
  - audit sink
  - rate limiter
- [ ] keep existing behavior green under tests before changing hosting

Exit criteria:

- most business logic is portable and no longer tied to the Worker entrypoint
- Azure services can call shared logic without importing Worker-specific plumbing
- B2C Cloudflare behavior still has a clear home and has not been broken by the refactor

## Phase 2 - Azure public control plane

Status: pending

Goal:

- create an Azure-hosted public control plane for `enterprise.vaultproof.dev`

Recommended runtime:

- `Azure Container Apps`

Responsibilities:

- auth/session validation
- org/project membership checks
- policy checks
- rate limits
- audit event creation
- signed request handoff to secure executor

Milestones:

- [ ] create Azure service for public API
- [ ] map existing enterprise routes and UI dependencies from:
  - `apps/site/js/app-control-1.js`
  - `apps/site/js/app-org-1.js`
  - `packages/init-worker/src/routes/orgs.ts`
- [ ] port `/health`
- [ ] port project/org/member/audit/alerts APIs
- [ ] port public proxy ingress route, but change the sensitive step to secure executor handoff
- [ ] implement Azure-native config and secret loading
- [ ] wire structured logging and request IDs
- [ ] implement mTLS or signed one-time request envelope to secure executor

Exit criteria:

- enterprise public API runs on Azure and passes current auth/policy regression tests
- `enterprise.vaultproof.dev` no longer requires Cloudflare

## Phase 2.5 - Enterprise SSO with Microsoft Entra ID

Status: pending

Goal:

- add customer-managed enterprise SSO after the Azure execution path is stable

Direction:

- use `Microsoft Entra ID` as the first enterprise IdP
- prefer `OIDC` for the default implementation
- support `SAML` later only when a customer specifically requires it

Milestones:

- [ ] add org-level SSO provider configuration for Entra
- [ ] store tenant ID, client ID, issuer, and claim mapping
- [ ] add OIDC login start and callback routes on `enterprise.vaultproof.dev`
- [ ] map Entra identity claims to org membership and role assignment
- [ ] add admin UI for enterprise SSO configuration
- [ ] document customer onboarding flow for Entra

Exit criteria:

- enterprise customers can authenticate to VaultProof with their own Entra tenant
- Entra auth lands inside the existing org/membership authorization model
- SSO is additive to the Azure confidential execution path, not a blocker for it

## Phase 3 - Secure executor on Azure Confidential VM

Status: pending

Goal:

- create the enterprise secure executor, the only runtime allowed to reconstruct or decrypt enterprise provider credentials

Responsibilities:

- receive signed internal execution requests
- fetch encrypted secret material
- attest the Confidential VM state
- obtain unwrap capability via Secure Key Release
- reconstruct or decrypt provider key in-memory
- make outbound provider request
- zeroize memory
- return only provider response and safe metadata

Milestones:

- [ ] stand up first Confidential VM in approved region
- [ ] harden VM image:
  - no SSH from public Internet
  - private networking only
  - minimal packages
  - locked-down outbound policy
- [ ] implement executor service
- [ ] implement one-time signed request validation
- [ ] implement in-memory zeroization path
- [ ] forbid returning raw provider keys through code and tests
- [ ] add replay protection and request expiry

Exit criteria:

- plaintext provider keys exist only inside the Confidential VM during one execution path
- executor returns no raw secret material

## Phase 4 - Attestation and Secure Key Release

Status: pending

Goal:

- gate enterprise unwrap capability on attested confidential runtime state

Milestones:

- [ ] create Azure Attestation provider and baseline policy
- [ ] generate attestation evidence inside the Confidential VM
- [ ] create Key Vault Premium key for unwrap/root operations
- [ ] configure Secure Key Release policy tied to approved claims
- [ ] verify that non-attested runtime cannot obtain unwrap capability
- [ ] verify that changed image / drifted measurements fail safely
- [ ] document recovery and rotation procedures

Exit criteria:

- public control plane cannot unwrap provider keys
- only approved attested Confidential VM image can obtain unwrap capability

## Phase 5 - Data model and secret custody updates

Status: pending

Goal:

- align enterprise stored secret material with the new Azure secure-use path

Milestones:

- [ ] inventory current secret storage model:
  - encrypted blob vs encrypted shares
  - which piece currently sits in the Worker
- [ ] move all unwrap/decrypt material out of public runtime
- [ ] update schema if needed to store:
  - encrypted provider secret blob
  - key version
  - attestation policy binding metadata
  - rotation metadata
- [ ] write one-time migration for existing stored material
- [ ] verify rollback and re-encryption safety

Exit criteria:

- no enterprise unwrap key remains in Cloudflare or any public runtime
- database contains only ciphertext / encrypted shares plus metadata

## Phase 6 - Network hardening

Status: pending

Goal:

- ensure only the intended enterprise traffic path can reach sensitive components

Milestones:

- [ ] private VNet for control plane and secure executor
- [ ] private endpoint for Key Vault
- [ ] lock executor inbound to control plane only
- [ ] lock executor outbound to approved provider domains only where feasible
- [ ] enable Front Door WAF policies
- [ ] enforce TLS everywhere
- [ ] implement private DNS / routing checks
- [ ] make `enterprise.vaultproof.dev` the only public hostname for the enterprise stack

Exit criteria:

- secure executor is not publicly reachable
- key release path is private and policy-bound
- enterprise runtime is isolated from the B2C serving path

## Phase 7 - UI and enterprise demo alignment

Status: pending

Goal:

- make the enterprise product and pitch reflect the actual Azure security architecture

Files / surfaces:

- `apps/dashboard/src/app/*`
- `apps/site/enterprise-demo.html`
- `docs/security-whitepaper.md`
- `apps/site/app/control.html`
- `apps/site/app/org.html`

Milestones:

- [ ] add control-plane UI for secure executor health
- [ ] add key status / last attested run / last successful secure call
- [ ] add rotate / revoke / disable controls
- [ ] update enterprise demo page to show Azure architecture and `enterprise.vaultproof.dev`
- [ ] update whitepaper and security docs to remove Cloudflare execution assumptions
- [ ] keep the existing enterprise system behavior as the reference UX baseline during the migration

Exit criteria:

- demo and dashboard accurately reflect the Azure execution model

## Phase 8 - Cutover from Cloudflare

Status: pending

Goal:

- cut enterprise traffic to Azure while preserving B2C on Cloudflare

Milestones:

- [ ] run Azure staging environment in parallel
- [ ] replay smoke tests against staging
- [ ] point `enterprise.vaultproof.dev` to Azure Front Door
- [ ] monitor latency, 5xx rate, and key-use success rate
- [ ] keep current enterprise behavior as emergency rollback during observation window
- [ ] remove Cloudflare from enterprise traffic path
- [ ] preserve Cloudflare B2C path as a separate product/runtime

Exit criteria:

- enterprise live traffic no longer traverses Cloudflare
- rollback procedure is documented and tested

## Phase 9 - Production hardening

Status: pending

Goal:

- make the Azure enterprise stack pilot-ready

Milestones:

- [ ] add zone-redundant or second-region planning for control plane
- [ ] add second Confidential VM strategy for failover
- [ ] define backup and disaster recovery runbook
- [ ] add incident runbooks for:
  - attestation failure
  - Key Vault release failure
  - provider outage
  - secret rotation emergency
- [ ] complete penetration review of public API and executor boundary
- [ ] complete latency and load tests

Exit criteria:

- one customer can run a credible pilot on the Azure architecture

## Phase 10 - Trust and Compliance Readiness

Status: pending

Goal:

- build the operating model so enterprise trust reviews and a later SOC 2 effort are straightforward, without blocking the core product build now

Direction:

- do not treat SOC 2 as a prerequisite for the current build
- do design the enterprise system so future SOC 2 work is mostly operational hardening instead of architectural rework

Milestones:

- [ ] document environment separation between B2C and enterprise runtimes
- [ ] keep audit logs for enterprise auth, policy changes, secure execution dispatch, and revocation
- [ ] define least-privilege access for production systems and secrets
- [ ] maintain vendor and subprocesser inventory for enterprise path
- [ ] define incident response and change-management basics
- [ ] track access to admin and production systems
- [ ] prepare a lightweight security questionnaire / trust packet for early enterprise customers
- [ ] evaluate timing for SOC 2 based on actual enterprise pipeline pressure, not just theory

Exit criteria:

- VaultProof can answer reasonable enterprise security reviews before SOC 2
- the product architecture does not need major redesign later to support SOC 2

## 90-day delivery plan

### Month 1 - Foundation and first secure call

- [ ] freeze target architecture
- [ ] extract shared logic from `packages/init-worker`
- [ ] stand up Azure public control plane skeleton
- [ ] stand up first Confidential VM
- [ ] implement a single secure executor route for one provider
- [ ] prove end-to-end secure call with test secret

Success condition:

- one provider call succeeds through Azure at `enterprise.vaultproof.dev` with no Cloudflare dependency in the enterprise path

### Month 2 - Attestation, key release, and dashboard visibility

- [ ] integrate Azure Attestation
- [ ] integrate Key Vault Premium + Secure Key Release
- [ ] migrate one real secret custody path
- [ ] add audit visibility and secure-executor health UI
- [ ] update enterprise demo assets and docs

Success condition:

- only attested Confidential VM can obtain unwrap capability and perform provider call

### Month 3 - Cutover and pilot readiness

- [ ] stage cutover behind Azure Front Door
- [ ] run regression and latency tests
- [ ] migrate first real project/provider
- [ ] cut `enterprise.vaultproof.dev` to Azure
- [ ] remove Cloudflare from the enterprise path
- [ ] publish pilot-ready runbook and demo script

Success condition:

- Azure is the live enterprise path, Cloudflare remains only for B2C, and the security story matches the architecture

## Engineering checklist

### Repo and code

- [ ] create shared core package for auth/policy/request shaping
- [ ] create Azure enterprise control plane service package
- [ ] create enterprise secure executor service package
- [ ] move Worker-only code behind adapters
- [ ] add Azure environment config and local dev story
- [ ] add tests for secure executor contract
- [ ] keep B2C Cloudflare entrypoint and runtime isolated from enterprise Azure packages

### Azure infrastructure

- [ ] create resource group
- [ ] create VNet and subnets
- [ ] create Front Door
- [ ] create Container Apps environment
- [ ] create Confidential VM
- [ ] create Key Vault Premium
- [ ] create Attestation provider
- [ ] create Log Analytics workspace
- [ ] create private endpoints and DNS where needed

### Security

- [ ] remove unwrap key from public runtime
- [ ] enable secure key release
- [ ] lock inbound to secure executor
- [ ] lock outbound policies
- [ ] redact logs and traces
- [ ] add key rotation and revoke runbooks
- [ ] add replay protection for internal requests
- [ ] verify non-attested code paths fail closed

### Product and demo

- [ ] choose one provider for the golden demo
- [ ] seed one demo organization and project
- [ ] prepare deny-path demo: wrong policy / revoked project / bad origin
- [ ] update enterprise demo page
- [ ] update dashboard views
- [ ] update security whitepaper
- [ ] map existing enterprise control features into the new hostname and runtime

### Cutover

- [ ] create Azure staging endpoint
- [ ] run regression tests
- [ ] test latency from US-East, US-West, EU
- [ ] cut `enterprise.vaultproof.dev` DNS to Azure
- [ ] monitor for 72 hours
- [ ] retire Cloudflare for enterprise only

## Initial file ownership

### Shared core extraction

- `packages/init-worker/src/lib/*`
- `packages/init-worker/src/routes/proxy.ts`
- `packages/init-worker/src/routes/orgs.ts`
- `packages/init-worker/src/routes/projects.ts`

### New Azure enterprise control plane

- new package for Azure API service
- env/config bootstrap
- auth, routing, audit, rate limit adapters
- enterprise hostname handling and routing

### New enterprise secure executor

- new package or service folder for confidential runtime
- attestation integration
- key release integration
- provider proxy implementation

### UI / marketing

- `apps/dashboard/src/app/*`
- `apps/site/enterprise-demo.html`
- `docs/security-whitepaper.md`
- `apps/site/app/control.html`
- `apps/site/app/org.html`
- `apps/site/js/app-control-1.js`
- `apps/site/js/app-org-1.js`

## Risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| Confidential VM image drift breaks SKR | Secure calls fail closed | pin image build, test attestation in staging first |
| Public control plane still leaks secrets in logs | ruins security story | structured redaction, no raw secret logging, test fixtures for sensitive fields |
| Migration stalls on full provider coverage | scope creep | ship one provider first |
| Hybrid leftovers keep Cloudflare assumptions alive inside enterprise | hidden complexity | use `enterprise.vaultproof.dev` as a hard boundary and track Cloudflare removal for enterprise explicitly |
| B2C and B2B runtime guarantees get blurred | product and security confusion | separate hostname, runtime, and docs per path |
| Managed HSM temptation burns credits | budget waste | use Key Vault Premium first |
| Control plane and executor contracts drift | outages or unsafe calls | versioned internal API and contract tests |

## Definition of done

VaultProof enterprise is considered migrated for the secure Azure demo when:

- `enterprise.vaultproof.dev` is the enterprise ingress on Azure Front Door
- Cloudflare is not in the enterprise serving path
- the public enterprise control plane cannot decrypt provider keys
- only the attested Azure Confidential VM can obtain unwrap capability
- one real enterprise provider call succeeds end to end
- revoke / disable / deny paths work
- the dashboard and enterprise demo reflect the new architecture
- the B2C runtime remains separate and intact
- the team has a documented rollback and incident plan
