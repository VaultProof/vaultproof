# B2B / Enterprise Build Plan

Status: active
Owner: VaultProof core product
Last updated: 2026-04-19

## Why this file exists

We have already done enough strategy work in chat. This file is the build source of truth so we stop re-planning the same roadmap and start shipping against a shared tracker.

Rules:

- Every B2B/enterprise change should map to a phase and milestone in this file.
- When we ship a meaningful slice, update `Current slice`, `Completed`, and `Next up`.
- Prefer additive, non-breaking migrations and feature flags while the single-user flow still exists.
- Build on `apps/dashboard` for the long-term team UI, but keep the live static dashboard in `apps/site/app/*` actively updated while production still routes there.

## Product goal

Turn VaultProof from a single-user API key security tool into a team-safe control plane for third-party API credentials used across:

- application backends
- browser-connected apps
- AI agents and coding tools
- CI/CD pipelines
- future fleet gateways for IoT / robotics / connected systems

Core promise:

- teams share controlled project access, not raw provider keys
- admins get policy, auditability, and revoke controls
- adoption does not require a full secrets-manager migration

## Current codebase reality

### Strong starting points

- `packages/init-worker` already has project-based proxying, origin lock, and access logs
- `supabase/migrations` already has `projects`, `project_keys`, and `project_access_logs`
- `apps/dashboard` exists and is the right home for real org/team UX
- `apps/site/app/*` is now also carrying real B2B surface area for the live product, not just solo views
- enterprise messaging now exists in `apps/site/enterprise-demo.html`

### Current constraints

- the schema and worker now support orgs, memberships, project roles, invitations, audit, and alerts, but the product is still dual-running across two dashboard surfaces
- `apps/dashboard` is richer structurally, while `apps/site/app/*` is the live deployed shell
- SSO/SAML is intentionally not in the live product right now; shared-workspace users still use the existing auth path with org-aware routing
- contract/billing/admin packaging is still behind the governance surface we have built

## Repo surfaces we will touch

### Data / auth

- `supabase/migrations/*`
- `packages/init-worker/src/lib/user-auth.ts`
- `packages/init-worker/src/lib/project-auth.ts`
- `packages/init-worker/src/routes/projects.ts`

### App UI

- `apps/dashboard/src/app/*`

### Legacy/static UI

- `apps/site/app/*`
- live production dashboard surface for solo plus team/business users
- marketing/demo pages when needed for sales or rollout support

## Phases

## Phase 0 - Foundation and tracking

Status: completed

Goal:

- create the execution system
- create non-breaking schema foundations for org/team support

Milestones:

- [x] create B2B build plan / tracker
- [x] create org foundation migration without breaking current flows
- [x] decide whether the next UI slice lands in `apps/dashboard` only or dual-runs with legacy dashboard

Exit criteria:

- tracker exists in repo
- schema can represent orgs and members
- current single-user project creation still works
- first B2B shell exists in `apps/dashboard`

## Phase 1 - Organization model

Status: in progress

Goal:

- support org-scoped ownership instead of only user-scoped ownership

Milestones:

- [x] add `organizations`
- [x] add `organization_members`
- [x] add roles: `owner`, `admin`, `member`, `viewer`
- [x] attach `projects` to organizations
- [x] backfill existing projects into personal orgs

Exit criteria:

- every project can belong to an org
- membership and role checks can be enforced server-side

## Phase 2 - Shared project access

Status: in progress

Goal:

- allow multiple people to use the same VaultProof project without sharing raw secrets

Milestones:

- [x] add `project_members` or equivalent access mapping
- [x] add project assignment APIs
- [x] add project-scoped role checks in worker helpers
- [x] update dashboard data loading to respect org/project membership

Exit criteria:

- multiple users can access the same project
- access is enforced server-side
- no user can retrieve raw provider secrets

## Phase 3 - Admin / governance controls

Status: completed

Goal:

- make the product feel like a B2B control plane

Milestones:

- [x] org-level member management
- [x] project policy management
- [x] audit log page
- [x] policy change log
- [x] revoke / disable project flow
- [x] usage and denied-request visibility

Exit criteria:

- an admin can answer: who has access, what is allowed, what happened, and how do I shut it off

## Phase 4 - Enterprise onboarding and pilot motion

Status: in progress

Goal:

- make founder-led pilots repeatable

Milestones:

- [x] team/org onboarding flow in dashboard
- [x] first-run "create org / invite team / create project" flow
- [x] connect project creation directly into provider key setup
- [x] usage summaries and alerting for pilot reviews
- [x] enterprise docs and pilot checklist linked from product
- [x] shared-workspace login and provisioning path

Exit criteria:

- one customer can complete a 2-week pilot with one app/provider/project

## Phase 5 - Enterprise expansion

Status: pending

Goal:

- add higher-friction enterprise features only after the core team model works

Milestones:

- [ ] `Supabase Auth` SSO / SAML integration
- [ ] SCIM or basic provisioning sync
- [ ] webhook / SIEM export
- [ ] contract/billing admin controls
- [ ] single-tenant / private deployment evaluation

Exit criteria:

- enterprise buyers can complete security review without needing a separate product

## Current slice

Slice name:

- initial `Supabase Auth` SSO entry, rollout prep, and membership resolution

Scope:

- keep the existing shared-workspace login flow intact
- add a non-breaking `Supabase Auth` SSO entry point to the live login page
- use domain-based `signInWithSSO()` as the first implementation path
- add an admin-facing SSO rollout prep panel in the live org page
- persist shared-org SSO rollout prep through the worker with governance audit coverage
- resolve configured SSO logins into existing org membership or matching invited access
- keep broad domain-based auto-join out of scope until we decide the enforcement model
- route SSO callbacks back through the existing login/session resolution flow
- do not turn on org auto-join or SSO enforcement yet
- do not break the existing solo dashboard or OAuth/email paths

Files:

- `apps/site/js/app-login-3.js`
- `apps/site/app/login.html`
- `apps/site/js/app-org-1.js`
- `apps/site/app/org.html`
- `apps/site/js/app-control-1.js`
- `packages/init-worker/src/routes/orgs.ts`
- `docs/plans/2026-04-19-third-party-acceleration.md`

Definition of done:

- shared-workspace users have a visible `continue with sso` entry point on the live login page
- domain-based `Supabase Auth` SSO can redirect to the configured IdP when available
- org admins have a concrete Supabase SSO rollout panel with metadata and ACS URLs plus a copyable setup brief
- org SSO rollout settings are persisted and auditable, not browser-local only
- configured Supabase SSO logins can resolve into the correct shared workspace when the user already has membership or a matching invite
- unmatched but configured SSO workspaces fail safely without broad auto-join
- the callback path returns to the existing login/session resolution flow without breaking OAuth or email sign-in
- solo users still land in the simpler `/app/` surface

## Next up

Immediate next engineering slice after this file:

1. test the `Supabase Auth` flow end-to-end with a real provider like Google Workspace or Okta
2. decide whether matching-domain SSO should ever auto-join or stay invite-only until enforcement exists
3. decide when to converge the live static dashboard and `apps/dashboard` into one primary surface

## Third-Party Acceleration Checklist

Goal:

- move faster by buying narrow infrastructure where it clearly reduces build effort without giving up the core VaultProof control plane

Checklist:

- [x] keep `Supabase Auth` as the current user/session system while the shared-org model stabilizes
- [x] use `Resend` for product email delivery in the worker instead of building a mail pipeline
- [ ] decide whether outbound webhooks stay in-house or move to a delivery platform like `Svix`
- [x] use `Supabase Auth` as the default SSO path for now
- [ ] decide whether future SCIM / directory sync should use `WorkOS`, `Stytch`, or stay out of scope until customers demand it
- [ ] decide whether SIEM / audit export should stay as CSV/JSON first or move to a managed stream/export product

Rules:

- do not outsource the core VaultProof policy, proxy, audit, or org/project authorization model
- only buy third-party infrastructure for commodity layers like auth federation, email delivery, webhook delivery, and directory sync
- prefer narrow integrations that can be removed later without rewriting the product
- add a repo doc for each third-party decision before implementation if the choice affects pricing or enterprise packaging

## Completed

- enterprise marketing/demo page added
- product header links added for enterprise demo
- `@vaultproof/init` published at `0.1.2`
- B2B build tracker created
- org foundation migration added
- project membership foundation added
- first team-oriented dashboard shell added in `apps/dashboard`
- worker project auth converted to org/project membership-aware checks
- project creation now attaches to personal orgs and seeds initial project membership
- `apps/dashboard` projects page now loads real access-aware project and stats data
- organization invitation migration added
- `/api/v1/init/members` now returns real org members, project coverage, and pending invites
- `/api/v1/init/projects/:id/members` now supports project member listing, assignment, and removal
- `apps/dashboard` members page now loads real member and invitation data
- `apps/dashboard` members page now creates invites and updates project assignments through the new worker APIs
- pending invites can now be accepted into real org membership through the worker and dashboard
- `apps/dashboard` keys page now uses org/project-aware init-worker routes instead of legacy key endpoints
- project creation now hands onboarding directly into `/keys?project=...&onboarding=1` for first-provider setup
- first provider setup now lands on a guided post-setup state with "invite team" and project policy follow-up actions
- project origin policy can now be edited directly from the team dashboard instead of being read-only
- admins can now disable a project from the dashboard for fast shutdown without leaving the team UI
- project overview now surfaces denied/error activity and per-project health directly from runtime access logs
- admins can now update joined members between org roles from the Members page, and those changes are written to the audit trail
- admins can now remove members from the org, and project access in that org is cleaned up at the same time with owner/self safeguards
- owners can now transfer organization ownership transactionally and archive team organizations from Settings with explicit guardrails
- archived team organizations can now be restored by the owner from the org shell, so archive is no longer operationally one-way
- the audit feed now supports server-side source/project/event-type filters plus paging, so the dashboard does not have to rely only on client-side slicing
- the audit feed now supports server-side search as well, so the worker handles the heavier query narrowing before results reach the dashboard
- the audit page now surfaces richer event metadata directly in the UI, including target, role, owner-transfer, and proxy request details for destructive/admin actions
- settings and org-shell UX now explain archive vs restore semantics more clearly, including that archive preserves members, projects, and audit history until an owner restores the org
- project overview now includes a pilot review summary plus first-pass alert generation so founder-led pilots can be reviewed from buyer-readable health signals instead of raw logs alone
- projects page now generates an exportable pilot review brief with copy-ready text for customer updates, internal reviews, and sales follow-up
- organizations can now store alert destinations, and the dashboard includes a dedicated Alerts page for email/webhook targets plus sample payload preview
- alert destinations now support test-send and delivery logging; webhooks send real payloads, while email targets are stored and explicitly marked as awaiting a future mail provider
- alerting now includes org-level dispatch policy with severity thresholds plus a policy-based “dispatch current alerts” flow that later automation can call directly
- alert policy now includes dispatch cooldown control, so future scheduled dispatch can reuse the same endpoint without repeatedly firing the same org inside a short window
- init-worker now has a scheduled cron dispatch path that evaluates enabled org policies automatically and reuses the same policy-dispatch helper as the dashboard
- alerts UI now shows last policy dispatch, next eligible dispatch time, and whether cooldown is currently active, so operators can see dispatch state without reading logs
- alerts now record per-org dispatch runs for both manual and scheduled policy evaluation, and the dashboard surfaces that run history separately from destination-level delivery logs
- alerts UI now includes copyable operations exports, including a compact ops report plus CSV exports for dispatch runs and delivery logs
- alerts exports are now downloadable from the dashboard as report/CSV files instead of being copy-only
- alerts UI now supports filtering and search for dispatch runs and delivery logs, and those same filters drive the export/report output
- alerts UI now supports scoped review windows (`24h`, `7d`, `30d`, `all`) so operators can narrow both on-screen history and exported output to the period they actually need
- alerts exports now include a structured JSON snapshot of the currently filtered alert state for incident docs, internal tooling, and security handoff
- alert log and dispatch-run filtering now execute server-side in the worker, and the dashboard can page through additional history with `Load more` instead of being capped to one fixed in-browser slice
- governance audit event migration added
- governance writes now occur for invites, invite acceptance, project create/update/revoke, project assignment, and key rotate/revoke
- `/api/v1/init/audit` now returns a unified governance + proxy event feed
- `apps/dashboard` audit page now reads the real audit feed instead of placeholder data
- `apps/dashboard` audit page now supports filtering by source, project, event type, and search query
- `/api/v1/init/orgs` now supports real team organization creation and org listing
- dashboard shell now supports active organization switching and in-shell team org creation
- project, member, and audit pages now scope requests to the selected organization via active-org headers
- `/api/v1/init/orgs/current` now supports org settings reads and rename/slug edit flows
- dashboard now includes a real Settings page for active-org metadata and overview
- live static login now routes shared-org users and users with pending invites into the team/business dashboard surface
- live static dashboard now includes separate team/business pages for `control`, `members`, `audit`, and `alerts`
- live static `control` page now supports org switching, incoming invite acceptance, project policy editing, and exportable operator summaries
- live static `members` page now supports invites, role changes, member removal, project access assignment, and export/csv/json handoff
- live static `audit` page now supports org-aware audit review with filters, paging, copy report, and JSON export
- live static `alerts` page now supports alert policy editing, destination management, test send, manual dispatch, exports, filters, and load-more paging
- shared toast feedback now exists across the live static team/business pages
- live static dashboard now includes a dedicated `org` page for rename/slug edit, ownership transfer, archive, restore, and org-level handoff export
- live static dashboard now supports team-org creation directly from `/app/org`, so a solo user can create a shared workspace without relying on the separate Next.js app
- login now routes shared-org users and invited users into the live team/business dashboard without disrupting the solo flow
- email alert destinations in `init-worker` now deliver through Resend when `RESEND_API_KEY` and `ALERTS_FROM_EMAIL` are configured, while keeping webhook delivery unchanged
- live static `control` page now links enterprise demo/docs/security resources and generates a copyable/downloadable pilot checklist from the current org state
- live static `org` and `alerts` pages now carry rollout resources plus copyable setup/ops checklists so enterprise handoff is not isolated to `control`
- live static `members` and `audit` pages now carry rollout/review resources plus copyable access/audit checklists so the shared-org admin flow has consistent enterprise handoff support
- live product SSO/provisioning scaffolding was intentionally removed from the worker and live static dashboard so the shipped B2B surface stays focused on orgs, members, audit, alerts, and governance
- third-party acceleration is now tracked explicitly in-repo so auth, sync, webhook, and email decisions can be made against a checklist instead of ad hoc chat history
- `Supabase Auth` is now the explicit chosen SSO path for the near-term roadmap; alternate vendors are fallback options, not the default plan
- live login now includes the first real `Supabase Auth` SSO entry point using a company-domain flow that routes back through the existing session resolver
- live org settings now include a practical `Supabase Auth` SSO rollout prep panel with domain/provider capture, Supabase metadata/ACS URLs, and a copyable setup brief
- shared-org `Supabase Auth` rollout prep is now persisted through the worker and written into governance audit events instead of living only in browser state
- shared-workspace `Supabase Auth` logins can now resolve into an existing org membership or accept a matching pending invite after SSO login, while unmatched users fail closed instead of broad auto-join
- projects page now supports in-app project creation and a first-team-project onboarding empty state

## Decisions

- Use one product, not a completely separate enterprise UI.
- Use `apps/dashboard` as the long-term B2B application surface, but continue shipping meaningful B2B functionality in `apps/site/app/*` until production no longer depends on it.
- Keep schema changes additive until worker and both dashboard surfaces fully adopt org scope.
- Do not rebuild identity plumbing too early; defer SSO, SCIM, and private deployment until a third-party path or direct customer pull justifies it.
- If SSO is needed in the near term, use `Supabase Auth` first rather than introducing a second auth vendor.
- First real B2B wedge remains software teams using shared third-party API keys across apps, AI, and CI/CD.
