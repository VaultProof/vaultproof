# VaultProof Enterprise Guided Pilot Playbook

Last updated: 2026-05-28

This playbook is for Nelson, Max, and the VaultProof team. It is the operating guide for founder-led enterprise pilots. Use it to qualify the right customers, run the first walkthrough, guide setup, capture feedback, and turn early usage into product-market-fit evidence.

## Are We Ready?

Yes, for guided enterprise pilots.

VaultProof Enterprise is ready when the customer understands that the first rollout is hand-held. We can walk a business through API key inventory, provider slots, access control, policy, runtime proof, audit evidence, key exposure response, tester readiness, and a first workload plan.

We are not ready to promise public self-serve enterprise onboarding where any company can sign up, connect SSO, invite the full team, move production traffic, and run alone without VaultProof support.

Use this positioning:

```text
VaultProof Enterprise is ready for guided design partners and paid pilots.
It is not yet a fully self-serve enterprise platform.
```

## Product-Market-Fit Target

Find product-market fit through the enterprise product first.

The best early buyer is:

- Seed or Series A.
- 10-50 people.
- API-heavy product.
- AI, fintech, dev tools, health tech, data infrastructure, or security-adjacent.
- Building agents, calling 5+ external APIs, or preparing for SOC 2.
- Has a technical founder, CTO, head of engineering, platform owner, or security-minded engineering lead.

Strong buying triggers:

- The company just raised and customer security reviews are coming.
- They are building AI agents and API keys are ending up in prompts, tools, notebooks, internal apps, or workflows.
- Engineering is scaling and credential sprawl is becoming visible.
- SOC 2, customer due diligence, procurement, or an enterprise deal is coming.
- They have already had a close call with a leaked key, over-permissioned token, or unknown API owner.

Weak fit for now:

- Companies that want a fully self-serve product immediately.
- Companies that cannot name one real provider key or API workflow.
- Companies with no urgency around security, audit, AI agents, or customer reviews.
- Very large enterprises that require long procurement before a small guided pilot.

## Roles For Nelson And Max

Nelson owns product truth, demo flow, technical answers, support boundaries, and follow-up commitments.

Max owns customer alignment, warm intros, buyer qualification, call scheduling, and keeping the conversation tied to funding traction.

On calls:

- Nelson should run the product walkthrough and technical trust answers.
- Max should watch for buyer language, urgency, budget, objections, and who else needs to be in the room.
- One person should take notes in a customer-safe format. Do not paste credentials, screenshots with secrets, raw logs, customer payloads, or request bodies into notes.

## First Outreach Ask

The first ask is not "buy this today."

Use this:

```text
We are running a small guided enterprise pilot for API-heavy teams building with AI and external APIs. Could we walk you through VaultProof and see if your team has a real key-security problem this solves?
```

If the buyer is warm, ask for a 30-minute call with the founder/CTO/head of engineering plus whoever owns security or platform.

## Qualification Questions

Ask these before or during the first call:

1. Which external APIs does your product depend on today?
2. Where do those API keys live right now?
3. Are any keys used by AI agents, internal tools, notebooks, scripts, or CI?
4. Who owns rotation when a key leaks or an employee leaves?
5. Do you know which apps call which providers?
6. Do you need SOC 2, customer security reviews, or audit evidence in the next 6 months?
7. Which provider key would hurt the most if it leaked?
8. Would you test one low-risk workflow with us if we guide setup?

Good signal:

- They can name a provider key, app, owner, and security concern.
- They ask about SSO, audit logs, evidence, revocation, rotation, or how traffic is proxied.
- They want to show it to another technical owner.
- They say this maps to a current review, agent rollout, or SOC 2 need.

Bad signal:

- They only want general password management.
- They do not use external APIs.
- They cannot name any owner or workflow.
- They want a finished procurement-grade enterprise rollout before a guided pilot.

## First Call Agenda

Use 30 minutes:

1. Five minutes - confirm their API and AI workflow.
2. Five minutes - explain the problem: raw API keys spread across apps, agents, prompts, `.env`, CI, internal tools, and dashboards.
3. Ten minutes - show the enterprise dashboard, API Inventory, Provider Slots, Policy, Activity, Audit, Evidence, and Key Exposure Response.
4. Five minutes - ask which one workflow could be a pilot.
5. Five minutes - agree on next step: tester, SSO needs, provider path, or technical review.

If they have 45 minutes, spend the extra time on their exact key flow and what proof they need for security review.

## Demo Flow

Open the staff-only support room first:

```text
https://admin.vaultproof.dev/app/support
```

Then walk the customer-facing product in this order:

1. `https://enterprise.vaultproof.dev/app/dashboard` - show runtime posture, org scope, and workspace tabs.
2. `/app/inventory` - show the API system of record: owners, risk, environment, provider-slot mapping, review status, and evidence export.
3. `/app/keys` - show provider slots, material status, dry-run request, blocked-recipient denial, emergency revoke, and key exposure response.
4. `/app/policy` - show drift, exceptions, launch blockers, compensating controls, and accepted-risk expiration.
5. `/app/activity` - show runtime evidence: status codes, latency, denials, provider request IDs, and attestation summary.
6. `/app/audit` - show governance and runtime event history plus CSV export.
7. `/app/evidence` - show customer-safe JSON proof with secrets excluded.
8. `/app/security-review` - show the buyer/security packet and copyable answers.
9. `/app/testers` - show how the guided tester session is tracked.
10. `https://admin.vaultproof.dev/app/pilot` - staff-only proposal builder for the first paid pilot package: one workload, one provider path, one owner group, success metric, support boundary, and close steps.

Do not over-demo every page. The point is to make the buyer say:

```text
This solves a real key-security problem for us.
```

## Guided Customer Setup Sequence

Use this after a customer says yes to a pilot.

1. Create or confirm the customer business in `admin.vaultproof.dev`.
2. Invite the first owner or confirm the customer login path.
3. Decide SSO mode: temporary email/password, invite-only, or Supabase SAML/Entra path.
4. Pick one workload, one provider path, and one owner group.
5. Open `/app/inventory` and record the API surface with owner, environment, risk, data sensitivity, and provider-slot mapping.
6. Open `/app/projects` and confirm the project scope.
7. Open `/app/keys` and create or review the provider slot. Do not paste raw provider keys into ordinary docs, support notes, email, chat, or screenshots.
8. Open `/app/control` and confirm caller-lock policy, upstream host, path, methods, and rate limits.
9. Run dry-run first. Use live upstream dispatch only when provider material and customer approval are ready.
10. Open `/app/activity` and `/app/audit` to confirm evidence exists.
11. Open `/app/evidence` and export the customer-safe packet.
12. Open `/app/testers` and record tester status, session window, facilitator, customer owner, success criteria, feedback, and blockers.
13. Open `/app/pilot-success` after the first guided session to capture the weekly update, blockers, and expansion decision.

## Pilot Success Criteria

A pilot is successful when at least one of these is true:

- The customer says they would use VaultProof for one real provider/API workflow.
- The customer agrees to a paid pilot or procurement path.
- The customer introduces the security, platform, or app owner needed for implementation.
- The customer gives a strong quote, problem statement, or product feedback we can use in fundraising.
- The customer identifies a specific missing feature that blocks adoption and is narrow enough to build.

For funding, capture:

- Company type and stage.
- Buyer role.
- Trigger event.
- API/key problem.
- Demo reaction.
- Pilot status.
- Requested features.
- Willingness to pay.
- Quote or customer-safe summary.

## What To Avoid Saying

Avoid:

- "Any company can self-onboard today."
- "We replace every secret manager."
- "We automatically rotate every external provider key."
- "We are production-ready for a large enterprise rollout without a guided setup."
- "We have certifications before auditors sign them."
- "We can see or recover your raw provider keys from the dashboard."

Say instead:

- "We are ready for guided pilots."
- "Start with one workload and one provider path."
- "VaultProof can protect, proxy, audit, and prove routed provider usage."
- "Keys and sensitive provider material stay out of customer-facing packets and ordinary dashboard views."
- "Raw keys outside VaultProof still need upstream rotation and cleanup by the customer."

## Post-Call Follow-Up

Send this after a strong call:

```text
Thanks again for walking through VaultProof with us.

Based on the call, the strongest pilot fit looks like:
- Workload:
- Provider/API:
- Owner:
- Current key risk:
- Evidence needed:
- Next step:

We recommend a guided pilot with one low-risk workflow first. We will help map the API inventory, provider slot, policy, dry-run test, audit evidence, and security review packet before any broader rollout.
```

## Weekly PMF Review

Every Friday, Nelson and Max should review:

- How many qualified founders/CTOs/security leads were contacted.
- How many demos were booked.
- How many demos reached "real problem" confirmation.
- How many moved to tester, technical review, or paid pilot.
- The top 3 objections.
- The top 3 requested features.
- The clearest customer quote.
- Whether the target segment should narrow.

The PMF question is simple:

```text
Are the right early companies pulling VaultProof into a real workflow?
```

If yes, keep narrowing the ICP and convert pilots. If no, change the target, offer, demo flow, or first use case before building too broadly.
