# Third-Party Acceleration Map

Status: active
Owner: VaultProof core product
Last updated: 2026-04-19

## Why this file exists

We do not want to keep rebuilding commodity infrastructure while the core B2B control plane is still taking shape.

This file answers one question:

- what should VaultProof build itself vs. buy from a third party right now?

## Guardrails

- Keep the core VaultProof control plane in-house:
  - orgs and memberships
  - project authorization
  - provider proxying
  - policy enforcement
  - audit semantics
  - usage and alert logic
- Buy only commodity layers that do not differentiate the product:
  - email delivery
  - auth federation
  - directory sync
  - webhook delivery hardening
  - SIEM/log streaming
- Prefer narrow integrations that can be replaced later without rewriting product logic.

## Current recommendation

### Keep

- `Supabase Auth`
  - use for current auth/session layer
  - good fit because the product already depends on Supabase
  - use as the default near-term SSO path as well
  - keep until customer demand forces a more enterprise-specific SSO layer

- `Resend`
  - use for product email
  - good fit for invites, alerts, onboarding mail, and lightweight admin notifications
  - already partially integrated in the worker

### Evaluate next

- `WorkOS`
  - best candidate for future directory sync and possible enterprise escalation if Supabase stops fitting
  - use only if customers actually require SAML / SCIM
  - do not adopt until we have at least a few real enterprise asks

- `Svix`
  - best candidate if webhook delivery, retries, signature tooling, and delivery visibility become painful to own
  - useful for:
    - customer webhooks
    - alert delivery hardening
    - retries and visibility
  - not needed yet if the current webhook scope stays small

### Defer

- `Stytch`
  - strong product, but overlaps more deeply with auth/org layers we already built
  - only revisit if we decide to move more of B2B auth out of VaultProof entirely

- `Auth0` / `Clerk`
  - not the best fit right now
  - they add another auth surface without clearly reducing enough current engineering work

- `Keycloak`
  - powerful, but too much ops burden for this stage
  - only revisit if self-hosted/private deployment becomes a real enterprise requirement

## Decision checklist by layer

### 1. Email delivery

Recommendation:

- use `Resend`

Why:

- easy developer workflow
- enough for invites and alerts
- low setup overhead

Checklist:

- [x] alert delivery can use a third-party email provider
- [x] `Resend` is already wired as the preferred provider
- [ ] expand email usage to member invites / rollout notifications only if needed
- [ ] add delivery/failure visibility if support load increases

### 2. Enterprise SSO

Recommendation:

- use `Supabase Auth` as the default SSO path for now
- evaluate `WorkOS` only when enterprise buyers force the issue or Supabase becomes a blocker

Why:

- current shared-workspace login already works
- true SSO is not yet the critical blocker to first B2B revenue
- `Supabase Auth` keeps the stack simpler than introducing a second auth vendor right now
- WorkOS remains a cleaner future buy than building SAML ourselves if we outgrow Supabase

Checklist:

- [x] shared-workspace login path exists without SSO
- [x] in-house SSO scaffolding was removed to avoid dead-weight product complexity
- [x] `Supabase Auth` is the chosen near-term SSO path
- [ ] collect real enterprise asks for SAML/OIDC
- [x] prepare the concrete `Supabase Auth` SSO implementation plan
- [ ] do not build raw SAML plumbing in-house before that decision

Implementation checklist when we start:

- [ ] enable SAML SSO in the relevant Supabase paid organization/project
- [ ] create one or more SSO providers in Supabase for customer IdPs
- [ ] choose the routing model:
  - domain-based `signInWithSSO({ domain })`
  - provider-id based `signInWithSSO({ providerId })`
- [x] add a dedicated shared-workspace SSO entry point in the live dashboard login
- [x] map post-login users into the correct VaultProof organization membership
- [ ] decide how auto-join should work for matching company domains
- [x] define fallback behavior for:
  - no matching org
  - invited but not auto-joined user
  - SSO user with multiple org memberships
- [ ] add audit event for:
  - SSO login started
- [x] add audit events for:
  - SSO login completed
  - org membership resolution
- [x] add an admin-facing rollout prep section in org settings
- [x] persist org SSO rollout prep in backend state instead of browser-only state
- [x] make rollout status match the real backend state model (`requested` / `configured`)
- [x] surface provider health and recent successful SSO activity to org admins
- [ ] add an admin-facing org settings section for:
  - company domain
  - provider status
  - last successful SSO login
  - enable/disable SSO enforcement
- [ ] test at least one real provider end-to-end:
  - Google Workspace or Okta
- [ ] document the customer setup steps and rollout checklist in the live product

Notes:

- current behavior is intentionally invite-safe:
  - matching configured SSO logins resolve existing memberships
  - matching pending invites are accepted after SSO login
  - unmatched users do **not** auto-join the org yet

### 3. Directory sync / SCIM

Recommendation:

- do not build now
- likely use `WorkOS` if SCIM becomes necessary

Why:

- SCIM is expensive to build and test well
- it is only useful after actual enterprise customer pull

Checklist:

- [x] removed premature provisioning-token product surface
- [ ] keep SCIM out of the live product until a buyer requires it
- [ ] if needed, price and compare `WorkOS` vs `Stytch`

### 4. Webhook delivery

Recommendation:

- keep current worker-based delivery for now
- evaluate `Svix` if webhook complexity increases

Why:

- current scope is still manageable
- retries, signatures, and delivery visibility get much harder at scale
- Svix would reduce that future load

Checklist:

- [x] product already has basic webhook alert delivery
- [ ] decide whether customer-facing webhooks will become a core feature
- [ ] if yes, evaluate `Svix` before building more retry/observability infrastructure in-house

### 5. Audit / SIEM export

Recommendation:

- stay with CSV/JSON exports first
- only move to managed streaming later

Why:

- most current needs are still satisfied by export and review
- live streaming is only worth it for larger enterprise accounts

Checklist:

- [x] alerts exports exist
- [x] audit review exists
- [ ] add more export polish before any streaming vendor decision
- [ ] revisit managed SIEM/log streaming after customer demand appears

## What not to outsource

Do not outsource these unless the company direction changes materially:

- project access model
- provider compatibility layer
- origin and policy enforcement
- key handling semantics
- alert semantics
- audit event model
- org/project governance rules

Those are the product.

## Short answer

If we want to move faster right now:

- keep `Supabase`
- keep `Resend`
- maybe add `Svix` later for webhooks
- use `Supabase Auth` first for SSO if it becomes necessary
- maybe add `WorkOS` later for enterprise escalation / SCIM
- do not build more identity plumbing in-house until real customers force it
