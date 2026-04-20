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
- Build on `apps/dashboard` for the long-term team UI. Treat `apps/site/app/*` as legacy/static dashboard surface.

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
- enterprise messaging now exists in `apps/site/enterprise-demo.html`

### Current constraints

- the schema is still basically single-user: `projects.user_id`
- access rules are mostly "project owner only"
- there is no org model, membership model, or role system yet
- current dashboard code is still individual-user oriented

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
- marketing/demo pages only when needed for sales or rollout support

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

Status: in progress

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
- [ ] enterprise docs and pilot checklist linked from product
- [ ] usage summaries and alerting for pilot reviews

Exit criteria:

- one customer can complete a 2-week pilot with one app/provider/project

## Phase 5 - Enterprise expansion

Status: pending

Goal:

- add higher-friction enterprise features only after the core team model works

Milestones:

- [ ] SSO / SAML
- [ ] SCIM or basic provisioning sync
- [ ] webhook / SIEM export
- [ ] contract/billing admin controls
- [ ] single-tenant / private deployment evaluation

Exit criteria:

- enterprise buyers can complete security review without needing a separate product

## Current slice

Slice name:

- org + project access foundation

Scope:

- add org and membership tables
- add project membership mapping
- make `projects` capable of being org-owned
- backfill existing single-user projects into personal orgs
- build the first team-oriented shell in `apps/dashboard`
- convert worker project access from owner-only checks to membership-aware checks
- connect the first dashboard page to org/project-aware data
- add org member and invitation APIs
- add project member assignment APIs
- replace the `Members` page placeholder with real org member and invitation data
- do not break existing worker routes or current project creation

Files:

- `supabase/migrations/20260419000000_b2b_org_foundation.sql`
- `supabase/migrations/20260419001000_project_members_foundation.sql`
- `apps/dashboard/src/components/app-shell.tsx`
- `apps/dashboard/src/app/projects/page.tsx`
- `apps/dashboard/src/app/members/page.tsx`
- `apps/dashboard/src/app/audit/page.tsx`

Definition of done:

- migration is additive and safe
- existing code paths still work
- first team shell exists
- worker auth understands org/project membership
- first dashboard project view uses real org/project-aware data
- member management has a real API surface
- the dashboard can show real org members and pending invites
- we can build Phase 1 UI and API work on top of it

## Next up

Immediate next engineering slice after this file:

1. add richer audit events and UX for future org-level destructive actions
2. decide whether archived orgs should have a dedicated recovery screen beyond the shell restore action
3. wire a real email provider for email destinations
4. add export-oriented audit workflows once security-review volume justifies it
5. add richer scheduler visibility if per-org alert automation needs deeper troubleshooting

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
- projects page now supports in-app project creation and a first-team-project onboarding empty state

## Decisions

- Use one product, not a completely separate enterprise UI.
- Use `apps/dashboard` as the long-term B2B application surface.
- Keep schema changes additive until worker and dashboard fully adopt org scope.
- Do not start with SSO, SCIM, or private deployment.
- First real B2B wedge remains software teams using shared third-party API keys across apps, AI, and CI/CD.
