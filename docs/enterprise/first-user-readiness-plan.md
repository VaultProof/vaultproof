# VaultProof Enterprise First-User Readiness Plan

Last updated: 2026-05-27

## Goal

Prepare VaultProof Enterprise for the first guided B2B users. The product should feel real, customer-safe, and pilot-ready: no public-facing "demo" framing, no raw secret handling in browser flows, clear first-user scenarios, and a crisp operator checklist before every walkthrough.

## Positioning

Use this language with first users:

- VaultProof Enterprise is a guided pilot for businesses that use API keys across teams, vendors, apps, and AI workflows.
- The first user session is a customer walkthrough, not a fake demo. We will use real business scenarios, redacted metadata, and controlled dry-runs or sealed sandbox keys.
- The goal is to prove visibility, policy, evidence, and safer execution before routing production customer traffic.

Avoid this language in customer-facing pages:

- "demo product"
- "demo-only"
- "demo material"
- "demo account"
- "safe demo"
- "demo slice"

Acceptable internal/operator language:

- `demo-placeholder` as an internal material-mode value.
- `shared-demo` as a runtime tier until renamed in a larger compatibility pass.
- Existing script names that are not exposed to customers.

## First-User Scenarios

### Scenario 1: API Key Inventory

Target user: security owner, platform owner, business owner.

Show:

- API surfaces by provider, owner, environment, risk, data sensitivity, and last traffic.
- Missing owner, missing policy, stale/no-traffic, and unsealed material indicators.
- Customer-safe CSV/JSON export without secrets.

Pass criteria:

- User can understand where sensitive API usage lives.
- User can identify at least one risk or ownership gap.
- Export does not include raw keys, tokens, request bodies, response bodies, or repository contents.

### Scenario 2: Provider Slot And Policy

Target user: platform owner, app owner, security owner.

Show:

- Provider slot posture: sealed live, placeholder, mixed, or missing.
- Caller-lock policy: allowed origins, customer gateway marker, methods, path prefixes, rate limits, and client/device controls.
- A protected dry-run or controlled sandbox execution path.

Pass criteria:

- User understands that VaultProof controls use of a key without revealing the key.
- User can explain what requests should be allowed or denied.
- Dry-run or sandbox execution creates audit/activity evidence.

### Scenario 3: Exposure Response

Target user: security owner, incident owner, compliance reviewer.

Show:

- Redacted scanner finding intake.
- Affected provider slot mapping.
- Rotation/revoke checklist.
- Evidence packet and audit export.

Pass criteria:

- User understands what VaultProof can immediately control and what must be rotated upstream.
- No raw finding content or secret value is pasted into the dashboard.
- The evidence packet is usable in a customer security review.

### Scenario 4: B2B Tester Readiness

Target user: business owner, pilot owner, VaultProof operator.

Show:

- Tester roster, assigned scenarios, login status, session owner, blockers, and success criteria.
- Guided session plan for the first customer walkthrough.
- Customer-safe feedback capture.

Pass criteria:

- Every tester has a role, scenario, owner, and expected outcome.
- Open blockers are visible before the session.
- Feedback is captured without passwords, tokens, keys, payloads, or customer private content.

## Pre-Session Checklist

Complete this before inviting first users:

- Live readiness endpoint returns healthy.
- Enterprise login path works with a real pilot user or approved test user.
- At least one enterprise organization exists with the correct owner.
- At least one project exists with a realistic business name.
- Provider slots are clearly labeled as sealed live or placeholder; do not imply placeholder material is production-ready.
- A customer-safe API inventory row exists for the first workflow.
- Policy drift board has owners, expiry dates, and next actions for open gaps.
- Scanner page has only redacted metadata.
- Release/evidence pages do not expose service-role keys, browser tokens, OAuth secrets, provider keys, encrypted shares, request bodies, or response bodies.
- Tester readiness has the first session owner, scenario, and success criteria.
- Staff-only pages remain on `admin.vaultproof.dev`; customer pages remain on `enterprise.vaultproof.dev`.

## Product Work To Finish

### P0 Before First Users

- Remove public/customer-facing "demo" copy and replace it with "pilot," "walkthrough," "self-test," "placeholder," or "shared pilot runtime."
- Run enterprise control-plane and secure-executor smoke tests after copy changes.
- Run live app QA before the first scheduled session.
- Verify login manually in browser for the exact pilot user path.
- Rotate any provider key that was ever shared in chat, notes, or screenshots.
- Use sealed sandbox provider material for live upstream calls, or keep first-user execution to dry-run only.

### P1 During First Pilot

- Capture first-user feedback by scenario.
- Track confusion separately from bugs.
- Record every requested integration/provider as an inventory item.
- Convert recurring browser-local customer metadata into durable audited tables only after the workflow proves useful.
- Add a post-session review: what was understood, what was trusted, what blocked adoption, and what the business would pay for.

### P2 After First Pilot

- Durable inventory records.
- Durable policy exception approvals.
- Durable tester/session records.
- Automated invite flow.
- Billing/entitlement integration.
- Self-serve onboarding only after guided onboarding is repeatable.

## Recommended First Session Script

1. Start with the business problem: "Where are API keys used, who owns them, and what can they do?"
2. Open the Enterprise dashboard and show runtime readiness.
3. Open Inventory and map one real workflow.
4. Open Provider Slots and explain sealed material versus placeholder material.
5. Open Policy Drift and show what is blocked or allowed.
6. Run a dry-run or sealed sandbox execution.
7. Open Activity/Audit/Evidence and show the proof trail.
8. Open Tester Readiness and agree on the next scenario.

## Go / No-Go

Go when:

- Readiness is healthy.
- Login is verified.
- The first workflow is understandable to a non-developer business user.
- No visible customer page frames the product as a fake demo.
- No customer-facing export contains secret material.

No-go when:

- Login is unverified.
- Provider material is ambiguous.
- A user must paste raw secrets into the browser.
- The walkthrough depends on unexplained internal terms.
- Staff-only pages are accessible from the customer host.
