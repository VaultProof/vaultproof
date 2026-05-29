# VaultProof GCP Build Status

Last updated: 2026-05-29T10:56:40.086Z

This file is the living inventory of what has been built for VaultProof on Google Cloud. It is refreshed after every successful enterprise image build by `infra/gcp/enterprise-secure-runtime/build-images.sh`.

## Build Snapshot

- Public edge: `live`
- Enterprise URL: `https://enterprise.vaultproof.dev`
- DNS: `Cloudflare A record points at 34.102.179.105`
- TLS: `Google-managed certificate active`
- Staff/admin boundary: `vaultproof.dev is the B2C/root system; enterprise.vaultproof.dev is customer enterprise only`
- Backend: `healthy`
- Origin-lock backend header: `configured`
- Cloud Armor edge policy: `attached and enforced`
- Auth/database provider: `managed Supabase for Goal 1 demo; fresh database later`
- Public Supabase anon key: `configured`
- Runtime readiness: `production ready on the live GCP edge`

## Goal 1: Testable Paid Pilot

Status: `done for the demo dry-run goal`

`SKIP_LOCAL_CHECKS=true npm run gate:gcp-first-goal` returned `status: done` against `https://enterprise.vaultproof.dev` on 2026-05-10. The gate verified the live GCP edge, runtime readiness, origin lock, GCP KMS unwrap path, Supabase-backed material resolver, first pilot data for `ken@vaultproof.dev`, a generated Supabase test session, and the dry execute path end to end. For the demo path, the provider slot uses dashboard placeholder shares; live encrypted provider material is a later switch when we are ready to call an upstream provider.

Current blockers:

- Run strict login readiness QA with `LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login` to verify the Supabase redirect/session/API path.
- Human OAuth/password login still needs final browser click-through QA.
- Supabase Auth redirect/provider settings still need confirmation for `https://enterprise.vaultproof.dev/app/login`.
- Rotate the pilot MiniMax key before paid customer onboarding because it was shared in chat; keep using sealed local ingest for any future live provider key.

## Login Readiness QA

Status: `partially verified live on 2026-05-22; strict session proof still blocked by missing local service-role env`

`npm run qa:enterprise-login` now checks the live enterprise login page, validates the public Supabase URL/anon key embedded in `https://enterprise.vaultproof.dev/app/enterprise-login.js`, and verifies the login script still sends OAuth, magic-link, confirmation, and recovery redirects back to `https://enterprise.vaultproof.dev/app/login`.

For the final demo go/no-go run, use `LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login` with Supabase service-role env loaded. That strict mode generates a temporary magic-link session for `ken@vaultproof.dev`, which also proves the Supabase Auth redirect allowlist accepts `https://enterprise.vaultproof.dev/app/login`, then calls `/api/v1/enterprise/orgs`, `/orgs/current`, and `/projects/bootstrap` with the generated browser session. To verify a specific external provider redirect, add `LOGIN_QA_OAUTH_PROVIDER=google` after the provider is configured.

Latest live check on 2026-05-29:

- `npm run qa:enterprise-live-app` passed against `https://enterprise.vaultproof.dev`: `production_ready: true`, `security_profile: google-confidential-production`, 26 app paths, 7 staff-only paths, and the discovered enterprise links checked.
- `npm run verify:gcp-enterprise-edge` passed after deploying build `2e8a67fa`. The verifier confirmed edge IP `34.102.179.105`, active managed TLS for `enterprise.vaultproof.dev`, healthy backend `vaultproof-enterprise-runtime-1:3001`, `/health`, and `/readiness`.
- `npm run verify:gcp-enterprise-cloud-armor` passed after deploying build `2e8a67fa`. The verifier confirmed `vaultproof-enterprise-armor` is attached to `vaultproof-enterprise-backend`, `/health` returns `200`, and the `/.env` scanner probe returns `403`.
- `RUN_LIVE_EDGE=true RUN_LIVE_APP_QA=true RUN_CLOUD_ARMOR_QA=true npm run gate:gcp-customer-launch` returned `status: ok` with no blockers. Strict Supabase session proof is still skipped until `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SERVICE_KEY` is loaded in the local shell.

## Cloud Armor Edge Guardrail

Status: `attached and enforced`

`npm run configure:gcp-enterprise-cloud-armor` creates or updates `vaultproof-enterprise-armor` and attaches it to `vaultproof-enterprise-backend`. The policy blocks common secret/config/admin scanner paths before they reach the VM and applies per-IP throttles to the secure execute route, enterprise API routes, and the public edge. `npm run verify:gcp-enterprise-cloud-armor` checks the policy attachment, expected rule priorities, `/health` availability, and a blocked `/.env` scanner probe.

## App Shell Notes

- Build `2e8a67fa` is the current deployed GCP image tag for both control plane and executor containers.
- Homepage hero headline is `Active Key Protection for every API call.`
- Customer-facing enterprise pages live under `https://enterprise.vaultproof.dev`; staff-only operator pages live under `https://admin.vaultproof.dev`.
- `https://admin.vaultproof.dev/app/launch` is the staff-only go/no-go launch board. `https://enterprise.vaultproof.dev/app/launch` is intentionally removed from the customer enterprise host and should return 404.
- `https://admin.vaultproof.dev/app/demo` is the staff-only buyer walkthrough: live workspace facts, proof path, identity/OAuth proof kit, key-rotation proof kit, pilot operations proof kit, API proxy self-test kit, monitoring evidence kit, paid-pilot tester readiness, paid-customer onboarding, safety guardrails, objection answers, paid-pilot close steps, and a copyable demo talk track generated without secrets. `https://enterprise.vaultproof.dev/app/demo` is intentionally removed from the customer enterprise host and should return 404.
- `https://enterprise.vaultproof.dev/app/docs` is the enterprise-only documentation index for purchased customers: setup, technical guide, security review, runbooks, evidence, provider slots, scanner, SSO notes, key exposure response, proof boundary, and links to the customer-safe operating pages without mixing in public developer docs.
- `https://enterprise.vaultproof.dev/app/evidence` is the customer proof packet: runtime readiness, go/no-go launch decision and blockers, identity/login QA evidence, key-rotation/demo-only acceptance evidence, pilot operations rollback and budget/monitoring evidence, API proxy self-test evidence, API inventory proof, policy drift proof, integration rollout proof, scanner exposure proof, release evidence proof, paid-pilot tester proof, paid onboarding proof, launch support readiness, monitoring evidence with alert workflow/Cloud Armor/budget guardrails, access-review and audit export links, provider posture, rollout workflow, and copy/download JSON evidence summary without secrets.
- `https://enterprise.vaultproof.dev/app/inventory` is the customer API inventory board: metadata-only API surfaces from existing projects, provider slots, manual API key records, browser-local CSV/OpenAPI JSON import hints, caller-lock policy, project health, and access-log rollups; browser-local owner/environment/risk/review annotations; search and filters for status, review, risk, and source; bulk review actions for currently filtered rows; protected/manual-key/missing-provider/needs-sealed-ingest/policy-incomplete/no-traffic/stale/review-due posture; workflow links; and copyable full CSV, filtered CSV, review brief, plus `vaultproof_enterprise_api_inventory` JSON without secrets.
- `https://enterprise.vaultproof.dev/app/policy` is the customer policy drift board: control-gap rows from existing project/provider/policy/inventory/traffic evidence; browser-local accepted-risk records with owner, reason, risk, compensating control, expiration date, approval status, and next action; filters for search, severity, status, and control; launch hold summary; workflow links; copyable drift brief; and copyable `vaultproof_enterprise_policy_drift` JSON without secrets.
- `https://enterprise.vaultproof.dev/app/rollout` is the customer integration rollout board: workload cutover rows from API inventory/policy/traffic evidence; browser-local application, integration mode, owner, target date, canary, test status, rollback, and support metadata; filters for search, rollout status, integration mode, test status, and blocker type; derived blockers; copy-safe dry-run snippets with placeholders; copyable rollout brief; and copyable `vaultproof_enterprise_integration_rollout` JSON without secrets.
- `https://enterprise.vaultproof.dev/app/scanner` is the scanner exposure intake: browser-local redacted repository exposure findings; owner, severity, status, provider-slot hint, evidence reference, and remediation metadata; no repository upload or `/api/scanner` calls; and copyable `vaultproof_enterprise_scanner_exposure_review` JSON without secrets.
- `https://enterprise.vaultproof.dev/app/release` is the release evidence center: browser-local build/image tag, change summary, approver, verifier, verification status, rollout state, rollback owner/path, and customer-safe notes; it exports `vaultproof_enterprise_release_evidence` JSON without secrets and feeds Evidence, Demo, and Security Review.
- `https://enterprise.vaultproof.dev/app/testers` is the paid-pilot tester readiness board: browser-local tester roster, login/scenario status, scenario assignment, guided session plan, blocker notes, customer-safe feedback, copyable session brief, and copyable `vaultproof_enterprise_paid_pilot_tester_readiness` JSON without secrets.
- `https://enterprise.vaultproof.dev/app/entitlements` is the paid-user entitlement board: browser-local contract/capacity/commercial handoff metadata, usage meters for calls/provider slots/seats, capacity status, expansion recommendation, hard-limit boundary, invoice/PO readiness, amendment/renewal log, copyable capacity brief, and copyable `vaultproof_enterprise_entitlements` JSON without secrets.
- `https://admin.vaultproof.dev/app/onboarding` is the staff-only paid-customer onboarding board: browser-local activation owners, enterprise admin login handoff, first workload owner, support handoff, capacity/renewal review, key posture, customer testing window, role-specific task checklist for security/platform/app/billing/support owners, copyable task brief, and copyable `vaultproof_enterprise_paid_onboarding` JSON without secrets. `https://enterprise.vaultproof.dev/app/onboarding` is intentionally removed from the customer enterprise host and should return 404.
- `https://enterprise.vaultproof.dev/app/security-review` is the buyer security packet: concise architecture summary, control coverage, evidence links, searchable/filterable open review items, common customer answers, known limitations, secret exclusions, copyable full security/procurement review text, and a copyable focused review brief for the currently filtered blockers/limitations.
- `https://enterprise.vaultproof.dev/app/plans` is the buyer package view: rollout posture, paid-pilot commercial package, contract guardrails, security boundaries, and direct links into evidence, support, technical guide, and runbooks.
- `https://admin.vaultproof.dev/app/pilot` is the staff-only paid-pilot proposal builder: browser-local first workload scope, expected volume, monthly price, 20% sales commission math, support/incident-response terms, success metric, and copyable proposal text without secrets. `https://enterprise.vaultproof.dev/app/pilot` is intentionally removed from the customer enterprise host and should return 404.
- `https://admin.vaultproof.dev/app/pilot-success` is the staff-only pilot success tracker: live checks, browser-local customer milestones, evidence links, blockers, structured expansion/hold/no-go decision with owner and target date, copyable decision brief, and copyable weekly customer update without secrets. `https://enterprise.vaultproof.dev/app/pilot-success` is intentionally removed from the customer enterprise host and should return 404.
- `https://admin.vaultproof.dev/app/support` is the staff-only launch support room: founder-led support scope, optional 24-hour incident-response boundary, staff/admin boundary, read-only default, approval-gated actions, support handoff checklist, and copyable support brief without secrets. `https://enterprise.vaultproof.dev/app/support` is intentionally removed from the customer enterprise host and should return 404.
- `https://enterprise.vaultproof.dev/app/keys` includes the API proxy self-test kit and email API key demo path: copy-safe dry-run requests with required caller-lock headers, Resend/SendGrid/Mailgun/Postmark/AWS SES slot defaults, protected email dry-run, blocked-recipient policy testing, no raw key reveal, launch/evidence coverage, and email-specific audit metadata.
- `https://enterprise.vaultproof.dev/app/control` and `https://enterprise.vaultproof.dev/app/org` use the shared universal sidebar with explicit sidebar typography, hide the legacy static topbar/page frame, and clean old `?org=<uuid>` URLs back to canonical `https://enterprise.vaultproof.dev/app/control` and `https://enterprise.vaultproof.dev/app/org` while preserving the selected org in local storage.
- Live HTML verification on both long-form URLs confirmed the universal sidebar, URL cleanup script, hidden legacy topbar, explicit sidebar font sizing, and no legacy sidebar/site-theme artifacts.
- Staff/admin pages belong on `admin.vaultproof.dev`; `enterprise.vaultproof.dev` remains customer-facing only and does not expose `/api/v1/internal-admin/*`.
- Public root admin copy is removed; root `/admin` and `/vp-admin` now contain only a no-copy redirect/fallback login button to the dedicated admin login.
- Built in this update: the staff admin console can create enterprise businesses, invite/find the first owner, seed SSO metadata, create user invites, and show per-business login links such as `https://enterprise.vaultproof.dev/app/login?org=<business-id>` without exposing service-role keys, OAuth secrets, SAML secrets, or invite tokens.
- `https://admin.vaultproof.dev/` uses the same light enterprise app-shell theme tokens as the customer dashboard and includes a chart-forward staff Control Center with signed-on business/user KPIs, daily API-call trend, account-mix donut, total API calls, API calls by business, traffic-health stack, launch-blocker bars, and SSO/pending-invite posture backed by `project_access_log_daily_rollups`.
- Admin login now exposes a clear `Continue with Google` button, sends Google OAuth with a `vaultproof.dev` hosted-domain hint, and still enforces the server-side internal admin allowlist. Non-`vaultproof.dev` emails are rejected even if they authenticate successfully with Supabase.
- Admin overview/detail reads tolerate a missing `organization_sso_settings` migration by omitting SSO metadata and returning `migration_required` instead of blocking the whole staff console.
- GCP edge now has the `vaultproof-enterprise-admin-cert` certificate attached for `admin.vaultproof.dev`; Cloudflare still needs an `admin` A record to `34.102.179.105` before Google can mark the certificate visible/active.

## Projects Page Performance

Status: `built and deployed in bootstrap-rpc-20260510`

The enterprise Projects/Inventory/Policy/Rollout/Keys/Activity pages load organization options, accessible projects, provider slots, and overview stats through `GET /api/v1/enterprise/projects/bootstrap` instead of chaining `/orgs`, `/projects`, and `/projects/stats/overview` from the browser. In `bootstrap-rpc-20260510`, bootstrap now uses the service-role-only Supabase `enterprise_projects_bootstrap(...)` RPC, which wraps the existing `enterprise_project_access_overview(...)` rollup inside Postgres.

The deployed bootstrap request removes these separate Supabase calls after auth:

- `organization_members` joined to `organizations` for membership/org options.
- `project_members` joined to `projects` for direct project access.
- `organization_members` joined through `organizations.projects` for org-wide project access.
- `project_keys` for provider-slot material status.
- duplicate `project_keys` for overview key/provider counts.
- separate `enterprise_project_access_overview(...)` HTTP RPC call; the new bootstrap RPC calls the rollup inside Postgres.

The remaining external call is Supabase Auth `getUser(token)`, which is still needed to validate the browser session before any service-role data read. The live bootstrap response reports `statsSource: bootstrap_rpc` and `accessLogStatsSource: rollup_rpc`.

Live timing on `https://enterprise.vaultproof.dev` with a temporary Supabase pilot session on 2026-05-09:

| Endpoint | Before | After |
| --- | ---: | ---: |
| `https://enterprise.vaultproof.dev/app/projects` HTML | 132 ms | 140 ms |
| `/api/v1/enterprise/orgs` | 1,709 ms | 209 ms median |
| `/api/v1/enterprise/projects` | 2,173 ms | 456 ms median |
| `/api/v1/enterprise/projects/stats/overview` | 880 ms | 513 ms median |
| `/api/v1/enterprise/projects/bootstrap` | not present | 605 ms median after first warm-up hit |

Live authenticated timing after `rollup-stats-20260509` deployed on 2026-05-10 with a temporary Supabase pilot session:

| Endpoint | Status | Source | Median | p95 |
| --- | ---: | --- | ---: | ---: |
| `/api/v1/enterprise/projects/bootstrap` | 200 | `rollup_rpc` | 452 ms | 682 ms |
| `/api/v1/enterprise/projects/stats/overview` | 200 | `rollup_rpc` | 439 ms | 642 ms |

Live authenticated timing after `bootstrap-rpc-20260510` deployed on 2026-05-10 with a generated Supabase pilot session:

| Endpoint | Status | Source | Median | p95 |
| --- | ---: | --- | ---: | ---: |
| `/api/v1/enterprise/projects/bootstrap` | 200 | `bootstrap_rpc` / `rollup_rpc` | 383 ms | 596 ms |
| `/api/v1/enterprise/projects/stats/overview` | 200 | `rollup_rpc` | 474 ms | 642 ms |
| `/api/v1/enterprise/orgs` | 200 | n/a | 179 ms | 189 ms |

Scale item update: raw logs remain the evidence stream, and `project_access_log_daily_rollups` now carries dashboard counters. The next scale pass is to add retention/partitioning policy for very high call volume.

## API Proxy Speed

Status: `runtime-token fast path deployed in runtime-fastpath-20260510`

The pilot MiniMax slot was sealed with live encrypted material on 2026-05-10. `runtime-fastpath-20260510` added a short-lived HMAC runtime token for product proxy calls plus a short TTL non-secret execution context cache. Provider key material still stays out of the control-plane cache; the executor remains responsible for decrypting provider material and returning attestation.

The live speed test measured the enterprise secure execute route with the pilot policy headers:

- endpoint shape: `/api/v1/enterprise/projects/:projectId/providers/:slug/execute`
- method/path: `POST /v1/chat/completions`
- required headers: `Origin: https://enterprise.vaultproof.dev` and `x-vaultproof-customer-gateway: vaultproof-managed`
- dashboard dry-run behavior covered: Supabase Auth session validation, project/member authorization, strict origin lock, caller-lock policy, provider slot lookup, signed execution envelope creation, and governance audit write
- runtime-token dry-run behavior covered: HMAC token validation, project/provider policy fetch, short TTL context cache, strict origin lock, caller-lock policy, signed execution envelope creation, and governance audit write
- upstream behavior covered: executor material decrypt, GCP KMS unwrap path, provider dispatch to MiniMax, execution result recording, and attestation return

Live authenticated timing on 2026-05-10:

| Product path | Status | Samples | Median | p90 | p95 | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| secure execute dry run | 202 | 12 | 634 ms | 690 ms | 752 ms | 571 ms | 847 ms |
| MiniMax upstream dispatch | 200 | 5 | 5,713 ms | 6,258 ms | 6,258 ms | 3,936 ms | 7,054 ms |

Live runtime-token timing after `runtime-fastpath-20260510` deployed on 2026-05-10:

| Product path | Status | Samples | Median | p95 | Min | Max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| runtime-token secure execute dry run | 202 | 6 | 255 ms | 320 ms | 217 ms | 1,320 ms |
| runtime-token MiniMax upstream dispatch | 200 | 3 | 2,198 ms | 2,198 ms | 1,671 ms | 3,023 ms |

The dry-run runtime-token samples reported `auth_mode: runtime_token`; the first context lookup came from Supabase and the next five came from the short TTL cache. This cuts VaultProof proxy overhead to about 250 ms median on the cached path while keeping origin/caller-lock/audit checks in place.

The first invalid probe without the required `Origin` header returned `403` with `Origin lock rejected this request because no Origin or Referer origin was present.`

Upstream dispatch reached MiniMax and returned `chat.completion` responses from `MiniMax-M2.7` with executor attestation present. MiniMax did not return an `x-request-id`/`request-id` header in the sampled responses.

## Provider Material Status

Status: `built and deployed in provider-material-status-20260509`

Project and Provider Slots pages now classify each active slot as `live sealed`, `demo placeholder`, `mixed`, or `missing` without returning `share1_encrypted` or `share2_encrypted` to the browser. After sealing provider material on 2026-05-10, live API verification returned one MiniMax slot for `First Paid Pilot` with `material_mode: sealed-live`, `material_ready: true`, and no encrypted share fields in the payload. The OpenAI slot was reset to `demo-placeholder` because the supplied key was for MiniMax.

## Feature: Enterprise Provider Preset Catalog

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/keys` now supports an expanded provider preset catalog for the auth patterns the secure executor already supports: generic bearer, generic custom-header, generic preformatted Basic, provider-specific bearer/header templates, account-specific upstream hosts, and non-secret fixed extra headers. Presets include common AI, email, developer, observability, payments, search, infrastructure, database/vector, identity, cloud management, CI/CD, registry, secrets-management, analytics, and SaaS APIs. Recent additions include Azure Management, GCP Resource Manager, Microsoft Graph, Google Workspace, Fastly, Tailscale, Fly, Railway, Terraform Cloud, Pulumi, Bitbucket, CircleCI, Buildkite, Docker Hub, Quay, npm Registry, Better Stack, LogSnag, Raygun, Semgrep, SonarCloud, Elasticsearch, Elastic Cloud, Meilisearch, Typesense, Kubernetes, HashiCorp Vault, 1Password Connect, Doppler, Infisical, Segment, Plausible, Hume, RunPod, Webflow, Salesforce, Zoho CRM, Zoom, Facebook Graph, LinkedIn, and WordPress. Datadog remains metadata/manual-inventory only until multi-secret provider slots are built because it needs both an API key and an application key.

Provider-slot creation still creates demo-placeholder material in the browser flow and rejects raw live provider keys. Extra headers are accepted only as non-secret fixed headers or `{key}` templates for the protected provider key; secret-looking literal values are rejected in the dashboard API and local sealing helper. Presets with customer-specific upstream hosts intentionally leave `upstream_base_url` blank so an operator must enter the real public `https://` provider host before saving.

## Feature: API Inventory Management

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/inventory` gives customer security and platform teams a metadata-only system of record for protected API surfaces: project, provider slot, manual API key metadata, owner, environment, business service, risk level, data sensitivity, caller-lock posture, policy status, last-seen traffic, denial/error posture, review status, and evidence/export links.

The demo slice starts from existing data instead of new infrastructure: it derives inventory rows from projects, provider slots, project policies, project health, access logs, and rollups; adds browser-local/manual annotations for owner, environment, business service, sensitivity, risk, review status, next review date, and notes; lets operators add manual API key records with provider, label, fingerprint/last four, location, upstream scope, rotation status, and review status without storing raw keys; imports approved CSV/API-list/OpenAPI JSON metadata as `vaultproof_inventory_import` hints; filters by search, status, review state, risk, and source; applies bulk review status/date updates to currently filtered rows with timestamped metadata; flags manual/imported keys that still need sealed provider-slot ingest, missing provider slots, stale APIs, no recent traffic, policy gaps, blocked rows, exceptions, and review-due items; exports customer-safe full CSV, filtered CSV, copyable review brief, and `vaultproof_enterprise_api_inventory` JSON; then includes the summary in the evidence packet under `api_inventory`. Persistent audited inventory tables, sealed-key intake from the inventory page, durable CSV/OpenAPI imports, and automatic discovery can follow after the customer demo slice.

Inventory records must never store raw provider keys, bearer tokens, OAuth client secrets, SAML material, request bodies, response bodies, or customer payloads.

## Feature: Policy Drift And Exceptions

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/policy` gives customer security, platform, and app teams a policy drift board tied to API inventory. It shows customer-safe control-gap rows for missing provider slots, weak or absent caller-lock policy, demo-placeholder material on a paid path, missing owners, stale or no recent traffic, review overdue, and blocked inventory rows.

The demo slice starts from existing data instead of new infrastructure: it derives rows from projects, provider slots, project policies, API inventory annotations, project health, traffic rollups, and `GET /api/v1/enterprise/projects/bootstrap`; saves metadata-only accepted-risk records in browser local storage per organization; filters drift by search, severity, status, and control; provides a copyable metadata-only drift brief with priority actions; and includes the summary in the evidence packet under `policy_drift_exceptions`. Persistent audited exceptions, second-person approval, expiry reminders, policy-as-code export, and alerting can follow after the demo slice.

Exception records must never store raw provider keys, bearer tokens, OAuth client secrets, SAML material, request bodies, response bodies, or customer payloads.

## Feature: Integration Rollout Manager

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/rollout` helps a customer move one workload from direct provider calls into VaultProof by showing rollout state, integration mode, app and gateway owners, target date, support window, canary percentage, test status, rollback path, blockers, snippets, and evidence links.

The demo slice starts from existing data instead of new infrastructure: it derives candidate workloads from projects, provider slots, API inventory rows, policy drift, project health, and traffic evidence; saves metadata-only rollout records in browser local storage per organization; filters rollout rows by search, status, integration mode, test status, and blocker type; generates copy-safe dry-run snippets with `YOUR_VAULTPROOF_SESSION_JWT` placeholders; provides a copyable metadata-only rollout brief with priority actions; and includes the summary in the evidence packet under `integration_rollout`. Persistent audited rollout tables, gateway templates, canary metrics, approval gates, rollback links, and notifications can follow after the demo slice.

Rollout records must never store raw provider keys, bearer tokens, OAuth client secrets, SAML material, request bodies, response bodies, or customer payloads.

## Feature: Scanner Exposure Intake

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/scanner` gives customer security and platform teams a metadata-only place to record repository exposure findings before paid traffic. It captures repository/ref, finding class, secret family, severity, status, owner, provider-slot hint, redacted evidence reference, and remediation note without uploading repositories or secret values.

The demo slice starts from browser-local records instead of new infrastructure: it saves redacted scanner findings in local storage per organization under `vaultproof_scanner_findings::<orgId>`, redacts secret-like input before storage/export, avoids `/api/scanner` and repository upload paths, and includes the summary in the evidence packet under `scanner_exposure_review`. Persistent audited scanner tables, CI imports, automatic discovery, PR/remediation workflow, and alerting can follow after the customer demo slice.

Scanner records must never store raw secret values, repository credentials, source file contents, provider API keys, OAuth client secrets, webhook signing secrets, private key material, bearer tokens, request bodies, response bodies, or customer payloads.

## Feature: Release Evidence Center

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/release` gives customer security, platform, and procurement teams a customer-safe change proof trail. It records release label, build/image tag, change summary, approver, verifier, verification status, rollout state, rollback owner/path, and evidence notes.

The demo slice starts from browser-local records instead of new infrastructure: it saves redacted release evidence in local storage per organization under `vaultproof_release_evidence::<orgId>`, redacts secret-like input before storage/export, computes a hold/ready-with-review status, and includes the summary in the evidence packet under `release_evidence`. Persistent audited release records, automatic Cloud Build/deploy evidence capture, approval workflow, and rollback automation can follow after the customer demo slice.

Release records must never store raw provider keys, encrypted provider shares, Supabase service-role keys, browser session tokens, OAuth client secrets, origin-lock secrets, executor signing secrets, runtime-token secrets, environment variables, request bodies, response bodies, or customer payloads.

## Feature: Paid-Pilot Tester Readiness

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/testers` gives operators a customer-safe board for tomorrow's paid-user testers. It records tester name/email, team, role, scenario, login/scenario status, VaultProof owner, guided session window, facilitator, customer owner, success criteria, customer action, blocker note, and customer-safe feedback.

The demo slice starts from browser-local records instead of new infrastructure: it saves redacted tester metadata in local storage per organization under `vaultproof_pilot_testers::<orgId>`, saves guided-session metadata under `vaultproof_pilot_tester_session::<orgId>`, redacts secret-like input before storage/export, computes a hold/ready-for-guided-testing status, exports a copyable session brief, and includes the summary in the evidence packet under `pilot_tester_readiness`. Persistent audited tester records, invite automation, scenario-specific forms, and structured feedback workflow can follow after the customer demo slice.

Tester records must never store passwords, browser session tokens, Supabase service-role keys, OAuth client secrets, provider API keys, encrypted provider shares, origin-lock secrets, executor signing secrets, runtime-token secrets, request bodies, response bodies, or customer payloads.

## Feature: Paid-User Entitlements

Status: `built for enterprise demo`

`https://enterprise.vaultproof.dev/app/entitlements` gives paid-pilot customers a customer-safe contract, capacity, commercial handoff, and amendment/renewal view. It records package, contract status, monthly call allowance, provider-slot allowance, seat allowance, support tier, incident-response add-on status, runtime type, renewal/review date, billing owner, success owner, retention label, invoice status, PO status, procurement owner, payment terms, expansion review date, amendment/change records, and customer-safe notes.

The demo slice starts from browser-local records and existing enterprise evidence: selected organization, visible members, projects, provider slots, traffic, denials, errors, readiness, SSO status, and go/no-go launch state. It computes a capacity status, remaining calls, provider-slot and seat utilization, expansion recommendation, hard-limit boundary, customer-safe usage actions, commercial handoff readiness, renewal status, and amendment blockers; renders visual usage meters; exports packet version 3; and adds commercial handoff plus amendment/renewal details to the copyable capacity brief without storing or exposing secrets. Persistent audited contract records, billing provider integration, invoice automation, hard limit enforcement, overage workflow, and renewal automation remain follow-up work.

Entitlement records and capacity briefs must never store card numbers, bank data, provider keys, encrypted provider shares, Supabase service-role keys, browser session tokens, OAuth client secrets, origin-lock secrets, executor signing secrets, runtime-token secrets, request bodies, response bodies, or customer payloads.

## Feature: Paid-Customer Onboarding

Status: `built for enterprise demo`

`https://admin.vaultproof.dev/app/onboarding` gives staff operators a customer-safe activation board after entitlements are accepted. It records customer kickoff owner, enterprise admin login handoff, first workload owner, support handoff, capacity/renewal review, key posture acceptance or rotation scheduling, customer testing window, and role-specific tasks for security, platform, app owner, billing, and support contacts.

The demo slice starts from browser-local records instead of new infrastructure: it saves activation and role-task metadata in local storage per organization under `vaultproof_paid_onboarding:<orgId>`, redacts secret-like input before storage/export, computes a hold/ready-for-customer-testing status, adds a task summary and `role_task_checklist` to packet version 2, includes the summary in the evidence packet under `paid_onboarding`, and provides a copyable metadata-only task brief. Persistent audited onboarding records, invite automation, customer task notifications, durable task assignment, and staff-admin activation workflow can follow after the customer demo slice.

Onboarding records and task briefs must never store provider keys, encrypted provider shares, Supabase service-role keys, browser session tokens, OAuth client secrets, origin-lock secrets, executor signing secrets, runtime-token secrets, request bodies, response bodies, or customer payloads.

## What's Next

1. Run `LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login` with Supabase service-role env for `ken@vaultproof.dev`.
2. Browser-test `https://enterprise.vaultproof.dev/app/login` with `ken@vaultproof.dev`.
3. Confirm managed Supabase Auth redirect settings include `https://enterprise.vaultproof.dev/app/login`.
4. Configure the external OAuth provider app callback as `https://gwzkjiomemjlhtrdrlan.supabase.co/auth/v1/callback` if using Google/GitHub/Microsoft login; add `LOGIN_QA_OAUTH_PROVIDER=google` to the login QA command to verify the public OAuth authorize redirect.
5. Keep `npm run verify:gcp-enterprise-cloud-armor` in the strict live launch gate.
6. Add a valid OpenAI Platform key only if the demo specifically needs OpenAI; MiniMax upstream dispatch is now live.
7. Keep running `npm run gate:gcp-first-goal`; it can generate a temporary Supabase magic-link test session when no `ENTERPRISE_TEST_ACCESS_TOKEN` is provided.

## Rough Monthly Cost

Assumption: USD list pricing, `us-central1`, always-on runtime, about 730 hours/month, low traffic, no committed-use discount, no custom contract, and no Cloud HSM.

| Item | Basis | Estimated monthly |
| --- | --- | --- |
| Confidential VM `n2d-standard-2` | $0.084492/hour on-demand in `us-central1` | $61.68 |
| 30 GB `pd-balanced` boot disk | $0.10/GB-month in `us-central1` | $3.00 |
| VM external IPv4 address | $0.005/hour while attached to the VM | $3.65 |
| Global HTTPS forwarding rule | $0.025/hour for the first 5 global forwarding rules | $18.25 |
| Cloud KMS software key version | $0.000082192/hour for one active software key version | $0.06 |
| Secret Manager active versions | $0.06/version-month; current billable usage may fit inside the 6-version free tier | $0.06 |

Estimated fixed idle run rate: **$86.70/month** before traffic, Cloud Logging volume, and Supabase.

Database/auth cost note: Goal 1 is demo-only and keeps managed Supabase, so there is no added Cloud SQL or AlloyDB line item. A fresh database can be started later.

Usage-based adders:

- Load balancer data processing: about `$0.008/GiB` inbound and `$0.008/GiB` outbound through the load balancer.
- Internet data transfer out from `us-central1`: first 1 GiB/month free, then about `$0.12/GiB` to North America for the first 1 TiB.
- Backend custom request header feature: `$0.75 per 1,000,000 HTTP(S) requests` when using custom headers without Cloud Armor; Cloud Armor request/rule charges may apply after the edge policy is attached.
- KMS decrypt/encrypt operations: `$0.03 per 10,000 cryptographic operations`.
- Secret Manager access operations: `$0.03 per 10,000 access operations`, with 10,000/month free at the billing-account level.
- Artifact Registry storage is currently tiny; first 0.5 GB is free, then `$0.10/GB-month`.
- Cloud Build image builds are usage-based; the current Docker build is short and should be cents or covered by free/promotional minutes, depending on account eligibility.

Cost note: the current fixed estimate is above the existing `VaultProof Production Monthly` USD 50 budget alert. Either raise the alert for this pilot, stop the VM when idle, or resize/remove the VM external IP path before treating that alert as a production guardrail.

## Build Pointer

- Build tag: `2e8a67fa`
- Registry: `us-central1-docker.pkg.dev/vaultproof-prod/vaultproof`
- Control plane image: `us-central1-docker.pkg.dev/vaultproof-prod/vaultproof/enterprise-control-plane:2e8a67fa`
- Control plane digest: `sha256:e32269dd0bfd48118755d01f4b4eb38675696d432069727693da05fac6b21566`
- Control plane built at: `2026-05-29T10:56:03.768034730Z`
- Executor image: `us-central1-docker.pkg.dev/vaultproof-prod/vaultproof/enterprise-secure-executor:2e8a67fa`
- Executor digest: `sha256:d7dcb3d8f487a38c9de6410c58b7cad8707a0874cdd326fc42d51fd731458bca`
- Executor built at: `2026-05-29T10:56:16.309422858Z`

## Project

- Project ID: `vaultproof-prod`
- Project number: `82281694344`
- Organization: `947188006889`
- Region: `us-central1`
- Zone: `us-central1-a`
- Billing guardrail: `VaultProof Production Monthly`, USD 50 alerting budget
- HSM status: not used. The shared pilot uses standard Cloud KMS.

## Runtime VM

- Name: `vaultproof-enterprise-runtime-1`
- Status: `RUNNING`
- Machine type: `n2d-standard-2`
- Confidential Compute type: `SEV`
- CPU platform: `AMD Milan`
- Service account: `vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com`
- Internal IP: `10.60.0.2`
- External IP: `34.9.204.178`
- Network tag: `vaultproof-enterprise-runtime`
- Shielded Secure Boot: `true`
- Shielded vTPM: `true`
- Shielded integrity monitoring: `true`

The VM runs both containers on localhost:

- Control plane: `127.0.0.1:3001`
- Secure executor: `127.0.0.1:3002`

## Network

- VPC: `vaultproof-enterprise`
- Subnet mode: `CUSTOM`
- Routing mode: `REGIONAL`
- Subnet: `vaultproof-enterprise-us-central1`
- Subnet range: `10.60.0.0/24`
- IAP SSH firewall: `vaultproof-enterprise-allow-iap-ssh`
- IAP SSH source range: `35.235.240.0/20`
- IAP SSH target tags: `vaultproof-enterprise-runtime`
- Public HTTP/HTTPS ingress: not open
- DNS cutover: `done`

## Public Edge

- Domain: `enterprise.vaultproof.dev`
- DNS authority: Cloudflare nameservers observed for `vaultproof.dev`; Cloud DNS is not authoritative today.
- Edge build status: `built`
- Global IP resource: `vaultproof-enterprise-edge-ip`
- Global IP address: `34.102.179.105`
- HTTPS forwarding rule: `vaultproof-enterprise-https`
- HTTPS forwarding IP: `34.102.179.105`
- HTTPS forwarding port range: `443-443`
- Backend service: `vaultproof-enterprise-backend`
- Backend protocol: `HTTP`
- Backend port name: `http`
- Backend logging enabled: `true`
- Backend custom headers configured: `true`
- Cloud Armor policy: `vaultproof-enterprise-armor`
- Cloud Armor expected rules ready: `true`
- Backend health: `HEALTHY 10.60.0.2:3001`
- Instance group: `vaultproof-enterprise-runtime-ig`
- Health check: `vaultproof-enterprise-health`
- Health check host: `enterprise.vaultproof.dev`
- Health check path: `/health`
- Health check port: `3001`
- SSL certificate: `vaultproof-enterprise-cert`
- SSL certificate status: `ACTIVE`
- SSL certificate domain status: `ACTIVE`
- SSL certificate domains: `enterprise.vaultproof.dev`
- Load-balancer firewall: `vaultproof-enterprise-allow-lb-to-control-plane`
- Load-balancer firewall source ranges: `130.211.0.0/22, 35.191.0.0/16`
- Observed DNS A records: `34.102.179.105`
- DNS cutover: `done; Cloudflare enterprise A record points at the GCP global IP`

## KMS

- Key ring: `projects/vaultproof-prod/locations/us-central1/keyRings/vaultproof-runtime`
- KMS key: `projects/vaultproof-prod/locations/us-central1/keyRings/vaultproof-runtime/cryptoKeys/vaultproof-unwrap`
- Purpose: `ENCRYPT_DECRYPT`
- Primary version: `1`
- Primary state: `ENABLED`
- Protection level: `SOFTWARE`
- Algorithm: `GOOGLE_SYMMETRIC_ENCRYPTION`

The executor service account has decrypt access on this key. Raw key material is not exportable from Cloud KMS.

## Service Accounts

- `vaultproof-executor@vaultproof-prod.iam.gserviceaccount.com` - VaultProof Secure Executor
- `vaultproof-control-plane@vaultproof-prod.iam.gserviceaccount.com` - VaultProof Control Plane
- `vaultproof-deploy@vaultproof-prod.iam.gserviceaccount.com` - VaultProof Deployment

## Secret Manager

- `enterprise-control-plane-env`
- `enterprise-origin-lock-secret`
- `enterprise-secure-executor-env`

Expected runtime env secret containers:

- `enterprise-control-plane-env`
- `enterprise-secure-executor-env`

As of this build, real runtime env secret versions are live and the VM has reloaded them.

## Current Readiness

Current runtime status:

- Containers are running.
- Public `/health` and `/readiness` pass through the GCP edge.
- Readiness reports `production_ready: true` and `security_profile: google-confidential-production`.

Known blockers:

- Run strict login readiness QA with `LOGIN_QA_REQUIRE_SESSION=true npm run qa:enterprise-login` to verify the Supabase redirect/session/API path.
- Human OAuth/password login still needs final browser click-through QA.
- Supabase Auth redirect/provider settings still need confirmation for `https://enterprise.vaultproof.dev/app/login`.
- Rotate the pilot MiniMax key before paid customer onboarding because it was shared in chat; keep using sealed local ingest for any future live provider key.

## Verification Commands

```bash
gcloud compute ssh vaultproof-enterprise-runtime-1 \
  --zone=us-central1-a \
  --project=vaultproof-prod \
  --tunnel-through-iap \
  --command='curl -sS http://127.0.0.1:3002/health; echo; curl -sS -H "Host: enterprise.vaultproof.dev" http://127.0.0.1:3001/readiness; echo'
```

```bash
gcloud artifacts docker images list us-central1-docker.pkg.dev/vaultproof-prod/vaultproof \
  --include-tags \
  --project=vaultproof-prod
```

## Update Rule

- This file updates automatically after `npm run build:gcp-enterprise-images`.
- Infrastructure changes must also update this file in the same PR or run.
- Feature changes should update `docs/enterprise/gcp-feature-inventory.md`.
